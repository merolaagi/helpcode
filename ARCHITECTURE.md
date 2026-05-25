# Architecture

This document describes how helpcode is designed and why. It's the reference we use to decide what belongs in helpcode and what doesn't.

If you're reading this to contribute, also read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## What helpcode is

helpcode is a local CLI agent that handles the **mechanical work** of an AI coding loop — running tests, applying diffs, selecting context, parsing errors — so that the user's conversation turns with Claude.ai are reserved for **actual decisions**.

The user keeps their existing Claude.ai Pro subscription. helpcode does not call Claude. It assembles paste-ready prompts for the user to copy into Claude.ai, and it parses Claude's responses (pasted back) to drive the next mechanical step.

---

## Why helpcode exists

Three motivations, in priority order:

1. **Budget.** A $20/month Claude Pro plan no longer stretches as far as it did. Each round-trip is precious. helpcode makes each round-trip count by removing routine work from it.
2. **Energy.** Frontier-model inference is energy-expensive. Routing mechanical work to local hardware is materially better for the planet, not just for the wallet. This matters whether the user is paying for tokens or not.
3. **Focus.** When the AI is only invoked for genuine decisions, the developer's interaction with the AI becomes higher-signal. Less context-bloat, less drift, less re-explaining.

---

## Who helpcode is for

**Primary user:** A self-taught or early-career developer with a Claude Pro subscription, working on a real project, who can read code but isn't a power user. They want to ship something. They've felt the squeeze on AI tooling.

This shapes every design decision: errors must be readable, defaults must be sensible, and configuration must not be required for the basic case.

**Secondary user:** An experienced developer who wants a frugal, transparent workflow. They benefit from helpcode for the same reasons but need less hand-holding.

We design for the primary user. The secondary user is well-served by accident.

---

## Two-layer model

The conceptual model is two layers of intelligence:

- **Layer 1 — the plumbing (helpcode itself):** Local, free, deterministic where possible. Runs tests, applies diffs, selects context, parses output. Does not need a frontier model.
- **Layer 2 — the brain (Claude.ai):** Frontier model, expensive turns. Designs iterations, writes the right code, diagnoses non-obvious bugs.

The user is the courier between them. helpcode prepares paste blocks for the user to send to Claude; helpcode parses what comes back. Every Claude turn does real work because helpcode handled the setup and will handle the follow-up.

This is the core insight that makes Pro-tier development viable: the model is only consulted when the model is needed.

---

## v0.1 architecture (what's shipped)

```
┌──────────────────────────────────────────────────────────────────┐
│ merolaagi (developer)                                                  │
└────────────────┬─────────────────────────────────────────────────┘
                 │ types a task, pastes Claude responses
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ helpcode CLI (local, free, TypeScript)                            │
│                                                                   │
│  ┌────────────────┐   ┌────────────────┐   ┌──────────────────┐  │
│  │ Project knowl. │   │ Tool runner    │   │ Conversation     │  │
│  │ language, fw,  │   │ run cmd, apply │   │ state across     │  │
│  │ test runner    │   │ diff, run test │   │ turns            │  │
│  └────────────────┘   └────────────────┘   └──────────────────┘  │
│                                                                   │
│  ┌────────────────┐                ┌────────────────────────┐    │
│  │ Prompt builder │ ─────────────► │ stdout: paste block    │    │
│  └────────────────┘                └────────────────────────┘    │
│                                                                   │
│  ┌────────────────┐                ┌────────────────────────┐    │
│  │ Response parser│ ◄───────────── │ stdin: user pastes     │    │
│  └────────────────┘                │ Claude's reply         │    │
│                                    └────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                 │ paste block
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ CLAUDE.AI WEB (user's existing Pro subscription)                  │
│  Returns structured response: diff, plan, test command            │
└──────────────────────────────────────────────────────────────────┘
                 │ user pastes back
                 ▼ (loop closes)
```

---

## Directory structure

