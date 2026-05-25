import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { applyLinePatch } from '../../src/core/patcher.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpcode-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('patcher: applies simple change', () => {
  const file = path.join(tmpDir, 'a.py');
  fs.writeFileSync(file, 'a\nb\nc\n');
  const result = applyLinePatch(file, [
    ' a',
    '-b',
    '+B',
    ' c',
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.created, false);
  assert.equal(fs.readFileSync(file, 'utf-8'), 'a\nB\nc\n');
});

test('patcher: creates new file when none exists', () => {
  const file = path.join(tmpDir, 'sub', 'new.py');
  const result = applyLinePatch(file, [
    '+hello',
    '+world',
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(fs.readFileSync(file, 'utf-8'), 'hello\nworld');
});

test('patcher: throws when context does not match', () => {
  const file = path.join(tmpDir, 'a.py');
  fs.writeFileSync(file, 'a\nb\nc\n');
  assert.throws(
    () => applyLinePatch(file, [
      ' DOES_NOT_EXIST',
      '-b',
      '+B',
    ]),
    /Patch does not apply cleanly/,
  );
});

test('patcher: throws on missing existing file', () => {
  assert.throws(
    () => applyLinePatch(path.join(tmpDir, 'nope.py'), [
      ' real_context',
      '-old',
      '+new',
    ]),
    /File not found/,
  );
});

test('patcher: handles pure-add patch with context', () => {
  const file = path.join(tmpDir, 'a.py');
  fs.writeFileSync(file, 'def foo():\n    pass\n');
  const result = applyLinePatch(file, [
    ' def foo():',
    '+    # added',
    '     pass',
  ]);
  assert.equal(result.ok, true);
  const content = fs.readFileSync(file, 'utf-8');
  assert.ok(content.includes('# added'));
});
