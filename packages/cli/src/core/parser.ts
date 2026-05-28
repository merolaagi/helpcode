/**
 * Parse Claude's structured response per the protocol in docs/PROTOCOL.md.
 *
 * Expected format:
 *
 *   ## PLAN
 *   one to three sentences
 *
 *   ## DIFF: path/to/file.py
 *   ```diff
 *   --- a/path/to/file.py
 *   +++ b/path/to/file.py
 *   @@ ... @@
 *   - old line
 *   + new line
 *   ```
 *
 *   ## TEST
 *   ```bash
 *   pytest -k login
 *   ```
 *
 *   ## NOTES
 *   free text
 *
 * Rules:
 *   - Every section is optional except `## PLAN`.
 *   - Multiple `## DIFF:` blocks are allowed (one per file).
 *   - `## TEST` contains a single command.
 *   - `## NOTES` is free text shown to the user verbatim.
 *   - Code fence lines (```) are stripped from captured content.
 *   - If no recognised sections appear, `parseWarning` is set so the caller
 *     can ask the user to retry (or run a rescue heuristic).
 */

export interface DiffHunk {
  filepath: string;
  /** Raw diff lines, including the +/-/space prefix. */
  patchLines: string[];
}

export interface ParsedResponse {
  plan: string;
  diffs: DiffHunk[];
  testCommand: string | null;
  notes: string | null;
  /** True if the response didn't follow protocol — needs human review. */
  parseWarning: boolean;
  /**
   * True if auto-repair was applied to fix common copy-paste corruption
   * (missing ## prefixes, merged code fences). Set so the CLI can mention
   * the repair to the user.
   */
  repairsApplied: boolean;
}

type Section = 'NONE' | 'PLAN' | 'DIFF' | 'TEST' | 'NOTES';

export function parseClaudeResponse(rawText: string): ParsedResponse {
  // First pass: try strict parsing on the input as given
  const first = parseStrict(rawText);
  if (!first.parseWarning) {
    return { ...first, repairsApplied: false };
  }
  // Second pass: attempt repair on common copy-paste corruption, re-parse
  const repaired = repairCorruptedResponse(rawText);
  if (repaired === rawText) {
    // Repair didn't change anything; surface the original warning
    return { ...first, repairsApplied: false };
  }
  const second = parseStrict(repaired);
  return { ...second, repairsApplied: true };
}

/**
 * Strict parser — exactly the previous (v0.1.0/0.1.1) behaviour.
 * Kept as an internal function so parseClaudeResponse can call it both
 * before and after repair.
 */
