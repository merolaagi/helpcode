/**
 * File selection — pick the files most likely relevant to a task.
 *
 * v0.1 is heuristic-only:
 *   - Filename match with task keywords
 *   - Content keyword match
 *   - Recency (mtime)
 *
 * v0.2+ will optionally use a local LLM for semantic ranking via Ollama.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig } from '../types.js';

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

interface FileScore {
  filepath: string;
  score: number;
}

/**
 * Walk source dirs, scoring each candidate file against the task description.
 * Returns up to MAX_RESULTS files sorted by descending score.
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
