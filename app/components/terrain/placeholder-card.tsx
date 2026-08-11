import styles from "../chat.module.scss";
import type { TerrainCardKind } from "./types";

// The honest "not yet available" card for Kind, Lens, and Paradigm — see
// types.ts's header and docs/citey-structured-grounding.md §8. One shared
// component rather than three near-duplicate files: no fetched data, no
// mock numbers, no greyed-out fake chart. A click on a disabled-looking tab
// still lands here, on purpose, so a curious click teaches the reader the
// capability doesn't exist yet instead of the tab looking broken.

const REASON: Record<
  Extract<TerrainCardKind, "kind" | "lens" | "paradigm">,
  string
> = {
  kind: "Kind terrain needs per-atom Kind classification from the eoreader6 engine, which isn't exported to this app yet.",
  lens: "Comparing how sources frame the same relation differently is an open design question — not yet built.",
  paradigm:
    "A full beat dossier needs deeper tier-stack export than eoreader6 currently gives this app — only running counts, not the induced Kinds themselves.",
};

export function PlaceholderCard({ kind }: { kind: TerrainCardKind }) {
  const reason =
    REASON[kind as "kind" | "lens" | "paradigm"] ??
    "This terrain isn't wired up yet.";
  return (
    <div className={styles["terrain-card"]}>
      <div className={styles["terrain-card-head"]}>
        <div className={styles["terrain-card-title"]}>
          {kind[0].toUpperCase() + kind.slice(1)}
        </div>
      </div>
      <div className={styles["terrain-warn"]}>{reason}</div>
    </div>
  );
}
