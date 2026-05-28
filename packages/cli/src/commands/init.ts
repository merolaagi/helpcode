/**
 * `helpcode init` — detect the project, write .helpcode/project.json,
 * make sure .helpcode/ is gitignored.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildDetectedConfig, projectExists, saveProjectConfig } from '../core/project.js';
import { isOllamaReachable, listModels } from '../core/ollama.js';
import { c, log } from '../lib/ui.js';

export interface InitOptions {
  force?: boolean;
  /**
   * Skip the Ollama liveness probe. Used by tests so they never do real
   * network I/O. In normal use this is always false.
   */
  skipOllamaDetection?: boolean;
}

/** Coder-tuned models preferred for file-selection reasoning, best first. */
const PREFERRED_MODELS = [
  'qwen2.5-coder', 'deepseek-coder-v2', 'codestral', 'llama3.1', 'mistral',
];

export async function handleInit(opts: InitOptions = {}): Promise<number> {
  const cwd = process.cwd();

  if (projectExists(cwd) && !opts.force) {
    log.warn('.helpcode/project.json already exists.');
    log.dim('Pass --force to regenerate.');
    return 1;
  }

  const config = buildDetectedConfig(cwd);

  // Detect Ollama. If reachable with a model, enable LLM selection and pick
  // the best available coder model as the default.
  let ollamaNote = '(not detected — LLM file selection off; install Ollama to enable)';
  if (config.ollama && !opts.skipOllamaDetection) {
    const host = config.ollama.host;
    const reachable = await isOllamaReachable(host, { timeoutMs: 1000 });
    if (reachable) {
      try {
        const models = await listModels(host, { timeoutMs: 2000 });
        const chosen = pickModel(models);
        if (chosen) {
          config.ollama.enabled = true;
          config.ollama.model = chosen;
          ollamaNote = `enabled, model: ${chosen}`;
        } else if (models.length > 0) {
          config.ollama.enabled = true;
          config.ollama.model = models[0];
          ollamaNote = `enabled, model: ${models[0]} (no coder model found — consider pulling qwen2.5-coder)`;
        } else {
          ollamaNote = 'reachable but no models pulled — run `ollama pull qwen2.5-coder`';
        }
      } catch {
        ollamaNote = 'reachable but model list failed — left disabled';
      }
    }
  }

  saveProjectConfig(config, cwd);

  log.ok('Initialised .helpcode/project.json');
  console.log();
  console.log('Detected:');
  console.log(`  ${c.dim('language:    ')}${config.language}`);
  console.log(`  ${c.dim('framework:   ')}${config.framework ?? '(none)'}`);
  console.log(`  ${c.dim('source dirs: ')}${config.sourceDirs.join(', ')}`);
  console.log(`  ${c.dim('test cmd:    ')}${config.testCommand ?? '(none detected)'}`);
  console.log(`  ${c.dim('ollama:      ')}${ollamaNote}`);
  console.log();

  ensureGitignore(cwd);

  log.dim('Edit .helpcode/project.json to override any of the above.');
  log.dim('Next: `helpcode ask "your task"`');
  return 0;
}

/** Pick the best preferred model present, matching on prefix. */
function pickModel(available: string[]): string | null {
  for (const pref of PREFERRED_MODELS) {
    const match = available.find(m => m.startsWith(pref));
    if (match) return match;
  }
  return null;
}

function ensureGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, '.gitignore');
  const line = '.helpcode/';
  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf-8');
    if (existing.split(/\r?\n/).some(l => l.trim() === line)) {
      return; // already there
    }
  }
  const updated = existing.endsWith('\n') || existing.length === 0
    ? existing + line + '\n'
    : existing + '\n' + line + '\n';
  fs.writeFileSync(gitignorePath, updated, 'utf-8');
  log.ok('Added .helpcode/ to .gitignore');
}
