/**
 * Output triage (v0.2.x) — the second local-LLM task after file selection.
 *
 * Long command output (a 200-line pytest dump, a webpack error wall) bloats
 * the next Claude brief and buries the signal. helpcode already truncates
 * deterministically (head + tail). When Ollama is available, we can do
 * better: ask a local model to extract the key failure(s) so the brief stays
 * tight and on-point.
 *
 * Same contract as the selector: the LLM is a free upgrade. If Ollama is
 * disabled, unreachable, slow, errors, or returns nothing useful, we fall
 * back to the existing deterministic truncation. Triage NEVER loses the
 * output entirely — worst case you get the same truncation as before.
 */

import { generate, OllamaError } from './ollama.js';
import { truncateLines } from '../lib/compress.js';
import { OllamaSettings } from '../types.js';

/** Output longer than this (lines) is a candidate for triage. */
const TRIAGE_THRESHOLD_LINES = 30;
/** Deterministic fallback truncation cap. */
const FALLBACK_MAX_LINES = 40;

export interface TriageResult {
  /** The compacted output to put in the brief. */
  text: string;
  /** True if a model (local or remote) produced the summary; false if fallback. */
  triaged: boolean;
  /** True if the remote model produced it (for the cockpit). */
  remote?: boolean;
}

type GenerateImpl = (
  host: string,
  model: string,
  prompt: string,
  opts?: { timeoutMs?: number },
) => Promise<string>;

export interface TriageDeps {
  /** Injectable model call for testing. Defaults to the real Ollama client. */
  generateImpl?: GenerateImpl;
  /**
   * Optional remote-model fallback (prompt → text). Supplied by the caller ONLY
   * when allowRemoteCode is on and a key is present (triage output is
   * code-bearing). Tried after local fails, before deterministic truncation.
   */
  remoteGenerate?: (prompt: string) => Promise<string>;
}

/** Is this output worth sending to the model? Long, and Ollama enabled. */
export function shouldTriage(
  output: string,
  ollama: Pick<OllamaSettings, 'enabled'>,
): boolean {
  if (!ollama.enabled) return false;
  return output.split(/\r?\n/).length > TRIAGE_THRESHOLD_LINES;
}

export function buildTriagePrompt(output: string): string {
  return [
    'The following is output from running a command (often a test run or build).',
    'Extract ONLY the information needed to understand and fix any failure:',
    '- which test(s) or step(s) failed, and the exact error message',
    '- the file and line if present',
    'Omit passing tests, setup banners, and noise. If everything passed, say so in one line.',
    'Be concise — a few lines at most. No preamble.',
    '',
    '--- OUTPUT ---',
    output,
    '--- END OUTPUT ---',
  ].join('\n');
}

/**
 * Triage command output. Returns a compacted version plus whether the model
 * was used. Never throws — any failure falls back to deterministic truncation.
 *
 * Order: local model → remote model (if provided; privacy-gated by the caller)
 * → deterministic truncation. `deps.remoteGenerate` is supplied by the caller
 * only when allowRemoteCode is on and a key is present — triage output can
 * contain code, so it's code-bearing.
 */
export async function triageOutput(
  output: string,
  ollama: OllamaSettings,
  deps: TriageDeps = {},
): Promise<TriageResult> {
  // Short output, or triage disabled: return as-is or truncate, no model.
  if (!shouldTriage(output, ollama)) {
    const lineCount = output.split(/\r?\n/).length;
    const text = lineCount > FALLBACK_MAX_LINES
      ? truncateLines(output, FALLBACK_MAX_LINES, 'lines')
      : output;
    return { text, triaged: false };
  }

  const prompt = buildTriagePrompt(output);

  // 1. Local model (cheapest).
  const generateImpl = deps.generateImpl ?? generate;
  try {
    const summary = await generateImpl(
      ollama.host, ollama.model, prompt, { timeoutMs: ollama.timeoutMs },
    );
    if (summary && summary.trim().length > 0) {
      return { text: summary.trim(), triaged: true };
    }
  } catch (e) {
    void (e instanceof OllamaError);
    // fall through to remote / deterministic
  }

  // 2. Remote model, if the caller provided one (privacy-gated upstream).
  if (deps.remoteGenerate) {
    try {
      const summary = await deps.remoteGenerate(prompt);
      if (summary && summary.trim().length > 0) {
        return { text: summary.trim(), triaged: true, remote: true };
      }
    } catch {
      // fall through to deterministic
    }
  }

  // 3. Deterministic truncation — always works.
  return { text: truncateLines(output, FALLBACK_MAX_LINES, 'lines'), triaged: false };
}
