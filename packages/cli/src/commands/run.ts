/**
 * `helpcode run <command>` — run a shell command and capture the output
 * in compact form. The result is saved into state so the next `ask` can
 * include it for Claude.
 */

import { runShellCommand } from '../core/tools.js';
import { truncateLines, extractTraceback } from '../lib/compress.js';
import { loadState, saveState } from '../core/state.js';
import { c, log } from '../lib/ui.js';

const MAX_OUTPUT_LINES = 40;

export interface RunOptions {
  timeout?: number;
}

export async function handleRun(command: string, opts: RunOptions = {}): Promise<number> {
  if (!command || !command.trim()) {
    log.err('Usage: helpcode run "<command>"');
    return 1;
  }

  const result = await runShellCommand(command, { timeoutSecs: opts.timeout ?? 60 });

  // Render compact report
  const parts: string[] = [];
  parts.push(`$ ${command}`);
  parts.push(`Exit: ${result.exitCode}    Time: ${(result.durationMs / 1000).toFixed(2)}s` +
             (result.timedOut ? c.yellow('    (TIMEOUT)') : ''));

  if (result.stdout.trim()) {
    parts.push('');
    parts.push('--- stdout ---');
    parts.push(truncateLines(result.stdout.trimEnd(), MAX_OUTPUT_LINES, 'stdout lines'));
  }
  if (result.stderr.trim()) {
    parts.push('');
    parts.push('--- stderr ---');
    parts.push(extractTraceback(result.stderr));
  }
  if (!result.stdout.trim() && !result.stderr.trim()) {
    parts.push('(no output)');
  }

  const report = parts.join('\n');
  console.log(report);

  // Save to state so `ask` can include it
  const state = loadState();
  if (state.currentTask) {
    state.currentTask.lastTestOutput = report;
    saveState(state);
  }

  return result.exitCode;
}
