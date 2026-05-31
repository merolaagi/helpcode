/**
 * helpcode — CLI router.
 *
 * Commands, kept deliberately small:
 *   init     detect project and set up .helpcode/
 *   ask      compose a prompt for Claude.ai
 *   apply    apply Claude's reply
 *   run      run a shell command, get compact output
 *   status   show current state
 *   cockpit  show the sous-chef kitchen this session (v0.3)
 *   reset    clear state
 */

import { handleInit } from './commands/init.js';
import { handleAsk } from './commands/ask.js';
import { handleApply } from './commands/apply.js';
import { handleRun } from './commands/run.js';
import { handleStatus } from './commands/status.js';
import { handlePlan } from './commands/plan.js';
import { handleCockpit } from './commands/cockpit.js';
import { handleReset } from './commands/reset.js';
import { HelpcodeError } from './lib/errors.js';
import { c, log } from './lib/ui.js';

const VERSION = '0.3.7';

const HELP = `helpcode v${VERSION}

A local agent that makes Claude.ai conversations efficient enough to ship
real projects on a Pro subscription.

USAGE:
  helpcode <command> [options]

COMMANDS:
  init                       Detect this project and set up .helpcode/
  ask "<task>" [options]     Compose a Claude prompt for the given task
       --files <paths...>      include specific files (skips auto-selection)
       --no-llm                force keyword selection even if Ollama is on
       --explain-selection     show why each file was chosen
  plan "<task>"              Propose an ordered breakdown of a big task (local model)
  apply [--yes] [--dry-run]  Apply Claude's pasted reply (from stdin)
  run "<command>"            Run a shell command, get compact output
  status                     Show current task and state
  cockpit [--html] [--out F]  Show the kitchen; --html writes a visual cockpit
  reset [--yes]              Clear state (project config is untouched)

GLOBAL FLAGS:
  --version                  Print version and exit
  --help                     Show this help

Read more: https://github.com/USER/helpcode
`;

export async function run(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return 0;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(VERSION);
    return 0;
  }

  const [cmd, ...rest] = argv;

  try {
    switch (cmd) {
      case 'init':
        return await handleInit({ force: rest.includes('--force') });

      case 'ask': {
        const files = extractFlagValues(rest, '--files');
        const task = rest.filter(a => !a.startsWith('--') && !files.includes(a)).join(' ');
        return await handleAsk(task, {
          files: files.length ? files : undefined,
          noLlm: rest.includes('--no-llm'),
          explainSelection: rest.includes('--explain-selection'),
        });
      }

      case 'plan': {
        const task = rest.filter(a => !a.startsWith('--')).join(' ');
        return await handlePlan(task);
      }

      case 'apply':
        return await handleApply({
          yes: rest.includes('--yes'),
          dryRun: rest.includes('--dry-run'),
        });

      case 'run': {
        const command = rest.filter(a => !a.startsWith('--')).join(' ');
        const timeout = extractFlagInt(rest, '--timeout');
        return await handleRun(command, timeout !== null ? { timeout } : {});
      }

      case 'status':
        return await handleStatus();

      case 'cockpit': {
        const out = extractFlagValues(rest, '--out')[0];
        return await handleCockpit({ html: rest.includes('--html'), out });
      }

      case 'reset':
        return await handleReset({ yes: rest.includes('--yes') });

      default:
        log.err(`Unknown command: ${cmd}`);
        console.log();
        console.log(HELP);
        return 1;
    }
  } catch (e) {
    if (e instanceof HelpcodeError) {
      log.err(e.message);
      if (e.hint) console.log(c.dim('  ' + e.hint));
      return 1;
    }
    log.err((e as Error).message);
    return 1;
  }
}

function extractFlagValues(args: string[], flag: string): string[] {
  const idx = args.indexOf(flag);
  if (idx === -1) return [];
  const values: string[] = [];
  for (let i = idx + 1; i < args.length; i++) {
    if (args[i].startsWith('--')) break;
    values.push(args[i]);
  }
  return values;
}

function extractFlagInt(args: string[], flag: string): number | null {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  const n = parseInt(args[idx + 1], 10);
  return Number.isNaN(n) ? null : n;
}
