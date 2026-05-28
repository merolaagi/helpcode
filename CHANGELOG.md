# Changelog

All notable changes to helpcode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/merolaagi/helpcode/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/merolaagi/helpcode/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/merolaagi/helpcode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/merolaagi/helpcode/releases/tag/v0.1.0
