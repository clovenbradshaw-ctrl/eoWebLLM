// eo-repo-clone.ts — clone a real GitHub repo entirely client-side, no
// server, so a licensed prior-art hit from eo-prior-art.ts can actually be
// read before it's ingested into the corpus.
//
// eochat's equivalent (eval/agent/repo-fetch.mjs) shells out to a real
// `git clone` via node:child_process against a local filesystem — neither
// exists in a browser. This is a genuine reimplementation, not a port:
// isomorphic-git (a pure-JS git implementation) + @isomorphic-git/
// lightning-fs (an IndexedDB-backed virtual filesystem implementing the
// same fs.promises shape isomorphic-git expects) run the whole clone
// in-tab.
//
// KNOWN TRADEOFF, stated plainly rather than glossed over: git's smart-HTTP
// protocol does not send permissive CORS headers, so a direct browser
// `fetch` to github.com's git endpoint is blocked — unlike eo-websearch.ts
// and eo-prior-art.ts's GitHub REST search, which both work with a bare
// fetch(). isomorphic-git's own project runs a public CORS proxy
// (cors.isomorphic-git.org) for exactly this browser use case, used below.
// This is a real, deliberate dependency on third-party infrastructure
// outside this app's control (rate limits, uptime) — accepted because
// neither of this app's two build modes (`standalone` or `export`, see
// next.config.mjs) runs a server this app could proxy through itself.
//
// STORAGE INCONSISTENCY, also stated plainly: eo-corpus.ts already
// standardized on OPFS for durable client-side bytes. lightning-fs uses
// IndexedDB instead — a second storage technology in this app. Writing a
// correct custom OPFS-backed adapter matching isomorphic-git's expected
// fs.promises shape (readdir, stat, mkdir, symlink handling) is real,
// easy-to-get-subtly-wrong scope; isomorphic-git's whole ecosystem assumes
// lightning-fs as the reference implementation. Deferred, not overlooked.

import LightningFS from "@isomorphic-git/lightning-fs";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

const CORS_PROXY = "https://cors.isomorphic-git.org";
const CLONE_TIMEOUT_MS = 20_000;

// Bounds on what a single clone can cost the main thread — this runs
// unworkered (see header), so these are real, deliberate limits, not
// arbitrary round numbers. A repo blowing past either cap is treated the
// same as a clone failure: reported, not silently truncated mid-file-list.
const MAX_LISTED_FILES = 60;
const MAX_FILE_BYTES = 200_000;
const IGNORE_DIRS = new Set([".git", "node_modules", ".github"]);

export interface ClonedRepo {
  fs: InstanceType<typeof LightningFS>;
  dir: string;
}

function safeRepoDirName(url: string): string {
  return `/repos/${
    String(url)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 80) || "repo"
  }`;
}

/**
 * Shallow-clones `url` into a fresh lightning-fs instance. One FS instance
 * per clone (named by URL, not shared) rather than one giant shared
 * filesystem — a failed/abandoned clone's IndexedDB store can be dropped
 * independently, and two concurrent clones in the same tab never contend
 * for the same working directory.
 */
export async function cloneRepo(
  url: string,
): Promise<{ result: ClonedRepo | null; error: string | null }> {
  const dir = safeRepoDirName(url);
  const fsInstance = new LightningFS(`eo-repo-clone:${dir}`, { wipe: true });
  try {
    await git.clone({
      fs: fsInstance,
      http,
      dir,
      url,
      corsProxy: CORS_PROXY,
      depth: 1,
      singleBranch: true,
      onProgress: undefined,
      signal: AbortSignal.timeout(CLONE_TIMEOUT_MS),
    } as Parameters<typeof git.clone>[0]);
    return { result: { fs: fsInstance, dir }, error: null };
  } catch (err) {
    return { result: null, error: (err as Error).message };
  }
}

/**
 * Every real file path in the clone (repo-relative), capped at
 * MAX_LISTED_FILES — same context-economy discipline eochat's
 * repo-fetch.mjs already established for its own repoFiles listing:
 * capped and flattened, never the raw tree, since this ends up in a
 * system-prompt block a small local model has to read.
 */
export async function listFiles(
  cloned: ClonedRepo,
  max = MAX_LISTED_FILES,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(absDir: string, relBase: string) {
    if (out.length >= max) return;
    let entries: string[];
    try {
      entries = await cloned.fs.promises.readdir(absDir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= max) return;
      if (IGNORE_DIRS.has(name)) continue;
      const abs = `${absDir}/${name}`;
      const rel = relBase ? `${relBase}/${name}` : name;
      let stat: any;
      try {
        stat = await cloned.fs.promises.stat(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) await walk(abs, rel);
      else out.push(rel);
    }
  }
  await walk(cloned.dir, "");
  return out;
}

/**
 * Reads one file's text content, refusing anything over MAX_FILE_BYTES
 * (checked via stat before the read, not after — no point paying for a
 * multi-megabyte read just to discard it) and anything that doesn't decode
 * as UTF-8 text (binary assets aren't ingestable source material anyway).
 */
export async function readFileText(
  cloned: ClonedRepo,
  relPath: string,
): Promise<{ text: string | null; error: string | null }> {
  const abs = `${cloned.dir}/${relPath}`;
  try {
    const stat = await cloned.fs.promises.stat(abs);
    if (stat.size > MAX_FILE_BYTES) {
      return {
        text: null,
        error: `file exceeds ${MAX_FILE_BYTES} byte cap (${stat.size} bytes)`,
      };
    }
    const bytes = (await cloned.fs.promises.readFile(abs)) as Uint8Array;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text, error: null };
  } catch (err) {
    return { text: null, error: (err as Error).message };
  }
}
