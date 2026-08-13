#!/usr/bin/env node
// eoWebLLM · scripts/check-doc-citations — verify that backtick-quoted
// file/function citations in LAWS.md and eoreader6's NEXT-*.md planning
// docs still point at something real.
//
// Built after an audit found LAWS.md citing `eoreader6/READING-POLICY.md`,
// `eoreader6/CLAUDE.md`, and `goldens/network/read.mjs` — three files that
// were never built, ever, in either repo's git history — plus two cases
// where real behavior was attributed to the wrong file/function
// (`referents/cooccurrence.js::mergeAliasedEntities` instead of
// `referents/consequence.js::identityByConsequence`; a "climb-response
// prompt" attributed to `eo-warrant.ts` instead of `app/store/chat.ts`).
// None of these were code drifting away from once-true docs — full-history
// search showed they were never true. A doc that asserts a canonical file
// is itself a load-bearing artifact people build the next feature on top
// of, so its claims need the same "re-earned, never grandfathered"
// discipline SEED.md already applies to code.
//
// This is a citation checker, not a content checker: it confirms a cited
// path exists (and, weakly, that a cited line number is in range, and that
// a cited `::functionName` appears in the file as a word) — it cannot tell
// you the quoted PROSE next to a valid citation is accurate. Treat a clean
// run as "nothing points at thin air," not "every claim was re-verified."
//
// Usage: node scripts/check-doc-citations.mjs [--verbose]

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBLLM_ROOT = resolve(HERE, "..");
const EOREADER6_ROOT = join(WEBLLM_ROOT, "eoreader6");
const EOREADER6_ENGINE = join(EOREADER6_ROOT, "packages", "engine");
const EOREADER6_PACKAGES = join(EOREADER6_ROOT, "packages");

const VERBOSE = process.argv.includes("--verbose");

// Every doc worth checking, and which root(s) its citations should resolve
// against. LAWS.md freely mixes eoWebLLM-relative paths (`app/store/chat.ts`),
// eoreader6-root-relative paths (`nul/index.js`, `packages/host/corpus.js`),
// eoreader6 organ SUBPATHS written the way package.json's finer-grained
// `exports` entries expose them rather than as filesystem paths
// (`perceiver/text/surfaces.js`, `referents/entity.js` — actually under
// packages/engine/), and the coarser `engine/...`/`host/...` shorthand
// matching package.json's own `"./engine"`/`"./host"` export aliases
// (`engine/holon/task-log.js` meaning packages/engine/holon/task-log.js).
// All roots are tried; file-exists-in-any counts as found. The NEXT-*.md/
// CUBE.md docs live inside eoreader6 and cite the same mix of forms.
const EOREADER6_ROOTS = [EOREADER6_ROOT, EOREADER6_ENGINE, EOREADER6_PACKAGES];
const DOCS = [
  { path: join(WEBLLM_ROOT, "LAWS.md"), roots: [WEBLLM_ROOT, ...EOREADER6_ROOTS] },
  { path: join(EOREADER6_ROOT, "NEXT-LEVEL1-PROMOTION.md"), roots: EOREADER6_ROOTS },
  { path: join(EOREADER6_ROOT, "NEXT-EXISTENCE-DEPENDENCY-GROWTH-ARTIFACT.md"), roots: EOREADER6_ROOTS },
  { path: join(EOREADER6_ROOT, "CUBE.md"), roots: EOREADER6_ROOTS },
  { path: join(EOREADER6_ROOT, "KERNEL_REBUILD_CHECKPOINT.md"), roots: EOREADER6_ROOTS },
].filter((d) => existsSync(d.path));

// For a bare filename with no directory component (shorthand like
// `entity.js` or `self.js`, used after the full path was already given
// earlier in the same sentence) — a full recursive search of the doc's own
// roots, returning EVERY match rather than the first: several unrelated
// organs share a basename (six perceiver modalities each have their own
// `material.js`; both `emergence/tiers.js` and `packages/host/tiers.js`
// exist), and picking one arbitrarily produced false LINE-OUT-OF-RANGE
// reports against the wrong same-named file. Callers should treat the
// citation as resolved if ANY candidate satisfies it.
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build"]);
const findAllByBasename = (roots, basename) => {
  const found = [];
  for (const root of roots) {
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) stack.push(join(dir, entry.name));
        } else if (entry.name === basename) {
          found.push(join(dir, entry.name));
        }
      }
    }
  }
  return found;
};

// Matches a backtick-quoted citation shaped like a path, optionally followed
// by `:line` / `:line-line` / `:line,line-line` and/or `::symbolName`.
// Deliberately conservative — false negatives (a real citation this misses)
// are fine, false positives (flagging prose that isn't really a citation)
// are the failure mode to avoid, so it requires either a `/` or a known code
// extension before trusting a backtick span is a path.
const CITATION_RE =
  /`([A-Za-z0-9_.\/-]+\.(?:js|mjs|ts|tsx|json|md))((?::[\d,-]+)?)(?:::([A-Za-z0-9_$]+))?`/g;

const readLineCount = (absPath) => {
  try {
    return readFileSync(absPath, "utf8").split("\n").length;
  } catch {
    return null;
  }
};

const maxLineIn = (rangeSpec) => {
  if (!rangeSpec) return null;
  const nums = rangeSpec.replace(/^:/, "").split(/[,-]/).map(Number).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : null;
};

// Every plausible absolute path this citation's relPath could mean —
// usually one, but several for an ambiguous bare-filename shorthand.
const resolveCandidates = (relPath, roots) => {
  for (const root of roots) {
    const abs = join(root, relPath);
    if (existsSync(abs) && statSync(abs).isFile()) return [abs];
  }
  if (!relPath.includes("/")) return findAllByBasename(roots, relPath);
  return [];
};

let totalCitations = 0;
let problems = 0;

for (const doc of DOCS) {
  const text = readFileSync(doc.path, "utf8");
  const relDocPath = doc.path.replace(WEBLLM_ROOT + "/", "");
  const seen = new Set();
  let match;
  CITATION_RE.lastIndex = 0;
  while ((match = CITATION_RE.exec(text))) {
    const [full, relPath, rangeSpec, symbol] = match;
    const dedupeKey = full;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    totalCitations++;

    const candidates = resolveCandidates(relPath, doc.roots);
    if (candidates.length === 0) {
      problems++;
      console.log(`MISSING-FILE   ${relDocPath}: ${full}`);
      continue;
    }

    const maxLine = maxLineIn(rangeSpec);
    const symbolRe = symbol
      ? new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
      : null;

    const satisfied = candidates.some((absPath) => {
      if (maxLine != null) {
        const lineCount = readLineCount(absPath);
        if (lineCount != null && maxLine > lineCount) return false;
      }
      if (symbolRe && !symbolRe.test(readFileSync(absPath, "utf8"))) return false;
      return true;
    });

    if (!satisfied) {
      problems++;
      const reason = symbol ? "MISSING-SYMBOL" : "LINE-OUT-OF-RANGE";
      console.log(`${reason.padEnd(14)} ${relDocPath}: ${full}  (checked ${candidates.length} candidate(s) for "${relPath}")`);
      continue;
    }

    if (VERBOSE) console.log(`ok             ${relDocPath}: ${full}`);
  }
}

console.log(`\n${totalCitations} citation(s) checked across ${DOCS.length} doc(s), ${problems} problem(s) found.`);
if (problems > 0) process.exit(1);
