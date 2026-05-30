import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDecompositionPrompt,
  parseDecomposition,
  decomposeTask,
} from '../../src/core/decompose.js';

// Decomposition asks the local model to break a big task into ordered, focused
// sub-steps for human approval. It NEVER acts on them autonomously. The model
// call is injected so these tests are deterministic and never touch Ollama.

// ---------- buildDecompositionPrompt ----------

test('prompt: includes the task and asks for an ordered numbered list', () => {
  const p = buildDecompositionPrompt('add user authentication');
  assert.match(p, /add user authentication/);
  assert.match(p, /step|ordered|numbered|break/i);
});

// ---------- parseDecomposition ----------

test('parse: extracts a numbered list', () => {
  const resp = [
    '1. Add the User model with a password hash field',
    '2. Implement the login endpoint',
    '3. Implement logout and session teardown',
  ].join('\n');
  const steps = parseDecomposition(resp);
  assert.equal(steps.length, 3);
  assert.equal(steps[0], 'Add the User model with a password hash field');
  assert.equal(steps[2], 'Implement logout and session teardown');
});

test('parse: tolerates prose preamble and trailing chatter', () => {
  const resp = [
    'Sure, here is a breakdown:',
    '',
    '1. First step',
    '2. Second step',
    '',
    'Let me know if you want more detail.',
  ].join('\n');
  const steps = parseDecomposition(resp);
  assert.deepEqual(steps, ['First step', 'Second step']);
});

test('parse: tolerates ) and . and - markers', () => {
  const resp = '1) alpha\n2) beta\n- gamma';
  const steps = parseDecomposition(resp);
  assert.deepEqual(steps, ['alpha', 'beta', 'gamma']);
});

test('parse: strips bold/markdown emphasis around step text', () => {
  const resp = '1. **Bold step** here\n2. plain step';
  const steps = parseDecomposition(resp);
  assert.equal(steps[0], 'Bold step here');
});

test('parse: empty or unparseable response yields no steps', () => {
  assert.deepEqual(parseDecomposition(''), []);
  assert.deepEqual(parseDecomposition('I cannot help with that.'), []);
});

test('parse: collapses a single step (no real decomposition) to one item', () => {
  const resp = '1. Just do the whole thing';
  const steps = parseDecomposition(resp);
  assert.equal(steps.length, 1);
});

// ---------- decomposeTask (integration with injected model) ----------

test('decompose: returns ordered steps when the model succeeds', async () => {
  const fake = async () => '1. step one\n2. step two\n3. step three';
  const result = await decomposeTask('big task', {
    enabled: true, host: 'h', model: 'm', timeoutMs: 1000,
  }, { generateImpl: fake });
  assert.equal(result.ok, true);
  assert.deepEqual(result.steps, ['step one', 'step two', 'step three']);
});

test('decompose: ok=false when ollama disabled (no fallback for decomposition)', async () => {
  let called = false;
  const fake = async () => { called = true; return 'x'; };
  const result = await decomposeTask('big task', {
    enabled: false, host: 'h', model: 'm', timeoutMs: 1000,
  }, { generateImpl: fake });
  assert.equal(result.ok, false);
  assert.equal(called, false, 'disabled ollama must not call the model');
  assert.equal(result.steps.length, 0);
});

test('decompose: ok=false when the model throws (graceful, no steps)', async () => {
  const fake = async () => { throw new Error('ollama down'); };
  const result = await decomposeTask('big task', {
    enabled: true, host: 'h', model: 'm', timeoutMs: 1000,
  }, { generateImpl: fake });
  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 0);
  assert.match(result.reason, /down|fail|error/i);
});

test('decompose: ok=false when model returns only one step (nothing to decompose)', async () => {
  const fake = async () => '1. the whole task as one step';
  const result = await decomposeTask('small task', {
    enabled: true, host: 'h', model: 'm', timeoutMs: 1000,
  }, { generateImpl: fake });
  // A single step means decomposition added no value; signal that honestly.
  assert.equal(result.ok, false);
  assert.match(result.reason, /single|one step|not.*decompos/i);
});
