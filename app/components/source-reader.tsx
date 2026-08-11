import { useState } from "react";
import styles from "./chat.module.scss";
import type { EoSource, EventLog } from "../client/eo-corpus";
import { readRawSource, readSourceLedger } from "../client/eo-corpus";
import { toEOTReader } from "../client/eo-reading";
import { MODIFIER_SCOPE_CURRENT_LENS } from "../client/eo-binary/modifier-order-lens.js";
import { readDocument } from "../client/eo-binary/reading.js";
import { isGap } from "../client/eo-binary/nul.js";

// source-reader.tsx — the Fold/Events/Raw reader for one EoSource, factored
// out of chat.tsx's per-session source panel so the project document
// explorer (document-explorer.tsx) can open the exact same reader over a
// project-wide source instead of duplicating this ~150-line view. Split
// into a hook (state + actions) and two small presentational pieces
// (trigger button, expanded panel) rather than one component, so each
// caller can place the trigger inline in its own row layout (chat.tsx's
// source-row is a flex row the button has to stay inside of) while sharing
// every byte of the actual reading logic.

// "Fold mode": the ledger's append-only trail projected through
// MODIFIER_SCOPE_CURRENT_LENS (latest tick per node) and formatted as an
// EOT reader surface -- the clean, current reading a projection is for, as
// opposed to event mode's raw, unfolded history.
export function renderFoldedEOT(log: EventLog, roomName: string): string {
  const reading = readDocument(
    log,
    [{ lensDef: MODIFIER_SCOPE_CURRENT_LENS, terrain: "Link" }],
    log.tick,
  );
  if (isGap(reading)) return `# reading refused: ${reading.gap}`;
  return toEOTReader({ reading, refused: [] } as any, { roomName });
}

// "Event mode": one line per raw ledger tick, in order -- the append-only
// record itself, nothing folded or hidden. supersedes/confirms are shown
// against the TICK of the event they point to (event_ids are content
// hashes, not something a human reads), so the correction chain is
// legible without leaving the ledger's own vocabulary.
export function formatLedgerEventLine(
  e: any,
  idToTick: Map<string, number>,
): string {
  const base = `tick ${e.tick}  ${e.type}`;
  if (e.type === "SEG.refuse") {
    return `${base}  head="${e.head}"  gap=${e.gap}${
      e.reason ? ` (${e.reason})` : ""
    }  [${e.source}]`;
  }
  const edge = `${e.subject} -> ${e.object}  class="${e.class}"`;
  if (e.type === "SEG.revise") {
    return `${base}  ${edge}  -- supersedes tick ${idToTick.get(
      e.supersedes,
    )} (was "${e.priorClass}")`;
  }
  if (e.type === "SEG.confirm") {
    return `${base}  ${edge}  -- confirms tick ${idToTick.get(e.confirms)}`;
  }
  return `${base}  ${edge}`;
}

type RawSource =
  | { sourceId: string; kind: "text"; text: string }
  | { sourceId: string; kind: "image"; url: string }
  | null;

export interface SourceReaderState {
  expanded: boolean;
  toggle: () => void;
  mode: "event" | "fold" | "raw";
  setMode: (m: "event" | "fold" | "raw") => void;
  ledger: EventLog | null;
  ledgerLoading: boolean;
  raw: RawSource;
  rawLoading: boolean;
  loadRaw: () => void;
  hasViewer: boolean;
}

/**
 * All state and actions for one source's reader, shared by the trigger
 * button and the expanded panel below. `source` changing identity (a
 * different row) does not reset this hook's own state on its own -- callers
 * key their list item on source.id, which remounts it, the same way
 * chat.tsx's original inline version implicitly did via component state.
 */
