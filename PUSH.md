# How to push this to GitHub

This is a one-page guide to take the helpcode repo from this folder to a live GitHub repository. ~5 minutes.

## Before you push

1. **Replace `merolaagi` with your GitHub username** in three places:
   - `README.md` — the badge URLs and "Read more" link
   - `package.json` (root) — the `repository.url`
   - `packages/cli/package.json` — `repository.url`, `bugs.url`, `homepage`
   - `CHANGELOG.md` — the link references at the bottom
   - `CONTRIBUTING.md` — the clone URL
   - `.github/ISSUE_TEMPLATE/feature_request.md` — `good first issue` link in README

   Quick find-replace from the repo root (macOS/Linux):
   ```bash
   grep -rl "merolaagi" --include="*.md" --include="*.json" | xargs sed -i.bak "s/merolaagi/your-github-username/g"
   find . -name "*.bak" -delete
   ```
   On Windows, use your editor's project-wide find/replace.

2. **Set the author field** in `packages/cli/package.json`:
   ```json
   "author": "Your Name <you@example.com>"
   ```

3. **Run tests one more time** to confirm everything is green:
   ```bash
   npm install
   npm test
   ```
   Should show: `tests 19 / pass 19`.

## Create the GitHub repo

1. Go to https://github.com/new
2. Repository name: `helpcode`
3. Description: `A local agent that makes Claude.ai conversations efficient enough to ship real projects on a Pro subscription.`
4. Public
5. **Don't** initialise with README, .gitignore, or license — we already have them
6. Create

## Push from your machine

```bash
cd path/to/helpcode

git init
git branch -M main
git add .
git commit -m "Initial commit: helpcode v0.1.0 foundation

Six-command CLI for shipping projects on Claude.ai Pro:
init, ask, apply, run, status, reset. Python + JS/TS detection,
atomic patcher, structured prompt protocol, 19 tests passing."

git remote add origin https://github.com/your-username/helpcode.git
git push -u origin main
```

## After the initial push

- **Add topics** to the repo settings: `claude`, `ai`, `cli`, `developer-tools`, `frugal-ai`, `claude-ai`
- **Enable Discussions** in repo settings (helps community)
- **Add a description and website** in the About sidebar
- **Pin the repo** to your profile if you want it visible

## Publishing to npm (when ready)

1. Create an npm account at https://npmjs.com if you don't have one
2. In repo settings → Secrets → Actions, add `NPM_TOKEN` (from npmjs.com → Access Tokens → Automation token)
3. To release v0.1.0:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
   The `release.yml` workflow will publish to npm and create a GitHub release automatically.

## Don't publish to npm yet?

That's fine. The tool works from a `git clone` + `npm install` + `npm link`. Users can install it directly from GitHub:
```bash
npm install -g your-username/helpcode
```

You can wait to publish to npm until you've used it on a real project for a week or two and confirmed it works.

## First-week checklist after launch

- [ ] Use it on grocerygodown for one iteration to confirm it works in the wild
- [ ] Open 3-5 issues for things you noticed but didn't fix in v0.1 (good first-issue material)
- [ ] Write a short launch post (Hacker News, Reddit r/programming, your social media) — your "$20 SaaS in a day" story is what makes this interesting
- [ ] Add 2-3 GIF demos to the README (record a real session)

## Don't forget

You said SHIP-c is the priority once your friend onboards. **This repo can sit at v0.1.0 for weeks while you focus on grocerygodown.** Public GitHub repos don't need constant attention. The codebase is solid, the docs explain everything, contributors can find their way around without you actively reviewing.

When you come back to it, the roadmap (v0.2 local LLM, v0.3 orchestration) will still be waiting.
