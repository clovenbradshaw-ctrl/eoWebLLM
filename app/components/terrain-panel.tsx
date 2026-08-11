import { useRef } from "react";

import styles from "./chat.module.scss";
import { IconButton } from "./button";
import CloseIcon from "../icons/close.svg";
import LeftIcon from "../icons/left.svg";
import type { ChatSession } from "../store";
import { useAppConfig } from "../store";
import {
  DEFAULT_TERRAIN_PANEL_WIDTH,
  MAX_TERRAIN_PANEL_WIDTH,
  MIN_TERRAIN_PANEL_WIDTH,
} from "../constant";
import {
  TERRAIN_CARD_KINDS,
  TERRAIN_GAP_KINDS,
  TERRAIN_TAB_LABEL,
  type OnNavigate,
  type TerrainCardKind,
  type TerrainCardRef,
} from "./terrain/types";
import { PlaceholderCard } from "./terrain/placeholder-card";
import { EntityCard } from "./terrain/entity-card";
import { LinkCard } from "./terrain/link-card";
import { NetworkCard } from "./terrain/network-card";
import { AtmosphereCard } from "./terrain/atmosphere-card";
import { FieldCard } from "./terrain/field-card";

// The docked terrain panel — see docs/citey-structured-grounding.md.
// Modeled on sidebar.tsx's useDragSideBar drag mechanics, docking right
// instead of left, driving --terrain-panel-width instead of
// --sidebar-width. Deliberately NOT `.eot-panel`'s full-overlay dark
// terminal — this is a consumer-facing, light-theme, docked column, a flex
// sibling of .chat-body rather than something painted on top of it.

function useDragTerrainPanel() {
  const config = useAppConfig();
  const startX = useRef(0);
  const startWidth = useRef(
    config.terrainPanelWidth ?? DEFAULT_TERRAIN_PANEL_WIDTH,
  );
  const lastUpdateTime = useRef(Date.now());

  const limit = (w: number) =>
    Math.min(MAX_TERRAIN_PANEL_WIDTH, Math.max(MIN_TERRAIN_PANEL_WIDTH, w));

  const onDragStart = (e: React.MouseEvent) => {
    startX.current = e.clientX;
    startWidth.current =
      config.terrainPanelWidth ?? DEFAULT_TERRAIN_PANEL_WIDTH;

    const handleDragMove = (e: MouseEvent) => {
      if (Date.now() < lastUpdateTime.current + 20) return;
      lastUpdateTime.current = Date.now();
      // Docked on the RIGHT — dragging the handle left (negative delta)
      // widens the panel, the inverse of the sidebar's left-docked math.
      const d = startX.current - e.clientX;
      const next = limit(startWidth.current + d);
      config.update((config) => {
        config.terrainPanelWidth = next;
      });
    };

    const handleDragEnd = () => {
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
    };

    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
  };

  return {
    onDragStart,
    width: limit(config.terrainPanelWidth ?? DEFAULT_TERRAIN_PANEL_WIDTH),
  };
}

function TerrainCardBody({
  kind,
  session,
  params,
  onNavigate,
}: {
  kind: TerrainCardKind;
  session: ChatSession;
  params: Record<string, string>;
  onNavigate: OnNavigate;
}) {
  if (TERRAIN_GAP_KINDS.has(kind)) return <PlaceholderCard kind={kind} />;
  switch (kind) {
    case "entity":
      return (
        <EntityCard session={session} params={params} onNavigate={onNavigate} />
      );
    case "link":
      return (
        <LinkCard session={session} params={params} onNavigate={onNavigate} />
      );
    case "network":
      return (
        <NetworkCard
          session={session}
          params={params}
          onNavigate={onNavigate}
        />
      );
    case "atmosphere":
      return (
        <AtmosphereCard
          session={session}
          params={params}
          onNavigate={onNavigate}
        />
      );
    case "field":
      return (
        <FieldCard session={session} params={params} onNavigate={onNavigate} />
      );
    default:
      return <PlaceholderCard kind={kind} />;
  }
}

export function TerrainPanel(props: {
  session: ChatSession;
  active: TerrainCardRef | null;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: OnNavigate;
  onClose: () => void;
}) {
  const { onDragStart, width } = useDragTerrainPanel();
  const activeKind = props.active?.kind ?? "entity";

  return (
    <>
      <div
        className={styles["terrain-panel-drag"]}
        onMouseDown={(e) => onDragStart(e)}
      />
      <div className={styles["terrain-panel"]} style={{ width }}>
        <div className={styles["terrain-panel-header"]}>
          <div className={styles["terrain-panel-nav"]}>
            <IconButton
              icon={<LeftIcon />}
              disabled={!props.canBack}
              onClick={props.onBack}
              title="Back"
            />
            <IconButton
              icon={<LeftIcon />}
              disabled={!props.canForward}
              onClick={props.onForward}
              title="Forward"
              // LeftIcon has no mirrored counterpart in app/icons — flipped
              // via CSS rather than adding a near-duplicate asset.
              className={styles["terrain-panel-forward"]}
            />
          </div>
          <IconButton
            icon={<CloseIcon />}
            onClick={props.onClose}
            title="Close"
          />
        </div>
        <div className={styles["terrain-panel-tabs"]}>
          {TERRAIN_CARD_KINDS.map((kind) => (
            <div
              key={kind}
              className={
                styles["terrain-tab"] +
                (kind === activeKind
                  ? ` ${styles["terrain-tab-active"]}`
                  : "") +
                (TERRAIN_GAP_KINDS.has(kind)
                  ? ` ${styles["terrain-tab-gap"]}`
                  : "")
              }
              onClick={() => {
                if (kind === activeKind) return;
                props.onNavigate({ kind, params: {} });
              }}
            >
              {TERRAIN_TAB_LABEL[kind]}
            </div>
          ))}
        </div>
        <div className={styles["terrain-panel-body"]}>
          <TerrainCardBody
            kind={activeKind}
            session={props.session}
            params={props.active?.params ?? {}}
            onNavigate={props.onNavigate}
          />
        </div>
      </div>
    </>
  );
}
