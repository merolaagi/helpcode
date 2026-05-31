import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS,
  getProvider,
  openaiCompatGenerate,
  OpenAICompatError,
  parseChatCompletion,
} from '../../src/core/providers.js';

// One shared OpenAI-compatible client serves Kimi, Grok, and ChatGPT — they
// differ only in base URL, model, env var, and policy note (data, not code).
// Gemini stays separate (different REST shape, in core/gemini.ts).
// fetch is injected so CI never touches a live API.

// ---------- provider registry ----------

test('registry: includes kimi, grok, openai with distinct config', () => {
  for (const id of ['kimi', 'grok', 'openai']) {
    const p = getProvider(id);
    assert.ok(p, `${id} should be registered`);
    assert.ok(p!.baseUrl.startsWith('https://'), `${id} has a base url`);
    assert.ok(p!.defaultModel.length > 0, `${id} has a default model`);
    assert.ok(p!.envVar.endsWith('_API_KEY'), `${id} has an env var`);
  }
});

test('registry: each provider has a distinct base url and env var', () => {
  const urls = new Set(PROVIDERS.map(p => p.baseUrl));
  const envs = new Set(PROVIDERS.map(p => p.envVar));
  assert.equal(urls.size, PROVIDERS.length, 'base urls are unique');
  assert.equal(envs.size, PROVIDERS.length, 'env vars are unique');
});

test('registry: getProvider returns null for unknown id', () => {
  assert.equal(getProvider('nope'), null);
});

test('registry: every provider carries a free-tier training-policy note', () => {
  for (const p of PROVIDERS) {
    assert.ok(typeof p.freeTierNote === 'string' && p.freeTierNote.length > 0,
      `${p.id} should document its free-tier data policy`);
  }
});

// ---------- parseChatCompletion ----------

const OK_BODY = {
  choices: [{ message: { role: 'assistant', content: '1. step one\n2. step two' } }],
};

test('parse: extracts assistant message content', () => {
  assert.equal(parseChatCompletion(OK_BODY), '1. step one\n2. step two');
});

test('parse: empty/missing choices yields empty string', () => {
  assert.equal(parseChatCompletion({ choices: [] }), '');
  assert.equal(parseChatCompletion({}), '');
});

// ---------- openaiCompatGenerate ----------

function fakeFetch(status: number, body: unknown) {
  return async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

test('generate: returns content on 200', async () => {
  const out = await openaiCompatGenerate('hi', {
    baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'K', timeoutMs: 1000,
  }, { fetchImpl: fakeFetch(200, OK_BODY) });
  assert.equal(out, '1. step one\n2. step two');
});

test('generate: 429 throws OpenAICompatError marked quota', async () => {
  await assert.rejects(
    () => openaiCompatGenerate('hi', { baseUrl: 'https://x/v1', model: 'm', apiKey: 'K', timeoutMs: 1000 },
      { fetchImpl: fakeFetch(429, { error: { message: 'rate limit' } }) }),
    (e: unknown) => e instanceof OpenAICompatError && (e as OpenAICompatError).quotaExhausted,
  );
});

test('generate: 401 auth error throws (not quota)', async () => {
  await assert.rejects(
    () => openaiCompatGenerate('hi', { baseUrl: 'https://x/v1', model: 'm', apiKey: 'K', timeoutMs: 1000 },
      { fetchImpl: fakeFetch(401, { error: { message: 'bad key' } }) }),
    (e: unknown) => e instanceof OpenAICompatError && !(e as OpenAICompatError).quotaExhausted,
  );
});

test('generate: empty content throws', async () => {
  await assert.rejects(
    () => openaiCompatGenerate('hi', { baseUrl: 'https://x/v1', model: 'm', apiKey: 'K', timeoutMs: 1000 },
      { fetchImpl: fakeFetch(200, { choices: [] }) }),
    (e: unknown) => e instanceof OpenAICompatError,
  );
});

test('generate: network throw becomes OpenAICompatError', async () => {
  await assert.rejects(
    () => openaiCompatGenerate('hi', { baseUrl: 'https://x/v1', model: 'm', apiKey: 'K', timeoutMs: 1000 },
      { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }),
    (e: unknown) => e instanceof OpenAICompatError,
  );
});
