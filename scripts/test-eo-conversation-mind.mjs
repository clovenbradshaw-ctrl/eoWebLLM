// scripts/test-eo-conversation-mind.mjs — verifies app/client/eo-conversation-mind.ts,
// the cross-turn mind wired onto ChatSession (see eoMind in app/store/chat.ts).
//
// The property under test throughout: a claim this conversation could not
// settle survives past the turn that made it — unlike eoLog (a string audit
// trail; see chat.ts's EoLogKind), this stays structured and queryable by
// later code, never just re-readable by a human.
//
// Run: node --experimental-strip-types --test scripts/test-eo-conversation-mind.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createConversationMind,
  restoreConversationMind,
  recordTurn,
  recordRefusal,
  refusals,
  resolveRefusal,
  recordGroundingFindings,
} from "../app/client/eo-conversation-mind.ts";

test("a fresh turn with no shared citations stays a peer and does not promote", () => {
  let mind = createConversationMind();
  ({ mind } = recordTurn(mind, { messageId: "m1", sourceIds: ["doc-a"] }));
  const result = recordTurn(mind, { messageId: "m2", sourceIds: ["doc-b"] });
  assert.equal(result.promoted, false);
  assert.equal(result.depth, 0);
});

test("a turn that shares a citation with a prior one is discovered dependent", () => {
  let mind = createConversationMind();
  ({ mind } = recordTurn(mind, { messageId: "m1", sourceIds: ["doc-a", "doc-b"] }));
  const result = recordTurn(mind, { messageId: "m2", sourceIds: ["doc-b", "doc-c"] });
  assert.equal(result.promoted, true);
  assert.equal(result.depth, 1);
});

test("an uncited turn proposes with no evidence — honest, not a guess", () => {
  let mind = createConversationMind();
  ({ mind } = recordTurn(mind, { messageId: "m1", sourceIds: ["doc-a"] }));
  const result = recordTurn(mind, { messageId: "m2", sourceIds: [] });
  assert.equal(result.promoted, false);
  assert.equal(result.depth, 0);
});

test("a refusal survives every later turn until something resolves it", () => {
  let mind = createConversationMind();
  ({ mind } = recordTurn(mind, { messageId: "m1", sourceIds: ["doc-a"] }));
  mind = recordRefusal(mind, { messageId: "m1", what: "what did the audit actually find?" });

  for (let i = 2; i <= 20; i++) {
    ({ mind } = recordTurn(mind, { messageId: `m${i}`, sourceIds: [`doc-${i}`] }));
  }

  const open = refusals(mind);
  assert.equal(open.length, 1, "a windowed transcript would have lost this nineteen turns ago");
  assert.equal(open[0].what, "what did the audit actually find?");
  assert.equal(open[0].raisedBy, "m1");
});

test("resolving discharges the live fold but never the record", () => {
  let mind = createConversationMind();
  ({ mind } = recordTurn(mind, { messageId: "m1", sourceIds: ["doc-a"] }));
  mind = recordRefusal(mind, { messageId: "m1", what: "was the invoice ever paid?" });
  const [{ id }] = refusals(mind);

  ({ mind } = recordTurn(mind, { messageId: "m2", sourceIds: ["doc-a"] }));
  mind = resolveRefusal(mind, { id, messageId: "m2", answer: "paid 2020-03-04" });

  assert.deepEqual(refusals(mind), []);
  assert.ok(mind.entries.some((e) => e.task_id === id), "the log still shows it was once open");
  assert.ok(mind.entries.some((e) => e.resolved_by === "m2"), "and which turn resolved it");
});

test("a refusal is named by its stance, derived from (operator, grain) — not an invented noun", () => {
  let mind = createConversationMind();
  ({ mind } = recordTurn(mind, { messageId: "m1", sourceIds: ["doc-a"] }));
  mind = recordRefusal(mind, { messageId: "m1", what: "the whole framing is unsupported", grain: "Pattern" });
  mind = recordRefusal(mind, { messageId: "m1", what: "this one figure is uncited", grain: "Figure" });
  mind = recordRefusal(mind, { messageId: "m1", what: "answered from general knowledge", grain: "Ground" });

  assert.deepEqual(
    refusals(mind).map((r) => r.stance).sort(),
    ["Clearing", "Dissecting", "Unraveling"],
  );
});

test("a grounding finding from eo-citation-check.ts arrives as a Figure-grain refusal", () => {
  let mind = createConversationMind();
  ({ mind } = recordTurn(mind, { messageId: "m1", sourceIds: ["doc-a"] }));

  mind = recordGroundingFindings(mind, {
    messageId: "m1",
    findings: [
      {
        kind: "unsupported_claim",
        atomKind: "number",
        text: "revenue tripled",
        absent: ["tripled"],
        start: 0,
        end: 0,
        echoesQuestion: false,
      },
    ],
  });

  const [r] = refusals(mind);
  assert.equal(r.stance, "Dissecting");
  assert.equal(r.what, "revenue tripled");
  assert.match(r.reason, /none of this turn's checked sources/);
});

test("recordGroundingFindings with an empty findings list is a no-op", () => {
  let mind = createConversationMind();
  ({ mind } = recordTurn(mind, { messageId: "m1", sourceIds: ["doc-a"] }));
  const next = recordGroundingFindings(mind, { messageId: "m1", findings: [] });
  assert.deepEqual(refusals(next), []);
});

test("the whole mind survives a JSON round trip through ChatSession's own persistence", () => {
  let mind = createConversationMind();
  ({ mind } = recordTurn(mind, { messageId: "m1", sourceIds: ["doc-a"] }));
  mind = recordRefusal(mind, { messageId: "m1", what: "what is the actual deadline?" });
  ({ mind } = recordTurn(mind, { messageId: "m2", sourceIds: ["doc-a"] }));

  // Exactly what happens when a ChatSession round-trips through localStorage/IndexedDB.
  const restored = restoreConversationMind(JSON.parse(JSON.stringify(mind)));

  assert.deepEqual(refusals(restored), refusals(mind));
  const next = recordTurn(restored, { messageId: "m3", sourceIds: ["doc-a"] });
  assert.equal(next.promoted, true, "the structure it depends on came back with it");
});

test("rehydration re-declares the CURRENT admission set, not whatever was stored", () => {
  // A stored mind whose admits is narrower than what this module admits now
  // -- what every in-flight session looks like the moment the admitted set
  // widens. Pinning it to the stored value would mean a widening never
  // reaches a session already in progress.
  const stale = {
    entries: [{ kind: "propose", task_id: "m1", seq: 0, depends_on: [], evidence: ["doc-a"] }],
    nextSeq: 1,
    admits: ["SEG", "CON", "SYN"],
  };
  const restored = restoreConversationMind(stale);
  const withRefusal = recordRefusal(restored, { messageId: "m1", what: "q" });
  assert.equal(refusals(withRefusal).length, 1);
});

test("restoreConversationMind on nothing gives a usable empty mind", () => {
  const fresh = restoreConversationMind(undefined);
  assert.equal(refusals(fresh).length, 0);
  assert.equal(recordTurn(fresh, { messageId: "m1" }).depth, 0);
});

test("recordRefusal refuses an unattributed or empty item", () => {
  const mind = createConversationMind();
  assert.throws(() => recordRefusal(mind, { what: "q" }), /messageId/);
  assert.throws(() => recordRefusal(mind, { messageId: "m1" }), /what could not be settled/);
});
