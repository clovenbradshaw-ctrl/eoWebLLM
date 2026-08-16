# How Citey fact-checks — and the comparison that makes it possible

A living design doc. States what is true now, what is measured, and what is
proposed, and marks which is which. Companion to
[`citey-grounding-policy.md`](citey-grounding-policy.md) (what gets checked and
in what language) and [`citey-structured-grounding.md`](citey-structured-grounding.md)
(the grounding/channel model).

Every number here was reproduced against the running modules on 2026-08-13,
headless, via `node --import ./scripts/register-ts-resolve.mjs`. None is
inferred from docs.

## 0. The big get

**Turn any text into a typed reading, and comparison becomes mechanical.** Two
readings can be diffed for where they say the same thing and where they differ,
without matching words, without a model, and without asking what language
either was written in.

That is the goal the rest of this doc measures against. The finding of this pass
is that it is far closer than the work had been assuming: **every component
exists and ships today. Nobody had connected the last two pipes.**

## 1. What Citey is today, stated plainly

**A source-presence checker, not a fact-checker.** It answers *"is this atom
present in the material?"* It cannot answer *"is this true?"*, and the design
must never let it appear to.

Measured. Given a source about a police budget:

| fed to it | Citey says |
|---|---|
| TRUE, verbatim from the source | `sourced`, clean |
| TRUE, but absent from the source ("Nashville is the capital of Tennessee") | **1 unsupported** |
| LIE, invented ("requested 40 patrol vehicles") | **1 unsupported** |

Rows two and three are identical, and that is correct behaviour for what it is.
The honest report is *"not present in the material"* — true, checkable, and
never *"false."* This is rule 1 (§4) at the smallest scale the system has.

Two results from the same run are less comfortable:

- **A fabricated person renders as a positive state.** `Chief Rodriguez` against
  a source naming `Chief Alvarez` grades `echoed` — clickable, footnote-numbered
  — because "Chief" matched. Same for `Nashville Police Commissioner` over
  `…Department`. Already pinned as a defect; worth restating because the object
  being invented here is a human being.
- **`findMechanicalCorrection` refused both correction attempts**, returning
  `null` rather than guessing. That is the design working: it declines whenever
  the winning sentence holds more than one candidate of the claim's kind.

## 2. The atom gate's ceiling — measured

`extractAtoms` decides what is checkable at all. It extracts exactly two things:
ASCII digit runs (`NUMBER_RE`), and capitalised runs minus a stopword list
(`PROPER_RE`). **A sentence containing neither is not "checked and found
clean" — it is never examined.**

Over real prose:

```
legal / statute      75.0% of sentences contain an atom
literature           60.8%
encyclopedic         38.0%
────────────────────────────────
OVERALL              57.1%
```

**42.9% of real sentences are invisible to every atom-based mechanism**,
whatever else is fixed. And the ceiling has four distinct faces, each measured
separately:

- **Category.** Only numbers and proper names. Causation, polarity, relations,
  and quantity-without-digits are outside it. A negation flip — source says *did
  not request*, claim says *did request* — yields **zero atoms and a clean
  report**.
- **Direction.** Every mechanism scans claim→source. Nothing scans source→claim,
  so **omission is invisible even for sentences that do have atoms**.
- **Script.** Uncased scripts yield **0** atoms; German yields **4.7×** English
  on the same document. 19 of 516 UDHR translations flag nothing at all.
- **Precision.** It flags `Sure`, `I'd` and `Happy Friday` as checkable claims.

Simultaneously too narrow and too broad. No amount of tuning fixes both.

## 3. The finding: the comparison is already built

### 3.1 The pipeline that exists

```
text ──▶ toEvents ──▶ event log ──▶ readLens ──▶ readDocument ──▶ reading
                                                                    │
                                                    toEOTReader ◀───┤  (surface)
                                                    diffLinkViews ◀─┘  (comparison)
```

`buildReading(text)` (`app/client/reading-pipeline.js`) runs today on any
string. `eo-source-ingest.ts` already calls it on every uploaded document and
renders the result as EOT.

