/**
 * OpenAI-compatible remote sous-chef providers (v0.3.5).
 *
 * Kimi (Moonshot), Grok (xAI), and ChatGPT (OpenAI) all expose the same
 * OpenAI chat-completions API shape, so they share ONE client
 * (openaiCompatGenerate) and differ only in configuration: base URL, default
 * model, env var, and free-tier data-policy note. To users they're three
 * distinct providers (three panels, three keys); under the hood, one code path.
 *
 * Gemini stays separate (core/gemini.ts) because its REST shape differs.
 *
 * PRIVACY: every provider here is a free tier that MAY train on inputs (Grok's
 * free credits are explicitly a data-sharing program; Gemini likewise; Kimi
 * verify per current terms). So all are governed by the same privacy gate in
 * core/souschef.ts — decomposition by default, code only with allowRemoteCode.
 * The freeTierNote is surfaced so the user sees the tradeoff per provider.
 */

export interface ProviderConfig {
  id: string;
  /** Human label for the cockpit. */
  label: string;
  /** OpenAI-compatible base URL (without the /chat/completions suffix). */
  baseUrl: string;
  /** Default model id for this provider's free/cheap tier. */
  defaultModel: string;
  /** Env var that holds this provider's API key. */
  envVar: string;
  /** One-line note on the free-tier data/training policy. */
  freeTierNote: string;
}

/**
 * The registry. Models/URLs verified around mid-2026; they drift, so they're
 * config, not hardcoded logic — easy to bump. Pick exact models at use time if
 * a default is deprecated.
 */
export const PROVIDERS: ProviderConfig[] = [
  {
    id: 'grok',
    label: 'Grok',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.1-fast',
    envVar: 'XAI_API_KEY',
    freeTierNote: 'xAI free credits via data-sharing — inputs MAY train xAI models.',
  },
  {
    id: 'openai',
    label: 'ChatGPT',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4-mini',
    envVar: 'OPENAI_API_KEY',
    freeTierNote: 'OpenAI API — check whether your account/tier trains on inputs.',
  },
];

export function getProvider(id: string): ProviderConfig | null {
  return PROVIDERS.find(p => p.id === id) ?? null;
}

// --- the shared OpenAI-compatible client ---------------------------------

export class OpenAICompatError extends Error {
  readonly quotaExhausted: boolean;
  constructor(message: string, quotaExhausted = false) {
    super(message);
    this.name = 'OpenAICompatError';
    this.quotaExhausted = quotaExhausted;
  }
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatCall {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

export interface OpenAICompatDeps {
  fetchImpl?: FetchImpl;
}

const DEFAULT_TIMEOUT = 30000;

/** Extract the assistant message content from a chat-completions body. */
export function parseChatCompletion(body: any): string {
  const choice = body?.choices?.[0];
  const content = choice?.message?.content;
  return typeof content === 'string' ? content : '';
}

/**
 * Call any OpenAI-compatible chat-completions endpoint. Returns the text on
 * success; throws OpenAICompatError on any failure (quotaExhausted set for
 * 429s) so callers fall back to a cheaper worker.
 */
export async function openaiCompatGenerate(
  prompt: string,
  call: OpenAICompatCall,
  deps: OpenAICompatDeps = {},
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as FetchImpl);
  const timeoutMs = call.timeoutMs ?? DEFAULT_TIMEOUT;
  const url = `${call.baseUrl.replace(/\/$/, '')}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${call.apiKey}`,
      },
      body: JSON.stringify({
        model: call.model,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const why = (e as Error)?.name === 'AbortError' ? 'timed out' : (e as Error).message;
    throw new OpenAICompatError(`request failed: ${why}`);
  }
  clearTimeout(timer);

  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new OpenAICompatError(`bad response (status ${response.status}, non-JSON)`);
  }

  if (!response.ok) {
    const msg = body?.error?.message ?? `HTTP ${response.status}`;
    const isQuota = response.status === 429;
    throw new OpenAICompatError(`API error: ${msg}`, isQuota);
  }

  const text = parseChatCompletion(body).trim();
  if (!text) throw new OpenAICompatError('provider returned no usable text');
  return text;
}
