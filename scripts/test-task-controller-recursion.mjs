// scripts/test-task-controller-recursion.mjs — verifies eo-task-controller.ts's
// holonic nesting: a task may open its own sub-plan (a full nested
// TaskController), completion is gated on that sub-plan's closure, and the
// descend/ascend transitions land on declared, structurally-governed cube
// cells -- never derived from a task's own text (the discipline CUBE.md's
// own header insists on: "an interface-layer legality check, never a
// classifier").
//
// Run: node --experimental-strip-types --test scripts/test-task-controller-recursion.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTaskController,
  startTask,
  finishTask,
  openSubplan,
  controllerAudit,
  coherence,
} from "../app/client/eo-task-controller.ts";

test("a task cannot complete while its sub-plan is still open", () => {
  const top = createTaskController([{ id: "research", goal: "research the topic" }]);
  startTask(top, "research");
  openSubplan(top, "research", [{ id: "gather", goal: "gather sources" }]);
  assert.throws(
    () => finishTask(top, "research", "premature", true),
    /sub-plan has not closed/,
  );
});

test("a task CAN complete once its sub-plan closes, and drop is never blocked by an open sub-plan", () => {
  const top = createTaskController([{ id: "research", goal: "research the topic" }]);
  startTask(top, "research");
  const sub = openSubplan(top, "research", [{ id: "gather", goal: "gather sources" }]);
  startTask(sub, "gather");
  finishTask(sub, "gather", "gathered", true);
  assert.equal(sub.closed, true, "precondition: the sub-plan is fully closed");

  finishTask(top, "research", "done", true);
  assert.equal(top.tasks[0].status, "completed");

  // The drop path is not gated on subplan closure -- abandoning a branch
  // does not claim it finished.
  const top2 = createTaskController([{ id: "research", goal: "research the topic" }]);
  startTask(top2, "research");
  openSubplan(top2, "research", [{ id: "gather", goal: "gather sources" }]);
  assert.doesNotThrow(() => finishTask(top2, "research", "abandoned", false));
  assert.equal(top2.tasks[0].status, "dropped");
});

test("descend/ascend land on the declared cells, structurally, never guessed from task text", () => {
  const top = createTaskController([{ id: "research", goal: "research the topic" }]);
  startTask(top, "research");
  openSubplan(top, "research", [{ id: "gather", goal: "gather sources" }]);
  const sub = top.tasks[0].subplan;
  startTask(sub, "gather");
  finishTask(sub, "gather", "gathered", true);
  finishTask(top, "research", "done", true);

  const descend = top.events.find((e) => e.kind === "descend");
  const ascend = top.events.find((e) => e.kind === "ascend");
  assert.ok(descend && ascend, "both transitions fired");
  assert.deepEqual(
    { op: descend.cell.operation, grain: descend.cell.grain },
    { op: "INS", grain: "Ground" },
  );
  // REC · Interpretation · Ground -- CUBE.md's own second validated cell
  // ("unravel the frame, return and cultivate"), reused rather than a new
  // cell invented for this occasion.
  assert.deepEqual(
    { op: ascend.cell.operation, grain: ascend.cell.grain },
    { op: "REC", grain: "Ground" },
  );
  assert.equal(ascend.cell.domain, "Interpretation");
  assert.equal(ascend.cell.stance, "Cultivating");

  // Every event on this controller, at every depth, is a real cube cell --
  // coherence() never refuses one of this file's OWN declared transitions.
  for (const e of top.events) assert.equal(coherence(e.cell).ok, true, `${e.kind} produced an incoherent cell`);
});

test("recursion nests to arbitrary depth, and a task can be re-entered as its own holon", () => {
  const top = createTaskController([{ id: "a", goal: "level 1" }]);
  startTask(top, "a");
  const l2 = openSubplan(top, "a", [{ id: "b", goal: "level 2" }]);
  startTask(l2, "b");
  const l3 = openSubplan(l2, "b", [{ id: "c", goal: "level 3" }]);
  startTask(l3, "c");
  finishTask(l3, "c", "done", true);
  assert.equal(l3.closed, true);
  finishTask(l2, "b", "done", true);
  assert.equal(l2.closed, true);
  finishTask(top, "a", "done", true);
  assert.equal(top.closed, true);
});

test("controllerAudit recurses into every open sub-plan and reports incompletes by their real path", () => {
  const top = createTaskController([{ id: "research", goal: "research the topic" }]);
  startTask(top, "research");
  openSubplan(top, "research", [
    { id: "gather", goal: "gather sources" },
    { id: "write", goal: "write it up", dependsOn: ["gather"] },
  ]);
  const sub = top.tasks[0].subplan;
  startTask(sub, "gather");
  finishTask(sub, "gather", "gathered", true);
  // "write" is left pending on purpose -- the sub-plan, and therefore the
  // whole tree, is not closed yet.

  const audit = controllerAudit(top);
  assert.equal(audit.closed, false);
  // Both the top-level task (still "running" -- it never finished) and the
  // nested pending one are incomplete; the nested one is reported at its
  // real path, not folded up as if it belonged to the top level.
  assert.deepEqual(audit.incomplete, ["research", "research/write"]);
  assert.deepEqual(audit.incoherent, []);
});

test("openSubplan refuses a task that is not currently running, and refuses a second descent", () => {
  const top = createTaskController([{ id: "research", goal: "research the topic" }]);
  // Not started yet -- still "pending".
  assert.throws(() => openSubplan(top, "research", [{ id: "x", goal: "x" }]), /is not running/);

  startTask(top, "research");
  openSubplan(top, "research", [{ id: "x", goal: "x" }]);
  assert.throws(
    () => openSubplan(top, "research", [{ id: "y", goal: "y" }]),
    /already has an open sub-plan/,
  );
});
