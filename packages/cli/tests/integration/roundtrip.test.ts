import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleInit } from '../../src/commands/init.js';
import { handleAsk } from '../../src/commands/ask.js';

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  origCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpcode-itest-'));
  process.chdir(tmpDir);
  // Build a tiny Python project
  fs.writeFileSync('requirements.txt', 'flask==3.0.0\npytest==7.4.0\n');
  fs.mkdirSync('app');
  fs.writeFileSync('app/auth.py', 'def login(email, password):\n    return False\n');
});

afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('init writes project.json with detected Flask', async () => {
  const code = await handleInit({ skipOllamaDetection: true });
  assert.equal(code, 0);
  const cfgPath = path.join(tmpDir, '.helpcode', 'project.json');
  assert.ok(fs.existsSync(cfgPath));
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  assert.equal(cfg.language, 'python');
  assert.equal(cfg.framework, 'Flask');
});

test('ask generates a prompt with selected files', async () => {
  await handleInit({ skipOllamaDetection: true });
  // ask command writes pending.txt
  const code = await handleAsk('fix the login function');
  assert.equal(code, 0);
  const pending = fs.readFileSync(
    path.join(tmpDir, '.helpcode', 'pending.txt'),
    'utf-8',
  );
  assert.ok(pending.includes('## My task'));
  assert.ok(pending.includes('fix the login function'));
  assert.ok(pending.includes('## Please respond in this format'));
  assert.ok(pending.includes('app/auth.py'));
});

test('init --force overwrites existing config', async () => {
  await handleInit({ skipOllamaDetection: true });
  const code = await handleInit({ force: true, skipOllamaDetection: true });
  assert.equal(code, 0);
});

test('init refuses without --force when already initialised', async () => {
  await handleInit({ skipOllamaDetection: true });
  const code = await handleInit({ skipOllamaDetection: true });
  assert.equal(code, 1);
});
