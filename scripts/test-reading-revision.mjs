// scripts/test-reading-revision.mjs — verifies buildReading's new
// revision routing: an existing ledger (log.tick > 0) resolves fresh
// SEG.narrow candidates against what's already there via
// modifier-order-revision.js's resolveAgainstLedger, minting SEG.revise
// events on genuine disagreement and nothing on agreement. A fresh log
// (every call site before this change, and every case in
// scripts/test-reading-eot.mjs) is unaffected.
//
// Run: node --test scripts/test-reading-revision.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { createLog, tick } from "../app/client/eo-binary/event_log.js";
import { buildReading } from "../app/client/reading-pipeline.js";

test("a fresh log (the default) produces no revisions, and buildReading returns the log itself and its starting cursor", () => {
  const result = buildReading("I saw the fat black cat.");
  assert.deepEqual(result.revisions, []);
  assert.ok(result.log);
  assert.equal(result.log.tick, result.reading.cursor);
  assert.equal(result.cursorBeforeThisRun, 0);
});

test("cursorBeforeThisRun reflects the ledger's tick count at the start of THIS run, not the end", () => {
  const log = createLog();
  const first = buildReading("I saw the fat black cat.", { log });
  assert.equal(first.cursorBeforeThisRun, 0);
  const tickAfterFirst = first.log.tick; // snapshot -- `log` is shared/mutated by the next call

  const second = buildReading("So they went up to the Mock Turtle.", { log });
  assert.equal(second.cursorBeforeThisRun, tickAfterFirst);
  assert.ok(second.log.tick > second.cursorBeforeThisRun);
});

test("a genuine ledger disagreement mints exactly one SEG.revise event, carrying the right supersedes/prior fields", () => {
  const log = createLog();
  const first = buildReading("I saw the fat black cat.", { log });
  assert.equal(first.revisions.length, 0);

  const priorEvent = log.events.find(
    (e) => e.type === "SEG.narrow" && e.subject === "cat::black" && e.object === "cat",
  );
  assert.ok(priorEvent, "expected a SEG.narrow tick for cat::black -> cat");
  assert.equal(priorEvent.class, "color");

  // Simulate a stale/conflicting prior claim already sitting in the
  // ledger for the same node -- e.g. what an earlier typology version
  // might have ticked.
  const staleTick = tick(log, {
    type: "SEG.narrow",
    subject: "cat::black",
    object: "cat",
    class: "shape",
    polarity: "+",
  });

  const second = buildReading("I saw the fat black cat.", { log });
  assert.equal(second.revisions.length, 1);
  assert.equal(second.revisions[0].subject, "cat::black");
  assert.equal(second.revisions[0].class, "color");
  assert.equal(second.revisions[0].priorClass, "shape");
  assert.ok(second.revisions[0].event_id);

  const reviseEvents = log.events.filter((e) => e.type === "SEG.revise");
  assert.equal(reviseEvents.length, 1);
  assert.equal(reviseEvents[0].supersedes, staleTick.event_id);
});

test("re-reading identical text against the same ledger mints no revisions, but the ledger still records the confirming check", () => {
  const log = createLog();
  const first = buildReading("I saw the fat black cat.", { log });
  const tickAfterFirstRead = log.tick;
  const narrowCount = first.reading.lenses.find((l) => l.terrain === "Link").view.length;

  const second = buildReading("I saw the fat black cat.", { log });
  assert.equal(second.revisions.length, 0, "agreement is not a revision");
  assert.ok(log.tick > tickAfterFirstRead, "the master log is append-only -- a confirming check is still a real tick");

  const confirmEvents = log.events.filter((e) => e.type === "SEG.confirm");
  assert.equal(confirmEvents.length, narrowCount, "one SEG.confirm per node the second read re-checked and agreed with");
  assert.ok(confirmEvents.every((e) => e.confirms));

  // the Link-terrain view (MODIFIER_SCOPE_LENS only reads SEG.narrow) is
  // unaffected -- confirmations are ledger history, not narrowing edges.
  const linkLens = second.reading.lenses.find((l) => l.terrain === "Link");
  assert.equal(linkLens.view.length, narrowCount);
});

test("a revision does not remove or alter the original ledger entry -- both stay in the log", () => {
  const log = createLog();
  const first = buildReading("I saw the fat black cat.", { log });
  const priorEvent = log.events.find(
    (e) => e.type === "SEG.narrow" && e.subject === "cat::black" && e.object === "cat",
  );
  tick(log, { type: "SEG.narrow", subject: "cat::black", object: "cat", class: "shape", polarity: "+" });
  const staleTick = log.events[log.events.length - 1];
  buildReading("I saw the fat black cat.", { log });

  // every event ever ticked is still present, unmodified
  assert.ok(log.events.includes(priorEvent));
  assert.ok(log.events.includes(staleTick));
  const revise = log.events.find((e) => e.type === "SEG.revise");
  assert.equal(revise.supersedes, staleTick.event_id);
});
