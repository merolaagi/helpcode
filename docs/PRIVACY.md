# Privacy

helpcode is designed to be trustworthy with your code. This document explains exactly what stays on your machine, what leaves it, and how that's enforced.

---

## TL;DR

- Your source code never leaves your machine because of helpcode
- helpcode makes no network calls itself
- The only data that goes anywhere is what **you** paste into Claude.ai — that's your existing relationship with Anthropic, not anything helpcode adds
- Everything helpcode writes to disk is in your project under `.helpcode/`, which `init` automatically adds to `.gitignore`

---

## What stays on your machine

- **All source code.** helpcode reads files from your project; it never uploads them.
- **All conversation state.** `.helpcode/state.json` lives in your project directory. Plain JSON. Human-readable. Yours.
- **All prompts (until you paste them).** helpcode writes generated prompts to `.helpcode/pending.txt` for re-copying. The file never leaves your machine.
- **All test output.** Captured in state, used by future prompts if you choose to include it.
- **All Claude responses (after you paste them back).** Stored in state for the parser to work with.

---

## What leaves your machine

**Only what you actively paste into Claude.ai.** That's not a helpcode action — that's you, in your browser, using your existing Claude account. helpcode prepares the text. You choose whether to send it.

If you don't paste, nothing leaves. helpcode has no automatic submission, no background sync, and no fallback channel.

---

## What helpcode never does

- ❌ Call Claude's API (no API key, no automatic submission)
- ❌ Call any other AI service
- ❌ Phone home for usage telemetry
- ❌ Check for updates over the network
- ❌ Send error reports to a server
- ❌ Read files outside your project directory
- ❌ Modify files outside your project directory (except `.gitignore` during `init`, with that one line addition)

---

## Network calls

helpcode itself makes **zero network calls** during operation. The only network activity from the install:

1. `npm install` fetches the package from the npm registry — same as any npm package
2. (Future, when implemented) Ollama integration in v0.2 will connect to `localhost:11434` — local only, no remote services

CI workflows fetch test dependencies from npm. End users never trigger these.

---

## Subprocess execution

helpcode does run subprocesses (your tests, git, etc.) when you ask it to via `run` or `apply`. These run with **your normal user permissions** in your project directory. Don't pass untrusted code to helpcode.

When parsing a Claude response that includes a `## TEST` block, helpcode will run that command **after** showing you the planned changes and asking for confirmation. The `--yes` flag skips confirmation; use it only when you've audited the command Claude is suggesting.

---

## Secrets and `.env` files

helpcode's file selector deliberately excludes:

- Anything inside ignored directories (`.git`, `.venv`, `node_modules`, etc.)
- Files outside the configured source directories (per `.helpcode/project.json`)

It does not specifically exclude `.env` files yet — but it also doesn't specifically include them, since they're usually not in source dirs. If you have `.env` files in scanned directories and want to be extra cautious:

- Keep them out of your `sourceDirs` in `.helpcode/project.json`
- Or add them to `.gitignore` (which we recommend anyway)

A future version (v0.2+) will add an explicit blocklist for filenames like `.env`, `secrets.yml`, etc.

---

## Reporting privacy issues

If you find a way helpcode is leaking data, please open a security advisory via GitHub's private vulnerability reporting. Don't open a public issue — give us a chance to fix it first.

---

## Verifying for yourself

helpcode is small enough that you can read the entire CLI in an evening. The places to check if you're privacy-conscious:

- `packages/cli/src/core/tools.ts` — all subprocess execution lives here
- `packages/cli/src/lib/git.ts` — git invocation (local only)
- `package.json` — dependencies (currently: just TypeScript and `@types/node`)

Grep for `http`, `fetch`, `https`, `axios`, or `node-fetch` in the codebase — you'll find nothing.
