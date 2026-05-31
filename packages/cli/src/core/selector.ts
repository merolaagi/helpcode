/**
 * File selection — pick the files most likely relevant to a task.
 *
 * Two strategies:
 *   - heuristic (v0.1): filename match + content keyword + recency. Always
 *     available, synchronous, no dependencies.
 *   - llm (v0.2): a local model reasons about which files matter. Used only
 *     when Ollama is enabled in project.json AND reachable. Falls back to
 *     the heuristic on ANY failure.
 *
 * `selectFilesWithStrategy` is the entry point the `ask` command uses. The
 * old synchronous `selectFiles` (heuristic) is preserved as the fallback and
 * for callers that want the heuristic explicitly.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig } from '../types.js';
import { isOllamaReachable } from './ollama.js';
import { llmSelectFiles, selectFilesWithGenerate } from './llmSelector.js';
import { geminiGenerate } from './gemini.js';
import { loadGeminiKey } from './keys.js';
import { shouldShowRemoteCodeNotice, remoteCodeNoticeText } from './consent.js';
import { loadState, saveState } from './state.js';
import { SousChefTask } from '../types.js';

const REMOTE_SELECTION_MODEL = 'gemini-2.5-flash-lite';

/**
 * Show the one-time "code is leaving the machine to a free tier" notice if it
 * hasn't been shown before, and persist that it has. Best-effort; never throws.
 */
function maybeShowRemoteCodeNotice(task: SousChefTask, model: string): void {
  try {
    const state = loadState();
    const alreadyShown = state.flags?.remoteCodeNoticeShown === true;
    if (shouldShowRemoteCodeNotice({ allowRemoteCode: true, task, alreadyShown })) {
      // eslint-disable-next-line no-console
      console.error('\n' + remoteCodeNoticeText(model) + '\n');
      state.flags = { ...(state.flags ?? {}), remoteCodeNoticeShown: true };
      saveState(state);
    }
  } catch {
    // never block selection on the notice
  }
}

const IGNORE_DIRS = new Set([
  '.git', '.venv', 'venv', 'env', 'node_modules', '__pycache__',
  '.pytest_cache', '.mypy_cache', 'dist', 'build', '.next',
  '.idea', '.vscode', '.helpcode', 'coverage', '.cache',
]);

const SOURCE_EXTS = new Set([
  '.py', '.js', '.ts', '.jsx', '.tsx', '.sh', '.rb', '.go',
  '.java', '.rs', '.c', '.cpp', '.h', '.hpp',
]);

const MAX_RESULTS = 6;
const RECENCY_WINDOW_DAYS = 14;
const LLM_CANDIDATE_CAP = 60;   // cap files sent to the model (design §3.1)

interface FileScore {
  filepath: string;
  score: number;
}

/** How a file was chosen. `reason` is populated for the LLM strategy. */
export interface SelectedFile {
  /** Absolute path. */
  filepath: string;
  /** Why it was chosen (LLM reasoning, or a short heuristic note). */
  reason: string;
}

export interface SelectionResult {
  files: SelectedFile[];
  /** Which strategy actually produced the result. */
  strategy: 'llm' | 'remote' | 'heuristic';
  /** If the LLM was attempted but fell back, why. Empty otherwise. */
  fallbackReason: string;
  /** For the remote strategy: the model used (for the cockpit). */
  remoteModel?: string;
}

/**
 * The entry point used by `ask`. Chooses, cheapest-first:
 *   local LLM (Ollama) → remote free-tier (if opted in) → keyword heuristic.
 * Never throws — any model failure degrades to the next option with a reason.
 *
 * The remote branch only runs when allowRemoteCode is on AND a key is present:
 * file selection sends file signatures (code), so it's privacy-gated.
 */
export async function selectFilesWithStrategy(
  taskDescription: string,
  config: ProjectConfig,
  opts: { forceHeuristic?: boolean } = {},
): Promise<SelectionResult> {
  const ollama = config.ollama;
  const wantLlm = !opts.forceHeuristic && ollama?.enabled === true;

  if (wantLlm && ollama) {
    const reachable = await isOllamaReachable(ollama.host, { timeoutMs: 1000 });
    if (reachable) {
      try {
        const allFiles = walkAllSourceFiles(config).slice(0, LLM_CANDIDATE_CAP);
        const selections = await llmSelectFiles(taskDescription, allFiles, config.root, {
          host: ollama.host,
          model: ollama.model,
          count: MAX_RESULTS,
          timeoutMs: ollama.timeoutMs,
        });
        if (selections.length > 0) {
          const files: SelectedFile[] = selections.map(s => ({
            filepath: path.join(config.root, s.path),
            reason: s.reason,
          }));
          return { files, strategy: 'llm', fallbackReason: '' };
        }
        // fall through to remote/heuristic
      } catch {
        // fall through to remote/heuristic
      }
    }
  }

  // Remote branch: only if NOT forcing heuristic, the project opted into
  // sending code remotely, and a key is configured. Selection sends code
  // (file signatures), so the privacy gate requires allowRemoteCode.
  if (!opts.forceHeuristic && config.remote?.allowRemoteCode === true) {
    const remote = await tryRemoteSelection(taskDescription, config);
    if (remote) return remote;
  }

  return heuristicResult(taskDescription, config,
    wantLlm ? 'local model unavailable; used keyword heuristic' : '');
}

