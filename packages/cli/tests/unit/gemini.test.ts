import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  geminiGenerate,
  GeminiError,
  buildGeminiUrl,
  parseGeminiResponse,
} from '../../src/core/gemini.js';

// The Gemini client mirrors the Ollama client's discipline: zero deps, injected
// fetch (CI never hits the live API), every failure becomes a typed GeminiError
// so callers can fall back. These tests use a fake fetch.

// Build a fake fetch returning a given status + JSON body.
function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// A well-formed Gemini generateContent success body.
const OK_BODY = {
  candidates: [
    { content: { parts: [{ text: '1. step one\n2. step two' }] } },
  ],
};

// ---------- buildGeminiUrl ----------

test('buildGeminiUrl: includes model and the v1beta generateContent path', () => {
  const url = buildGeminiUrl('gemini-2.5-flash-lite', 'KEY');
  assert.match(url, /gemini-2\.5-flash-lite/);
  assert.match(url, /generateContent/);
});

test('buildGeminiUrl: carries the API key as a query param', () => {
  const url = buildGeminiUrl('m', 'SECRET');
  assert.match(url, /key=SECRET/);
});

// ---------- parseGeminiResponse ----------

test('parse: extracts text from the first candidate', () => {
  assert.equal(parseGeminiResponse(OK_BODY), '1. step one\n2. step two');
});

test('parse: concatenates multiple parts', () => {
  const body = { candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] };
  assert.equal(parseGeminiResponse(body), 'ab');
});

test('parse: empty candidates yields empty string', () => {
  assert.equal(parseGeminiResponse({ candidates: [] }), '');
  assert.equal(parseGeminiResponse({}), '');
});

// ---------- geminiGenerate: success ----------

test('generate: returns text on a 200 success', async () => {
  const out = await geminiGenerate('hi', {
    apiKey: 'KEY', model: 'gemini-2.5-flash-lite', timeoutMs: 1000,
  }, { fetchImpl: fakeFetch(200, OK_BODY) });
  assert.equal(out, '1. step one\n2. step two');
});

// ---------- geminiGenerate: error paths all become GeminiError ----------

test('generate: 429 RESOURCE_EXHAUSTED throws a GeminiError marked quota', async () => {
  const body = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } };
  await assert.rejects(
    () => geminiGenerate('hi', { apiKey: 'K', model: 'm', timeoutMs: 1000 },
      { fetchImpl: fakeFetch(429, body) }),
    (e: unknown) => {
      assert.ok(e instanceof GeminiError);
      assert.equal((e as GeminiError).quotaExhausted, true);
      return true;
    },
  );
});

test('generate: 401/403 auth error throws GeminiError (not quota)', async () => {
  const body = { error: { code: 403, status: 'PERMISSION_DENIED', message: 'bad key' } };
  await assert.rejects(
    () => geminiGenerate('hi', { apiKey: 'K', model: 'm', timeoutMs: 1000 },
      { fetchImpl: fakeFetch(403, body) }),
    (e: unknown) => {
      assert.ok(e instanceof GeminiError);
      assert.equal((e as GeminiError).quotaExhausted, false);
      return true;
    },
  );
});

test('generate: malformed JSON body throws GeminiError', async () => {
  const badFetch = async () => new Response('not json', { status: 200 });
  await assert.rejects(
    () => geminiGenerate('hi', { apiKey: 'K', model: 'm', timeoutMs: 1000 },
      { fetchImpl: badFetch }),
    (e: unknown) => e instanceof GeminiError,
  );
});

test('generate: empty text in a 200 throws GeminiError (nothing usable)', async () => {
  await assert.rejects(
    () => geminiGenerate('hi', { apiKey: 'K', model: 'm', timeoutMs: 1000 },
      { fetchImpl: fakeFetch(200, { candidates: [] }) }),
    (e: unknown) => e instanceof GeminiError,
  );
});

test('generate: network throw becomes GeminiError', async () => {
  const throwingFetch = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    () => geminiGenerate('hi', { apiKey: 'K', model: 'm', timeoutMs: 1000 },
      { fetchImpl: throwingFetch }),
    (e: unknown) => e instanceof GeminiError,
  );
});
