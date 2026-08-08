// gen-instruction-bundle.mjs
//
// Generates app/client/eo-instruction-set.ts — a snapshot of the eochat
// instruction set (surf/fold instruction folds) bundled into this app so the
// gate always has a corpus to work from, even offline.
//
// The live, canonical copy lives in the eochat repository (the "gh version" of
// the app). At runtime eo-instructions.ts refreshes this snapshot from
// https://github.com/clovenbradshaw-ctrl/eochat and caches the freshest copy in
// localStorage; this script is only the offline fallback and the first-load
// baseline.
//
// Usage:  node scripts/gen-instruction-bundle.mjs  (from repo root)
//   Env:  EO_INSTRUCTION_DIR  override the source directory
//
// Regenerate whenever the eochat instruction set changes upstream.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SOURCE_DIR = process.env.EO_INSTRUCTION_DIR
  ? path.resolve(process.env.EO_INSTRUCTION_DIR)
  : path.resolve(REPO_ROOT, "../eochat/instruction-set");
const OUT_PATH = path.join(REPO_ROOT, "app/client/eo-instruction-set.ts");

const sourceDir = DEFAULT_SOURCE_DIR;
if (!fs.existsSync(sourceDir)) {
  console.error(`Instruction directory not found: ${sourceDir}`);
  console.error("Pass EO_INSTRUCTION_DIR=<path to eochat/instruction-set> to point at a checkout.");
  process.exit(1);
}

const names = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".md")).sort();
const raws = names.map((name) => fs.readFileSync(path.join(sourceDir, name), "utf8"));

const header = `// eo-instruction-set.ts — GENERATED, DO NOT EDIT BY HAND.
//
// A snapshot of eochat's instruction-set/*.md (${raws.length} folds), bundled so
// the eoWebLLM instruction gate always has a corpus. Regenerate with:
//   node scripts/gen-instruction-bundle.mjs
//
// Source: https://github.com/clovenbradshaw-ctrl/eochat/tree/main/instruction-set
// The canonical, live copy is refreshed at runtime from that repository.

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

export const BUNDLED_INSTRUCTION_SOURCE =
  "https://github.com/clovenbradshaw-ctrl/eochat/tree/main/instruction-set";
`;

fs.writeFileSync(OUT_PATH, header + body + footer);
console.log(`Wrote ${OUT_PATH} (${raws.length} folds, ${body.split("\n").length} lines)`);
