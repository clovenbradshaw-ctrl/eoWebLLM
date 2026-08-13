# How Citey fact-checks — and the comparison that makes it possible

A living design doc. States what is true now, what is measured, and what is
proposed, and marks which is which. Companion to
[`citey-grounding-policy.md`](citey-grounding-policy.md) (what gets checked and
in what language) and [`citey-structured-grounding.md`](citey-structured-grounding.md)
(the warrant/channel model).

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

## 4. The policy

Five rules. The first four are the project's own; the fifth was the one place
the build already violated the first.

**P1 — Never emit a single verdict.** Every claim gets parallel findings, per
channel and per edge. Where they disagree, **the disagreement is the finding**,
not an input to a score. This is eo-constitution II.8 ("no averaging of
grounds") — the compliant move is not "gather several sources, then rate the
claim," it is "report each finding and let the conflict stand."

**P2 — Field is the only warrant.** A byte-addressed span is the sole atomic
warrant unit. Entity, Kind, Link, Network, Atmosphere, Lens and Paradigm are
navigation: each must carry a live pointer down to a Field span and may never
stand in for one. Enforced by construction in `eo-warrant.ts` — `hypergraph` is
typed `paraphrase`, `canWarrant: false`.

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
unconfirmed. That is P1 violated at the smallest unit the system has. **Done
this pass**: the four are now `stated` / `general` / `bleed` / `unconfirmed`,
named for the channels in `eo-warrant.ts` that already distinguished them,
detected mechanically with zero model calls.

## 5. Where the work actually is

| piece | status |
|---|---|
| `buildReading(text)` → typed reading | **ships**, runs on any string today |
| `diffLinkViews` → added/removed/changed | **ships**, pure, tested |
| `toEOTReader` → EOT surface | **ships**, used by source ingest |
| the two connected into a claim-vs-reference check | **not wired** — this is the gap |
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
