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
}

type Section = 'NONE' | 'PLAN' | 'DIFF' | 'TEST' | 'NOTES';

export function parseClaudeResponse(rawText: string): ParsedResponse {
  const lines = rawText.split(/\r?\n/);
  const result: ParsedResponse = {
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
