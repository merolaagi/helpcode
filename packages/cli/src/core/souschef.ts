/**
 * The sous-chef layer (v0.3.2) — makes local and remote workers interchangeable
 * behind one interface, with a privacy gate and cheapest-capable-first routing.
 *
 * Design doc: docs/v0.3.2-remote-souschef-design.md
 *
 * The privacy gate is the load-bearing rule: a REMOTE free-tier worker may only
 * receive data the user has accepted leaving the machine. By default that means
 * decomposition only (input is the task description, not code). A per-project
 * `allowRemoteCode` opt-in lets consenting users route code-bearing tasks too.
 *
 * Routing is cheapest-capable-first: local before remote. A remote worker is
 * only chosen when (a) the privacy gate permits the task, (b) no local worker
 * can handle it, and (c) the worker's own canHandle() says yes (e.g. has quota).
 */

import { SousChefTask } from '../types.js';

export interface QuotaStatus {
  /** Free requests used in the current day, if tracked. */
  usedToday: number;
  /** Daily limit, if known. */
  limitPerDay: number | null;
  /** True if the provider is currently throttled (e.g. after a 429). */
  throttled: boolean;
}

export interface WorkerContext {
  /** Project opt-in: may code-bearing tasks go to remote free tiers? */
  allowRemoteCode: boolean;
}

export interface SousChef {
  /** Stable id, e.g. "local:qwen2.5-coder:7b" or "gemini:2.5-flash-lite". */
  id: string;
  kind: 'local' | 'remote';
  /**
   * Whether this worker can take this task right now, ignoring privacy (that's
   * enforced separately in canWorkerHandle). Used for quota/availability vetoes.
   */
  canHandle: (task: SousChefTask, ctx: WorkerContext) => boolean;
  /** Do the work. Throws on failure; callers fall back to a cheaper worker. */
  run: (prompt: string, opts?: { timeoutMs?: number }) => Promise<string>;
  /** Remote workers report quota for the cockpit + routing; local returns null. */
  quota: () => QuotaStatus | null;
}

/**
 * The privacy gate. Which tasks may a REMOTE worker receive?
 * - decomposition: always (input is the user's task description, no code)
 * - everything else: only if the project opted into allowRemoteCode
 *
 * Local workers are never gated by this — code never leaves the machine.
 */
export function isRemoteAllowedForTask(
  task: SousChefTask,
  allowRemoteCode: boolean,
): boolean {
  if (task === 'decomposition') return true;
  return allowRemoteCode;
}

/**
 * Can this specific worker handle this task, accounting for privacy AND the
 * worker's own availability veto?
 */
export function canWorkerHandle(
  worker: SousChef,
  task: SousChefTask,
  ctx: WorkerContext,
): boolean {
  if (worker.kind === 'remote' && !isRemoteAllowedForTask(task, ctx.allowRemoteCode)) {
    return false;
  }
  return worker.canHandle(task, ctx);
}

/**
 * Pick the cheapest capable worker. Local workers are cheaper than remote, so
 * they're preferred; within a kind, the first in the list wins (stable order).
 * Returns null if nothing can handle the task.
 */
export function pickWorker(
  workers: SousChef[],
  task: SousChefTask,
  ctx: WorkerContext,
): SousChef | null {
  const capable = workers.filter(w => canWorkerHandle(w, task, ctx));
  if (capable.length === 0) return null;
  // local (cheaper) before remote; preserve input order within a kind.
  const localFirst = [...capable].sort((a, b) => {
    if (a.kind === b.kind) return 0;
    return a.kind === 'local' ? -1 : 1;
  });
  return localFirst[0];
}
