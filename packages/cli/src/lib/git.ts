/**
 * Git helpers. All best-effort — return null/empty when git isn't available
 * or the directory isn't a repo. Never throws.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function isGitRepo(cwd: string = process.cwd()): boolean {
  return fs.existsSync(path.join(cwd, '.git'));
}

function tryGit(args: string[], cwd: string = process.cwd()): string | null {
  if (!isGitRepo(cwd)) return null;
  try {
    return execSync(`git ${args.join(' ')}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export function getLastCommitSummary(cwd?: string): string | null {
  return tryGit(['log', '-1', '--pretty=format:%h %s (%cr)'], cwd);
}

export function getUncommittedFileCount(cwd?: string): number {
  const out = tryGit(['status', '--short'], cwd);
  if (!out) return 0;
  return out.split('\n').filter(l => l.trim().length > 0).length;
}

export function getUncommittedFiles(cwd?: string): string[] {
  const out = tryGit(['status', '--short'], cwd);
  if (!out) return [];
  return out
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.replace(/^.{1,3}/, '').trim());
}
