import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadGeminiKey } from '../../src/core/keys.js';

// The key loader resolves a Gemini API key from, in precedence order:
//   1. the GEMINI_API_KEY environment variable (nothing on disk)
//   2. .helpcode/keys.json  { "gemini": "..." }
// Returns null if neither is present. Never throws.

function withTempProject(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpcode-keys-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('env var takes precedence over keys.json', () => {
  withTempProject((dir) => {
    fs.mkdirSync(path.join(dir, '.helpcode'));
    fs.writeFileSync(path.join(dir, '.helpcode', 'keys.json'),
      JSON.stringify({ gemini: 'FROM_FILE' }));
    const key = loadGeminiKey(dir, { GEMINI_API_KEY: 'FROM_ENV' });
    assert.equal(key, 'FROM_ENV');
  });
});

test('falls back to keys.json when env var absent', () => {
  withTempProject((dir) => {
    fs.mkdirSync(path.join(dir, '.helpcode'));
    fs.writeFileSync(path.join(dir, '.helpcode', 'keys.json'),
      JSON.stringify({ gemini: 'FROM_FILE' }));
    const key = loadGeminiKey(dir, {});
    assert.equal(key, 'FROM_FILE');
  });
});

test('returns null when neither source has a key', () => {
  withTempProject((dir) => {
    const key = loadGeminiKey(dir, {});
    assert.equal(key, null);
  });
});

test('returns null (not throw) on malformed keys.json', () => {
  withTempProject((dir) => {
    fs.mkdirSync(path.join(dir, '.helpcode'));
    fs.writeFileSync(path.join(dir, '.helpcode', 'keys.json'), 'not json{');
    const key = loadGeminiKey(dir, {});
    assert.equal(key, null);
  });
});

test('ignores empty-string env var, falls through to file', () => {
  withTempProject((dir) => {
    fs.mkdirSync(path.join(dir, '.helpcode'));
    fs.writeFileSync(path.join(dir, '.helpcode', 'keys.json'),
      JSON.stringify({ gemini: 'FROM_FILE' }));
    const key = loadGeminiKey(dir, { GEMINI_API_KEY: '' });
    assert.equal(key, 'FROM_FILE');
  });
});

test('keys.json without a gemini field yields null', () => {
  withTempProject((dir) => {
    fs.mkdirSync(path.join(dir, '.helpcode'));
    fs.writeFileSync(path.join(dir, '.helpcode', 'keys.json'),
      JSON.stringify({ other: 'x' }));
    const key = loadGeminiKey(dir, {});
    assert.equal(key, null);
  });
});
