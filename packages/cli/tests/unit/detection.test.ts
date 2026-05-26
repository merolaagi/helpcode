import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectSourceDirs } from '../../src/core/project.js';
import { scoreFile } from '../../src/core/selector.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpcode-detect-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('detectSourceDirs: includes tests/ when it exists', () => {
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.mkdirSync(path.join(tmpDir, 'tests'));
  const dirs = detectSourceDirs(tmpDir);
  assert.ok(dirs.includes('src'), 'src/ should be detected');
  assert.ok(dirs.includes('tests'), 'tests/ should be detected so the selector can include test files');
});

test('detectSourceDirs: includes __tests__ for JS-style projects', () => {
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.mkdirSync(path.join(tmpDir, '__tests__'));
  const dirs = detectSourceDirs(tmpDir);
  assert.ok(dirs.includes('__tests__'));
});

test('detectSourceDirs: includes test/ singular as a fallback', () => {
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.mkdirSync(path.join(tmpDir, 'test'));
  const dirs = detectSourceDirs(tmpDir);
  assert.ok(dirs.includes('test'));
});

test('detectSourceDirs: falls back to "." when nothing detected', () => {
  const dirs = detectSourceDirs(tmpDir);
  assert.deepEqual(dirs, ['.']);
});

test('scoreFile: empty __init__.py scores zero', () => {
  const f = path.join(tmpDir, '__init__.py');
  fs.writeFileSync(f, '');
  assert.equal(scoreFile(f, ['anything']), 0);
});

test('scoreFile: near-empty file (whitespace only) scores zero', () => {
  const f = path.join(tmpDir, 'mostly_empty.py');
  fs.writeFileSync(f, '\n\n  \n');
  assert.equal(scoreFile(f, ['anything']), 0);
});

test('scoreFile: real file with content scores positive', () => {
  const f = path.join(tmpDir, 'analyze.py');
  fs.writeFileSync(f, 'def analyze(data):\n    return data.mean()\n');
  // Should match on filename + recency at minimum
  const score = scoreFile(f, ['analyze']);
  assert.ok(score > 0, `expected positive score, got ${score}`);
});
