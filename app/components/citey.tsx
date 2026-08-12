/* ============================================================
   citey.tsx — Citey, the app's mascot: an always-animated bent-wire
   logic-operator sprite (⊢ ⊨ ⊩ ⊪) standing in for the assistant's avatar,
   bobbing and morphing shape as a reply comes in.

   The shape he takes isn't wired to real content understanding yet — that's
   next (he'll eventually say what he thinks the text is). For now `pickState`
   is a light heuristic over the streamed-so-far text, just enough for his
   body to change shape as different kinds of content go by.
   ============================================================ */

import { useEffect, useRef, useState } from "react";
import styles from "./citey.module.scss";

export type CiteyStateName = "turnstile" | "entails" | "asserted" | "context";
type Accessory = "reading-glasses" | "laurel" | "mortarboard" | "cap";

const CITEY_STATES: Record<
  CiteyStateName,
  {
    glyph: string;
    color: string;
    eyes: [string, string];
    accessory: Accessory;
  }
> = {
  // ⊢ "entails / follows from" — the default, resting shape. It's the
  // simplest glyph in the set (one stem, one arm) and the most fitting one
  // for a mascot named after citing: it's the logic symbol for "this is
  // backed by that." Reading glasses fit a citation assistant's baseline.
  turnstile: {
    glyph: "⊢",
    color: "#7C74DE",
    eyes: ["r1c0", "r1c1"],
    accessory: "reading-glasses",
  },
  // ⊨ a strong claim, delivered with total confidence ("always", "never",
  // "must", an exclamation) — dictator energy, so he gets the laurel.
  entails: {
    glyph: "⊨",
    color: "#1F9E76",
    eyes: ["r2c6", "r2c7"],
    accessory: "laurel",
  },
  // a list / structured analysis — the mortarboard for academic rigor.
  asserted: {
    glyph: "⊢",
    color: "#2E8B86",
    eyes: ["r0c6", "r0c7"],
    accessory: "mortarboard",
  },
  // ⊪ answering with background — a press hat, out canvassing for context.
  context: {
    glyph: "⊪",
    color: "#4D7EA8",
    eyes: ["r0c2", "r0c3"],
    accessory: "cap",
  },
};

const BODY_PATHS: Record<string, string> = {
  "⊢": "M48 40 L48 152 M48 96 L118 96",
  "⊨": "M40 40 L40 152 M64 40 L64 152 M64 96 L122 96",
  "⊪": "M34 40 L34 152 M56 40 L56 152 M78 40 L78 152 M78 96 L122 96",
};

