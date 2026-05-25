# Roadmap

helpcode v0.1 ships the smallest useful tool. This document is where the *rest* of the vision lives — so we can ship 0.1 without scope creep, and so contributors know what's coming.

This roadmap is **directional, not committed**. Versions and timing will shift based on what actual users hit, what the community contributes, and what stays true to the core principles.

---

## Where we are: v0.1.0 (May 2026)

Foundation release. Six commands. Single-Claude workflow. No automation beyond "compress the input and parse the output."

- `init`, `ask`, `apply`, `run`, `status`, `reset`
- Python and JavaScript/TypeScript project detection
- Atomic patching with safety guarantees
- Cross-platform (Linux, macOS, Windows)
- 19 tests passing

---

## v0.2 — Local LLM assistance (next)

**The idea:** add an optional local-model layer (via [Ollama](https://ollama.com/)) for the *plumbing* tasks that don't need a frontier model. Smarter selection, smarter triage, smarter response rescue — all running on your machine.

This is the first step of the two-layer model described in [`ARCHITECTURE.md`](../ARCHITECTURE.md). Frontier compute reserved for the brain work; local compute does the rest.

Specifically:

- **File selection.** Today's heuristic ranks by filename + keyword + recency. A small local model can do semantic ranking instead.
- **Response rescue.** When Claude doesn't follow the protocol (rare but happens), a local model can coerce the response into the expected structure.
- **Output triage.** Long error logs summarised into "what actually failed" by a local model.
- **Commit message drafts.** From the `## PLAN` plus the applied diffs.

Hardware floor: 16GB RAM, no GPU required. Default model: a small Qwen2.5-Coder or Codestral variant. User-configurable.

**Critically:** helpcode without Ollama still does everything it does today. The local-LLM layer is purely additive.

---

## v0.3 — Multi-provider orchestration

**The idea:** route subtasks to whichever frontier model is best (and cheapest) for the work, with explicit spend caps and escalation rules.

When you're working with multiple AI subscriptions or free-tier API access — Claude Pro, ChatGPT Plus, free Gemini, free DeepSeek, etc. — different providers are better at different things, and most have free or cheap tiers that go unused.

helpcode v0.3 will:

- Let you register multiple providers in `.helpcode/providers.json`
- Score each subtask for complexity
- Route low-complexity tasks to free tiers, escalating only when needed
- Enforce a `spendCap` per session and per day
- Use cross-model review (the model that wrote the code is not the one that reviews it)

This is where the cockpit concept (multiple model panels, escalation banner, routing rules) becomes real. v0.3 is the architectural payoff of the careful v0.1 foundation.

---

## v0.4 — Conversation continuity

**The idea:** when a task spans multiple sessions, helpcode remembers what happened across them — not as raw text but as structured summaries.

Today, every `helpcode ask` is essentially a fresh conversation with full context rebuilt. For long-running tasks (debugging something that takes a week, building a feature across many days), this is wasteful.

v0.4 will add:

- Per-task journal entries summarising each iteration (1-2 sentences each)
- Automatic injection of recent journal entries into new prompts
- A `helpcode journal` command to read the journal

---

## v0.5+ — IDE integration

**The idea:** for people who don't want to live in a terminal, a VS Code extension that wraps the CLI.

Same commands, same behavior, just nicer UI: an in-editor paste block, an in-editor "apply changes" preview, status bar showing the current task.

This is explicitly v0.5 or later because shipping an IDE extension well requires a lot of polish that v0.1–v0.4 work doesn't need. Premature IDE integration is a common reason CLI tools never get good as CLI tools.

---

## Things we've considered and said no to

- **Calling Claude's API directly.** Defeats the purpose. Always declined.
- **A hosted SaaS version.** helpcode is local-first. If you want a hosted version, fork the codebase — that's what MIT enables.
- **Telemetry.** No. Not now, not later.
- **An "agent mode" that auto-pastes between helpcode and Claude.** This breaks privacy and the trust model. We'd rather the user stays in the loop.
- **Support for `git apply` instead of our own patcher.** `git apply` is too strict for the kinds of diffs Claude produces. Our patcher is the right tool here.

---

## How to influence the roadmap

1. **Use helpcode on a real project.** Real friction is the best signal.
2. **Open issues for things you hit.** Tag them with what version you'd expect them in.
3. **Open discussions for design ideas.** Especially for v0.3+ (orchestration) where the design space is wide.
4. **Send PRs.** Working code is the strongest form of "I want this."

---

## A word on v0.x

helpcode is intentionally in v0.x for as long as it needs to be. v0.x means we'll break things to get them right. v1.0.0 means the foundations are stable enough that we commit to backwards compatibility on the core commands and the response protocol.

When does v1.0 ship? When v0.x users tell us they're ready.
