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
import type { StatedFact } from "./eo-memory";

export type GroundingState =
  "sourced" | "echoed" | "owned" | "checking" | "contradicted";

// A multi-token name atom ("Metro Nashville Police Department") doesn't
// have to be all-or-nothing against the union index the way a single-token
// number atom does — reusing the wording of a source closely, without every
// token clearing the bar, is the honest middle state between "sourced" and
// the model's own unchecked wording. Majority, not "any", so a single
// coincidental word match ("the") doesn't earn the tier.
const ECHOED_MIN_TOKEN_FRACTION = 0.5;

export type GroundingOriginChannel =
  "desk" | "internal" | "discourse" | "hypergraph";

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
  /** Best-effort attribution of an "owned" atom to the channel it likely
   *  came from, when one is identifiable — never a certainty claim. Unset
   *  keeps the atom as plain, unattributed "owned" (the honest default).
   *  See eo-grounding-spans.ts's originChannel note below for the matching
   *  rules and the honesty constraint on how this may be phrased. */
  originChannel?: GroundingOriginChannel;
}

export function buildGroundingSpans(
  content: string,
  opts: {
    citations: CitationEntry[];
    question?: string;
    /** This turn's desk facts (see eo-memory.ts) — an "owned" atom that
     *  matches one is attributed `desk`, since a reader-stated fact is more
     *  trustworthy-looking than an unconfirmed guess, not equally uncertain. */
    statedFacts?: StatedFact[];
    /** The plain-text discourse fold summary this turn's prompt actually
     *  carried, if any — `canWarrant: false` in eo-warrant.ts, so a match
     *  here only ever flags a possible echo, never a source. */
    discourseText?: string;
    /** The drafted hypergraph "thought" string this turn's prompt actually
     *  carried, if any — same `canWarrant: false` standing as discourse. */
    hypergraphText?: string;
    /** GroundingDemand.required for this turn (see eo-warrant.ts) — false
     *  means nothing external bore on the question at all, the only
     *  condition under which a residual "owned" atom may be attributed
     *  `internal` rather than left unattributed. */
    externalRequired?: boolean;
  },
): GroundingSpan[] {
  const citations = opts.citations ?? [];
  const index = citations.length ? buildUnionIndex(citations) : null;
  const questionWords = wordSet(opts.question || "");

  // Origin-channel attribution for "owned" atoms — desk first (most
  // trustworthy), then the two forbidden channels (a possible echo of
  // something that was never evidence), then the internal residual. Built
  // once per call, not per atom, since none of it depends on the atom.
  const deskWords = wordSet(
    (opts.statedFacts ?? []).map((f) => f.text).join(". "),
  );
  const deskNumbers = numberSet(
    (opts.statedFacts ?? []).map((f) => f.text).join(". "),
  );
  const discourseWords = wordSet(opts.discourseText || "");
  const discourseNumbers = numberSet(opts.discourseText || "");
  const hypergraphWords = wordSet(opts.hypergraphText || "");
  const hypergraphNumbers = numberSet(opts.hypergraphText || "");

  const matchFraction = (
    tokens: string[],
    kind: "number" | "name",
    words: Set<string>,
    numbers: Set<string>,
  ): number => {
    if (!tokens.length || (!words.size && !numbers.size)) return 0;
    const hits = tokens.filter((t) =>
      kind === "number" ? hasNumber(numbers, t) : hasWord(words, t),
    );
    return hits.length / tokens.length;
  };

  const originChannelFor = (
    tokens: string[],
    kind: "number" | "name",
  ): GroundingOriginChannel | undefined => {
    if (
      matchFraction(tokens, kind, deskWords, deskNumbers) >=
      ECHOED_MIN_TOKEN_FRACTION
    )
      return "desk";
    if (
      matchFraction(tokens, kind, discourseWords, discourseNumbers) >=
      ECHOED_MIN_TOKEN_FRACTION
    )
      return "discourse";
    if (
      matchFraction(tokens, kind, hypergraphWords, hypergraphNumbers) >=
      ECHOED_MIN_TOKEN_FRACTION
    )
      return "hypergraph";
    if (opts.externalRequired === false) return "internal";
    return undefined;
  };

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
        originChannel:
          state === "owned"
            ? originChannelFor(atom.tokens, atom.kind)
            : undefined,
      });
    }
  }
  return spans;
}

/**
 * Correct the merged index's over-crediting from a parallel report.
 *
 * `buildGroundingSpans` decides `state` against ONE union index built from
 * every citation of every ground. That union can only ever over-credit: an
 * atom carried by any single ground reads as backed, even when the ground the
 * sentence is actually about does not carry it. It is the same merge
 * `checkGroundsInParallel` exists to refuse, and until now the panel refused
 * it while the chips underneath still performed it — the surface said "your
 * grounds disagree" directly above a chip saying "sourced", about the same
 * atom.
 *
 * This is not a patch over an average. The parallel report is strictly more
 * informative than the merged one (the merge is a lossy function of it), so
 * this restores information the merge destroyed rather than second-guessing
 * it. Only `disagreements` can be over-credited this way: an atom absent from
 * every ground is absent from the union too, so it was never sourced to begin
 * with — which is why `unsupportedEverywhere` is deliberately not consulted
 * here.
 *
 * A demoted span becomes `owned`, and drops its citation indexes: those
 * point at the ground that DID carry the atom, and letting a chip open that
 * passage would answer "is this backed?" with the one ground that happens to
 * agree. The disagreement itself belongs to the panel (§4.7), which shows both
 * columns; the chip's job is only to stop claiming confidence it lost.
 *
 * The demoted span keeps `originChannel` undefined, which is deliberate and
 * should stay that way: it was graded `sourced`, so no origin was ever
 * determined for it, and "plain, unattributed owned" is the honest default.
 * Filling it in here would attribute an origin nobody measured.
 *
 * Pure and span-local — no ranking, no resolution, no preferred ground.
 */
export function demoteDisagreedSpans(
  spans: GroundingSpan[],
  disagreements: { start: number; end: number }[],
): GroundingSpan[] {
  if (!disagreements.length) return spans;
  const split = new Set(disagreements.map((d) => `${d.start}:${d.end}`));
  return spans.map((s) => {
    if (!split.has(`${s.start}:${s.end}`)) return s;
    // Only a state that CLAIMS backing can be over-credited. An atom already
    // graded unsourced is not made worse by the grounds differing about it.
    if (s.state !== "sourced" && s.state !== "echoed") return s;
    return { ...s, state: "owned", supportingCitationIndexes: [] };
  });
}
