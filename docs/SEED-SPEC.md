# Spec — the seed, enacted in the app

> Status: ratified 2026-08-11. Drives the deltas in §2. Each delta names the
> files it touches and the conformance test that pins it, in the spirit of
> `LAWS.md` — a fix does not stick unless something on record says the old
> behavior was wrong on purpose rather than just old.

This spec translates one conversation into code. The conversation asked, in
sequence: what the fold is as a primitive that grows on itself; what the
prior art is for seed-and-grow; what changes without a broader consciousness
in charge; how the plan evolves when no single model prompt ever holds the
whole; and what the seed itself is. The answer that emerged, grounded in the
EO Lexical Analysis v2 corpus and the existing engine (`eoreader6/SEED.md`,
`eoreader6/CUBE.md`), was **stigmergy** (Grassé 1959: the termites never meet,
they read the mound) and a five-item seed. This app is the mound.

The engine already says it in `eoreader6/SEED.md`:

> The system may perceive anything. It may speak only of what changed the ground.

The app already says it in `app/client/eo-grounding.ts`:

> mechanical, auditable signals are exhausted before a model is asked to judge
> anything.

This spec makes the *app's* control structure enact the seed instead of merely
describing it. It is deliberately narrow: five deltas, each small, each with a
test, each one removing a place where the app currently acts like a single
consciousness holding everything.

## 1. The seed being encoded

Five items, stated once so the deltas can reference them by number.

1. **Medium — the ledger is the only global object.** No conscience is in
   charge. The log of what was proposed, bound, witnessed, and held is the
   only thing any worker reads, and workers never meet. Stigmergy: the
   coordination is in the artifact, not in a conductor.
2. **Fold — a bounded read produces a scored candidate spectrum; a DEF
   null-gate admits only the pencil.** Each step reads a neighborhood, not the
   whole, and proposes (pencil) only what survived the refusal gate. Proposals
   are drafts, not decisions.
3. **Witness — an EVA null-gate inks or holds; it never drops.** A figure
   that failed its gate is *held*: censored, kept on record, re-enterable on a
   later pass — never erased, never silently discarded. A difference that made
   no difference is not testimony; a refusal is a result, not a deletion.
4. **Lift — a recurring validated composition becomes a citeable unit.** When
   the same operator-composition closes and validates more than once, it is
   lifted as a subroutine the system may reuse — the fold growing on itself.
5. **Horizon law — no operation reads the whole.** Every read names its
   neighborhood and its budget, and whatever was withheld is reported, never
   silent. The reach of the present is a declared number, not a default.

Supporting doctrine carried along:

- **Plan is sediment, not authorship.** A plan is the projection of what the
  ledger has already accumulated — never a single call that reads the whole
  request and emits the whole graph.
- **Gates are statistics, not judges.** Acceptance and refusal are computed
  locally against declared grounds, never pronounced by a model holding the
  whole. Where the app already has a mechanical gate (`evaluateCompliance`),
  it stays; the model proposes wording, the mechanism decides legality.
- **Hierarchy is discovered, not assigned.** Levels come from the dependency
  structure that the work itself produced (`depends_on`), and a pair that
  passes no test is a peer, which is an answer, not a missing one.
- **Two seed cells.** `NUL · Void · Clearing` — the E. coli methylation reset:
  the engine continuously erases its own baseline so the next difference is
  measurable against a rebuilt nothing. `REC · Interpretation · Ground` —
  reset is the point; witness happens on the return. The deltas below land on
  exactly these two cells and no invented ones.

The app's current control structure violates the seed in four concrete places,
all inside the System 2 task path (`app/store/chat.ts` lines ~1116–1144 →
`app/client/eo-task-plan.ts` → `app/client/eo-task-controller.ts`):

- **Plan as authorship.** `TASK_PLANNER_PROMPT` asks one call to read the whole
  request and emit the whole 2–6 task graph before any work begins.
- **Drop, not hold.** A task whose result fails review is `dropped`, and its
  dependents are cascade-`dropped` — erased from the turn, unreported.
- **No horizon on the mouth.** The synthesis context is fed every completed
  task result with no stated budget and no withheld count.
- **No lift.** A composition that closes and validates is discarded, not
  registered as a reusable unit.

## 2. Deltas

### Δ1 — Hold, never drop (the witness gate)

**Where:** `app/client/eo-task-controller.ts`.

**What:**
- The `dropped` task status and `drop` event are removed. A task whose result
  fails the gate becomes **`held`**: its result is kept (`result`), a
  `heldReason` records whether it was held by its own review or by a
  prerequisite, and the event is a **`hold`** on `REC · Figure` — *the return
  with witness, not the bin*.
- Dependents of a held task are **held**, not killed: `prerequisite-held:<id>`.
- A held task is re-enterable via `reopenHeldTask` (event `reopen` on
  `REC · Figure`), which un-holds the dependents that were held only by it.
