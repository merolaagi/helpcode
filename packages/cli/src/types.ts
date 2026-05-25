/**
 * Shared types used across the helpcode CLI.
 *
 * Kept in one file so contributors can read the data model in one place.
 */

/** What kind of project the user is in. Detected by `init`, stored on disk. */
export interface ProjectConfig {
  /** Absolute path to the project root. */
  root: string;
  /** Primary language detected. */
  language: 'python' | 'javascript' | 'typescript' | 'unknown';
  /** Framework, if obvious. */
  framework: string | null;
  /** Command (as a single string) the user's test runner expects. */
  testCommand: string | null;
  /** Source dirs to consider when selecting context. */
  sourceDirs: string[];
  /** When this config was written. */
  createdAt: string;
}

/** Status of the current iteration with Claude. */
export type TaskStatus =
  | 'idle'
  | 'awaiting_paste'    // prompt has been generated, user pastes Claude's reply next
  | 'applying'          // diffs being applied
  | 'testing'           // tests running after apply
  | 'resolved'          // last apply was clean
  | 'failed';           // last apply or test broke something

/** The agent's memory across CLI invocations. Stored at .helpcode/state.json. */
export interface AgentState {
  /** Schema version so we can migrate later without breaking installs. */
  version: 1;
  currentTask: CurrentTask | null;
  /** History of resolved tasks (summary only, not full content). */
  history: TaskHistoryEntry[];
}

export interface CurrentTask {
  id: string;
  description: string;
  createdAt: string;
  iterations: number;
  status: TaskStatus;
  /** Last prompt generated for Claude. */
  lastPrompt: string | null;
  /** Raw last response from Claude (as pasted by the user). */
  lastResponseRaw: string | null;
  /** Last captured test output, compacted. */
  lastTestOutput: string | null;
  /** Files touched by the most recent apply. */
  lastDiffsApplied: AppliedDiff[];
}

export interface AppliedDiff {
  filepath: string;
  hunks: number;
  ok: boolean;
  created: boolean;
}

export interface TaskHistoryEntry {
  id: string;
  description: string;
  resolvedAt: string;
  iterations: number;
}
