/**
 * One-time consent notice for sending source code to a remote free tier (v0.3.2).
 *
 * The privacy gate (core/souschef.ts) decides whether a task MAY go remote. This
 * module decides whether to SHOW THE USER A NOTICE the first time code actually
 * leaves the machine to a free tier — informed consent, per the design doc.
 *
 * The notice fires when ALL of:
 *   - allowRemoteCode is on (the user opted in)
 *   - the task is code-bearing (not decomposition, which never sends code)
 *   - we haven't already shown it (tracked in state)
 */

import { SousChefTask } from '../types.js';

export interface RemoteCodeNoticeInput {
  allowRemoteCode: boolean;
  task: SousChefTask;
  alreadyShown: boolean;
}

/** Code-bearing tasks — these send source code, unlike decomposition. */
function isCodeBearing(task: SousChefTask): boolean {
  return task !== 'decomposition';
}

export function shouldShowRemoteCodeNotice(input: RemoteCodeNoticeInput): boolean {
  if (!input.allowRemoteCode) return false;
  if (!isCodeBearing(input.task)) return false;
  if (input.alreadyShown) return false;
  return true;
}

export function remoteCodeNoticeText(model: string): string {
  return [
    'Heads up: allowRemoteCode is on, so helpcode is about to send source code',
    `to a remote free tier (${model}). Free-tier providers may use your inputs to`,
    'train their models. Only proceed if you accept your code leaving this machine.',
    'Disable any time by setting "allowRemoteCode": false in .helpcode/project.json.',
  ].join('\n');
}
