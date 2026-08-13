# Citey's grounding policy — what he checks, and what he is allowed to know

A living design doc — states what's true now and what is proposed, and marks
which is which. Companion to
[`citey-structured-grounding.md`](citey-structured-grounding.md) (the
warrant/channel model and build status) and
[`citey-terrain-feedback-spec.md`](citey-terrain-feedback-spec.md) (per-terrain
feedback). This doc answers a different question: **when does Citey go
looking, what does he look in, and what is he permitted to say about what he
found?**

Everything under "measured" was reproduced against the running modules in this
repo on 2026-08-13, headless, via `node --import ./scripts/register-ts-resolve.mjs`.
Nothing here is inferred from docs.

## 0. The two rules everything else follows from

**R1 — Citey is not an expert on what is true.** He does not render verdicts.
He goes and finds material that supports or disagrees with a claim, and shows
it. "The source says 1901" is byte-checkable and re-readable; "you are wrong,
it's 1901" is not. Only the first is Citey's to say.

**R2 — He behaves because of what he does not know, not because he was asked
nicely.** A model given a search snippet and told to summarize it faithfully
will sometimes not. A model never given the snippet cannot misreport it. Where
a limit matters, it is enforced by withholding the input, not by instructing
the output.

R2 is L5 taken one step further. L5 says *"a prompt is a request, not a
guarantee."* R2 says: then stop relying on requests where starvation is
available.

## 1. The three-stage pipeline

Citey's voice today is entirely templated — `chipReasonText()` in
`grounding-chip.tsx` is five fixed strings, and `eo-grounding-spans.ts`'s own
header states the rule: *"a fixed, templated annotator over the finished text,
never another model call deciding what to say."* That is safe and it is also
why every chip reads identically forever.

The proposal relaxes it without giving up the guarantee, by splitting the work
so the model never touches evidence:

```
1. DETERMINE (mechanical, zero model)
   per claim × per channel -> one finding type:
     supports | disagrees | nothing-found | not-checked | out-of-scope
   computed by string/number matching (tokenSupported, hasNumber) —
   the same machinery eo-citation-check.ts already uses throughout.
        |
        v
2. PHRASE (model, starved)
   input:  the finding TYPE, the claim's own words, the channel name.
   NOT input: the retrieved text. Not the snippet, not the passage,
              not the source title, not a number from either.
   output: one natural sentence, fresh per message.
        |
        v
3. VERIFY (mechanical, zero model)
   extractAtoms() over the model's sentence. Any number or proper name
   that was not in stage 2's input is, by construction, invented —
   reject and fall back to the template.
```

Stage 3 is what makes stage 2 safe to try. The starvation is not a hope; it is
*checkable*, with machinery already written and already tested. A phrasing that
smuggles in a figure fails the check and never reaches the reader. This is L5's
*"its output is a draft to check, never a value to trust"* applied literally.

It also enforces R1 by construction: a model that was never told what was found
**cannot** assert what is true. The most it can say is the shape — "I found
material that lines up with this," "something I found disagrees," "I looked and
came up empty."

**Status:** proposed. Nothing in stage 2 or 3 is built.

## 2. What needs grounding — the gate

### Measured: there is no gate, there are five

| Gate | Where | What it actually asks |
|---|---|---|
| A | `routeTurn` (`eo-warrant.ts`) | "was material folded away this turn?" — about the turn, not the claim |
| B | `hasExplicitSearchIntent` + `planTools` | "did the reader ask for a search?" — decided before the answer exists |
| C | `extractAtoms` | "is this token a number or a capitalized word?" |
| D | `chat.ts:3459` | "what state is the span in?" — mixes state and kind |
| E | `if (allCitations.length)` (`chat.ts:3231`) | "did we happen to surface anything?" |

Gate C carries all the semantic weight and it is a regex. Measured output of
`extractClaimAtoms` on ordinary conversational text:

