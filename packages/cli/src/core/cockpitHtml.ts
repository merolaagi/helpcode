/**
 * Cockpit HTML view — `helpcode cockpit --html`.
 *
 * Reproduces the original orchestration-cockpit mockup's mission-control layout
 * (1fr 2fr 1fr grid: flanking LLM panels, central orchestrator + metrics +
 * pipeline, bottom row of activity/routing panels), filled with REAL data from
 * the sous-chef event log where we have it.
 *
 * Honesty principle: workers that actually ran (local qwen, remote Gemini) are
 * shown live. Panels for providers/features we haven't built (DeepSeek, Kimi,
 * Claude-as-orchestrated, the autonomous pipeline, complexity-based routing)
 * are rendered faithfully to the mockup but marked "demo" — a vision view with
 * real data layered in as we build, not theatre passed off as live.
 *
 * View-model shaping is separated from HTML string-building for unit testing.
 */

import { SousChefEvent, WorkerKind } from '../types.js';
import { summariseWorkers, sessionMetrics, SessionMetrics } from './cockpit.js';

export interface PanelVM {
  model: string;
  kind: WorkerKind;
  tierLabel: string;
  events: number;
  lastSummary: string | null;
  quotaUsed: number | null;
  /** True if this worker is currently throttled (after a 429). Gap #5. */
  throttled?: boolean;
}

export interface FeedItemVM {
  time: string;
  who: string;
  summary: string;
  outcome: SousChefEvent['outcome'];
}

export interface ComingVM { name: string; note: string; }

export interface CliLineVM {
  kind: 'prefix' | 'ok' | 'warn' | 'dim';
  text: string;
}

/** Gap #1: how many of each prep task ran this session. */
export interface TaskBreakdownVM {
  selection: number;
  triage: number;
  decomposition: number;
  other: number;
}

/** Gap #2/#4: the project's current data-sharing posture and provider choice. */
export interface PrivacyVM {
  /** "local-only" | "decomposition-only" | "code-allowed" */
  tier: 'local-only' | 'decomposition-only' | 'code-allowed';
  label: string;
  detail: string;
  /** Preferred remote provider id from config, if set. Gap #4. */
  preferredProvider: string | null;
}

/** Gap #3: a configured provider, whether or not it has run yet. */
export interface AvailableWorkerVM {
  id: string;
  label: string;
  kind: WorkerKind;
  /** Has a key / is reachable-in-principle. */
  available: boolean;
  /** Currently backed off after a 429. */
  throttled: boolean;
  /** Why unavailable, if so (e.g. "no key"). */
  note: string;
}

/** Optional real-world context the command supplies; all fields optional so
 *  the builder still works (degraded) in tests without it. */
export interface CockpitContext {
  privacy?: PrivacyVM;
  available?: AvailableWorkerVM[];
  /** provider id -> throttled?  for marking live panels. */
  throttledIds?: Set<string>;
}

export interface CockpitViewModel {
  workers: PanelVM[];
  metrics: SessionMetrics;
  taskBreakdown: TaskBreakdownVM;
  privacy: PrivacyVM | null;
  available: AvailableWorkerVM[];
  recent: FeedItemVM[];
  cli: CliLineVM[];
  coming: ComingVM[];
  generatedAt: string;
}

const RECENT_CAP = 12;

/** Map a model string back to its provider id, for quota lookup. */
function providerIdFromModel(model: string | null): string | null {
  if (!model) return null;
  if (model.startsWith('gemini')) return 'gemini';
  if (model.startsWith('grok')) return 'grok';
  if (model.startsWith('gpt')) return 'openai';
  return null;
}

function tierLabel(kind: WorkerKind): string {
  switch (kind) {
    case 'local': return 'local';
    case 'remote': return 'free-tier';
    case 'principal': return 'paid';
    case 'deterministic': return 'code';
  }
}

