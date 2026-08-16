import styles from "../chat.module.scss";
import {
  hypergraphScopeId,
  linkDetail,
  isEdgeVisible,
} from "../../client/eo-hypergraph";
import { resolveDocLabel, type TerrainCardProps } from "./types";

// Link — one relation's own detail. eo-grounding.ts's canGround firewall:
// hypergraph (which is what a Link IS) is kind:"paraphrase" by
// construction — a Link can orient a reader toward the right passage, it
// can never itself be the citation. This card says so, plainly, rather
// than leaving it implicit.

export function LinkCard({ session, params, onNavigate }: TerrainCardProps) {
  const edge = params.edge ?? "";
  const scopeId = hypergraphScopeId(session);
  const detail = edge ? linkDetail(scopeId, edge) : null;

  if (!detail) {
    return (
      <div className={styles["terrain-card"]}>
        <div className={styles["terrain-card-head"]}>
          <div className={styles["terrain-card-title"]}>Link</div>
        </div>
        <div className={styles["terrain-panel-empty"]}>
          {edge
            ? `No relation "${edge}" in this session's graph.`
            : "No relation selected."}
        </div>
      </div>
    );
  }

  if (!isEdgeVisible(scopeId, detail.edge, session)) {
    return (
      <div className={styles["terrain-card"]}>
        <div className={styles["terrain-card-head"]}>
          <div className={styles["terrain-card-title"]}>Link</div>
        </div>
        <div className={styles["terrain-panel-empty"]}>
          Every source this relation came from is currently disabled — re-enable
          one in Sources to see it.
        </div>
      </div>
    );
  }

  const firstSeen = resolveDocLabel(session, detail.firstSeenDocId);
  const lastSeen = resolveDocLabel(session, detail.lastSeenDocId);
  const seenRange =
    firstSeen && lastSeen
      ? firstSeen === lastSeen
        ? `seen at ${firstSeen}`
        : `seen between ${firstSeen} and ${lastSeen}`
      : null;

  return (
    <div className={styles["terrain-card"]}>
      <div className={styles["terrain-card-head"]}>
        <div className={styles["terrain-link-header"]}>
          <span
            className={styles["terrain-link-node"]}
            onClick={() =>
              onNavigate({ kind: "entity", params: { entity: detail.subject } })
            }
          >
            {detail.subject}
          </span>
          <span className={styles["terrain-link-verb"]}>
            {detail.verb.replace(/^!/, "¬ ")}
          </span>
          <span
            className={styles["terrain-link-node"]}
            onClick={() =>
              onNavigate({ kind: "entity", params: { entity: detail.object } })
            }
          >
            {detail.object}
          </span>
        </div>
      </div>
      <div className={styles["terrain-warn"]}>
        Orientation only — this is a discovered relation, not a citation. It can
        point you at the source material; it can&apos;t stand in for it.
      </div>
      <div className={styles["terrain-kv-row"]}>
        <span>weight</span>
        <span>{detail.weight.toFixed(2)}</span>
      </div>
      {seenRange && (
        <div className={styles["terrain-kv-row"]}>
          <span>{seenRange}</span>
          <span
            className={styles["terrain-hint"]}
            title="Derived from this relation's two endpoint entities' own first/last-mentioned turns — not an exact timestamp on the relation itself."
          >
            (bound, not exact)
          </span>
        </div>
      )}
      <div className={styles["terrain-divider"]} />
      <div
        className={`${styles["terrain-link-lens-cta"]} ${styles["terrain-disabled-cta"]}`}
        onClick={() =>
          onNavigate({ kind: "lens", params: { edge: detail.edge } })
        }
      >
        Compare framing across sources →
      </div>
    </div>
  );
}
