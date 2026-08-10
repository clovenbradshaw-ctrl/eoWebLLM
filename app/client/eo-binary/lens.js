// eoreader6 · lens — reads the event log through a declared projection, at
// a cursor it must name.
//
// Per eo-constitution CONSTITUTION.md II.17 (the lens fidelity test): a
// lens is not refused for selecting — every lens selects, that is what
// makes it a reading rather than the log itself (II.6). It is refused for
// two overclaims: presenting a selection as the whole state, and reading
// without a declared cursor. This module is the shape that satisfies both.
//
// A lens is received, not registered — `readLens(log, lensDef, cursor)`
// takes the lens definition as a plain argument, the same way `verdict()`
// takes a ground and `readTriples()` takes a graph: no module-level mutable
// registry, no hidden state the engine "holds" (III.2 — the engine has no
// clock, no I/O, no randomness, no surface, and holds no prior; a stateful
// singleton registry would be a prior this organ holds). Callers that want
// a named catalog of lenses (referent-identity, kind, relation-graph,
// modifier-scope) own that catalog themselves, as a plain object — the same
// seam graph.js documents for triples: "a video perceiver supplying its own
// triples would not change a line here."
//
// `lensDef.reads` is the declared selection: which event_type(s) this lens
// actually consumes. `readLens` uses it two ways — to filter what reaches
// `project()`, and to report `discardedTypes`, the event types that existed
// in the same slice of the log but this lens did not read. Completeness is
// never implied by omission: a caller holding only `view` cannot tell what
// was left out, but a caller holding the full result always can.
//
// `provenance` traces the view back to the exact events it was built from
// (event_id, tick, event_type) — the same discipline provenance/index.js
// already applies to passage citations, applied here to projections.
//
// Pure: no clock, no randomness, no I/O.

import { gap, isGap } from "./nul.js";
import { asOf } from "./event_log.js";

const isLensDef = (lensDef) =>
  lensDef &&
  typeof lensDef === "object" &&
  typeof lensDef.name === "string" &&
  lensDef.name.trim() !== "" &&
  Array.isArray(lensDef.reads) &&
  lensDef.reads.length > 0 &&
  typeof lensDef.project === "function";

/**
 * Runs `lensDef.project` over the log, sliced to `cursor` and filtered to
 * the event types `lensDef.reads` declares. Refuses (never guesses) on a
 * malformed lens definition or a missing/non-integer cursor.
 */
export const readLens = (log, lensDef, cursor) => {
  if (!lensDef || typeof lensDef !== "object")
    return gap("undeclared", {
      what: "lensDef",
      why: "a lens is received, never assumed",
    });
  if (typeof lensDef.name !== "string" || lensDef.name.trim() === "")
    return gap("undeclared", {
      what: "lensDef.name",
      why: "a lens is named, never anonymous",
    });
  if (!Array.isArray(lensDef.reads) || lensDef.reads.length === 0)
    return gap("undeclared", {
      what: "lensDef.reads",
      why: "a lens declares which event types it reads (II.17) — what it omits is exactly what it discards",
    });
  if (typeof lensDef.project !== "function")
    return gap("undeclared", {
      what: "lensDef.project",
      why: "a lens is a function from events to a view",
    });

  const slice = asOf(log, cursor);
  if (isGap(slice)) return slice;

  const read = slice.filter((e) => lensDef.reads.includes(e.type));
  const discardedTypes = Object.freeze([
    ...new Set(
      slice.filter((e) => !lensDef.reads.includes(e.type)).map((e) => e.type),
    ),
  ]);

  return Object.freeze({
    lens: lensDef.name,
    cursor,
    view: lensDef.project(read),
    reads: Object.freeze([...lensDef.reads]),
    provenance: Object.freeze(
      read.map((e) => ({
        event_id: e.event_id,
        tick: e.tick,
        event_type: e.type,
      })),
    ),
    discardedTypes,
  });
};

export { isLensDef };
