import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRunFailure } from '../../src/lib/runclass.js';

// classifyRunFailure distinguishes "the test runner couldn't start"
// (a setup problem — installing something, fixing PATH) from "tests ran
// and failed" (a real failure to send back to Claude).

test('classify: pytest not found (sh) → setup', () => {
  const r = classifyRunFailure({
    exitCode: 127,
    stdout: '',
    stderr: '/bin/sh: pytest: command not found',
    durationMs: 10,
    timedOut: false,
  });
  assert.equal(r.kind, 'setup');
  assert.match(r.message, /pytest/);
});

test('classify: command not found generic → setup', () => {
  const r = classifyRunFailure({
    exitCode: 127,
    stdout: '',
    stderr: 'bash: jest: command not found',
    durationMs: 5,
    timedOut: false,
  });
  assert.equal(r.kind, 'setup');
});

test('classify: windows "not recognized" → setup', () => {
  const r = classifyRunFailure({
    exitCode: 1,
    stdout: '',
    stderr: "'pytest' is not recognized as an internal or external command,\noperable program or batch file.",
    durationMs: 8,
    timedOut: false,
  });
  assert.equal(r.kind, 'setup');
});

test('classify: python "No module named pytest" → setup', () => {
  const r = classifyRunFailure({
    exitCode: 1,
    stdout: '',
    stderr: '/usr/bin/python3: No module named pytest',
    durationMs: 30,
    timedOut: false,
  });
  assert.equal(r.kind, 'setup');
});

test('classify: node "Cannot find module" for a runner → setup', () => {
  const r = classifyRunFailure({
    exitCode: 1,
    stdout: '',
    stderr: "Error: Cannot find module 'jest'",
    durationMs: 40,
    timedOut: false,
  });
  assert.equal(r.kind, 'setup');
});

test('classify: real test failure → test', () => {
  const r = classifyRunFailure({
    exitCode: 1,
    stdout: '..F\n1 failed, 2 passed in 0.03s\nFAILED tests/test_auth.py::test_x - AssertionError',
    stderr: '',
    durationMs: 120,
    timedOut: false,
  });
  assert.equal(r.kind, 'test');
});

test('classify: timeout → setup-ish (its own message)', () => {
  const r = classifyRunFailure({
    exitCode: 124,
    stdout: '',
    stderr: 'TIMEOUT after 120s',
    durationMs: 120000,
    timedOut: true,
  });
  assert.equal(r.kind, 'timeout');
});

test('classify: exit 0 → not a failure (test kind, caller should not call this)', () => {
  // We never call classifyRunFailure on success, but it should be safe:
  // exit 0 with output is treated as a test outcome, not a setup error.
  const r = classifyRunFailure({
    exitCode: 0,
    stdout: '2 passed',
    stderr: '',
    durationMs: 10,
    timedOut: false,
  });
  assert.equal(r.kind, 'test');
});
