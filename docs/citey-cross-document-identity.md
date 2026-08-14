# Cross-document identity — what it means for two sources to talk about the same thing

A living design doc. Records a chase through three repository generations, what
was found already built, and the policy that falls out. Precondition for
[`citey-fact-check-policy.md`](citey-fact-check-policy.md): **nothing in that
doc is safe until this one is settled**, because a diff over wrongly-merged
referents produces confident nonsense.

Verified against fresh clones on 2026-08-13 — `eoreader6` at HEAD,
`eoreader4.2` (legacy, frozen per constitution I.2), and this repo. Paths below
were read, not recalled.

## 0. The ontology

**Every source creates its own universe of referents.** Document A's "Smith" is
`A::Smith` — a commitment made by *A's reading*, not a thing in the world.
Document B's "Smith" is `B::Smith`. Neither is "the real Smith"; both are
readings pointing at something outside themselves.

So `A::Smith ≡ B::Smith` is **a third assertion, belonging to neither
universe.** It is not found in A, not found in B, and not established by the
fact that both spell it the same way. It is a claim about two readings, and by
P2 it needs its own warrant like any other claim.

This is why string keying is not a shortcut but a category error. It answers a
question about the world by comparing two documents' *spelling conventions*.

### The asymmetry that makes it tractable

**Distinctness is decidable. Identity is not.**

Two mechanisms, in two repository generations, arrived at this independently:

`identityByConsequence` (`eoreader6/packages/engine/referents/consequence.js`)
tests two surfaces through **segregation** (are their arrivals concentrated in
different stretches of the reading, more than a random same-size split would
be?) and **displacement** (does B's evidence disturb A's ground more than an
arbitrary same-size addition would?). Its three outcomes:

- both gates real → **DISTINCT** — "refuted as one"
- neither real → **CONSISTENT** — *"never asserted proven"*
- mixed or ungrounded → **UNSTABLE** — *"the honest middle, never forced either way"*

Its own header states the rule this doc is named after:

> **THE NAMELESS-REFERENT PRINCIPLE** means that question is never answered by
> comparing the strings. No stem table, no edit distance, no transliteration.
> Not even here.

and the reason confirmation is unavailable:

> refuting is this codebase's only mode of confidence (EVA: "speak only of what
> changed the ground")

`pickReferent` (`legacy-eoreader4.2/src/rooms/reader/wiki-referent.js`) aligns a
document's referent to an *external* one and reaches the same shape from the
other side: `confirmed`, `disconfirmed`, or neither.

**So superposition is not a waiting room.** It is the permanent default. A
binding leaves it in exactly two ways: refuted (split, on evidence) or attested
(collapsed, on testimony). Never by inference from similarity.

## 1. What is already built

### 1.1 Within one reading — by arrival shape

`identityByConsequence`, above. Merges surfaces that a driver never said were
the same — Finnish case inflection (`Juhani / Juhanin / Juhania`), Chinese
given-name alternation (`寶玉 / 賈寶玉`), Greek declension — **without comparing
strings**.

Its own recorded refusal is worth carrying: the first design asked whether the
*union* of two surfaces' arrivals cleared the same birth condition a single
surface must. On the Finnish cast fixture that produced a false positive —
two different brothers pooled together looked as admissible as one brother's
own halves — because *"the birth condition tests for SIGNIFICANCE, not
IDENTITY, and the two are not the same question."*

And its measured limit: on an ensemble cast that is on-page together for nearly
the whole book, the segregation gate has weak power. It *"mainly proves the
'consistent' side honestly, not the 'distinct' side."*

### 1.2 Across universes — by shared specific neighbours

`pickReferent` is the cross-universe aligner, and it was tested on exactly the
case this doc exists for. From `legacy-eoreader4.2/tests/wiki-referent.test.js`:

> `pickReferent` REFUSES Elizabeth I of England for a fictional Elizabeth in
> Pride and Prejudice
>
> The bare label "Elizabeth" plus a Regency-novel graph (Darcy, Bennet,
> Wickham, Collins) must never confirm the historical Queen: her article shares
> none of the graph's specific proper names, and generic kinship/royal words
> ("daughter", "sister", "queen") **are not corroboration**.

Four design decisions in it are the ones worth carrying forward:

1. **Confirmation requires corroboration, never a name match.**
   `corroborated = sharedProperNames >= 1 || sharedStrongTerms >= 1`. A perfect
   spelling match with zero shared referents does not confirm.
2. **Disconfirmation is first-class and positive.** Zero shared names against a
   graph rich enough to judge, *while the candidate article names its own
   specific referents*, is evidence of **difference** — not merely absence of
   evidence for sameness.
3. **A judgeability gate.** `canJudge = proper.size >= 3`. Below that the graph
   cannot support a verdict and none is issued. "Cannot tell" is a state.
4. **Generic terms are excluded by construction.** `GENERIC_NAMES` strips
   kinship, royal, org-type, geographic and calendar words, because *"they
   collide across unrelated topics"* — a solar "corporation" and a security
   "corporation" corroborate nothing.

## 2. Lookup is what resolves MNPD

The gap §3 of [`citey-structured-grounding.md`](citey-structured-grounding.md)
records — `MNPD` and `Metro Nashville Police Department` as two separate nodes
— is not solvable from the documents alone. Neither one says they are the same.

