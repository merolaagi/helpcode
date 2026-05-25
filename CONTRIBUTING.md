# Contributing to helpcode

Thanks for being interested. helpcode is a small project on purpose, and we want to keep it that way — every feature added is a feature we'll maintain for years. With that in mind, here's how to help.

## Quick start

```bash
git clone https://github.com/merolaagi/helpcode.git
cd helpcode
npm install
npm run build
npm test
```

You should see "tests 19 / pass 19". If you don't, please open an issue with your Node version and OS.

To run the CLI from your local checkout:

```bash
node packages/cli/dist/bin/helpcode.js --help
```

For convenience while developing:

```bash
cd packages/cli
npm link
# now `helpcode` runs your local checkout
```

## Where to start

1. **Try it on a real project.** The best contributions come from people who hit a friction point. Use it for a few days, and when something annoys you, open an issue.
2. **Pick a `good first issue`** on the tracker. Those are scoped and don't require deep familiarity with the codebase.
3. **Read [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md).** They explain what's in scope and what's deliberately not.

## What we're looking for

Yes:

- Bug fixes (always welcome — include a test that fails before your fix)
- Better error messages and hints (this is the biggest win for new users)
- Cross-platform fixes (especially Windows)
- Documentation improvements
- New project detection heuristics (more languages, more frameworks)
- Performance improvements (helpcode should feel instant)

Maybe — please open an issue to discuss first:

- New commands (the surface is deliberately small)
- New flags (same reason)
- New dependencies (we want to stay close to zero-dep)
- Multi-LLM orchestration features (these are planned but need careful design — see [ROADMAP.md](docs/ROADMAP.md))

No, please don't:

- Add code that calls any AI API. helpcode is offline by design.
- Add telemetry of any kind.
- Reformat large swaths of unrelated code in the same PR as a bug fix.

## Code conventions

- TypeScript strict mode. No `any` without a comment explaining why.
- Throw `HelpcodeError` (from `src/lib/errors.ts`), never plain `Error`, for user-facing failures. Include a hint.
- Run `npm run typecheck` and `npm test` before opening a PR.
- Keep modules small. If a file grows past ~300 lines, consider splitting it.
- Comments should explain *why*, not what. The code should explain what.

## Tests

Every behavior change needs a test. We use [Node's built-in test runner](https://nodejs.org/api/test.html) — no Jest, no Mocha, no test framework dependencies.

Unit tests live in `packages/cli/tests/unit/`. Integration tests in `packages/cli/tests/integration/`. Tests run against the compiled output in `dist/`.

```bash
npm run test:unit
npm run test:integration
```

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your change. Add or update tests.
3. Update `CHANGELOG.md` under "Unreleased".
4. Run `npm test` and `npm run typecheck`.
5. Open a PR using the template.

We aim to respond to PRs within a week. Small focused PRs get merged faster than large ones.

## Reporting bugs

Use the bug report template. The most useful bug reports include:

- Your `helpcode --version`, Node version, and OS
- The exact command you ran
- The full output (helpcode is small enough that there's no risk of secrets — but feel free to redact paths)
- What you expected vs. what happened

## Releases

Maintainers tag releases as `vX.Y.Z`. The release workflow publishes to npm and creates a GitHub release automatically.

## Code of Conduct

Please read [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). The short version: be kind, assume good faith, and remember that helpcode's audience includes a lot of self-taught and early-career developers who deserve a welcoming community.

## Questions?

Open a discussion on the repo. We'd rather have ten "is this on the roadmap?" questions than zero.
