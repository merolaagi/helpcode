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

import { PROVIDERS, openaiCompatGenerate, ProviderConfig } from './providers.js';
import { geminiGenerate } from './gemini.js';
import { loadGeminiKey, loadProviderKey } from './keys.js';

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
const PRIORITY = ['gemini', 'kimi', 'grok', 'openai'];

function makeGemini(key: string): ResolvedProvider {
  return {
    id: 'gemini',
    label: 'Gemini',
    model: GEMINI_MODEL,
    key,
    freeTierNote: 'Gemini free tier — inputs may train Google models.',
    generate: (prompt, timeoutMs = 30000) =>
      geminiGenerate(prompt, { apiKey: key, model: GEMINI_MODEL, timeoutMs }),
  };
}

function makeOpenAICompat(p: ProviderConfig, key: string): ResolvedProvider {
  return {
    id: p.id,
    label: p.label,
    model: p.defaultModel,
    key,
    freeTierNote: p.freeTierNote,
    generate: (prompt, timeoutMs = 30000) =>
      openaiCompatGenerate(prompt, {
        baseUrl: p.baseUrl, model: p.defaultModel, apiKey: key, timeoutMs,
      }),
  };
}

/** Resolve a single provider by id, if it has a key. */
function resolveById(
  id: string,
  env: Record<string, string | undefined>,
  cwd: string,
): ResolvedProvider | null {
  if (id === 'gemini') {
    const key = loadGeminiKey(cwd, env);
    return key ? makeGemini(key) : null;
  }
  const p = PROVIDERS.find(x => x.id === id);
  if (!p) return null;
  const key = loadProviderKey(p.envVar, p.id, cwd, env);
  return key ? makeOpenAICompat(p, key) : null;
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