**It is solvable by looking it up.** And a looked-up definition is not
inference — it is a source that *states* the identity, which makes the binding
citable rather than guessed. `web` is `canWarrant: true` in `eo-warrant.ts`, so
this satisfies P2 rather than bending it:

> MNPD ≡ Metro Nashville Police Department — asserted by ⟨source⟩, span ⟨n–m⟩

That is a Field span in a looked-up document. The binding becomes a claim with
a citation, revisable if the citation is challenged, and auditable by the same
machinery as any other claim.

This also retires a hardcoded workaround. `eo-citation-check.ts`'s
`ABBREV_EXPANSIONS` is seven English office roles (`ceo`, `coo`, `cfo`, `cto`,
`cio`, `cmo`, `vp`) — the "we could not look it up, so we enumerated a few"
version of exactly this problem, and English-only besides. Lookup generalises
it and removes a language-bound closed set (II.20).

**Sources are not interchangeable, and the distinction is warrant-relevant:** an
encyclopedia entry asserts a fact about a specific referent; a dictionary
asserts a fact about a *word*. "MNPD stands for…" is a lexical claim; "the
Metro Nashville Police Department is the agency that…" is a referential one.
Both can warrant a binding, and the report should say which was used.

**And lookup must run through `pickReferent`'s corroboration gate, not around
it.** Searching "Elizabeth" and taking the top result is the failure that test
exists to prevent. The lookup supplies *candidates*; the document's own
neighbour graph decides among them, or declines.

## 3. The policy

**I1 — Identity across sources is a claim, and needs warrant.** Not a key, not
an optimisation. It gets the same discipline as any other claim.

**I2 — Superposition is the default, and it is permanent.** Candidate bindings
are held, declared, and uncollapsed. An unresolved binding is a *typed gap*
(II.5, "type error before null"), never a silent merge and never a silent
split.

**I3 — Four bases, and only two collapse.**

| basis | what it is | collapses? |
|---|---|---|
| **stated** | the material itself asserts the identity | **yes** — Field |
| **attested** | a looked-up source asserts it, cited to a span | **yes** — `web`/`file`, citable |
| **given** | a human asserts it, named giver via `injectPrior` | **yes** — attributed, revisable |
| **shape** | `identityByConsequence`: arrival-shape consistency | no — orientation |
| **surface** | the strings match | no — orientation, weakest |

The bottom two are today's silent default. They may raise a candidate; they may
never establish one.

**I4 — Refutation is the only decidable direction.** DISTINCT is earned;
CONSISTENT is "not refuted" and stays revisable forever. A mechanism that
reports "same" with confidence is reporting something it cannot know.

**I5 — Never score a binding.** No "0.8 likely the same person." Report the
bases in parallel — *surface matches; arrival shapes differ; no source states
equivalence* — and let the disagreement stand as the finding. This is P1
(II.8, no averaging of grounds) applied to identity.

**I6 — Judgeability is reported, not assumed.** `canJudge` is a real state. A
graph too thin to support a verdict yields no verdict, and says so — distinct
from "checked and found different."

## 4. What this makes of the diff

`diffLinkViews`'s `defaultIdentify` is `` `${e.subject}␟${e.object}` `` — pure
string, no scope. Under this policy it needs two changes, and the second is the
one this doc exists for:

1. Key on `(subject, verb, object)` so a magnitude change lands in `changed`
   (**inflate**) rather than splitting into a false invent/omit pair.
2. **Key within a source universe, and resolve across universes only through a
   declared binding.** Without this, edges from different documents collide by
   construction and every cross-document diff inherits it — regardless of how
   good the key's shape is.

## 5. What is buildable, and what is blocked

| piece | status |
|---|---|
| `pickReferent` — cross-universe alignment with corroboration + disconfirmation | **exists**, `eoreader4.2`, legacy and frozen (I.2) — a migration, like eochat's search |
| Web/dictionary lookup to supply candidates | **shipping now** — the relay landed this session |
| `identityByConsequence` — arrival-shape consistency | **exists** in `eoreader6`, **not exported** through `packages/host/index.js` |
| Binding as a typed, warranted, revisable record | **not built** — the real work |
| Per-source scoping in `diffLinkViews` | **not built**, small |

`identityByConsequence` is in the same position `kinds.js` is: real, working,
and with no path out of the engine. It needs an `attachIdentity` /
`sessionBindings` pair mirroring `attachGraph`/`sessionGraphSnapshot` — the
same shape §2 of the structured-grounding doc already prescribes for Kind, and
the same reason to scope both together if either is picked up.

## 6. Non-goals

- **No merge on string match.** Ever, in any language. The nameless-referent
  principle is not advice.
- **No confidence score on a binding.** I5.
- **No lookup taken at face value.** Candidates go through corroboration;
  "Elizabeth" is the test case and it must keep failing to bind.
- **No claim that consistency is identity.** `CONSISTENT` means "not
  distinguished by this evidence" and must never render as "same".
- **No assumption that this doc's mechanisms are omnilingual.** Arrival shape
  and shared-neighbour corroboration do not depend on case or script, which
  removes one barrier. Whether the *extraction* feeding them is language-neutral
  is separate, measured elsewhere, and not settled here.
