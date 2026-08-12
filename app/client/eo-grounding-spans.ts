// eo-grounding-spans.ts — Citey's mechanical grounding layer.
//
// This is not the character talking. Whatever persona generated `content` —
// the default assistant, or a reader-named character with its own
// instruction set — is a separate voice from Citey, who only ever edits: a
// fixed, templated annotator over the finished text, never another model
// call deciding what to say (see npj, https://github.com/clovenbradshaw-
// ctrl/npj, whose own "Citey" mascot the branding here is named after —
// "his voice is templated — there is no model deciding anything").
//
// Every checkable ATOM gets its own span (not one span per sentence) —
// deliberately: a sentence can carry both a name and a number ("The Eiffel
// Tower was completed in 1889"), and if a later resolve pass finds the
// number wrong, that verdict must never visually bleed onto the adjacent,
// correct name by sharing one span with it. Each atom's span is:
//   - "sourced"  — backed by material this turn actually gathered
//                  (web/corpus).
//   - "owned"    — nothing was gathered to check it against, or the atom is
//                  a name (see eo-revision.ts for why names don't get an
//                  asserted verdict) — the character's own assertion, held
//                  as exactly that rather than left silently untagged.
//   - "checking" — a number atom with nothing to check it against yet, but
//                  eligible for the async search+judge pass in chat.ts.
// Computed with zero model/network calls, so it can run on every streamed
// chunk, not just once generation finishes. Nothing here mutates `content`
// — every later resolution (chat.ts's resolve pass) updates a span's own
// fields, never the message string. That is what keeps this immune to the
// duplication bug the older splice-based approach hit under overlapping
// turns.

import {
  splitSentences,
  extractAtoms,
  buildUnionIndex,
  hasWord,
  hasNumber,
  wordSet,
  numberSet,
  type CitationEntry,
} from "./eo-citation-check";

export type GroundingState =
  "sourced" | "echoed" | "owned" | "checking" | "contradicted";

// A multi-token name atom ("Metro Nashville Police Department") doesn't
// have to be all-or-nothing against the union index the way a single-token
// number atom does — reusing the wording of a source closely, without every
// token clearing the bar, is the honest middle state between "sourced" and
// the model's own unchecked wording. Majority, not "any", so a single
// coincidental word match ("the") doesn't earn the tier.
const ECHOED_MIN_TOKEN_FRACTION = 0.5;

export interface GroundingSpan {
  start: number;
  end: number;
  text: string;
  atomKind: "number" | "name";
  state: GroundingState;
  clause?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  correction?: string;
  /** Which of this turn's `citations` (by their own `index`) actually back
   *  a "sourced" span — the merged union index used to DECIDE `state`
   *  can't say which citation(s) it came from, so a chip that wants to open
   *  the right passage needs this checked separately, per citation. Empty
   *  for any span whose state isn't "sourced". */
  supportingCitationIndexes: number[];
}

export function buildGroundingSpans(
  content: string,
  opts: { citations: CitationEntry[]; question?: string },
): GroundingSpan[] {
  const citations = opts.citations ?? [];
  const index = citations.length ? buildUnionIndex(citations) : null;
  const questionWords = wordSet(opts.question || "");

  const spans: GroundingSpan[] = [];
  for (const s of splitSentences(String(content || ""))) {
    for (const atom of extractAtoms(s.text, s.start)) {
      // An atom that merely echoes the reader's own question (see
      // checkGrounding's identical filter) isn't the character asserting
      // anything on its own account — nothing here to grade.
      const echoesQuestion = atom.tokens.every((t) =>
        questionWords.has(t.toLowerCase()),
      );
      if (echoesQuestion) continue;

      let state: GroundingState;
      let supportingCitationIndexes: number[] = [];
      if (index) {
        const matched = atom.tokens.filter((t) =>
          atom.kind === "number"
            ? hasNumber(index.numbers, t)
            : hasWord(index.words, t),
        );
        const supported = matched.length === atom.tokens.length;
        if (supported) {
          state = "sourced";
          // The merged union index only says SOMETHING supports this atom —
          // re-check each citation on its own to say WHICH ones do, so a
          // chip has somewhere real to point.
          supportingCitationIndexes = citations
            .filter((c) => {
              const words = wordSet(c.text);
              const numbers = numberSet(c.text);
              return atom.tokens.every((t) =>
                atom.kind === "number"
                  ? hasNumber(numbers, t)
                  : hasWord(words, t),
              );
            })
            .map((c) => c.index);
        } else if (
          // Only a multi-token atom can partially match — a single-token
          // atom (one bare number, one bare word) is already fully binary
          // between the two branches above.
          atom.tokens.length > 1 &&
          matched.length / atom.tokens.length >= ECHOED_MIN_TOKEN_FRACTION
        ) {
          state = "echoed";
          supportingCitationIndexes = citations
            .filter((c) => {
              const words = wordSet(c.text);
              const numbers = numberSet(c.text);
              const hits = atom.tokens.filter((t) =>
                atom.kind === "number"
                  ? hasNumber(numbers, t)
                  : hasWord(words, t),
              );
              return (
                hits.length / atom.tokens.length >= ECHOED_MIN_TOKEN_FRACTION
              );
            })
            .map((c) => c.index);
        } else state = atom.kind === "number" ? "checking" : "owned";
      } else {
        state = atom.kind === "number" ? "checking" : "owned";
      }

      spans.push({
        start: atom.start,
        end: atom.end,
        text: atom.text,
        atomKind: atom.kind,
        state,
        supportingCitationIndexes,
      });
    }
  }
  return spans;
}
