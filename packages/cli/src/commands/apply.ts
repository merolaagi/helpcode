/**
 * `helpcode apply` — parse Claude's reply (from stdin), apply diffs,
 * run the test command. Updates state with the verdict.
 *
 * v0.1 is intentionally conservative:
 *   - Shows planned changes before applying
 *   - Asks for confirmation (unless --yes)
 *   - On any diff failure, stops and reports — does NOT roll back yet
 *     (v0.2 will add rollback via core/rollback.ts)
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadState, saveState } from '../core/state.js';
import { loadProjectConfig } from '../core/project.js';
import { parseClaudeResponse, validateParsedResponse, ParsedResponse } from '../core/parser.js';
import { applyLinePatch } from '../core/patcher.js';
import { runShellCommand } from '../core/tools.js';
import { truncateLines, extractTraceback } from '../lib/compress.js';
import { readStdin, confirm, c, log } from '../lib/ui.js';
import { HelpcodeError } from '../lib/errors.js';
import { AppliedDiff } from '../types.js';

export interface ApplyOptions {
  yes?: boolean;
  dryRun?: boolean;
}

export async function handleApply(opts: ApplyOptions = {}): Promise<number> {
  const state = loadState();
  if (!state.currentTask) {
    log.err('No current task. Run `helpcode ask "<task>"` first.');
    return 1;
  }
  const task = state.currentTask;

  // Get Claude's response. Prefer stdin; fall back to .helpcode/response.txt.
  const raw = await getResponseText();
  if (!raw.trim()) {
    log.err('No input received.');
    log.dim('Paste Claude\'s reply and press Ctrl-D, or save it to .helpcode/response.txt first.');
    return 1;
  }
  task.lastResponseRaw = raw;

  const parsed = parseClaudeResponse(raw);
  if (parsed.parseWarning) {
    log.warn('Claude\'s reply doesn\'t match the expected format.');
    log.dim('Helpcode expects sections like `## PLAN`, `## DIFF: <file>`, `## TEST`.');
    log.dim('Save the reply, fix the format, and re-run `helpcode apply`.');
    task.status = 'failed';
    saveState(state);
    return 1;
  }
  if (parsed.repairsApplied) {
    log.dim('(auto-repaired copy-paste corruption in Claude\'s reply — review the plan below carefully)');
  }

  const issues = validateParsedResponse(parsed);
  if (issues.length > 0) {
    log.err('Response failed validation:');
    for (const i of issues) log.err('  ' + i);
    task.status = 'failed';
    saveState(state);
    return 1;
  }

  showPlan(parsed);

  if (opts.dryRun) {
    log.dim('--dry-run: not applying anything.');
    return 0;
  }

  if (!opts.yes) {
    const ok = await confirm('Apply these changes?');
    if (!ok) {
      log.dim('Cancelled.');
      return 0;
    }
  }

  task.status = 'applying';
  saveState(state);

  const applied: AppliedDiff[] = [];
  let allOk = true;

  for (const diff of parsed.diffs) {
    try {
      const r = applyLinePatch(diff.filepath, diff.patchLines);
      applied.push({
        filepath: r.filepath,
        hunks: r.hunksApplied,
        ok: true,
        created: r.created,
      });
      log.ok(`patched ${r.filepath}${r.created ? ' (new file)' : ''}`);
    } catch (e) {
      const msg = e instanceof HelpcodeError ? e.message : (e as Error).message;
      const hint = e instanceof HelpcodeError ? e.hint : '';
      log.err(`failed: ${diff.filepath} — ${msg}`);
      if (hint) log.dim('  ' + hint);
      applied.push({
        filepath: diff.filepath,
        hunks: 0,
        ok: false,
        created: false,
      });
      allOk = false;
      break; // stop on first failure for v0.1
    }
  }

  task.lastDiffsApplied = applied;

  if (!allOk) {
    task.status = 'failed';
    saveState(state);
    log.warn('Some patches failed. Files written before the failure are still on disk.');
    log.dim('v0.2 will add automatic rollback. For now, use `git checkout -- <file>` or your editor\'s undo.');
    return 1;
  }

  // Run the test command Claude suggested, or the project default
  const config = loadProjectConfig();
  const testCmd = parsed.testCommand ?? config.testCommand;
  if (!testCmd) {
    log.dim('No test command available — skipping test run.');
    task.status = 'resolved';
    saveState(state);
    log.ok('Done.');
    return 0;
  }

  task.status = 'testing';
  saveState(state);

  log.dim(`running: ${testCmd}`);
  const result = await runShellCommand(testCmd, { timeoutSecs: 120 });
  const testReport = formatTestReport(testCmd, result);
  task.lastTestOutput = testReport;
  console.log();
  console.log(testReport);

  if (result.exitCode === 0) {
    task.status = 'resolved';
    saveState(state);
    console.log();
    log.ok('Tests pass. Ready to commit when you are.');
    return 0;
  } else {
    task.status = 'failed';
    saveState(state);
    console.log();
    log.warn('Tests failed. Run `helpcode ask "..."` to send the failure back to Claude.');
    return result.exitCode;
  }
}

async function getResponseText(): Promise<string> {
  // If stdin is a TTY and there's a saved response, prefer that
  const savedPath = path.join('.helpcode', 'response.txt');
  if (process.stdin.isTTY && fs.existsSync(savedPath)) {
    log.dim(`using saved response from ${savedPath}`);
    return fs.readFileSync(savedPath, 'utf-8');
  }
  return readStdin();
}

function showPlan(parsed: ParsedResponse): void {
  console.log();
  console.log(c.bold('Plan:'));
  console.log('  ' + parsed.plan.split('\n').join('\n  '));
  console.log();
  console.log(c.bold('Files to change:'));
  for (const d of parsed.diffs) {
    console.log(`  ${c.cyan('•')} ${d.filepath}`);
  }
  if (parsed.testCommand) {
    console.log();
    console.log(c.bold('Test command:'));
    console.log(`  ${parsed.testCommand}`);
  }
  if (parsed.notes) {
    console.log();
    console.log(c.bold('Notes from Claude:'));
    console.log('  ' + parsed.notes.split('\n').join('\n  '));
  }
}

function formatTestReport(cmd: string, result: { exitCode: number; stdout: string; stderr: string; durationMs: number }): string {
  const parts: string[] = [];
  parts.push(`$ ${cmd}`);
  parts.push(`Exit: ${result.exitCode}    Time: ${(result.durationMs / 1000).toFixed(2)}s`);
  if (result.stdout.trim()) {
    parts.push('--- stdout ---');
    parts.push(truncateLines(result.stdout.trimEnd(), 40, 'stdout lines'));
  }
  if (result.stderr.trim()) {
    parts.push('--- stderr ---');
    parts.push(extractTraceback(result.stderr));
  }
  return parts.join('\n');
}
