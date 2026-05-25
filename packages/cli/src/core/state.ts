/**
 * Persistent agent state. Stored at .helpcode/state.json.
 *
 * State is intentionally readable JSON. Users can `cat` it to see exactly
 * what helpcode is thinking. No black-box memory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentState, CurrentTask } from '../types.js';
import { HelpcodeError, ErrorCode } from '../lib/errors.js';

const STATE_DIR = '.helpcode';
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function emptyState(): AgentState {
  return {
    version: 1,
    currentTask: null,
    history: [],
  };
}

export function loadState(cwd: string = process.cwd()): AgentState {
  const file = path.join(cwd, STATE_FILE);
  if (!fs.existsSync(file)) {
    return emptyState();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (parsed.version !== 1) {
      throw new HelpcodeError(
        ErrorCode.STATE_ERROR,
        `Unknown state version: ${parsed.version}`,
        'This state was written by a different helpcode version. Run `helpcode reset` to start fresh.',
      );
    }
    return parsed as AgentState;
  } catch (e) {
    if (e instanceof HelpcodeError) throw e;
    throw new HelpcodeError(
      ErrorCode.STATE_ERROR,
      `Could not parse state file: ${(e as Error).message}`,
      'Run `helpcode reset` to start fresh (this won\'t touch your code).',
    );
  }
}

export function saveState(state: AgentState, cwd: string = process.cwd()): void {
  const dir = path.join(cwd, STATE_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(cwd, STATE_FILE);
  const tmp = `${file}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
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
