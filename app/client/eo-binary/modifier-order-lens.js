// eoreader6 · modifier-order/lens — the modifier-scope lens: reads the
// SEG.narrow events toEvents() mints and projects them into a flat edge
// list. Provenance and discardedTypes are lens/index.js::readLens's own
// job, not reimplemented here — this file declares only what a lens must
// declare (eo-constitution CONSTITUTION.md II.17): a name and which event
// types it reads.

import { key as foldKey } from "./modifier-order-revision.js";

export const MODIFIER_SCOPE_LENS = Object.freeze({
  name: "modifier-scope",
  reads: Object.freeze(["SEG.narrow"]),
  project: (events) =>
    events.map((e) =>
      Object.freeze({
        subject: e.subject,
        object: e.object,
        class: e.class,
        polarity: e.polarity,
      }),
    ),
});

// MODIFIER_SCOPE_CURRENT_LENS — eoWebLLM-local, NOT vendored from
// eoreader6 (eoreader6's own modifier-order/lens.js has no equivalent):
// SEG.revise and SEG.confirm are this app's own addition
// (modifier-order-revision.js), for a ledger that can be re-read against
// itself. MODIFIER_SCOPE_LENS above still lists every historical
// SEG.narrow tick, unfolded — exactly what a caller wants for "what did
// this document's first read find." This lens instead folds the whole
// append-only trail (narrows, revisions, confirmations alike) down to one
// edge per (subject, object) — whichever ticked last — which is what a
// caller wants for "what does this ledger currently say," per this
// codebase's own discipline that projecting/folding is never the
// ledger's own job (see modifier-order-revision.js's header).
export const MODIFIER_SCOPE_CURRENT_LENS = Object.freeze({
  name: "modifier-scope-current",
  reads: Object.freeze(["SEG.narrow", "SEG.revise", "SEG.confirm"]),
  project: (events) => {
    const latest = new Map();
    for (const e of events) latest.set(foldKey(e.subject, e.object), e);
    return Object.freeze(
      [...latest.values()].map((e) =>
        Object.freeze({
          subject: e.subject,
          object: e.object,
          class: e.class,
          polarity: e.polarity,
          revised: e.type === "SEG.revise",
          event_id: e.event_id,
          supersedes: e.supersedes ?? null,
        }),
      ),
    );
  },
});
