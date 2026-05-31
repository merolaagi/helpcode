/**
 * Remote provider routing (v0.3.5).
 *
 * Picks which remote sous-chef to use among the configured providers, based on
 * which one has a key available. Unifies the two client shapes — Gemini (its
 * own REST) and the OpenAI-compatible trio (Kimi, Grok, ChatGPT) — behind one
 * `generate(prompt)` function so callers (plan, selection, triage) don't care
 * which provider answered.
 *
 * Priority order: Gemini first (the original, most-tested), then Kimi, Grok,
 * ChatGPT. A caller may pass a preferred id to override the order when that
 * provider has a key.
 */

import { PROVIDERS, openaiCompatGenerate, OpenAICompatError, ProviderConfig } from './providers.js';
import { geminiGenerate, GeminiError } from './gemini.js';
import { loadGeminiKey, loadProviderKey } from './keys.js';
import { loadState, saveState } from './state.js';
import { recordRequest, markThrottled, isThrottled, quotaFor } from './quota.js';
import { QuotaStatus } from './souschef.js';

export interface ResolvedProvider {
  id: string;
  label: string;
  model: string;
  key: string;
  freeTierNote: string;
  /** Run a prompt through this provider's client. Throws on failure. */
  generate: (prompt: string, timeoutMs?: number) => Promise<string>;
}

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

/** Priority order for auto-selection (Gemini first, then the OAI-compat trio). */
const PRIORITY = ['gemini', 'grok', 'openai'];

/**
 * Persist a quota mutation: load state, mutate its quotas, save. Best-effort —
 * quota tracking must never break the actual generation.
 */
function withQuota(mutate: (q: import('../types.js').QuotaState) => void): void {
  try {
    const state = loadState();
    if (!state.quotas) state.quotas = { providers: {} };
    mutate(state.quotas);
    saveState(state);
  } catch {
    // ignore — quota is advisory
  }
}

/** Wrap a provider's raw generate to record usage and mark throttling on 429. */
function trackedGenerate(
  id: string,
  raw: (prompt: string, timeoutMs?: number) => Promise<string>,
): (prompt: string, timeoutMs?: number) => Promise<string> {
  return async (prompt: string, timeoutMs?: number) => {
    withQuota(q => recordRequest(q, id));
    try {
      return await raw(prompt, timeoutMs);
    } catch (e) {
      const quotaHit = (e instanceof GeminiError && e.quotaExhausted)
        || (e instanceof OpenAICompatError && e.quotaExhausted);
      if (quotaHit) {
        // back off this provider for an hour (best-effort; real retry-after varies)
        const until = new Date(Date.now() + 60 * 60 * 1000);
        withQuota(q => markThrottled(q, id, until));
      }
      throw e;
    }
  };
}

function makeGemini(key: string): ResolvedProvider {
  const raw = (prompt: string, timeoutMs = 30000) =>
    geminiGenerate(prompt, { apiKey: key, model: GEMINI_MODEL, timeoutMs });
  return {
    id: 'gemini',
    label: 'Gemini',
    model: GEMINI_MODEL,
    key,
    freeTierNote: 'Gemini free tier — inputs may train Google models.',
    generate: trackedGenerate('gemini', raw),
  };
}

function makeOpenAICompat(p: ProviderConfig, key: string): ResolvedProvider {
  const raw = (prompt: string, timeoutMs = 30000) =>
    openaiCompatGenerate(prompt, {
      baseUrl: p.baseUrl, model: p.defaultModel, apiKey: key, timeoutMs,
    });
  return {
    id: p.id,
    label: p.label,
    model: p.defaultModel,
    key,
    freeTierNote: p.freeTierNote,
    generate: trackedGenerate(p.id, raw),
  };
}

/** Resolve a single provider by id, if it has a key and isn't throttled. */
function resolveById(
  id: string,
  env: Record<string, string | undefined>,
  cwd: string,
): ResolvedProvider | null {
  // Skip a provider currently backed off after a 429.
  try {
    const state = loadState(cwd);
    if (state.quotas && isThrottled(state.quotas, id)) return null;
  } catch {
    // if state can't be read, don't block resolution
  }

  if (id === 'gemini') {
    const key = loadGeminiKey(cwd, env);
    return key ? makeGemini(key) : null;
  }
  const p = PROVIDERS.find(x => x.id === id);
  if (!p) return null;
  const key = loadProviderKey(p.envVar, p.id, cwd, env);
  return key ? makeOpenAICompat(p, key) : null;
}

/** Read-only: current quota status for a provider (for the cockpit). */
export function providerQuotaStatus(id: string, cwd: string = process.cwd()): QuotaStatus | null {
  try {
    const state = loadState(cwd);
    if (!state.quotas) return null;
    return quotaFor(state.quotas, id);
  } catch {
    return null;
  }
}

/**
 * Find the first remote provider that has a key. If `preferred` is given and
 * that provider has a key, it wins; otherwise fall back to priority order.
 */
export function firstAvailableProvider(
  env: Record<string, string | undefined> = process.env,
  preferred?: string,
  cwd: string = process.cwd(),
): ResolvedProvider | null {
  if (preferred) {
    const p = resolveById(preferred, env, cwd);
    if (p) return p;
  }
  for (const id of PRIORITY) {
    const p = resolveById(id, env, cwd);
    if (p) return p;
  }
  return null;
}