**Compare the reading, never the EOT surface.** EOT is a rendering;
`reading.js`'s own header is explicit that the engine "does NOT … render
anything" and that turning a reading into an EOT surface is application work.
Diffing rendered text would be string matching again, one layer up.

### 3.2 The diff is the Operation axis

`diffLinkViews` (`app/client/eo-binary/reading-diff.js`) returns
`{added, removed, changed, unchanged}`. Against a reference reading, with the
claim as B, that mapping is exact:

| diff result | Operation |
|---|---|
| `added` — in the claim, no counterpart in the reference | **invent** |
| `removed` — in the reference, no counterpart in the claim | **omit** |
| `changed` — same edge, `class` or `polarity` differs | **inflate** |
| `unchanged` | agreement |

Measured, reference vs. four claims:

```
REFERENCE  bus::red->bus[color]  bus::red::large->bus::red[size]
           bench::wooden->bench[material]  bench::wooden::small->…[size]

identical          +0 invent   -0 omit   =4 agree
omits the bench    +0 invent   -2 omit   =2 agree
     OMIT   : bench::wooden -> bench [material]
invents a truck    +2 invent   -0 omit   =4 agree
     INVENT : truck::blue -> truck [color]
```

**`omit` was called architecturally invisible earlier in this same session.**
It is not. It is `d.removed`, it is free, and it already works — because a diff
is bidirectional by construction where a lookup is not.

### 3.3 Why this dissolves the ceiling rather than raising it

Every limit in §2 is a property of the atom gate. None applies to a reading
diff:

| limit | atom path | reading diff |
|---|---|---|
| 42.9% of prose invisible | numbers + capitals only | edges come from structure, not tokens |
| omission impossible | scans one direction | bidirectional by construction |
| negation flip → clean | zero atoms | `polarity` is already a diffed field |
| uncased scripts → 0 | keys on `\p{Lu}` | typed edges, no case dependency |

## 3.4 Precondition: identity across sources

Everything above assumes two readings can be compared. They cannot, safely,
until it is settled what makes a referent in one source *the same referent* as
one in another — see
[`citey-cross-document-identity.md`](citey-cross-document-identity.md).
`diffLinkViews` keys on bare strings today, so edges from different documents
collide by construction, and a diff over wrongly-merged referents produces
confident nonsense. That doc is a precondition of this one, not a follow-up.

## 4. The policy

Five rules. The first four are the project's own; the fifth was the one place
the build already violated the first.

