// test-priors.mjs — the priors channel's own assay: does it ever do more
// than set a bounded, discrete retrieval hyperparameter.
//
// Two things this file exists to pin down. First, that the induced prior's
// disclosed narrowness (eight ranked tokens, one Alice in Wonderland pocket)
// really does mean silence on ordinary text — a prior that quietly widened
// its own coverage to look more useful would be the exact failure
// eo-priors.ts's header disclaims. Second, that a real touch produces
// exactly one fixed step, never a value that scales with how many stacks
// were found — Assembly C's own acceptance bar (a discrete typed
// re-parameterization event, not a continuous adjustment).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  measurePriorTouch,
  priorHyperparameters,
} from "../app/client/eo-priors.ts";
import { CHANNEL_WARRANT, buildFoldLedger, groundingDemand } from "../app/client/eo-warrant.ts";

test("ordinary prose does not touch the induced prior", () => {
  const touch = measurePriorTouch(
    "What time does the train to Boston leave on Tuesday?",
  );
  assert.equal(touch.stacksFound, 0);
  const hp = priorHyperparameters(touch);
  assert.equal(hp.maxPassagesDelta, 0);
});

test("text built from the prior's own ranked tokens touches it", () => {
  // "mock turtle" — two of INDUCED_MODIFIER_PRIOR's own ranked tokens
  // (modifier-order-induced-prior.js), in the pre-head order it expects.
  const touch = measurePriorTouch("the mock turtle wept by the sea");
  assert.ok(touch.stacksFound >= 1);
  const hp = priorHyperparameters(touch);
  assert.equal(hp.maxPassagesDelta, 1, "the step is fixed, not scaled");
});

test("the step never scales with how many stacks were found", () => {
  const one = priorHyperparameters({
    stacksFound: 1,
    tokensRanked: 8,
    giver: "test",
  });
  const many = priorHyperparameters({
    stacksFound: 40,
    tokensRanked: 8,
    giver: "test",
  });
  assert.equal(one.maxPassagesDelta, many.maxPassagesDelta);
});

test("priors is declared canWarrant:false alongside every other paraphrase channel", () => {
  assert.equal(CHANNEL_WARRANT.priors.canWarrant, false);
  assert.equal(CHANNEL_WARRANT.priors.demandsCheck, false);
});

test("priors alone never demands grounding, but is always forbidden as warrant", () => {
  const ledger = buildFoldLedger({
    priors: { stacksFound: 2, maxPassagesDelta: 1, giver: "test" },
  });
  const demand = groundingDemand(ledger);
  assert.equal(
    demand.required,
    false,
    "consulting priors is not itself a reason to escalate",
  );
  assert.ok(demand.forbidden.includes("priors"));
});

test("priors is never counted as surfaced content, even when it touched something", () => {
  const ledger = buildFoldLedger({
    priors: { stacksFound: 3, maxPassagesDelta: 1, giver: "test" },
  });
  assert.equal(ledger.surfaced, 0);
  assert.equal(ledger.present, 1);
});
