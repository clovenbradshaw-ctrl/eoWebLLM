#!/usr/bin/env node
// eoWebLLM · scripts/check-doc-citations — verify that backtick-quoted
// file/function citations in LAWS.md and eoreader6's NEXT-*.md planning
// docs still point at something real.
//
// Built after an audit found LAWS.md citing an `eo-warrant.ts` prompt that
// lives in `app/store/chat.ts` instead — a real citation attributed to the
// wrong file. A doc that asserts a canonical file is itself a load-bearing
// artifact people build the next feature on top of, so its claims need the
// same "re-earned, never grandfathered" discipline SEED.md already applies
// to code.
//
// IMPORTANT — eoreader6 is a git SUBMODULE, and this environment cannot
// `git fetch` it (network to github.com is blocked here; only the `gh` CLI's
// own API path reaches GitHub). This script's eoreader6-rooted checks can
// therefore only ever see the submodule's currently PINNED commit, not
// eoreader6's live upstream. A first pass through this exact file wrongly
// declared `eoreader6/READING-POLICY.md`, `eoreader6/CLAUDE.md`, and
// `goldens/network/read.mjs` "fabricated" purely because they were missing
// from that stale local pin — all three are real upstream (one merged to
// `main` after the pin, two more on an open PR not yet merged at all),
// confirmed directly against GitHub via `gh api`, not against this
// checkout. A MISSING-FILE result below under an eoreader6 root is
// therefore evidence the file isn't in THIS pinned snapshot, never proof
// it doesn't exist — cross-check with `gh api repos/<org>/eoreader6/contents/<path>`
// (or bump the submodule) before treating a hit here as a fabricated
// citation. This is exactly the mistake this tool exists to catch in
// LAWS.md; it is not exempt from making the same one itself.
//
// This is a citation checker, not a content checker: it confirms a cited
// path exists in what's locally checked out (and, weakly, that a cited line
// number is in range, and that a cited `::functionName` appears in the file
// as a word) — it cannot tell you the quoted PROSE next to a valid citation
// is accurate, and for eoreader6 paths it cannot tell you the citation is
// truly fabricated versus just ahead of this pinned submodule commit. Treat
// a clean run as "nothing points at thin air in what's checked out here,"
// not "every claim was re-verified against the real world."
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
// All roots are tried; file-exists-in-any counts as found.
//
// The NEXT-*.md docs are discovered dynamically (not a hand-picked list) —
// an earlier version hardcoded exactly two filenames while its own header
// claimed to check "eoreader6's NEXT-*.md planning docs" as a class; a
// third such doc added later would have been silently skipped with the run
// still reporting a clean pass. `eoreader6Root` is checked for the
// submodule's own currency below, so a stale root doesn't silently mean
// "no NEXT-*.md docs to check" either.
const EOREADER6_ROOTS = [EOREADER6_ROOT, EOREADER6_ENGINE, EOREADER6_PACKAGES];
const nextDocs = existsSync(EOREADER6_ROOT)
  ? readdirSync(EOREADER6_ROOT).filter((name) => /^NEXT-.*\.md$/i.test(name))
  : [];
const DOCS = [
  { path: join(WEBLLM_ROOT, "LAWS.md"), roots: [WEBLLM_ROOT, ...EOREADER6_ROOTS], eoreader6Rooted: true },
  ...nextDocs.map((name) => ({ path: join(EOREADER6_ROOT, name), roots: EOREADER6_ROOTS, eoreader6Rooted: true })),
  { path: join(EOREADER6_ROOT, "CUBE.md"), roots: EOREADER6_ROOTS, eoreader6Rooted: true },
  { path: join(EOREADER6_ROOT, "KERNEL_REBUILD_CHECKPOINT.md"), roots: EOREADER6_ROOTS, eoreader6Rooted: true },
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
let eoreader6RootedMisses = 0;

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
      if (doc.eoreader6Rooted) eoreader6RootedMisses++;
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
if (eoreader6RootedMisses > 0) {
  console.log(
    `${eoreader6RootedMisses} of those are under an eoreader6 root — this checkout is a submodule pinned to one ` +
    `commit and this environment cannot \`git fetch\` it, so a MISSING-FILE there means "not in this pinned ` +
    `snapshot," not "confirmed fabricated." Cross-check against GitHub (\`gh api repos/<org>/eoreader6/contents/<path>\`) ` +
    `before treating any of them as a fabricated citation.`
  );
}
if (problems > 0) process.exit(1);
