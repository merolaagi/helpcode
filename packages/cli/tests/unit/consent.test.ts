import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowRemoteCodeNotice, remoteCodeNoticeText } from '../../src/core/consent.js';

// The one-time notice fires the FIRST time a remote worker would send code
// (i.e. allowRemoteCode is on AND the task is code-bearing AND we haven't shown
// it before). After that, it stays quiet.

test('notice: shown when opted in, code task, not yet shown', () => {
  assert.equal(
    shouldShowRemoteCodeNotice({ allowRemoteCode: true, task: 'file_selection', alreadyShown: false }),
    true,
  );
});

test('notice: NOT shown when allowRemoteCode is off', () => {
  assert.equal(
    shouldShowRemoteCodeNotice({ allowRemoteCode: false, task: 'file_selection', alreadyShown: false }),
    false,
  );
});

test('notice: NOT shown for decomposition (no code leaves regardless)', () => {
  assert.equal(
    shouldShowRemoteCodeNotice({ allowRemoteCode: true, task: 'decomposition', alreadyShown: false }),
    false,
  );
});

test('notice: NOT shown again once shown', () => {
  assert.equal(
    shouldShowRemoteCodeNotice({ allowRemoteCode: true, task: 'output_triage', alreadyShown: true }),
    false,
  );
});

test('notice text: names the privacy tradeoff and how to disable', () => {
  const t = remoteCodeNoticeText('gemini-2.5-flash-lite');
  assert.match(t, /gemini-2\.5-flash-lite/);
  assert.match(t, /train/i);
  assert.match(t, /allowRemoteCode/);
});
