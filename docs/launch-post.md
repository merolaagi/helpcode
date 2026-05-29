# helpcode — a local helper that makes Claude.ai stretch further on the $20 plan

*Draft launch post. Use as-is or edit into your voice. Suggested venues: Hacker News (Show HN), r/programming, r/LocalLLaMA, dev.to, your own blog. The r/LocalLLaMA angle is strong because of the Ollama integration.*

---

## Show HN: helpcode — make Claude.ai conversations efficient enough to ship on the $20 plan

A year ago I built a small SaaS in about a day using Claude Code. The loop was fast, the usage envelope was generous, and it felt like magic.

Today that same kind of project takes me weeks, and not because the tool got worse — it got *better*, and a lot more popular. At the $20/month Pro tier, a few iterations on a real codebase now burn through budget faster than I can sustain. I kept watching my usage evaporate on round-trips that didn't even need a frontier model: "did the test pass?", "which files are relevant here?", "what does this traceback mean?"

So I built **helpcode**: a small local CLI that does the mechanical work *around* a Claude.ai conversation, so the conversation turns themselves get spent on actual thinking.

It does **not** call Claude. You stay in claude.ai and copy-paste as normal. helpcode:

- picks the relevant files for your task and builds a tight, structured prompt
- parses Claude's reply, shows you the planned changes, applies the diffs
- runs your tests and captures the result compactly
- and crucially — uses a **local model on your own machine** (via Ollama) for the cheap reasoning, like *which files matter*, so even that doesn't cost a Claude turn

That last part is the idea I'm most interested in. Call it a **two-layer model**: cheap local intelligence for the plumbing, expensive remote intelligence (Claude) for the thinking. A 7B coding model running on your laptop is perfectly capable of reading your repo and reasoning "a glucose-variability calculation would naturally extend the time-in-range function already in analyze.py" — which a keyword search can't do, and which you shouldn't need to spend a frontier-model call on.

If you don't have Ollama, it falls back to a keyword heuristic and works fine. The local model is a free upgrade when it's there, never a dependency.

**Why it might matter beyond my own budget:**

- For learners, students, hobbyists, and people in places where metered API spend is genuinely painful, $20/month going further is a real thing.
- For energy: running routine plumbing on idle local hardware instead of a datacenter GPU is just less wasteful. Frontier compute should be reserved for frontier problems — even if you can afford otherwise.

It's MIT-licensed, zero runtime dependencies, ~2,000 lines of TypeScript you can read in an evening, 73 tests, works on macOS/Linux/Windows. Built across a couple weeks of evenings and dogfooded on real projects the whole way.

Repo: https://github.com/merolaagi/helpcode

I'd genuinely like feedback on the two-layer idea — where else could a small local model offload work from the expensive one? File selection is the first task I delegated; response cleanup, error triage, and commit-message drafting are next. Curious whether others have built in this direction.

---

### Notes on posting (delete before publishing)

- **Lead with the story, not the feature list.** The "built a SaaS in a day, now it takes weeks" hook is what makes people read on. It's true and it's relatable to anyone who's felt the squeeze.
- **The r/LocalLLaMA crowd** will care most about the Ollama two-layer angle. Consider a version of this post that foregrounds "I'm using a local 7B to offload work from a frontier model" — that's catnip there.
- **Be ready for the obvious pushback:** "why not just use Aider/Cline/Continue?" Honest answer: those are great but most assume you bring an API key and pay per token. helpcode is built specifically for the person who wants to stay inside their existing Claude.ai Pro subscription and not pay per token at all. That's the niche.
- **Add a short demo gif** to the README before posting if you can — record `helpcode ask --explain-selection` showing the local model reasoning. A 15-second gif is worth more than three paragraphs.
- **Don't oversell.** It's v0.2. Say so. "Early but working" invites helpful feedback; "revolutionary" invites teardowns.
