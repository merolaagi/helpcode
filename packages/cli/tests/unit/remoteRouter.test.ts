import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstAvailableProvider } from '../../src/core/remoteRouter.js';

// firstAvailableProvider scans configured providers (Gemini + OpenAI-compatible
// ones) and returns the first that has a key, so plan/selection can route
// remote work. Env is injected for testing.

test('returns null when no provider has a key', () => {
  const p = firstAvailableProvider({});
  assert.equal(p, null);
});

test('finds gemini when only GEMINI_API_KEY is set', () => {
  const p = firstAvailableProvider({ GEMINI_API_KEY: 'g' });
  assert.ok(p);
  assert.equal(p!.id, 'gemini');
  assert.equal(p!.key, 'g');
});

test('finds grok when only XAI_API_KEY is set', () => {
  const p = firstAvailableProvider({ XAI_API_KEY: 'x' });
  assert.ok(p);
  assert.equal(p!.id, 'grok');
});

test('finds openai when only OPENAI_API_KEY is set', () => {
  const p = firstAvailableProvider({ OPENAI_API_KEY: 'o' });
  assert.ok(p);
  assert.equal(p!.id, 'openai');
});

test('prefers gemini when multiple are set (stable priority)', () => {
  const p = firstAvailableProvider({ GEMINI_API_KEY: 'g', XAI_API_KEY: 'x', OPENAI_API_KEY: 'o' });
  assert.equal(p!.id, 'gemini');
});

test('empty-string keys are ignored', () => {
  const p = firstAvailableProvider({ GEMINI_API_KEY: '', XAI_API_KEY: 'x' });
  assert.equal(p!.id, 'grok');
});

test('a preferred id, if available, wins over priority order', () => {
  const p = firstAvailableProvider(
    { GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' },
    'openai',
  );
  assert.equal(p!.id, 'openai');
});

test('preferred id that has no key falls back to priority order', () => {
  const p = firstAvailableProvider({ GEMINI_API_KEY: 'g' }, 'grok');
  assert.equal(p!.id, 'gemini');
});
