# helpcode

> A local agent that makes Claude.ai conversations efficient enough to ship real projects on a Pro subscription.

[![CI](https://github.com/merolaagi/helpcode/actions/workflows/ci.yml/badge.svg)](https://github.com/merolaagi/helpcode/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/helpcode.svg)](https://www.npmjs.com/package/helpcode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

helpcode is a small local CLI for developers who use Claude.ai to write code. It does the mechanical work of an AI coding loop — selecting context, running tests, applying diffs, capturing errors — so that the conversation turns you spend on Claude get used for actual thinking.

**It does not call Claude.** You stay in Claude.ai, copy-paste with it as normal, and helpcode handles everything around that conversation.

---

## Why this exists

A year ago, you could build a real piece of software in a day or two with Claude Code. The tool was new, the usage envelope was generous, and the iteration loop was fast.

Today, Claude Code is significantly better — and significantly more in demand. Per-task pricing is fair for what you get, but at the $20/month Pro tier, a few iterations on a real codebase can consume more budget than a casual developer can sustain. Meanwhile, every routine "did the test pass?" or "what does this traceback mean?" round-trip burns frontier-model inference on work that doesn't need a frontier model.

helpcode addresses both:

- **For the developer:** each Claude conversation does more, because helpcode compresses context, structures prompts, and parses replies. One turn produces real progress instead of three turns of setup.
- **For energy:** routine plumbing work runs locally instead of in a datacenter. Claude is reserved for actual reasoning. The right tool for the right job.

---

## What it does

Six commands. No daemons, no watchers, no background processes.

| Command | What it does |
|---|---|
| `helpcode init` | Detect your project — language, framework, test runner — and write `.helpcode/project.json` |
| `helpcode ask "..."` | Compose a structured prompt for Claude.ai. Includes relevant files, last test output, and a response-format spec |
| `helpcode apply` | Paste Claude's reply; helpcode parses it, shows the planned changes, applies the diffs, runs tests |
| `helpcode run "..."` | Run any shell command, get the output in compact form (perfect for pasting back to Claude) |
| `helpcode status` | What does helpcode think the current state is? |
| `helpcode reset` | Clear state and start fresh (your code is never touched) |

That's the whole tool. v0.1 is deliberately small.

---

## Install

```bash
npm install -g helpcode
```

Requires Node.js 20 or later. Tested on macOS, Linux, and Windows.

You don't need an API key. You don't need to sign up for anything. helpcode does not call any AI service — it just helps you talk to Claude.ai more efficiently.

---

## A typical session

```bash
# In your project, once:
$ helpcode init
✓ Initialised .helpcode/project.json

Detected:
  language:    python
  framework:   Flask
  source dirs: app
  test cmd:    pytest -q --tb=short

# Start a task:
$ helpcode ask "fix the login bug where uppercase emails fail"

────────────────────────────────────────────────────────────
  COPY EVERYTHING BELOW INTO CLAUDE.AI
────────────────────────────────────────────────────────────

## Project context
- Language: python
- Framework: Flask
- Last commit: 84e29dd P&L admin polish (2 hours ago)

## Files (2)

### `app/auth.py`
```python
def login(email, password):
    user = merolaagiS.get(email)
    ...
```

### `app/models.py`
```python
class User:
    ...
```

## My task
fix the login bug where uppercase emails fail

## Please respond in this format
...
```

You paste that into Claude.ai. Claude replies with a structured response. You paste the reply back:

```bash
$ helpcode apply
# (paste Claude's reply, press Ctrl-D)

Plan:
  Lowercase the email before lookup in merolaagiS.

Files to change:
  • app/auth.py

Test command:
  pytest tests/test_auth.py -v

Apply these changes? [y/N] y
✓ patched app/auth.py
running: pytest tests/test_auth.py -v

Exit: 0    Time: 0.32s
3 passed in 0.32s

✓ Tests pass. Ready to commit when you are.
```

Three turns of conversation with Claude. Each turn does real work. No "let me also paste the test output... and the imports... and what version of Python I'm using..."

---

## How it stays small

helpcode is **not**:

- An agent that calls Claude on its own (no API key, no surprise costs)
- A replacement for Claude Code (which is excellent at what it does)
- A multi-LLM orchestration platform — that's planned for [v0.3](docs/ROADMAP.md)
- A sandbox — it runs your code with your normal permissions; don't run code you don't trust

helpcode is intentionally a thin layer of "do the boring stuff" between you and Claude.ai. Multi-LLM orchestration, IDE integration, and local-model assistance are on the [roadmap](docs/ROADMAP.md), but v0.1 ships the smallest possible useful tool.

---

## Privacy

Everything stays on your machine. helpcode makes no network calls except to npm (once, during install) and never sends your code anywhere. Read [`docs/PRIVACY.md`](docs/PRIVACY.md) for the full breakdown.

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
