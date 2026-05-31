import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePrivacy, computeAvailableWorkers } from '../../src/core/cockpitContext.js';
import { ProjectConfig, QuotaState } from '../../src/types.js';

function cfg(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    root: '/x',
    language: 'python',
    framework: 'Flask',
    testCommand: 'pytest',
    ollama: { enabled: true, model: 'qwen2.5-coder:7b', host: 'http://localhost:11434', timeoutMs: 2000 },
    ...over,
  } as ProjectConfig;
}

// --- computePrivacy (gaps #2 + #4) ---

test('privacy: no key, no opt-in => local-only', () => {
  const p = computePrivacy(cfg(), {});
  assert.equal(p.tier, 'local-only');
  assert.equal(p.preferredProvider, null);
});

test('privacy: key present, no opt-in => decomposition-only', () => {
  const p = computePrivacy(cfg(), { GEMINI_API_KEY: 'g' });
  assert.equal(p.tier, 'decomposition-only');
});

test('privacy: allowRemoteCode on => code-allowed', () => {
  const p = computePrivacy(cfg({ remote: { allowRemoteCode: true } }), { GEMINI_API_KEY: 'g' });
  assert.equal(p.tier, 'code-allowed');
});

test('privacy: allowRemoteCode on but no key => still local-only (nothing can leave)', () => {
  const p = computePrivacy(cfg({ remote: { allowRemoteCode: true } }), {});
  assert.equal(p.tier, 'local-only');
});

test('privacy: surfaces preferred provider (gap #4)', () => {
  const p = computePrivacy(cfg({ remote: { allowRemoteCode: false, provider: 'grok' } }), { XAI_API_KEY: 'x' });
  assert.equal(p.preferredProvider, 'grok');
});

// --- computeAvailableWorkers (gap #3) ---

test('available: always includes local when ollama enabled', () => {
  const ws = computeAvailableWorkers(cfg(), {}, emptyQuota());
  const local = ws.find(w => w.kind === 'local');
  assert.ok(local);
  assert.equal(local!.available, true);
});

test('available: lists every remote provider, marking which have keys', () => {
  const ws = computeAvailableWorkers(cfg(), { GEMINI_API_KEY: 'g' }, emptyQuota());
  const gem = ws.find(w => w.id === 'gemini');
  const grok = ws.find(w => w.id === 'grok');
  assert.ok(gem && gem.available, 'gemini has a key');
  assert.ok(grok && !grok.available, 'grok has no key');
  assert.match(grok!.note, /no key/i);
});

test('available: marks a throttled provider', () => {
  const q: QuotaState = { providers: { grok: { day: today(), count: 3, throttledUntil: future() } } };
  const ws = computeAvailableWorkers(cfg(), { XAI_API_KEY: 'x' }, q);
  const grok = ws.find(w => w.id === 'grok');
  assert.equal(grok!.throttled, true);
});

test('available: includes all three remote providers even when idle', () => {
  const ws = computeAvailableWorkers(cfg(), {}, emptyQuota());
  const ids = ws.map(w => w.id);
  for (const id of ['gemini', 'grok', 'openai']) assert.ok(ids.includes(id), `${id} listed`);
});

function emptyQuota(): QuotaState { return { providers: {} }; }
function today(): string { return new Date().toISOString().slice(0, 10); }
function future(): string { return new Date(Date.now() + 3600_000).toISOString(); }
