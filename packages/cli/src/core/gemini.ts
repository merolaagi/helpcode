/**
 * Minimal client for the Google Gemini API (free tier), via REST.
 *
 * Mirrors the Ollama client's discipline:
 *   - Zero runtime dependencies: plain fetch, no SDK.
 *   - fetch is injectable so tests never hit the live API and CI passes offline.
 *   - Every failure becomes a GeminiError; callers fall back to a cheaper
 *     worker (local) or deterministic path. The remote path can NEVER break the
 *     core flow.
 *
 * PRIVACY: the free tier may use inputs/outputs to train Google's models. The
 * sous-chef privacy gate (core/souschef.ts) ensures only non-code task input
 * (decomposition) reaches here unless the user opts into allowRemoteCode. This
 * client does not enforce that — it's enforced upstream at routing time.
 */

export class GeminiError extends Error {
  /** True if the failure was a 429 RESOURCE_EXHAUSTED (free quota used up). */
  readonly quotaExhausted: boolean;
  constructor(message: string, quotaExhausted = false) {
    super(message);
    this.name = 'GeminiError';
    this.quotaExhausted = quotaExhausted;
  }
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface GeminiCallOptions {
  fetchImpl?: FetchImpl;
}

export interface GeminiConfig {
  apiKey: string;
  /** Model id, e.g. "gemini-2.5-flash-lite". */
  model: string;
  timeoutMs: number;
}

const DEFAULT_GENERATE_TIMEOUT = 20000;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Build the generateContent endpoint URL for a model + key. */
export function buildGeminiUrl(model: string, apiKey: string): string {
  return `${API_BASE}/${model}:generateContent?key=${apiKey}`;
}

/** Extract concatenated text from a generateContent response body. */
export function parseGeminiResponse(body: any): string {
  const cand = body?.candidates?.[0];
  const parts = cand?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
}

function getFetch(opts?: GeminiCallOptions): FetchImpl {
  return opts?.fetchImpl ?? (globalThis.fetch as FetchImpl);
}

/**
 * Generate text from Gemini. Returns the model's text on success; throws a
 * GeminiError on any failure (with quotaExhausted set for 429s so the router
 * can mark the provider throttled).
 */
export async function geminiGenerate(
  prompt: string,
  config: GeminiConfig,
  opts?: GeminiCallOptions,
): Promise<string> {
  const fetchImpl = getFetch(opts);
  const timeoutMs = config.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT;
  const url = buildGeminiUrl(config.model, config.apiKey);

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const why = (e as Error)?.name === 'AbortError' ? 'timed out' : (e as Error).message;
    throw new GeminiError(`request failed: ${why}`);
  }
  clearTimeout(timer);

  // Parse the body (may be an error envelope).
  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new GeminiError(`bad response (status ${response.status}, non-JSON body)`);
  }

  if (!response.ok) {
    const status = body?.error?.status ?? '';
    const msg = body?.error?.message ?? `HTTP ${response.status}`;
    const isQuota = response.status === 429 || status === 'RESOURCE_EXHAUSTED';
    throw new GeminiError(`Gemini error: ${msg}`, isQuota);
  }

  const text = parseGeminiResponse(body).trim();
  if (!text) {
    throw new GeminiError('Gemini returned no usable text');
  }
  return text;
}