function comingCatalogue(): ComingVM[] {
  return [
    { name: 'Complexity scorer', note: 'route by task difficulty (mockup: 0.87 vs 0.75 threshold)' },
    { name: 'Cross-model review', note: 'one model reviews another before it reaches you' },
    { name: 'More providers', note: 'DeepSeek, Groq, Kimi — each just another SousChef' },
    { name: 'Live quota bars', note: 'real per-provider free-tier usage tracking' },
  ];
}

/** Gap #1: tally events by task type. */
export function computeTaskBreakdown(log: SousChefEvent[]): TaskBreakdownVM {
  const b: TaskBreakdownVM = { selection: 0, triage: 0, decomposition: 0, other: 0 };
  for (const e of log) {
    if (e.task === 'file_selection') b.selection += 1;
    else if (e.task === 'output_triage') b.triage += 1;
    else if (e.task === 'decomposition') b.decomposition += 1;
    else b.other += 1;
  }
  return b;
}

export function buildCockpitViewModel(
  log: SousChefEvent[],
  quotaLookup?: (providerId: string) => number | null,
  context: CockpitContext = {},
): CockpitViewModel {
  const throttledIds = context.throttledIds ?? new Set<string>();
  const workers: PanelVM[] = summariseWorkers(log).map(w => {
    let quotaUsed = w.quotaUsed;
    let throttled = false;
    // For remote workers, look up real quota fraction + throttle by provider id.
    if (w.kind === 'remote') {
      const pid = providerIdFromModel(w.model);
      if (pid) {
        if (quotaLookup) {
          const frac = quotaLookup(pid);
          if (frac !== null) quotaUsed = frac;
        }
        throttled = throttledIds.has(pid);
      }
    }
    return {
      model: w.model ?? tierLabel(w.kind),
      kind: w.kind,
      tierLabel: tierLabel(w.kind),
      events: w.eventsThisSession,
      lastSummary: w.lastSummary,
      quotaUsed,
      throttled,
    };
  });

  const recent: FeedItemVM[] = [...log]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-RECENT_CAP)
    .map(e => ({
      time: e.at.slice(11, 16),
      who: e.model ?? tierLabel(e.worker),
      summary: e.summary,
      outcome: e.outcome,
    }));

  // CLI shell lines: render the real event stream as helpcode terminal output.
  const cli: CliLineVM[] = buildCliLines(log);

  return {
    workers,
    metrics: sessionMetrics(log),
    taskBreakdown: computeTaskBreakdown(log),
    privacy: context.privacy ?? null,
    available: context.available ?? [],
    recent,
    cli,
    coming: comingCatalogue(),
    generatedAt: new Date().toISOString(),
  };
}

/** Map the verb for a task, for terminal-style output. */
function taskVerb(task: SousChefEvent['task']): string {
  switch (task) {
    case 'file_selection': return 'select';
    case 'output_triage': return 'triage';
    case 'decomposition': return 'plan';
    default: return 'prep';
  }
}

/** Turn the real event log into helpcode-shell-style terminal lines. */
export function buildCliLines(log: SousChefEvent[]): CliLineVM[] {
  if (log.length === 0) {
    return [
      { kind: 'prefix', text: '$ helpcode ask "..."' },
      { kind: 'dim', text: '  no sous-chef activity yet this session' },
      { kind: 'dim', text: '  run helpcode ask / plan to put the kitchen to work' },
    ];
  }
  const recent = [...log].sort((a, b) => a.at.localeCompare(b.at)).slice(-8);
  const lines: CliLineVM[] = [];
  for (const e of recent) {
    const who = e.model ?? tierLabel(e.worker);
    const verb = taskVerb(e.task);
    if (e.outcome === 'ok') {
      lines.push({ kind: 'ok', text: `  \u2714 ${verb} \u2192 ${who} (${tierLabel(e.worker)}) \u00b7 ${e.summary}` });
    } else if (e.outcome === 'escalated') {
      lines.push({ kind: 'warn', text: `  \u2191 ${verb} escalated \u2192 principal \u00b7 ${e.summary}` });
    } else {
      lines.push({ kind: 'dim', text: `  \u00b7 ${verb} fell back \u2192 ${who} \u00b7 ${e.summary}` });
    }
  }
  return lines;
}

