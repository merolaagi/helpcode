import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { selectFilesWithStrategy } from '../../src/core/selector.js';
import { ProjectConfig } from '../../src/types.js';

// These tests verify the strategy chooser falls back to the heuristic
// correctly. They never reach a live Ollama: when ollama is disabled, the
// LLM path is never attempted; when "enabled" but pointed at an unreachable
// host, the reachability probe fails fast and we fall back.

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpcode-strategy-'));
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'auth.py'),
    'def login(email, password):\n    return check(email)\n',
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    root: tmpDir,
    language: 'python',
    framework: null,
    testCommand: 'pytest',
    sourceDirs: ['src'],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test('strategy: uses heuristic when ollama is absent', async () => {
  const result = await selectFilesWithStrategy('fix login', baseConfig());
  assert.equal(result.strategy, 'heuristic');
  assert.ok(result.files.length > 0);
});

test('strategy: uses heuristic when ollama is disabled', async () => {
  const result = await selectFilesWithStrategy(
    'fix login',
    baseConfig({
      ollama: { enabled: false, model: 'x', host: 'http://localhost:11434', timeoutMs: 20000 },
    }),
  );
  assert.equal(result.strategy, 'heuristic');
});

test('strategy: forceHeuristic overrides an enabled ollama', async () => {
  const result = await selectFilesWithStrategy(
    'fix login',
    baseConfig({
      // even though enabled, forceHeuristic should skip the LLM entirely
      ollama: { enabled: true, model: 'x', host: 'http://localhost:11434', timeoutMs: 20000 },
    }),
    { forceHeuristic: true },
  );
  assert.equal(result.strategy, 'heuristic');
  assert.equal(result.fallbackReason, ''); // not a fallback — user chose heuristic
});

test('strategy: falls back to heuristic when ollama enabled but unreachable', async () => {
  // Point at a port nothing is listening on. The 1s reachability probe fails,
  // and we fall back with a recorded reason.
  const result = await selectFilesWithStrategy(
    'fix login',
    baseConfig({
      ollama: { enabled: true, model: 'x', host: 'http://127.0.0.1:9', timeoutMs: 2000 },
    }),
  );
  assert.equal(result.strategy, 'heuristic');
  assert.match(result.fallbackReason, /unavailable|reachable|not/i);
  assert.ok(result.files.length > 0, 'fallback still returns files');
});
