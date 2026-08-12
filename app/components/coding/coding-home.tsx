"use client";

// coding-home.tsx — coding mode's whole v1 UI: workspace picker, file tree +
// viewer, a developer-facing turn log (tool name + args + result, not the
// conversational Markdown renderer chat.tsx uses — see the plan doc for
// why), and the human approval gate every write/edit/replace call must pass
// before it actually lands in the workspace (eo-code-tools.ts).
//
// This is eoWebLLM's first second route — see app/store/engine.ts's header
// for how the WebLLM engine instance is shared with the chat page instead
// of re-downloaded here.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAppConfig } from "../../store/config";
import { useCodingStore, type CodingWorkspaceMeta } from "../../store/coding";
import { useEngineStore, ensureWebLLMInit } from "../../store/engine";
import {
  openWorkspace as openWs,
  listFiles,
  readFileText,
  type CodeWorkspace,
} from "../../client/eo-code-workspace";
import {
  buildCodeToolset,
  makeFinishGate,
  type PendingChange,
  type CodeToolSessionState,
} from "../../client/eo-code-tools";
import { runCodeLoop, type StepEvent } from "../../client/eo-code-loop";
import { makeCodeGenerate } from "../../client/eo-code-generate";
import styles from "./coding-home.module.scss";

function usePendingApproval() {
  const [pending, setPending] = useState<PendingChange | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const requestApproval = (change: PendingChange): Promise<boolean> => {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setPending(change);
    });
  };

  const respond = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setPending(null);
  };

  return { pending, requestApproval, respond };
}

