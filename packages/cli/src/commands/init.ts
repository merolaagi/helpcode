/**
 * `helpcode init` — detect the project, write .helpcode/project.json,
 * make sure .helpcode/ is gitignored.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildDetectedConfig, projectExists, saveProjectConfig } from '../core/project.js';
import { c, log } from '../lib/ui.js';

export interface InitOptions {
  force?: boolean;
}

export async function handleInit(opts: InitOptions = {}): Promise<number> {
  const cwd = process.cwd();

  if (projectExists(cwd) && !opts.force) {
    log.warn('.helpcode/project.json already exists.');
    log.dim('Pass --force to regenerate.');
    return 1;
  }

  const config = buildDetectedConfig(cwd);
  saveProjectConfig(config, cwd);

  log.ok('Initialised .helpcode/project.json');
  console.log();
  console.log('Detected:');
  console.log(`  ${c.dim('language:    ')}${config.language}`);
  console.log(`  ${c.dim('framework:   ')}${config.framework ?? '(none)'}`);
  console.log(`  ${c.dim('source dirs: ')}${config.sourceDirs.join(', ')}`);
  console.log(`  ${c.dim('test cmd:    ')}${config.testCommand ?? '(none detected)'}`);
  console.log();

  ensureGitignore(cwd);

  log.dim('Edit .helpcode/project.json to override any of the above.');
  log.dim('Next: `helpcode ask "your task"`');
  return 0;
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
