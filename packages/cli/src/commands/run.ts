/**
 * `helpcode run <command>` — run a shell command and capture the output
 * in compact form. The result is saved into state so the next `ask` can
 * include it for Claude.
 *
 * Side effect (v0.1.3): if the command matches the project's configured
 * test command AND it succeeds AND the current task is in a `failed` state,
 * the task is auto-resolved. This fixes the state-drift problem where a
 * task stays `failed` forever after the user fixes the issue outside
 * helpcode and re-runs the tests manually.
 */

import { runShellCommand } from '../core/tools.js';
import { truncateLines, extractTraceback } from '../lib/compress.js';
import { loadState, saveState, appendSousChefEvent } from '../core/state.js';
import { AgentState } from '../types.js';
import { projectExists, loadProjectConfig } from '../core/project.js';
import { triageOutput, shouldTriage } from '../core/triage.js';
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

  // Save to state so `ask` can include it. When Ollama is enabled and the
  // raw output is long, run it through local-LLM triage so the NEXT brief
  // carries just the key failure rather than the whole wall of output. The
  // console above still shows the full compact report to the user.
  const state = loadState();
  if (state.currentTask) {
    let savedOutput = report;

    const cfg = loadConfigSafe();
    const rawForTriage = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (cfg?.ollama && shouldTriage(rawForTriage, cfg.ollama)) {
      const triaged = await triageOutput(rawForTriage, cfg.ollama);
      if (triaged.triaged) {
        savedOutput = [
          `$ ${command}`,
          `Exit: ${result.exitCode}    Time: ${(result.durationMs / 1000).toFixed(2)}s`,
          '',
          '--- key failure (summarised by local model) ---',
          triaged.text,
        ].join('\n');
        log.dim('(summarised long output with local model for the next brief)');
        recordTriageEvent(state, cfg.ollama.model, rawForTriage, triaged.text);
      }
    }

    state.currentTask.lastTestOutput = savedOutput;

    // Auto-resolve: if this run matches the project's test command, it
    // succeeded, and the task was failed, clear the failed state.
    if (
      result.exitCode === 0 &&
      state.currentTask.status === 'failed' &&
      commandMatchesTestCommand(command)
    ) {
      state.currentTask.status = 'resolved';
      console.log();
      log.ok('Task marked resolved — the project test command now passes.');
    }

    saveState(state);
  }

  return result.exitCode;
}

/** Load project config without throwing if absent. */
function loadConfigSafe() {
  if (!projectExists()) return null;
  try {
    return loadProjectConfig();
  } catch {
    return null;
  }
}

/** Does the run command match the project's configured test command? */
function commandMatchesTestCommand(command: string): boolean {
  if (!projectExists()) return false;
  try {
    const cfg = loadProjectConfig();
    if (!cfg.testCommand) return false;
    return normalise(command) === normalise(cfg.testCommand);
  } catch {
    return false;
  }
}

function normalise(cmd: string): string {
  return cmd.trim().replace(/\s+/g, ' ');
}

/** Append a triage sous-chef event to the in-memory state (saved by caller). */
function recordTriageEvent(
  state: AgentState,
  model: string,
  rawOutput: string,
  triagedText: string,
): void {
  const rawLines = rawOutput.split('\n').length;
  const triagedLines = triagedText.split('\n').length;
  appendSousChefEvent(state, {
    at: new Date().toISOString(),
    task: 'output_triage',
    worker: 'local',
    model,
    summary: `triaged ${rawLines} lines to key failure`,
    outcome: 'ok',
    // rough: lines dropped ≈ tokens saved, ~8 tokens/line
    estTokensSaved: Math.max(0, (rawLines - triagedLines) * 8),
  });
}
