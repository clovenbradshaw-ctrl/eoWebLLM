// The rendered side of an entity mention — see entity-mention.ts for the
// pure sentinel-wrapping logic this chip's synthetic element is fed by.
// A mention is clickable and funnels into the terrain panel's single
// history-owning entry point via onEntityClick (chat.tsx's openTerrainCard,
// { kind: "entity" }). Styling lives in app/styles/markdown.scss next to
// the grounding chips' own — a dotted underline in the --eo-citey hue,
// deliberately NOT the pill vocabulary grounding chips use for evidence
// (entity mentions are navigation, see docs/citey-structured-grounding.md
// §0).
export function EntityMentionChip(props: {
  "data-entity-index"?: string;
  children?: React.ReactNode;
  entities: string[];
  onEntityClick: (entity: string) => void;
}) {
  const idx = Number(props["data-entity-index"]);
  const entity = Number.isFinite(idx) ? props.entities[idx] : undefined;
  if (!entity) return <>{props.children}</>;
  return (
    <span
      className="eo-entity-mention"
      title={`Open "${entity}" in Terrain`}
      onClick={(e) => {
        e.stopPropagation();
        props.onEntityClick(entity);
      }}
    >
      {props.children}
    </span>
  );
}
