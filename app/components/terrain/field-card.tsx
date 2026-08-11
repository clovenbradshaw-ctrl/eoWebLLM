import { useEffect, useState } from "react";

import styles from "../chat.module.scss";
import { readRawSourceRange, UNFOLD_WIDEN_BYTES } from "../../client/eo-corpus";
import type { TerrainCardProps } from "./types";

// Field — the atomic warrant unit (eo-warrant.ts's "corpus" channel,
// canWarrant: true). Every citation chip in chat bottoms out here, full
// stop; see docs/citey-structured-grounding.md §0. Reads eo-corpus.ts, not
// host/corpus.js's searchSpans/readSpan — the latter operates on the
// separate in-memory eoreader session eo-hypergraph.ts privately owns,
// which is not what a citation chip actually points at.
//
// params: either { sourceId, byteStart, byteEnd } directly, or
// { sourceName, byteStart, byteEnd } (a citation's own
// "name#start-end" ref, split by the caller) — resolved against
// session.eoSources to find the source's real OPFS id.

interface Loaded {
  name: string;
  windowStart: number;
  citedStart: number;
  citedEnd: number;
  text: string;
}

export function FieldCard({ session, params }: TerrainCardProps) {
  const byteStart = Number(params.byteStart);
  const byteEnd = Number(params.byteEnd);
  const source = params.sourceId
    ? session.eoSources?.find((s) => s.id === params.sourceId)
    : session.eoSources?.find((s) => s.name === params.sourceName);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoaded(null);
    setError(null);
    if (!source || !Number.isFinite(byteStart) || !Number.isFinite(byteEnd)) {
      setError(
        "This citation doesn't resolve to a known source and byte range.",
      );
      return;
    }
    let cancelled = false;
    const windowStart = Math.max(0, byteStart - UNFOLD_WIDEN_BYTES);
    const windowEnd = byteEnd + UNFOLD_WIDEN_BYTES;
    readRawSourceRange(source.id, windowStart, windowEnd)
      .then((bytes) => {
        if (cancelled) return;
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        setLoaded({
          name: source.name,
          windowStart,
          citedStart: byteStart,
          citedEnd: byteEnd,
          text,
        });
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't read this source's bytes.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, byteStart, byteEnd]);

  return (
    <div className={styles["terrain-card"]}>
      <div className={styles["terrain-card-head"]}>
        <div className={styles["terrain-card-title"]}>Field</div>
      </div>
      {error && <div className={styles["terrain-panel-empty"]}>{error}</div>}
      {!error && !loaded && (
        <div className={styles["terrain-panel-empty"]}>Loading…</div>
      )}
      {loaded && (
        <>
          <div className={styles["terrain-kv-row"]}>
            <span>{loaded.name}</span>
            <span>
              b.{loaded.citedStart}-{loaded.citedEnd}
            </span>
          </div>
          <div className={styles["terrain-field-span"]}>
            {loaded.text.slice(0, loaded.citedStart - loaded.windowStart)}
            <mark>
              {loaded.text.slice(
                loaded.citedStart - loaded.windowStart,
                loaded.citedEnd - loaded.windowStart,
              )}
            </mark>
            {loaded.text.slice(loaded.citedEnd - loaded.windowStart)}
          </div>
        </>
      )}
    </div>
  );
}
