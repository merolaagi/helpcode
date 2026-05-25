import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateLines, extractTraceback } from '../../src/lib/compress.js';

test('truncate: short text passes through unchanged', () => {
  const t = 'a\nb\nc';
  assert.equal(truncateLines(t, 10), t);
});

test('truncate: long text gets head + tail with elision marker', () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  const out = truncateLines(lines, 9);
  assert.ok(out.includes('omitted'));
  assert.ok(out.includes('line 0'));
  assert.ok(out.includes('line 99'));
});

test('extractTraceback: pulls just the traceback', () => {
  const stderr = 'random noise\nmore noise\nTraceback (most recent call last):\n  File "x.py", line 1\nValueError: bad';
  const out = extractTraceback(stderr);
  assert.ok(out.startsWith('Traceback'));
  assert.ok(out.includes('ValueError'));
  assert.ok(!out.includes('random noise'));
});

test('extractTraceback: no traceback returns trimmed stderr', () => {
  const out = extractTraceback('some warning text');
  assert.equal(out, 'some warning text');
});
