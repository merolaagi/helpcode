# Claude Response Protocol

The format helpcode expects Claude.ai to use when responding. This is the contract between Layer 1 (helpcode) and Layer 2 (Claude). Stable across all v0.x releases.

The protocol is appended to every prompt helpcode generates, so Claude sees it every turn. Pattern training by repetition.

---

## The format

```
## PLAN
One to three sentences describing what you'll change and why.

## DIFF: path/to/file.py
\`\`\`diff
--- a/path/to/file.py
+++ b/path/to/file.py
@@ -10,3 +10,3 @@
 def login(email, password):
-    user = merolaagiS.get(email)
+    user = merolaagiS.get(email.lower())
     if user is None:
\`\`\`

## DIFF: path/to/other.py
\`\`\`diff
(repeat per file as needed)
\`\`\`

## TEST
\`\`\`bash
pytest tests/test_auth.py -v
\`\`\`

## NOTES
(optional) anything else worth noting — caveats, alternatives, questions.
```

---

## Rules

| Section | Required? | Notes |
|---|---|---|
| `## PLAN` | Yes | 1–3 sentences. Used as the change summary and a commit-message draft. |
| `## DIFF: <path>` | No | Zero or more. Each one targets a single file. |
| `## TEST` | No | If absent, helpcode falls back to the project default test command. |
| `## NOTES` | No | Free text. Shown to the user verbatim after the plan. |

### About `## DIFF:` blocks

- The path follows `## DIFF:` exactly: `## DIFF: app/auth.py`
- Use a unified diff inside a ```` ```diff ```` fence
- Include a few **context lines** (lines starting with a space) so the diff can be anchored even if line numbers have shifted
- Each diff is scoped to the file in its header — don't include changes to multiple files in one block
- For new files: provide only `+` lines (helpcode detects this and creates the file)
- The `--- a/...`, `+++ b/...`, and `@@ ... @@` lines are tolerated but optional

### About `## TEST`

- A single shell command, inside a ```` ```bash ```` fence
- helpcode runs this verbatim after applying the diffs
- Keep it tight: `pytest tests/test_auth.py -v`, not `cd backend && pip install -r requirements.txt && pytest`

### About `## NOTES`

- Use this for caveats, alternative approaches, questions for the user, or follow-up suggestions
- Don't put diffs or commands here — helpcode only parses them from `## DIFF:` and `## TEST` sections
- The notes are shown to the user but not acted on

---

## What happens if Claude doesn't follow the protocol

helpcode's parser is strict but lenient on the edges:

- Missing sections are tolerated (only `## PLAN` is required)
- Lines outside any `##` section are ignored
- Code fences inside section bodies are stripped
- If no recognised sections are found, the parser sets `parseWarning: true` and `helpcode apply` reports the issue with a hint

When this happens, the recommended fix is to copy the response, edit it to match the protocol, and re-run `helpcode apply`. A future version (v0.2+) may use a local model to rescue malformed responses automatically.

---

## Why this exact format

We chose markdown headers + fenced code blocks because:

1. **Claude follows markdown reliably.** Asking for "JSON output with this schema" works less well than "use these markdown headers". This format leverages a strength rather than fighting it.
2. **Human-readable in chat.** Whoever's in the conversation can see what's being proposed without running helpcode.
3. **Deterministic parsing.** No LLM rescue needed for the happy path. A 150-line regex-free parser handles it.
4. **Extensible.** New section types can be added (e.g. `## MIGRATION:` for database migrations) without breaking parsers that haven't been updated, since unknown sections are ignored.

---

## Versioning

This protocol is stable across all v0.x helpcode releases. Breaking changes to the protocol require a major version bump (e.g. v1.0.0).

Additive changes (new optional section types) are permitted in minor releases (v0.2, v0.3, etc.) and will be documented in `CHANGELOG.md`.
