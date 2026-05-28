import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOllamaReachable,
  listModels,
  generate,
  OllamaError,
} from '../../src/core/ollama.js';

// All tests inject a fake fetch so they never touch a live Ollama.
// CI must pass with no Ollama installed.

const HOST = 'http://localhost:11434';

/** Build a fake fetch that returns a given response (or throws). */
function fakeFetch(handler: (url: string, init?: any) => Promise<Response> | Response) {
  return (url: any, init?: any) => Promise.resolve(handler(String(url), init));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------- isOllamaReachable ----------

test('isOllamaReachable: true when /api/tags responds 200', async () => {
  const f = fakeFetch(url => {
    assert.match(url, /\/api\/tags$/);
    return jsonResponse({ models: [] });
  });
  const ok = await isOllamaReachable(HOST, { fetchImpl: f });
  assert.equal(ok, true);
});

test('isOllamaReachable: false when fetch throws (Ollama not running)', async () => {
  const f = () => Promise.reject(new Error('ECONNREFUSED'));
  const ok = await isOllamaReachable(HOST, { fetchImpl: f });
  assert.equal(ok, false);
});

test('isOllamaReachable: false on non-200', async () => {
  const f = fakeFetch(() => new Response('nope', { status: 500 }));
  const ok = await isOllamaReachable(HOST, { fetchImpl: f });
  assert.equal(ok, false);
});

// ---------- listModels ----------

test('listModels: parses model names from /api/tags', async () => {
  const f = fakeFetch(() =>
    jsonResponse({
      models: [
        { name: 'qwen2.5-coder:7b', size: 4700000000 },
        { name: 'mistral:latest', size: 4400000000 },
      ],
    }),
  );
  const models = await listModels(HOST, { fetchImpl: f });
  assert.deepEqual(models, ['qwen2.5-coder:7b', 'mistral:latest']);
});

test('listModels: returns empty array when no models', async () => {
  const f = fakeFetch(() => jsonResponse({ models: [] }));
  const models = await listModels(HOST, { fetchImpl: f });
  assert.deepEqual(models, []);
});

test('listModels: throws OllamaError when unreachable', async () => {
  const f = () => Promise.reject(new Error('ECONNREFUSED'));
  await assert.rejects(
    () => listModels(HOST, { fetchImpl: f }),
    (e: unknown) => e instanceof OllamaError,
  );
});

// ---------- generate ----------

test('generate: returns the response text from /api/chat', async () => {
  const f = fakeFetch((url, init) => {
    assert.match(url, /\/api\/chat$/);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'qwen2.5-coder:7b');
    assert.equal(body.stream, false);
    assert.ok(Array.isArray(body.messages));
    return jsonResponse({
      message: { role: 'assistant', content: 'app/auth.py | has the login fn' },
      done: true,
    });
  });
  const out = await generate(HOST, 'qwen2.5-coder:7b', 'pick files', {
    fetchImpl: f,
  });
  assert.equal(out, 'app/auth.py | has the login fn');
});

test('generate: throws OllamaError on model-not-found (404)', async () => {
  const f = fakeFetch(() =>
    jsonResponse({ error: 'model "nope" not found' }, 404),
  );
  await assert.rejects(
    () => generate(HOST, 'nope', 'prompt', { fetchImpl: f }),
    (e: unknown) => e instanceof OllamaError && /not found/i.test((e as Error).message),
  );
});

test('generate: throws OllamaError on timeout', async () => {
  // A fetch that never resolves on its own but honors the abort signal,
  // exactly as the real global fetch does. generate's internal timeout
  // aborts the controller, which should reject with an AbortError that
  // we translate into an OllamaError('timed out').
  const f = (_url: any, init?: any) =>
    new Promise<Response>((_resolve, reject) => {
      const signal: AbortSignal | undefined = init?.signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    });
  await assert.rejects(
    () => generate(HOST, 'm', 'p', { fetchImpl: f, timeoutMs: 50 }),
    (e: unknown) => e instanceof OllamaError && /timed out/i.test((e as Error).message),
  );
});

test('generate: throws OllamaError when connection refused', async () => {
  const f = () => Promise.reject(new Error('ECONNREFUSED'));
  await assert.rejects(
    () => generate(HOST, 'm', 'p', { fetchImpl: f }),
    (e: unknown) => e instanceof OllamaError,
  );
});
