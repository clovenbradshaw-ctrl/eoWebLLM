# Entity-click panel + coding mode — a handoff for a fresh agent

You have none of the context this document assumes you don't have. Read
this whole file before touching anything.

## Where things stand

The CRISPR retrieve-and-adapt pipeline (`eo-prior-art.ts` / `eo-repo-clone.ts`
/ `eo-coherence-check.ts`, wired into `chat.ts`'s `onUserInput`) is DONE and
live-verified — real GitHub search, real license gate, real in-browser git
clone, real coherence check, real corpus ingestion, confirmed via the EOT
log with actual network activity. A grounding-citation display toggle also
landed (`session.groundingDisplayEnabled`, display-only — never touches the
underlying `checkGrounding`/System 2 safety check). Don't re-derive any of
that; verify current state with `git log`/`git diff` if you need specifics.

**The governing constraint, unchanged**: the local model stays small
(`Llama-3.2-1B-Instruct` is this app's default). Don't reach for a bigger
model to solve a capability gap — find a mechanical fix or say honestly that
one doesn't exist at this size.

Two things are queued, confirmed with the user, neither started:

## 1. Click an entity in a chat message → open the Terrain panel

**This is smaller than it sounds — the infrastructure already exists and is
explicitly designed for this exact trigger, it's just never been wired to
chat message text specifically.**

- `app/components/terrain/types.ts` already defines the whole navigation
  contract: `OnNavigate = (ref: TerrainCardRef) => void`, where
  `TerrainCardRef = { kind: TerrainCardKind, params: Record<string,string> }`.
  Its own doc comment says explicitly: *"Every trigger site (a chat citation
  chip, a cross-link inside an already open card) funnels into the same
  shape"* — a new trigger site (an entity mention in message text) is
  exactly the kind of thing this was built to support.
- `app/components/chat.tsx:1374`'s `openTerrainCard` is the real entry
  point (`useCallback`, pushes onto `terrainHistory`/`terrainHistoryIndex`
  state) — call this, don't build a parallel mechanism.
- **A closely related pattern already exists, but scoped to the wrong
  surface**: `app/components/chat.tsx`'s `renderGraphEOTLine` (~line 209)
  and `renderEotEntryText` (~line 245) already make quoted names *inside the
  EOT Log/Graph terminal* clickable (`onEntityClick`, `.eot-entity`/
  `.eot-entity-active` CSS classes in `chat.module.scss`) — clicking pivots
  the Network graph or folds the log. That's a DIFFERENT surface (the
  developer-facing EOT terminal) from what's being asked for (entity
  mentions in the actual conversational reply text, the thing a normal
  reader sees). Study this pattern for the interaction shape (hover/click
  styling, `activeEntity` highlighting) but the target here is message
  bodies rendered via `Markdown` (`app/components/markdown.tsx`), not the
  EOT panel.
- `app/components/terrain/entity-card.tsx` and `eo-hypergraph.ts`
  (`hypergraphScopeId`, per-session node/entity data) are where you'd
  resolve "what entities does this app already know about for this
  session" — the click target should almost certainly be entities the
  hypergraph has already admitted, not a fresh NLP pass over message text.
- The existing `remarkGroundingChips` (`grounding-chip.tsx`) + `wrapGroundingSpans`
  mechanism in `markdown.tsx` (~line 162-224) is the precedent for
  "identify spans in message text, wrap them with a sentinel, render as a
  synthetic element, intercept in `ReactMarkdown`'s `components` map" — an
  entity-click affordance is very likely the SAME mechanism, a second span
  type alongside grounding spans, not a separate system.

**Recommended first step**: don't start writing code — first read
`docs/citey-structured-grounding.md` (referenced at the top of `types.ts`)
and `eo-hypergraph.ts` to confirm what "entity" means in this app's own
model before wiring a click handler to it.

## 2. "Coding mode" — a separate interface, like Claude vs. Claude Code

**Confirmed with the user**: this should be a genuinely SEPARATE interface
from the conversational Citey chat, the same relationship claude.ai has to
Claude Code — not a mode toggle inside the same chat UI. Likely a distinct
route/page, possibly its own layout entirely.

**This is a big, real architectural decision — treat it the way the CRISPR
work was treated: research first, then use plan mode (`EnterPlanMode`)
before writing code.** Do not guess at scope the way earlier turns in this
session twice guessed wrong and had to redo work.

Two sources to research, in this order, before designing anything:

1. **eochat's own eoCode surface already exists and is a proven reference**,
   *in this same user's other project*, not a hypothetical: `server/
   eocode-agent.js`, `eval/agent/react-loop.mjs`, `eval/agent/tools.mjs`
   (the whole read/write/edit/run-shell/git-clone tool family this session
   already fixed real bugs in — see `eochat/CRISPR-AGENT-LOOP-HANDOFF.md`
   for the exact state of it). It runs a real ReAct tool-calling loop
   against a local Ollama model, server-side, with a real sandboxed
   filesystem. eoWebLLM has NEITHER a server NOR Node `fs` — porting this
   means the same "reimplement for the browser, don't copy" discipline
   `eo-tool-router.ts`'s own header already models, and the same hard
   questions the CRISPR work had to answer: what runs in-browser
   (isomorphic-git + lightning-fs precedent now exists, see
   `eo-repo-clone.ts`), what needs a real filesystem concept for a "coding
   workspace" that this app has never had (unlike prior-art ingestion,
   which could reuse the existing corpus — a coding mode plausibly needs
   its own workspace abstraction, not just corpus ingestion).
2. **opencode** — the user explicitly asked to "port in whatever you need
   from opencode." Nothing in this repo references opencode yet; a fresh
   agent should actually go find and read it (likely
   github.com/sst/opencode or similar — confirm the correct project before
   assuming) rather than guess at its architecture. Compare what it does
   against eochat's eoCode surface — they may overlap heavily (both are
   "agentic coding tool loops"), in which case the real work is picking the
   better reference for a BROWSER target, not merging both blindly.

**Open questions a plan-mode pass should resolve, not this document**:
- Does "coding mode" need real code execution (a sandboxed runtime in the
  browser — WebContainers-style, a real and heavy dependency), or is it
  read/suggest/explain only, closer to what eoWebLLM already does?
- Does it get its own route (`app/coding/page.tsx`-style) or live entirely
  outside Next's existing single-page chat shell?
- Does it share WebLLM's model engine with the chat interface, or run its
  own?
- What's genuinely new work vs. what can reuse `eo-repo-clone.ts`/
  `eo-coherence-check.ts` (already-built, in-browser git primitives) that
  this exact session just proved work?

## Constraints that bind both of the above

- Local model stays small — no exceptions without saying so explicitly.
- Follow the `eo-*.ts` file convention (`app/client/`): a header comment
  naming provenance/intent, reuse over reinvention, cite eochat file paths
  when a pattern is ported from there.
- `CRISPR.md`/`LAWS.md` (eochat) established "mechanical over model-steered"
  and "real material before theory" — both were load-bearing for the work
  that just shipped; both should keep being load-bearing here.
- Don't guess at scope on something this size. Ask, or use plan mode.
