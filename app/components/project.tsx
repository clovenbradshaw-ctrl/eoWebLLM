import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./project.module.scss";
import { Plus, ArrowSquareOut } from "@phosphor-icons/react";
import { Path } from "../constant";
import { useChatStore, DEFAULT_TOPIC } from "../store";
import { DocumentExplorer } from "./document-explorer";
import {
  compileProjectInstructionFolds,
  type CompileInstructionsReport,
} from "../client/eo-project-instructions";
import { DEFAULT_INSTRUCTION_BUDGET } from "../client/eo-gate";

// The project-as-container page: a project's chats, its shared documents
// (document-explorer.tsx), and its own standing instructions -- the three
// things store/chat.ts's Project comment says a project should hold. See
// eoBuildProjectInstructionBlock in store/chat.ts for how the Instructions
// tab's text actually reaches a chat turn (segmented into gate folds,
// surfaced per turn the same bounded way the built-in rulebook is).

type Tab = "chats" | "documents" | "instructions";

export function ProjectPage() {
  const chatStore = useChatStore();
  const navigate = useNavigate();
  const project = chatStore.projects.find(
    (p) => p.id === chatStore.currentProjectId,
  );
  const [tab, setTab] = useState<Tab>("chats");

  if (!project) {
    return (
      <div className={styles["project-page"]}>
        <div className={styles["project-chats-empty"]}>
          {chatStore.currentProjectId
            ? "This project no longer exists."
            : "Select a project to view it."}
        </div>
      </div>
    );
  }

  function openLatestChat() {
    let latestIndex = -1;
    let latestUpdate = -1;
    chatStore.sessions.forEach((s, i) => {
      if (s.projectId === project!.id && s.lastUpdate > latestUpdate) {
        latestUpdate = s.lastUpdate;
        latestIndex = i;
      }
    });
    if (latestIndex >= 0) chatStore.selectSession(latestIndex);
    else chatStore.newSession(undefined, project!.id);
    navigate(Path.Chat);
  }

  return (
    <div className={styles["project-page"]}>
      <div className={styles["project-header"]}>
        <div className={styles["project-title"]}>{project.name}</div>
        <div className={styles["project-header-actions"]}>
          <button
            className={styles["project-open-latest"]}
            onClick={openLatestChat}
          >
            <ArrowSquareOut size={14} /> Open latest chat
          </button>
        </div>
      </div>
      <div className={styles["project-tabs"]}>
        {(["chats", "documents", "instructions"] as Tab[]).map((t) => (
          <button
            key={t}
            className={
              styles["project-tab"] + (tab === t ? " " + styles["active"] : "")
            }
            onClick={() => setTab(t)}
          >
            {t === "chats"
              ? "Chats"
              : t === "documents"
                ? "Documents"
                : "Instructions"}
          </button>
        ))}
      </div>
      <div className={styles["project-tab-body"]}>
        {tab === "chats" && <ProjectChats projectId={project.id} />}
        {tab === "documents" && <DocumentExplorer projectId={project.id} />}
        {tab === "instructions" && (
          <ProjectInstructions
            projectId={project.id}
            instructions={project.instructions ?? ""}
          />
        )}
      </div>
    </div>
  );
}

function ProjectChats(props: { projectId: string }) {
  const chatStore = useChatStore();
  const navigate = useNavigate();
  const sessions = chatStore.sessions.filter(
    (s) => s.projectId === props.projectId,
  );

  function openSession(sessionId: string) {
    const index = chatStore.sessions.findIndex((s) => s.id === sessionId);
    if (index >= 0) chatStore.selectSession(index);
    navigate(Path.Chat);
  }

  function newChat() {
    chatStore.newSession(undefined, props.projectId);
    navigate(Path.Chat);
  }

  return (
    <div className={styles["project-chats"]}>
      <div className={styles["project-chats-header"]}>
        <div>
          {sessions.length} chat{sessions.length === 1 ? "" : "s"}
        </div>
        <button className={styles["project-new-chat"]} onClick={newChat}>
          <Plus size={14} /> New chat
        </button>
      </div>
      {!sessions.length ? (
        <div className={styles["project-chats-empty"]}>
          No chats in this project yet.
        </div>
      ) : (
        <div className={styles["project-chat-list"]}>
          {sessions
            .slice()
            .sort((a, b) => b.lastUpdate - a.lastUpdate)
            .map((s) => (
              <div
                key={s.id}
                className={styles["project-chat-item"]}
                onClick={() => openSession(s.id)}
              >
                <span className={styles["project-chat-item-title"]}>
                  {s.topic || DEFAULT_TOPIC}
                </span>
                <span className={styles["project-chat-item-meta"]}>
                  {s.messages.length} msg
                  {s.messages.length === 1 ? "" : "s"} ·{" "}
                  {new Date(s.lastUpdate).toLocaleDateString()}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// Debounced so every keystroke doesn't re-run the segmentation/budget-fit
// loop -- compileProjectInstructionFolds is pure and cheap for normal
// instruction lengths, but there's no reason to run it more than a few
// times a second while the reader is actively typing.
const PREVIEW_DEBOUNCE_MS = 300;

function ProjectInstructions(props: {
  projectId: string;
  instructions: string;
}) {
  const chatStore = useChatStore();
  const [text, setText] = useState(props.instructions);
  const [report, setReport] = useState<CompileInstructionsReport | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setReport(compileProjectInstructionFolds(text).report);
      if (text !== props.instructions) {
        chatStore.updateProjectInstructions(props.projectId, text);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const summary = useMemo(() => {
    if (!report || report.mode === "empty") return null;
    if (report.mode === "whole") {
      return `${report.totalTokens} tokens — within the ${report.budgetTokens}-token budget, so all of it is in force every turn.`;
    }
    return (
      `${report.totalTokens} tokens — over the ${report.budgetTokens}-token budget, so it's folded: ` +
      `${report.folds} fold(s) (${report.alwaysOn} always-on, ${report.conditional} conditional).`
    );
  }, [report]);

  return (
    <div className={styles["project-instructions"]}>
      <p className={styles["project-instructions-note"]}>
        Standing instructions for every chat in this project. Reaches the model
        verbatim, never rewritten or summarized — long instructions are
        segmented into named sections and only the sections relevant to a given
        turn are surfaced, the rest listed by name (budget:{" "}
        {DEFAULT_INSTRUCTION_BUDGET} tokens). Use markdown headings (
        <code>##</code>) to mark sections.
      </p>
      <textarea
        className={styles["project-instructions-textarea"]}
        value={text}
        placeholder={
          "e.g.\n\n## Tone\nAnswer formally, no emoji.\n\n## Output format\nAlways give the SQL query before explaining it."
        }
        onChange={(e) => setText(e.target.value)}
        onBlur={() =>
          chatStore.updateProjectInstructions(props.projectId, text)
        }
      />
      {summary && (
        <div className={styles["project-instructions-summary"]}>
          <span>{summary}</span>
          {!!report?.warning && <strong>{report.warning}</strong>}
        </div>
      )}
    </div>
  );
}
