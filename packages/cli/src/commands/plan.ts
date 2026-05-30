/**
 * `helpcode plan "<big task>"` — propose an ordered breakdown of a large task
 * into focused sub-steps.
 *
 * Human-in-the-loop by design: this PROPOSES and STOPS. It prints the steps and
 * suggests running `helpcode ask` for the first one. It does NOT auto-run
 * anything. helpcode stays in the loop; it is not an autonomous agent.
 *
 * v0.3.2: decomposition can run on a LOCAL sous-chef (Ollama) or, if local is
 * unavailable and a free-tier key is configured, a REMOTE one (Gemini). The
 * task description is the only thing sent remotely — no source code — so this
 * is privacy-safe under the default rules (see core/souschef.ts).
 */

import { loadProjectConfig } from '../core/project.js';
import { loadState, saveState, appendSousChefEvent } from '../core/state.js';
import { decomposeTask, buildDecompositionPrompt, parseDecomposition } from '../core/decompose.js';
import { geminiGenerate, GeminiError } from '../core/gemini.js';
import { loadGeminiKey } from '../core/keys.js';
import { WorkerKind } from '../types.js';
import { c, log } from '../lib/ui.js';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

interface PlanOutcome {
  ok: boolean;
  steps: string[];
  worker: WorkerKind;
  model: string | null;
  reason: string;
}

export async function handlePlan(task: string): Promise<number> {
  if (!task || !task.trim()) {
    log.err('Usage: helpcode plan "<task to break down>"');
    return 1;
  }

  const config = loadProjectConfig();
  const outcome = await decomposeViaSousChef(task, config);

  if (!outcome.ok) {
    if (outcome.steps.length === 1) {
      log.dim('This looks like a single focused task — no need to break it down.');
    } else {
      log.dim(`Couldn't break this down (${outcome.reason}).`);
    }
    log.dim('Just run: ' + c.cyan(`helpcode ask "${task}"`));
    return 0;
  }

  // Record the prep work for the cockpit.
  const state = loadState();
  appendSousChefEvent(state, {
    at: new Date().toISOString(),
    task: 'decomposition',
    worker: outcome.worker,
    model: outcome.model,
    summary: `proposed ${outcome.steps.length}-step breakdown`,
    outcome: 'ok',
    estTokensSaved: null,
  });
  saveState(state);

  // Propose — and stop. The human decides.
  console.log();
  const where = outcome.worker === 'remote'
    ? c.dim(`  (via free-tier ${outcome.model})`)
    : '';
  console.log(c.cyan('Proposed breakdown') + c.dim('  (you decide — nothing runs automatically)') + where);
  console.log();
  outcome.steps.forEach((step, i) => {
    console.log(`  ${c.cyan(String(i + 1))}. ${step}`);
  });
  console.log();
  log.dim('Tackle these one at a time. Start the first with:');
  console.log('  ' + c.cyan(`helpcode ask "${outcome.steps[0]}"`));
  console.log();
  log.dim('Each focused step gives Claude a tighter brief than the whole task at once.');
  return 0;
}

/**
 * Try local decomposition first; if local isn't available and a free-tier key
 * is configured, fall back to the remote sous-chef. Decomposition sends only
 * the task description (no code), so it's privacy-safe by default.
 */
async function decomposeViaSousChef(task: string, config: any): Promise<PlanOutcome> {
  // 1. Local (cheapest), if enabled.
  if (config.ollama?.enabled) {
    log.dim(`thinking through the steps (local model: ${config.ollama.model})...`);
    const local = await decomposeTask(task, config.ollama);
    if (local.ok) {
      return { ok: true, steps: local.steps, worker: 'local', model: config.ollama.model, reason: '' };
    }
    // Local produced a single step (not worth decomposing) — respect that,
    // don't burn a remote call second-guessing it.
    if (local.steps.length === 1) {
      return { ok: false, steps: local.steps, worker: 'local', model: config.ollama.model, reason: local.reason };
    }
    // Local failed for an availability reason — fall through to remote.
    log.dim(`local model unavailable (${local.reason})`);
  }

  // 2. Remote free-tier, if a key is configured. Decomposition is always
  //    privacy-allowed (task description only, no code).
  const key = loadGeminiKey();
  if (!key) {
    if (!config.ollama?.enabled) {
      return { ok: false, steps: [], worker: 'local', model: null,
        reason: 'no local model enabled and no free-tier key configured' };
    }
    return { ok: false, steps: [], worker: 'local', model: null, reason: 'local model unavailable' };
  }

  log.dim(`thinking through the steps (free-tier ${GEMINI_MODEL})...`);
  try {
    const text = await geminiGenerate(buildDecompositionPrompt(task), {
      apiKey: key, model: GEMINI_MODEL, timeoutMs: 30000,
    });
    const steps = parseDecomposition(text);
    if (steps.length >= 2) {
      return { ok: true, steps, worker: 'remote', model: GEMINI_MODEL, reason: '' };
    }
    if (steps.length === 1) {
      return { ok: false, steps, worker: 'remote', model: GEMINI_MODEL, reason: 'single step — not worth decomposing' };
    }
    return { ok: false, steps: [], worker: 'remote', model: GEMINI_MODEL, reason: 'no steps parsed' };
  } catch (e) {
    const why = e instanceof GeminiError ? e.message : (e as Error).message;
    return { ok: false, steps: [], worker: 'remote', model: GEMINI_MODEL, reason: `remote failed: ${why}` };
  }
}