/**
 * Attempt remote file selection via Gemini. Returns null on any failure (caller
 * falls back to heuristic). Shows the one-time code-consent notice on first use.
 */
async function tryRemoteSelection(
  taskDescription: string,
  config: ProjectConfig,
): Promise<SelectionResult | null> {
  const key = loadGeminiKey();
  if (!key) return null;

  // One-time consent notice (code is about to leave the machine to a free tier).
  maybeShowRemoteCodeNotice('file_selection', REMOTE_SELECTION_MODEL);

  try {
    const allFiles = walkAllSourceFiles(config).slice(0, LLM_CANDIDATE_CAP);
    const selections = await selectFilesWithGenerate(
      taskDescription, allFiles, config.root, MAX_RESULTS,
      (prompt) => geminiGenerate(prompt, {
        apiKey: key, model: REMOTE_SELECTION_MODEL, timeoutMs: 30000,
      }),
    );
    if (selections.length === 0) return null;
    const files: SelectedFile[] = selections.map(s => ({
      filepath: path.join(config.root, s.path),
      reason: s.reason,
    }));
    return { files, strategy: 'remote', fallbackReason: '', remoteModel: REMOTE_SELECTION_MODEL };
  } catch {
    return null;
  }
}

function heuristicResult(
  taskDescription: string,
  config: ProjectConfig,
  fallbackReason: string,
): SelectionResult {
  const files = selectFiles(taskDescription, config).map(filepath => ({
    filepath,
    reason: 'matched keywords / recently modified',
  }));
  return { files, strategy: 'heuristic', fallbackReason };
}

/** Walk every source file under the configured source dirs (uncapped). */
export function walkAllSourceFiles(config: ProjectConfig): string[] {
  const out: string[] = [];
  for (const dir of config.sourceDirs) {
    const start = dir === '.' ? config.root : path.join(config.root, dir);
    if (!fs.existsSync(start)) continue;
    walk(start, f => out.push(f));
  }
  return out;
}

/**
 * Walk source dirs, scoring each candidate file against the task description.
 * Returns up to MAX_RESULTS files sorted by descending score. (Heuristic.)
 */
export function selectFiles(taskDescription: string, config: ProjectConfig): string[] {
  const keywords = extractKeywords(taskDescription);
  const candidates: FileScore[] = [];

  for (const dir of config.sourceDirs) {
    const start = path.join(config.root, dir);
    if (!fs.existsSync(start)) continue;
    walk(start, file => {
      const score = scoreFile(file, keywords);
      if (score > 0) candidates.push({ filepath: file, score });
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, MAX_RESULTS).map(c => c.filepath);
}

/** Score a single file against task keywords. Higher is better. */
export function scoreFile(filepath: string, keywords: string[]): number {
  let score = 0;

  let content = '';
  try {
    content = fs.readFileSync(filepath, 'utf-8');
  } catch {
    // unreadable; rely on filename match only below
  }

  // Skip empty or near-empty files entirely. They add noise to briefs
  // without contributing useful context (think: empty __init__.py).
  if (content.trim().length < 10) {
    return 0;
  }

  const base = path.basename(filepath).toLowerCase();
  for (const kw of keywords) {
    if (base.includes(kw)) score += 10;
  }

  const lowerContent = content.toLowerCase();
  for (const kw of keywords) {
    const matches = countOccurrences(lowerContent, kw);
    if (matches > 0) score += Math.min(matches, 5); // diminishing returns
  }

  // Recency bonus
  try {
    const ageDays = (Date.now() - fs.statSync(filepath).mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageDays <= RECENCY_WINDOW_DAYS) score += 3;
  } catch {
    // ignore
  }

  return score;
}

function extractKeywords(text: string): string[] {
  // Lowercase, strip punctuation, drop stopwords and very short words
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
    'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as',
    'how', 'why', 'what', 'when', 'where', 'do', 'does', 'did', 'i',
    'my', 'me', 'we', 'our', 'this', 'that', 'these', 'those', 'it',
    'be', 'been', 'have', 'has', 'had', 'can', 'should', 'would',
    'fix', 'add', 'make', 'change',
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function walk(dir: string, callback: (filepath: string) => void): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(full, callback);
    } else if (entry.isFile()) {
      if (SOURCE_EXTS.has(path.extname(entry.name))) {
        callback(full);
      }
    }
  }
}
