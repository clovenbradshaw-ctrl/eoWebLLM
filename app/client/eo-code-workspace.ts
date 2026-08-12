// eo-code-workspace.ts — an in-browser, persistent coding workspace: a
// lightning-fs instance a coding-mode agent loop (eo-code-loop.ts) can
// read, write, and edit files in, with no server and no Node `fs`.
//
// Reuses eo-repo-clone.ts's `ClonedRepo` shape ({fs, dir}) on purpose — a
// workspace and a cloned repo are the same thing to isomorphic-git/
// lightning-fs, so `listFiles`/`readFileText` from that file work unchanged
// against a workspace. The one real difference: `cloneRepo` opens its
// lightning-fs instance with `{wipe: true}` (a clone is disposable scratch
// space); a workspace must NOT wipe on open, since the whole point is that
// it survives across sessions (IndexedDB-backed, same as a clone's storage,
// just addressed by workspace id instead of repo URL).
//
// eochat's tools.mjs (read_file/write_file/edit_file/list_files) reads and
// writes through node:fs's synchronous calls; this is the same "reimplement
// for the browser, don't copy" reimplementation eo-repo-clone.ts's own
// header states — lightning-fs's async fs.promises API stands in for
// node:fs throughout.
//
// Source of the tool semantics ported here:
//   eochat/eval/agent/tools.mjs (read_file, write_file, edit_file,
//   replace_in_file — splice-tools.mjs)
//   eochat/eval/agent/repo-fetch.mjs (fetch_repo_files — never overwrite,
//   report on miss)
//   https://github.com/clovenbradshaw-ctrl/eochat

import LightningFS from "@isomorphic-git/lightning-fs";
import {
  cloneRepo,
  listFiles as listClonedFiles,
  readFileText as readClonedFileText,
  type ClonedRepo,
} from "./eo-repo-clone";

const MAX_FILE_BYTES = 200_000;
const MAX_FETCH_FILES = 30;

export type CodeWorkspace = ClonedRepo & { id: string };

function safeWorkspaceId(id: string): string {
  return (
    String(id)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 80) || "workspace"
  );
}

async function mkdirp(
  fs: InstanceType<typeof LightningFS>,
  path: string,
): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur += `/${part}`;
    try {
      await fs.promises.mkdir(cur);
    } catch {
      // already exists — fine, this is mkdir -p, not mkdir
    }
  }
}

/**
 * Opens (creating on first use) a workspace's virtual filesystem. Never
 * wipes existing content — re-opening the same id is how a coding session
 * resumes across page loads, the entire reason this exists instead of just
 * reusing cloneRepo's disposable-scratch instances directly.
 */
export async function openWorkspace(rawId: string): Promise<CodeWorkspace> {
  const id = safeWorkspaceId(rawId);
  const fs = new LightningFS(`eo-code-workspace:${id}`);
  const dir = "/workspace";
  await mkdirp(fs, dir);
  return { id, fs, dir };
}

export const listFiles = listClonedFiles;
export const readFileText = readClonedFileText;

/**
 * Full-file overwrite, creating parent directories as needed — direct port
 * of tools.mjs's write_file.
 */
export async function writeFile(
  ws: CodeWorkspace,
  relPath: string,
  content: string,
): Promise<{ error: string | null }> {
  const abs = `${ws.dir}/${relPath}`;
  const parentDir = abs.slice(0, abs.lastIndexOf("/"));
  try {
    await mkdirp(ws.fs, parentDir);
    await ws.fs.promises.writeFile(abs, content, "utf8");
    return { error: null };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Surgical string replace requiring the target text appear EXACTLY once —
 * direct port of tools.mjs's edit_file. Refuses on zero or multiple matches
 * rather than guessing which occurrence was meant; the caller (the agent
 * loop) reports this back to the model as a normal failed-tool observation,
 * not a thrown exception, so it's just one more turn to try again.
 */
export async function editFile(
  ws: CodeWorkspace,
  relPath: string,
  oldText: string,
  newText: string,
): Promise<{ error: string | null }> {
  const { text, error } = await readFileText(ws, relPath);
  if (error || text === null) return { error: error || "file not found" };
  const occurrences = text.split(oldText).length - 1;
  if (occurrences === 0)
    return { error: "target text not found in file — no edit made" };
  if (occurrences > 1)
    return {
      error: `target text appears ${occurrences} times — must be unique, no edit made`,
    };
  return writeFile(ws, relPath, text.replace(oldText, newText));
}

/**
 * Global find/replace across the whole file — direct port of
 * splice-tools.mjs's replace_in_file, the complement to editFile's
 * uniqueness requirement for when every occurrence should change.
 */
export async function replaceInFile(
  ws: CodeWorkspace,
  relPath: string,
  oldText: string,
  newText: string,
): Promise<{ error: string | null; replacedCount: number }> {
  const { text, error } = await readFileText(ws, relPath);
  if (error || text === null)
    return { error: error || "file not found", replacedCount: 0 };
  const replacedCount = text.split(oldText).length - 1;
  if (replacedCount === 0)
    return { error: "target text not found in file", replacedCount: 0 };
  const result = await writeFile(
    ws,
    relPath,
    text.split(oldText).join(newText),
  );
  return { error: result.error, replacedCount };
}

/**
 * Seeds a workspace from a real GitHub repo: clones it (eo-repo-clone.ts),
 * then copies named paths into the workspace at the SAME relative path.
 * Ported semantics from eochat's fetch_repo_files, stated there and kept
 * here: never overwrites a file the workspace already has (a seeding
 * action, not a sync — L-B in EOCODE-AGENT-LAWS-PROPOSED.md), and reports
 * `missing` (a requested path that isn't actually in the clone) rather than
 * silently skipping it, so the model sees its own wrong guess instead of a
 * quiet no-op.
 */
export async function fetchRepoIntoWorkspace(
  ws: CodeWorkspace,
  url: string,
  requestedPaths?: string[],
): Promise<{
  copied: string[];
  skipped: string[];
  missing: string[];
  repoFiles: string[];
  error: string | null;
}> {
  const { result: cloned, error } = await cloneRepo(url);
  if (!cloned || error)
    return {
      copied: [],
      skipped: [],
      missing: [],
      repoFiles: [],
      error: error || "clone failed",
    };

  const available = await listClonedFiles(cloned);
  const wanted = (
    requestedPaths && requestedPaths.length
      ? requestedPaths
      : available.slice(0, MAX_FETCH_FILES)
  ).slice(0, MAX_FETCH_FILES);

  const copied: string[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];

  for (const relPath of wanted) {
    if (!available.includes(relPath)) {
      missing.push(relPath);
      continue;
    }
    const existing = await readFileText(ws, relPath);
    if (existing.text !== null) {
      skipped.push(relPath);
      continue;
    }
    const { text, error: readErr } = await readClonedFileText(cloned, relPath);
    if (readErr || text === null) {
      missing.push(relPath);
      continue;
    }
    const writeResult = await writeFile(ws, relPath, text);
    if (writeResult.error) missing.push(relPath);
    else copied.push(relPath);
  }

  return { copied, skipped, missing, repoFiles: available, error: null };
}

export { MAX_FILE_BYTES };
