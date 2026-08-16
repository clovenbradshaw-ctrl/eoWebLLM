# Citey terrain feedback spec — leveraging all nine readings

A living design doc, companion to [`citey-structured-grounding.md`](citey-structured-grounding.md),
which stays the authority on grounding/build status. This doc answers a
narrower question: given everything a *reading* (an admitted source, run
through eoreader6) actually produces — all nine Domain × Grain terrains, not
just the citation chip — what should Citey *do* with each one as feedback,
without ever overstating what any of them prove?

Terrains are eoreader6's own matrix
(`eoreader6/packages/engine/operators.js`'s `TERRAIN_BY_DOMAIN`,
mirrored in [`terrain/types.ts`](../app/components/terrain/types.ts)):

|                 | Ground        | Figure   | Pattern   |
|-----------------|---------------|----------|-----------|
| **Existence**   | Void          | Entity   | Kind      |
| **Structure**   | Field         | Link     | Network   |
| **Interpretation** | Atmosphere | Lens     | Paradigm  |

Two axes worth keeping straight while reading the rest of this doc:
**Domain** (what kind of thing is being read — that something exists, how
it's structured, how it's being interpreted) and **Grain** (how zoomed the
reading is — a single point, a named figure against ground, or a pattern
across many figures). Field sits at Structure × Ground for a reason: it's
the most zoomed-in, least-interpreted reading there is — raw bytes, no
structure imposed yet beyond "this span exists." That's exactly why it's
the only terrain that can ground a claim (§0 of the companion doc). Every
other cell adds either more structure or more interpretation on top of
Field, and Citey's rule is the same for all eight of them: use the reading,
never launder it into a citation.

## 0. The rule this whole spec obeys

Restated from the companion doc because every section below leans on it:
**only Field can ground.** Everything else is a *reading* — evidence that
something is worth checking, never evidence that it's true. Citey's feedback
on a non-Field terrain must always be phrased as a pointer ("this comes up
elsewhere," "here's how it's framed differently," "the corpus's tone shifted
right around here") and never as a verdict ("this is true," "this is
confirmed"). Where a proposed behavior below risks blurring that line, it
says so explicitly.

## 1. Per-terrain feedback

### Field (Structure × Ground) — built, grounding-bearing

**Data source:** `readSpan`/`documentText`/`searchSpans` (`corpus.js`),
byte-addressed.

**Current use:** the only clickable target for a `sourced` grounding chip
(`grounding-chip.tsx`); the citation law's `[n]` brackets bottom out here.

**Nothing to add.** This is the baseline every other section measures
itself against — the one terrain where "leverage more" would mean
weakening the grounding, not strengthening the feedback. Spec deliberately
stops here.

### Entity (Existence × Figure) — built, orientation-only

**Data source:** `sessionReferents` (`corpus.js`), surface-form keyed.

**Today:** Entity card shows mentions, first/last seen, edges. Not wired
into ungrounded chips yet.

**Proposed feedback:** an `owned` or `checking` grounding-chip atom whose
text matches a known Entity surface form becomes clickable — not to Field,
to the Entity card. `chipReasonText` gets a second clause: *"nothing backs
this directly, but it comes up elsewhere in what's been read."* This is the
sketch from the previous turn; it's the cheapest, most-general terrain to
wire first because every other atom-level routing below (Link, Network)
piggybacks on the same surface-form match this needs.

**Honesty constraint:** the chip must never imply the Entity's other
mentions confirm *this* claim about it — only that the name/number isn't
invented, it's a real recurring figure in the material.

### Link (Structure × Figure) — built, orientation-only

**Data source:** `sessionRelations` (`corpus.js`), subject–verb–object
triples with weight and seen-range.

**Today:** Link card shows a relation's own backing spans
(`[1][2][3]`, namespaced separately from chat's `[Field:n]` per §8 of the
companion doc) and a "compare framing" affordance that currently routes to
the Lens placeholder.

**Proposed feedback:** when an `owned`/`checking` atom's surrounding clause
matches a Link's subject-verb-object shape closely enough (reuse whatever
matcher `graph.js`'s `edgeKey`/`structuralKey` already applies — token
overlap, not new NLP), route the chip to that Link card instead of (or
alongside) the matching Entity. The payoff over Entity alone: a Link card
shows its *own* backing spans, so a reader lands somewhere that might
already resolve the claim they were unsure about, one hop closer to Field
than an Entity profile gets them.

