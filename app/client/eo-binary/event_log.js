import { gap, isGap } from "./nul.js";

const hash = (str) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

// `.type` — not `.event_type` — matching the vocabulary every real producer
// already uses (perceiver/text/admit.js, perceiver/text/surfaces.js,
// loops/level.js) and every existing conformance test already asserts on
// (presence.test.js, loops.test.js). This log had drifted onto its own
// field name with no test pinning it and exactly one caller
// (scripts/problem-corpus.mjs, fixed alongside this change) — corrected
// here rather than left as a second, incompatible convention.
export const tick = (log, event) => {
  if (!event || typeof event !== "object")
    return gap("empty_material", { reason: "no event" });
  if (!event.type) return gap("undeclared", { what: "type" });

  const entry = Object.freeze({
    ...event,
    tick: log.tick,
    event_id: hash(`${event.type}:${log.tick}:${JSON.stringify(event)}`),
  });
  log.events.push(entry);
  log.tick++;
  return entry;
};

export const createLog = () => {
  const log = { events: [], tick: 0 };
  return log;
};

export const replay = (log) => log.events;

export const findByType = (log, eventType) =>
  log.events.filter((e) => e.type === eventType);

/**
 * The log as of a named cursor. `cursor` is required and never defaulted
 * to "now" — per eo-constitution CONSTITUTION.md II.17 (the lens fidelity
 * test), a read of this log names its position in it or it is an
 * undeclared clock. "As of this cursor" and "as of whenever this happened
 * to run" are different claims; only the caller who names the cursor gets
 * to make the first one.
 *
 * `cursor` is a COUNT, not a tick index: it means "the first `cursor`
 * events," so `e.tick < cursor` — half-open, like `Array.prototype.slice`.
 * This is deliberate, not the more obvious `e.tick <= cursor`: `log.tick`
 * already means "how many events exist so far" (it's the tick the NEXT
 * append will receive), so `asOf(log, log.tick)` captured once means
 * "everything as of now" SAFELY even if the caller appends more events to
 * the same log afterward — a later event always lands at tick >= the old
 * `log.tick`, never inside the captured slice. An inclusive `<=` cursor
 * does not have this property: a cursor equal to `log.tick` would silently
 * absorb whatever event happens to land at exactly that tick next, turning
 * a "before I appended more" snapshot into a moving target. A caller who
 * genuinely wants the latest state must still say so explicitly —
 * `asOf(log, log.tick)` — never by omission.
 */
export const asOf = (log, cursor) => {
  if (!log || !Array.isArray(log.events))
    return gap("empty_material", { reason: "no log" });
  if (!Number.isInteger(cursor) || cursor < 0)
    return gap("undeclared", {
      what: "cursor",
      why: "a slice of the log is taken as of a named cursor, never defaulted (II.17)",
    });
  return Object.freeze(log.events.filter((e) => e.tick < cursor));
};
