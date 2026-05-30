/**
 * API key loading for remote sous-chefs (v0.3.2).
 *
 * Keys are secrets and must never touch project.json (which is committed).
 * Resolution order:
 *   1. GEMINI_API_KEY environment variable  (precedence; nothing on disk)
 *   2. .helpcode/keys.json  { "gemini": "..." }  (gitignored by init)
 *
 * Returns null if no key is configured — in which case the remote sous-chef
 * simply doesn't exist and helpcode behaves exactly as v0.3.1 (local only).
 * Never throws: a missing or malformed keys.json yields null, not an error.
 */

import * as fs from 'fs';
import * as path from 'path';

const KEYS_FILE = path.join('.helpcode', 'keys.json');

/**
 * Resolve the Gemini API key. `env` is injectable for testing (defaults to
 * process.env). Returns the key string, or null if none is configured.
 */
export function loadGeminiKey(
  cwd: string = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): string | null {
  // 1. Environment variable wins (and leaves nothing on disk).
  const fromEnv = env.GEMINI_API_KEY;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  // 2. .helpcode/keys.json
  const file = path.join(cwd, KEYS_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const k = parsed?.gemini;
    if (typeof k === 'string' && k.trim().length > 0) return k.trim();
    return null;
  } catch {
    // Malformed file: behave as if no key (never throw).
    return null;
  }
}

/**
 * Whether a keys.json exists but is NOT gitignored — a footgun worth warning
 * about (the user could commit their key). Best-effort: checks for a literal
 * keys.json or .helpcode/ entry in .gitignore.
 */
export function keysFileAtRiskOfCommit(cwd: string = process.cwd()): boolean {
  const keysPath = path.join(cwd, KEYS_FILE);
  if (!fs.existsSync(keysPath)) return false;

  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return true; // exists, nothing ignoring it

  try {
    const ignore = fs.readFileSync(gitignorePath, 'utf-8');
    const lines = ignore.split(/\r?\n/).map(l => l.trim());
    const covered = lines.some(l =>
      l === '.helpcode/' ||
      l === '.helpcode' ||
      l === '.helpcode/keys.json' ||
      l === 'keys.json' ||
      l === '.helpcode/*',
    );
    return !covered;
  } catch {
    return true;
  }
}