// --- HTML rendering -------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function badgeFor(kind: WorkerKind): { cls: string; label: string } {
  if (kind === 'remote') return { cls: 'badge-free', label: 'free' };
  if (kind === 'principal') return { cls: 'badge-paid', label: 'paid' };
  if (kind === 'deterministic') return { cls: 'badge-demo', label: 'code' };
  return { cls: 'badge-active', label: 'local' };
}

/** A live worker panel (real data), color-coded by worker kind. */
function livePanel(p: PanelVM): string {
  const b = badgeFor(p.kind);
  // Panel border/glow encodes worker kind: local=cyan(working), remote=green, code=amber.
  const stateClass = p.throttled ? 'throttled'
    : p.kind === 'local' ? 'working'
    : p.kind === 'remote' ? 'remote-active'
    : p.kind === 'deterministic' ? 'fallback-active'
    : 'active';
  // Task chip colour by the kind of work last done (inferred from summary).
  const chipClass = /triag/i.test(p.lastSummary ?? '') ? 'reviewing'
    : /step|breakdown|plan/i.test(p.lastSummary ?? '') ? 'plan'
    : 'writing';
  // Token/usage bar colour by level (matches the original's green/amber/red).
  let fillClass = 'green';
  let pct: number;
  if (p.quotaUsed !== null) {
    pct = Math.round(p.quotaUsed * 100);
    fillClass = pct > 80 ? 'red' : pct > 50 ? 'amber' : 'green';
  } else {
    pct = Math.min(100, p.events * 20);
  }
  const barLabel = p.quotaUsed !== null
    ? `<span>quota</span><span>${pct}%</span>`
    : `<span>tasks</span><span>${p.events}</span>`;
  return `
    <div class="llm-panel ${stateClass}">
      <div class="panel-header">
        <span class="panel-name">${esc(p.model)}</span>
        <span class="panel-tier badge ${b.cls}">${b.label}</span>
      </div>
      <div class="token-bar-wrap"><div class="token-label">${barLabel}</div><div class="token-bar"><div class="token-fill ${fillClass}" style="width:${pct}%"></div></div></div>
      <div class="task-chip ${chipClass}">${p.events} task(s) · ${esc(p.tierLabel)}</div>
      ${p.throttled ? '<div class="panel-throttle">⚠ throttled — backing off after rate limit</div>' : ''}
      <div class="panel-log">
        <div class="log-line"><span class="log-msg ok">${p.lastSummary ? esc(p.lastSummary) : 'idle'}</span></div>
      </div>
    </div>`;
}

/** A demo panel for an unbuilt provider — faithful to the mockup, marked demo. */
function demoPanel(name: string, tier: 'free' | 'paid', note: string): string {
  const cls = tier === 'paid' ? 'badge-paid' : 'badge-free';
  // The paid tier is the principal (Claude) — give it the brick glow, not greyed.
  const panelClass = tier === 'paid' ? 'principal' : 'demo';
  return `
    <div class="llm-panel ${panelClass}">
      <span class="demo-tag">demo</span>
      <div class="panel-header">
        <span class="panel-name">${esc(name)}</span>
        <span class="panel-tier badge ${cls}">${tier}</span>
      </div>
      <div class="token-bar-wrap"><div class="token-label"><span>${tier === 'paid' ? 'principal' : 'quota'}</span><span>—</span></div><div class="token-bar"><div class="token-fill ${tier === 'paid' ? 'red' : 'green'}" style="width:0%"></div></div></div>
      <div class="task-chip idle">${tier === 'paid' ? 'copy-paste · you stay in the loop' : 'not yet built'}</div>
      <div class="panel-log"><div class="log-line"><span class="log-msg">${esc(note)}</span></div></div>
    </div>`;
}