```
helpcode/
├── packages/cli/                    # the published npm package
│   ├── bin/helpcode.ts              # entry shim
│   ├── src/
│   │   ├── index.ts                 # CLI router
│   │   ├── types.ts                 # shared TS types
│   │   ├── commands/                # one file per CLI command
│   │   ├── core/                    # project, state, parser, patcher, etc.
│   │   └── lib/                     # errors, ui, compress, git
│   └── tests/{unit,integration}/    # node:test runner
├── docs/
│   ├── PROTOCOL.md                  # the Claude response format
│   ├── PRIVACY.md                   # what stays local
│   └── ROADMAP.md                   # what's planned and when
├── .github/                         # CI, issue templates, PR template
├── ARCHITECTURE.md                  # this file
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
├── LICENSE                          # MIT
└── README.md
```

---

## Data flow — one iteration

**Step 1.** User: `helpcode ask "fix login when uppercase emails fail"`

**Step 2.** helpcode:
- Loads project state and config
- Runs the file selector (heuristic — name match + content keywords + recency)
- Builds a structured prompt (project context, selected files, last test output, the task, the response protocol)
- Saves prompt to `.helpcode/pending.txt` and prints a paste block

**Step 3.** User copies into Claude.ai, gets a reply, runs `helpcode apply` and pastes the reply.

**Step 4.** helpcode:
- Parses the response (see [`docs/PROTOCOL.md`](docs/PROTOCOL.md))
- Shows the planned changes (files, test command, notes)
- Asks for confirmation (skippable with `--yes`)
- Applies each diff atomically; on any failure, stops and reports
- Runs the test command Claude suggested (or project default)
- Reports verdict; updates state to `resolved` or `failed`

**Step 5.** Two outcomes:
- **Clean** — "tests pass, commit when ready"
- **Broken** — the failure is now in state; the user runs `helpcode ask` again and helpcode includes the failure in the next prompt automatically

---

## Conversation state

State lives at `.helpcode/state.json`. It's intentionally **readable JSON**. Users can `cat .helpcode/state.json` to see exactly what helpcode is thinking. No black-box memory.

Schema is documented inline in `packages/cli/src/types.ts`. It carries a `version` field so we can migrate later without breaking existing installs.

---

## Response protocol

This is the single most load-bearing design decision. The protocol uses markdown headers and fenced code blocks because:

1. Claude follows markdown formatting instructions very reliably.
2. The format is human-readable in the chat window.
3. Parsing is deterministic with no LLM rescue needed for the happy path.

The full spec is in [`docs/PROTOCOL.md`](docs/PROTOCOL.md). The parser implementation is in `packages/cli/src/core/parser.ts`. Changes to the protocol require updates to both, and a major version bump.

---

## Privacy and trust

- **Stays on the user's machine:** all source code, conversation state, prompts (until pasted), test output.
- **Leaves the user's machine:** only what the user pastes into Claude.ai (their existing relationship with Anthropic, not ours).
- **No network calls** from helpcode itself. Not now, not ever.

helpcode never applies a diff without showing the user first (unless `--yes`). helpcode never runs a shell command from Claude's response without showing it first. See [`docs/PRIVACY.md`](docs/PRIVACY.md).

---

## What is deliberately out of scope for v0.1

- **Calling Claude's API directly.** Hard line. Defeats the entire purpose.
- **IDE integration.** Planned for v0.5+.
- **Multi-file refactors that span more than ~10 files.** v0.1 handles small, focused iterations.
- **Multi-LLM orchestration.** Planned for v0.3. See [`docs/ROADMAP.md`](docs/ROADMAP.md).
- **Local LLM integration (Ollama).** Planned for v0.2.
- **Non-coding tasks.** No "write me a blog post" support.
- **Multiplayer / team sync.** Single developer, single machine.
- **Telemetry of any kind.** Not now, not later.

If you want to propose adding one of these, please open an issue tagged `discussion` first.

---

## Design principles

When in doubt:

1. **Stay small.** Every feature added is a feature we'll maintain for years.
2. **Make state explicit.** The user should be able to see and understand what helpcode is doing.
3. **Fail loudly, never silently.** Throw `HelpcodeError` with a hint. Never corrupt user data.
4. **Defaults must work.** Configuration is for power users, not the common case.
5. **The CLI surface is the API.** Six commands. Adding a seventh requires an issue and consensus.
6. **Cross-platform from day one.** If it breaks on Windows, it breaks for ~half our audience.
