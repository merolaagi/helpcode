/**
 * `helpcode cockpit` — show the kitchen this session.
 *
 * Read-only window onto the sous-chef event log: which workers did which prep
 * tasks, what was escalated to the principal, rough tokens saved. v0.3.0.
 */

import { loadState } from '../core/state.js';
import { renderCockpit } from '../core/cockpit.js';

export async function handleCockpit(): Promise<number> {
  const state = loadState();
  console.log(renderCockpit(state.sousChefLog));
  return 0;
}
