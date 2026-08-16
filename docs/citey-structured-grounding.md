# Citey: structured grounding via eoreader6's terrain ladder

A living design doc — states what's true now, not a changelog of how it got
here. Grounded against the repos as of this pass: `eoWebLLM` (this repo) and
`eoreader6` (the engine submodule). Everything under "Already built" is
verified in running code, not inferred from docs.

## 0. The one thing this whole design turns on

Entity/Link/Kind/Network are navigation and orientation, never evidence.
`app/client/eo-grounding.ts` enforces this by construction: it defines 8
grounding channels, each typed `external / conversational / paraphrase /
normative / internal`, with a `canGround` flag. Only **corpus** (source
bytes, byte-addressed), **web**, **file**, and **desk** (verbatim stated
facts) can ground a factual claim. **`hypergraph`** — the entire
Entity/Link/Network layer — is typed `kind: "paraphrase"`, `canGround:
false`, by construction. It can orient, it can never be the evidence.

A Link is a *discovered* relation (vocabulary matched, recurrence-gated),
one interpretive step removed from the bytes. Byte-addressed spans are the
only thing that's actually checkable. So the terrain ladder gives Citey two
different jobs, not one:

- **Field** (byte-addressed span) is the atomic grounding unit. Every
  citation chip in chat prose bottoms out here, full stop.
- **Entity / Kind / Link / Network / Atmosphere / Lens / Paradigm** are
  navigation and research artifacts — they help a reader find and
  understand material — and every one of them carries a live pointer down
  to the Field span(s) that back it. They don't replace the citation;
  they're how you get to it faster, and how you see structure a flat
  citation list can't show.

## 1. Already built (verified)

| Piece | Where | What it does |
|---|---|---|
| Grounding/channel model | `app/client/eo-grounding.ts` | 8 channels, `canGround` flag, mechanical System1/System2 routing (`routeTurn`, `reviewDraft`), monotone `escalate()` — a later stage can only raise the route, never lower it |
| Hypergraph wiring | `app/client/eo-hypergraph.ts` | One `eoreader.createSession()` per chat session (or per project, via `hypergraphScopeId`) — admits both uploaded sources and every conversation turn into a running belief graph. NAVIGATE (mechanical) → THOUGHT (one bounded background call, only when navigation found something) |
| Self-facts | `eo-hypergraph.ts`'s `admitSelfFacts` | User-stated facts injected via `injectPrior` with a named giver, never re-derived — canonicalizes onto the same graph nodes ordinary extraction finds |
| Citation law (prompted) | `instruction-set/020-core-citation-law.md` | `[n]` brackets tied to numbered passages surfaced *this turn* |
| Grounding spans | `app/client/eo-grounding-spans.ts` | Per-atom (number/name) mechanical grounding state — `sourced / owned / checking / contradicted` — computed with zero model calls, resolved post-generation against real search snippets (`app/client/eo-revision.ts`) |
| Terrain panel | `app/components/terrain-panel.tsx`, `app/components/terrain/*` | Consumer-facing, docked, resizable, light-theme panel — Entity/Link/Network/Atmosphere/Field are real cards; Kind/Lens/Paradigm are honest gap-state cards |
| Grounding chips | `app/components/terrain/grounding-chip.tsx`, wired into `app/components/markdown.tsx` | Inline chips over message text, one per `GroundingSpan`; "sourced" chips with a resolvable corpus citation open the Field card |
| Engine/app boundary | `eoreader6/packages/host/index.js` | The complete exported surface — see §2 |

## 2. The host boundary — what's exported vs. what exists but isn't

```
corpus.js   → sessionReferents (Entity), sessionRelations (Link),
              readSpan / documentText / searchSpans (Field)
graph.js    → sessionGraphSnapshot, attachGraph/admitGraph  (Network)
tiers.js    → sessionTiersSnapshot                          (Atmosphere/Lens/Paradigm counters)
surfer.js   → executePrompt                                 (mechanical NL surf)
sing.js     → createSinger, singPass, singRun, apertureSeries, sing
```

**Not exported, though the engine module exists:**

