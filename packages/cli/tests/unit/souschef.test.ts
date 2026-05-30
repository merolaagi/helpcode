import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canWorkerHandle,
  pickWorker,
  isRemoteAllowedForTask,
} from '../../src/core/souschef.js';
import type { SousChef } from '../../src/core/souschef.js';

// The SousChef layer makes local and remote workers interchangeable behind one
// interface, with a privacy gate (remote workers may not receive source code
// unless the project opts in) and cheapest-capable-first routing.

// ---------- isRemoteAllowedForTask (the privacy gate) ----------

test('privacy gate: decomposition is always remote-allowed (no code in input)', () => {
  assert.equal(isRemoteAllowedForTask('decomposition', false), true);
  assert.equal(isRemoteAllowedForTask('decomposition', true), true);
});

test('privacy gate: file_selection blocked remotely unless allowRemoteCode', () => {
  assert.equal(isRemoteAllowedForTask('file_selection', false), false);
  assert.equal(isRemoteAllowedForTask('file_selection', true), true);
});

test('privacy gate: output_triage blocked remotely unless allowRemoteCode', () => {
  assert.equal(isRemoteAllowedForTask('output_triage', false), false);
  assert.equal(isRemoteAllowedForTask('output_triage', true), true);
});

// ---------- canWorkerHandle ----------

function fakeWorker(over: Partial<SousChef>): SousChef {
  return {
    id: 'local:test',
    kind: 'local',
    canHandle: () => true,
    run: async () => 'out',
    quota: () => null,
    ...over,
  };
}

test('canWorkerHandle: local worker can do a code task regardless of privacy', () => {
  const w = fakeWorker({ kind: 'local' });
  assert.equal(canWorkerHandle(w, 'file_selection', { allowRemoteCode: false }), true);
});

test('canWorkerHandle: remote worker blocked from code task by default', () => {
  const w = fakeWorker({ kind: 'remote' });
  assert.equal(canWorkerHandle(w, 'file_selection', { allowRemoteCode: false }), false);
});

test('canWorkerHandle: remote worker allowed code task when opted in', () => {
  const w = fakeWorker({ kind: 'remote' });
  assert.equal(canWorkerHandle(w, 'file_selection', { allowRemoteCode: true }), true);
});

test('canWorkerHandle: remote worker always allowed decomposition', () => {
  const w = fakeWorker({ kind: 'remote' });
  assert.equal(canWorkerHandle(w, 'decomposition', { allowRemoteCode: false }), true);
});

test('canWorkerHandle: worker own canHandle veto is respected', () => {
  const w = fakeWorker({ kind: 'remote', canHandle: () => false });
  // even though decomposition is privacy-OK, the worker itself says no (e.g. no quota)
  assert.equal(canWorkerHandle(w, 'decomposition', { allowRemoteCode: false }), false);
});

// ---------- pickWorker (cheapest-capable-first) ----------

test('pickWorker: prefers local over remote when both can handle', () => {
  const local = fakeWorker({ id: 'local:x', kind: 'local' });
  const remote = fakeWorker({ id: 'gemini:flash-lite', kind: 'remote' });
  const chosen = pickWorker([local, remote], 'decomposition', { allowRemoteCode: false });
  assert.equal(chosen?.id, 'local:x');
});

test('pickWorker: falls to remote when local cannot handle', () => {
  const local = fakeWorker({ id: 'local:x', kind: 'local', canHandle: () => false });
  const remote = fakeWorker({ id: 'gemini:flash-lite', kind: 'remote' });
  const chosen = pickWorker([local, remote], 'decomposition', { allowRemoteCode: false });
  assert.equal(chosen?.id, 'gemini:flash-lite');
});

test('pickWorker: returns null when nothing can handle', () => {
  const local = fakeWorker({ kind: 'local', canHandle: () => false });
  const remote = fakeWorker({ kind: 'remote' });
  // code task, no opt-in, local vetoes → remote blocked by privacy → none
  const chosen = pickWorker([local, remote], 'file_selection', { allowRemoteCode: false });
  assert.equal(chosen, null);
});

test('pickWorker: remote code task works when opted in and local unavailable', () => {
  const local = fakeWorker({ kind: 'local', canHandle: () => false });
  const remote = fakeWorker({ id: 'gemini:flash-lite', kind: 'remote' });
  const chosen = pickWorker([local, remote], 'file_selection', { allowRemoteCode: true });
  assert.equal(chosen?.id, 'gemini:flash-lite');
});

test('pickWorker: order among same-kind workers is stable (first wins)', () => {
  const a = fakeWorker({ id: 'local:a', kind: 'local' });
  const b = fakeWorker({ id: 'local:b', kind: 'local' });
  const chosen = pickWorker([a, b], 'decomposition', { allowRemoteCode: false });
  assert.equal(chosen?.id, 'local:a');
});
