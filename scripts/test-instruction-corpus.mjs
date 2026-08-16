// test-instruction-corpus.mjs — the assay for standing on our own feet.
//
// The failure this forbids: the app quietly depending on another repository
// being alive. eochat is being retired. Every fold the gate surfaces, and every
// byte it needs to surface them, has to be in this repository — and the
// compiled bundle has to actually match the .md files it claims to be compiled
// from, or a fold edit ships to nobody.
//
// Run: yarn test

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseInstructionFolds } from "../app/client/eo-gate.ts";
import {
  BUNDLED_INSTRUCTION_SET,
  BUNDLED_INSTRUCTION_SOURCE,
} from "../app/client/eo-instruction-set.ts";

// eo-instructions.ts is not imported here: its own imports are extensionless
// (correct for the bundler, unresolvable under node's type-stripping loader).
// Nothing is lost — that module's whole body is
// `parseInstructionFolds(BUNDLED_INSTRUCTION_SET)`, which is what these tests
// run directly, plus the no-network check below that reads it as text.
const loadedFolds = () => parseInstructionFolds(BUNDLED_INSTRUCTION_SET);

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CORPUS_DIR = path.join(REPO_ROOT, "instruction-set");

test("the instruction corpus is checked into this repository", () => {
  assert.ok(
    fs.existsSync(CORPUS_DIR),
    "instruction-set/ must exist here, not in a sibling checkout",
  );
  const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".md"));
  assert.ok(files.length > 0, "the corpus is empty");
});

test("the compiled bundle matches the .md files it was compiled from", () => {
  // A stale bundle is the quiet failure mode here: the .md edit looks done, the
  // gate keeps serving the old rule, and nothing says so.
  const names = fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const onDisk = names.map((n) =>
    fs.readFileSync(path.join(CORPUS_DIR, n), "utf8"),
  );
  assert.equal(
    BUNDLED_INSTRUCTION_SET.length,
    onDisk.length,
    "fold count differs — run: node scripts/gen-instruction-bundle.mjs",
  );
  for (let i = 0; i < onDisk.length; i++) {
    assert.equal(
      BUNDLED_INSTRUCTION_SET[i].replace(/\r\n/g, "\n"),
      onDisk[i].replace(/\r\n/g, "\n"),
      `${names[i]} differs from the bundle — run: node scripts/gen-instruction-bundle.mjs`,
    );
  }
});

test("nothing in the corpus path points at another repository at runtime", () => {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, "app/client/eo-instructions.ts"),
    "utf8",
  );
  // Comments may name eochat — that is honest provenance. Fetching from it is
  // the thing that must not come back.
  const code = src
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.doesNotMatch(code, /fetch\s*\(/, "the loader must not fetch anything");
  assert.doesNotMatch(
    code,
    /api\.github\.com|githubusercontent|github\.com/,
    "the loader must not reference a remote repository",
  );
  assert.doesNotMatch(
    BUNDLED_INSTRUCTION_SOURCE,
    /^https?:/,
    "the corpus source is a path in this repo, not a URL",
  );
});

test("every fold loads through the real gate parser", () => {
  // parseInstructionFolds throws on a fold with no id, and on a conditional
  // fold that declares no signals (it could never surface — a wall). Loading
  // the whole corpus through it is what makes that a build-time failure rather
  // than a silently unreachable rule.
  const folds = parseInstructionFolds(BUNDLED_INSTRUCTION_SET);
  assert.equal(folds.length, BUNDLED_INSTRUCTION_SET.length);
  for (const f of folds) {
    assert.ok(f.id, "a fold has no id");
    assert.ok(f.fingerprint, `${f.id} has no fingerprint — it would fold to a bare title`);
    if (!f.always)
      assert.ok(f.signals.length, `${f.id} is conditional but can never surface`);
  }
});

test("some rules are in force on every turn", () => {
  const always = loadedFolds().filter((f) => f.always);
  assert.ok(
    always.length > 0,
    "no always-on folds — a turn matching nothing would be ungoverned",
  );
});

test("the grounding fold is in force on every turn", () => {
  // The rule that a paraphrase cannot carry a claim is not a conditional
  // nicety — it governs the turns that never mention grounding at all, which
  // are exactly the turns most likely to reconstruct a fact from a summary.
  const grounding = loadedFolds().find((f) => f.id === "core-grounding");
  assert.ok(grounding, "core-grounding is missing from the corpus");
  assert.equal(grounding.always, true, "core-grounding must be always-on");
});
