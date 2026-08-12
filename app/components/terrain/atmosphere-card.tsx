import styles from "../chat.module.scss";
import {
  hypergraphScopeId,
  hypergraphTiersSnapshot,
} from "../../client/eo-hypergraph";
import type { TerrainCardProps } from "./types";

// Atmosphere — the Ground-grain reading terrain: tone/register shifts
// within the admitted material over time. Same recentShifts data the
// existing EOT Graph tab's renderTerrain already renders (chat.tsx), lifted
// into its own card rather than re-derived.

export function AtmosphereCard({ session }: TerrainCardProps) {
  const snap = hypergraphTiersSnapshot(hypergraphScopeId(session));
  const tier = snap?.tiers.find((t) => t.name === "atmosphere") ?? null;

  return (
    <div className={styles["terrain-card"]}>
      <div className={styles["terrain-card-head"]}>
        <div className={styles["terrain-card-title"]}>Atmosphere</div>
      </div>
      {!tier || tier.observations === 0 ? (
        <div className={styles["terrain-panel-empty"]}>
          No admitted material to read a register shift from yet.
        </div>
      ) : (
        <>
          <div className={styles["terrain-graph-stats"]}>
            {tier.observations} observation{tier.observations === 1 ? "" : "s"}{" "}
            · {tier.shifts} shift{tier.shifts === 1 ? "" : "s"} · novel rate{" "}
            {(tier.novelRate * 100).toFixed(0)}%
          </div>
          {tier.shifts === 0 ? (
            <div className={styles["terrain-panel-empty"]}>
              Nothing here has moved belief further than a plain continuation
              would have — no shift yet.
            </div>
          ) : (
            <>
              {tier.shifts > tier.recentShifts.length && (
                <div className={styles["terrain-hint"]}>
                  showing the {tier.recentShifts.length} most recent of{" "}
                  {tier.shifts} shifts
                </div>
              )}
              <div className={styles["terrain-shift-list"]}>
                {tier.recentShifts.map((s, i) => (
                  <div key={i} className={styles["terrain-shift"]}>
                    <span className={styles["terrain-shift-at"]}>
                      at {s.at}
                    </span>
                    {typeof s.surprise === "number"
                      ? ` · surprise ${s.surprise.toFixed(3)}`
                      : ""}
                    {s.reZero ? (
                      <span className={styles["terrain-shift-rezero"]}>
                        {" "}
                        · re-zero
                      </span>
                    ) : null}
                    {s.censored ? (
                      <span className={styles["terrain-shift-censored"]}>
                        {" "}
                        · censored ({s.censored})
                      </span>
                    ) : null}
                    {s.forms?.length ? (
                      <div className={styles["terrain-shift-forms"]}>
                        {s.forms.slice(0, 6).join(", ")}
                        {s.forms.length > 6
                          ? ` (+${s.forms.length - 6} more)`
                          : ""}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
