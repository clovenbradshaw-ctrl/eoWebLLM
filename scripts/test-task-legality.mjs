import { test } from "node:test";
import assert from "node:assert/strict";

import {
  coherence,
  createTaskController,
  finishTask,
  nextLegalTask,
  startTask,
} from "../app/client/eo-task-controller.ts";

test("the cube records legal construction; it never classifies task wording", () => {
  const controller = createTaskController([
    { id: "source", goal: "arbitrary model wording" },
    {
      id: "check",
      goal: "equally arbitrary wording",
      dependsOn: ["source"],
    },
  ]);

  assert.equal(nextLegalTask(controller)?.id, "source");
  assert.throws(
    () => startTask(controller, "check"),
    /not the next legal task/,
  );

  startTask(controller, "source");
  finishTask(controller, "source", "received evidence", true);
  assert.equal(nextLegalTask(controller)?.id, "check");
  startTask(controller, "check");
  finishTask(controller, "check", "unsupported", false);

  assert.deepEqual(
    controller.events.map((event) => event.cell.operation),
    ["SEG", "SEG", "CON", "DEF", "EVA", "DEF", "REC", "SYN"],
  );
  assert.deepEqual(
    controller.events.map((event) => event.cell.grain),
    [...Array(7).fill("Figure"), "Pattern"],
  );
});

test("declared construction coordinates must agree with the derived cell", () => {
  assert.equal(
    coherence({
      operation: "CON",
      grain: "Figure",
      stance: "Binding",
      terrain: "Link",
    }).ok,
    true,
  );
  assert.equal(
    coherence({ operation: "CON", grain: "Figure", stance: "Tracing" }).ok,
    false,
  );
});