**Honesty constraint:** exactly the cross-document binding gap in §3 of the
companion doc applies here too — `graph.js` keys on literal lowercased
string form, so "MNPD" and "Metro Nashville Police Department" are two
separate Links today. A chip that confidently routes to "the" matching Link
when there may be an unmerged duplicate is overclaiming precision. Surface
this as a visible caveat on the routed card (Entity's card already carries
one caption line doing exactly this per §8 — Link's routed-to state should
say the same), not silently.

### Network (Structure × Pattern) — built, orientation-only

**Data source:** `sessionGraphSnapshot` (`graph.js`), force-directed
(`network-card.tsx`, d3-force).

**Today:** opened directly (`chat.tsx:2072`) or via an Entity node click.
Not reachable from a grounding chip.

**Proposed feedback:** Network's value over Entity/Link isn't per-claim
routing — a force-directed graph is the wrong target for "here's the one
thing behind this atom." Its use is aggregate: when a message carries
several `owned`/`checking` atoms whose matched Entities are all
tightly clustered in the graph (high mutual edge density), that's worth one
message-level note, not a chip — something like *"several of this
message's unconfirmed claims cluster around the same few entities in what's
been read; worth checking as a group."* This is a genuinely different
signal than any single chip can carry, which is the actual argument for
building it at all rather than leaving Network as a standalone destination.

