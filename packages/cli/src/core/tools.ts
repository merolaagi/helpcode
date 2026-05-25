/**
 * Tool runner. Spawns subprocesses and captures their output in a
 * helpcode-friendly form.
 *
 * - Cross-platform (uses spawn directly, no shell unless asked)
 * - Timeout enforced
 * - Returns structured result so callers can decide what to display
 */

import { spawn } from 'child_process';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface RunOptions {
  /** Timeout in seconds. Defaults to 60. */
  timeoutSecs?: number;
  /** Working directory. Defaults to process.cwd(). */
  cwd?: string;
  /** Environment variables to merge into the subprocess env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Run a shell command (parsed by the OS shell) and return its result.
 * On Windows this uses cmd.exe, on POSIX it uses bash via `/bin/sh -c`.
 */
export async function runShellCommand(
  command: string,
  opts: RunOptions = {},
): Promise<CommandResult> {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const shellFlag = isWindows ? '/c' : '-c';
  return runProcess(shell, [shellFlag, command], opts);
}

/**
 * Run a process by argv (no shell). Use this when you control the args.
 */
export async function runProcess(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<CommandResult> {
  const timeoutMs = (opts.timeoutSecs ?? 60) * 1000;
  const start = Date.now();

  return new Promise(resolve => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => stdoutChunks.push(d));
    child.stderr?.on('data', (d: Buffer) => stderrChunks.push(d));

    child.on('error', err => {
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout: '',
        stderr: `Failed to start: ${err.message}`,
        durationMs: Date.now() - start,
        timedOut: false,
      });
    });

    child.on('close', exitCode => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (exitCode ?? 0),
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        durationMs: Date.now() - start,
        timedOut,
      });
    });
  });
}
