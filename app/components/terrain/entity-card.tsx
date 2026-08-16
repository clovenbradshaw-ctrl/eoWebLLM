import styles from "../chat.module.scss";
import {
  entityDetail,
  hypergraphScopeId,
  isNodeVisible,
  isEdgeVisible,
} from "../../client/eo-hypergraph";
import { resolveDocLabel, type TerrainCardProps } from "./types";

// Entity — one node's own neighbourhood. Orientation only (see
// docs/citey-structured-grounding.md §0/§8): mentions/edges here help a
// reader navigate, they are never themselves the evidence for a claim —
// each edge row below hops to the Link card, which in turn points at the
// Field spans that actually ground it.

export function EntityCard({ session, params, onNavigate }: TerrainCardProps) {
  const entity = params.entity ?? "";
  const scopeId = hypergraphScopeId(session);
  const detail = entity ? entityDetail(scopeId, entity) : null;

  if (!detail) {
    return (
      <div className={styles["terrain-card"]}>
        <div className={styles["terrain-card-head"]}>
          <div className={styles["terrain-card-title"]}>Entity</div>
        </div>
        <div className={styles["terrain-panel-empty"]}>
          {entity
            ? `"${entity}" isn't a node in this session's graph.`
            : "No entity selected."}
        </div>
      </div>
    );
  }

  if (!isNodeVisible(scopeId, detail.id, session)) {
    return (
      <div className={styles["terrain-card"]}>
        <div className={styles["terrain-card-head"]}>
          <div className={styles["terrain-card-title"]}>{detail.id}</div>
        </div>
        <div className={styles["terrain-panel-empty"]}>
          Every source that mentioned &quot;{detail.id}&quot; is currently
          disabled — re-enable one in Sources to see this entity.
        </div>
      </div>
    );
  }

  const visibleEdges = detail.edges.filter((e) =>
    isEdgeVisible(scopeId, e.edge, session),
  );
  const hiddenEdgeCount = detail.edges.length - visibleEdges.length;

  const firstSeen = resolveDocLabel(session, detail.firstSeenDocId);
  const lastSeen = resolveDocLabel(session, detail.lastSeenDocId);

  return (
    <div className={styles["terrain-card"]}>
      <div className={styles["terrain-card-head"]}>
        <div className={styles["terrain-card-title"]}>{detail.id}</div>
      </div>
      <div className={styles["terrain-kv-row"]}>
        <span>mentions</span>
        <span>{detail.mentions}</span>
      </div>
      <div className={styles["terrain-kv-row"]}>
        <span>first seen</span>
        <span>{firstSeen ?? "—"}</span>
      </div>
      <div className={styles["terrain-kv-row"]}>
        <span>last seen</span>
        <span>{lastSeen ?? "—"}</span>
      </div>
      <div className={styles["terrain-callout"]}>
        This session&apos;s single merged view — surface forms of this entity
        found in different uploaded sources are not yet cross-checked as the
        same real-world thing (see the Kind/Paradigm gap notes).
      </div>
      <div className={styles["terrain-divider"]} />
      <div className={styles["terrain-card-subhead"]}>
        {visibleEdges.length} relation{visibleEdges.length === 1 ? "" : "s"}
        {hiddenEdgeCount > 0
          ? ` (+${hiddenEdgeCount} hidden by a disabled source)`
          : ""}
      </div>
      {!visibleEdges.length ? (
        <div className={styles["terrain-panel-empty"]}>None yet.</div>
      ) : (
        <div className={styles["terrain-edge-list"]}>
          {visibleEdges.map((e) => (
            <div
              key={e.edge}
              className={styles["terrain-edge-row"]}
              onClick={() =>
                onNavigate({ kind: "link", params: { edge: e.edge } })
              }
            >
              {e.edge.split("|").join(" — ")}
              <span className={styles["terrain-edge-weight"]}>
                {e.weight.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
