/**
 * LLM-based file selection (v0.2).
 *
 * Given a task description and a set of candidate files, ask a local model
 * (via Ollama) which files are most relevant and why. Unlike the keyword
 * heuristic in selector.ts, the model can reason about indirection: a "login
 * bug" task can surface session.py and the user model, not just files that
 * literally contain the word "login".
 *
 * The CRITICAL guard is hallucination rejection: the model sometimes invents
 * filenames. Every returned path is validated against the real candidate set;
 * invented paths are dropped. If nothing valid survives, the caller falls
 * back to the heuristic selector.
 *
 * This module is pure logic over its inputs (prompt building + parsing). The
 * actual model call and the strategy/fallback wiring live in selector.ts so
 * this stays easily unit-testable without a live Ollama.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generate, OllamaError } from './ollama.js';

export interface Candidate {
  /** Path relative to the project root, as shown to the model. */
  path: string;
  /** A compact signature: declarations or first lines, to give the model context. */
  signature: string;
}

export interface Selection {
  path: string;
  reason: string;
}

const MAX_SIGNATURE_DECLS = 8;     // declarations to include per file
const MAX_SIGNATURE_FALLBACK_LINES = 6;  // if no declarations found

/**
 * Build a compact signature for a file: lines that look like declarations
 * (def/class/function/export/const/interface/type/struct/fn/func), capped.
 * Falls back to the first few non-blank lines if no declarations are found.
 * Language-agnostic by design — works reasonably for Python, JS/TS, Go, Rust.
 */
export function buildSignature(filepath: string): string {
  let text: string;
  try {
    text = fs.readFileSync(filepath, 'utf-8');
  } catch {
    return '(unreadable)';
  }
  const lines = text.split(/\r?\n/);

  const declRe = /^\s*(?:export\s+)?(?:async\s+)?(?:def|class|function|const|let|interface|type|struct|fn|func|public|private|protected)\b/;
  const decls: string[] = [];
  for (const line of lines) {
    if (declRe.test(line)) {
      // Trim to the signature part — drop bodies/braces for compactness
      const trimmed = line.trim().replace(/\s*[{:].*$/, '').slice(0, 80);
      if (trimmed) decls.push(trimmed);
      if (decls.length >= MAX_SIGNATURE_DECLS) break;
    }
  }

  if (decls.length > 0) {
    return decls.join('; ');
  }

  // Fallback: first few non-blank, non-comment lines
  const firstLines = lines
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'))
    .slice(0, MAX_SIGNATURE_FALLBACK_LINES);
  return firstLines.join(' / ').slice(0, 200) || '(empty)';
}

/**
 * Build the selection prompt. Strict, parseable format — same philosophy as
 * the Claude response protocol: lean on the model's format-following.
 */
export function buildSelectionPrompt(
  task: string,
  candidates: Candidate[],
  count: number,
): string {
  const lines: string[] = [];
  lines.push(`TASK: ${task}`);
  lines.push('');
  lines.push('CANDIDATE FILES:');
  for (const c of candidates) {
    lines.push(`- ${c.path}: ${c.signature}`);
  }
  lines.push('');
  lines.push(`Return UP TO ${count} files that are genuinely relevant to the task, most relevant first.`);
  lines.push('Include FEWER than ' + count + ' if fewer are truly relevant — do not pad the list with files that are empty or unrelated.');
  lines.push('Format each line exactly as:');
  lines.push('  PATH | one-line reason');
  lines.push('Only use paths from the candidate list above. No prose, no other text.');
  return lines.join('\n');
}

/**
 * Parse the model's response into validated selections.
 *
 * Tolerant of real-world model messiness: prose preambles, list markers
 * (`- `, `1. `), backtick-wrapped paths, and missing reasons. Strict on the
 * one thing that matters: the path must exist in the candidate set.
 */
export function parseSelectionResponse(
  response: string,
  candidates: Candidate[],
): Selection[] {
  const validPaths = new Set(candidates.map(c => c.path));
  const seen = new Set<string>();
  const out: Selection[] = [];

  for (const rawLine of response.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    // Strip leading list markers: "- ", "* ", "1. ", "2) "
    line = line.replace(/^(?:[-*]\s+|\d+[.)]\s+)/, '');

    // Split on the first pipe into path-part and reason-part
    const pipeIdx = line.indexOf('|');
    let pathPart = pipeIdx >= 0 ? line.slice(0, pipeIdx) : line;
    const reason = pipeIdx >= 0 ? line.slice(pipeIdx + 1).trim() : '';

    // Clean the path: strip backticks, surrounding quotes, whitespace
    pathPart = pathPart.trim().replace(/^[`'"]+|[`'"]+$/g, '').trim();

    if (!validPaths.has(pathPart)) continue;   // hallucination guard
    if (seen.has(pathPart)) continue;          // dedupe
    seen.add(pathPart);
    out.push({ path: pathPart, reason });
  }

  return out;
}

/**
 * Full LLM selection: build candidates' signatures, prompt the model, parse
 * and validate. Returns validated selections, or an empty array if the model
 * produced nothing usable (caller falls back to heuristic).
 *
 * Throws OllamaError on transport failures so the caller can distinguish
 * "model ran but found nothing" (empty array) from "couldn't reach model"
 * (throw) — both lead to fallback, but the caller may log them differently.
 */
export async function llmSelectFiles(
  task: string,
  candidatePaths: string[],
  projectRoot: string,
  opts: { host: string; model: string; count: number; timeoutMs?: number },
): Promise<Selection[]> {
  // Filter out empty / near-empty files (e.g. empty __init__.py) before they
  // ever reach the model. Matches the heuristic selector's v0.1.1 behaviour
  // and stops the model padding its answer with files it admits are empty.
  const meaningful = candidatePaths.filter(p => {
    try {
      return fs.readFileSync(p, 'utf-8').trim().length >= 10;
    } catch {
      return false;
    }
  });

  const candidates: Candidate[] = meaningful.map(p => ({
    path: path.relative(projectRoot, p),
    signature: buildSignature(p),
  }));

  const prompt = buildSelectionPrompt(task, candidates, opts.count);
  const response = await generate(opts.host, opts.model, prompt, {
    timeoutMs: opts.timeoutMs,
  });
  return parseSelectionResponse(response, candidates);
}

// Re-export for callers that want to detect transport errors specifically.
export { OllamaError };
