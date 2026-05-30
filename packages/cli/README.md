# helpcode

> A local agent that makes Claude.ai conversations efficient enough to ship real projects on a Pro subscription.

[![CI](https://github.com/merolaagi/helpcode/actions/workflows/ci.yml/badge.svg)](https://github.com/merolaagi/helpcode/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/helpcode.svg)](https://www.npmjs.com/package/helpcode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

helpcode is a small local CLI for developers who use Claude.ai to write code. It does the mechanical work of an AI coding loop — selecting the right files, running tests, applying diffs, capturing errors — so the conversation turns you spend on Claude get used for actual thinking.

**It does not call Claude.** You stay in Claude.ai, copy-paste with it as normal, and helpcode handles everything around that conversation. Optionally, it uses a **local model on your own machine** (via [Ollama](https://ollama.com)) to do the cheap reasoning — like working out which files matter for a task — so even that doesn't cost you a Claude turn.

---

## Why this exists

A year ago, you could build a real piece of software in a day or two with Claude Code. The tool was new, the usage envelope was generous, and the iteration loop was fast.

Today, Claude Code is significantly better — and significantly more in demand. Per-task pricing is fair for what you get, but at the $20/month Pro tier, a few iterations on a real codebase can consume more budget than a casual developer can sustain. Meanwhile, every routine "did the test pass?" or "which files are even relevant?" step burns frontier-model effort on work that doesn't need a frontier model.

helpcode addresses both:

- **For the developer:** each Claude conversation does more, because helpcode compresses context, structures prompts, and parses replies. One turn produces real progress instead of three turns of setup.
- **For energy and cost:** routine plumbing runs locally — on a small model on your own hardware, or as plain deterministic code — instead of in a datacenter. Claude is reserved for actual reasoning. The right tool for the right job.

This is the **two-layer model**: cheap local intelligence for the plumbing, expensive remote intelligence (Claude) for the thinking.

---

## What it does

Six commands. No daemons, no watchers, no background processes.

| Command | What it does |
|---|---|
| `helpcode init` | Detect your project — language, framework, test runner, and any local Ollama model — and write `.helpcode/project.json` |
| `helpcode ask "..."` | Compose a structured prompt for Claude.ai. Picks the relevant files (with a local model if available), includes last test output, and a response-format spec |
| `helpcode apply` | Paste Claude's reply; helpcode parses it, shows the planned changes, applies the diffs, runs tests |
| `helpcode run "..."` | Run any shell command, get the output in compact form (perfect for pasting back to Claude) |
| `helpcode status` | What does helpcode think the current state is? |
| `helpcode reset` | Clear state and start fresh (your code is never touched) |

---

## The local-model layer (optional)

If you have [Ollama](https://ollama.com) installed with a coding model pulled (e.g. `qwen2.5-coder`), `helpcode init` detects it automatically and `helpcode ask` will use it to **reason about which files are relevant** to your task — not just keyword-match them.

The difference, on a real task:

```bash
$ helpcode ask "add a glucose variability calculation" --explain-selection
selecting files (local model: qwen2.5-coder:7b)...
✓ selected 2 file(s) via local model
  src/analyze.py — contains the time-in-range function a variability calc would extend
  tests/test_analyze.py — where the new calculation's tests belong
```

A plain keyword search would match files that literally contain "glucose." A local model understands that a *variability* calculation naturally extends the *time-in-range* function already in `analyze.py` — reasoning the keyword approach can't do.

**It never gets in the way.** If Ollama isn't installed, isn't running, times out, or returns nothing useful, helpcode silently falls back to a fast keyword heuristic. The local model is a free upgrade when present, never a dependency.

Useful flags:
- `--no-llm` — force the keyword heuristic for this run
- `--explain-selection` — show why each file was chosen

Configure the model in `.helpcode/project.json`:

```jsonc
"ollama": {
  "enabled": true,
  "model": "qwen2.5-coder:7b",   // or 14b / deepseek-coder-v2 for more reasoning
  "host": "http://localhost:11434",
  "timeoutMs": 20000
}
```

---

## Install

```bash
npm install -g @manishbht/helpcode
```

Requires Node.js 20 or later. Tested on macOS, Linux, and Windows.

You don't need an API key. You don't need to sign up for anything. helpcode never calls Claude or any other remote AI service — it just helps you talk to Claude.ai more efficiently. The only optional integration is a local Ollama server on your own machine.

---

## A typical session

```bash
# In your project, once:
$ helpcode init
✓ Initialised .helpcode/project.json

Detected:
  language:    python
  framework:   Flask
  source dirs: app, tests
  test cmd:    pytest -q --tb=short
  ollama:      enabled, model: qwen2.5-coder:7b

# Start a task:
$ helpcode ask "fix the login bug where uppercase emails fail"
selecting files (local model: qwen2.5-coder:7b)...
✓ selected 2 file(s) via local model

────────────────────────────────────────────────────────────
  COPY EVERYTHING BELOW INTO CLAUDE.AI
────────────────────────────────────────────────────────────
## Project context
- Language: python
- Framework: Flask

## Files (2)
### `app/auth.py`
... (relevant code)

## My task
fix the login bug where uppercase emails fail

## Please respond in this format
...
```

You paste that into Claude.ai. Claude replies in the structured format. You paste the reply back:

```bash
$ helpcode apply
# (paste Claude's reply, press Ctrl-D)

Plan:
  Lowercase the email before lookup in USERS.

Files to change:
  • app/auth.py

Apply these changes? [y/N] y
✓ patched app/auth.py
running: pytest tests/test_auth.py -v
Exit: 0    Time: 0.32s
3 passed in 0.32s

✓ Tests pass. Ready to commit when you are.
```

Each turn with Claude does real work — no re-pasting the test output, the imports, and your Python version every time.

---

## What it is not

- **Not an agent that calls Claude.** No API key, no surprise costs. You stay in the loop.
- **Not a replacement for Claude Code** — which is excellent at autonomous, multi-step work. helpcode is for people who'd rather stay inside their Pro subscription.
- **Not a sandbox.** It runs your code with your normal permissions. Don't run code you don't trust.
- **Not multi-provider orchestration — yet.** Routing across several models with budget caps is the v0.3 horizon. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Privacy

Everything stays on your machine. helpcode makes no network calls except to npm (once, during install) and — if you enable it — to a local Ollama server on `localhost`. It never sends your code to any remote service. Read [`docs/PRIVACY.md`](docs/PRIVACY.md) for the full breakdown.

The only thing that leaves your machine is whatever **you** paste into Claude.ai, which is your existing relationship with Anthropic.

---

## Contributing

Yes please. helpcode is small enough that the entire CLI is readable in an evening, and the architecture is explicitly designed for community evolution. Start with:

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to set up and where to start
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the design doc this is built from
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what's planned and why

Good first issues are labelled [`good first issue`](https://github.com/merolaagi/helpcode/issues?q=label%3A%22good+first+issue%22) on the issue tracker.

---

## License

MIT. See [`LICENSE`](LICENSE).
