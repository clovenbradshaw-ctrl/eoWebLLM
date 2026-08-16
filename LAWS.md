# eoWebLLM Laws

A law is not a preference, and this file is not a style guide. It exists
because the same mistake got made and unmade on the same component more than
once — the fix would go in, and a later pass would quietly reintroduce the
thing it fixed, because nothing on record said the old behavior was wrong on
purpose rather than just old. Writing it down here is what makes a fix stick
past the session that made it.

---

## L1 — A reasoning panel discloses; it does not sit on the page

Thinking, Plan, and Grounding are all built on the same `TracePanel` shell in
`app/components/chat.tsx`, styled by `.trace-panel` in `chat.module.scss`,
and the whole point of that shell is to look like Claude's own
extended-thinking display: collapsed, it is a single dim line of text with a
disclosure marker, sitting flush in the transcript, asking nothing of the
reader who doesn't click it. It earns a border, a fill, and an indent only
once it's actually open, because that's the one moment a reader has said
"show me" — anything short of that click gets the same weight as the prose
around it, not more.

This got built wrong twice. The first version gave `.trace-panel` a
permanent `border`, `background: var(--gray)`, and `padding` — regardless of
whether the `<details>` was open or closed — so every Plan and every Grounding
sat on the transcript as a shaded card whether or not anyone had asked to
look inside. A comment right above the rule even claimed it was "styled like
Claude's extended-thinking display," which was aspirational, not true: real
extended-thinking, collapsed, has no visible box at all. The fix removed the
border/background/padding from the shared `.trace-panel` shell entirely,
left `.trace-panel-summary` as the only affordance (a hover state and the
native disclosure marker, nothing else), and moved the indent and left-rule
onto `.trace-panel-body` so they only exist once the reader has actually
opened the thing.

**The check for a future pass:** if `.trace-panel`'s collapsed state
(anything outside `.trace-panel[open]` or `.trace-panel-body`) ever again
carries a `border`, a `background`, or padding that makes it read as a card
rather than a line of text, that's this law being violated again, not a
harmless restyle. Any new collapsible reasoning surface — not just Thinking,
Plan, and Grounding — should be built on `TracePanel` rather than growing its
own box, so this stays enforced by construction instead of by memory.

---

## L2 — Capitalization is a differentiator, never the primary signal for "is this an entity"

`eoreader6`'s graph-relation channel
(`packages/engine/perceiver/text/surfaces.js`) admits a node from a sentence
almost exclusively on the strength of the token being capitalized — and
deliberately skips a sentence's first token as naming evidence, since
sentence-initial capitalization carries no signal of its own. That rule is a
reasonable anti-false-positive guard for the kind of long narrative prose
`eoreader6` was originally built to read, where a real name recurs across
dozens of sentences and mid-sentence capitalization is a strong tell. It is
the wrong primary signal for eoWebLLM's own conversational turns: a short
chat message ("my budget is $2000", "I love hiking") states real, specific,
worth-remembering facts that are never going to be capitalized, and a design
that treats capital letters as the entry ticket to the hypergraph will admit
almost nothing from ordinary conversation — confirmed live: a 15-turn
conversation establishing a budget figure, a location, dates, and multiple
named people produced zero nodes and zero edges in the Terrain panel.

`app/client/eo-self-facts.js` already exists as the correct seam for this —
a small, explicit, closed-set pattern extractor injected into the graph
alongside whatever `eoreader6` finds on its own — and it is the piece meant
to carry the actual weight of admitting a chat turn's facts, not a
supplement to a capitalization-first pass that's expected to catch most of
it.

**The check for a future pass:** if a fix to sparse/empty hypergraph
admission ever routes through "detect capitalized words more aggressively"
or "loosen the capitalization gate" as the primary mechanism, that's this
law being violated. Capitalization may keep breaking ties between two
otherwise-equal candidates, or disambiguate within a set already selected on
other grounds — it must not be the test that decides whether something gets
admitted as an entity at all. New extraction should extend the closed-set
pattern approach in `eo-self-facts.js` (or an equivalently explicit,
testable mechanism), not lean harder on capitalization.

---

## L3 — The plan is cognition, not a special path for corpus-grounded requests

