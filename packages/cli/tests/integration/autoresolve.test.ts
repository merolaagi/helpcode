import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleRun } from '../../src/commands/run.js';
import { loadState, saveState, createTask } from '../../src/core/state.js';
import { saveProjectConfig } from '../../src/core/project.js';
import { ProjectConfig } from '../../src/types.js';

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  origCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpcode-run-'));
  process.chdir(tmpDir);

  const cfg: ProjectConfig = {
    root: tmpDir,
    language: 'python',
    framework: null,
    testCommand: 'echo ok',          // a command that always succeeds
    sourceDirs: ['.'],
    createdAt: new Date().toISOString(),
  };
  saveProjectConfig(cfg, tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('run: auto-resolves a failed task when test command now passes', async () => {
  // Set up a failed task
  const state = loadState();
  const task = createTask('do the thing');
  task.status = 'failed';
  state.currentTask = task;
  saveState(state);

  // Run the project's test command (echo ok → exit 0)
  const code = await handleRun('echo ok');
  assert.equal(code, 0);

  const after = loadState();
  assert.equal(after.currentTask?.status, 'resolved',
    'a successful run of the test command should auto-resolve a failed task');
});

test('run: does NOT auto-resolve when command differs from test command', async () => {
  const state = loadState();
  const task = createTask('do the thing');
  task.status = 'failed';
  state.currentTask = task;
  saveState(state);

  // Run a DIFFERENT command that also succeeds
  const code = await handleRun('echo something-else');
  assert.equal(code, 0);

  const after = loadState();
  assert.equal(after.currentTask?.status, 'failed',
    'only the configured test command should auto-resolve; arbitrary commands should not');
});

test('run: does NOT auto-resolve when the run fails', async () => {
  const state = loadState();
  const task = createTask('do the thing');
  task.status = 'failed';
  state.currentTask = task;
  saveState(state);

  // A command matching... but make it fail. Use `false` which exits 1.
  // First reconfigure test command to `false`.
  const cfg: ProjectConfig = {
    root: tmpDir,
    language: 'python',
    framework: null,
    testCommand: 'false',
    sourceDirs: ['.'],
    createdAt: new Date().toISOString(),
  };
  saveProjectConfig(cfg, tmpDir);

  const code = await handleRun('false');
  assert.notEqual(code, 0);

  const after = loadState();
  assert.equal(after.currentTask?.status, 'failed',
    'a failing run must not resolve the task');
});
