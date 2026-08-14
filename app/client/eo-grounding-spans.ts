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
//   - "stated"   — the reader themselves said it. The desk channel warrants
//                  (eo-warrant.ts: conversational, canWarrant true) — this is
//                  backed, just not by a source.
//   - "general"   — nothing external bore on this turn at all, so general
//                  knowledge is the legitimate basis (internal channel:
//                  "a legitimate answer when nothing external bears on the
//                  question").
//   - "bleed"     — the ONLY thing carrying it is a channel that cannot
//                  warrant: the folded PAST DISCOURSE paraphrase, or a
//                  hypergraph thought. The dangerous one, and the reason this
//                  split exists — it reads as grounded to the model and rests
//                  on a paraphrase whose source is gone.
//   - "unconfirmed" — material WAS gathered and this is not in it.
//
// Those four were one state, "owned", until this pass. Collapsing them put a
// claim the reader had personally stated in the same colour as a claim resting
// on a summary of a summary, and gave the two the same caption. That is the
// project's own rule against synthesising several channels into one verdict
// (eo-constitution II.8, "no averaging of grounds") violated in miniature, at
// the smallest unit the system has. Each is now reported on its own footing
// and the disagreement between channels stays visible.
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
  type Index,
} from "./eo-citation-check";

export type GroundingState =
  | "sourced"
  | "echoed"
  | "stated"
  | "general"
  | "bleed"
  | "unconfirmed"
  | "checking"
  | "contradicted";

/** The four states that replaced "owned", for a caller that needs to treat
 *  them as a class (a display filter, a count) without re-listing them and
 *  falling behind when one is added. */
export const UNSOURCED_STATES: readonly GroundingState[] = [
  "stated",
  "general",
  "bleed",
  "unconfirmed",
];

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
  opts: {
    citations: CitationEntry[];
    question?: string;
    /** The reader's own stated facts, verbatim (eo-memory.ts's StatedFact
     *  texts). The desk channel warrants, so an atom found here is backed —
     *  it just is not backed by a source. Omitted, no atom can be `stated`. */
    deskFacts?: string[];
    /** Text from channels typed canWarrant:false — the folded PAST DISCOURSE
     *  summary, a hypergraph thought. An atom found ONLY here is `bleed`.
     *  Omitted, no atom can be `bleed`, and the state it would have had is
     *  the one it gets. */
    unwarrantedText?: string[];
  },
): GroundingSpan[] {
  const citations = opts.citations ?? [];
  const index = citations.length ? buildUnionIndex(citations) : null;
  const questionWords = wordSet(opts.question || "");

  // Built the same way the citation index is, so "does the desk say this" is
  // the exact test "does the source say this" already is — same tokenisation,
  // same number normalisation, no second looser guess (LAWS.md L11d).
  const asIndex = (texts?: string[]) =>
    texts && texts.length
      ? buildUnionIndex(
          texts.map((t, i) => ({ index: i, source_id: "", text: t })),
        )
      : null;
  const deskIndex = asIndex(opts.deskFacts);
  const unwarrantedIndex = asIndex(opts.unwarrantedText);
  const coveredBy = (idx: Index | null, atom: { kind: string; tokens: string[] }) =>
    !!idx &&
    atom.tokens.every((t) =>
      atom.kind === "number" ? hasNumber(idx.numbers, t) : hasWord(idx.words, t),
    );

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
        } else state = unsourcedState(atom, true);
      } else {
        state = unsourcedState(atom, false);
      }

      // The split. Order is precedence, and it is deliberate: the desk
      // WARRANTS, so a fact the reader stated outranks every remaining
      // possibility and is never reported as unconfirmed. `bleed` is checked
      // before the fallbacks because it is the finding — an atom carried only
      // by a paraphrase is not merely unbacked, it is unbacked in a way that
      // looks backed from inside the prompt.
      function unsourcedState(
        a: { kind: "number" | "name"; tokens: string[] },
        gathered: boolean,
      ): GroundingState {
        if (coveredBy(deskIndex, a)) return "stated";
        if (coveredBy(unwarrantedIndex, a)) return "bleed";
        // A number still earns the async resolve pass; that is about what can
        // be CHECKED next, not about what is known now.
        if (a.kind === "number") return "checking";
        return gathered ? "unconfirmed" : "general";
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
 * A demoted span becomes `unconfirmed`, and drops its citation indexes: those
 * point at the ground that DID carry the atom, and letting a chip open that
 * passage would answer "is this backed?" with the one ground that happens to
 * agree. The disagreement itself belongs to the panel (§4.7), which shows both
 * columns; the chip's job is only to stop claiming confidence it lost.
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
    return { ...s, state: "unconfirmed", supportingCitationIndexes: [] };
  });
}
