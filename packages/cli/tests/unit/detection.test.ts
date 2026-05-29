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

test('detectSourceDirs: finds dirs that contain source files', () => {
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.writeFileSync(path.join(tmpDir, 'src', 'main.py'), 'print(1)\n');
  fs.mkdirSync(path.join(tmpDir, 'tests'));
  fs.writeFileSync(path.join(tmpDir, 'tests', 'test_main.py'), 'def test(): pass\n');
  const dirs = detectSourceDirs(tmpDir);
  assert.ok(dirs.includes('src'), 'src/ with a .py file should be detected');
  assert.ok(dirs.includes('tests'), 'tests/ with a .py file should be detected');
});

test('detectSourceDirs: finds NON-STANDARD dir names (regression for shop/ bug)', () => {
  // The v0.2 dogfood found that a Django-style app dir like shop/ was missed
  // because detection used a hardcoded name list. Content-based detection
  // must pick up any dir containing source, regardless of its name.
  fs.mkdirSync(path.join(tmpDir, 'shop'));
  fs.writeFileSync(path.join(tmpDir, 'shop', 'orders.py'), 'class Order: pass\n');
  fs.mkdirSync(path.join(tmpDir, 'billing'));
  fs.writeFileSync(path.join(tmpDir, 'billing', 'invoice.py'), 'def bill(): pass\n');
  const dirs = detectSourceDirs(tmpDir);
  assert.ok(dirs.includes('shop'), 'shop/ should be detected by content, not name');
  assert.ok(dirs.includes('billing'), 'billing/ should be detected by content');
});

test('detectSourceDirs: ignores dirs with no source files', () => {
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.writeFileSync(path.join(tmpDir, 'src', 'main.py'), 'print(1)\n');
  fs.mkdirSync(path.join(tmpDir, 'docs'));
  fs.writeFileSync(path.join(tmpDir, 'docs', 'readme.md'), '# docs\n');
  const dirs = detectSourceDirs(tmpDir);
  assert.ok(dirs.includes('src'));
  assert.ok(!dirs.includes('docs'), 'docs/ (no source files) should be skipped');
});

test('detectSourceDirs: skips node_modules and friends', () => {
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export {}\n');
  fs.mkdirSync(path.join(tmpDir, 'node_modules'));
  fs.mkdirSync(path.join(tmpDir, 'node_modules', 'pkg'));
  fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg', 'i.js'), 'x\n');
  const dirs = detectSourceDirs(tmpDir);
  assert.ok(dirs.includes('src'));
  assert.ok(!dirs.includes('node_modules'), 'node_modules must never be a source dir');
});

test('detectSourceDirs: includes root "." when source files sit at top level', () => {
  fs.writeFileSync(path.join(tmpDir, 'app.py'), 'print(1)\n');
  const dirs = detectSourceDirs(tmpDir);
  assert.ok(dirs.includes('.'), 'root should be included when it has source files directly');
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
