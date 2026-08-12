// eo-code-tools.ts — builds the CodeToolset (eo-code-loop.ts) that wires
// eo-code-workspace.ts's file operations and eo-coherence-check.ts's
// coherence gate into tool-call form, plus the human write-approval gate.
//
// The approval gate exists because of a real, measured failure mode, not as
// generic caution: CRISPR-AGENT-LOOP-HANDOFF.md (eochat) documents this
// exact tool family, at this exact model scale, guessing wrong file paths
// and conflating two tools' results. A small local model choosing WHAT to
// write is not the same as it being right to write it — every write/edit/
// replace call is shown to the reader as a pending before/after change and
// must be approved before it actually lands in the workspace.

import {
  type CodeWorkspace,
  editFile,
  fetchRepoIntoWorkspace,
  listFiles,
  readFileText,
  replaceInFile,
  writeFile,
} from "./eo-code-workspace";
import { checkCoherence, filterCodeFiles } from "./eo-coherence-check";
import type { CodeTool, CodeToolset } from "./eo-code-loop";

export interface PendingChange {
  tool: "write_file" | "edit_file" | "replace_in_file";
  path: string;
  before: string | null;
  after: string;
}

export type RequestApproval = (change: PendingChange) => Promise<boolean>;

export interface CodeToolSessionState {
  /** true once fetch_repo has been called this session — gates finish. */
  seededFromRepo: boolean;
  /** true once check_coherence has run AND reported coherent this session. */
  coherenceConfirmed: boolean;
}

export function buildCodeToolset(
  ws: CodeWorkspace,
  requestApproval: RequestApproval,
  sessionState: CodeToolSessionState,
): CodeToolset {
  const tools: Record<string, CodeTool> = {
    read_file: {
      description: 'Reads one file. args: {"path": "relative/path.ts"}',
      run: async (args) => {
        const path = String(args.path ?? "");
        const { text, error } = await readFileText(ws, path);
        if (error || text === null) return { error: error || "not found" };
        return { content: text };
      },
    },
    list_files: {
      description: "Lists every file currently in the workspace. args: {}",
      run: async () => {
        const files = await listFiles(ws);
        return { files };
      },
    },
    write_file: {
      description:
        'Overwrites (or creates) one file with new full content. Requires human approval before it takes effect. args: {"path": "relative/path.ts", "content": "..."}',
      run: async (args) => {
        const path = String(args.path ?? "");
        const content = String(args.content ?? "");
        const existing = await readFileText(ws, path);
        const approved = await requestApproval({
          tool: "write_file",
          path,
          before: existing.text,
          after: content,
        });
        if (!approved)
          return { error: "rejected by user — change not applied" };
        const result = await writeFile(ws, path, content);
        if (result.error) return { error: result.error };
        return { ok: true };
      },
    },
    edit_file: {
      description:
        'Replaces one EXACT, UNIQUE occurrence of old_text with new_text in a file. Fails if old_text appears zero or more than once. Requires human approval. args: {"path": "...", "old_text": "...", "new_text": "..."}',
      run: async (args) => {
        const path = String(args.path ?? "");
        const oldText = String(args.old_text ?? "");
        const newText = String(args.new_text ?? "");
        const existing = await readFileText(ws, path);
        if (existing.error || existing.text === null)
          return { error: existing.error || "not found" };
        const occurrences = existing.text.split(oldText).length - 1;
        if (occurrences !== 1)
          return {
            error:
              occurrences === 0
                ? "target text not found in file — no edit made"
                : `target text appears ${occurrences} times — must be unique, no edit made`,
          };
        const after = existing.text.replace(oldText, newText);
        const approved = await requestApproval({
          tool: "edit_file",
          path,
          before: existing.text,
          after,
        });
        if (!approved)
          return { error: "rejected by user — change not applied" };
        const result = await editFile(ws, path, oldText, newText);
        if (result.error) return { error: result.error };
        return { ok: true };
      },
    },
    replace_in_file: {
      description:
        'Replaces EVERY occurrence of old_text with new_text in a file. Requires human approval. args: {"path": "...", "old_text": "...", "new_text": "..."}',
      run: async (args) => {
        const path = String(args.path ?? "");
        const oldText = String(args.old_text ?? "");
        const newText = String(args.new_text ?? "");
        const existing = await readFileText(ws, path);
        if (existing.error || existing.text === null)
          return { error: existing.error || "not found" };
        const after = existing.text.split(oldText).join(newText);
        const approved = await requestApproval({
          tool: "replace_in_file",
          path,
          before: existing.text,
          after,
        });
        if (!approved)
          return { error: "rejected by user — change not applied" };
        const result = await replaceInFile(ws, path, oldText, newText);
        if (result.error) return { error: result.error, replacedCount: 0 };
        return { ok: true, replacedCount: result.replacedCount };
      },
    },
    fetch_repo: {
      description:
        'Seeds the workspace from a real public GitHub repo — clones it and copies named files in (never overwrites a file already in the workspace). args: {"url": "https://github.com/owner/repo", "paths": ["optional/specific/paths.ts"]}',
      run: async (args) => {
        const url = String(args.url ?? "");
        const paths = Array.isArray(args.paths)
          ? (args.paths as unknown[]).map(String)
          : undefined;
        const result = await fetchRepoIntoWorkspace(ws, url, paths);
        if (result.error) return { error: result.error };
        sessionState.seededFromRepo = true;
        sessionState.coherenceConfirmed = false;
        return {
          copied: result.copied,
          skipped: result.skipped,
          missing: result.missing,
          repoFiles: result.repoFiles,
        };
      },
    },
    check_coherence: {
      description:
        "Checks that the workspace's code files actually relate to each other (real import graph), not just that a fetch_repo call succeeded. Required after fetch_repo, before finish. args: {}",
      run: async () => {
        const files = filterCodeFiles(await listFiles(ws));
        const result = await checkCoherence(ws, files);
        sessionState.coherenceConfirmed = result.coherent;
        return {
          coherent: result.coherent,
          isolated: result.isolated,
          relatedCount: result.relatedCount,
          peerCount: result.peerCount,
        };
      },
    },
    finish: {
      description:
        'Declares the task complete. Only call this once the requested change is actually made (and, if fetch_repo was used, check_coherence has confirmed it). args: {"summary": "what was done"}',
      run: async () => ({}),
    },
  };

  return { tools };
}

/** validateFinish gate: refuse finish if the workspace was seeded from a repo but coherence was never confirmed — same shape as eochat's coherenceGatedValidateFinish. */
export function makeFinishGate(sessionState: CodeToolSessionState) {
  return () => {
    if (sessionState.seededFromRepo && !sessionState.coherenceConfirmed) {
      return {
        ok: false,
        reason:
          "workspace was seeded from fetch_repo but check_coherence has not confirmed it — run check_coherence and get coherent:true first",
      };
    }
    return { ok: true };
  };
}