// A light, mechanical read of the streamed-so-far text — not semantics, just
// enough shape-variety that Citey visibly reacts to what's going by.
function pickState(text: string): CiteyStateName {
  const tail = text.slice(-240);
  if (/```/.test(tail)) return "turnstile";
  if (/(^|\n)\s*([-*]|\d+[.)])\s/.test(tail)) return "asserted";
  if (/\?\s*$/.test(tail.trim())) return "context";
  if (
    /!\s*$/.test(tail.trim()) ||
    /\b(always|never|must|proven|definitely)\b/i.test(tail)
  )
    return "entails";
  return "turnstile";
}

const EYE_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/citey-eyes/`;

// Hand-drawn (not sourced) — flat shapes with a bold dark outline, echoing
// the same clip-art language the reference images used, but original.
const INK = "#20174B";
function Accessory(props: { kind: Accessory; color: string }) {
  const stroke = {
    stroke: INK,
    strokeWidth: 4,
    strokeLinejoin: "round" as const,
  };
  switch (props.kind) {
    case "reading-glasses":
      // Lenses sized/spaced to match where the eye images actually sit
      // (each eye renders at ~44% of the sprite's width with a 7px gap,
      // which is wider than it looks from the viewBox alone) — verified
      // against the real rendered eye positions, not just eyeballed.
      return (
        <svg viewBox="0 0 120 32" className={styles["citey-glasses"]}>
          <g fill="none" {...stroke}>
            <rect x="2" y="2" width="50" height="26" rx="10" />
            <rect x="68" y="2" width="50" height="26" rx="10" />
            <path d="M52 14 Q60 6 68 14" />
          </g>
        </svg>
      );
    case "laurel": {
      // A Roman laurel crown — two branches of leaves meeting at a center
      // berry. Three bold leaves per side (not five small ones) so the
      // wreath still reads as a wreath at avatar size.
      const gold = "#C9A227";
      const branch = (dir: 1 | -1) =>
        Array.from({ length: 3 }, (_, i) => {
          const t = i / 2;
          const angle = dir * (18 + t * 62);
          const radius = 16 + t * 26;
          const rad = (angle * Math.PI) / 180;
          const cx = 60 + Math.sin(rad) * radius;
          const cy = 41 - Math.cos(rad) * radius * 0.85;
          return (
            <ellipse
              key={`${dir}-${i}`}
              cx={cx}
              cy={cy}
              rx={11 - t * 1.5}
              ry={5}
              transform={`rotate(${angle} ${cx} ${cy})`}
              fill={gold}
              stroke={INK}
              strokeWidth={3}
            />
          );
        });
      return (
        <svg viewBox="0 0 120 50" className={styles["citey-hat"]}>
          {branch(-1)}
          {branch(1)}
          <circle
            cx="60"
            cy="41"
            r="3.5"
            fill={gold}
            stroke={INK}
            strokeWidth="2.5"
          />
        </svg>
      );
    }
    case "mortarboard": {
      // Navy cap, red tassel — the classic academic-regalia pairing. The
      // "insight" eye lives ON the band itself (not floated above as a
      // separate layer) so it can never drift out of place relative to
      // the hat it's supposed to be part of.
      const navy = "#1B1A3E";
      const red = "#D8412C";
      return (
        <svg viewBox="0 0 120 66" className={styles["citey-hat"]}>
          <rect
            x="42"
            y="30"
            width="36"
            height="16"
            rx="3"
            fill={navy}
            {...stroke}
          />
          <polygon points="60,2 116,26 60,50 4,26" fill={navy} {...stroke} />
          <image
            href={EYE_BASE + "r1c4.png"}
            x="51"
            y="32"
            width="18"
            height="12"
          />
          <circle
            cx="60"
            cy="26"
            r="5"
            fill={red}
            stroke={INK}
            strokeWidth="3"
          />
          <path
            d="M96 22 L108 30 L102 54"
            fill="none"
            stroke={red}
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle
            cx="102"
            cy="56"
            r="5"
            fill={red}
            stroke={INK}
            strokeWidth="3"
          />
        </svg>
      );
    }
    case "cap":
      // A press-hat fedora — brim, band, and a tucked card. Out gathering
      // context reads better as an old-school reporter than a flat cap.
      return (
        <svg viewBox="0 0 130 62" className={styles["citey-hat"]}>
          <ellipse
            cx="65"
            cy="46"
            rx="60"
            ry="11"
            fill={props.color}
            {...stroke}
          />
          <path
            d="M27 44 Q27 6 65 6 Q103 6 103 44 Z"
            fill={props.color}
            {...stroke}
          />
          <path
            d="M52 14 Q60 22 68 26"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.5"
          />
          <rect x="27" y="34" width="76" height="11" fill={INK} />
          <g transform="rotate(-14 62 30)">
            <rect
              x="53"
              y="18"
              width="16"
              height="22"
              rx="1.5"
              fill="#FFFFFF"
              stroke={INK}
              strokeWidth="3"
            />
          </g>
        </svg>
      );
  }
}

// Maps a real grounding verdict (see eo-grounding-spans.ts's GroundingState)
// onto a shape — "confirmed" reads as a settled, backed claim (entails);
// "gap" reads as still out canvassing for something that wasn't found
// (context). Used wherever Citey is showing up because it has something to
// say about a specific span (CiteyNote in chat.tsx), as opposed to the
// text-shape heuristic below, which has nothing to do with grounding.
const GROUNDING_STATE_MAP: Record<"confirmed" | "gap", CiteyStateName> = {
  confirmed: "entails",
  gap: "context",
};

// The animated sprite. When `groundingState` is given, its shape is fixed
// by the real verdict above. Otherwise it falls back to `pickState`,
// re-sampled every ~700ms rather than on every token so a shape change
// reads as a deliberate morph instead of a flicker.
export function CiteySprite(props: {
  text?: string;
  size?: number;
  groundingState?: "confirmed" | "gap";
}) {
  const size = props.size ?? 48;
  const [state, setState] = useState<CiteyStateName>(
    props.groundingState
      ? GROUNDING_STATE_MAP[props.groundingState]
      : "turnstile",
  );
  const lastSample = useRef(0);

  useEffect(() => {
    if (props.groundingState) {
      setState(GROUNDING_STATE_MAP[props.groundingState]);
      return;
    }
    const now = Date.now();
    if (now - lastSample.current < 700) return;
    lastSample.current = now;
    const next = pickState(props.text ?? "");
    setState((prev) => (prev === next ? prev : next));
  }, [props.text, props.groundingState]);

  const d = CITEY_STATES[state];
  const eyes = d.eyes;

  return (
    <div
      className={styles["citey-sprite"]}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 150 180"
        width={size}
        height={size}
        className={styles["citey-bob"]}
        style={{ overflow: "visible" }}
      >
        <g className={styles["citey-boil"]}>
          <path
            key={state}
            className={styles["citey-morph"]}
            d={BODY_PATHS[d.glyph]}
            fill="none"
            stroke={d.color}
            strokeWidth={16}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
      <div className={styles["citey-eyes"]}>
        <div className={styles["citey-blink"]}>
          <div className={styles["citey-eye-wander"]}>
            <img src={EYE_BASE + eyes[0] + ".png"} draggable={false} alt="" />
            <img src={EYE_BASE + eyes[1] + ".png"} draggable={false} alt="" />
          </div>
        </div>
      </div>
      <Accessory kind={d.accessory} color={d.color} />
    </div>
  );
}
