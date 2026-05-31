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
import { loadProjectConfig, projectExists } from '../core/project.js';
import { renderCockpit } from '../core/cockpit.js';
import { buildCockpitViewModel, renderCockpitHtml, CockpitContext } from '../core/cockpitHtml.js';
import { computePrivacy, computeAvailableWorkers } from '../core/cockpitContext.js';
import { quotaFor, isThrottled } from '../core/quota.js';
import { c, log } from '../lib/ui.js';

export async function handleCockpit(opts: { html?: boolean; out?: string } = {}): Promise<number> {
  const state = loadState();

  if (opts.html) {
    // Real quota fraction per provider, for the panel bars.
    const quotaLookup = (providerId: string): number | null => {
      if (!state.quotas) return null;
      const s = quotaFor(state.quotas, providerId);
      if (!s || s.limitPerDay === null) return null;
      return s.usedToday / s.limitPerDay;
    };

    // Real-world context: privacy tier, full worker roster, throttle states.
    const quotas = state.quotas ?? { providers: {} };
    let context: CockpitContext = {};
    if (projectExists()) {
      const config = loadProjectConfig();
      const throttledIds = new Set<string>(
        ['gemini', 'grok', 'openai'].filter(id => isThrottled(quotas, id)),
      );
      context = {
        privacy: computePrivacy(config, process.env),
        available: computeAvailableWorkers(config, process.env, quotas),
        throttledIds,
      };
    }

    const vm = buildCockpitViewModel(state.sousChefLog, quotaLookup, context);
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