export function CodingHome() {
  const config = useAppConfig();
  const webllm = useEngineStore((s) => s.webllm);
  const isWebllmActive = useEngineStore((s) => s.isWebllmActive);
  const codingStore = useCodingStore();

  useEffect(() => {
    ensureWebLLMInit(config.logLevel);
  }, []);

  const [ws, setWs] = useState<CodeWorkspace | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [newWsName, setNewWsName] = useState("");
  const [seedRepoUrl, setSeedRepoUrl] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const sessionStateRef = useRef<CodeToolSessionState>({
    seededFromRepo: false,
    coherenceConfirmed: false,
  });

  const { pending, requestApproval, respond } = usePendingApproval();

  const currentMeta = useMemo(
    () =>
      codingStore.workspaces.find(
        (w) => w.id === codingStore.currentWorkspaceId,
      ) ?? null,
    [codingStore.workspaces, codingStore.currentWorkspaceId],
  );

  async function refreshFiles(w: CodeWorkspace) {
    const list = await listFiles(w);
    setFiles(list);
  }

  useEffect(() => {
    if (!currentMeta) {
      setWs(null);
      setFiles([]);
      setSelectedFile(null);
      return;
    }
    let cancelled = false;
    openWs(currentMeta.id).then((w) => {
      if (cancelled) return;
      setWs(w);
      sessionStateRef.current = {
        seededFromRepo: !!currentMeta.seedRepoUrl,
        coherenceConfirmed: false,
      };
      refreshFiles(w);
    });
    return () => {
      cancelled = true;
    };
  }, [currentMeta?.id]);

  useEffect(() => {
    if (!ws || !selectedFile) {
      setFileContent("");
      return;
    }
    let cancelled = false;
    readFileText(ws, selectedFile).then(({ text }) => {
      if (!cancelled) setFileContent(text ?? "(binary or unreadable)");
    });
    return () => {
      cancelled = true;
    };
  }, [ws, selectedFile]);

  function handleCreateWorkspace() {
    const meta = codingStore.createWorkspace(
      newWsName || "untitled workspace",
      seedRepoUrl.trim() || null,
    );
    setNewWsName("");
    void meta;
  }

  async function handleRun() {
    if (!ws || !webllm || !isWebllmActive || !taskPrompt.trim() || running)
      return;
    setRunning(true);
    setEvents([]);

    const toolset = buildCodeToolset(
      ws,
      requestApproval,
      sessionStateRef.current,
    );
    const generate = makeCodeGenerate(
      webllm,
      config.modelConfig.model,
      config.cacheType,
    );
    const validateFinish = makeFinishGate(sessionStateRef.current);

    let prompt = taskPrompt.trim();
    if (currentMeta?.seedRepoUrl && !sessionStateRef.current.seededFromRepo) {
      prompt = `${prompt}\n\n(This workspace should be seeded from ${currentMeta.seedRepoUrl} — call fetch_repo first if it hasn't been fetched yet.)`;
    }

    try {
      await runCodeLoop({
        taskPrompt: prompt,
        toolset,
        generate,
        validateFinish,
        onStep: (event) => {
          setEvents((prev) => [...prev, event]);
          if (event.phase === "tool_result") refreshFiles(ws);
        },
      });
    } finally {
      setRunning(false);
      await refreshFiles(ws);
    }
  }

  return (
    <div className={styles["coding-root"]}>
      <div className={styles["coding-topbar"]}>
        <Link href="/" className={styles["back-link"]}>
          ← Citey chat
        </Link>
        <span className={styles["title"]}>Coding mode</span>
        <span className={styles["engine-status"]}>
          {webllm && isWebllmActive ? "model ready" : "model loading…"}
        </span>
      </div>

      <div className={styles["coding-body"]}>
        <div className={styles["sidebar"]}>
          <div className={styles["workspace-picker"]}>
            <div className={styles["section-title"]}>Workspaces</div>
            {codingStore.workspaces.map((w: CodingWorkspaceMeta) => (
              <button
                key={w.id}
                className={
                  styles["workspace-item"] +
                  (w.id === codingStore.currentWorkspaceId
                    ? " " + styles["active"]
                    : "")
                }
                onClick={() => codingStore.openWorkspace(w.id)}
              >
                {w.name}
                {w.seedRepoUrl ? (
                  <span className={styles["seed-tag"]}>repo</span>
                ) : null}
              </button>
            ))}
            <input
              className={styles["input"]}
              placeholder="new workspace name"
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
            />
            <input
              className={styles["input"]}
              placeholder="seed from GitHub URL (optional)"
              value={seedRepoUrl}
              onChange={(e) => setSeedRepoUrl(e.target.value)}
            />
            <button
              className={styles["button"]}
              onClick={handleCreateWorkspace}
            >
              Create workspace
            </button>
          </div>

          <div className={styles["file-tree"]}>
            <div className={styles["section-title"]}>Files</div>
            {files.map((f) => (
              <button
                key={f}
                className={
                  styles["file-item"] +
                  (f === selectedFile ? " " + styles["active"] : "")
                }
                onClick={() => setSelectedFile(f)}
              >
                {f}
              </button>
            ))}
            {ws && files.length === 0 ? (
              <div className={styles["empty-hint"]}>no files yet</div>
            ) : null}
          </div>
        </div>

        <div className={styles["main"]}>
          <div className={styles["file-viewer"]}>
            <div className={styles["section-title"]}>
              {selectedFile ?? "no file selected"}
            </div>
            <pre className={styles["file-content"]}>{fileContent}</pre>
          </div>

          <div className={styles["turn-log"]}>
            <div className={styles["section-title"]}>Agent turn log</div>
            <div className={styles["log-lines"]}>
              {events.map((e, i) => (
                <div key={i} className={styles["log-line"]}>
                  {formatEvent(e)}
                </div>
              ))}
            </div>
            <textarea
              className={styles["task-input"]}
              placeholder="Describe the change you want made in this workspace…"
              value={taskPrompt}
              onChange={(e) => setTaskPrompt(e.target.value)}
              disabled={running}
            />
            <button
              className={styles["button"]}
              onClick={handleRun}
              disabled={!ws || !webllm || !isWebllmActive || running}
            >
              {running ? "Running…" : "Run agent"}
            </button>
          </div>
        </div>
      </div>

      {pending ? (
        <div className={styles["approval-overlay"]}>
          <div className={styles["approval-modal"]}>
            <div className={styles["section-title"]}>
              Approve {pending.tool} — {pending.path}
            </div>
            <div className={styles["diff-columns"]}>
              <div>
                <div className={styles["diff-label"]}>before</div>
                <pre className={styles["diff-pre"]}>
                  {pending.before ?? "(new file)"}
                </pre>
              </div>
              <div>
                <div className={styles["diff-label"]}>after</div>
                <pre className={styles["diff-pre"]}>{pending.after}</pre>
              </div>
            </div>
            <div className={styles["approval-actions"]}>
              <button
                className={styles["button"]}
                onClick={() => respond(true)}
              >
                Approve
              </button>
              <button
                className={styles["button-secondary"]}
                onClick={() => respond(false)}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatEvent(e: StepEvent): string {
  if (e.phase === "generating") return `step ${e.step}: thinking…`;
  if (e.phase === "folded")
    return `step ${e.step}: (${e.foldedTurns} earlier step(s) folded)`;
  if (e.phase === "tool_call")
    return `step ${e.step}: → ${e.tool}(${JSON.stringify(e.args)})`;
  if (e.phase === "tool_result") {
    const result = e.result as Record<string, unknown> | undefined;
    return `step ${e.step}: ← ${e.tool} ${result && "error" in result ? `ERROR: ${result.error}` : "ok"}`;
  }
  if (e.phase === "malformed")
    return `step ${e.step}: unparseable response — ${e.reason}`;
  if (e.phase === "aborted") return `step ${e.step}: ${e.note}`;
  if (e.phase === "finish")
    return `step ${e.step}: finished — ${JSON.stringify(e.args)}`;
  return `step ${e.step}: ${e.phase}`;
}
