// modifier-order-induced-prior.js — a vendored copy of eoreader6's baked
// prior at bin/priors/modifier-order/en-induced.json, embedded as a plain
// JS object literal (not a JSON import) so it bundles identically under
// Next.js's webpack config and under `node --test`, with no import-
// attribute syntax to keep compatible across both.
//
// PLACEMENT, PER eo-constitution CONSTITUTION.md: eoreader6 owns the
// induction MECHANISM (induction/stacks.js et al. — measurement, engine
// territory, I.1) and the baked OUTPUT as staged data (bin/priors/, I.3,
// explicitly marked there "staged for eventual transfer to eoPriors" —
// the same status bin/priors/lang/en.json already carries). This file is
// a second hop: a copy of that staged prior, vendored into the
// application the same pragmatic way every other eoreader6 module under
// ./eo-binary/ already is (graph.js, nul.js, event_log.js, ...) — this
// environment has no live cross-repo package link, so eoWebLLM copies
// rather than imports, for code and data alike. Nothing here computes,
// measures, or amends this data; it is received exactly as baked.
//
// See eoreader6's own file for the full provenance, parameters, and
// disclosed-scope notes (narrow coverage by design, one non-adjective
// pair included and disclosed rather than silently filtered). Keep this
// file's `ranks`/`direction`/`giver`/`classOf` byte-identical to that
// source; do not hand-edit drift in.

export const INDUCED_MODIFIER_PRIOR = Object.freeze({
  ranks: Object.freeze({
    turtle: -1,
    rabbit: -1,
    not: -1,
    hare: -1,
    mock: 1,
    white: 1,
    did: 1,
    march: 1,
  }),
  direction: "pre",
  giver:
    'induced from population "live_priors:pg11_Alice_s_Adventures_in_Wonderland.txt": 4 token pair(s) with a significant (p<0.05) monotonic position within a shared bound stack, over 8 ranked token(s); rank = a Copeland-style score built only from pairs whose relative order cleared significance',
  classOf: Object.freeze({
    turtle: "turtle",
    mock: "mock",
    rabbit: "rabbit",
    white: "white",
    not: "not",
    did: "did",
    hare: "hare",
    march: "march",
  }),
});

/**
 * Scans whitespace/punctuation-tokenized text for runs of 2+ consecutive
 * words this prior ranks, treating the LAST word of a qualifying run as
 * the head (an entity identity string, same role `extractEnglishModifier
 * Stacks`' trailing untagged word plays) and everything before it as the
 * modifier tags — mirroring that function's shape exactly, driven by a
 * measured prior instead of a hand lexicon.
 *
 * DISCLOSED, NOT FILTERED (matches the prior's own notes): this prior's 8
 * tokens include one pair that is real monotonic order but not modifier-
 * noun structure ("did"/"not", verb-phrase negation). This scanner does
 * not know the difference and will tag it exactly like a real modifier
 * pair if it appears in text — the same honest limitation the source
 * prior already discloses, not hidden here by a second, undisclosed
 * filtering rule this scanner would otherwise have to invent.
 *
 * @param {string} text
 * @returns {Array<{ head: string, tags: Array<{ class: string, surface: string }> }>}
 */
export function extractInducedModifierStacks(text) {
  const ranks = INDUCED_MODIFIER_PRIOR.ranks;
  const tokens = text.match(/[A-Za-z']+/g) || [];
  const stacks = [];
  let i = 0;
  while (i < tokens.length) {
    let j = i;
    while (j < tokens.length && tokens[j].toLowerCase() in ranks) j++;
    const runLength = j - i;
    if (runLength >= 2) {
      const run = tokens.slice(i, j);
      const headSurface = run[run.length - 1];
      const modifierSurfaces = run.slice(0, -1);
      stacks.push({
        head: headSurface.toLowerCase(),
        tags: modifierSurfaces.map((surface) => ({
          class: surface.toLowerCase(),
          surface,
        })),
      });
      i = j;
      continue;
    }
    i = runLength >= 1 ? j : i + 1;
  }
  return stacks;
}
