# Chorus log

Append-only. One entry per run. See `.claude/skills/chorus-lint` (or
wherever this session's Chorus skill lives) for the discipline this
enforces: a finding without a real article citation and a real file/line
isn't a finding, and a finding that recurs unrepaired across runs is an
escalation, not a fresh report.

---

## 2026-08-13 — eoreader6/eoWebLLM stability-audit diff

**Scope:** the uncommitted working-tree diff produced by an eoreader/holonic
stability audit — `packages/engine/ground-floor.js` (new) and its six call
sites in eoreader6 (`formation/index.js`, `emergence/fold.js`,
`loops/turn.js`, `loops/atmosphere.js` ×2, `loops/time.js`,
`prediction/candidates.js`), plus `measured: false` additions to
`packages/engine/holon/task-log.js` and `packages/engine/loops/self-holon.js`;
on the eoWebLLM side, `LAWS.md`, `package.json`, and new
`scripts/check-doc-citations.mjs`. Reviewed against
`eo-constitution/CONSTITUTION.md` (Article I.1 governs the eoreader6 diff
directly; the eoWebLLM diff is host/tooling per Article I.4's spirit).

**Method:** ten personas, run independently and in parallel, each given the
full constitution text and both diffs, scoped to their own jurisdiction.
Synthesis pass deduped and dropped anything without a real article + file
citation.

**Verdicts, by persona:**

| Persona | Cell | Verdict |
|---|---|---|
| Diaconis | NUL | Clean — MIN_GROUND consolidation is value-preserving, no fake null/threshold |
| Feynman | DEF | **3 findings, all confirmed real** (see below) |
| Dijkstra | SEG·Field/Link | Clean — no broken import, no drifted constant across the 6 call sites |
| Simon | SEG·Network | **2 findings, confirmed** — `measured` field is unconsumed and its comment misdescribes `holon_level` |
| Frankfurt | INS | **1 finding, confirmed** — check-doc-citations.mjs's NEXT-*.md coverage was a hardcoded sample, not the class its header claimed |
| Ostrom | CON | Clean — surfaced an observation (LAWS.md's non-existence language stronger than the shipped checker's method) but found no article that reaches host-side doc prose |
| Holmes | SIG | Clean — no entity/coreference logic in either diff |
| Pearl | EVA | **1 finding, confirmed** — ground-floor.js's two calibration writeups presented as independent when one reused the other's parameter sets |
| Alexander | SYN | Clean — engine consolidation is well-composed; surfaced (not filed) that check-doc-citations.mjs will always flag LAWS.md's own debunked-citation examples |
| Chekhov | residual | Same finding as Simon (unconsumed `measured` field), duplicate |

**The headline finding (Feynman #1, confirmed independently via `gh api` before any fix landed):** this exact diff's own LAWS.md corrections — which had declared `eoreader6/READING-POLICY.md`, `eoreader6/CLAUDE.md`, `goldens/network/read.mjs`, and `referents/cooccurrence.js::mergeAliasedEntities` "fabricated" or "never existed" — were themselves wrong. All four are real. The root cause: eoreader6 is a git submodule pinned to one commit, this sandboxed environment cannot `git fetch` it (network to github.com is blocked; only `gh` CLI's own API path reaches GitHub), and the audit that produced the "fabricated" verdict checked only the stale local submodule clone (`git log --all`) rather than cross-checking upstream via `gh api`. `READING-POLICY.md` merged to eoreader6 `main` in PR #62, after the pin. `CLAUDE.md`, `goldens/network/read.mjs`, and `cooccurrence.js::mergeAliasedEntities` exist on an open, unmerged PR (#59, `claude/network-cooccurrence-golden`) not yet on `main` at all.

**Verdict: fixed, all of it, same session.**

1. LAWS.md's L4 corrections rewritten to state the true situation (real, upstream-but-not-pinned or real-but-unmerged) instead of the false "fabricated" claim, with an explicit note on the verification failure and why it happened — left in place rather than silently deleted, per this same document's own precedent (SEED.md's Amendment XIX discipline: supersede a falsified claim, don't erase the record of having made it).
2. `scripts/check-doc-citations.mjs` header and final-summary output now explicitly disclose the submodule-staleness limitation and warn against reading MISSING-FILE as "confirmed fabricated" for any eoreader6-rooted citation.
3. Frankfurt's finding fixed in the same pass: NEXT-*.md docs are now discovered dynamically (`readdirSync` + regex) instead of two hardcoded filenames.
4. Simon/Chekhov/Feynman #3: both `measured: false` comments rewritten to drop the false "holon_level sets `measured: true`" claim (it returns a bare string, verified directly against `holon_level/index.js:178-184`) and to say plainly that nothing consumes the field yet — reserved metadata, not a live cross-module contract.
5. Pearl: `ground-floor.js`'s docstring and header softened to stop presenting the two calibration writeups as independently-derived when one reused the other's negative-control parameter sets.

**Not touched:** Ostrom's and Alexander's observations (no article reaches host-side doc prose, per the brief's own instruction not to force an engine-domain article onto host tooling) — left as observations, not findings, consistent with how they were filed.

**Re-verified after fixes:** `npm test` in eoreader6 — same 1018/1020 baseline as before this diff (2 pre-existing, unrelated failures unchanged). `npm run check-docs` in eoWebLLM runs clean against its own (now honestly-disclosed) baseline of 15 known, explained gaps.

---

## 2026-08-13 — eoWebLLM sidebar project-filter feature (SCOPE RULING)

**Maintainer ruling, effective for all future runs:** the Chorus review applies to **engine updates** (eoreader6 and the eoWebLLM reasoning/corpus engine layer). Surface/UX work in eoWebLLM (sidebar layout, navigation state, panels, styling) is explicitly **out of scope** — Chorus findings on it are not gating and are not escalated per the activation rule (Step 3).

**Scope:** the staged project-filter diff — sidebar chat list filtered to the active project, active-project highlighting, store `currentProjectId` syncing (5 files: `chat-list.tsx`, `projects.tsx`, `sidebar.tsx`, `project.tsx`, `chat.tsx`, `store/chat.ts`, `home.module.scss`). Run was done before the ruling; reviewed against `LAWS.md` (L1-L6).

**Method:** ten personas run (independent agents), scoped to the diff.

**Engine-adjacent finding (fixed, kept):** `newSession` stamped a caller-passed `projectId` onto a fresh session before any resolution — if the project had just been deleted, the new chat permanently carried a dead id that silently swallowed its EOT log (`pushEoLog` no-ops) and shared a hypergraph scope with deleted-project orphans. Fixed by resolving before stamping (`resolveProjectId`) and by having `deleteProject` clear `currentProjectId` when it deletes the current project.

**Non-gating UX findings (per the ruling, not escalated):** context-bar exit/sync behavior, header-menu project reassignment syncing, `/new` command project-awareness, ProjectPage null-state message, redundant `setCurrentProjectId` no-op (removed), keyboard activation on the new `role="button"` bars, `/project`-page chat-list duplication. Not logged individually per the ruling; the maintenance fixes themselves are in the same commit.

**Debug logging:** the working tree's unstaged `[RACE]` console.logs in `store/chat.ts`/`webllm.ts` were deliberately left unstaged and out of the commit (not part of the feature diff).
