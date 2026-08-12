// eo-lift.ts — the lift rule: a recurring, validated composition of operator
// cells becomes a citeable unit. The fold grows on itself: when the same
// structural shape of work closes and validates more than once, it is lifted
// as a subroutine the system may reuse.
//
// The signature is the SHAPE of the work, never its content: the ordered
// sequence of `operator.grain` pairs over the controller's own event log.
// Two controllers whose events land on the same cells share a signature no
// matter what the goals said — which is the point, and also the discipline:
// this is a composition of operations, not a re-reading of any task's text
// (the cube stays a legality check, never a classifier).
//
// The module is pure: the caller owns the registry's lifecycle and any
// persistence. `witnessLift` returns a lifted unit only once the same
// signature has been witnessed more than once AND the caller has said the
// closure was validated — a controller with held gaps is a refusal, and a
// refusal is a result, but it is not a unit to lift.

import type { TaskController } from "./eo-task-controller";

export type LiftSignature = string;

export interface LiftRecord {
  signature: LiftSignature;
  /** How many times this shape has closed validly. */
  count: number;
  first_seen: number;
  last_seen: number;
}

export interface LiftRegistry {
  records: Record<LiftSignature, LiftRecord>;
}

export function createLiftRegistry(): LiftRegistry {
  return { records: {} };
}

/**
 * The canonical signature of a controller's work: the ordered
 * `operator.grain` pairs of every event it actually performed. Nothing
 * content-bearing survives — no task ids, no goals, no details.
 */
export function liftSignature(controller: TaskController): LiftSignature {
  return controller.events
    .map((e) => `${e.cell.operation}.${e.cell.grain}`)
    .join(">");
}

/**
 * Witness one validated closure of a shape. Returns the record always; the
 * `unit` field is non-null once the shape has been seen twice — that is the
 * lift. `now` is the caller's clock, injected so this stays pure and
 * deterministic in tests.
 */
export function witnessLift(
  registry: LiftRegistry,
  signature: LiftSignature,
  { now }: { now: number },
): { unit: LiftRecord | null; isNew: boolean } {
  const prev = registry.records[signature];
  const isNew = !prev;
  const record: LiftRecord = {
    signature,
    count: (prev?.count ?? 0) + 1,
    first_seen: prev?.first_seen ?? now,
    last_seen: now,
  };
  registry.records[signature] = record;
  return { unit: record.count >= 2 ? record : null, isNew };
}

/**
 * The gate the lift rule is bound to: a composition lifts only when it
 * CLOSED VALIDLY — nothing open, nothing held. A controller with held gaps is
 * a refusal, and a refusal is a result but it is not a unit to lift. Returns
 * null (and witnesses nothing) when the controller is not fully closed.
 */
export function liftIfValidated(
  registry: LiftRegistry,
  controller: TaskController,
  { now }: { now: number },
): { unit: LiftRecord | null; isNew: boolean } {
  if (!controller.closed || controller.halted_by !== "operational-closure") {
    return { unit: null, isNew: false };
  }
  return witnessLift(registry, liftSignature(controller), { now });
}
