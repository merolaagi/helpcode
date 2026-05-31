/**
 * Per-provider quota tracking (v0.3.6).
 *
 * Free tiers are rate-limited per day. helpcode tracks a best-effort daily
 * request count per provider so the cockpit can show a real usage bar and the
 * router can skip a provider that's exhausted (after a 429). This is NOT a
 * perfect mirror of each provider's accounting (which is server-side and often
 * per-project, not per-key) — it's a local estimate, enough to inform routing
 * and the UI.
 *
 * Pure functions over a QuotaState object; `now` is injectable for tests.
 * Counts reset when the UTC day rolls over.
 */

import { QuotaState, ProviderQuota } from '../types.js';
import { QuotaStatus } from './souschef.js';

/**
 * Known free-tier daily request limits (approximate, mid-2026; they drift).
 * null = unknown limit (we still count, but can't show a fraction).
 */
export const PROVIDER_LIMITS: Record<string, number | null> = {
  gemini: 1000,   // Gemini 2.5 Flash-Lite free: ~1000 req/day
  grok: null,     // xAI free credits are $-based, not a clean req/day cap
  openai: null,   // depends on account tier
};

export function emptyQuotas(): QuotaState {
  return { providers: {} };
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Get the provider's record, resetting it if the stored day is stale. */
function currentRecord(q: QuotaState, provider: string, now: Date): ProviderQuota {
  const today = utcDay(now);
  const existing = q.providers[provider];
  if (!existing || existing.day !== today) {
    // New day (or first time): fresh count, but preserve a future throttle.
    const throttledUntil = existing?.throttledUntil;
    const fresh: ProviderQuota = { day: today, count: 0 };
    if (throttledUntil && new Date(throttledUntil) > now) {
      fresh.throttledUntil = throttledUntil;
    }
    q.providers[provider] = fresh;
  }
  return q.providers[provider];
}

/** Record one request against a provider (increments today's count). */
export function recordRequest(q: QuotaState, provider: string, now: Date = new Date()): void {
  const rec = currentRecord(q, provider, now);
  rec.count += 1;
}

/** Mark a provider throttled until the given time (e.g. after a 429). */
export function markThrottled(q: QuotaState, provider: string, until: Date, now: Date = new Date()): void {
  const rec = currentRecord(q, provider, now);
  rec.throttledUntil = until.toISOString();
}

/** Is the provider currently throttled? */
export function isThrottled(q: QuotaState, provider: string, now: Date = new Date()): boolean {
  const rec = q.providers[provider];
  if (!rec?.throttledUntil) return false;
  return new Date(rec.throttledUntil) > now;
}

/** Build a QuotaStatus for the cockpit/router, accounting for day reset. */
export function quotaFor(q: QuotaState, provider: string, now: Date = new Date()): QuotaStatus | null {
  if (!(provider in PROVIDER_LIMITS)) return null;
  const today = utcDay(now);
  const rec = q.providers[provider];
  const usedToday = rec && rec.day === today ? rec.count : 0;
  return {
    usedToday,
    limitPerDay: PROVIDER_LIMITS[provider],
    throttled: isThrottled(q, provider, now),
  };
}
