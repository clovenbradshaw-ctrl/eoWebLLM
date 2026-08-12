// eo-coherence-check.ts — CRISPR.md pipeline stage 10 (the coherence gate),
// ported so a cloned repo (eo-repo-clone.ts) gets checked before its files
// are ever ingested into the corpus, not just after a fetch succeeds.
//
// Verification that a clone SUCCEEDED says nothing about whether the files
// it copied actually relate to each other the way the real implementation
// did, or just happen to sit in the same repo — a search/clone step can
// easily grab a topically-similar but structurally disconnected set of
// files. This answers that by building a REAL import graph over the cloned
// files and running eochat's deriveLevels() (server/task-log.js) over it —
// a real existence-dependency test ("B cannot exist without A" => A is
// above B; a pair earning neither test is a first-class PEER result, not a
// forced hierarchy), pointed at code instead of an abstract task list.
//
// Ported, not copied: eochat's version (eval/agent/coherence-check.mjs)
// reads via node:fs's synchronous readFileSync/readdirSync/statSync, none
// of which exist in a browser. This version reads through lightning-fs's
// async fs.promises API instead (see eo-repo-clone.ts). The algorithm
// itself — deriveLevels, the import-graph construction, the "isolated file
// = incoherent" verdict — is unchanged.
//
// HONEST LIMIT, carried over from the source: only existence-dependency is
// implemented (the other named test, possibility-constraint, has no
// working definition anywhere in eochat either). This can tell you two
// cloned files are unrelated, or related by a real import edge; it cannot
// yet tell you a real edge is wired CORRECTLY, or catch coupling that
// exists at runtime but not in the import graph.
//
// Source of the ported logic: eochat/eval/agent/coherence-check.mjs and
// eochat/server/task-log.js (deriveLevels)
//   https://github.com/clovenbradshaw-ctrl/eochat

import type { ClonedRepo } from "./eo-repo-clone";

interface Task {
  task_id: string;
  depends_on: string[];
}

interface Relation {
  a: string;
  b: string;
  relation: "a-above-b" | "b-above-a" | "peer";
  earned_by: "existence-dependency" | null;
}

export interface CoherenceResult {
  files: string[];
  relations: Relation[];
  relatedCount: number;
  peerCount: number;
  isolated: string[];
  coherent: boolean;
}

/**
 * Verbatim port of eochat/server/task-log.js's deriveLevels — pure
 * array/graph logic, no filesystem or Node dependency, so nothing here
 * needed to change crossing into a browser. Cycle detection is kept even
 * though this caller only reads `relations`, to stay a real port rather
 * than a trimmed reimplementation that could silently drift from the
 * source's behavior.
 */
function deriveLevels(tasks: Task[]): { relations: Relation[] } {
  const ids = new Set(tasks.map((t) => t.task_id));
  const above = new Map<string, Set<string>>(
    tasks.map((t) => [t.task_id, new Set<string>()]),
  );

  for (const t of tasks) {
    for (const dep of t.depends_on) {
      if (ids.has(dep)) above.get(t.task_id)!.add(dep);
    }
  }

  const relations: Relation[] = [];
  for (const a of tasks) {
    for (const b of tasks) {
      if (a.task_id >= b.task_id) continue;
      const aAboveB = above.get(b.task_id)!.has(a.task_id);
      const bAboveA = above.get(a.task_id)!.has(b.task_id);
      relations.push({
        a: a.task_id,
        b: b.task_id,
        relation: aAboveB ? "a-above-b" : bAboveA ? "b-above-a" : "peer",
        earned_by: aAboveB || bAboveA ? "existence-dependency" : null,
      });
    }
  }

  return { relations };
}

const CODE_EXTS = [".js", ".mjs", ".jsx", ".ts", ".tsx"];
const IMPORT_RE =
  /(?:import\s+(?:[\w*{}\s,]+\s+from\s+)?|require\(\s*)["']([^"']+)["']/g;

// Minimal POSIX-style path helpers — path.dirname/join/resolve are stubbed
// to `false` for the browser bundle (next.config.mjs), so these can't be
// imported from Node's `path` module the way the eochat source does.
function dirnameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}
function joinPosix(...parts: string[]): string {
  return parts
    .filter((p) => p !== "")
    .join("/")
    .replace(/\/{2,}/g, "/");
}
function normalizeRelative(p: string): string {
  const segs = p.split("/");
  const out: string[] = [];
  for (const seg of segs) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

function resolveImport(
  fromFile: string,
  spec: string,
  allFiles: string[],
): string | null {
  if (!spec.startsWith(".")) return null; // only relative imports are IN the snip — bare specifiers are external packages
  const raw = normalizeRelative(joinPosix(dirnameOf(fromFile), spec));
  const candidates = [
    raw,
    ...CODE_EXTS.map((e) => raw + e),
    ...CODE_EXTS.map((e) => joinPosix(raw, "index" + e)),
  ];
  return candidates.find((c) => allFiles.includes(c)) ?? null;
}

async function buildImportGraph(
  cloned: ClonedRepo,
  files: string[],
): Promise<Task[]> {
  const tasks: Task[] = [];
  for (const f of files) {
    let text = "";
    try {
      const bytes = (await cloned.fs.promises.readFile(
        `${cloned.dir}/${f}`,
      )) as Uint8Array;
      text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      // unreadable file: no edges found, treated as isolated rather than guessed
    }
    const depends_on = new Set<string>();
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(text))) {
      const target = resolveImport(f, m[1], files);
      if (target && target !== f) depends_on.add(target);
    }
    tasks.push({ task_id: f, depends_on: [...depends_on] });
  }
  return tasks;
}

/**
 * Run the coherence gate over a cloned repo's real files. `files` should be
 * the CODE files only (filter listFiles's output by extension before
 * calling this — a coherence check over every file in a repo, including
 * markdown/config/lockfiles, produces noise no import graph could ever
 * relate, the same false-isolated-file failure mode eochat's own version
 * measured and excluded via listCodeFiles).
 */
export async function checkCoherence(
  cloned: ClonedRepo,
  files: string[],
): Promise<CoherenceResult> {
  if (files.length < 2) {
    // A lone file has nothing to be isolated FROM — trivially coherent by
    // vacuous truth, matching eochat's own carve-out for this edge case.
    return {
      files,
      relations: [],
      relatedCount: 0,
      peerCount: 0,
      isolated: [],
      coherent: files.length === 1,
    };
  }

  const tasks = await buildImportGraph(cloned, files);
  const { relations } = deriveLevels(tasks);

  const isolated = files.filter(
    (f) =>
      !relations.some((r) => (r.a === f || r.b === f) && r.relation !== "peer"),
  );

  return {
    files,
    relations,
    relatedCount: relations.filter((r) => r.relation !== "peer").length,
    peerCount: relations.filter((r) => r.relation === "peer").length,
    isolated,
    coherent: isolated.length === 0,
  };
}

/** Filters a raw file listing (eo-repo-clone.ts's listFiles) down to real code files, the same corpus checkCoherence's import graph can actually reason about. */
export function filterCodeFiles(files: string[]): string[] {
  return files.filter((f) => CODE_EXTS.some((ext) => f.endsWith(ext)));
}
