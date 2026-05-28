import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSelectionPrompt,
  parseSelectionResponse,
  type Candidate,
} from '../../src/core/llmSelector.js';

// llmSelector turns a task + candidate files into a reasoned selection,
// using the local model. These tests cover the deterministic pieces:
// prompt construction and response parsing (including the critical
// hallucination guard). The actual model call is exercised separately
// via the ollama client tests and manual dogfooding.

const CANDIDATES: Candidate[] = [
  { path: 'app/auth.py', signature: 'def login, def logout, def check_password' },
  { path: 'app/session.py', signature: 'class Session, def create, def validate' },
  { path: 'app/models.py', signature: 'class User, class Item' },
  { path: 'app/orders.py', signature: 'def place_order, def cancel' },
];

// ---------- buildSelectionPrompt ----------

test('prompt: includes the task and all candidate paths', () => {
  const prompt = buildSelectionPrompt('fix login bug', CANDIDATES, 6);
  assert.match(prompt, /fix login bug/);
  for (const c of CANDIDATES) {
    assert.ok(prompt.includes(c.path), `prompt should list ${c.path}`);
  }
});

test('prompt: states the PATH | reason format and the count', () => {
  const prompt = buildSelectionPrompt('do thing', CANDIDATES, 5);
  assert.match(prompt, /PATH \| /);
  assert.match(prompt, /\b5\b/); // the requested count appears
});

// ---------- parseSelectionResponse: happy path ----------

test('parse: extracts valid paths with reasons', () => {
  const response = [
    'app/auth.py | contains the login function',
    'app/session.py | session creation normalizes email',
  ].join('\n');
  const result = parseSelectionResponse(response, CANDIDATES);
  assert.equal(result.length, 2);
  assert.equal(result[0].path, 'app/auth.py');
  assert.match(result[0].reason, /login function/);
  assert.equal(result[1].path, 'app/session.py');
});

test('parse: preserves model ordering (most relevant first)', () => {
  const response = [
    'app/models.py | user model holds email',
    'app/auth.py | login logic',
  ].join('\n');
  const result = parseSelectionResponse(response, CANDIDATES);
  assert.equal(result[0].path, 'app/models.py');
  assert.equal(result[1].path, 'app/auth.py');
});

// ---------- parseSelectionResponse: the hallucination guard ----------

test('parse: rejects hallucinated paths not in the candidate set', () => {
  const response = [
    'app/auth.py | real file',
    'app/THIS_DOES_NOT_EXIST.py | hallucinated',
    'src/imaginary/ghost.py | also fake',
  ].join('\n');
  const result = parseSelectionResponse(response, CANDIDATES);
  assert.equal(result.length, 1, 'only the real path should survive');
  assert.equal(result[0].path, 'app/auth.py');
});

test('parse: returns empty when ALL paths are hallucinated', () => {
  const response = [
    'totally/made/up.py | nope',
    'fantasy.py | nope',
  ].join('\n');
  const result = parseSelectionResponse(response, CANDIDATES);
  assert.equal(result.length, 0,
    'all-hallucinated response yields nothing, so caller falls back to heuristic');
});

// ---------- parseSelectionResponse: messy real-world model output ----------

test('parse: tolerates prose preamble and trailing chatter', () => {
  const response = [
    'Sure! Here are the most relevant files:',
    '',
    'app/auth.py | login function lives here',
    'app/models.py | user email field',
    '',
    'Let me know if you need more detail.',
  ].join('\n');
  const result = parseSelectionResponse(response, CANDIDATES);
  assert.equal(result.length, 2);
  assert.equal(result[0].path, 'app/auth.py');
  assert.equal(result[1].path, 'app/models.py');
});

test('parse: tolerates leading list markers like "- " or "1. "', () => {
  const response = [
    '- app/auth.py | login',
    '2. app/session.py | session',
  ].join('\n');
  const result = parseSelectionResponse(response, CANDIDATES);
  assert.equal(result.length, 2);
  assert.equal(result[0].path, 'app/auth.py');
  assert.equal(result[1].path, 'app/session.py');
});

test('parse: tolerates backtick-wrapped paths', () => {
  const response = '`app/auth.py` | the login handler';
  const result = parseSelectionResponse(response, CANDIDATES);
  assert.equal(result.length, 1);
  assert.equal(result[0].path, 'app/auth.py');
});

test('parse: handles a path with no reason (missing pipe)', () => {
  const response = [
    'app/auth.py',                       // no "| reason"
    'app/models.py | has the model',
  ].join('\n');
  const result = parseSelectionResponse(response, CANDIDATES);
  // The bare path still counts if it matches a candidate; reason defaults
  assert.equal(result.length, 2);
  assert.equal(result[0].path, 'app/auth.py');
  assert.equal(result[0].reason, '');
  assert.equal(result[1].path, 'app/models.py');
});

test('parse: dedupes if the model lists the same file twice', () => {
  const response = [
    'app/auth.py | first mention',
    'app/auth.py | second mention',
  ].join('\n');
  const result = parseSelectionResponse(response, CANDIDATES);
  assert.equal(result.length, 1);
});

test('parse: empty response yields empty selection', () => {
  const result = parseSelectionResponse('', CANDIDATES);
  assert.equal(result.length, 0);
});