function feedRows(items: FeedItemVM[]): string {
  if (items.length === 0) {
    return '<div class="demo-overlay">No activity yet — run helpcode ask / plan</div>';
  }
  return items.map(i => {
    const cls = i.outcome === 'ok' ? 'ok' : i.outcome === 'escalated' ? 'warn' : '';
    return `<div class="feed-row"><span class="log-ts">${esc(i.time)}</span><span class="log-msg ${cls}">${esc(i.who)}</span><span class="log-msg">${esc(i.summary)}</span></div>`;
  }).join('');
}

/** Gap #2/#4: a full-width privacy posture banner. */
function privacyBannerHtml(p: PrivacyVM | null): string {
  if (!p) return '';
  const cls = p.tier === 'local-only' ? 'priv-local'
    : p.tier === 'decomposition-only' ? 'priv-decomp'
    : 'priv-code';
  const pref = p.preferredProvider
    ? `<span class="priv-pref">preferred provider: ${esc(p.preferredProvider)}</span>`
    : '';
  return `
  <div class="privacy-banner ${cls}">
    <span class="priv-dot"></span>
    <span class="priv-label">${esc(p.label)}</span>
    <span class="priv-detail">${esc(p.detail)}</span>
    ${pref}
  </div>`;
}

/** Gap #1: a compact task-type breakdown strip. */
function taskBreakdownHtml(b: TaskBreakdownVM): string {
  const cell = (label: string, n: number, cls: string) =>
    `<span class="tb-cell"><span class="tb-n ${cls}">${n}</span><span class="tb-l">${label}</span></span>`;
  return `
  <div class="task-breakdown">
    ${cell('selections', b.selection, 'blue')}
    ${cell('triages', b.triage, 'cyan')}
    ${cell('decompositions', b.decomposition, 'purple')}
    ${b.other > 0 ? cell('other', b.other, 'dim') : ''}
  </div>`;
}

/** Gap #3: roster of every configured worker, even idle. */
function availableRosterHtml(workers: AvailableWorkerVM[]): string {
  if (workers.length === 0) return '';
  const row = (w: AvailableWorkerVM) => {
    const state = w.throttled ? 'throttled'
      : w.available ? 'ready' : 'no-key';
    const stateLabel = w.throttled ? 'throttled'
      : w.available ? 'ready' : 'no key';
    return `<div class="roster-row roster-${state}">
      <span class="roster-name">${esc(w.label)}</span>
      <span class="roster-kind">${esc(w.kind)}</span>
      <span class="roster-state">${stateLabel}</span>
    </div>`;
  };
  return workers.map(row).join('');
}

