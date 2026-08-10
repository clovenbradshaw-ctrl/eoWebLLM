// eoWebLLM · reading-diff — app-original (not vendored from eoreader6),
// kept out of reading.js on purpose: that module's own header scopes it
// to composing lenses "at one shared cursor." Comparing a ledger's state
// at two different named cursors is a distinct act, given its own small,
// narrowly-scoped file, the same convention modifier-order-lens.js
// already follows for a lens declaration.
//
// Nothing about event_log.js/lens.js/reading.js stops calling them twice
// at different cursors on the same log -- `cursor` is already a required,
// named parameter throughout (eo-constitution CONSTITUTION.md II.17).
// This module is what makes doing that, and comparing the results,
// convenient and pure.

import { gap, isGap } from "./nul.js";
import { readDocument } from "./reading.js";

/**
 * Reads the same log through the same lenses at every named cursor in
 * `cursors` — `[{ name, cursor }, ...]`, named per II.17, never bare
 * integers a caller might confuse for each other. Returns one named
 * reading per cursor, in the order given.
 */
export const readAtCursors = (log, lenses, cursors) => {
  if (!Array.isArray(cursors) || cursors.length === 0)
    return gap("undeclared", {
      what: "cursors",
      why: "named cursors are received, never assumed",
    });

  const readings = [];
  for (const c of cursors) {
    if (!c || typeof c.name !== "string" || c.name.trim() === "")
      return gap("undeclared", {
        what: "cursors[].name",
        why: "each cursor a reading is taken at is named, never anonymous",
      });
    const r = readDocument(log, lenses, c.cursor);
    if (isGap(r)) return r;
    readings.push(Object.freeze({ name: c.name, ...r }));
  }
  return Object.freeze(readings);
};

const defaultIdentify = (e) => `${e.subject}␟${e.object}`;

/**
 * Pure diff between two Link-terrain (or any lens) views: which edges
 * are new in `viewB`, which are gone (present in `viewA`, absent from
 * `viewB`), which changed class/polarity, and which are unchanged.
 * `identify` lets a caller override how an edge is keyed; defaults to
 * (subject, object), matching modifier-order-revision.js's own key.
 */
export const diffLinkViews = (viewA, viewB, identify = defaultIdentify) => {
  const a = new Map(viewA.map((e) => [identify(e), e]));
  const b = new Map(viewB.map((e) => [identify(e), e]));

  const added = [];
  const changed = [];
  const unchanged = [];
  for (const [k, eb] of b) {
    const ea = a.get(k);
    if (!ea) {
      added.push(eb);
    } else if (ea.class !== eb.class || ea.polarity !== eb.polarity) {
      changed.push({
        subject: eb.subject,
        object: eb.object,
        from: ea,
        to: eb,
      });
    } else {
      unchanged.push(eb);
    }
  }
  const removed = [...a].filter(([k]) => !b.has(k)).map(([, e]) => e);

  return Object.freeze({
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    changed: Object.freeze(changed),
    unchanged: Object.freeze(unchanged),
  });
};
