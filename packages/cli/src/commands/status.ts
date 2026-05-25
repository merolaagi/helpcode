/**
 * `helpcode status` — show what the agent thinks the current state is.
 */

import { loadState } from '../core/state.js';
import { loadProjectConfig } from '../core/project.js';
import { c, log } from '../lib/ui.js';

export async function handleStatus(): Promise<number> {
  let projectLine = '(not initialised — run `helpcode init`)';
  try {
    const cfg = loadProjectConfig();
    projectLine = `${cfg.language}${cfg.framework ? ' / ' + cfg.framework : ''}`;
  } catch {
    // not initialised
  }

  const state = loadState();
  console.log(`${c.bold('project:')} ${projectLine}`);

  if (!state.currentTask) {
    console.log(`${c.bold('task:')}    ${c.dim('(none)')}`);
    console.log();
    log.dim('Run `helpcode ask "your task"` to start.');
    return 0;
  }

  const t = state.currentTask;
  console.log(`${c.bold('task:')}    ${t.description}`);
  console.log(`${c.dim('  id:')}       ${t.id}`);
  console.log(`${c.dim('  status:')}   ${formatStatus(t.status)}`);
  console.log(`${c.dim('  iters:')}    ${t.iterations}`);
  console.log(`${c.dim('  created:')}  ${t.createdAt}`);

  if (t.lastDiffsApplied.length > 0) {
    console.log();
    console.log(c.bold('last applied:'));
    for (const d of t.lastDiffsApplied) {
      const mark = d.ok ? c.green('✓') : c.red('✗');
      const tag = d.created ? c.dim(' (new)') : '';
      console.log(`  ${mark} ${d.filepath}${tag}`);
    }
  }

  if (state.history.length > 0) {
    console.log();
    console.log(c.dim(`history: ${state.history.length} resolved task(s)`));
  }
  return 0;
}

function formatStatus(s: string): string {
  switch (s) {
    case 'awaiting_paste': return c.yellow(s);
    case 'resolved':       return c.green(s);
    case 'failed':         return c.red(s);
    default:               return s;
  }
}