- `packages/engine/emergence/kinds.js` (Kind) — no `attachKinds`/
  `sessionKindsSnapshot` equivalent in `host/index.js`. A `Kind` record
  (`kinds.js`'s own `def()`) already computes `id, label, population,
  members, core, cohesion, height, heightGate, operator_chain` internally —
  none of it crosses the host boundary.
- `packages/engine/emergence/paradigm.js` (the full Paradigm object:
  induced Kinds + core fields, `paradigmCores`/`refuseParadigm`) — only the
  thin tier-3 counters (`observations`/`shifts`/`novelRate`) reach the app
  via `sessionTiersSnapshot`, not the actual paradigm content.

Two of nine terrains have no path out of the engine yet — Kind terrain and
full Paradigm content render as explicit gap-state cards in the UI (§6),
never faked data.

## 3. The cross-document binding gap

`graph.js` keys nodes and edges by literal lowercased string surface form
— `edgeKey`/`structuralKey` produce `subject|verb|object` strings, and
`navigateHypergraph`'s relevance filter is token-overlap substring
matching. There is no semantic co-reference step: "MNPD" and "Metro
Nashville Police Department" are two separate nodes today, even within one
session's own multi-source graph.

This is the single riskiest dependency for "true hypergraph across
sources": Kind clustering, cross-source Network merging, and any
Paradigm-level synthesis spanning more than one document would all inherit
this gap. Any future Kind/Paradigm host export should treat this as a
blocking prerequisite, not a follow-up — clustering over ungrounded
duplicate nodes produces clusters that look meaningful and aren't.

## 4. Terrain → artifact type

| Terrain | Status | Artifact | Grounding role |
|---|---|---|---|
| Field | built | Span viewer (`field-card.tsx`) — the citation chip target | **Bears grounding** (`corpus` channel) |
| Entity | built | Profile card (`entity-card.tsx`): mentions, first/last seen, edges | Orientation only |
| Link | built | Relation card (`link-card.tsx`): subject–verb–object, weight, seen-range, expand-to-spans | Orientation only |
| Network | built | Force-directed graph view (`network-card.tsx`, d3-force) | Orientation only |
| Atmosphere | built | Shift timeline (`atmosphere-card.tsx`, off `recentShifts`) | Orientation only |
| Lens | not built | — | Orientation only (once built) |
| Kind | not exported | — | Orientation only (once built) |
| Paradigm | not built (thin counters only) | — | Orientation only (once built) |
| Void | substrate, not a destination | rides along on any card above, not built | n/a |

## 5. The Lens gap

`sessionTiersSnapshot` is one running tier stack per chat session (or
project, via `hypergraphScopeId`), not partitioned per source. A Lens
artifact that shows "how does the police report frame this Link
differently than the court filing" needs either scoped tier reads over a
single source's admitted span range, or parallel per-source tier stacks
that get diffed. This is real design work, not plumbing — it hasn't been
attempted yet, and doesn't have a chosen data model.

## 6. Panel shell, cards, and trigger sites

`app/components/terrain-panel.tsx` — a docked, resizable, right-hand
column (modeled on `sidebar.tsx`'s drag mechanics, `--terrain-panel-width`
CSS var), light theme, distinct from the dev-only `.eot-panel` overlay. A
tab strip covers all 8 terrains; Kind/Lens/Paradigm tabs are
enabled-but-honest — clicking one opens `placeholder-card.tsx` in its
permanent gap state rather than doing nothing, so a curious click teaches
the limitation instead of the tab looking broken.

**Trigger sites** — every one funnels into a single `openTerrainCard`
entry point (`chat.tsx`), which owns the panel's nav history (back/forward,
`terrainHistory`/`terrainHistoryIndex`):

1. **Chat citation chips.** `eo-grounding-spans.ts`'s `GroundingSpan[]`
   (one per checkable atom, `sourced`/`owned`/`checking`/`contradicted`) is
   rendered inline over message text via a remark plugin
   (`grounding-chip.tsx`'s `remarkGroundingChips`) — react-markdown's
   `components` prop only overrides real hast elements, not raw text
   nodes, so the plugin mints a synthetic `eo-chip` element via
   `mdast-util-to-hast`'s `data.hName` escape hatch. A `sourced` chip whose
   citation resolves to a corpus ref (`name#start-end`) is clickable, and
   opens the Field card at that exact byte range.
2. **Cross-links inside an open card.** Entity's relation rows → Link;
   Link's subject/object → Entity; Link's "compare framing" → Lens
   (placeholder); Network's node click → Entity. All routed through the
   same `onNavigate`, including hops that land on a placeholder, so nav
   history stays consistent even when what it lands on isn't built yet.

## 7. Annotation semantics — three different things, one visual language

Cards use two accent boxes, matching a low-fi wireframe pass this was
built from: a dashed-blue **callout** (a live/interactive annotation) and a
tan **warn** box (a refusal, gap, or "not authoritative" state). The warn
box in particular covers three genuinely different situations that read
identically in monospace/plain prose but are NOT the same claim:

- **Per-instance data quality** (Entity card): "this specific node hasn't
  been cross-checked against the same entity in another source" — a fact
  about this session's data, not about the software.
- **Build status** (Kind/Paradigm placeholder cards): "this terrain isn't
  exported from the engine yet" — a fact about what's shipped.
- **Design gap** (Lens placeholder card): "this hasn't been designed yet,
  not just unbuilt" — a fact about the roadmap.

Link card's `firstSeenDocId`/`lastSeenDocId` is a fourth, related but
distinct case: not a gap, but a **derived bound** (min/max over the
relation's two endpoint nodes' own first/last-mentioned ticks) rather than
an authoritative per-edge timestamp — the engine's `readTriples` never
timestamps an edge itself. Labeled "seen between X and Y", never "stated on
X".

## 8. Non-goals worth stating explicitly

- **Link's `[1][2][3]` backing-span list is not the same numbering as
  chat's `[Field:n]` citation brackets.** They're namespaced separately on
  purpose — a Link card's span-list indices are local to that card, never
  confusable with a citation chip's own numbering.
- **Kind terrain, full Paradigm content** — no engine export exists.
  Rendered as `placeholder-card.tsx` gap states, never fetched/fake data.
- **Lens cross-source comparison** — unsolved design problem (§5).
  Rendered as a gap state; Link's "compare framing" affordance routes there
  on purpose so the capability is discoverable even while it's not built.
- **Cross-document entity binding** — not implemented (§3).
  `sessionReferents` canonicalizes within one session's graph (which does
  span every document admitted to it), but there's no semantic
  co-reference step across surface forms. The Entity card carries one
  caption line saying so; it does not pretend to a verified mechanism it
  doesn't have.
