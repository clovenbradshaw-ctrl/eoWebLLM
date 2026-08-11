import { useMemo, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";

import styles from "../chat.module.scss";
import {
  foldGraphOnEntity,
  hypergraphScopeId,
  type GraphTerrainSnapshot,
} from "../../client/eo-hypergraph";
import type { TerrainCardProps } from "./types";

// Network — the literal hypergraph, per docs/citey-structured-grounding.md
// §3. Orientation only (eo-warrant.ts: hypergraph is kind:"paraphrase",
// canWarrant:false) — this view helps a reader find structure, it is never
// itself the evidence for a claim; every node/edge here is one hop from a
// real Entity/Link card that in turn points at the Field spans that do the
// actual warranting.

interface SimNode extends SimulationNodeDatum {
  id: string;
  mentions: number;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  edge: string;
  weight: number;
}

const WIDTH = 320;
const HEIGHT = 220;
const SIM_TICKS = 220;

function layout(snap: GraphTerrainSnapshot): {
  nodes: SimNode[];
  links: SimLink[];
} {
  const nodes: SimNode[] = snap.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: SimLink[] = [];
  for (const e of snap.edges) {
    const [subject, , object] = e.edge.split("|");
    if (!byId.has(subject) || !byId.has(object)) continue;
    links.push({
      edge: e.edge,
      weight: e.weight,
      source: subject,
      target: object,
    });
  }

  const simulation = forceSimulation(nodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((n) => n.id)
        .distance(70),
    )
    .force("charge", forceManyBody().strength(-160))
    .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
    .force("collide", forceCollide(18))
    .stop();
  for (let i = 0; i < SIM_TICKS; i++) simulation.tick();

  return { nodes, links };
}

export function NetworkCard({ session, params, onNavigate }: TerrainCardProps) {
  const scopeId = hypergraphScopeId(session);
  const [search, setSearch] = useState(params.entity ?? "");
  const foldEntity = params.entity ?? (search.trim() || null);

  // Not memoized on the graph's own contents — it lives outside React state
  // (eo-hypergraph.ts's module-level wrapper map), so there is no prop/state
  // change to key a memo on; re-reading it (and re-running the layout, cheap
  // for a chat-sized graph) on every render is the same standing the
  // existing EOT Graph tab's inline foldGraphOnEntity call already has.
  const snap = foldGraphOnEntity(scopeId, foldEntity, { limit: 80 });
  const { nodes, links } = useMemo(
    () => (snap ? layout(snap) : { nodes: [], links: [] }),
    [snap],
  );

  if (!snap) {
    return (
      <div className={styles["terrain-card"]}>
        <div className={styles["terrain-card-head"]}>
          <div className={styles["terrain-card-title"]}>Network</div>
        </div>
        <div className={styles["terrain-panel-empty"]}>
          No graph yet this session. Send a message or add a source to start
          one.
        </div>
      </div>
    );
  }

  return (
    <div className={styles["terrain-card"]}>
      <div className={styles["terrain-card-head"]}>
        <div className={styles["terrain-card-title"]}>Network</div>
      </div>
      <input
        className={styles["terrain-search"]}
        type="text"
        placeholder="Search / fold on an entity…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <svg
        className={styles["terrain-network-canvas"]}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        {links.map((l, i) => {
          const s = l.source as SimNode;
          const t = l.target as SimNode;
          if (typeof s.x !== "number" || typeof t.x !== "number") return null;
          return (
            <line
              key={i}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              className={styles["terrain-network-edge"]}
            />
          );
        })}
        {nodes.map((n) => (
          <g
            key={n.id}
            transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
            className={styles["terrain-network-node"]}
            onClick={() =>
              onNavigate({ kind: "entity", params: { entity: n.id } })
            }
          >
            <circle r={6 + Math.min(10, n.mentions)} />
            <text x={0} y={-10 - Math.min(10, n.mentions)} textAnchor="middle">
              {n.id.length > 18 ? `${n.id.slice(0, 17)}…` : n.id}
            </text>
          </g>
        ))}
      </svg>
      <div className={styles["terrain-graph-stats"]}>
        {snap.nodeCount} node{snap.nodeCount === 1 ? "" : "s"} ·{" "}
        {snap.edgeCount} edge{snap.edgeCount === 1 ? "" : "s"} total
        {foldEntity ? ` · folded on "${foldEntity}"` : ""}
      </div>
    </div>
  );
}
