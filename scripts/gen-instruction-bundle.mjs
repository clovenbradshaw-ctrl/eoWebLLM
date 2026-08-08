// gen-instruction-bundle.mjs
//
// Compiles instruction-set/*.md into app/client/eo-instruction-set.ts, the
// corpus the instruction gate surfaces from each turn.
//
// The folds used to live in the eochat repository and be fetched from it at
// runtime; this script produced an offline fallback to that copy. They live
// here now (see app/client/eo-instructions.ts for why), so this is no longer a
// snapshot of anything — it is a build step over this repository's own source,
// and the .md files are what you edit.
//
// Usage:  node scripts/gen-instruction-bundle.mjs  (from repo root)
//   Env:  EO_INSTRUCTION_DIR  override the source directory
//
// Regenerate whenever a fold changes. The generated file is checked in so a
// clean clone builds without running this first.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SOURCE_DIR = process.env.EO_INSTRUCTION_DIR
  ? path.resolve(process.env.EO_INSTRUCTION_DIR)
  : path.resolve(REPO_ROOT, "instruction-set");
const OUT_PATH = path.join(REPO_ROOT, "app/client/eo-instruction-set.ts");

const sourceDir = DEFAULT_SOURCE_DIR;
if (!fs.existsSync(sourceDir)) {
  console.error(`Instruction directory not found: ${sourceDir}`);
  console.error("Expected this repository's own instruction-set/ directory.");
  console.error("Pass EO_INSTRUCTION_DIR=<path> to point somewhere else.");
  process.exit(1);
}

const names = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".md")).sort();
const raws = names.map((name) => fs.readFileSync(path.join(sourceDir, name), "utf8"));

const header = `// eo-instruction-set.ts — GENERATED, DO NOT EDIT BY HAND.
//
// Compiled from this repository's instruction-set/*.md (${raws.length} folds).
// Edit the .md files, then regenerate with:
//   node scripts/gen-instruction-bundle.mjs
//
// The folds were originally written for eochat
// (github.com/clovenbradshaw-ctrl/eochat) and are maintained here now.

export const BUNDLED_INSTRUCTION_SET: string[] = [
`;

const body = raws
  .map((raw) => {
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const rendered = lines
      .map((line) => {
        const escaped = line
          .replace(/\\/g, "\\\\")
          .replace(/`/g, "\\`")
          .replace(/\$\{/g, "\\${");
        return escaped;
      })
      .join("\n");
    return `  \`${rendered}\`,`;
  })
  .join("\n");

const footer = `
];

export const BUNDLED_INSTRUCTION_SOURCE = "instruction-set/";
`;

fs.writeFileSync(OUT_PATH, header + body + footer);
console.log(`Wrote ${OUT_PATH} (${raws.length} folds, ${body.split("\n").length} lines)`);
