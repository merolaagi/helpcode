/**
 * Compression helpers — make long process output fit in a Claude prompt
 * without losing the signal.
 */

const DEFAULT_MAX_LINES = 40;
const DEFAULT_TRACEBACK_LINES = 25;

/**
 * If `text` exceeds `maxLines`, keep the first third and last two-thirds,
 * replacing the middle with a one-line summary of what was omitted.
 */
export function truncateLines(
  text: string,
  maxLines: number = DEFAULT_MAX_LINES,
  label: string = 'lines',
): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return text;

  const head = Math.floor(maxLines / 3);
  const tail = maxLines - head;
  const omitted = lines.length - maxLines;

  return [
    ...lines.slice(0, head),
    `... [${omitted} ${label} omitted] ...`,
    ...lines.slice(lines.length - tail),
  ].join('\n');
}

/**
 * If stderr contains a Python traceback, return just the traceback (trimmed).
 * Otherwise return the stderr trimmed to `maxLines`.
 */
export function extractTraceback(
  stderr: string,
  maxLines: number = DEFAULT_TRACEBACK_LINES,
): string {
  const idx = stderr.indexOf('Traceback');
  if (idx >= 0) {
    return truncateLines(stderr.slice(idx), maxLines, 'traceback lines');
  }
  return truncateLines(stderr.trim(), maxLines, 'stderr lines');
}
