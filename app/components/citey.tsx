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

const CITEY_STATES: Record<
  CiteyStateName,
  { glyph: string; color: string; eyes: [string, string] }
> = {
  // ⊢ "entails / follows from" — the default, resting shape. It's the
  // simplest glyph in the set (one stem, one arm) and the most fitting one
  // for a mascot named after citing: it's the logic symbol for "this is
  // backed by that."
  turnstile: { glyph: "⊢", color: "#7C74DE", eyes: ["r1c0", "r1c1"] },
  entails: { glyph: "⊨", color: "#1F9E76", eyes: ["r2c6", "r2c7"] }, // ⊨ a strong claim
  asserted: { glyph: "⊢", color: "#2E8B86", eyes: ["r0c6", "r0c7"] }, // a list / structure
  context: { glyph: "⊪", color: "#4D7EA8", eyes: ["r0c2", "r0c3"] }, // ⊪ a question back
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

// The animated sprite — mounted in the avatar slot for every assistant turn.
// Re-samples `pickState` every ~700ms rather than on every token, so a shape
// change reads as a deliberate morph instead of a flicker.
export function CiteySprite(props: { text: string; size?: number }) {
  const size = props.size ?? 48;
  const [state, setState] = useState<CiteyStateName>("turnstile");
  const lastSample = useRef(0);

  useEffect(() => {
    const now = Date.now();
    if (now - lastSample.current < 700) return;
    lastSample.current = now;
    const next = pickState(props.text);
    setState((prev) => (prev === next ? prev : next));
  }, [props.text]);

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
    </div>
  );
}
