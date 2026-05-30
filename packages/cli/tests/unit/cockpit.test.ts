import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseWorkers, sessionMetrics } from '../../src/core/cockpit.js';
import { SousChefEvent } from '../../src/types.js';

function ev(over: Partial<SousChefEvent>): SousChefEvent {
  return {
    at: '2026-05-30T09:00:00.000Z',
    task: 'file_selection',
    worker: 'local',
    model: 'qwen2.5-coder:7b',
    summary: 'selected 3 files',
    outcome: 'ok',
    estTokensSaved: 200,
    ...over,
  };
}

test('summariseWorkers: groups events by worker+model', () => {
  const log: SousChefEvent[] = [
    ev({ worker: 'local', model: 'qwen2.5-coder:7b', task: 'file_selection' }),
    ev({ worker: 'local', model: 'qwen2.5-coder:7b', task: 'output_triage', summary: 'triaged 59 lines' }),
    ev({ worker: 'deterministic', model: null, task: 'file_selection', summary: 'keyword fallback' }),
  ];
  const workers = summariseWorkers(log);
  // one local(qwen) worker + one deterministic worker
  assert.equal(workers.length, 2);
  const local = workers.find(w => w.kind === 'local');
  assert.ok(local);
  assert.equal(local!.eventsThisSession, 2);
  assert.equal(local!.lastSummary, 'triaged 59 lines');
});

test('summariseWorkers: empty log yields no workers', () => {
  assert.deepEqual(summariseWorkers([]), []);
});

test('summariseWorkers: most-recent summary wins per worker', () => {
  const log: SousChefEvent[] = [
    ev({ at: '2026-05-30T09:00:00.000Z', summary: 'older' }),
    ev({ at: '2026-05-30T09:05:00.000Z', summary: 'newer' }),
  ];
  const w = summariseWorkers(log);
  assert.equal(w[0].lastSummary, 'newer');
});

test('sessionMetrics: counts tasks, escalations, est tokens saved', () => {
  const log: SousChefEvent[] = [
    ev({ outcome: 'ok', estTokensSaved: 200 }),
    ev({ outcome: 'ok', estTokensSaved: 150 }),
    ev({ outcome: 'fallback', estTokensSaved: 0 }),
    ev({ outcome: 'escalated', estTokensSaved: null, worker: 'principal', model: null }),
  ];
  const m = sessionMetrics(log);
  assert.equal(m.totalEvents, 4);
  assert.equal(m.escalations, 1);
  assert.equal(m.fallbacks, 1);
  assert.equal(m.estTokensSaved, 350);
});

test('sessionMetrics: empty log is all zeros', () => {
  const m = sessionMetrics([]);
  assert.equal(m.totalEvents, 0);
  assert.equal(m.escalations, 0);
  assert.equal(m.fallbacks, 0);
  assert.equal(m.estTokensSaved, 0);
});

// --- regression: the v0.3.0 clobber bug ---
// A command loads state, appends an event in-memory, then saves. The event
// must survive. (The bug: recordSousChefEvent did its own load/save, which the
// command's later saveState then overwrote.)
import { loadState, saveState, appendSousChefEvent } from '../../src/core/state.js';
import * as fs from 'node:fs';
import * as pathmod from 'node:path';
import * as os from 'node:os';

test('appendSousChefEvent: event survives the command-level saveState', () => {
  const dir = fs.mkdtempSync(pathmod.join(os.tmpdir(), 'helpcode-clobber-'));
  try {
    const state = loadState(dir);          // fresh empty state (v2)
    appendSousChefEvent(state, {
      at: new Date().toISOString(),
      task: 'file_selection',
      worker: 'local',
      model: 'qwen2.5-coder:7b',
      summary: 'selected 3 files',
      outcome: 'ok',
      estTokensSaved: null,
    });
    saveState(state, dir);                  // the command's own save
    const reloaded = loadState(dir);
    assert.equal(reloaded.sousChefLog.length, 1, 'event must persist, not be clobbered');
    assert.equal(reloaded.sousChefLog[0].summary, 'selected 3 files');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
