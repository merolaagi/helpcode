import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordRequest,
  quotaFor,
  isThrottled,
  markThrottled,
  PROVIDER_LIMITS,
  emptyQuotas,
} from '../../src/core/quota.js';

// The quota tracker keeps a per-provider daily request count and an optional
// "throttled until" time (set on a 429). Counts reset when the day (UTC)
// rolls over. Pure functions over a QuotaState object, injectable `now` for
// deterministic tests.

const DAY1 = new Date('2026-05-31T10:00:00.000Z');
const DAY1_LATER = new Date('2026-05-31T22:00:00.000Z');
const DAY2 = new Date('2026-06-01T01:00:00.000Z');

test('recordRequest: first request starts the count at 1', () => {
  const q = emptyQuotas();
  recordRequest(q, 'gemini', DAY1);
  assert.equal(q.providers.gemini.count, 1);
  assert.equal(q.providers.gemini.day, '2026-05-31');
});

test('recordRequest: increments within the same day', () => {
  const q = emptyQuotas();
  recordRequest(q, 'gemini', DAY1);
  recordRequest(q, 'gemini', DAY1_LATER);
  assert.equal(q.providers.gemini.count, 2);
});

test('recordRequest: resets count when the UTC day rolls over', () => {
  const q = emptyQuotas();
  recordRequest(q, 'gemini', DAY1);
  recordRequest(q, 'gemini', DAY1_LATER);
  recordRequest(q, 'gemini', DAY2);
  assert.equal(q.providers.gemini.count, 1, 'new day resets to 1');
  assert.equal(q.providers.gemini.day, '2026-06-01');
});

test('recordRequest: tracks providers independently', () => {
  const q = emptyQuotas();
  recordRequest(q, 'gemini', DAY1);
  recordRequest(q, 'grok', DAY1);
  recordRequest(q, 'grok', DAY1);
  assert.equal(q.providers.gemini.count, 1);
  assert.equal(q.providers.grok.count, 2);
});

test('quotaFor: returns fraction used against the known daily limit', () => {
  const q = emptyQuotas();
  // gemini free daily limit is 1000 (Flash-Lite); 250 used => 0.25
  for (let i = 0; i < 250; i++) recordRequest(q, 'gemini', DAY1);
  const status = quotaFor(q, 'gemini', DAY1);
  assert.ok(status);
  assert.equal(status!.usedToday, 250);
  assert.equal(status!.limitPerDay, PROVIDER_LIMITS.gemini);
  assert.ok(Math.abs((250 / PROVIDER_LIMITS.gemini!) - (status!.usedToday / status!.limitPerDay!)) < 1e-9);
});

test('quotaFor: count resets in the reading if day rolled over', () => {
  const q = emptyQuotas();
  recordRequest(q, 'gemini', DAY1);
  const status = quotaFor(q, 'gemini', DAY2); // reading on a new day
  assert.equal(status!.usedToday, 0, 'stale day reads as 0 used today');
});

test('quotaFor: unknown provider yields null', () => {
  const q = emptyQuotas();
  assert.equal(quotaFor(q, 'nope', DAY1), null);
});

test('markThrottled / isThrottled: provider is throttled until the given time', () => {
  const q = emptyQuotas();
  const until = new Date('2026-05-31T10:05:00.000Z');
  markThrottled(q, 'grok', until);
  assert.equal(isThrottled(q, 'grok', new Date('2026-05-31T10:04:00.000Z')), true);
  assert.equal(isThrottled(q, 'grok', new Date('2026-05-31T10:06:00.000Z')), false);
});

test('isThrottled: false for a provider never throttled', () => {
  const q = emptyQuotas();
  assert.equal(isThrottled(q, 'gemini', DAY1), false);
});

test('quotaFor: throttled flag reflected in status', () => {
  const q = emptyQuotas();
  markThrottled(q, 'gemini', new Date('2026-05-31T12:00:00.000Z'));
  const status = quotaFor(q, 'gemini', DAY1);
  assert.equal(status!.throttled, true);
});