- Closure distinguishes the two engine halts: `halted_by` is
  `"operational-closure"` when nothing is open and nothing is held, and
  `"open-gaps-remain"` when held refusals keep closure false — the exact
  distinction `eoreader6/packages/engine/holon/task-log.js`'s `produce()`
  already draws (`open-gaps-remain` keeps `closed` false by design).
- `controllerAudit` reports held tasks as `held: string[]` — gaps are audited,
  not hidden.

**Conformance:** `scripts/test-task-controller-recursion.mjs` (updated) plus the
new `hold`/`reopen`/`halted_by` cases. The old assertions that a failed review
produces `dropped` are replaced by `held` assertions; a `drop` anywhere is now
a compile-time error.

### Δ2 — Plan as sediment: fold-as-plan

**Where:** `app/client/eo-task-plan.ts`.

**What:** `defineTaskPlan` stops asking for the whole graph in one call. It
becomes a fold loop: at each step it proposes **the next task only**, given the
reader request and the current live-task projection (ids + goals, bounded), and
the proposal may depend only on ids already live in that projection. The
controller re-validates every incremental proposal; a cycle or empty proposal
is refused and the fold stops. The plan is whatever the ledger accumulated —
sediment, not authorship.

**Conformance:** `scripts/test-horizon-law.mjs` — a fake `generate` drives the
fold; assertions cover: proposals stop on `{"tasks":[]}`, each step's prompt
carries only live ids (never the whole plan), a ghost dependency is normalized
to nothing by the controller, a cycle is refused without throwing, and the fold
never exceeds `maxSteps` — so no single call ever holds more than the horizon.

### Δ3 — The horizon law: the mouth budget

**Where:** `app/client/eo-grounding.ts` (new primitive), `app/client/eo-task-plan.ts`
(use it).

**What:** `foldToMouth(ranked, { k })` — the same mouth the engine already has
(`foldToWorkingSet`, `k` default 7, the top of the 4–7 Ericsson–Kintsch LTWM
range): returns `{ working, withheld, withheld_ids }`. **Withheld is reported,
never silent.** The System 2 synthesis context is capped through this mouth
(`k = 4`), with the withheld count named in the material handed to the
synthesizer.

**Conformance:** `scripts/test-horizon-law.mjs` — `foldToMouth` is bounded for
arbitrarily large input, reports `withheld`/`withheld_ids`, and refuses
`k < 1`.

### Δ4 — The lift rule: citeable validated compositions

**Where:** `app/client/eo-lift.ts` (new), `app/store/chat.ts` (wire).

**What:** a pure registry keyed by the **signature** of a controller's event
cell-sequence (`operator.grain` pairs in order — the shape of the work, never
its content). When a controller closes with `halted_by === "operational-closure"`
and its signature is witnessed a second time, the composition is **lifted**:
a citeable unit (`{ signature, count, first_seen, last_seen }`). This is the
fold growing on itself — the operator composition becoming a subroutine. The
caller owns persistence; the module is pure.

**Conformance:** `scripts/test-lift.mjs` — signature is content-independent
(two controllers with different goals but the same event cells share a
signature), first witness reports no unit, second witness lifts, and held
(not closed) controllers never lift.

### Δ5 — `NUL · Void · Clearing`: the baseline reset

**Where:** `app/client/eo-task-controller.ts`.

**What:** `createTaskController` opens each branch with a **`clearing`** event
on `NUL · Ground` — the present is re-zeroed so the next difference is
measurable. This is the E. coli methylation reset: the engine erases its own
baseline continuously, and every new branch clears the ground it will fold
against. It is one event, one cell, no second mechanism.

**Conformance:** the recursion test asserts the first event of every controller
is the `clearing` event on `NUL · Void · Clearing`, and every event on every
controller is a coherent cube cell.

## 3. What this spec deliberately does NOT do

- **It does not resurrect the 27-cell as a classifier.** `CUBE.md` says the
  cube is an interface-layer legality check, never a classifier; the corpus
  study showed the 27-cell claim collapses under word-shuffle (95.7% of cells
  unchanged). Every cell used here is declared by a structural transition the
  controller itself performed, never guessed from a task's text.
- **It does not add a coordination prompt.** There is no "here is everything
  so far, what next" call anywhere in the deltas. `getMessagesWithMemory`'s
  PAST DISCOURSE fold stays a bounded paraphrase that can orient but cannot
  ground (`CHANNEL_GROUNDING.discourse`).
- **It does not turn the gates into model judges.** Acceptance stays
  mechanical where the repo made it mechanical; the model proposes wording,
  the controller decides legality, and refusal produces a held gap that is
  reported, not a verdict.
- **It does not port.** Every delta is a re-earning inside this app, in the
  shape the app already earns things: a pure module, a declared budget, a test.

## 4. Conformance run

```
node --experimental-strip-types --test \
  scripts/test-task-controller-recursion.mjs \
  scripts/test-horizon-law.mjs \
  scripts/test-lift.mjs \
  scripts/test-grounding.mjs
```

All green, all the time. A delta that breaks the run is not a delta.
