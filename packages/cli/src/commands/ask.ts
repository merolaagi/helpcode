/**
 * `helpcode ask "<task>"` — assemble a structured prompt for Claude.ai
 * based on the project state and selected files. Prints a paste block.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadProjectConfig } from '../core/project.js';
import { loadState, saveState, createTask } from '../core/state.js';
import { selectFilesWithStrategy } from '../core/selector.js';
import { buildPrompt } from '../core/prompt.js';
import { printPasteBlock, log, c } from '../lib/ui.js';

const STATE_DIR = '.helpcode';

export interface AskOptions {
  files?: string[];
  /** Force the heuristic selector even if Ollama is enabled. */
  noLlm?: boolean;
  /** Print the reason each file was selected. */
  explainSelection?: boolean;
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

  // Resolve files: explicit override, else LLM-or-heuristic strategy
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
    if (opts.explainSelection) {
      for (const f of selectedFiles) {
        log.dim(`  ${path.relative(config.root, f)} — explicitly provided via --files`);
      }
    }
  } else {
    if (config.ollama?.enabled && !opts.noLlm) {
      log.dim(`selecting files (local model: ${config.ollama.model})...`);
    }
    const result = await selectFilesWithStrategy(taskDescription, config, {
      forceHeuristic: opts.noLlm,
    });
    selectedFiles = result.files.map(f => f.filepath);

    if (result.strategy === 'llm') {
      log.ok(`selected ${result.files.length} file(s) via local model`);
    } else if (result.fallbackReason) {
      log.dim(`local-model selection unavailable (${result.fallbackReason}) — used keyword heuristic`);
    }

    if (opts.explainSelection) {
      for (const f of result.files) {
        log.dim(`  ${path.relative(config.root, f.filepath)} — ${f.reason}`);
      }
    }
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
