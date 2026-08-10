// eoreader6 · reading — composes multiple named lenses, each declaring its
// own terrain (CUBE.md's nine: Void/Entity/Kind, Field/Link/Network,
// Atmosphere/Lens/Paradigm), into one projection at one shared cursor.
//
// This is the pure-data shape a "read" of a document actually is: not one
// lens's view, but however many terrains a caller has real projections for,
// each still traceable to its own provenance and its own declared/discarded
// event types (eo-constitution CONSTITUTION.md II.17). What this module
// does NOT do — and per Article I.4/III.2 must not do — is render anything.
// No EOT syntax, no surface, no clock, no I/O. Turning a reading into an
// EOT `reader` surface is application work (I.4: the engine owns no
// interface); this stops at the plain object a host can render however it
// needs to.
//
// Only Entity/Link-terrain lenses exist in this engine today
// (referent-identity, modifier-scope). Atmosphere (the reading's own mood
// or register — discourse/index.js's motifs and topic stack are the
// nearest existing organ, not yet wired as a lens) and Paradigm (a reading
// REVISED, not just read — REC territory, a different act than this
// module's) are named in TERRAINS so the shape does not have to be
// redesigned when they arrive. A reading with no lens on a given terrain
// simply omits it, and that omission is visible in `terrains` — never
// silently implied as "there is nothing there."

import { gap, isGap } from "./nul.js";
import { readLens } from "./lens.js";

export const TERRAINS = Object.freeze([
  "Void",
  "Entity",
  "Kind",
  "Field",
  "Link",
  "Network",
  "Atmosphere",
  "Lens",
  "Paradigm",
]);

/**
 * `lenses`: an array of `{ lensDef, terrain }`. `terrain` is received, not
 * inferred — a lens no more knows its own terrain than a triple knows what
 * its own verb means; that's placement knowledge, the same discipline II.2
 * already applies to material knowledge, applied here to where a
 * projection sits on the grid. Runs every lens over the SAME log at the
 * SAME cursor, so the whole reading is internally consistent — no lens
 * sees a different moment than another.
 */
export const readDocument = (log, lenses, cursor) => {
  if (!Array.isArray(lenses) || lenses.length === 0)
    return gap("undeclared", {
      what: "lenses",
      why: "a reading is composed of named lenses, received, never assumed",
    });

  const byTerrain = {};
  const results = [];
  for (const entry of lenses) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !TERRAINS.includes(entry.terrain)
    )
      return gap("undeclared", {
        what: "terrain",
        why: "every lens in a reading names its own terrain (one of the nine), received not inferred",
      });
    const r = readLens(log, entry.lensDef, cursor);
    if (isGap(r)) return r;
    results.push(Object.freeze({ terrain: entry.terrain, ...r }));
    (byTerrain[entry.terrain] ??= []).push(r.lens);
  }

  return Object.freeze({
    cursor,
    terrains: Object.freeze(
      Object.fromEntries(
        Object.entries(byTerrain).map(([k, v]) => [k, Object.freeze(v)]),
      ),
    ),
    lenses: Object.freeze(results),
  });
};
