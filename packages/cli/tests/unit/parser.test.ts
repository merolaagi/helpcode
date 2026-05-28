import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeResponse, validateParsedResponse } from '../../src/core/parser.js';

test('parser: full structured response', () => {
  const raw = [
    '## PLAN',
    'Lowercase the email before lookup.',
    '',
    '## DIFF: app/auth.py',
    '```diff',
    ' def login(email, password):',
    '-    stored = USERS.get(email)',
    '+    stored = USERS.get(email.lower())',
    '     if stored is None:',
    '```',
    '',
    '## TEST',
    '```bash',
    'pytest tests/test_auth.py -v',
    '```',
    '',
    '## NOTES',
    'Watch for unicode normalisation if internationalising.',
  ].join('\n');

  const r = parseClaudeResponse(raw);
  assert.equal(r.plan, 'Lowercase the email before lookup.');
  assert.equal(r.diffs.length, 1);
  assert.equal(r.diffs[0].filepath, 'app/auth.py');
  assert.equal(r.testCommand, 'pytest tests/test_auth.py -v');
  assert.equal(r.notes, 'Watch for unicode normalisation if internationalising.');
  assert.equal(r.parseWarning, false);
});

test('parser: multiple diffs', () => {
  const raw = [
    '## PLAN',
    'Refactor across two files.',
    '## DIFF: a.py',
    '```diff',
    '+new line a',
    '```',
    '## DIFF: b.py',
    '```diff',
    '+new line b',
    '```',
  ].join('\n');
  const r = parseClaudeResponse(raw);
  assert.equal(r.diffs.length, 2);
  assert.equal(r.diffs[0].filepath, 'a.py');
  assert.equal(r.diffs[1].filepath, 'b.py');
});

test('parser: malformed response sets parseWarning', () => {
  const raw = 'Here is some code:\n\n```python\nprint("hi")\n```\n\nLet me know what you think.';
  const r = parseClaudeResponse(raw);
  assert.equal(r.parseWarning, true);
});

test('parser: only PLAN, no diffs', () => {
  const raw = '## PLAN\nI think you should reconsider the approach.\n';
  const r = parseClaudeResponse(raw);
  assert.equal(r.plan, 'I think you should reconsider the approach.');
  assert.equal(r.diffs.length, 0);
  assert.equal(r.parseWarning, false);
});

test('validate: catches missing plan', () => {
  const issues = validateParsedResponse({
    plan: '',
    diffs: [{ filepath: 'a.py', patchLines: ['+x'] }],
    testCommand: null,
    notes: null,
    parseWarning: false,
    repairsApplied: false,
  });
  assert.ok(issues.some(i => i.includes('PLAN')));
});

test('validate: catches empty diff', () => {
  const issues = validateParsedResponse({
    plan: 'do something',
    diffs: [{ filepath: 'a.py', patchLines: [] }],
    testCommand: null,
    notes: null,
    parseWarning: false,
    repairsApplied: false,
  });
  assert.ok(issues.some(i => i.includes('Empty diff')));
});
