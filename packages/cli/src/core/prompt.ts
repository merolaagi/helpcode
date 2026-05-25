/**
 * Build a structured prompt for Claude.ai.
 *
 * The prompt always includes the response protocol at the bottom, so Claude
 * sees how to format its reply on every turn (pattern training by repetition).
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig } from '../types.js';
import { getLastCommitSummary, getUncommittedFileCount } from '../lib/git.js';
import { truncateLines } from '../lib/compress.js';

const MAX_FILE_LINES = 150;

export interface PromptInput {
  taskDescription: string;
  selectedFiles: string[];
  lastTestOutput: string | null;
  config: ProjectConfig;
}

export function buildPrompt(input: PromptInput): string {
  const parts: string[] = [];

  parts.push('## Project context');
  parts.push(`- Language: ${input.config.language}`);
  if (input.config.framework) {
    parts.push(`- Framework: ${input.config.framework}`);
  }
  const commit = getLastCommitSummary(input.config.root);
  if (commit) parts.push(`- Last commit: ${commit}`);
  const uncommitted = getUncommittedFileCount(input.config.root);
  if (uncommitted > 0) parts.push(`- Uncommitted changes: ${uncommitted} file(s)`);

  if (input.lastTestOutput && input.lastTestOutput.trim()) {
    parts.push('');
    parts.push('## Last test output');
    parts.push('```');
    parts.push(truncateLines(input.lastTestOutput, 30, 'lines'));
    parts.push('```');
  }

  if (input.selectedFiles.length > 0) {
    parts.push('');
    parts.push(`## Files (${input.selectedFiles.length})`);
    for (const f of input.selectedFiles) {
      const rel = path.relative(input.config.root, f);
      let body: string;
      try {
        const text = fs.readFileSync(f, 'utf-8');
        const lines = text.split(/\r?\n/);
        body = lines.length > MAX_FILE_LINES
          ? lines.slice(0, MAX_FILE_LINES).join('\n') +
            `\n# ... [${lines.length - MAX_FILE_LINES} more lines truncated] ...`
          : text;
      } catch {
        body = '(could not read file)';
      }
      const fence = fenceForFile(f);
      parts.push('');
      parts.push(`### \`${rel}\``);
      parts.push('```' + fence);
      parts.push(body);
      parts.push('```');
    }
  }

  parts.push('');
  parts.push('## My task');
  parts.push(input.taskDescription);

  parts.push('');
  parts.push(RESPONSE_PROTOCOL);

  return parts.join('\n');
}

function fenceForFile(filepath: string): string {
  const ext = path.extname(filepath);
  const map: Record<string, string> = {
    '.py': 'python',
    '.js': 'javascript',
    '.ts': 'typescript',
    '.jsx': 'jsx',
    '.tsx': 'tsx',
    '.sh': 'bash',
    '.rb': 'ruby',
    '.go': 'go',
    '.java': 'java',
    '.rs': 'rust',
    '.json': 'json',
    '.yml': 'yaml',
    '.yaml': 'yaml',
  };
  return map[ext] ?? '';
}

/**
 * Instructions appended to every prompt. This is the load-bearing protocol
 * that makes parsing Claude's reply reliable.
 */
export const RESPONSE_PROTOCOL = `## Please respond in this format

\`\`\`
## PLAN
One to three sentences describing what you'll change and why.

## DIFF: path/to/file.py
\`\`\`diff
--- a/path/to/file.py
+++ b/path/to/file.py
@@ -10,3 +10,3 @@
- old line
+ new line
\`\`\`

(repeat ## DIFF: blocks as needed, one per file)

## TEST
\`\`\`bash
the single command I should run to verify this works
\`\`\`

## NOTES
(optional) anything else worth noting — caveats, alternatives, questions.
\`\`\`

Rules:
- Use unified diff format inside each \`## DIFF:\` block.
- Use real context lines (with a leading space) so the diff anchors correctly.
- Keep each diff scoped to the file named in its header.
- Don't include explanations between sections — put commentary in \`## NOTES\`.`;
