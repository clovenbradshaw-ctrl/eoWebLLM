import { test } from "node:test";
import assert from "node:assert/strict";

import { wrapEntityMentions } from "../app/components/terrain/entity-mention.ts";

const OPEN = "\uE053";
const SEP = "\uE054";
const CLOSE = "\uE055";
const G_OPEN = "\uE050";
const G_SEP = "\uE051";
const G_CLOSE = "\uE052";

function unwrap(wrapped) {
  return wrapped
    .replace(new RegExp(`${OPEN}\\d+${SEP}`, "g"), "")
    .replace(new RegExp(CLOSE, "g"), "");
}

/** A realistic grounding chip (grounding-chip.tsx's exact sentinel shape). */
function groundedChip(index, text) {
  return `${G_OPEN}${index}${G_SEP}${text}${G_CLOSE}`;
}

test("wrapEntityMentions: wraps whole-word mentions regardless of case", () => {
  const out = wrapEntityMentions(
    "MNPD handled the case. The department responded.",
    ["mnpd"],
  );
  assert.match(out, /MNPD/);
  assert.ok(out.includes(`${OPEN}0${SEP}`), "sentinel encodes the id index");
  assert.ok(out.includes(CLOSE), "sentinel closes the mention");
  assert.equal(unwrap(out), "MNPD handled the case. The department responded.");
});

test("wrapEntityMentions: never matches a substring of a longer word", () => {
  const out = wrapEntityMentions("She was running the race yesterday.", [
    "run",
  ]);
  assert.equal(out, "She was running the race yesterday.");
});

test("wrapEntityMentions: longest id wins over a substring id in the same text", () => {
  const out = wrapEntityMentions(
    "Metro Nashville Police Department is the city's force.",
    ["nashville", "metro nashville police department"],
  );
  assert.ok(
    out.includes(`${OPEN}1${SEP}Metro Nashville Police Department${CLOSE}`),
    "the multi-word id (index 1) should claim the mention",
  );
  assert.ok(!out.includes(`${OPEN}0${SEP}`), "the substring id should not wrap");
});

test("wrapEntityMentions: non-overlapping — a second mention of a different id still wraps", () => {
  const out = wrapEntityMentions("MNPD and Nashville share this story.", [
    "mnpd",
    "nashville",
  ]);
  assert.ok(out.includes(`${OPEN}0${SEP}MNPD${CLOSE}`));
  assert.ok(out.includes(`${OPEN}1${SEP}Nashville${CLOSE}`));
  assert.equal(unwrap(out), "MNPD and Nashville share this story.");
});

test("wrapEntityMentions: a mention inside a grounding chip is skipped, not nested", () => {
  // Simulates markdown.tsx's pipeline: grounding wrap ran first, so the
  // content already carries a grounding sentinel pair around "Nashville".
  const grounded = `Replied to ${groundedChip(0, "Nashville")} directly.`;
  const out = wrapEntityMentions(grounded, ["nashville"]);
  assert.equal(out, grounded, "entity wrapping must not touch the chip's text");
});

test("wrapEntityMentions: empty/undefined entity list returns content untouched", () => {
  const content = "MNPD handled it.";
  assert.equal(wrapEntityMentions(content, undefined), content);
  assert.equal(wrapEntityMentions(content, []), content);
});

test("wrapEntityMentions: 'user' (self-fact giver's subject) and ids under 3 chars are noise-gated", () => {
  const content = "The user agreed, as did us.";
  const out = wrapEntityMentions(content, ["user", "us"]);
  assert.equal(out, content);
});

test("wrapEntityMentions: multi-word id survives a flexible whitespace run", () => {
  const out = wrapEntityMentions("Metro   Nashville responded quickly.", [
    "metro nashville",
  ]);
  assert.ok(out.includes(`${OPEN}0${SEP}Metro   Nashville${CLOSE}`));
});

test("wrapEntityMentions: a mention that straddles a grounding sentinel pair cannot match (no corruption)", () => {
  // "nashville" is fully wrapped by the grounding chip; the multi-word id
  // "nashville police" would need to cross the sentinel pair — it must NOT
  // match, and the text must come out unchanged.
  const grounded = `${groundedChip(0, "Nashville")} police responded.`;
  const out = wrapEntityMentions(grounded, ["nashville police"]);
  assert.equal(out, grounded);
});
