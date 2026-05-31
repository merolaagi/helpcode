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
  /** Optional local-LLM (Ollama) settings for smarter file selection (v0.2). */
  ollama?: OllamaSettings;
  /** Optional remote free-tier sous-chef settings (v0.3.2). */
  remote?: RemoteSettings;
}

/**
 * Remote free-tier sous-chef configuration (v0.3.2). Opt-in by presence of an
 * API key (env var or .helpcode/keys.json) — this block only carries the
 * privacy preference, never the key itself (keys must never touch project.json).
 */
export interface RemoteSettings {
  /**
   * Allow code-bearing tasks (file selection, output triage) to be sent to a
   * remote FREE-TIER provider, whose terms may use inputs to train their models.
   * Default false: by default only decomposition (task description, no code)
   * goes remote. Flip to true ONLY if you accept your source code leaving the
   * machine to a free tier. A one-time notice is shown the first time it takes
   * effect.
   */
  allowRemoteCode: boolean;
  /**
   * Preferred remote provider id ("gemini" | "kimi" | "grok" | "openai"). If
   * set and that provider has a key, it's used; otherwise helpcode falls back
   * to priority order among providers that have keys.
   */
  provider?: string;
}

/** Local-LLM configuration. Opt-in; absent or disabled = heuristic only. */
export interface OllamaSettings {
  /** When true, file selection uses the local model (with heuristic fallback). */
  enabled: boolean;
  /** Model tag, e.g. "qwen2.5-coder:7b". User-editable. */
  model: string;
  /** Ollama server URL. */
  host: string;
  /** Generation timeout in milliseconds. */
  timeoutMs: number;
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
  version: 2;
  currentTask: CurrentTask | null;
  /** History of resolved tasks (summary only, not full content). */
  history: TaskHistoryEntry[];
  /**
   * Rolling log of sous-chef work this session (v0.3). The cockpit reads this;
   * the tasks (and future engine) append to it. Capped to a recent window so
   * the state file stays small.
   */
  sousChefLog: SousChefEvent[];
  /** One-time UI flags (e.g. consent notices already shown). Optional. */
  flags?: StateFlags;
}

/** One-time flags persisted so we don't repeat notices. All optional. */
export interface StateFlags {
  /** True once the "sending code to a free tier" notice has been shown. */
  remoteCodeNoticeShown?: boolean;
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

// ---------------------------------------------------------------------------
// v0.3 cockpit model
//
// The cockpit is the instrument panel for helpcode's "kitchen": which worker
// (sous-chef) did which prep task, and what got escalated to the principal
// (Claude.ai). v0.3.0 builds the *window* — it reads these events and renders
// them. The eventual engine writes the same events when it dispatches work, so
// the window and the engine share one model. Design the model now as if the
// engine exists; wire only the reading + the existing tasks' writing for now.
// ---------------------------------------------------------------------------

/** Who did a unit of prep work. */
export type WorkerKind =
  | 'local'        // an Ollama model on this machine
  | 'remote'       // a free-tier remote API sous-chef (v0.3.2+)
  | 'deterministic'// plain code, no model (e.g. keyword heuristic, truncation)
  | 'principal';   // the principal helper (Claude.ai) — the escalation target

/** A prep task helpcode knows how to route to a worker. */
export type SousChefTask =
  | 'file_selection'
  | 'output_triage'
  | 'decomposition'   // v0.3.1
  | 'other';

/** One recorded unit of work, written by whoever performed it. */
export interface SousChefEvent {
  /** ISO timestamp. */
  at: string;
  /** Which prep task. */
  task: SousChefTask;
  /** Who did it. */
  worker: WorkerKind;
  /** Model tag if a model did it (e.g. "qwen2.5-coder:7b"), else null. */
  model: string | null;
  /** One-line human-readable summary of what happened. */
  summary: string;
  /** Did this work succeed, or fall back to a cheaper worker? */
  outcome: 'ok' | 'fallback' | 'escalated';
  /** Rough estimate of principal tokens this prep saved, if known. */
  estTokensSaved: number | null;
}

/** Per-worker rolling status for the cockpit panels. */
export interface WorkerStatus {
  kind: WorkerKind;
  model: string | null;
  /** Free-tier quota used 0..1, if the worker has a quota (remote). null = N/A. */
  quotaUsed: number | null;
  /** Count of events this session. */
  eventsThisSession: number;
  /** Last summary line, for the panel log. */
  lastSummary: string | null;
}