`app/client/eo-task-plan.ts`'s multi-task decomposition was gated in
`app/store/chat.ts` behind `probeRoute?.system === "system2" && sources.length`
— it only ever ran when the reader had uploaded documents to plan over. That
gate reads as principled ("this module says it's for corpus research") but
it's the wrong frame: planning isn't a special-purpose tool reached for only
when there's a corpus in play, it's supposed to be how the app thinks about
every turn. A one-line greeting and a five-part budget-and-scheduling
request both go through the same planning step; they differ in what that
planning step produces — the greeting's plan is trivially one task that
becomes one message, the complex request's plan is several dependent tasks
that surface as several messages — not in whether planning happens at all.
Gating decomposition on `sources.length` means the app only ever "thinks in
steps" when there happens to be a document loaded, and falls back to a
single undifferentiated generation for every other kind of complex,
multi-constraint request — confirmed live: a genuinely multi-part
budget/wifi/dietary/scheduling request with no uploaded corpus got one
single-shot reply that ran out mid-sentence and dropped two of its four
constraints, because the planner was never in the loop for it at all.

**The check for a future pass:** if task decomposition is ever re-gated
behind "does this turn have a corpus/source to plan over," that's this law
being violated again. The gate should be about the SHAPE of the request
(does it decompose into dependent parts worth planning at all — the same
kind of question `eo-holonic-plan.ts`'s DEFINE step already asks about
kind/delivery/compliance for single-shot replies), not about whether
`eoSources` happens to be non-empty. A turn with no corpus and four
dependent constraints should plan just as readily as a turn with a corpus
and one simple lookup.

---

## L4 — "Reading" is the full organ chain, not the shallowest script's slice of it