export function useSourceReader(source: EoSource): SourceReaderState {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"event" | "fold" | "raw">(
    source.readLedger ? "fold" : "raw",
  );
  const [ledger, setLedger] = useState<EventLog | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [raw, setRaw] = useState<RawSource>(null);
  const [rawLoading, setRawLoading] = useState(false);

  const hasViewer =
    !!source.readLedger ||
    source.textReadable ||
    source.mimeType.startsWith("image/");

  // Opens (or closes, on a second click) the ledger viewer for this source,
  // loading its full persisted event log back from OPFS -- the summary
  // counts on EoSource.readLedger are enough for the row's badge, but
  // "event mode" needs every tick, and "fold mode" needs the whole log to
  // project through MODIFIER_SCOPE_CURRENT_LENS.
  async function toggle() {
    if (expanded) {
      setExpanded(false);
      setLedger(null);
      setRaw((current) => {
        if (current?.kind === "image") URL.revokeObjectURL(current.url);
        return null;
      });
      return;
    }
    setExpanded(true);
    setLedger(null);
    setRaw((current) => {
      if (current?.kind === "image") URL.revokeObjectURL(current.url);
      return null;
    });
    // Sources with no ledger (images, other binaries) never had a Fold/
    // Event tab to land on -- Raw is the only tab they have.
    setMode(source.readLedger ? "fold" : "raw");
    setLedgerLoading(true);
    try {
      const l = await readSourceLedger(source.id);
      setLedger(l);
    } finally {
      setLedgerLoading(false);
    }
  }

  // Decodes the source's actual bytes for the "Raw" tab -- text is decoded
  // straight through (the same decode retrieveCorpus already does), images
  // become an object URL. Cached in `raw` so switching tabs back and forth
  // doesn't re-read OPFS every time.
  async function loadRaw() {
    setMode("raw");
    if (raw?.sourceId === source.id) return;
    setRawLoading(true);
    try {
      const bytes = await readRawSource(source.id);
      if (source.mimeType.startsWith("image/")) {
        const url = URL.createObjectURL(
          // readRawSource's Uint8Array is backed by a real ArrayBuffer
          // (arrayBuffer() below), but TS's DOM lib types Uint8Array's
          // buffer as ArrayBufferLike (which also admits SharedArrayBuffer),
          // so it doesn't structurally satisfy Blob's BlobPart.
          new Blob([bytes as unknown as BlobPart], { type: source.mimeType }),
        );
        setRaw({ sourceId: source.id, kind: "image", url });
      } else {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        setRaw({ sourceId: source.id, kind: "text", text });
      }
    } catch {
      setRaw({
        sourceId: source.id,
        kind: "text",
        text: "(couldn't read this source's raw bytes)",
      });
    } finally {
      setRawLoading(false);
    }
  }

  return {
    expanded,
    toggle,
    mode,
    setMode,
    ledger,
    ledgerLoading,
    raw,
    rawLoading,
    loadRaw,
    hasViewer,
  };
}

/** The "View"/"Hide" button -- placed inline in the caller's own row. */
export function SourceReaderTrigger(props: { state: SourceReaderState }) {
  const { state } = props;
  if (!state.hasViewer) return null;
  return (
    <button
      type="button"
      className={styles["source-view"]}
      title="View this source's actual content, its ledger, or the folded reading"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        state.toggle();
      }}
    >
      {state.expanded ? "Hide" : "View"}
    </button>
  );
}

/** The Fold/Events/Raw tabbed body -- rendered only while expanded. */
export function SourceReaderPanel(props: {
  source: EoSource;
  state: SourceReaderState;
}) {
  const { source, state } = props;
  if (!state.expanded) return null;
  return (
    <div className={styles["source-reading"]}>
      <div className={styles["source-reading-tabs"]}>
        {source.readLedger && (
          <>
            <button
              type="button"
              className={
                styles["source-reading-tab"] +
                (state.mode === "fold" ? " " + styles["active"] : "")
              }
              onClick={() => state.setMode("fold")}
            >
              Fold — current reading
            </button>
            <button
              type="button"
              className={
                styles["source-reading-tab"] +
                (state.mode === "event" ? " " + styles["active"] : "")
              }
              onClick={() => state.setMode("event")}
            >
              Events — raw ledger
            </button>
          </>
        )}
        {(source.textReadable || source.mimeType.startsWith("image/")) && (
          <button
            type="button"
            className={
              styles["source-reading-tab"] +
              (state.mode === "raw" ? " " + styles["active"] : "")
            }
            onClick={() => state.loadRaw()}
          >
            Raw — the actual file
          </button>
        )}
        {source.readLedger && (
          <span className={styles["source-reading-stats"]}>
            cursor {source.readLedger.cursor} · {source.readLedger.narrowCount}{" "}
            narrow · {source.readLedger.confirmCount} confirmed ·{" "}
            {source.readLedger.revisionCount} revised ·{" "}
            {source.readLedger.refuseCount} refused
          </span>
        )}
      </div>
      {state.mode === "raw" ? (
        state.rawLoading ? (
          <div className={styles["source-reading-body"]}>
            Reading the source&apos;s raw bytes…
          </div>
        ) : state.raw?.sourceId !== source.id ? (
          <div className={styles["source-reading-body"]}>&nbsp;</div>
        ) : state.raw.kind === "image" ? (
          <div className={styles["source-reading-body"]}>
            <img
              src={state.raw.url}
              alt={source.name}
              className={styles["source-reading-image"]}
            />
          </div>
        ) : (
          <pre className={styles["source-reading-body"]}>{state.raw.text}</pre>
        )
      ) : state.ledgerLoading ? (
        <div className={styles["source-reading-body"]}>Loading ledger…</div>
      ) : !state.ledger ? (
        <div className={styles["source-reading-body"]}>
          No persisted ledger for this source yet.
        </div>
      ) : state.mode === "fold" ? (
        <pre className={styles["source-reading-body"]}>
          {renderFoldedEOT(state.ledger, `source_${source.id}`)}
        </pre>
      ) : (
        <pre className={styles["source-reading-body"]}>
          {(() => {
            const idToTick = new Map(
              state.ledger.events.map((e: any) => [e.event_id, e.tick]),
            );
            return state.ledger.events
              .map((e: any) => formatLedgerEventLine(e, idToTick))
              .join("\n");
          })()}
        </pre>
      )}
    </div>
  );
}
