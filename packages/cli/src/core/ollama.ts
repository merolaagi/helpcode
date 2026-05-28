/**
 * Minimal client for a local Ollama server (default http://localhost:11434).
 *
 * Design:
 *   - Zero runtime dependencies: plain fetch, no SDK.
 *   - fetch is injectable so tests never touch a live Ollama and CI passes
 *     with no Ollama installed.
 *   - Every failure becomes an OllamaError; callers (the selector) catch it
 *     and fall back to the heuristic. The LLM path can NEVER break `ask`.
 *
 * This is the v0.2 foundation. It does file-selection reasoning today; the
 * same client will serve later local-LLM tasks (response rescue, triage).
 */

export class OllamaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OllamaError';
  }
}

/** Injectable fetch type — matches the global fetch signature we use. */
type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface OllamaCallOptions {
  /** Injectable fetch for testing. Defaults to global fetch. */
  fetchImpl?: FetchImpl;
  /** Timeout in milliseconds. */
  timeoutMs?: number;
}

const DEFAULT_REACHABLE_TIMEOUT = 1000;   // fast probe; don't hang the user
const DEFAULT_GENERATE_TIMEOUT = 20000;   // generous; off the critical path

function getFetch(opts?: OllamaCallOptions): FetchImpl {
  return opts?.fetchImpl ?? (globalThis.fetch as FetchImpl);
}

/**
 * Run a fetch with an abort-based timeout. Throws OllamaError('timed out')
 * if the deadline is hit, or OllamaError(<reason>) on any other failure.
 */
async function fetchWithTimeout(
  fetchImpl: FetchImpl,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new OllamaError(`Ollama request timed out after ${timeoutMs}ms`);
    }
    throw new OllamaError(`Ollama request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Quick liveness probe. Returns true if Ollama answers /api/tags with 200.
 * Never throws — a down server simply returns false.
 */
export async function isOllamaReachable(
  host: string,
  opts?: OllamaCallOptions,
): Promise<boolean> {
  const fetchImpl = getFetch(opts);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_REACHABLE_TIMEOUT;
  try {
    const res = await fetchWithTimeout(
      fetchImpl,
      `${host}/api/tags`,
      { method: 'GET' },
      timeoutMs,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * List the models pulled into Ollama (via GET /api/tags).
 * Throws OllamaError if the server is unreachable or the response is bad.
 */
export async function listModels(
  host: string,
  opts?: OllamaCallOptions,
): Promise<string[]> {
  const fetchImpl = getFetch(opts);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_REACHABLE_TIMEOUT;
  const res = await fetchWithTimeout(
    fetchImpl,
    `${host}/api/tags`,
    { method: 'GET' },
    timeoutMs,
  );
  if (!res.ok) {
    throw new OllamaError(`Ollama /api/tags returned ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new OllamaError('Ollama /api/tags returned invalid JSON');
  }
  const models = (body as { models?: { name?: string }[] }).models ?? [];
  return models
    .map(m => m.name)
    .filter((n): n is string => typeof n === 'string');
}

/**
 * Generate a completion via POST /api/chat (non-streaming).
 * Returns the assistant message content.
 *
 * Throws OllamaError on timeout, connection failure, non-2xx status,
 * or unparseable response.
 */
export async function generate(
  host: string,
  model: string,
  prompt: string,
  opts?: OllamaCallOptions,
): Promise<string> {
  const fetchImpl = getFetch(opts);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT;

  const res = await fetchWithTimeout(
    fetchImpl,
    `${host}/api/chat`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
      }),
    },
    timeoutMs,
  );

  if (!res.ok) {
    // Try to surface Ollama's error message (e.g. model not found)
    let detail = `status ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // ignore parse failure; keep the status-based detail
    }
    throw new OllamaError(`Ollama /api/chat failed: ${detail}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new OllamaError('Ollama /api/chat returned invalid JSON');
  }

  const content = (body as { message?: { content?: string } }).message?.content;
  if (typeof content !== 'string') {
    throw new OllamaError('Ollama /api/chat response missing message content');
  }
  return content.trim();
}
