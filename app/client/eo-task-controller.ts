// Browser-safe task controller derived from eochat's eo-cube.js + task-log.js.
//
// The cube is an interface-layer legality check, never a classifier. A model
// may propose task wording, but it never gets to assign a cube cell from that
// wording. The controller records only operations it actually performed:
// SEG for differentiation, CON for dependency binding, and SYN for closure.

export const GRAINS = ["Ground", "Figure", "Pattern"] as const;
export type Grain = (typeof GRAINS)[number];
export type StructureOperation = "SEG" | "CON" | "SYN";
export type Operation =
  "NUL" | "SIG" | "INS" | StructureOperation | "DEF" | "EVA" | "REC";

const OPERATORS: Record<Operation, { mode: string; domain: string }> = {
  NUL: { mode: "Differentiate", domain: "Existence" },
  SIG: { mode: "Relate", domain: "Existence" },
  INS: { mode: "Generate", domain: "Existence" },
  SEG: { mode: "Differentiate", domain: "Structure" },
  CON: { mode: "Relate", domain: "Structure" },
  SYN: { mode: "Generate", domain: "Structure" },
  DEF: { mode: "Differentiate", domain: "Interpretation" },
  EVA: { mode: "Relate", domain: "Interpretation" },
  REC: { mode: "Generate", domain: "Interpretation" },
};

const TERRAIN: Record<string, Record<Grain, string>> = {
  Existence: { Ground: "Void", Figure: "Entity", Pattern: "Kind" },
  Structure: { Ground: "Field", Figure: "Link", Pattern: "Network" },
  Interpretation: { Ground: "Atmosphere", Figure: "Lens", Pattern: "Paradigm" },
};

const STANCE: Record<string, Record<Grain, string>> = {
  Differentiate: {
    Ground: "Clearing",
    Figure: "Dissecting",
    Pattern: "Unraveling",
  },
  Relate: { Ground: "Tending", Figure: "Binding", Pattern: "Tracing" },
  Generate: { Ground: "Cultivating", Figure: "Making", Pattern: "Composing" },
};

export interface CubeCell {
  operation: Operation;
  grain: Grain;
  mode: string;
  domain: string;
  terrain: string;
  stance: string;
}

export function cellFor(operation: Operation, grain: Grain): CubeCell {
  const op = OPERATORS[operation];
  if (!op)
    throw new TypeError(`unknown cube operation ${JSON.stringify(operation)}`);
  if (!GRAINS.includes(grain))
    throw new TypeError(`unknown cube grain ${JSON.stringify(grain)}`);
  return Object.freeze({
    operation,
    grain,
    mode: op.mode,
    domain: op.domain,
    terrain: TERRAIN[op.domain][grain],
    stance: STANCE[op.mode][grain],
  });
}

export function coherence(input: Partial<CubeCell>): {
  ok: boolean;
  cell: CubeCell | null;
  reason: string | null;
} {
  if (!input.operation || !input.grain) {
    return {
      ok: true,
      cell: null,
      reason: "an operation and grain are both required to derive a cell",
    };
  }
  try {
    const cell = cellFor(input.operation, input.grain);
    for (const key of ["terrain", "stance"] as const) {
      if (input[key] != null && input[key] !== cell[key]) {
        return {
          ok: false,
          cell: null,
          reason: `${key} ${JSON.stringify(input[key])} disagrees with ${operationLabel(cell)}`,
        };
      }
    }
    return { ok: true, cell, reason: null };
  } catch (err) {
    return { ok: false, cell: null, reason: (err as Error).message };
  }
}

function operationLabel(cell: CubeCell) {
  return `${cell.operation}.${cell.grain}`;
}

export interface TaskDefinition {
  id: string;
  goal: string;
  dependsOn?: string[];
}

export interface TaskRecord extends TaskDefinition {
  status: "pending" | "running" | "completed" | "held";
  result?: string;
  // Why a task was held rather than completed. A task held by its own failed
  // review is `review-held`; a task held only because a prerequisite was held
  // is `prerequisite-held:<id>`. The reason is what makes re-entry legal —
  // `reopenHeldTask` un-holds dependents held only by the reopened task.
  heldReason?: string;
  // Holonic nesting: a running task MAY open its own sub-plan, itself a
  // full TaskController with its own SEG/CON/.../SYN closure. A task is a
  // whole (its own controller closes it) and can also be a part (one
  // record in a PARENT controller's own task list) -- the same holon
  // shape at every depth, not a special case at depth 0.
  subplan?: TaskController;
}