export function renderCockpitHtml(vm: CockpitViewModel): string {
  const m = vm.metrics;
  // Real workers fill the left column (up to 2); a third real worker (or demo) goes right.
  const live = vm.workers.map(livePanel);
  const leftPanels = live.slice(0, 2).join('') || demoPanel('helpcode-local', 'free', 'run a task to populate');
  const rightPanels = [
    live[2] ?? demoPanel('Claude', 'paid', 'the principal · your copy-paste brain'),
    demoPanel('DeepSeek v3', 'free', 'second free provider — coming'),
  ].join('');

  const realCount = vm.workers.length;
  const css = `*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0c10;--bg2:#111318;--bg3:#181b22;--bg4:#1e2129;
  --border:#ffffff14;--border2:#ffffff22;--border3:#ffffff33;
  --text:#e8eaf0;--text2:#9aa0b0;--text3:#5a6070;
  --green:#22c55e;--green2:#16a34a;--green-dim:#052e16;
  --amber:#f59e0b;--amber-dim:#1c1200;
  --blue:#3b82f6;--blue-dim:#0a1628;
  --purple:#a78bfa;--purple-dim:#1a1040;
  --cyan:#06b6d4;--cyan-dim:#042830;
  --red:#ef4444;--red-dim:#1c0a0a;
  --brick:#cc785c;--brick2:#da7756;--brick-dim:#2a1610;
  --font-mono:'JetBrains Mono','Fira Mono','Courier New',monospace;
}
body{background:var(--bg);color:var(--text);font-family:'system-ui',sans-serif;font-size:13px;min-height:800px;padding:12px;display:flex;flex-direction:column;gap:8px;max-width:1400px;margin:0 auto}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg2);border:0.5px solid var(--border);border-radius:8px}
.topbar-left{display:flex;align-items:center;gap:12px}
.logo{font-size:15px;font-weight:500;letter-spacing:-0.3px}
.logo span{color:var(--brick2)}
.badge{font-size:10px;padding:2px 7px;border-radius:4px;font-weight:500;letter-spacing:0.3px}
.badge-free{background:var(--green-dim);color:var(--green);border:0.5px solid var(--green2)}
.badge-paid{background:var(--brick-dim);color:var(--brick2);border:0.5px solid var(--brick)}
.badge-active{background:var(--blue-dim);color:var(--blue);border:0.5px solid #185fa5}
.badge-demo{background:var(--bg3);color:var(--text3);border:0.5px solid var(--border2)}
.topbar-right{display:flex;align-items:center;gap:8px}
.dot{width:7px;height:7px;border-radius:50%;background:var(--green)}
.dot.amber{background:var(--amber)}
.dot.pulse{animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.status-text{font-size:11px;color:var(--text2)}
.privacy-banner{display:flex;align-items:center;gap:10px;padding:7px 14px;border-radius:8px;border:0.5px solid var(--border);font-size:11px}
.privacy-banner .priv-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.privacy-banner .priv-label{font-weight:600;letter-spacing:.3px}
.privacy-banner .priv-detail{color:var(--text2)}
.privacy-banner .priv-pref{margin-left:auto;color:var(--text3);font-size:10px}
.priv-local{background:var(--blue-dim);border-color:var(--blue)}
.priv-local .priv-dot{background:var(--blue)}.priv-local .priv-label{color:var(--blue)}
.priv-decomp{background:var(--green-dim);border-color:var(--green2)}
.priv-decomp .priv-dot{background:var(--green)}.priv-decomp .priv-label{color:var(--green)}
.priv-code{background:var(--brick-dim);border-color:var(--brick)}
.priv-code .priv-dot{background:var(--brick2)}.priv-code .priv-label{color:var(--brick2)}
.task-breakdown{display:flex;gap:18px;padding:6px 10px;background:var(--bg3);border-radius:6px}
.tb-cell{display:flex;align-items:baseline;gap:5px}
.tb-n{font-size:14px;font-weight:600}
.tb-n.blue{color:var(--blue)}.tb-n.cyan{color:var(--cyan)}.tb-n.purple{color:var(--purple)}.tb-n.dim{color:var(--text3)}
.tb-l{font-size:10px;color:var(--text3)}
.roster-row{display:flex;align-items:center;gap:8px;font-size:10px;padding:4px 6px;border-radius:4px;margin-bottom:3px;background:var(--bg3)}
.roster-name{flex:1;color:var(--text)}
.roster-kind{color:var(--text3);font-size:9px}
.roster-state{font-size:9px;padding:1px 6px;border-radius:3px}
.roster-ready .roster-state{background:var(--green-dim);color:var(--green)}
.roster-no-key{opacity:.5}
.roster-no-key .roster-state{background:var(--bg4);color:var(--text3)}
.roster-throttled .roster-state{background:var(--amber-dim);color:var(--amber)}
.llm-panel.throttled{border-color:var(--amber)!important}
.panel-throttle{font-size:9px;color:var(--amber);margin-top:2px}
.cockpit{display:grid;grid-template-columns:1fr 2fr 1fr;grid-template-rows:auto auto;gap:8px;flex:1}
.llm-panel{background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:6px;min-height:160px;position:relative}
.llm-panel.active{border-color:var(--border2)}
.llm-panel.working{border-color:var(--cyan);box-shadow:0 0 0 1px var(--cyan-dim)}
.llm-panel.remote-active{border-color:var(--green2);box-shadow:0 0 0 1px var(--green-dim)}
.llm-panel.fallback-active{border-color:var(--amber);box-shadow:0 0 0 1px var(--amber-dim)}
.llm-panel.principal{border-color:var(--brick);box-shadow:0 0 0 1px var(--brick-dim);opacity:.7}
.llm-panel.demo{opacity:.5}
.demo-tag{position:absolute;top:8px;right:8px;font-size:8px;padding:1px 5px;border-radius:3px;background:var(--bg4);color:var(--text3);border:0.5px solid var(--border2);text-transform:uppercase;letter-spacing:.5px}
.panel-header{display:flex;align-items:center;justify-content:space-between}
.panel-name{font-size:11px;font-weight:500;color:var(--text2);letter-spacing:0.4px;text-transform:uppercase}
.panel-tier{font-size:9px;padding:1px 5px;border-radius:3px}
.token-bar-wrap{display:flex;flex-direction:column;gap:2px}
.token-label{display:flex;justify-content:space-between;font-size:9px;color:var(--text3)}
.token-bar{height:3px;background:var(--bg4);border-radius:2px;overflow:hidden}
.token-fill{height:100%;border-radius:2px;transition:width 1.2s ease}
.token-fill.green{background:var(--green)}
.token-fill.amber{background:var(--amber)}
.token-fill.blue{background:var(--blue)}
.token-fill.red{background:var(--red)}
.panel-log{flex:1;font-family:var(--font-mono);font-size:9px;color:var(--text3);line-height:1.6;overflow:hidden;display:flex;flex-direction:column;padding-top:2px}
.log-line{display:flex;gap:4px}
.log-ts{color:var(--text3);flex-shrink:0}
.log-msg{color:var(--text2)}
.log-msg.ok{color:var(--green)}
.log-msg.warn{color:var(--amber)}
.log-msg.info{color:var(--cyan)}
.task-chip{display:inline-flex;align-items:center;gap:4px;font-size:9px;padding:2px 6px;border-radius:3px;margin-top:2px;border:0.5px solid}
.task-chip.writing{background:var(--blue-dim);color:var(--blue);border-color:var(--blue)}
.task-chip.reviewing{background:var(--purple-dim);color:var(--purple);border-color:var(--purple)}
.task-chip.plan{background:var(--cyan-dim);color:var(--cyan);border-color:var(--cyan)}
.task-chip.idle{background:var(--bg3);color:var(--text3);border-color:var(--border)}
.center-col{display:flex;flex-direction:column;gap:8px}
.orchestrator{background:var(--bg2);border:0.5px solid var(--border2);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px;position:relative}
.orch-header{display:flex;align-items:center;justify-content:space-between}
.orch-title{font-size:12px;font-weight:500;color:var(--cyan)}
.orch-subtitle{font-size:10px;color:var(--text3)}
.pipeline{display:flex;flex-direction:column;gap:4px}
.pipe-row{display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg3);border-radius:5px;border:0.5px solid var(--border)}
.pipe-num{font-size:9px;color:var(--text3);width:14px;flex-shrink:0;font-family:var(--font-mono)}
.pipe-name{font-size:10px;color:var(--text);flex:1;font-weight:500}
.pipe-assign{font-size:9px;color:var(--text3)}
.pipe-status{font-size:9px;padding:1px 5px;border-radius:3px;flex-shrink:0;font-weight:500}
.pipe-status.done{background:var(--green-dim);color:var(--green)}
.pipe-status.queued{background:var(--bg4);color:var(--text3)}
.pipe-arrow{font-size:8px;color:var(--text3);flex-shrink:0}
.metrics-row{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.metric{background:var(--bg3);border-radius:6px;padding:7px 10px;display:flex;flex-direction:column;gap:2px}
.metric-label{font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:0.4px}
.metric-val{font-size:17px;font-weight:500;color:var(--text);line-height:1}
.metric-sub{font-size:9px;color:var(--text3)}
.metric-val.green{color:var(--green)}
.metric-val.amber{color:var(--amber)}
.metric-val.blue{color:var(--blue)}
.metric-val.purple{color:var(--purple)}
.cli-panel{background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:10px;flex:1;display:flex;flex-direction:column}
.cli-header{font-size:10px;color:var(--text3);margin-bottom:6px;display:flex;align-items:center;gap:6px}
.cli-dot{width:6px;height:6px;border-radius:50%}
.cli-output{flex:1;font-family:var(--font-mono);font-size:10px;line-height:1.7;color:var(--text2);overflow:hidden}
.cli-line-prefix{color:var(--cyan)}
.cli-line-ok{color:var(--green)}
.cli-line-warn{color:var(--amber)}
.cli-line-dim{color:var(--text3)}
.cli-input-row{display:flex;align-items:center;gap:6px;margin-top:8px;border-top:0.5px solid var(--border);padding-top:8px}
.cli-prompt{font-family:var(--font-mono);font-size:10px;color:var(--cyan);flex-shrink:0}
.cli-input{flex:1;background:transparent;border:none;outline:none;font-family:var(--font-mono);font-size:10px;color:var(--text3)}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.cursor{animation:blink 1s step-end infinite;color:var(--cyan)}
.bottom-row{display:grid;grid-template-columns:1fr 2fr 1fr;gap:8px}
.side-panel{background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:6px;position:relative}
.side-panel.live{border-left:2px solid var(--green)}
.side-panel.routing{border-left:2px solid var(--cyan)}
.side-panel.roadmap{border-left:2px solid var(--text3);opacity:.7}
.side-title{font-size:10px;font-weight:500;color:var(--text2);display:flex;align-items:center;gap:5px}
.feed-row{display:flex;gap:6px;font-size:9px;padding:3px 0;border-bottom:0.5px solid var(--border);font-family:var(--font-mono)}
.feed-row:last-child{border-bottom:none}
.router-rule{display:flex;align-items:center;gap:6px;font-size:9px;padding:4px 6px;background:var(--bg3);border-radius:4px}
.router-cond{color:var(--text2);flex:1}
.router-then{color:var(--cyan)}
.router-arrow{color:var(--text3)}
.demo-overlay{font-size:8px;color:var(--text3);text-align:center;padding-top:4px;font-style:italic}
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{display:inline-block;animation:spin 1s linear infinite;font-size:10px}
footer{color:var(--text3);font-size:10px;margin-top:4px;padding:8px 4px;text-align:center}`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>helpcode cockpit</title>
<style>${css}</style></head>
<body>
<h2 class="sr-only">helpcode cockpit — sous-chef kitchen, real activity plus roadmap</h2>

<div class="topbar">
  <div class="topbar-left">
    <span class="logo">help<span>code</span></span>
    <span class="badge badge-active">cockpit</span>
    <span class="badge badge-free">${realCount} worker(s) active</span>
  </div>
  <div class="topbar-right">
    <div class="dot pulse"></div>
    <span class="status-text">${m.totalEvents} prep task(s) this session · ~${m.estTokensSaved} principal tokens saved</span>
  </div>
</div>
${privacyBannerHtml(vm.privacy)}

<div class="cockpit">
  <div style="display:flex;flex-direction:column;gap:8px">${leftPanels}</div>

  <div class="center-col">
    <div class="metrics-row">
      <div class="metric"><span class="metric-label">prep tasks</span><span class="metric-val blue">${m.totalEvents}</span><span class="metric-sub">this session</span></div>
      <div class="metric"><span class="metric-label">escalated</span><span class="metric-val amber">${m.escalations}</span><span class="metric-sub">to principal</span></div>
      <div class="metric"><span class="metric-label">fell back</span><span class="metric-val purple">${m.fallbacks}</span><span class="metric-sub">to cheaper</span></div>
      <div class="metric"><span class="metric-label">tokens saved</span><span class="metric-val green">~${m.estTokensSaved}</span><span class="metric-sub">principal</span></div>
    </div>
    ${taskBreakdownHtml(vm.taskBreakdown)}

    <div class="orchestrator">
      <span class="demo-tag">demo</span>
      <div class="orch-header">
        <div>
          <div class="orch-title">orchestrator · autonomous pipeline</div>
          <div class="orch-subtitle">vision: decompose → assign → escalate (not yet built)</div>
        </div>
        <span class="badge badge-demo">roadmap</span>
      </div>
      <div class="pipeline">
        <div class="pipe-row"><span class="pipe-num">01</span><span class="pipe-name">decompose task → subtasks</span><span class="pipe-assign">local</span><span class="pipe-arrow">→</span><span class="pipe-status done">live</span></div>
        <div class="pipe-row"><span class="pipe-num">02</span><span class="pipe-name">assign by complexity score</span><span class="pipe-assign">router</span><span class="pipe-arrow">→</span><span class="pipe-status queued">coming</span></div>
        <div class="pipe-row"><span class="pipe-num">03</span><span class="pipe-name">cross-model review</span><span class="pipe-assign">peer</span><span class="pipe-arrow">→</span><span class="pipe-status queued">coming</span></div>
        <div class="pipe-row"><span class="pipe-num">04</span><span class="pipe-name">escalate hard subtasks → principal</span><span class="pipe-assign">you (paste)</span><span class="pipe-arrow">→</span><span class="pipe-status queued">coming</span></div>
      </div>
    </div>

    <div class="cli-panel">
      <div class="cli-header">
        <div class="cli-dot" style="background:#ef4444"></div>
        <div class="cli-dot" style="background:#f59e0b"></div>
        <div class="cli-dot" style="background:#22c55e"></div>
        <span style="margin-left:6px;font-size:10px;color:var(--text3)">helpcode · sous-chef shell · live</span>
      </div>
      <div class="cli-output">
        ${vm.cli.map(l => `<div class="cli-line-${l.kind}">${esc(l.text)}</div>`).join('')}
      </div>
      <div class="cli-input-row">
        <span class="cli-prompt">\u276f</span>
        <span class="cli-input">helpcode cockpit<span class="cursor">_</span></span>
      </div>
    </div>
  </div>

  <div style="display:flex;flex-direction:column;gap:8px">${rightPanels}</div>
</div>

<div class="bottom-row">
  <div class="side-panel live">
    <div class="side-title">recent activity · live</div>
    ${feedRows(vm.recent)}
  </div>

  <div class="side-panel routing">
    <span class="demo-tag">part live</span>
    <div class="side-title">routing rules · current policy</div>
    <div class="router-rule"><span class="router-cond">no code, no key</span><span class="router-arrow">→</span><span class="router-then">local only (live)</span></div>
    <div class="router-rule"><span class="router-cond">key, no opt-in</span><span class="router-arrow">→</span><span class="router-then">remote: decomposition only (live)</span></div>
    <div class="router-rule"><span class="router-cond">allowRemoteCode on</span><span class="router-arrow">→</span><span class="router-then">remote: code tasks too (live)</span></div>
    <div class="router-rule"><span class="router-cond">complexity &gt; threshold</span><span class="router-arrow">→</span><span class="router-then">escalate to principal (coming)</span></div>
    <div class="demo-overlay">first three rules are live; complexity routing is roadmap</div>
  </div>

  <div class="side-panel routing">
    <div class="side-title">workers available · live</div>
    ${availableRosterHtml(vm.available) || '<div class="demo-overlay">run helpcode init to configure workers</div>'}
  </div>
</div>

<footer>helpcode · principal + sous-chefs · live panels reflect this project's real activity; "demo" panels show the roadmap. generated ${esc(vm.generatedAt.slice(0, 16).replace('T', ' '))}</footer>
</body></html>`;
}
