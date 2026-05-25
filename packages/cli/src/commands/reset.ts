/**
 * `helpcode reset` — clear the current task and history.
 * Does NOT touch project config or any source files.
 */

import { resetState } from '../core/state.js';
import { confirm, log } from '../lib/ui.js';

export interface ResetOptions {
  yes?: boolean;
}

export async function handleReset(opts: ResetOptions = {}): Promise<number> {
  if (!opts.yes) {
    const ok = await confirm('Clear current task and history? (project config is untouched)');
    if (!ok) {
      log.dim('Cancelled.');
      return 0;
    }
  }
  resetState();
  log.ok('State cleared. Project config and source files are untouched.');
  return 0;
}
