/**
 * `helpcode cockpit` — show the kitchen this session.
 *
 * Read-only window onto the sous-chef event log: which workers did which prep
 * tasks, what was escalated to the principal, rough tokens saved.
 *
 *   helpcode cockpit            terminal view (v0.3.0)
 *   helpcode cockpit --html     write a self-contained HTML cockpit (v0.3.4)
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadState } from '../core/state.js';
import { renderCockpit } from '../core/cockpit.js';
import { buildCockpitViewModel, renderCockpitHtml } from '../core/cockpitHtml.js';
import { c, log } from '../lib/ui.js';

export async function handleCockpit(opts: { html?: boolean; out?: string } = {}): Promise<number> {
  const state = loadState();

  if (opts.html) {
    const vm = buildCockpitViewModel(state.sousChefLog);
    const html = renderCockpitHtml(vm);
    const outPath = opts.out ?? path.join('.helpcode', 'cockpit.html');
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outPath, html, 'utf-8');
    log.ok(`wrote cockpit to ${outPath}`);
    log.dim('open it in a browser: ' + c.cyan(`open ${outPath}`));
    return 0;
  }

  console.log(renderCockpit(state.sousChefLog));
  return 0;
}
