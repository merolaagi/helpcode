/**
 * Tiny terminal UI helpers. Zero dependencies.
 *
 * Colors degrade gracefully when stdout isn't a TTY (CI, pipes).
 */

const supportsColor = process.stdout.isTTY && process.env.NO_COLOR !== '1';

const codes = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function color(c: keyof typeof codes, s: string): string {
  return supportsColor ? codes[c] + s + codes.reset : s;
}

export const c = {
  bold: (s: string) => color('bold', s),
  dim: (s: string) => color('dim', s),
  red: (s: string) => color('red', s),
  green: (s: string) => color('green', s),
  yellow: (s: string) => color('yellow', s),
  blue: (s: string) => color('blue', s),
  cyan: (s: string) => color('cyan', s),
  gray: (s: string) => color('gray', s),
};

const DIVIDER = '─'.repeat(60);

/**
 * Print text inside a clearly-marked block so the user knows what to copy.
 * Format:
 *
 *   ───────── COPY EVERYTHING BELOW INTO CLAUDE.AI ─────────
 *   <body>
 *   ───────── END COPY BLOCK ─────────
 */
export function printPasteBlock(body: string): void {
  console.log();
  console.log(c.cyan(DIVIDER));
  console.log(c.cyan('  COPY EVERYTHING BELOW INTO CLAUDE.AI'));
  console.log(c.cyan(DIVIDER));
  console.log();
  console.log(body);
  console.log();
  console.log(c.cyan(DIVIDER));
  console.log(c.cyan('  END COPY BLOCK'));
  console.log(c.cyan(DIVIDER));
}

/** Print a header for a section of output. */
export function header(title: string): void {
  console.log();
  console.log(c.bold(title));
  console.log(c.dim('─'.repeat(title.length)));
}

/** A simple status line. Use info/warn/ok/err. */
export const log = {
  info: (msg: string) => console.log(`${c.blue('•')} ${msg}`),
  ok: (msg: string) => console.log(`${c.green('✓')} ${msg}`),
  warn: (msg: string) => console.log(`${c.yellow('!')} ${msg}`),
  err: (msg: string) => console.error(`${c.red('✗')} ${msg}`),
  dim: (msg: string) => console.log(c.dim(msg)),
};

/**
 * Read all of stdin until EOF. Used for `helpcode apply` to receive
 * Claude's pasted response.
 */
export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    log.dim('Paste Claude\'s reply, then press Ctrl-D (Linux/Mac) or Ctrl-Z+Enter (Windows):');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/** Simple Y/n prompt that defaults to N. */
export async function confirm(question: string): Promise<boolean> {
  process.stdout.write(`${question} ${c.dim('[y/N]')} `);
  return new Promise(resolve => {
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', (data: string) => {
      process.stdin.pause();
      resolve(data.trim().toLowerCase().startsWith('y'));
    });
  });
}
