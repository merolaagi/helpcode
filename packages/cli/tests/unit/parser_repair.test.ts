import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseClaudeResponse,
  repairCorruptedResponse,
} from '../../src/core/parser.js';

// Note: these tests exercise the v0.1.2 auto-repair feature. The repair
// function is exported so it can be unit-tested in isolation, and is also
// invoked automatically by parseClaudeResponse when normal parsing fails.

// ---------- repairCorruptedResponse: unit-level ----------

test('repair: adds ## to bare PLAN/TEST/NOTES headers', () => {
  const corrupted = [
    'PLAN',
    'something to do',
    '',
    'TEST',
    'pytest',
    '',
    'NOTES',
    'a note',
  ].join('\n');
  const repaired = repairCorruptedResponse(corrupted);
  assert.match(repaired, /^## PLAN$/m);
  assert.match(repaired, /^## TEST$/m);
  assert.match(repaired, /^## NOTES$/m);
});

test('repair: adds ## to bare DIFF: <path> headers', () => {
  const corrupted = 'DIFF: src/foo.py\n+a\n';
  const repaired = repairCorruptedResponse(corrupted);
  assert.match(repaired, /^## DIFF: src\/foo\.py$/m);
});

test('repair: splits merged opening diff fence "diff--- a/foo"', () => {
  const corrupted = [
    '## DIFF: src/foo.py',
    'diff--- a/src/foo.py',
    '+++ b/src/foo.py',
    '@@ -1,1 +1,1 @@',
    '-old',
    '+new',
  ].join('\n');
  const repaired = repairCorruptedResponse(corrupted);
  assert.match(repaired, /^```diff$/m, 'should insert opening ```diff fence');
  assert.match(repaired, /^--- a\/src\/foo\.py$/m, 'should leave --- line intact on its own');
  assert.doesNotMatch(repaired, /^diff--- /m, 'merged form should be gone');
});

test('repair: splits merged opening bash fence "bashpytest -q"', () => {
  const corrupted = '## TEST\nbashpytest -q --tb=short\n';
  const repaired = repairCorruptedResponse(corrupted);
  assert.match(repaired, /^```bash$/m);
  assert.match(repaired, /^pytest -q --tb=short$/m);
});

test('repair: splits merged opening python fence', () => {
  const corrupted = 'pythondef foo():\n    pass\n';
  const repaired = repairCorruptedResponse(corrupted);
  assert.match(repaired, /^```python$/m);
  assert.match(repaired, /^def foo\(\):$/m);
});

test('repair: leaves correctly-formatted input unchanged', () => {
  const clean = [
    '## PLAN',
    'a plan',
    '',
    '## DIFF: foo.py',
    '```diff',
    '+x',
    '```',
  ].join('\n');
  const repaired = repairCorruptedResponse(clean);
  assert.equal(repaired.trim(), clean.trim(), 'clean input should not be modified');
});

test('repair: does not match "DIFF:" inside prose', () => {
  // Real-world risk: a NOTES section might mention "DIFF:" in prose.
  // Repair should only fire on lines that look like standalone headers
  // (no leading whitespace, nothing else on the line except the marker).
  const corrupted = '## NOTES\nIf the DIFF: section is missing, retry.\n';
  const repaired = repairCorruptedResponse(corrupted);
  // The DIFF: inside the prose line should NOT have been promoted to a header
  assert.match(repaired, /If the DIFF: section is missing/);
  assert.doesNotMatch(repaired, /^## DIFF: section is missing/m);
});

// ---------- parseClaudeResponse: integration with auto-repair ----------

test('parse: corrupted input round-trips back to clean structure', () => {
  const corrupted = [
    'PLAN',
    'Lowercase email before lookup.',
    '',
    'DIFF: app/auth.py',
    'diff--- a/app/auth.py',
    '+++ b/app/auth.py',
    '@@ -1,3 +1,3 @@',
    ' def login(email, password):',
    '-    stored = USERS.get(email)',
    '+    stored = USERS.get(email.lower())',
    '',
    'TEST',
    'bashpytest tests/test_auth.py',
    '',
    'NOTES',
    'Watch for unicode normalisation.',
  ].join('\n');

  const r = parseClaudeResponse(corrupted);
  assert.equal(r.parseWarning, false, 'should parse successfully after auto-repair');
  assert.equal(r.repairsApplied, true, 'should report that a repair was applied');
  assert.match(r.plan, /Lowercase email/);
  assert.equal(r.diffs.length, 1);
  assert.equal(r.diffs[0].filepath, 'app/auth.py');
  assert.equal(r.testCommand, 'pytest tests/test_auth.py');
  assert.match(r.notes ?? '', /unicode normalisation/);
});

test('parse: clean input does not flag repairsApplied', () => {
  const clean = [
    '## PLAN',
    'a plan',
    '',
    '## DIFF: foo.py',
    '```diff',
    '+x',
    '```',
  ].join('\n');
  const r = parseClaudeResponse(clean);
  assert.equal(r.repairsApplied, false);
  assert.equal(r.parseWarning, false);
});

test('parse: truly unparseable input still warns', () => {
  // Just prose, no section markers at all
  const garbage = 'Hi! Here is some advice. You should consider lowercase emails.';
  const r = parseClaudeResponse(garbage);
  assert.equal(r.parseWarning, true, 'unrepairable input should still warn');
});
