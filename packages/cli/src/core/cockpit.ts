/**
 * The cockpit (v0.3.0) — the instrument panel for helpcode's kitchen.
 *
 * This is the WINDOW: it reads the sous-chef event log from state and renders
 * who did what, what was escalated to the principal, and rough tokens saved.
 * It is read-only. The eventual engine writes the same events; the cockpit will
 * show them live without changing this code. Window now, engine behind the same
 * glass later.
 *
 * Pure aggregation functions (summariseWorkers, sessionMetrics) are separated
 * from rendering so they're easy to unit-test.
 */

import { SousChefEvent, WorkerStatus, WorkerKind } from '../types.js';
import { c } from '../lib/ui.js';

export interface SessionMetrics {
  totalEvents: number;
  escalations: number;
  fallbacks: number;
  estTokensSaved: number;
}

/** Identity for grouping: a worker is a (kind, model) pair. */
function workerKey(e: SousChefEvent): string {
  return `${e.worker}::${e.model ?? ''}`;
}

/**
 * Collapse the event log into one status per distinct worker, newest summary
 * winning. Events are assumed roughly time-ordered but we sort defensively.
 */
export function summariseWorkers(log: SousChefEvent[]): WorkerStatus[] {
  const sorted = [...log].sort((a, b) => a.at.localeCompare(b.at));
  const byWorker = new Map<string, WorkerStatus>();

  for (const e of sorted) {
    const key = workerKey(e);
    const existing = byWorker.get(key);
    if (existing) {
      existing.eventsThisSession += 1;
      existing.lastSummary = e.summary;
    } else {
      byWorker.set(key, {
        kind: e.worker,
        model: e.model,
        quotaUsed: null, // populated for remote workers in v0.3.2+
        eventsThisSession: 1,
        lastSummary: e.summary,
      });
    }
  }
  return [...byWorker.values()];
}

export function sessionMetrics(log: SousChefEvent[]): SessionMetrics {
  let escalations = 0;
  let fallbacks = 0;
  let estTokensSaved = 0;
  for (const e of log) {
    if (e.outcome === 'escalated') escalations += 1;
    if (e.outcome === 'fallback') fallbacks += 1;
    if (typeof e.estTokensSaved === 'number') estTokensSaved += e.estTokensSaved;
  }
  return { totalEvents: log.length, escalations, fallbacks, estTokensSaved };
}

// --- rendering (kept out of the tested aggregation functions) ---

function workerLabel(kind: WorkerKind): string {
  switch (kind) {
    case 'local': return 'local';
    case 'remote': return 'free-tier';
    case 'deterministic': return 'code';
    case 'principal': return 'principal';
  }
}

/** Render the cockpit as a terminal printout. Read-only view of the log. */
export function renderCockpit(log: SousChefEvent[]): string {
  const lines: string[] = [];
  lines.push(c.cyan('helpcode cockpit') + c.dim('  ·  the kitchen this session'));
  lines.push('');

  const workers = summariseWorkers(log);
  if (workers.length === 0) {
    lines.push(c.dim('  No sous-chef activity yet this session.'));
    lines.push(c.dim('  Run `helpcode ask` (with Ollama enabled) to put the kitchen to work.'));
    return lines.join('\n');
  }

  lines.push(c.dim('  WORKERS'));
  for (const w of workers) {
    const name = w.model ?? workerLabel(w.kind);
    const tag = c.dim(`[${workerLabel(w.kind)}]`);
    const quota = w.quotaUsed !== null
      ? c.dim(`  quota ${Math.round(w.quotaUsed * 100)}%`)
      : '';
    lines.push(`  ${name} ${tag}  ${c.dim(`· ${w.eventsThisSession} task(s)`)}${quota}`);
    if (w.lastSummary) lines.push(c.dim(`      last: ${w.lastSummary}`));
  }

  lines.push('');
  const m = sessionMetrics(log);
  lines.push(c.dim('  SESSION'));
  lines.push(`  ${m.totalEvents} prep task(s)  ·  ${m.escalations} escalated to principal  ·  ${m.fallbacks} fell back`);
  if (m.estTokensSaved > 0) {
    lines.push(c.dim(`  ~${m.estTokensSaved} principal tokens saved (rough estimate)`));
  }

  lines.push('');
  lines.push(c.dim('  RECENT'));
  const recent = [...log].slice(-8);
  for (const e of recent) {
    const t = e.at.slice(11, 16); // HH:MM
    const who = e.model ?? workerLabel(e.worker);
    const mark = e.outcome === 'ok' ? c.green('✓')
      : e.outcome === 'escalated' ? c.yellow('↑')
      : c.dim('·');
    lines.push(`  ${c.dim(t)} ${mark} ${c.dim(who)}  ${e.summary}`);
  }

  return lines.join('\n');
}
