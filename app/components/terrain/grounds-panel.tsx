import styles from "../chat.module.scss";
import { voidScopeText } from "../../client/eo-citation-check";
import type {
  ParallelGroundingReport,
  AtomAcrossGrounds,
} from "../../client/eo-citation-check";

// The grounds surface — renders checkGroundsInParallel's report WITHOUT
// resolving it. This is the one place in the product where eo-constitution
// II.8's "plural grounds stay parallel and their disagreement is the
// finding" becomes something a reader can see.
//
// Three refusals hold this file together, and each is load-bearing:
//
//  1. NOTHING HERE RANKS. No score, no confidence, no "probably", no
//     winner, no ordering by strength. A disagreement is displayed as two
//     lists side by side and left standing. Deciding what it means is the
//     reader's (II.3) — a UI that resolves it has averaged the grounds in
//     the last mile after the engine carefully refused to.
//
//  2. A VOID NAMES ITS BOUND. "Not found" is an assertion about a bounded
//     search, and an unbounded void is a shrug, not a finding. Every void
//     row prints what was looked in, by identifier, and the query that
//     produced it where there was one — so another reader can re-run it
//     and disagree (II.9, the revision test).
//
//  3. A GROUND THAT WAS NOT EXAMINED SAYS SO. `examined: false` never
//     renders as agreement or as a clean bill (LAWS.md L2e) — "checked,
//     nothing there" and "never checked" are different facts.
//
// Attention hierarchy (docs/citey-fact-check-policy.md): disagreement is the
// loudest thing on screen, louder than a contradiction and far louder than a
// citation, because it is the only reading the reader cannot get anywhere
// else. Everything that merely agrees is quiet by construction.

function AtomRow(props: { atom: AtomAcrossGrounds }) {
  const { atom } = props;
  return (
    <div className={styles["grounds-row"]}>
      <span className={styles["grounds-atom"]}>{atom.text}</span>
      <div className={styles["grounds-sides"]}>
        <div className={styles["grounds-side"]}>
          <span className={styles["grounds-side-label"]}>carried by</span>
          <span className={styles["grounds-side-names"]}>
            {atom.supportedBy.join(", ")}
          </span>
        </div>
        <div className={styles["grounds-side"]}>
          <span className={styles["grounds-side-label"]}>absent from</span>
          <span className={styles["grounds-side-names"]}>
            {atom.absentFrom.join(", ")}
          </span>
        </div>
      </div>
    </div>
  );
}

export function GroundsPanel(props: { report?: ParallelGroundingReport }) {
  const report = props.report;
  if (!report) return null;

  const { disagreements, unsupportedEverywhere, grounds } = report;
  const unexamined = grounds.filter((g) => !g.examined);
  if (
    !disagreements.length &&
    !unsupportedEverywhere.length &&
    !unexamined.length
  )
    return null;

  return (
    <div className={styles["grounds-panel"]}>
      {disagreements.length > 0 && (
        <div className={styles["grounds-disagree"]}>
          <div className={styles["grounds-heading"]}>
            your grounds disagree
          </div>
          {/* Deliberately not summarised into a verdict. Both readings, intact. */}
          {disagreements.map((d) => (
            <AtomRow key={`${d.start}-${d.end}-${d.text}`} atom={d} />
          ))}
        </div>
      )}

      {unsupportedEverywhere.length > 0 && (
        <div className={styles["grounds-void"]}>
          <div className={styles["grounds-heading"]}>
            not found in anything that was searched
          </div>
          <div className={styles["grounds-void-atoms"]}>
            {unsupportedEverywhere.map((v) => (
              <span
                key={`${v.start}-${v.end}-${v.text}`}
                className={styles["grounds-atom"]}
              >
                {v.text}
              </span>
            ))}
          </div>
          <div className={styles["grounds-scope"]}>
            looked in: {voidScopeText(grounds)}
          </div>
        </div>
      )}

      {unexamined.length > 0 && (
        <div className={styles["grounds-unexamined"]}>
          not checked against {unexamined.map((g) => g.name).join(", ")} —
          nothing was gathered from there this turn
        </div>
      )}
    </div>
  );
}