> **Superseded in part by `eoreader6/READING-POLICY.md`, which is canonical
> for how reading works.** Two claims below are wrong and are corrected
> there: (a) that no assembled reader exists — `packages/host/corpus.js`
> (`createSession`/`admitChunked`/`sessionReferents`/`sessionRelations`, whose
> `discoveredCast` chains pronoun binding) plus `packages/host/surfer.js` is
> exactly that, and is what a reading should run through; (b) that the six
> stages below are the whole of reading — they omit **retrieval**, and so
> mis-frame activation decay as memory loss. Activation decays and re-zeros by
> design; beings are not forgotten, they return on re-mention through
> retrieval. See READING-POLICY.md P1. Never enlarge an activation window to
> fix a recall failure.
>
> **A note on verification (2026-08-13):** an earlier pass through this file
> declared `READING-POLICY.md` — and, further down, `eoreader6/CLAUDE.md`,
> `goldens/network/read.mjs`, and `referents/cooccurrence.js::mergeAliasedEntities`
> — fabricated, on the strength of `git log --all` against eoWebLLM's local
> `eoreader6` submodule checkout, pinned at commit `aaf358b`, coming back
> empty for all four. That check was wrong, not the four citations: this
> Bash environment cannot `git fetch` (network to github.com is blocked;
> only the `gh` CLI's own API path reaches GitHub), so the local submodule
> clone is frozen at whatever commit it was pinned to and blind to anything
> landed upstream since. Checked directly against GitHub via `gh api` — not
> against the stale local clone — all four are real: `READING-POLICY.md`
> merged to eoreader6's `main` in PR #62 (`df52fc9`), after the commit
> eoWebLLM's submodule is pinned to; `CLAUDE.md`, `goldens/network/read.mjs`,
> and `cooccurrence.js::mergeAliasedEntities` currently exist only on an
> open, unmerged upstream branch (`claude/network-cooccurrence-golden`, PR
> #59), not yet on `main` at all. None of the four citations below were
> fabricated. This note is left in place, rather than silently removed once
> corrected, for the same reason SEED.md's own growth rule keeps a falsified
> claim on record instead of erasing it — a verification failure is itself
> worth being able to find later, especially one caught by an independent
> review rather than by re-reading the same stale evidence twice.

Asked to characterize `eoreader6`'s ability to "read" a book, a first pass
described only `goldens/network/read.mjs` — the co-occurrence golden that
scores discovered character pairs against a hand-built third-party network.
That golden exists specifically because it is the one slice with external
ground truth to check against, and its own header says outright that it is
answering a narrower question than the engine can: "Direction and polarity
… and verb-typed relations … are real, richer structure this reading could
also carry — deliberately not scored here … because the four reference
networks this golden checks against are themselves undirected, untyped
co-occurrence counts and have no dimension to check direction or a verb
against" (`goldens/network/read.mjs:45-51` on the upstream PR #59 branch
this golden currently lives on — see the note above L4's opening blockquote;
the line range is corrected from an earlier, stale `175-185` citation, the
quoted text itself was always accurate). Describing that golden as
what `eoreader6` "does" mistook the one organ with a scoreboard for the
whole instrument. There is also no single function to point to instead —
`packages/engine`'s only public export (`packages/engine/index.js`) is
`INDIVIDUATION_TYPES`, `projectReferents`, `coverageReport`, and `judge`;
its `package.json` exposes roughly twenty individual organs as subpaths
(`./referents`, `./emergence/graph`, `./perceiver/text/relations`, …) with
no `read(book)` among them. Every reading script in `scripts/` — `read-
tiered.mjs`, `read-people.mjs`, `read-ladder.mjs`, `read-paradigm.mjs`,
`full-golden-layered.mjs`, `chapter-scene-level.mjs`, `terrain-census.mjs`
— hand-assembles its own subset of organs to ask its own question, and
`eoreader6/CLAUDE.md` endorses exactly that pattern: a new driver's job is
"usually to ask a new QUESTION of that pipeline's output, not to rebuild
pieces of the pipeline" (currently on the unmerged PR #59 branch — see the
note above L4's opening blockquote). So the correction below is a definition, not a
pointer to code that already assembles it — the richest version of reading
is the full set of organs available to be chained, in the order `read-
people.mjs` chains them, not any one script's slice.

A full reading has six stages. **(1) Perception.** Candidate surfaces come
from statistics derived from the material itself, not lookup lists:
self-referential surprisal against the text's own frequency table
(`perceiver/text/material.js:32-52`), a Zipf-derived relevance threshold in
place of a stopword list (`material.js:204-226`), sentence and abbreviation
detection derived the same way (`perceiver/text/spans.js:194-226`), and a
binomial significance test on capitalized runs plus an IQR-derived fence
separating individuating names from titles/family-names
(`perceiver/text/surfaces.js:68-73,280-353`). **(2) Witnessed admission.**
A candidate becomes an entity only through `entity.js::admitFromArrivals`
(`referents/entity.js:235-300`): a minimum-arrivals floor, a conditional
null built only from material read so far (`groundUpTo` never slices past
the current point, `entity.js:79-85`), and an early/late split test asking
whether the second half's evidence moved the ground further than reseeding
noise — all combined through `witness()` (`nul/index.js:1279-1288`) or
refused outright. **(3) Alias resolution.** Two independent passes: spelling-
based name-variant coreference before any entity exists
(`surfaces.js::discoverReferents`), and a second pass over admitted
entities that merges by arrival *shape* — segregation and displacement,
never string comparison — for exactly the cases spelling-merge is
conservative about on purpose (`referents/consequence.js`,
`referents/cooccurrence.js::mergeAliasedEntities` — the latter a thin
union-find wrapper that imports and calls the former's `identityByConsequence`
directly; both real, currently on the unmerged PR #59 branch, see the note
above L4's opening blockquote). **(4) Typed, directional
relation.** SVO triples with polarity (`perceiver/text/relations.js`) feed a
decaying belief graph (`emergence/graph.js`); `emergence/binding.js` then
tests each pair through a displacement null (is this co-arrival real),
transfer entropy (does A's presence predict B's next step), and a reversal
null (does the resulting asymmetry clear significance to assign direction
and polarity) — the exact structure the network golden declines to score.
**(5) Tiered altitude.** `emergence/tiers.js` folds atmosphere → lens →
paradigm as the same recursive Bayesian-surprise test applied at increasing
scope, gated against a synthetic prior-continuation null, propagated upward
only if the tier below already passed: "a paradigm shift is not a bigger
event … it is an event that survived being surprising all the way up"
(`tiers.js:25-26,299-300`). The War and Peace test run's paradigm-tier
passages clustering in the 1812 campaign and Tolstoy's own historiographic
digressions is this mechanism operating at its ceiling, not a separate
feature. **(6) Kind induction over the cast.** `emergence/kinds.js`'s
SIG→CON→EVA→DEF chain clusters admitted entities into archetypes under two
Born-gated tests, with its own honest edge on record: key-only similarity
goes silent (0 kinds) on non-text-shaped data ("text is the special case,"
`goldens/kinds/README.md:9-33`), and a naive value-channel fix can
confabulate structure that a permutation-search correction
(`searchCohesions`/`searchKeyCohesions`) was built specifically to catch
(`goldens/kinds/README.md:88-102`). Beneath these six, `holon_level/` and
`formation/` are substantial, independently Born-gated organs (existence-
dependency/possibility-constraint tests, a four-phase becoming model); `
discourse/`, `verdict/`, and `provenance/` are real but mechanically thin
utilities and should not be cited as if they carried comparable weight. The
`induction/`/`modifier-order/` directories are a separate WALS-style
linguistic-typology research line that reuses the kinds machinery — not a
stage of reading a book's cast or plot.

None of this makes the domain-generality claim bigger than it was. The
statistical substrate in stages 1–3 is genuinely derived from the material
with no external corpus; but named, encoded assumptions remain in the
source itself and are not erased by the richer stages above them —
capitalization-as-namehood ("German capitalises every noun, so this
predicate is worthless there," `perceiver/text/proper.js:30-32`), Latin-
script punctuation, and English closed-class word sets
(`perceiver/text/priors.js`, tagged `giver: "lang/en"`).

**The check for a future pass:** a description of what `eoreader6` "can do"
must name which organs were actually chained for the run being described —
stopping at the co-occurrence golden and calling it "reading" undersells the
system exactly as badly as citing the full six-stage chain for a run that
only used the first two oversells it. Because there is no single `read()`
call, "full capacity" is never a fixed ceiling to gesture at — it is stages
1–6 above, available to be assembled, with the domain-general/encoded-
assumption split from stage (1) holding regardless of how many of the later
stages a given run adds on top.

---

## L5 — A compliance-critical fact is never left to the model's own
instruction-following

`app/store/chat.ts`'s grounding-check follow-up used to work like this: run
`checkGrounding` mechanically to find the draft's unsupported claims, then
hand those findings to the SAME small local model and prompt it to write a
short correction — "state the right value if the material has one, don't
hedge, don't apologise, three sentences at most." That prompt was reasonable
prose and the model still didn't reliably follow it. Live end-to-end testing
against this exact model found it: (a) fabricating a founding year (answered
"1893" against a document that stated "2031" in the passage it had just been
shown), (b) fabricating a budget figure ("$1.136 billion, a 17.4% increase"
against a source that said $1,022,900,000 and +$210,600,000), and separately,
in the climb-response prompt (corrected 2026-08-13: this lives in
`app/store/chat.ts`'s `climbedNav`/`buildThoughtUserPrompt` call, not in
`eo-grounding.ts` — that file has never contained a climb-response prompt or
`containsPromptScaffold`; `eo-grounding.ts`'s actual job is deciding
grounding from fold-ledger arithmetic, a different concern), echoing the
prompt's own closing instruction back as if it were an answer rather than
either a verdict or the literal sentinel it was told to emit
(`containsPromptScaffold`, imported into `chat.ts` from
`eo-holonic-plan.ts`, exists specifically to catch that). Three different call sites, three different
ways the same model failed to do the one thing its prompt asked. The lesson
generalizes past any one of them: **a prompt is a request, not a guarantee,
and a small local model's compliance rate with any single instruction is not
something to build a correctness-bearing feature on top of.**

The fix for the grounding follow-up was not a better prompt. It was removing
the model from that path entirely: `findMechanicalCorrection` in
`app/client/eo-citation-check.ts` finds a replacement value the same way
`snipCitations`/`significantWords` already find a supporting clause —
vocabulary overlap between the draft's own sentence and a sentence of the
material actually consulted this turn — and returns `null`, not a guess,
whenever the winning sentence contains more than one candidate of the
claim's kind. The correction the reader sees is composed by string
concatenation in `chat.ts`, never generated. Where a genuine model call
can't be avoided (phrasing, judgment calls, anything that isn't a single
checkable fact), its output must still be checked mechanically before it
reaches the reader — `containsPromptScaffold`'s echo-detection and
`checkGrounding`'s own post-hoc pass are both already this pattern applied
after the fact, not before it; L5 is what makes "check after" the required
shape rather than an option a new call site can skip because "the prompt
already asked nicely."

**The check for a future pass:** if a new feature's design is "prompt the
model to state/verify/comply with X, and trust that instruction," that's
this law being violated, however well-worded the prompt is. Ask instead
whether X is checkable against material already in hand — if it is, compute
it mechanically (string/number matching, set overlap, the same discipline
`eo-citation-check.ts` already uses throughout) and only use the model for
the parts of the turn that are genuinely generative, not for the parts that
have one correct, look-up-able answer. Where a model call is unavoidable,
its output is a draft to check, never a value to trust — the check must run
whether or not the prompt asked the model to be careful.

---

## L6 — A recognized pattern needs a name here even when no fix is ready yet

Two sequences in this repo's own PR history match L1's "built wrong,
corrected, still not settled" shape but never got an entry, which means the
next instance of either won't be caught by anyone reviewing against this
file. Recording the pattern — not a fix, there isn't one yet — is what makes
it checkable next time.

**Citey mascot avatar, PRs #23–#30 (2026-08-11 to 2026-08-12, ~26 hours):**
five-plus PRs iterating on one visual component's shape and per-state
rendering, including one closed-and-abandoned attempt (#24) redone from
scratch as #25. Same shape as L1's `TracePanel` history — a shared component
built, found wrong, rebuilt, still not settled after multiple passes — but
for the mascot avatar, and with no law written down while it was happening.

**Pages/CI deploy, PRs #17 and #19 (2026-08-10, ten minutes apart):** #17
"Fix Github Pages Deployment: checkout submodules" merged, then #19 "Fix
Pages build: cast reading-pipeline.js boundary to sidestep spurious
`never[]` inference" merged ten minutes later — two independent "fix the
deploy" PRs back to back, each patching a different edge of the same
underlying build fragility rather than the class of problem.

**The check for a future pass:** if a component or pipeline needs three or
more fix-shaped PRs within about a day, that's this pattern regardless of
whether the individual causes look unrelated — treat it as a signal the
underlying assembly isn't stable yet (see the holonic-stability discussion
this law's own audit produced), not as a string of coincidentally clustered
bugs, and look for the shared root before the next patch.

---

## L7 — A document is quarantined stage by stage; capping one pass never caps its siblings

`app/client/eo-source-ingest.ts`'s `ingestFile` was built carefully: raw
bytes always persist to OPFS first, then `MAX_ANALYSIS_BYTES` gates the
CPU-heavy decode/extract passes, then `MAX_READING_CHARS` separately gates
the modifier-graph/EOT reading pass specifically, because a full "War and
Peace" upload (~3.2M characters) was freezing the tab before that second
cap existed. That fix was real and it held — for the one pass it covered.

`app/client/eo-hypergraph.ts`'s `ensureHypergraphHydrated` is a completely
separate full-text pass — eoreader6's proper-noun/relation extractor plus
tier folding, run synchronously on the main thread with no chunking and no
yield — reached from three call sites (`chat.tsx`'s upload flow,
`terrain-panel.tsx`'s open effect, and `store/chat.ts`'s per-turn
re-hydration) that all decode a source's *entire* text and hand it over
unconditionally. None of them, and nothing inside `admitOnce` itself,
checked size at all. Uploading the exact same War and Peace file that
motivated `MAX_READING_CHARS` reproduced the exact same freeze, immediately
on upload (via the `chat.tsx` call site) or on the very next message if
upload happened to survive (via `store/chat.ts`'s unconditional per-turn
scan) — because `MAX_READING_CHARS` was never in scope for this pass; it
was only ever wired to the modifier-graph/EOT reading it was written next
to. A cap that lives beside one organ protects that organ, not the
document.

The first fix was `MAX_HYDRATE_CHARS`, enforced inside `admitOnce` itself —
the one choke point every hypergraph admission funnels through regardless
of caller — plus a `byteLength` pre-filter at all three call sites so a
large source isn't even decoded from OPFS just to be discarded. A source
over the cap registered, stayed fully searchable through `eo-corpus.ts`'s
`retrieveCorpus`, and simply never reached the hypergraph. That held, but
it was a permanent exclusion, not a bound — a large document's cast and
relations would *never* reach the graph, which is a different failure mode
than the freeze (silent instead of loud) but still means the reader who
uploaded War and Peace gets no Terrain reading of it, ever.

**Update (2026-08-14):** the user's own framing — "we want to eventually
ingest it ALL but a person can only read so much" — reframed the fix.
`MAX_HYDRATE_CHARS` is now a PER-ADMISSION bound, not a per-source one:
`naturalChunks()` splits a large source at its own visible structure
(chapter/book/part/volume/section/act headings, the Project-Gutenberg-style
convention; falls back to fixed-size splitting when no headings are
detectable), and `admitHypergraphSource` admits exactly one chunk per call,
remembering its place in a bookmark (`HydrationBookmark`, `eo-corpus.ts`'s
`persistHydrationBookmark`/`readHydrationBookmark`) persisted to OPFS so a
reload resumes from the next unread chunk rather than either restarting at
chapter 1 or racing to catch up on everything read-so-far in one call — a
person picks a book back up at the next chapter, not by re-reading
everything since to "catch up." `isSourceFullyHydrated` replaced the
`byteLength` pre-filter so a source stops being re-decoded from OPFS only
once its bookmark has actually reached the end, not merely because it was
large to begin with.

**The metabolism, as it now stands** — every stage a document's full text
can reach, and what bounds it before that stage runs:

| Stage | File | Bound | Unbounded cost if skipped |
|---|---|---|---|
| Raw persist | `eo-corpus.ts::persistRawSource` | none (lossless by design) | — |
| Decode/extract | `eo-source-ingest.ts::ingestFile` | `MAX_ANALYSIS_BYTES` (50MB) | UTF-8 decode / PDF·DOCX·XLSX·… extraction over the whole buffer |
| Modifier-graph + EOT reading | `eo-source-ingest.ts::ingestFile` | `MAX_READING_CHARS` (300k chars) | two regex-based taggers over the whole decoded text |
| Hypergraph admission | `eo-hypergraph.ts::admitHypergraphSource` (per `admitOnce` call) | `MAX_HYDRATE_CHARS` (300k chars) PER CHUNK, one chunk (natural or fallback-split) admitted per call, bookmarked in OPFS | eoreader6 relation extraction + tier folding over the whole text in one call |
| Turn-time retrieval | `eo-corpus.ts::retrieveCorpus` | `RETRIEVAL_TOKEN_BUDGET` (3000 tokens) / `RETRIEVAL_MAX_PASSAGES` (6) over `CHUNK_CHARS`-sized (3000) chunks, yielding every 200 | — (already bounded and yielding by construction) |

**The check for a future pass:** any new pass that reads a source's or a
turn's *entire* text — not a chunk, not a byte range — must declare and
enforce its own bound, checked before the expensive work runs, not
inherited from a cap written for a different pass next door in the same
file. "This file already has a size cap" is not evidence the pass being
added is covered by it. When in doubt, add this stage's bound to the table
above in the same edit — the table is what makes "did we cover every
stage" a five-second check instead of a re-audit of every call site that
touches document text. Separately: a size cap that silently, permanently
excludes the material past it (the original `MAX_HYDRATE_CHARS` fix) is a
narrower answer than one that admits it progressively, a bound chunk at a
time, and remembers where it left off — prefer the latter shape for any
pass whose whole point is building up a reading of a document over time,
the same way `admitHypergraphSource` now does. A cap that just drops the
excess is the right shape only for passes where the excess genuinely isn't
needed (e.g. `eo-source-ingest.ts`'s binary-structure entropy scan on a
source that turned out to be text-readable).