**P1 — Never emit a single verdict.** Every claim gets parallel findings, per
channel and per edge. Where they disagree, **the disagreement is the finding**,
not an input to a score. This is eo-constitution II.8 ("no averaging of
grounds") — the compliant move is not "gather several sources, then rate the
claim," it is "report each finding and let the conflict stand."

**P2 — Field is the only grounding.** A byte-addressed span is the sole atomic
grounding unit. Entity, Kind, Link, Network, Atmosphere, Lens and Paradigm are
navigation: each must carry a live pointer down to a Field span and may never
stand in for one. Enforced by construction in `eo-grounding.ts` — `hypergraph` is
typed `paraphrase`, `canGround: false`.

This binds the reading diff too, and sharply: **a diff of two readings is not
evidence.** It says two structures differ. Which one is right is a Field
question, and a difference that cannot be resolved to a span is a pointer, not
a finding about the world.

**P3 — Score revision, not arrival.** Weight evidence by whether it forces the
existing model to be rebuilt (backward — content explains prior), never by
whether it confirms what was expected (forward — prior predicts content).
Forward-scoring is refused as "scoring the arrival" (II.9). A good checker is
not the one that best predicts what a source will say; it is the one whose model
changes most, honestly, when it is wrong.

**P4 — 27-way resolution is a profile, never a cell pick.** Reporting where a
claim sits across all 27 dimensions is legitimate. Picking the one cell a claim
belongs to is refused, with numbers behind the refusal: shuffling words inside
2,527 paragraphs left **95.7%** of cell assignments unchanged, and the
fabrication veto built on it passed three plain fabrications. A classifier that
survives destroying word order is not reading anything.

**P5 — Split before adding.** `owned` collapsed four situations into one colour
and one caption — desk-backed, internal, forbidden-channel bleed, and genuinely
unconfirmed. That is P1 violated at the smallest unit the system has.

**Status: split and attribution reconciled; both ship.** `98d435b` landed the
four states. `170713d` then rewrote `eo-grounding-spans.ts` from a pre-split
base, restoring single-state `owned` and adding origin-channel *attribution* on
top of it — work done from a stale checkout, not a reversal on the merits.

They were never rivals, and the reconciliation keeps the better half of each.
**Attribution is the better detector**: fractional token matching, three
channels kept apart (`desk` / `discourse` / `hypergraph`), and an explicit
`externalRequired` flag before anything is called `internal`. **The split is
the stronger guarantee**: it makes the distinction a *type*. So the states are
now derived from that same detection rather than from a second, looser guess
(L11d):

| originChannel | state | why |
|---|---|---|
| `desk` | `stated` | conversational channel, `canGround: true` — backed, just not by a source |
| `discourse` / `hypergraph` | `bleed` | both `canGround: false` — the same *kind* of failure |
| — (material gathered) | `unconfirmed` | we looked; it is not there |
| — (nothing gathered) | `general` | nothing external bore on the turn |

`originChannel` is kept alongside, and is strictly finer: `bleed` deliberately
collapses discourse and hypergraph, and the channel still says which, so a
caption can name it. It may sharpen wording; it may never decide whether
something is backed.

**Why the type and not the caption.** Under attribution alone, a claim the
reader personally stated and a claim resting on a paraphrase whose source is
gone were the same *value*. The colour and caption differed — but every
filter, count and predicate switching on `state` still treated them as one
thing, and the resolve pass, the chip's citability check and the seam guards
all switch on `state`. That is II.8's "no averaging of grounds" at the smallest
unit the system has, and a comment cannot enforce where a type can. Four tests
in `test-eo-grounding-spans.mjs` pin it, including the one that matters:
`stated` and `bleed` must not be equal.

## 4.5 The void — the grounding that catches fabrication

A void is a **finding**, not a failure to find. "I looked in X, Y and Z and it
is not there" is a positive, checkable result, and it is the only kind of
grounding that catches a fabrication: a confirmation tells you a claim is
present; a void tells you an invented one is not.

That makes §1's uncomfortable result — that Citey grades a true-but-unsourced
claim and a fabricated one identically — a **void problem**, not a fact
problem. The distinction between them is entirely in the SCOPE of the search
that failed. "Not in the three files you uploaded" says almost nothing. "Not in
those three, nor forty web results, nor the encyclopedia, nor the dictionary"
says a great deal. Today neither is recorded, so every void carries the same
weight, which is to say none.

### Measured

```
never checked (no citations)   clean=true   atomsChecked=0  channels=[]
checked against the source     clean=false  atomsChecked=2  channels=[your sources]
```

**`clean: true` is what a caller gets for "never looked."** The distinguishing
information exists — `atomsChecked: 0`, `channels: []` — but the field whose
name invites a boolean read carries the wrong answer. LAWS.md L2e is explicit
that *"checked, nothing there" and "never checked" are different facts and must
not render alike*; `checkedEmpty` exists in the fold ledger for exactly this
distinction, and `checkGrounding` does not make it at its own surface.

**A void names a channel label, never an address:**

```
The department received $1,136,000,000 [⊘ not in your sources or web] …
```

Compare the two directions of the same system. A citation is
`budget.pdf#0-90` — followable to exact bytes, by anyone, later. A void is
`your sources or web` — a label. No source ids, no query, no cursor, no
timestamp. **It cannot be re-run, so it cannot be checked or challenged.** It
is an unaddressed claim, which is the one thing this system refuses everywhere
else.

**And `annotateVoids` is dead in the app.** Nothing outside
`eo-citation-check.ts` calls it, so the `[⊘]` marker never reaches a reader at
all. Voids survive only as `report.findings[]` and as `checkedEmpty` on the
ledger.

### The principle

**A citation's grounding is a byte address. A void's grounding is a reproducible
search.** Same discipline, different object — and both meet the same standard:
someone else can repeat the trip and get the same answer.

So a void should carry what a search needs to be re-run: the scope actually
covered (source ids, not channel labels), the query, the cursor it ran at, the
method, and the result. That is a Field-equivalent for absence, and it is what
would let a reader challenge a void instead of taking it on trust.

### Policy

**V1 — A void is a finding with the same standing as a citation.** It is
reported, addressed, and auditable, never a silent absence or a bare
"unsupported."

**V2 — A void's grounding is a reproducible search.** Record the scope by
identifier, the query, and the cursor. A void nobody can re-run is an assertion.

**V3 — "Never checked" is never "clean."** The distinction must live at the
field a caller actually reads, not only in a count beside it. An unexamined
claim and an examined-and-absent one are different results.

**V4 — A void's weight is its scope, and its scope is always declared.** An
unscoped void says nothing and must not be rendered as though it said
something.

**V5 — A void is a claim about a search, never about the world.** "Not found in
X, searched at Y" — never "false." This is P1 and P2 applied to absence: the
strongest available statement is about what was looked in, not about what is
true.

## 4.7 How it appears — the attention hierarchy

A report that is correct and unread is not a report. The presentation is not
downstream of the policy; for a reader it *is* the policy, and getting it wrong
undoes the engine's refusals in the last mile.

**The inversion.** Convention makes citations loud (footnotes, badges,
superscripts) and disagreements invisible. That is backwards. A citation is the
one thing a reader could already check for themselves; a disagreement between
grounds is the one reading they cannot get anywhere else. So:

| rank | what | treatment | why |
|---|---|---|---|
| 1 | **grounds disagree** | filled panel, warm border, **above** the reply | the only finding that no single ground contains |
| 2 | contradicted / bleed | chip + Citey's note | a warning about one ground |
| 3 | **void, with its scope named** | outlined panel, dashed | an assertion, and a followable one |
| 4 | sourced / stated | chip only | quiet: it agreed |
| 5 | general | chip, near-invisible | nothing bore on it |

Rank 1 sits *above* the message body, not below it. A disagreement rendered
after the answer is a footnote to the thing it contradicts.

**Three refusals hold the surface** (`terrain/grounds-panel.tsx`), and each is
guarded by a test rather than left to whoever edits it next:

1. **Nothing ranks.** No score, no confidence, no ordering by strength, no
   winner. A disagreement is two lists side by side, left standing. Deciding
   what it means is the reader's (II.3). A UI that resolves it has averaged the
   grounds after the engine carefully refused to — II.8 violated in the last
   mile, where it is hardest to notice.
2. **A void names its bound.** Every void prints what was looked in, by
   identifier, plus the query where there was one. `Ground.query` and
   `GroundVerdict.sourceIds` exist for this. An unbounded void is a shrug
   wearing a finding's clothes: nobody can come back and disagree with it, so
   it fails II.9's revision test at the first step.
3. **An unexamined ground says so.** `examined: false` never renders as
   agreement or as a clean bill (L2e). "Checked, nothing there" and "never
   checked" are different facts, and a ground nobody looked in is not a place
   the thing was *not found*.

**The chips must not contradict the panel.** `buildGroundingSpans` grades every
atom against ONE union index built from every ground, so an atom carried by a
single ground reads as `sourced` — and the panel above it, built from the
parallel report, says the grounds disagree about that same atom. Two surfaces,
one message, opposite claims. `demoteDisagreedSpans` un-merges the chips after
they are built: a disagreed atom drops to `unconfirmed` and loses its citation
indexes, because those point at the ground that *did* carry it, and letting the
chip open that passage answers *"is this backed?"* with the one ground that
happens to agree.

This is not a patch over an average. The parallel report is strictly more
informative than the merged one — the merge is a lossy function of it — so the
demotion restores information the merge destroyed. And only `disagreements` can
be over-credited this way: an atom absent from every ground is absent from the
union too, so it was never `sourced` to begin with, which is why
`unsupportedEverywhere` is deliberately not consulted.

**The steering channel is visible and correctable.** `session.eoFocus` decides
what a referential message (*"prove it"*, *"find examples of that"*, 「証明して」)
gets resolved against before anything is searched. It was derived silently and
read silently — the one input to retrieval a reader could neither see nor argue
with, and a focus that has drifted sends every later search after the wrong
subject, invisibly. It is now shown above the composer, in the words that were
actually said (`groundReferent` only ever stores spans from the transcript, so
there is something literal to show, and showing it is what makes drift
noticeable). Editing it **pins** it, and the System-2 pass stops overwriting it
— II.2's giver test applied to steering: what the reader gives outranks what
the machine infers about what they gave. Clearing unpins and hands steering
back, because *"stop steering"* and *"steer here instead"* are different acts
and a control offering only one leaves the reader stuck with a focus they can
see and cannot leave.

## 5. Where the work actually is

| piece | status |
|---|---|
| `buildReading(text)` → typed reading | **ships**, runs on any string today |
| `diffLinkViews` → added/removed/changed | **ships**, pure, tested |
| `toEOTReader` → EOT surface | **ships**, used by source ingest |
| the two connected into a claim-vs-reference check | **not wired** — this is the gap |
| `checkGroundsInParallel` → per-ground verdicts, no merge | **ships** |
| the grounds-disagreement surface (`GroundsPanel`) | **ships** — §4.7 |
| void scope by identifier + query | **ships** |
| focus visible and pinnable (`FocusBar`) | **ships** |
| chips un-merged to agree with the panel (`demoteDisagreedSpans`) | **ships** |
| a **relations lens** so readings hold propositions | **not declared** — the real work |
| `checkConsistency` in the grounding path | **built, unwired** |

**The one real gap is the relations lens.** The only lens wired into
`buildReading` today is modifier-scope, so a reading captures adjective nesting
(`bench::wooden::small`), not propositions. It correctly caught an invented
truck and an omitted bench; it would not catch *"the budget rose to $1.1bn"*
against *"$1.02bn"*, because no lens emits that edge.

That is a wiring gap, not a research one. eoreader6 has SVO relations with
polarity (`perceiver/text/relations.js` → `emergence/graph.js`), and
`readDocument` composes any number of lenses at one cursor without
modification. Declaring a relations lens is the same shape
`MODIFIER_SCOPE_LENS` already is.

**One measured detail that matters when it is built.** In the run above,
`changed` stayed at 0 and a wooden→metal substitution reported as invent+omit
instead. That is `defaultIdentify` keying on `(subject, object)`, where
`bench::wooden` and `bench::metal` are different subjects. A relations lens
should key on `(subject, verb, object)` so a magnitude change lands in
`changed` — which is **inflate** — rather than splitting into a false
invent/omit pair. `diffLinkViews` already accepts `identify` as a parameter for
exactly this.

## 6. Non-goals

- **No verdict, from any channel, ever** — not even Field. Corpus supports the
  strongest available statement, *"the bytes at this address say X"*, and that
  is still a statement about the source rather than about the world.
- **No diff presented as truth.** P2 applies to the comparison itself: a
  structural difference is a pointer to two spans, never a ruling between them.
- **No cell pick.** P4 has a refutation with numbers; nothing here reopens it.
- **No fix to the atom gate by adding alphabets.** Its script failures are
  measured in `test-omnilingual-gate.mjs` and the repair is content-word
  extraction, not more `\p{Lu}` ranges — the same mistake in more languages.
- **No claim that the reading diff is omnilingual yet.** Typed edges do not
  depend on case, which removes one barrier. Whether the *extraction* producing
  those edges is language-neutral is a separate, unmeasured question, and this
  doc should not be read as having settled it.
