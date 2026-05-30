/**
 * Persistent agent state. Stored at .helpcode/state.json.
 *
 * State is intentionally readable JSON. Users can `cat` it to see exactly
 * what helpcode is thinking. No black-box memory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentState, CurrentTask, SousChefEvent } from '../types.js';
import { HelpcodeError, ErrorCode } from '../lib/errors.js';

const STATE_DIR = '.helpcode';
const STATE_FILE = path.join(STATE_DIR, 'state.json');

/** Keep the sous-chef log bounded so state.json stays small. */
const MAX_SOUSCHEF_EVENTS = 50;

function emptyState(): AgentState {
  return {
    version: 2,
    currentTask: null,
    history: [],
    sousChefLog: [],
  };
}

export function loadState(cwd: string = process.cwd()): AgentState {
  const file = path.join(cwd, STATE_FILE);
  if (!fs.existsSync(file)) {
    return emptyState();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return migrate(parsed);
  } catch (e) {
    if (e instanceof HelpcodeError) throw e;
    throw new HelpcodeError(
      ErrorCode.STATE_ERROR,
      `Could not parse state file: ${(e as Error).message}`,
      'Run `helpcode reset` to start fresh (this won\'t touch your code).',
    );
  }
}

/**
 * Migrate older state forward. v1 had no sousChefLog; we add an empty one and
 * bump the version rather than erroring, so existing installs keep working.
 */
function migrate(parsed: any): AgentState {
  if (parsed.version === 2) {
    // Defensive: ensure the log array exists even if hand-edited away.
    if (!Array.isArray(parsed.sousChefLog)) parsed.sousChefLog = [];
    return parsed as AgentState;
  }
  if (parsed.version === 1) {
    return {
      version: 2,
      currentTask: parsed.currentTask ?? null,
      history: Array.isArray(parsed.history) ? parsed.history : [],
      sousChefLog: [],
    };
  }
  throw new HelpcodeError(
    ErrorCode.STATE_ERROR,
    `Unknown state version: ${parsed.version}`,
    'This state was written by a newer helpcode. Upgrade, or run `helpcode reset`.',
  );
}

export function saveState(state: AgentState, cwd: string = process.cwd()): void {
  const dir = path.join(cwd, STATE_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(cwd, STATE_FILE);
  const tmp = `${file}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

/**
 * Append a sous-chef event to an in-memory state object (capped). Use this
 * when the caller already holds a loaded state and will saveState() itself —
 * avoids the read-modify-write clobber of two independent load/save cycles.
 */
export function appendSousChefEvent(state: AgentState, event: SousChefEvent): void {
  state.sousChefLog.push(event);
  if (state.sousChefLog.length > MAX_SOUSCHEF_EVENTS) {
    state.sousChefLog = state.sousChefLog.slice(-MAX_SOUSCHEF_EVENTS);
  }
}

/**
 * Append a sous-chef event and persist immediately. Use this only when the
 * caller does NOT already hold a state it will save (standalone recording).
 * If you have a loaded state, prefer appendSousChefEvent + your own saveState.
 */
export function recordSousChefEvent(
  event: SousChefEvent,
  cwd: string = process.cwd(),
): void {
  const state = loadState(cwd);
  appendSousChefEvent(state, event);
  saveState(state, cwd);
}

export function createTask(description: string): CurrentTask {
  const now = new Date().toISOString();
  return {
    id: `task-${now.replace(/[:.]/g, '-')}`,
    description,
    createdAt: now,
    iterations: 0,
    status: 'idle',
    lastPrompt: null,
    lastResponseRaw: null,
    lastTestOutput: null,
    lastDiffsApplied: [],
  };
}

export function resetState(cwd: string = process.cwd()): void {
  saveState(emptyState(), cwd);
}