**Status:** needs a message-level aggregation pass (compute cluster density
over the matched-Entity set from all of a message's spans), not just a new
`onNavigate` target — more design than Entity/Link routing, but data it's
already computing. Second phase, not first.

### Atmosphere (Interpretation × Ground) — built, orientation-only

**Data source:** `hypergraphTiersSnapshot(...).tiers.find(t => t.name ===
"atmosphere")` — `observations`, `shifts`, `novelRate`,
`recentShifts: {at, surprise, rank, censored, reZero, forms}[]`
(`eo-hypergraph.ts:662-683`, already rendered in `atmosphere-card.tsx`).

**Today:** its own card, opened directly. Genuinely per-session data — a
running register-shift timeline over everything admitted, computed with
zero model calls the same way grounding spans are.

**Proposed feedback:** an `owned`/`checking` atom whose position in the
admitted material falls near a `recentShifts` entry's `at` cursor gets a
lighter-weight caveat than Entity/Link routing — not a click target, an
inline note: *"this lands right where the material's tone/register shifted
— worth reading the surrounding passage, not just this line."* `surprise`
gives a natural threshold (only flag shifts above some surprise floor, to
avoid noise); `censored`/`reZero` are already-labeled edge cases the note
should stay silent about rather than trying to explain inline.

**Honesty constraint:** a tone shift is not evidence a specific claim is
wrong — it's a reason to read more carefully, nothing more. The note must
not use language that implies doubt caused by the shift; it's proximity,
not causation.

### Lens (Interpretation × Figure) — thin data exists, card not built

**Data source:** the *same* `hypergraphTiersSnapshot` call already covers
this — `snap.tiers.find(t => t.name === "lens")` returns real
`observations`/`shifts`/`novelRate`/`recentShifts` counters today, per the
tier-name list `atmosphere-card.tsx` already filters against. What's
missing is only the UI (`placeholder-card.tsx`'s honest gap state) and the
per-source scoping described in §5 of the companion doc — full
cross-source "how does source A frame this Link differently than source B"
needs scoped tier reads or parallel per-source stacks, which is real design
work, not plumbing.

**Correction to the companion doc's framing worth noting:** §4's table
lists Lens as "not built" with no artifact, which is true of the *card*,
but the tier-counter data underneath it is not nothing — it's the same
`sessionTiersSnapshot` export Atmosphere already uses, just unrendered.
Anyone picking this up should not assume Lens needs an engine change before
anything can ship; a same-shape `LensCard` showing its own tier's raw
counters (no cross-source diff yet) is buildable today with zero engine
work, exactly mirroring `atmosphere-card.tsx`. The *comparison* feature —
Link's "compare framing" affordance actually working — is what's blocked
on the scoping design in §5.

**Proposed feedback (once scoped):** Link's existing "compare framing"
routes here already (§6 of the companion doc, wired on purpose even while
the destination is a placeholder). When built, a `contradicted` grounding
span (two sources disagreeing, per `eo-citation-check.ts`'s resolve pass)
should route to Lens instead of just rendering the contradiction inline —
the useful reframe for a reader is often "these aren't actually
contradicting, they're framing the same relation from different angles,"
which a flat contradiction chip can't say and Lens is specifically built to
show.

**Status:** raw-counters card — buildable now, small. Cross-source
comparison — blocked on the §5 design question. Spec this as two separate
tickets, not one.

### Kind (Existence × Pattern) — not exported

**Data source:** `eoreader6/packages/engine/emergence/kinds.js` computes
`id, label, population, members, core, cohesion, height, heightGate,
operator_chain` internally; none of it crosses `host/index.js`.

**Proposed feedback (once exported):** Kind clusters Entities into induced
categories. The Citey-relevant use is upstream of any single claim: a
`falsum`/`owned` atom whose matched Entity belongs to a Kind with high
`cohesion` is claiming something about a well-established category in the
material; low cohesion or no Kind membership is a signal the atom may be
more novel/isolated than the reader assumes. Phrased as feedback: *"this
doesn't fit an established pattern in what's been read yet — could be new
information, could be worth double-checking it's not a misread."*

**Status:** genuinely blocked. Exporting `kinds.js`'s `def()` output through
`host/index.js` (an `attachKinds`/`sessionKindsSnapshot` pair, mirroring
`graph.js`'s existing `attachGraph`/`sessionGraphSnapshot` shape) is
upstream engine work, not app work. Do not attempt an app-side approximation
of Kind clustering — that would be exactly the "faked data" §6 of the
companion doc rules out for placeholder cards.

### Paradigm (Interpretation × Pattern) — thin counters only

**Data source:** same `hypergraphTiersSnapshot`, `tiers.find(t => t.name
=== "paradigm")` — `observations`/`shifts`/`novelRate` today; the full
object (`paradigm.js`'s induced Kinds + core fields, `paradigmCores`,
`refuseParadigm`) doesn't cross the host boundary.

**Proposed feedback (available now, from the thin counters):** a
session-level caveat, not a per-chip one — surfaced once per terrain-panel
open rather than repeated per message: when `novelRate` is high, the
corpus is currently in a period where a large share of admitted material is
new rather than reinforcing what's already there, i.e. less settled than a
low-novelty session. That's a legitimate, mechanically-computed reason to
hold *every* `owned`/`checking` claim from this session a little more
loosely, and it costs nothing to surface — the data's already there,
exactly like Lens's raw counters.

**Proposed feedback (blocked on full export):** once `paradigmCores` and
`refuseParadigm` cross the boundary, a claim that contradicts an induced
Paradigm core is a stronger signal than a same-terrain `negation`/
`contradicted` state — it's not just two spans disagreeing, it's one span
running against the dominant pattern across the *whole* corpus. Still never
a verdict — "runs against the dominant pattern in what's been read" is a
different claim than "wrong," and Citey must keep them visibly different in
the phrasing (the same `⊥` vs `¬` distinction `citey-states.js` already
draws between "undeclared" and "contradiction").

**Status:** session-level novelty caveat — buildable now, no engine work.
Core-conflict detection — blocked exactly where Kind is.

### Void (Existence × Ground) — substrate, no export

**Data source:** none. `placeholder-card.tsx`'s own reason string is
correct: no organ in the engine exports ground-existence data to this app.

**What Void actually is, worth stating since it's the one terrain easy to
mistake for "nothing":** Existence × Ground is the reading of *that
something exists*, prior to any structure or interpretation — the most
minimal possible claim. §6 of the companion doc already calls Void
"substrate, rides along on any card above, not built" rather than a
destination in its own right, and NPJ's own vocabulary already has a home
for exactly this shape of claim: `CiteyBrain.js`'s `absence` stance (⊘/∅,
"asserted absence — a documented search did not find this," carrying a
`note` naming the search) is a *documented* claim that something does not
exist in the material, which is Void's own domain read honestly by a human
rather than an engine. The glyph (`∅`, see `citey-states.js:56`) already
matches Void's own reading, coincidentally or not.

**Proposed feedback:** don't build an engine-backed Void card — there's
nothing to export and no organ computing it (per placeholder's own reason
string). Instead, formalize the existing `absence` stance as Void's actual
Citey-facing surface: when a reader owns a claim as `absence` in `eochat`
or NPJ, the terrain panel's Void tab (still `placeholder-card.tsx` by
default) can render *that specific claim's* documented search instead of
the generic "no organ exports this yet" reason — Void becomes populated by
what a human has honestly asserted isn't there, never by anything the
engine claims to have checked. This is a UI wire-up (read the `data-note`
attribute NPJ already writes, or its eochat equivalent, when a Void tab is
opened from a specific `absence`-stanced claim), not new engine surface.

**Honesty constraint:** this must stay strictly claim-scoped. A Void tab
opened with no specific `absence` claim behind it stays the current honest
gap card — it would be a real overclaim for Void to imply "nothing exists"
about the corpus in general just because no organ exports ground-existence
data.

## 2. Wiring summary — what changes where

| Terrain | File(s) touched | New engine surface needed? |
|---|---|---|
| Entity routing | `eo-grounding-spans.ts`, `grounding-chip.tsx` | no |
| Link routing | same two, + reuse `graph.js` key matcher | no |
| Network cluster note | new message-level pass in `chat.tsx` | no |
| Atmosphere proximity note | `grounding-chip.tsx` (read `recentShifts`) | no |
| Lens raw-counters card | new `lens-card.tsx`, mirrors `atmosphere-card.tsx` | no |
| Lens comparison | blocked on §5 scoping design | no (design, not export) |
| Kind | blocked | yes — `attachKinds`/`sessionKindsSnapshot` |
| Paradigm novelty caveat | terrain-panel header, reads existing tier snap | no |
| Paradigm core-conflict | blocked | yes — `paradigmCores`/`refuseParadigm` export |
| Void (absence-scoped) | `placeholder-card.tsx`, read `data-note`/equivalent | no |

Seven of ten proposed behaviors need zero engine changes — they're reading
data eoreader6 already exports and app code already computes, just not yet
routed to the point of doubt. That's the headline finding of this spec:
"leverage everything the readings provide" is mostly a wiring problem
inside the app, not a research problem in the engine. The two genuinely
blocked items (Kind, Paradigm core-conflict) both need the same shape of
fix — an `attachX`/`sessionXSnapshot` pair through `host/index.js`, mirroring
`graph.js`'s existing pattern — so they should be scoped and built together
if either gets picked up.

## 3. Non-goals

- No terrain's feedback may ever be phrased as confirming or refuting a
  claim except Field. This is restated per-terrain above on purpose, not
  just here, because it's the constraint most likely to erode one small
  wording choice at a time.
- No app-side approximation of Kind or full Paradigm. Both are excluded by
  §6/§8 of the companion doc already; this spec adds no exception.
- Network's per-claim routing was considered and rejected in favor of the
  message-level cluster note — a force-directed graph answers "what's the
  structure," not "what backs this one atom," and routing single chips
  there would be building a worse Entity card under a different name.
- Void does not get an engine-backed card in this spec. Populating it from
  documented `absence` stances is deliberately the only path in — anything
  else risks Void reading as "the engine checked and found nothing," which
  no organ here does or should claim.