```
"Thanks John, that helps."                -> Thanks John (name)
"Sure — I'd start with the first option."  -> Sure (name), I'd (name)
"Happy Friday!"                            -> Happy Friday (name)
"I have 2 kids and a dog."                 -> 2 (number)
"Let's meet Tuesday at 3."                 -> Tuesday (name), 3 (number)
"The city budget rose 17.4% to $1.136 billion."  -> 17.4, 1.136 (numbers)
```

Only the last line is a claim anyone should check. Citey currently believes
"Sure", "I'd" and "Happy Friday" are checkable factual assertions.

**This is the ordering constraint on always-on lookup.** Removing gate B so
Citey can always reach the internet, without first fixing gate C, means Citey
goes and searches the web for "Happy Friday". The two changes are not
independent and gate C comes first.

### Proposed: vendor the chat's own relevance mechanics

`eo-gate.ts` is already a pure, deterministic, model-free relevance engine —
signals, weights, a budget, and folding that is *lossy but NAMED so absence
stays auditable*. Its System 2 mode already scores **against the claims the
draft actually made, not only the question**. That is the grounding-relevance
question, already built and already tested (`test-gate-systems.mjs`).

The mapping is near-direct:

| gate today | grounding use |
|---|---|
| instruction folds | evidence candidates (corpus passages, web results) |
| `signals` lexical match | the claim's own atom tokens |
| `weight` | channel warrant rank — corpus above web |
| budget → surfaced | the mouth (`foldToMouth`, k = 7) |
| folded but NAMED | "here is what I did not check, by name" |

The last row is the valuable one: the gate's auditable-absence property gives
the honest "what I skipped" report for free, which is exactly what §5's
affordance needs. Build the grounding gate as a second caller of these
mechanics, not as a parallel system.

## 3. The reader's document vs. the web

### Measured: they are merged into one index, and it corrupts the check

`chat.ts:3219-3225` concatenates web and corpus citations into `allCitations`,
and `buildUnionIndex` merges them into a single word/number set. Reproduced:

```
draft: "Your document states the budget is 1.136 billion."
  (the reader's PDF actually says $1,022,900,000)

checked against THE DOCUMENT ONLY  -> clean? false  findings: ['1.136' absent]
checked against WEB + DOCUMENT     -> clean? true   findings: []
  chip state=sourced, pointing at citation 1 = the Wikipedia page
```

A false claim about the reader's own PDF is marked grounded because an
unrelated Wikipedia article happened to contain the digits `1.136`.

`instruction-set/240-source-scope.md` already forbids exactly this: *"A pool is
a retrieval boundary: material in one pool never answers questions scoped to
another. You do not blend pools in an answer as if they were one body of
material."* The instruction is right; the code does not implement it.

### Proposed: never one index, and asymmetric meaning

- **Grade per channel.** One finding per claim *per channel*, never a union.
  A claim can be supported by the document and unaddressed by the web, and the
  reader should see both.
- **The questions differ.** The document answers *"does the reader's own
  material say this?"* The web answers *"does anything outside say this?"*
- **Absence means different things.** Document-absent is a strong finding — the
  corpus is bounded, enumerable, and the reader's own. Web-absent is weak — the
  web is unbounded and absence proves little. Today both render the same `⊘`.
- **Precedence.** A claim *about the document* is answerable only by the
  document. No quantity of web agreement may mark it grounded. "What does page
  4 of my PDF say" is a question web search cannot answer, ever.

## 4. Relevance — what *kind* of thing is being grounded

### Measured: the dolphins failure is retrieval, not the model

`fetchWikipedia` calls `list=search` and takes `hits.slice(0, numResults)`.
For `srsearch=dolphins`:

```
1. Dolphin
2. Miami Dolphins            <- rank 2
3. Bottlenose dolphin
4. Le Moyne Dolphins men's basketball
5. Dolphins (NRL)
```

