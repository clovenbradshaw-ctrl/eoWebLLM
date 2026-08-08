// test-gate-systems.mjs — the assay for the two surfs.
//
// The failure this forbids: a "System 2" pass that is the System 1 pass with a
// larger budget. If the second surf cannot surface a rule the first one missed,
// and cannot be told apart from the first by what it hands the model, then the
// split is decoration and the extra latency buys nothing.
//
// Run: node --test scripts/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createInstructionGate,
  parseInstructionFolds,
} from "../app/client/eo-gate.ts";

// A small hand-built corpus rather than the bundled one: these tests are about
// the gate's mechanics, and pinning them to the live instruction set would make
// every upstream fold edit look like a gate regression.
const FOLDS = parseInstructionFolds([
  `---
id: core-identity
title: Identity
always: true
weight: 99
signals: []
fingerprint: who you are
---
You are a careful reader.`,
  `---
id: citation-discipline
title: Citation Discipline
always: false
weight: 50
signals: [figure, figures, percent, statistic, cite, citation]
fingerprint: every figure carries its source
---
Every figure you state carries the source it came from.`,
  `---
id: basque-region
title: Basque Region
always: false
weight: 40
signals: [basque, bilbao, euskadi]
fingerprint: regional naming conventions
---
Use the Basque endonym alongside the Spanish name on first mention.`,
  `---
id: tone-audience
title: Tone
always: false
weight: 10
signals: [tone, register, formal, audience]
fingerprint: match the reader's register
---
Match the reader's register rather than defaulting to institutional prose.`,
]);

const gate = createInstructionGate(FOLDS).gate;

test("System 1 scores the question only — a draft cannot reach it", () => {
  const r = gate({
    question: "Tell me about the city.",
    claims: ["Bilbao grew 12 percent, according to the statistic cited."],
  });
  assert.ok(!r.activeIds.includes("citation-discipline"));
  assert.ok(!r.activeIds.includes("basque-region"));
  assert.equal(r.stats.mode, "system1");
});

test("System 2 surfaces the rule the ANSWER triggered, not the question", () => {
  // The question mentions no figures and no region. The draft does both. This
  // is the whole case for a claim channel: the governing rules were invisible
  // to a scan of the question.
  const r = gate({
    question: "Tell me about the city.",
    claims: ["Bilbao grew 12 percent, according to the statistic cited."],
    mode: "system2",
  });
  assert.ok(
    r.activeIds.includes("citation-discipline"),
    "citation rule must surface from the draft",
  );
  assert.ok(
    r.activeIds.includes("basque-region"),
    "regional rule must surface from the draft",
  );
  assert.equal(r.stats.mode, "system2");
});

test("the two modes hand the model different instructions, not different amounts", () => {
  const one = gate({ question: "Discuss the tone of this passage." });
  const two = gate({
    question: "Discuss the tone of this passage.",
    mode: "system2",
  });
  assert.match(one.systemMessage, /Follow them, and no others/);
  assert.match(two.systemMessage, /An answer already exists/);
  assert.match(two.systemMessage, /whether the answer actually satisfies it/);
});

test("System 2 unfolds what the budget crowded out; System 1 leaves it folded", () => {
  // A budget too small for every matching fold. System 1 must fold one and say
  // so; System 2 must pull it back and name what it pulled.
  const q =
    "What tone and citation style should I use for these figures in Bilbao?";
  const tight = 150;
  const one = gate({ question: q, budgetTokens: tight });
  const two = gate({ question: q, budgetTokens: tight, mode: "system2" });

  assert.ok(
    one.stats.rejectedByBudget > 0,
    "the tight budget must actually crowd something out",
  );
  assert.equal(one.stats.unfoldedIds.length, 0, "System 1 never unfolds");
  assert.ok(
    two.stats.unfoldedIds.length > 0,
    "System 2 must recover a crowded-out fold",
  );
  assert.ok(two.stats.active > one.stats.active);
  // The direction that matters: nothing System 1 dropped for want of budget is
  // still missing after System 2 ran. (The reverse is not required — System 2's
  // longer framing costs tokens of its own, so its first pass can crowd out a
  // fold System 1 seated, and then unfold it.)
  for (const id of one.stats.crowdedOutIds) {
    assert.ok(
      two.activeIds.includes(id),
      `${id} was crowded out and System 2 never recovered it`,
    );
  }
  assert.deepEqual(
    two.stats.crowdedOutIds,
    [],
    "System 2 left a relevant rule unread",
  );
});

test("an unfold raises the ceiling and is not reported as an overflow", () => {
  const q =
    "What tone and citation style should I use for these figures in Bilbao?";
  const two = gate({ question: q, budgetTokens: 150, mode: "system2" });
  assert.ok(two.stats.ceiling > two.stats.budget);
  assert.equal(
    two.stats.overflow,
    0,
    "a deliberate unfold is not a budget violation",
  );
});

test("the unfold is bounded — System 2 spends more, not without limit", () => {
  // A corpus whose matching folds cannot all fit even at the raised ceiling.
  // System 2 must still stop, and must still report what it could not take.
  const wordy = parseInstructionFolds([
    ...["alpha", "beta", "gamma", "delta"].map(
      (name) => `---
id: rule-${name}
title: Rule ${name}
always: false
weight: 10
signals: [${name}]
fingerprint: the ${name} rule
---
${`This rule about ${name} is stated at length so that it costs real budget. `.repeat(12)}`,
    ),
  ]);
  const r = createInstructionGate(wordy).gate({
    question: "alpha beta gamma delta",
    budgetTokens: 200,
    mode: "system2",
  });
  assert.ok(
    r.stats.blockTokens <= r.stats.ceiling,
    "the raised ceiling is still a ceiling",
  );
  assert.ok(
    r.stats.rejectedByBudget > 0,
    "what still did not fit must be reported, not silently dropped",
  );
});

test("every surfaced fold is handed over verbatim in both modes (R1)", () => {
  for (const mode of ["system1", "system2"]) {
    const r = gate({ question: "cite the figures", mode });
    for (const fold of r.surfaced) {
      assert.ok(
        r.systemMessage.includes(fold.body),
        `${fold.id} was not verbatim in the ${mode} block`,
      );
    }
  }
});

test("a turn nothing matches still declares its gap in both modes (R2)", () => {
  for (const mode of ["system1", "system2"]) {
    const r = gate({ question: "Hello.", mode });
    assert.equal(r.stats.gap, true);
    assert.match(r.systemMessage, /NO ADDITIONAL RULES FOR THIS TURN/);
  }
});
