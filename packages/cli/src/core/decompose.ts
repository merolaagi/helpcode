/**
 * Task decomposition (v0.3.1) — the third local sous-chef task.
 *
 * A big, sprawling task ("add auth: login, logout, reset, sessions") produces a
 * sprawling brief and a sprawling Claude reply. Decomposition asks the local
 * model to break it into ordered, focused sub-steps, so the principal can be
 * given ONE step at a time.
 *
 * CRITICAL constraint (from the design doc): decomposition PROPOSES, the human
 * APPROVES. It never autonomously runs the steps. `helpcode plan` prints the
 * breakdown and stops. This keeps helpcode in-the-loop, not an autonomous agent.
 *
 * Unlike selection (keyword fallback) and triage (truncation fallback), there
 * is no sensible deterministic fallback for decomposition — you can't split a
 * task into meaningful steps without understanding it. So if the local model
 * is unavailable, decomposition honestly reports ok=false and the user just
 * proceeds with their task as a single unit. Doing nothing is the safe fallback.
 */

import { generate, OllamaError } from './ollama.js';
import { OllamaSettings } from '../types.js';

export interface DecompositionResult {
  ok: boolean;
  /** Ordered sub-steps (empty if ok is false). */
  steps: string[];
  /** If ok is false, why. Empty otherwise. */
  reason: string;
}

type GenerateImpl = (
  host: string, model: string, prompt: string, opts?: { timeoutMs?: number },
) => Promise<string>;

export interface DecomposeDeps {
  generateImpl?: GenerateImpl;
}

export function buildDecompositionPrompt(task: string): string {
  return [
    'Break the following software task into a short ordered list of focused,',
    'self-contained sub-steps. Each step should be something that could be',
    'tackled in a single round with a coding assistant. Aim for 2-6 steps.',
    'If the task is already small enough, return a single step.',
    '',
    'Respond ONLY with a numbered list, one step per line, no preamble:',
    '  1. first step',
    '  2. second step',
    '',
    `TASK: ${task}`,
  ].join('\n');
}

/**
 * Parse a numbered/bulleted list of steps from the model's response. Tolerant
 * of prose around the list, various markers (1. / 1) / -), and markdown bold.
 */
export function parseDecomposition(response: string): string[] {
  const steps: string[] = [];
  for (const rawLine of response.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Match a leading list marker: "1." / "1)" / "-" / "*"
    const m = line.match(/^(?:\d+[.)]|[-*])\s+(.*)$/);
    if (!m) continue;
    let text = m[1].trim();
    // Strip surrounding markdown emphasis (**bold**, *italic*, `code`)
    text = text.replace(/\*\*(.*?)\*\*/g, '$1')
               .replace(/\*(.*?)\*/g, '$1')
               .replace(/`(.*?)`/g, '$1')
               .trim();
    if (text) steps.push(text);
  }
  return steps;
}

/**
 * Decompose a task using the local model. Proposes only — never runs anything.
 * ok=false when: ollama disabled, model failed, or the result was a single step
 * (i.e. decomposition added no value). The caller then just proceeds normally.
 */
export async function decomposeTask(
  task: string,
  ollama: OllamaSettings,
  deps: DecomposeDeps = {},
): Promise<DecompositionResult> {
  if (!ollama.enabled) {
    return { ok: false, steps: [], reason: 'local model not enabled' };
  }

  const generateImpl = deps.generateImpl ?? generate;
  let response: string;
  try {
    response = await generateImpl(
      ollama.host, ollama.model, buildDecompositionPrompt(task),
      { timeoutMs: ollama.timeoutMs },
    );
  } catch (e) {
    const why = e instanceof OllamaError ? e.message : (e as Error).message;
    return { ok: false, steps: [], reason: `local model failed: ${why}` };
  }

  const steps = parseDecomposition(response);
  if (steps.length === 0) {
    return { ok: false, steps: [], reason: 'no steps parsed from model output' };
  }
  if (steps.length === 1) {
    return { ok: false, steps, reason: 'task came back as a single step — not worth decomposing' };
  }
  return { ok: true, steps, reason: '' };
}