function parseStrict(rawText: string): Omit<ParsedResponse, 'repairsApplied'> {
  const lines = rawText.split(/\r?\n/);
  const result: Omit<ParsedResponse, 'repairsApplied'> = {
    plan: '',
    diffs: [],
    testCommand: null,
    notes: null,
    parseWarning: false,
  };

  let section: Section = 'NONE';
  let currentFilepath = '';
  let currentPatchLines: string[] = [];
  let inCodeFence = false;
  const planLines: string[] = [];
  const notesLines: string[] = [];
  let testCommandCaptured: string | null = null;

  const flushDiff = (): void => {
    if (currentFilepath && currentPatchLines.length > 0) {
      result.diffs.push({
        filepath: currentFilepath.trim(),
        patchLines: currentPatchLines,
      });
    }
    currentFilepath = '';
    currentPatchLines = [];
  };

  for (const line of lines) {
    // Section headers only count outside code fences
    if (!inCodeFence) {
      if (/^##\s+PLAN\b/.test(line)) {
        flushDiff();
        section = 'PLAN';
        continue;
      }
      const diffMatch = line.match(/^##\s+DIFF:\s*(.+)/);
      if (diffMatch) {
        flushDiff();
        section = 'DIFF';
        currentFilepath = diffMatch[1].trim();
        continue;
      }
      if (/^##\s+TEST\b/.test(line)) {
        flushDiff();
        section = 'TEST';
        continue;
      }
      if (/^##\s+NOTES\b/.test(line)) {
        flushDiff();
        section = 'NOTES';
        continue;
      }
    }

    // Code fence toggle
    if (/^```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }

    switch (section) {
      case 'PLAN':
        planLines.push(line);
        break;
      case 'DIFF':
        currentPatchLines.push(line);
        break;
      case 'TEST':
        if (line.trim() && testCommandCaptured === null) {
          testCommandCaptured = line.trim();
        }
        break;
      case 'NOTES':
        notesLines.push(line);
        break;
      case 'NONE':
        // Lines outside any section are ignored
        break;
    }
  }

  flushDiff();

  result.plan = planLines.join('\n').trim();
  result.testCommand = testCommandCaptured;
  result.notes = notesLines.length > 0 ? notesLines.join('\n').trim() : null;

  if (!result.plan && result.diffs.length === 0) {
    result.parseWarning = true;
  }

  return result;
}

/**
 * Check a parsed response for things that would prevent safe application.
 * Returns a list of human-readable issues (empty list = looks valid).
 */
export function validateParsedResponse(r: ParsedResponse): string[] {
  const issues: string[] = [];
  if (!r.plan) issues.push('Missing ## PLAN section');
  for (const d of r.diffs) {
    if (!d.filepath) issues.push('A ## DIFF: block is missing a filepath');
    if (d.patchLines.length === 0) issues.push(`Empty diff for ${d.filepath}`);
  }
  return issues;
}

// ---------- v0.1.2 auto-repair ----------

/** Section markers we know about, used to detect bare headers. */
const BARE_HEADERS = ['PLAN', 'TEST', 'NOTES'] as const;

/**
 * Language identifiers that commonly appear as the first token of a merged
 * fence line (e.g. `diff--- a/foo` came from ` ```diff ` + `--- a/foo`).
 * Order matters: longer/more-specific identifiers come first so we don't
 * mistake `pythondef` for a `py`-prefixed fence.
 */
const FENCE_LANGS = [
  'typescript', 'javascript', 'python', 'bash', 'diff', 'json', 'yaml',
  'yml', 'jsx', 'tsx', 'sh', 'js', 'ts', 'py', 'go', 'rs', 'rb',
];

/**
 * Repair common copy-paste corruption that happens when users drag-select
 * Claude's response from the rendered Claude.ai view instead of using the
 * message's built-in copy icon. Three patterns get fixed:
 *
 *   1. Bare headers — `PLAN` / `TEST` / `NOTES` / `DIFF: <path>` without
 *      the leading `## ` get the marker restored.
 *   2. Merged opening fences — `diff--- a/foo` becomes `\`\`\`diff` +
 *      `--- a/foo` on separate lines (same for `bashpytest` etc.).
 *   3. Missing closing fences — if we opened a fence to repair (2), insert
 *      a closing fence before the next header (or end of input), since the
 *      original closing fence was also stripped by the bad copy.
 *
 * Repair is deliberately conservative: it only modifies lines that match
 * recognised patterns at the start of the line (no leading whitespace).
 * Prose that happens to contain "DIFF:" or "diff--" mid-sentence is left
 * alone.
 */
export function repairCorruptedResponse(rawText: string): string {
  const lines = rawText.split(/\r?\n/);

  // First pass: line-by-line transformation. Mark whether we inserted any
  // opening fences so we know to add closing fences in pass 2.
  type Transformed = { content: string; isHeader: boolean; openedFence: boolean };
  const pass1: Transformed[] = [];
  for (const line of lines) {
    if (isBareHeader(line)) {
      pass1.push({ content: '## ' + line, isHeader: true, openedFence: false });
      continue;
    }
    const split = splitMergedFence(line);
    if (split) {
      pass1.push({ content: '```' + split.lang, isHeader: false, openedFence: true });
      pass1.push({ content: split.rest, isHeader: false, openedFence: false });
      continue;
    }
    pass1.push({ content: line, isHeader: false, openedFence: false });
  }

  // Second pass: walk forward; when we encounter an opening fence that we
  // inserted, scan ahead for the next header (or end-of-input) and insert
  // a closing fence right before it.
  const out: string[] = [];
  let needsClose = false;
  for (let i = 0; i < pass1.length; i++) {
    const t = pass1[i];
    if (needsClose && t.isHeader) {
      // Close the fence before this header. Strip a trailing blank line so
      // we don't leave an awkward gap inside the code block.
      if (out.length > 0 && out[out.length - 1] === '') out.pop();
      out.push('```');
      out.push(''); // blank line between fence and header
      needsClose = false;
    }
    out.push(t.content);
    if (t.openedFence) needsClose = true;
  }
  if (needsClose) {
    if (out.length > 0 && out[out.length - 1] === '') out.pop();
    out.push('```');
  }

  return out.join('\n');
}

/**
 * Is this line a bare section header? Headers must occupy the whole line —
 * no leading/trailing whitespace, nothing else on the line. This is the
 * guard that keeps repair from triggering on prose like "the DIFF: header".
 */
function isBareHeader(line: string): boolean {
  if (BARE_HEADERS.includes(line as typeof BARE_HEADERS[number])) return true;
  // DIFF: <path> — path must look like a filepath (has a dot or slash)
  const m = line.match(/^DIFF:\s+(\S+)$/);
  if (m && (m[1].includes('/') || m[1].includes('.'))) return true;
  return false;
}

/**
 * If this line is a merged opening fence ("diff--- ...", "bashpytest"),
 * return the language + the rest of the line as two pieces to be emitted
 * on separate lines. Otherwise return null.
 *
 * Only triggers when the language is followed by content that looks like
 * code, not arbitrary prose, to avoid false positives.
 */
function splitMergedFence(line: string): { lang: string; rest: string } | null {
  for (const lang of FENCE_LANGS) {
    if (line.startsWith(lang) && line.length > lang.length) {
      const rest = line.slice(lang.length);
      // The character right after the language must look like the start of
      // code, not the next word of prose. Whitelist a few common starts:
      //   - `-` (diff marker)
      //   - `+` (diff marker)
      //   - `@` (diff hunk header)
      //   - a letter/digit (most common command/code starts: `pytest`, `def`, etc.)
      // Reject if the next char is a space (already separated) or punctuation
      // unlikely at the start of code.
      const next = rest[0];
      if (/[-+@A-Za-z0-9_/]/.test(next)) {
        return { lang, rest };
      }
    }
  }
  return null;
}
