/**
 * Line-by-line diff application.
 *
 * Design principles:
 *   - Never silently corrupt: throw HelpcodeError on any ambiguity.
 *   - Atomic writes: temp file + rename, so a kill mid-write doesn't
 *     leave a half-written source file.
 *   - New files are created with their parent directory if needed.
 *   - Caller is responsible for snapshotting before patching if rollback is wanted.
 *
 * Patch format:
 *   Each line starts with ' ' (context), '-' (removed), or '+' (added).
 *   Order matters — context and removal lines together describe what the
 *   file looks like NOW; context and add lines describe what it should
 *   look like AFTER.
 */

import * as fs from 'fs';
import * as path from 'path';
import { HelpcodeError, ErrorCode } from '../lib/errors.js';

export interface PatchResult {
  filepath: string;
  hunksApplied: number;
  created: boolean;
  ok: boolean;
}

/**
 * Apply an array of unified-diff lines (+, -, space prefixes) to a file.
 *
 * Throws HelpcodeError on:
 *   - File missing but diff includes context/removal (couldn't anchor)
 *   - Anchor lines don't match anywhere in the target
 *   - Write fails
 */
export function applyLinePatch(filepath: string, patchLines: string[]): PatchResult {
  // Strip diff header lines like `--- a/foo` / `+++ b/foo` / `@@ ... @@`
  // that Claude often includes inside the fenced ```diff block.
  const cleaned = stripDiffHeaders(patchLines);

  // New-file case: only `+` and blank/`---,+++` lines, target doesn't exist
  const looksLikeNewFile =
    cleaned.every(l => l.startsWith('+') || l === '') &&
    !fs.existsSync(filepath);

  if (looksLikeNewFile) {
    const content = cleaned
      .filter(l => l.startsWith('+'))
      .map(l => l.slice(1))
      .join('\n');
    const dir = path.dirname(filepath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    atomicWrite(filepath, content);
    return { filepath, hunksApplied: 1, created: true, ok: true };
  }

  if (!fs.existsSync(filepath)) {
    throw new HelpcodeError(
      ErrorCode.IO_ERROR,
      `File not found: ${filepath}`,
      'Check the path in the diff header. Run `helpcode status` to see current task.',
    );
  }

  const fileContent = fs.readFileSync(filepath, 'utf-8');
  const targetLines = fileContent.split(/\r?\n/);

  // Build the "before" sequence: context + removal lines, in order.
  // Build the "after" sequence: context + add lines, in order.
  const before: string[] = [];
  const after: string[] = [];
  for (const line of cleaned) {
    if (line.startsWith(' ')) {
      before.push(line.slice(1));
      after.push(line.slice(1));
    } else if (line.startsWith('-')) {
      before.push(line.slice(1));
    } else if (line.startsWith('+')) {
      after.push(line.slice(1));
    }
    // Blank lines (rare in proper diffs) ignored.
  }

  if (before.length === 0) {
    // Pure addition with no context — ambiguous, refuse
    throw new HelpcodeError(
      ErrorCode.VALIDATION_ERROR,
      `Patch for ${filepath} has no context or removal lines to anchor against.`,
      'Ask Claude for a fresh diff that includes a few unchanged context lines.',
    );
  }

  const anchor = findAnchor(targetLines, before);
  if (anchor === -1) {
    throw new HelpcodeError(
      ErrorCode.VALIDATION_ERROR,
      `Patch does not apply cleanly to ${filepath}: anchor lines not found.`,
      'The file may have changed since Claude wrote the diff. Re-run `helpcode ask` for a fresh one.',
    );
  }

  const result = [
    ...targetLines.slice(0, anchor),
    ...after,
    ...targetLines.slice(anchor + before.length),
  ];

  atomicWrite(filepath, result.join('\n'));
  return { filepath, hunksApplied: 1, created: false, ok: true };
}

/** Drop diff header lines like `--- a/foo`, `+++ b/foo`, `@@ ... @@`. */
function stripDiffHeaders(patchLines: string[]): string[] {
  return patchLines.filter(line => {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) return false;
    if (line.startsWith('@@')) return false;
    return true;
  });
}

function findAnchor(target: string[], pattern: string[]): number {
  if (pattern.length === 0) return -1;
  for (let i = 0; i <= target.length - pattern.length; i++) {
    let match = true;
    for (let k = 0; k < pattern.length; k++) {
      if (target[i + k] !== pattern[k]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

/**
 * Write content via a temp file + rename. Prevents partial-write corruption
 * if the process is killed mid-write.
 */
function atomicWrite(filepath: string, content: string): void {
  const tmp = `${filepath}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, filepath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw new HelpcodeError(
      ErrorCode.IO_ERROR,
      `Atomic write failed for ${filepath}: ${(e as Error).message}`,
      'Check disk space and file permissions.',
    );
  }
}
