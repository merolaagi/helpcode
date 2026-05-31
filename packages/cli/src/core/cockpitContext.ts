/**
 * Cockpit context (v0.3.7) — the real-world facts the cockpit needs beyond the
 * event log: the project's privacy tier, the full roster of configured workers
 * (even idle ones), and which providers are throttled.
 *
 * Separated from rendering so it's unit-testable against config + state without
 * touching disk or HTML.
 */

import { ProjectConfig, QuotaState } from '../types.js';
import { PROVIDERS } from './providers.js';
import { isThrottled } from './quota.js';
import { PrivacyVM, AvailableWorkerVM } from './cockpitHtml.js';

/** Does any configured remote provider have a key in this env? */
function anyRemoteKey(env: Record<string, string | undefined>): boolean {
  if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim()) return true;
  return PROVIDERS.some(p => {
    const v = env[p.envVar];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

/**
 * Gap #2 + #4: the project's data-sharing posture.
 *   - no remote key                      => local-only (nothing leaves)
 *   - key present, allowRemoteCode off   => decomposition-only (task desc only)
 *   - key present, allowRemoteCode on    => code-allowed (code may leave)
 * allowRemoteCode with no key still resolves to local-only — without a key,
 * nothing can leave regardless of the flag.
 */
export function computePrivacy(
  config: ProjectConfig,
  env: Record<string, string | undefined>,
): PrivacyVM {
  const hasKey = anyRemoteKey(env);
  const allowCode = config.remote?.allowRemoteCode === true;
  const preferredProvider = config.remote?.provider ?? null;

  if (!hasKey) {
    return {
      tier: 'local-only',
      label: 'Local only',
      detail: 'No remote key configured — nothing leaves this machine.',
      preferredProvider,
    };
  }
  if (!allowCode) {
    return {
      tier: 'decomposition-only',
      label: 'Decomposition only',
      detail: 'Remote may see task descriptions only — never your code.',
      preferredProvider,
    };
  }
  return {
    tier: 'code-allowed',
    label: 'Code allowed remote',
    detail: 'allowRemoteCode is ON — code-bearing tasks may go to a free tier.',
    preferredProvider,
  };
}

/**
 * Gap #3: every configured worker, whether or not it has run — local plus all
 * remote providers, each marked available (has a key) or not, and throttled or
 * not.
 */
export function computeAvailableWorkers(
  config: ProjectConfig,
  env: Record<string, string | undefined>,
  quotas: QuotaState,
): AvailableWorkerVM[] {
  const workers: AvailableWorkerVM[] = [];

  // Local (Ollama)
  const localOn = config.ollama?.enabled === true;
  workers.push({
    id: 'local',
    label: config.ollama?.model ?? 'local model',
    kind: 'local',
    available: localOn,
    throttled: false,
    note: localOn ? '' : 'ollama disabled in project config',
  });

  // Gemini (its own env var, not in the OpenAI-compat PROVIDERS list)
  const gemKey = !!(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim());
  workers.push({
    id: 'gemini',
    label: 'Gemini',
    kind: 'remote',
    available: gemKey,
    throttled: isThrottled(quotas, 'gemini'),
    note: gemKey ? '' : 'no key (set GEMINI_API_KEY)',
  });

  // OpenAI-compatible providers (Grok, ChatGPT)
  for (const p of PROVIDERS) {
    const v = env[p.envVar];
    const hasKey = typeof v === 'string' && v.trim().length > 0;
    workers.push({
      id: p.id,
      label: p.label,
      kind: 'remote',
      available: hasKey,
      throttled: isThrottled(quotas, p.id),
      note: hasKey ? '' : `no key (set ${p.envVar})`,
    });
  }

  return workers;
}