At the default `numResults = 4`, **three of the four passages handed to the
model are sports teams.** The model then grounds its answer in what it was
given, exactly as the citation law instructs. It is not defaulting to the NFL
team; retrieval handed it the NFL team. No prompt change can fix this.

### Proposed, in priority order — all mechanical

1. **Vocabulary overlap against conversation context.** `significantWords`
   already exists and is already used by `snipCitations` and
   `findMechanicalCorrection`. Score each candidate article's extract against
   the conversation's own vocabulary. Marine-biology context ranks *Bottlenose
   dolphin*; football context ranks *Miami Dolphins*. Zero model calls, existing
   tested machinery, highest value per line changed.
2. **Wikipedia categories as a type signal.** Confirmed working —
   `Dolphin` carries *Animals that use echolocation*; `Miami Dolphins` carries
   *American Football League teams*. Caveat measured: real categories arrive
   mixed with maintenance noise (*All articles with unsourced statements*,
   *Articles with short description*), so this needs a filter over the
   `All articles…` / `Articles with…` / `Wikipedia…` / `CS1…` / `Pages…`
   families before the signal is usable.
3. **Stop discarding disambiguation.** The DDG call passes `skip_disambig=1`,
   throwing away the one signal that says the term is ambiguous.
4. **The hypergraph is the policy-legal orienting channel for this.** It is
   `canWarrant: false`, which bars it from being evidence — but disambiguation
   is not evidence, it is orientation, which is precisely what §0 of the
   companion doc says the hypergraph is *for*. Using session entities to
   disambiguate a query is the one hypergraph use that is fully compliant.

## 5. "I don't think this needs grounding — am I wrong?"

Citey should be able to decline to check something, **out loud**.

The tension is that L5 bars a model from a correctness-bearing path, and the
skip decision is asymmetric:

- model says *check it*, wrongly → a wasted lookup. Cheap.
- model says *skip it*, wrongly → an unchecked claim ships. Correctness-bearing.

The resolution: **a skip lowers the action, never the record.** The claim is
still marked, still visible, still carries Citey's stated reason, and the
reader can overrule with one click. Nothing is silently dropped, which is
L3 (no silent truncation) and L6 (no implied completeness) satisfied rather
than bypassed. The mechanical floor still stands: a model may raise the
grounding demand above it and may never lower it — the same monotone
discipline `escalate()` already enforces, where *"a later stage may discover a
reason to deliberate; it may never discover a reason to stop."*

### The feedback is facts, not weights

**In-browser WebLLM is inference-only. There is no fine-tuning path**, so
"training the local Citey" cannot mean gradient updates today.

