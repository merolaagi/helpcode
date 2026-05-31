import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  triageOutput,
  shouldTriage,
  buildTriagePrompt,
} from '../../src/core/triage.js';

// triageOutput uses a local model to compress long command output to its
// key signal, falling back to deterministic truncation when the model is
// unavailable or the output is short. The model call is injected so these
// tests are deterministic and never touch a live Ollama.

const LONG_PYTEST = [
  '============================= test session starts ==============================',
  'platform darwin -- Python 3.11.0, pytest-8.0.0, pluggy-1.0.0',
  'rootdir: /Users/x/project',
  'collected 47 items',
  '',
  ...Array.from({ length: 40 }, (_, i) => `tests/test_mod.py::test_${i} PASSED   [${i}%]`),
  'tests/test_orders.py::test_confirmed_order_sends_email FAILED            [98%]',
  '',
  '=================================== FAILURES ===================================',
  '____________________ test_confirmed_order_sends_email __________________________',
  '    def test_confirmed_order_sends_email():',
  '>       assert any(r and r.startswith("email->") for r in results)',
  'E       AssertionError: order_confirmed should deliver an email notification',
  'tests/test_orders.py:9: AssertionError',
  '========================= 1 failed, 46 passed in 1.23s =========================',
].join('\n');

// ---------- shouldTriage ----------

test('shouldTriage: false for short output', () => {
  assert.equal(shouldTriage('2 passed in 0.01s', { enabled: true }), false);
});

test('shouldTriage: false when ollama disabled even if long', () => {
  assert.equal(shouldTriage(LONG_PYTEST, { enabled: false }), false);
});

test('shouldTriage: true for long output with ollama enabled', () => {
  assert.equal(shouldTriage(LONG_PYTEST, { enabled: true }), true);
});

// ---------- buildTriagePrompt ----------

test('triage prompt: includes the output and asks for the key failure', () => {
  const prompt = buildTriagePrompt(LONG_PYTEST);
  assert.ok(prompt.includes('AssertionError'), 'prompt should contain the raw output');
  assert.match(prompt, /fail|error|key/i, 'prompt should ask for the failure/key info');
});

// ---------- triageOutput: with a fake model ----------

test('triage: returns the model summary when generation succeeds', async () => {
  const fakeGenerate = async () =>
    'test_confirmed_order_sends_email FAILED: order_confirmed should deliver an email notification (tests/test_orders.py:9)';
  const result = await triageOutput(LONG_PYTEST, {
    enabled: true, host: 'h', model: 'm', timeoutMs: 1000,
  }, { generateImpl: fakeGenerate });

  assert.match(result.text, /test_confirmed_order_sends_email FAILED/);
  assert.equal(result.triaged, true);
});

test('triage: falls back to deterministic truncation when model throws', async () => {
  const fakeGenerate = async () => { throw new Error('ollama down'); };
  const result = await triageOutput(LONG_PYTEST, {
    enabled: true, host: 'h', model: 'm', timeoutMs: 1000,
  }, { generateImpl: fakeGenerate });

  // Falls back: not triaged, but still returns usable (truncated) text
  assert.equal(result.triaged, false);
  assert.ok(result.text.length > 0);
  // The deterministic fallback keeps the actual failure line (it's near the end)
  assert.match(result.text, /AssertionError|failed/i);
});

test('triage: falls back when model returns empty', async () => {
  const fakeGenerate = async () => '   ';
  const result = await triageOutput(LONG_PYTEST, {
    enabled: true, host: 'h', model: 'm', timeoutMs: 1000,
  }, { generateImpl: fakeGenerate });
  assert.equal(result.triaged, false);
  assert.ok(result.text.length > 0);
});

test('triage: short output is returned as-is, not sent to the model', async () => {
  let called = false;
  const fakeGenerate = async () => { called = true; return 'should not be called'; };
  const short = '2 passed in 0.01s';
  const result = await triageOutput(short, {
    enabled: true, host: 'h', model: 'm', timeoutMs: 1000,
  }, { generateImpl: fakeGenerate });

  assert.equal(called, false, 'short output should not invoke the model');
  assert.equal(result.text, short);
  assert.equal(result.triaged, false);
});

test('triage: disabled config returns deterministic truncation without model', async () => {
  let called = false;
  const fakeGenerate = async () => { called = true; return 'nope'; };
  const result = await triageOutput(LONG_PYTEST, {
    enabled: false, host: 'h', model: 'm', timeoutMs: 1000,
  }, { generateImpl: fakeGenerate });

  assert.equal(called, false, 'disabled ollama should never call the model');
  assert.equal(result.triaged, false);
  assert.ok(result.text.length > 0);
});

// --- v0.3.3: remote fallback (privacy-gated, supplied by caller) ---

test('triage: falls back to remote when local fails and remoteGenerate provided', async () => {
  const localFails = async () => { throw new Error('ollama down'); };
  const remoteOK = async () => 'remote: the key failure is X';
  const result = await triageOutput(LONG_PYTEST, {
    enabled: true, host: 'h', model: 'm', timeoutMs: 1000,
  }, { generateImpl: localFails, remoteGenerate: remoteOK });
  assert.equal(result.triaged, true);
  assert.equal(result.remote, true);
  assert.match(result.text, /the key failure is X/);
});

test('triage: deterministic truncation when both local and remote fail', async () => {
  const localFails = async () => { throw new Error('down'); };
  const remoteFails = async () => { throw new Error('429'); };
  const result = await triageOutput(LONG_PYTEST, {
    enabled: true, host: 'h', model: 'm', timeoutMs: 1000,
  }, { generateImpl: localFails, remoteGenerate: remoteFails });
  assert.equal(result.triaged, false);
  assert.ok(result.text.length > 0);
});

test('triage: local success means remote is never called', async () => {
  let remoteCalled = false;
  const localOK = async () => 'local summary';
  const remote = async () => { remoteCalled = true; return 'remote'; };
  const result = await triageOutput(LONG_PYTEST, {
    enabled: true, host: 'h', model: 'm', timeoutMs: 1000,
  }, { generateImpl: localOK, remoteGenerate: remote });
  assert.equal(result.triaged, true);
  assert.equal(result.remote, undefined);
  assert.equal(remoteCalled, false, 'remote must not be called when local succeeds');
});
