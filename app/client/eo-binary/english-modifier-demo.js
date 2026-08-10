// english-modifier-demo.js — a disclosed-scope, English-only fixture that
// tags a small set of common adjectives with a modifier-order class, so
// ./modifier-order.js has something to receive without requiring a live
// model call for every upload.
//
// DISCLOSED SCOPE (eo-constitution CONSTITUTION.md II.13, "the script
// earning test"): this file is English-only, whitespace-tokenized, and
// covers ~50 hand-picked adjectives. It is not a POS tagger, it does not
// handle punctuation-adjacent words, hyphenation, comparatives/superlatives,
// or any language other than English, and it will both miss real modifier
// stacks and mistag borderline words (e.g. "hot" as weather vs. as opinion).
// It exists to give the wiring below something real and testable to call —
// not as a claim that this is how modifier classification should work in
// general. A general solution asks the model itself for the classification,
// the same way eo-discourse.ts already asks it for `entities: string[]`;
// that is future work, tracked separately, not done here.
//
// The rank table itself is the SAME typology eoreader6's
// conformance/modifier-order.test.js uses, with the same named giver — only
// the tagging of individual English words to a class is new here, and it is
// the disclosed part.

export const ENGLISH_DEMO_TYPOLOGY = Object.freeze({
  ranks: Object.freeze({
    purpose: 1,
    material: 2,
    origin: 3,
    color: 4,
    shape: 5,
    age: 6,
    quality: 7,
    size: 8,
    evaluation: 9,
    quantity: 10,
  }),
  direction: "pre",
  giver:
    "Cinque (2010), The Syntax of Adjectives; Scott (2002); Dixon (1982) — rank table as used in eoreader6 conformance/modifier-order.test.js. Word-to-class tagging below is a hand-authored demo fixture, English-only, disclosed per II.13 — not a general lexicon.",
});

// word -> class, lowercase keys only. Deliberately small; see header.
const LEXICON = Object.freeze({
  // quantity
  many: "quantity",
  few: "quantity",
  several: "quantity",
  some: "quantity",
  // evaluation
  beautiful: "evaluation",
  ugly: "evaluation",
  good: "evaluation",
  bad: "evaluation",
  nice: "evaluation",
  lovely: "evaluation",
  wonderful: "evaluation",
  terrible: "evaluation",
  pretty: "evaluation",
  strange: "evaluation",
  odd: "evaluation",
  perfect: "evaluation",
  // size
  big: "size",
  small: "size",
  large: "size",
  tiny: "size",
  huge: "size",
  little: "size",
  // quality / physical property
  fat: "quality",
  thin: "quality",
  heavy: "quality",
  light: "quality",
  hot: "quality",
  cold: "quality",
  wet: "quality",
  dry: "quality",
  hard: "quality",
  soft: "quality",
  smooth: "quality",
  rough: "quality",
  loud: "quality",
  quiet: "quality",
  // age
  old: "age",
  new: "age",
  young: "age",
  ancient: "age",
  modern: "age",
  // shape
  round: "shape",
  square: "shape",
  flat: "shape",
  curved: "shape",
  straight: "shape",
  // color
  black: "color",
  white: "color",
  red: "color",
  blue: "color",
  green: "color",
  yellow: "color",
  brown: "color",
  gray: "color",
  grey: "color",
  orange: "color",
  purple: "color",
  pink: "color",
  // origin
  french: "origin",
  german: "origin",
  italian: "origin",
  chinese: "origin",
  american: "origin",
  british: "origin",
  japanese: "origin",
  russian: "origin",
  // material
  wooden: "material",
  metal: "material",
  plastic: "material",
  glass: "material",
  cotton: "material",
  leather: "material",
  stone: "material",
  paper: "material",
});

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "at",
  "to",
  "and",
  "or",
  "but",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "with",
  "for",
  "as",
  "by",
  "that",
  "this",
  "it",
]);

/**
 * Scans whitespace/punctuation-tokenized English text for runs of two or
 * more consecutive words this fixture's lexicon recognizes, immediately
 * followed by a word it does not (treated as the head noun). Returns them
 * in reading order — direction is fixed to "pre" here because this fixture
 * only ever tags English, and English's linearization direction is
 * disclosed, not assumed general.
 *
 * @param {string} text
 * @returns {Array<{ head: string, tags: Array<{ class: string, surface: string }> }>}
 */
export function extractEnglishModifierStacks(text) {
  const tokens = text.match(/[A-Za-z']+/g) || [];
  const stacks = [];
  let i = 0;
  while (i < tokens.length) {
    const run = [];
    let j = i;
    while (j < tokens.length && LEXICON[tokens[j].toLowerCase()]) {
      run.push(tokens[j]);
      j++;
    }
    if (run.length >= 2 && j < tokens.length) {
      const headWord = tokens[j].toLowerCase();
      if (!STOPWORDS.has(headWord) && !LEXICON[headWord]) {
        stacks.push({
          head: headWord,
          tags: run.map((surface) => ({
            class: LEXICON[surface.toLowerCase()],
            surface,
          })),
        });
        i = j + 1;
        continue;
      }
    }
    i = run.length >= 2 ? j : i + 1;
  }
  return stacks;
}