export interface TaskEvent {
  seq: number;
  kind:
    | "clearing"
    | "propose"
    | "bind"
    | "start"
    | "complete"
    | "hold"
    | "reopen"
    | "close"
    | "descend"
    | "ascend";
  taskId?: string;
  cell: CubeCell;
  detail: string;
}

export type HaltReason = "operational-closure" | "open-gaps-remain";

export interface TaskController {
  tasks: TaskRecord[];
  events: TaskEvent[];
  closed: boolean;
  // Why the controller stopped. `operational-closure`: nothing is open and
  // nothing is held. `open-gaps-remain`: held refusals keep `closed` false by
  // design — the same halt the engine's `produce()` draws, where an unanswered
  // refusal is a real outcome, never a deletion.
  halted_by: HaltReason;
}

function uniqueId(id: string, used: Set<string>) {
  const base =
    id
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "task";
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base}-${n++}`;
  used.add(candidate);
  return candidate;
}

function event(
  controller: TaskController,
  kind: TaskEvent["kind"],
  cell: CubeCell,
  detail: string,
  taskId?: string,
) {
  controller.events.push({
    seq: controller.events.length,
    kind,
    cell,
    detail,
    taskId,
  });
}

/**
 * Admit a proposed task set without trusting it as an execution order. Task
 * ids and dependency references are normalized, cycles are rejected, and the
 * controller records only the SEG/CON actions it actually performed.
 */
export function createTaskController(
  definitions: TaskDefinition[],
): TaskController {
  const controller: TaskController = {
    tasks: [],
    events: [],
    closed: false,
    halted_by: "operational-closure",
  };
  // NUL · Void · Clearing — the E. coli methylation reset. Every branch opens
  // by erasing its own baseline so the next difference is measurable against a
  // rebuilt nothing. The fold begins with a cleared ground, one event, one
  // cell, no second mechanism. It is the first event of every controller.
  event(
    controller,
    "clearing",
    cellFor("NUL", "Ground"),
    "ground cleared — a fresh baseline for this branch",
  );
  const used = new Set<string>();
  const aliases = new Map<string, string>();
  for (const definition of definitions.slice(0, 6)) {
    const id = uniqueId(definition.id, used);
    aliases.set(definition.id, id);
    controller.tasks.push({
      id,
      goal: String(definition.goal || "")
        .trim()
        .slice(0, 500),
      dependsOn: [],
      status: "pending",
    });
    event(
      controller,
      "propose",
      cellFor("SEG", "Figure"),
      "controller differentiated a task",
      id,
    );
  }
  for (let i = 0; i < controller.tasks.length; i++) {
    const raw = definitions[i]?.dependsOn ?? [];
    const deps = [
      ...new Set(
        raw
          .map((dep) => aliases.get(dep) ?? dep)
          .filter((dep) =>
            controller.tasks.some(
              (t) => t.id === dep && t.id !== controller.tasks[i].id,
            ),
          ),
      ),
    ];
    controller.tasks[i].dependsOn = deps;
    if (deps.length)
      event(
        controller,
        "bind",
        cellFor("CON", "Figure"),
        `controller bound ${deps.length} prerequisite(s)`,
        controller.tasks[i].id,
      );
  }
  if (hasCycle(controller.tasks))
    throw new TypeError("task plan has a dependency cycle");
  if (!controller.tasks.length) controller.closed = true;
  return controller;
}

function hasCycle(tasks: TaskRecord[]) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): boolean => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? [])
      if (visit(dep)) return true;
    visiting.delete(id);
    done.add(id);
    return false;
  };
  return tasks.some((t) => visit(t.id));
}

/** The only executable task is one whose real prerequisites have completed. */
export function nextLegalTask(controller: TaskController): TaskRecord | null {
  if (controller.closed) return null;
  return (
    controller.tasks.find(
      (task) =>
        task.status === "pending" &&
        task.dependsOn!.every(
          (id) =>
            controller.tasks.find((t) => t.id === id)?.status === "completed",
        ),
    ) ?? null
  );
}

export function startTask(
  controller: TaskController,
  taskId: string,
): TaskRecord {
  const task = nextLegalTask(controller);
  if (!task || task.id !== taskId)
    throw new TypeError(
      `task ${JSON.stringify(taskId)} is not the next legal task`,
    );
  task.status = "running";
  event(
    controller,
    "start",
    cellFor("DEF", "Figure"),
    "controller opened a defined task for work",
    task.id,
  );
  return task;
}

/**
 * Descend: a running task opens its own sub-plan, a full TaskController
 * nested one holon-level deeper. `INS · Existence · Ground` -- generating a
 * fresh, undifferentiated existence-ground for the sub-plan to differentiate
 * into its own tasks (the SAME act `createTaskController`'s own "propose"
 * loop performs one grain up, at Figure). Declared by STRUCTURE (a task is
 * currently running, and has not already descended), never by reading the
 * task's own text -- the cube stays a legality check, not a classifier.
 */
export function openSubplan(
  controller: TaskController,
  taskId: string,
  definitions: TaskDefinition[],
): TaskController {
  const task = controller.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "running")
    throw new TypeError(`task ${JSON.stringify(taskId)} is not running`);
  if (task.subplan)
    throw new TypeError(
      `task ${JSON.stringify(taskId)} already has an open sub-plan`,
    );
  const subplan = createTaskController(definitions);
  task.subplan = subplan;
  event(
    controller,
    "descend",
    cellFor("INS", "Ground"),
    `controller opened a sub-plan of ${subplan.tasks.length} task(s)`,
    task.id,
  );
  return subplan;
}

export function finishTask(
  controller: TaskController,
  taskId: string,
  result: string,
  accepted: boolean,
) {
  const task = controller.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "running")
    throw new TypeError(`task ${JSON.stringify(taskId)} is not running`);
  // A whole is not done until its parts are: a task that descended into its
  // own sub-plan cannot be marked completed while that sub-plan still has
  // open work. A rejected task (accepted=false) may still drop with an open
  // sub-plan -- dropping abandons the branch, it does not claim it closed.
  if (accepted && task.subplan && !task.subplan.closed)
    throw new TypeError(
      `task ${JSON.stringify(taskId)} cannot complete: its sub-plan has not closed`,
    );
  // Ascend: the return from a closed sub-plan, back up to the task that
  // opened it. `REC · Interpretation · Ground` -- CUBE.md's own second
  // validated cell ("unravel the frame, return and cultivate... witness
  // happens on the return"), the exact shape of folding a closed whole back
  // up as a part of what comes next, reused rather than a new cell invented
  // for the occasion.
  if (accepted && task.subplan && task.subplan.closed) {
    event(
      controller,
      "ascend",
      cellFor("REC", "Ground"),
      "controller returned from a closed sub-plan",
      task.id,
    );
  }
  // Witness gate: ink or hold, never drop. A task whose result failed review
  // is HELD — the result is kept on record, censored, and re-enterable via
  // `reopenHeldTask`. `REC · Figure`: the return with witness, not the bin.
  // A difference that made no difference is not testimony, and a refusal is a
  // result, never a deletion.
  if (accepted) {
    task.status = "completed";
    task.result = result;
    task.heldReason = undefined;
    event(
      controller,
      "complete",
      cellFor("EVA", "Figure"),
      "task result passed review",
      task.id,
    );
  } else {
    task.status = "held";
    task.result = result;
    task.heldReason = "review-held";
    event(
      controller,
      "hold",
      cellFor("REC", "Figure"),
      "task result held — censored, not erased: witness on return",
      task.id,
    );
  }
  // A dependent task cannot legally execute after a prerequisite was held. It
  // is HELD too — not killed. A held branch is a living gap that re-entry can
  // reopen; the reason records exactly which prerequisite holds it.
  let changed = true;
  while (changed) {
    changed = false;
    for (const pending of controller.tasks.filter(
      (candidate) => candidate.status === "pending",
    )) {
      const blocking = pending.dependsOn!.find(
        (id) =>
          controller.tasks.find((candidate) => candidate.id === id)?.status ===
          "held",
      );
      if (blocking) {
        pending.status = "held";
        pending.result = "not run: a prerequisite did not pass review";
        pending.heldReason = `prerequisite-held:${blocking}`;
        event(
          controller,
          "hold",
          cellFor("REC", "Figure"),
          `task held because a prerequisite was held (${blocking})`,
          pending.id,
        );
        changed = true;
      }
    }
  }
  // Closure, engine-flavoured: a controller with no open task but a held gap
  // is NOT closed — `halted_by` reports the refusal the way
  // eoreader6/packages/engine/holon/task-log.js's `produce()` reports it
  // ("open-gaps-remain" keeps `closed` false by design).
  if (
    controller.tasks.every(
      (t) => t.status === "completed" || t.status === "held",
    )
  ) {
    const heldGaps = controller.tasks.filter((t) => t.status === "held");
    controller.closed = heldGaps.length === 0;
    controller.halted_by = heldGaps.length
      ? "open-gaps-remain"
      : "operational-closure";
    event(
      controller,
      "close",
      cellFor("SYN", "Pattern"),
      heldGaps.length
        ? "operational closure with held gaps — refusals remain open"
        : "operational closure — no open task remains",
    );
  }
}

/**
 * Re-enter a held task (REC — reset is the point, witness on return). The
 * held task returns to `pending`, and any dependent held only by it
 * (`prerequisite-held:<id>`) returns to `pending` too. A task held by its own
 * review stays held until it is explicitly reopened; a prerequisite that is
 * still held keeps its dependents held.
 */
export function reopenHeldTask(controller: TaskController, taskId: string) {
  const task = controller.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "held")
    throw new TypeError(`task ${JSON.stringify(taskId)} is not held`);
  task.status = "pending";
  task.heldReason = undefined;
  event(
    controller,
    "reopen",
    cellFor("REC", "Figure"),
    "held task re-entered — the reset that returns, witness on return",
    task.id,
  );
  controller.closed = false;
  controller.halted_by = "operational-closure";
  let changed = true;
  while (changed) {
    changed = false;
    for (const held of controller.tasks.filter((t) => t.status === "held")) {
      const reason = held.heldReason;
      if (!reason || !reason.startsWith("prerequisite-held:")) continue;
      const prereqId = reason.slice("prerequisite-held:".length);
      const prereq = controller.tasks.find((t) => t.id === prereqId);
      if (!prereq || prereq.status !== "held") {
        held.status = "pending";
        held.heldReason = undefined;
        changed = true;
      }
    }
  }
}

/**
 * Recurses into every open sub-plan: a holon's own audit is not complete
 * while a part of it, at any depth, is left unchecked. `path` names the
 * descent so a nested incoherence or incomplete task is reported against
 * where it actually lives, not folded up as if it were the top level's own.
 */
export function controllerAudit(
  controller: TaskController,
  path: string[] = [],
): {
  closed: boolean;
  halted_by: HaltReason;
  legalNext: string | null;
  incomplete: string[];
  held: string[];
  incoherent: { seq: number; reason: string | null; path: string[] }[];
} {
  const incoherent = controller.events.flatMap((e) => {
    const check = coherence(e.cell);
    return check.ok ? [] : [{ seq: e.seq, reason: check.reason, path }];
  });
  const incomplete = controller.tasks
    .filter((t) => t.status === "pending" || t.status === "running")
    .map((t) => [...path, t.id].join("/"));
  // Held gaps are audited, not hidden: a refusal is a result.
  const held = controller.tasks
    .filter((t) => t.status === "held")
    .map((t) => [...path, t.id].join("/"));

  for (const task of controller.tasks) {
    if (!task.subplan) continue;
    const nested = controllerAudit(task.subplan, [...path, task.id]);
    incoherent.push(...nested.incoherent);
    incomplete.push(...nested.incomplete);
    held.push(...nested.held);
  }

  return {
    closed: controller.closed,
    halted_by: controller.halted_by,
    legalNext: nextLegalTask(controller)?.id ?? null,
    incomplete,
    held,
    incoherent,
  };
}
