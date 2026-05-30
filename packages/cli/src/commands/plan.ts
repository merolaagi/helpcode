/**
 * `helpcode plan "<big task>"` — propose an ordered breakdown of a large task
 * into focused sub-steps, using the local model.
 *
 * Human-in-the-loop by design: this PROPOSES and STOPS. It prints the steps and
 * suggests running `helpcode ask` for the first one. It does NOT auto-run
 * anything. helpcode stays in the loop; it is not an autonomous agent.
 */

import { loadProjectConfig } from '../core/project.js';
import { loadState, saveState, appendSousChefEvent } from '../core/state.js';
import { decomposeTask } from '../core/decompose.js';
import { c, log } from '../lib/ui.js';

export async function handlePlan(task: string): Promise<number> {
  if (!task || !task.trim()) {
    log.err('Usage: helpcode plan "<task to break down>"');
    return 1;
  }

  const config = loadProjectConfig();

  if (!config.ollama?.enabled) {
    log.warn('Task decomposition needs a local model (Ollama), which isn\'t enabled.');
    log.dim('Enable it in .helpcode/project.json, or just run `helpcode ask` with your task as-is.');
    return 1;
  }

  log.dim(`thinking through the steps (local model: ${config.ollama.model})...`);
  const result = await decomposeTask(task, config.ollama);

  if (!result.ok) {
    // Honest non-fallback: decomposition adds no value here, proceed normally.
    if (result.steps.length === 1) {
      log.dim('This looks like a single focused task — no need to break it down.');
    } else {
      log.dim(`Couldn't break this down (${result.reason}).`);
    }
    log.dim('Just run: ' + c.cyan(`helpcode ask "${task}"`));
    return 0;
  }

  // Record the prep work for the cockpit.
  const state = loadState();
  appendSousChefEvent(state, {
    at: new Date().toISOString(),
    task: 'decomposition',
    worker: 'local',
    model: config.ollama.model,
    summary: `proposed ${result.steps.length}-step breakdown`,
    outcome: 'ok',
    estTokensSaved: null,
  });
  saveState(state);

  // Propose — and stop. The human decides.
  console.log();
  console.log(c.cyan('Proposed breakdown') + c.dim('  (you decide — nothing runs automatically)'));
  console.log();
  result.steps.forEach((step, i) => {
    console.log(`  ${c.cyan(String(i + 1))}. ${step}`);
  });
  console.log();
  log.dim('Tackle these one at a time. Start the first with:');
  console.log('  ' + c.cyan(`helpcode ask "${result.steps[0]}"`));
  console.log();
  log.dim('Each focused step gives Claude a tighter brief than the whole task at once.');
  return 0;
}
