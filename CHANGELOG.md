# Changelog

All notable changes to helpcode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] — 2026-05-29

### Added

- **Local-LLM output triage** — the second local-model task after file
  selection. When Ollama is enabled and a command (usually a test run)
  produces long output, helpcode asks the local model to extract just the
  key failure — which test failed, the error, the file and line — so the
  next Claude brief carries the signal instead of a 200-line wall of passing
  tests and setup banners. The console still shows the full compact report;
  only the saved-for-next-brief version is summarised.
- `core/triage.ts` — `shouldTriage`, `buildTriagePrompt`, `triageOutput`,
  with an injectable model call for testing (9 new tests).

### Reliability

- Triage follows the same never-break contract as file selection: if Ollama
  is disabled, unreachable, slow, errors, or returns nothing, helpcode falls
  back to the existing deterministic head+tail truncation. Output is never
  lost — worst case is the same truncation as before.
- 84/84 tests passing. No test depends on a live Ollama.

## [0.2.1] — 2026-05-29

### Fixed

- **Source-directory detection no longer relies on a hardcoded name list.**
  `init` previously only recognised dirs named `src`, `app`, `lib`, `tests`,
  etc. Any project with non-standard layout — Django apps like `shop/` or
  `billing/`, a `core/` package, domain-named modules — had those directories
  silently ignored, so file selection (both heuristic and LLM) never saw the
  files in them. Detection is now content-based: any directory containing
  source files is picked up, regardless of its name. Found during v0.2
  dogfooding on a synthetic project whose bug lived in a `shop/` module that
  the old detector skipped entirely.

### Added

- Regression tests for non-standard source-dir names, root-level source
  files, and correct exclusion of `node_modules`/`docs`/etc.

## [0.2.0] — 2026-05-28

### Added

- **Local-LLM file selection via Ollama.** When Ollama is installed and a
  model is available, `helpcode ask` uses a local model to reason about which
  files are relevant to your task — surfacing files the keyword heuristic
  would miss (e.g. recognising that a "glucose variability" task should extend
  an existing time-in-range function). Runs entirely on your machine; no data
  leaves it, no frontier-model tokens spent. This is the first piece of the
  two-layer model: local compute for plumbing, Claude for the brain work.
- `init` now detects Ollama, picks the best available coder-tuned model
  (preferring `qwen2.5-coder`, `deepseek-coder-v2`, `codestral`, ...), and
  writes an `ollama` block to `project.json` (enabled when detected).
- `ask --no-llm` — force the keyword heuristic for one invocation.
- `ask --explain-selection` — print why each file was chosen.
- `core/ollama.ts` — zero-dependency Ollama client (injectable fetch for
  testing).
- `core/llmSelector.ts` — prompt building, response parsing, and a
  hallucination guard that validates every model-returned path against the
  real candidate set.

### Reliability

- LLM selection **never** breaks `ask`: if Ollama is disabled, unreachable,
  times out, errors, or returns nothing usable, helpcode silently falls back
  to the keyword heuristic with a recorded reason. Verified by tests covering
  every fallback path.
- 73/73 tests passing (26 new across the Ollama client, the selector, and the
  strategy chooser). No test depends on a live Ollama — CI passes with none
  installed.

## [0.1.3] — 2026-05-28

### Fixed

- **Setup failures are no longer misreported as test failures.** When the configured test command's runner isn't installed (`pytest: command not found`, `No module named pytest`, `'jest' is not recognized...`, `Cannot find module`), `helpcode apply` now says so clearly and tells the user to install it — instead of the generic "Tests failed. Run `helpcode ask`..." which wrongly suggested sending a setup problem back to Claude. Timeouts are also distinguished. Closes #2.
- **Failed tasks can now be auto-resolved.** When `helpcode run` executes the project's configured test command and it succeeds while the current task is in a `failed` state, the task is automatically marked `resolved`. This fixes the state-drift problem where a task stayed `failed` forever after the user fixed the issue outside helpcode and re-ran the tests. Closes #3.

### Added

- `classifyRunFailure()` in `lib/runclass.ts` — pure function distinguishing `setup` / `timeout` / `test` failures, with 8 unit tests.
- 3 integration tests for the auto-resolve behaviour (`tests/integration/autoresolve.test.ts`).

## [0.1.2] — 2026-05-26

### Fixed

- **Parser auto-repair for copy-paste corruption from Claude.ai.** When users drag-select Claude's reply from the rendered chat view (instead of using the message's built-in copy icon), the `##` prefix on section headers and the language tag of code fences get stripped or merged into adjacent content — e.g. `## DIFF: foo.py` becomes `DIFF: foo.py`, and `` ```diff `` followed by `--- a/foo` collapses to a single line `diff--- a/foo`. The parser now detects these patterns and reconstructs the missing markers before re-parsing. When repair fires, `helpcode apply` prints a dim notice so the user knows to review carefully. Closes #1.

### Added

- 10 new unit tests in `tests/unit/parser_repair.test.ts` covering the repair function in isolation and end-to-end via `parseClaudeResponse`.
- `ParsedResponse.repairsApplied: boolean` — surfaced to the CLI so users are told when their input was auto-repaired.

## [0.1.1] — 2026-05-26

### Fixed

- `init` now detects `tests/`, `test/`, `__tests__/`, and `spec/` directories so the selector can include test files in briefs. Previously, "make this test pass"-style tasks would generate prompts that omitted the very tests they needed to satisfy.
- The selector now skips empty or near-empty files (e.g. empty `__init__.py`) so they don't clutter the brief.
- Prompts now include the detected test command in the project context, helping Claude choose a sensible `## TEST` command.

### Added

- Tests covering the above fixes (`tests/unit/detection.test.ts`).

## [0.1.0] — 2026-05-25

Initial public release.

### Added

- `helpcode init` — detects project language, framework, test command, and source directories
- `helpcode ask "<task>"` — composes a structured prompt for Claude.ai with selected files, last test output, and a response-format spec
- `helpcode apply` — parses Claude's pasted reply, shows the planned changes, applies diffs atomically, runs the suggested test command
- `helpcode run "<command>"` — executes a shell command and captures the output in compact form
- `helpcode status` — shows the current task and state
- `helpcode reset` — clears state without touching project code
- Project detection for Python (Django, FastAPI, Flask) and JavaScript/TypeScript (Next.js, Express, React, Vue)
- Atomic file patching with safe error reporting on ambiguous diffs
- Cross-platform support (Linux, macOS, Windows)
- 15 unit tests + 4 integration tests, all passing on Node 20 and 22

### Notes

This is a foundational release. The roadmap includes multi-LLM orchestration (v0.3), local LLM integration via Ollama (v0.2), and IDE integration (v0.5+). See `docs/ROADMAP.md`.

[Unreleased]: https://github.com/merolaagi/helpcode/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/merolaagi/helpcode/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/merolaagi/helpcode/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/merolaagi/helpcode/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/merolaagi/helpcode/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/merolaagi/helpcode/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/merolaagi/helpcode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/merolaagi/helpcode/releases/tag/v0.1.0
