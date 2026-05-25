/**
 * `helpcode ask "<task>"` — assemble a structured prompt for Claude.ai
 * based on the project state and selected files. Prints a paste block.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadProjectConfig } from '../core/project.js';
import { loadState, saveState, createTask } from '../core/state.js';
import { selectFiles } from '../core/selector.js';
import { buildPrompt } from '../core/prompt.js';
import { printPasteBlock, log, c } from '../lib/ui.js';

const STATE_DIR = '.helpcode';

export interface AskOptions {
  files?: string[];
}

export async function handleAsk(taskDescription: string, opts: AskOptions = {}): Promise<number> {
  if (!taskDescription || !taskDescription.trim()) {
    log.err('Usage: helpcode ask "<task description>"');
    return 1;
  }

  const config = loadProjectConfig();
  const state = loadState();

  // If there's no current task, or the user is starting fresh, create one
  let task = state.currentTask;
  if (!task || task.status === 'resolved' || task.status === 'failed') {
    task = createTask(taskDescription);
    state.currentTask = task;
  } else {
    task.iterations += 1;
  }

  // Resolve files: explicit override OR heuristic selection
  let selectedFiles: string[];
  if (opts.files && opts.files.length > 0) {
    selectedFiles = opts.files
      .map(f => path.resolve(f))
      .filter(f => {
        if (!fs.existsSync(f)) {
          log.warn(`File not found, skipping: ${f}`);
          return false;
        }
        return true;
      });
  } else {
    selectedFiles = selectFiles(taskDescription, config);
  }

  if (selectedFiles.length === 0) {
    log.warn('No relevant files found. The prompt will contain context only.');
    log.dim('Tip: pass --files <paths> to include specific files.');
  }

  const prompt = buildPrompt({
    taskDescription,
    selectedFiles,
    lastTestOutput: task.lastTestOutput,
    config,
  });

  // Persist
  task.lastPrompt = prompt;
  task.status = 'awaiting_paste';
  saveState(state);

  // Also save the prompt to a file the user can re-copy from
  const pendingPath = path.join(STATE_DIR, 'pending.txt');
  fs.writeFileSync(pendingPath, prompt, 'utf-8');

  printPasteBlock(prompt);

  console.log();
  log.dim(`(saved a copy at ${pendingPath})`);
  log.dim(`(~${Math.round(prompt.length / 4)} tokens approx)`);
  console.log();
  console.log(`${c.bold('Next:')} paste this into Claude.ai, copy the reply, then run:`);
  console.log(`  ${c.cyan('helpcode apply')}`);
  return 0;
}
