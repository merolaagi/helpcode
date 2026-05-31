import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCockpitViewModel } from '../../src/core/cockpitHtml.js';
import { SousChefEvent } from '../../src/types.js';

function ev(over: Partial<SousChefEvent>): SousChefEvent {
  return {
    at: '2026-05-31T09:00:00.000Z',
    task: 'file_selection',
    worker: 'local',
    model: 'qwen2.5-coder:7b',
    summary: 'selected 3 files',
    outcome: 'ok',
    estTokensSaved: 200,
    ...over,
  };
}

// buildCockpitViewModel turns the raw event log into the structure the HTML
// renderer consumes: real worker panels, session metrics, recent feed, and
// the catalogue of "coming" (aspirational) panels/features.

test('view model: builds a panel per real worker', () => {
  const vm = buildCockpitViewModel([
    ev({ worker: 'local', model: 'qwen2.5-coder:7b' }),
    ev({ worker: 'remote', model: 'gemini-2.5-flash-lite', task: 'decomposition', summary: 'proposed 4 steps' }),
  ]);
  const ids = vm.workers.map(w => w.model);
  assert.ok(ids.includes('qwen2.5-coder:7b'));
  assert.ok(ids.includes('gemini-2.5-flash-lite'));
});

test('view model: worker tier badge reflects kind', () => {
  const vm = buildCockpitViewModel([
    ev({ worker: 'local', model: 'qwen2.5-coder:7b' }),
    ev({ worker: 'remote', model: 'gemini-2.5-flash-lite' }),
  ]);
  const local = vm.workers.find(w => w.kind === 'local');
  const remote = vm.workers.find(w => w.kind === 'remote');
  assert.equal(local!.tierLabel, 'local');
  assert.equal(remote!.tierLabel, 'free-tier');
});

test('view model: metrics aggregate the log', () => {
  const vm = buildCockpitViewModel([
    ev({ outcome: 'ok', estTokensSaved: 100 }),
    ev({ outcome: 'ok', estTokensSaved: 50 }),
    ev({ outcome: 'escalated', estTokensSaved: null }),
  ]);
  assert.equal(vm.metrics.totalEvents, 3);
  assert.equal(vm.metrics.escalations, 1);
  assert.equal(vm.metrics.estTokensSaved, 150);
});

test('view model: recent feed is capped and newest-last', () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    ev({ at: `2026-05-31T09:${String(i).padStart(2, '0')}:00.000Z`, summary: `event ${i}` }));
  const vm = buildCockpitViewModel(many);
  assert.ok(vm.recent.length <= 12);
  // newest should be present
  assert.equal(vm.recent[vm.recent.length - 1].summary, 'event 19');
});

test('view model: always includes the aspirational "coming" catalogue', () => {
  const vm = buildCockpitViewModel([]);
  // even with no activity, the roadmap panels exist so the UI shows them greyed
  const names = vm.coming.map(c => c.name.toLowerCase()).join(' ');
  assert.match(names, /complexity/);
  assert.match(names, /review/);
});

test('view model: empty log yields no workers but valid metrics', () => {
  const vm = buildCockpitViewModel([]);
  assert.equal(vm.workers.length, 0);
  assert.equal(vm.metrics.totalEvents, 0);
});

// --- CLI shell lines (real event stream as terminal output) ---
import { buildCliLines } from '../../src/core/cockpitHtml.js';

test('cli lines: empty log shows the idle prompt', () => {
  const lines = buildCliLines([]);
  assert.ok(lines.some(l => /no sous-chef activity/i.test(l.text)));
});

test('cli lines: ok event renders as a checkmark line with worker + summary', () => {
  const lines = buildCliLines([ev({ worker: 'remote', model: 'gemini-2.5-flash-lite', task: 'decomposition', summary: 'proposed 4 steps', outcome: 'ok' })]);
  const line = lines.find(l => l.kind === 'ok');
  assert.ok(line);
  assert.match(line!.text, /gemini-2\.5-flash-lite/);
  assert.match(line!.text, /proposed 4 steps/);
  assert.match(line!.text, /plan/); // decomposition -> "plan" verb
});

test('cli lines: fallback event renders as a dim fell-back line', () => {
  const lines = buildCliLines([ev({ worker: 'deterministic', model: null, outcome: 'fallback', summary: 'keyword heuristic' })]);
  assert.ok(lines.some(l => l.kind === 'dim' && /fell back/i.test(l.text)));
});
