/**
 * Classify why a test/command run failed, so the CLI can give the right
 * advice. The key distinction:
 *
 *   - 'setup'   : the runner never started (not installed, not on PATH,
 *                 missing module). Sending this back to Claude wastes a
 *                 turn — the user needs to install something.
 *   - 'timeout' : the command ran too long and was killed.
 *   - 'test'    : the runner started and tests genuinely failed. THIS is
 *                 the case worth sending back to Claude.
 *
 * This is a pure function over the captured CommandResult, so it's easy to
 * unit-test against real-world stderr strings.
 */

import { CommandResult } from '../core/tools.js';

export type FailureKind = 'setup' | 'timeout' | 'test';

export interface FailureClassification {
  kind: FailureKind;
  /** A short, human-readable message describing the failure. */
  message: string;
  /** Actionable hint for the user, or empty string. */
  hint: string;
}

/**
 * Patterns that indicate the runner could not start — a setup problem,
 * not a test failure. Cross-platform.
 */
const SETUP_PATTERNS: { re: RegExp; describe: (m: RegExpMatchArray) => string }[] = [
  // POSIX shells: "/bin/sh: pytest: command not found" or "bash: jest: command not found"
  {
    re: /(?:^|\n).*?:\s*([\w.-]+):\s*command not found/i,
    describe: m => `\`${m[1]}\` is not installed or not on your PATH`,
  },
  // Windows cmd: "'pytest' is not recognized as an internal or external command"
  {
    re: /'([\w.-]+)' is not recognized as an internal or external command/i,
    describe: m => `\`${m[1]}\` is not installed or not on your PATH`,
  },
  // Python module missing: "No module named pytest"
  {
    re: /No module named ([\w.]+)/i,
    describe: m => `the Python module \`${m[1]}\` is not installed`,
  },
  // Node module missing: "Cannot find module 'jest'"
  {
    re: /Cannot find module '([\w@/.-]+)'/i,
    describe: m => `the module \`${m[1]}\` is not installed`,
  },
];

export function classifyRunFailure(result: CommandResult): FailureClassification {
  if (result.timedOut || result.exitCode === 124) {
    return {
      kind: 'timeout',
      message: 'The command timed out and was killed.',
      hint: 'If the command is genuinely slow, raise the timeout or run it manually.',
    };
  }

  const haystack = `${result.stderr}\n${result.stdout}`;
  for (const pattern of SETUP_PATTERNS) {
    const m = haystack.match(pattern.re);
    if (m) {
      return {
        kind: 'setup',
        message: `The test runner didn't start — ${pattern.describe(m)}.`,
        hint: 'Install it (e.g. `pip install pytest` / `npm install`), or fix the test_command in .helpcode/project.json. This is a setup issue, not something to send back to Claude.',
      };
    }
  }

  return {
    kind: 'test',
    message: 'Tests ran and some failed.',
    hint: 'Run `helpcode ask "..."` to send the failure back to Claude.',
  };
}