There is something better available under this repo's own laws. A reader's
ruling on "should this have been checked?" is a stated fact with a named
giver — exactly the shape `eo-warrant.ts` gives the `desk` channel
(*conversational, `canWarrant: true`, "holds, word for word, facts the reader
already stated"*), and exactly what `eo-hypergraph.ts`'s `admitSelfFacts`
already injects via `injectPrior` with a named giver, *"never re-derived."*

So: reader verdicts accumulate into a growing closed set, consulted
mechanically **before** any model is asked — the L2 pattern (`eo-self-facts.js`,
*"a small, explicit, closed-set pattern extractor"*). That beats fine-tuning
here on every axis that matters: auditable, testable, instant, and it survives
a model swap. A recorded human verdict is a fact; a weight update is a guess.

If real training is wanted later, the same records are the dataset — export as
pairs and fine-tune outside the browser. Starting mechanical costs nothing.

## 6. What this makes false in the current code

Each of these was reproduced headless; none is speculative.

- **`eoJudgeClaim` (`chat.ts:627-679`) violates both rules at once.** It asks a
  1B local model for a truth verdict (`confirmed`/`contradicted`, against R1)
  **and** demands strict JSON (against R2, and against the standing rule that a
  local model is never trusted for precise structured output). Its own comment
  records the model fabricating a contradiction 1-in-10 at temperature 1.0 —
  and the fix applied was lowering the temperature, not removing the model.
  L5's parallel case says *"the fix was not a better prompt. It was removing the
  model from that path entirely."* That fix was never applied here.
  There is precedent in this repo: `chat.ts:3290-3299` records
  `needsDecomposition` being changed away from reading a JSON field for exactly
  this reason — *"a small model's JSON reply can come back malformed on exactly
  the requests complex enough to need this judgment."* The lesson was learned
  once and not carried across.
- **Cross-channel contamination** — §3 above.
- **Gate C miscalibration** — §2 above, and it blocks always-on lookup.
- **Retrieval ambiguity** — §4 above.
- **A "sourced" chip with nothing to point at.** `state` is decided against the
  abbreviation-expanded union index, but `supportingCitationIndexes` is
  recomputed per citation with raw `wordSet`/`hasWord`. Source *"Chief
  Executive"* + draft *"CEO"* yields `state=sourced, supporting=[]` — a
  confident chip that is not clickable, breaking
  `310-citation-audit.md`'s stated contract that *"every citation can be
  followed to its source."*
- **Two layers, opposite verdicts, same atom.** Source *"Nashville Police
  Department"*, draft *"Nashville Police Commissioner"*: 2-of-3 tokens clears
  `ECHOED_MIN_TOKEN_FRACTION`, so the chip renders `echoed` — clickable, with a
  footnote number — while `checkGrounding` simultaneously reports it
  unsupported. A fabricated job title is handed a citation footnote.
  **Decision: `echoed` is to be treated as unsupported.** A partial match is
  precisely the unearned bracket `020-core-citation-law.md` forbids.
- **Resolve eligibility is incoherent.** `chat.ts:3459` filters
  `state === "checking" || atomKind === "name"` — a disjunction of a state and a
  kind, so a `contradicted` name is re-resolved while an `echoed` number never
  is. And `chat.ts:3512-3514` overwrites `clause`/`sourceTitle`/`sourceUrl`
  *before* the `if (c.judged)` guard, so a corpus-warranted name silently
  acquires an unrelated web URL as its provenance.

## 7. Backends

Measured this session, from a headless environment:

- **Wikipedia** works browser-direct (`origin=*` CORS) and is the only backend
  that reliably returns prose today.
- **DuckDuckGo Instant Answer** returned *completely empty* for
  `"Nashville police department budget"` — every field blank, `RelatedTopics:
  []`, `Results: []`. It only answers for entities with a curated instant
  answer, so as a fallback it is close to inert for real queries. The HTML
  endpoint returned 14 KB with no parseable result anchors in a first pass
  (likely a challenge page — not fully diagnosed).
- **Therefore real DDG needs the proxy.** It is not a browser-direct option.

**Wikipedia as an index, not as evidence.** `eo-websearch.ts`'s own header
records that eochat's server version followed an article's citations out to
primary sources, and that this was dropped for the browser because cross-origin
fetch is opaque. With a proxy it returns. This is worth more than breadth: an
article's `<ref>` list is a curated set of primary sources, a far better
corroboration corpus than a general result page. And it shares machinery with
§4 — the same article metadata that disambiguates also carries the outbound
links.

Both routes, not one. They fail differently, which is the point.

## 8. Non-goals

- **No verdict, from any channel, ever.** Not even corpus. Corpus supports the
  strongest possible statement — *"the bytes at this address say X"* — and that
  is still a statement about the source, not about the world.
- **No model call that receives retrieved content in order to describe it.**
  That is the one thing §1 exists to prevent. If a feature needs the model to
  read the evidence, it is the wrong feature.
- **No JSON, no tool-calling, no structured output demanded of the local
  model.** Let it produce language and read the language mechanically. Asking a
  1B model to be a parser is asking it to do the one thing it is worst at.
- **No fine-tuning claim.** See §5 — nothing in this design trains anything
  today, and the doc should not be read as promising that it does.
