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
//   - "general"  — nothing external bore on this turn at all, so general
//                  knowledge is the legitimate basis (internal channel: "a
//                  legitimate answer when nothing external bears on the
//                  question").
//   - "bleed"    — the ONLY thing carrying it is a channel that cannot
//                  warrant: the folded PAST DISCOURSE paraphrase, or a
//                  hypergraph thought. The dangerous one, and the reason this
//                  split exists — it reads as grounded to the model and rests
//                  on a paraphrase whose source is gone.
//   - "unconfirmed" — material WAS gathered and this is not in it.
//   - "checking" — a number atom with nothing to check it against yet, but
//                  eligible for the async search+judge pass in chat.ts.
//
// Those four were one state, "owned". Collapsing them put a claim the reader
// had personally stated in the same VALUE as a claim resting on a summary of
// a summary — the caption and colour differed, but every filter, count and
// predicate switching on `state` still treated them as one thing. That is
// eo-constitution II.8 ("no averaging of grounds") violated at the smallest
// unit the system has. The split makes the distinction a type; `originChannel`
// below keeps the finer detail (which unwarrantable channel it was) without
// giving it back the power to pass as backed.
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
  | "sourced"
  | "echoed"
  // The four situations `owned` used to collapse. Splitting them is not a
  // relabelling: it makes the distinction a TYPE. While they shared one
  // value, nothing that switched on `state` could tell an atom the reader
  // personally stated from one resting on a paraphrase that was never
  // evidence — the caption and the colour differed, and every filter,
  // count and predicate downstream still treated them as one thing. That
  // is II.8's "no averaging of grounds" at the smallest unit the system
  // has, and a comment cannot enforce it where a type can.
  | "stated" // desk — the reader said it. Backed, just not by a source.
  | "general" // internal — nothing external bore on the turn.
  | "bleed" // an unwarrantable channel is the ONLY thing carrying it.
  | "unconfirmed" // material WAS gathered and this is not in it.
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
  /** Best-effort attribution of an unsourced atom to the channel it likely
   *  came from, when one is identifiable — never a certainty claim. Unset
   *  keeps the atom unattributed (the honest default). Strictly finer than
   *  `state`: `bleed` collapses discourse and hypergraph because both are
   *  canWarrant:false, and this still says which. It may sharpen a caption;
   *  it may never be used to decide whether something is backed — that is
   *  what `state` is for, and the two must not be made to compete. */
  originChannel?: GroundingOriginChannel;
}

export function buildGroundingSpans(
  content: string,
  opts: {
    citations: CitationEntry[];
    question?: string;
    /** This turn's desk facts (see eo-memory.ts) — an unsourced atom that
     *  matches one is `stated`, since a reader-stated fact is backed by a
     *  warranting channel, not equally uncertain with a guess. */
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
     *  condition under which a residual atom may be attributed `internal`
     *  rather than left unattributed. */
    externalRequired?: boolean;
  },
): GroundingSpan[] {
  const citations = opts.citations ?? [];
  const index = citations.length ? buildUnionIndex(citations) : null;
  const questionWords = wordSet(opts.question || "");

  // Origin-channel attribution for unsourced atoms — desk first (most
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

  // The split, derived from the SAME detection originChannelFor already does
  // rather than from a second, looser guess (LAWS.md L11d). That detection is
  // the better of the two the codebase has had — fractional matching, three
  // channels kept apart, an explicit `externalRequired` flag — so the states
  // are read off it instead of re-deriving them:
  //
  //   desk                    -> stated       (backed, just not by a source)
  //   discourse | hypergraph  -> bleed        (canWarrant:false, both)
  //   otherwise, gathered     -> unconfirmed  (we looked; it is not there)
  //   otherwise               -> general      (nothing external bore on this)
  //
  // `gathered` is what separates the last two, and they are genuinely
  // different facts: "checked, not found" is a finding, "never checked" is
  // not (LAWS.md L2e).
  const unsourced = (
    atom: { kind: "number" | "name"; tokens: string[] },
    gathered: boolean,
  ): GroundingState => {
    const channel = originChannelFor(atom.tokens, atom.kind);
    if (channel === "desk") return "stated";
    if (channel === "discourse" || channel === "hypergraph") return "bleed";
    // A number still earns the async resolve pass; that is about what can be
    // CHECKED next, not about what is known now. Checked after the channels
    // so a number the reader themselves stated is not sent back out to be
    // re-verified against the web.
    if (atom.kind === "number") return "checking";
    return gathered ? "unconfirmed" : "general";
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
        } else state = unsourced(atom, true);
      } else {
        state = unsourced(atom, false);
      }

      spans.push({
        start: atom.start,
        end: atom.end,
        text: atom.text,
        atomKind: atom.kind,
        state,
        supportingCitationIndexes,
        // Kept alongside the split state rather than replaced by it: the
        // channel is strictly finer than the type. `bleed` deliberately
        // collapses discourse and hypergraph — both are canWarrant:false, so
        // they are the same KIND of failure — while originChannel still says
        // which one, for a caption that wants to name it.
        originChannel: UNSOURCED_STATES.includes(state)
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
 * A demoted span becomes `unconfirmed`, and drops its citation indexes: those
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
    return { ...s, state: "unconfirmed", supportingCitationIndexes: [] };
  });
}
