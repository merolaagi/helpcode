/**
 * Project detection. Sniffs the working directory to make reasonable
 * assumptions about language, framework, and test command.
 *
 * The detected config is written to .helpcode/project.json by `init`.
 * The user can edit it; helpcode never re-detects after init unless asked.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig } from '../types.js';
import { HelpcodeError, ErrorCode } from '../lib/errors.js';

const STATE_DIR = '.helpcode';
const PROJECT_FILE = path.join(STATE_DIR, 'project.json');

function readBlob(root: string, files: string[]): string {
  let blob = '';
  for (const f of files) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) {
      try {
        blob += fs.readFileSync(p, 'utf-8').toLowerCase() + '\n';
      } catch {
        // ignore unreadable files
      }
    }
  }
  return blob;
}

export function detectLanguage(root: string): ProjectConfig['language'] {
  if (fs.existsSync(path.join(root, 'pyproject.toml')) ||
      fs.existsSync(path.join(root, 'requirements.txt')) ||
      fs.existsSync(path.join(root, 'setup.py')) ||
      fs.existsSync(path.join(root, 'Pipfile'))) {
    return 'python';
  }
  if (fs.existsSync(path.join(root, 'tsconfig.json'))) {
    return 'typescript';
  }
  if (fs.existsSync(path.join(root, 'package.json'))) {
    return 'javascript';
  }
  return 'unknown';
}

export function detectFramework(root: string): string | null {
  const blob = readBlob(root, ['requirements.txt', 'pyproject.toml', 'package.json', 'Pipfile']);

  if (fs.existsSync(path.join(root, 'manage.py')) || blob.includes('django')) {
    return 'Django';
  }
  if (blob.includes('"fastapi"') || blob.includes('fastapi==') || blob.includes('fastapi>=')) {
    return 'FastAPI';
  }
  if (blob.includes('"flask"') || blob.includes('flask==') || blob.includes('flask>=')) {
    return 'Flask';
  }
  if (blob.includes('"next"')) return 'Next.js';
  if (blob.includes('"express"')) return 'Express';
  if (blob.includes('"react"')) return 'React';
  if (blob.includes('"vue"')) return 'Vue';
  return null;
}

export function detectTestCommand(root: string, language: ProjectConfig['language']): string | null {
  if (language === 'python') {
    if (fs.existsSync(path.join(root, 'manage.py'))) {
      return 'python manage.py test --verbosity=1';
    }
    // pytest is the default for everything else Python
    return 'pytest -q --tb=short';
  }
  if (language === 'javascript' || language === 'typescript') {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
      if (pkg.scripts && typeof pkg.scripts.test === 'string') {
        return 'npm test';
      }
    } catch {
      // fall through
    }
  }
  return null;
}

/** Directory names we never treat as source dirs. */
const NON_SOURCE_DIRS = new Set([
  '.git', '.venv', 'venv', 'env', 'node_modules', '__pycache__',
  '.pytest_cache', '.mypy_cache', 'dist', 'build', '.next', '.idea',
  '.vscode', '.helpcode', 'coverage', '.cache', 'site-packages',
  'migrations', '.tox', 'htmlcov', '__snapshots__',
]);

const SOURCE_FILE_EXTS = new Set([
  '.py', '.js', '.ts', '.jsx', '.tsx', '.go', '.rs', '.rb', '.java',
]);

/**
 * Detect source directories by finding top-level dirs that actually contain
 * source files (directly or shallowly nested), rather than matching a fixed
 * list of names. This means non-standard layouts — Django apps like `shop/`
 * or `billing/`, a `core/` package, etc. — are picked up automatically.
 *
 * Strategy: scan immediate children of root. A child dir is a source dir if
 * it (or its shallow descendants) contains at least one source file. Also
 * include root itself if it has source files directly. Falls back to ['.'].
 */
export function detectSourceDirs(root: string): string[] {
  const found: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return ['.'];
  }

  let rootHasSource = false;
  for (const entry of entries) {
    if (entry.isFile() && SOURCE_FILE_EXTS.has(path.extname(entry.name))) {
      rootHasSource = true;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (NON_SOURCE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    if (dirContainsSource(path.join(root, entry.name), 2)) {
      found.push(entry.name);
    }
  }

  if (rootHasSource) found.unshift('.');
  return found.length > 0 ? found : ['.'];
}

/** Does this dir contain a source file within `maxDepth` levels? */
function dirContainsSource(dir: string, maxDepth: number): boolean {
  if (maxDepth < 0) return false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && SOURCE_FILE_EXTS.has(path.extname(entry.name))) {
      return true;
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()
        && !NON_SOURCE_DIRS.has(entry.name)
        && !entry.name.startsWith('.')) {
      if (dirContainsSource(path.join(dir, entry.name), maxDepth - 1)) return true;
    }
  }
  return false;
}

export function buildDetectedConfig(root: string): ProjectConfig {
  const language = detectLanguage(root);
  return {
    root,
    language,
    framework: detectFramework(root),
    testCommand: detectTestCommand(root, language),
    sourceDirs: detectSourceDirs(root),
    createdAt: new Date().toISOString(),
    // Default: disabled. `init` upgrades this to enabled with a detected
    // model if Ollama is reachable. Users can flip `enabled` any time.
    ollama: {
      enabled: false,
      model: 'qwen2.5-coder:7b',
      host: 'http://localhost:11434',
      timeoutMs: 20000,
    },
  };
}

export function loadProjectConfig(cwd: string = process.cwd()): ProjectConfig {
  const file = path.join(cwd, PROJECT_FILE);
  if (!fs.existsSync(file)) {
    throw new HelpcodeError(
      ErrorCode.STATE_ERROR,
      `No ${PROJECT_FILE} found in ${cwd}.`,
      'Run `helpcode init` first to set up the project.',
    );
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ProjectConfig;
  } catch (e) {
    throw new HelpcodeError(
      ErrorCode.STATE_ERROR,
      `Could not parse ${PROJECT_FILE}: ${(e as Error).message}`,
      'The file may be corrupt. Run `helpcode init --force` to regenerate.',
    );
  }
}

export function saveProjectConfig(cfg: ProjectConfig, cwd: string = process.cwd()): void {
  const dir = path.join(cwd, STATE_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(cwd, PROJECT_FILE), JSON.stringify(cfg, null, 2), 'utf-8');
}

export function projectExists(cwd: string = process.cwd()): boolean {
  return fs.existsSync(path.join(cwd, PROJECT_FILE));
}
