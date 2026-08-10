// eoreader6 · modifier-order/lens — the modifier-scope lens: reads the
// SEG.narrow events toEvents() mints and projects them into a flat edge
// list. Provenance and discardedTypes are lens/index.js::readLens's own
// job, not reimplemented here — this file declares only what a lens must
// declare (eo-constitution CONSTITUTION.md II.17): a name and which event
// types it reads.

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
