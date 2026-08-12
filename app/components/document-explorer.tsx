import { useState } from "react";
import docStyles from "./document-explorer.module.scss";
import {
  Plus,
  File,
  FileText,
  FileCode,
  FilePdf,
  FileDoc,
  FilePpt,
  FileXls,
  Book,
  Notebook,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
} from "@phosphor-icons/react";
import { useChatStore, projectSources } from "../store";
import type { EoSource } from "../client/eo-corpus";
import { ingestFile } from "../client/eo-source-ingest";
import { kindOf } from "../client/eo-file-extract";
import {
  useSourceReader,
  SourceReaderTrigger,
  SourceReaderPanel,
} from "./source-reader";
import { SourceReadAloudButton } from "./read-aloud";

// The project-wide take on chat.tsx's per-session source panel: instead of
// one session's own eoSources, this shows projectSources() -- the union of
// every source enabled anywhere in the project (see the comment on
// projectSources in store/chat.ts). Uploading here has nowhere obvious of
// its own to store bytes against (EoSources live on a session, not on
// Project itself -- see Project's own comment), so a new upload lands on
// the project's most-recently-active session, creating one if the project
// has none yet, the same fallback ProjectsPanel.openProject already uses.
// Reading a document reuses source-reader.tsx's Fold/Events/Raw viewer
// unchanged -- the same component chat.tsx's own source panel uses, not a
// second reader built for this surface.

const KIND_ICON: Record<string, typeof File> = {
  text: FileText,
  code: FileCode,
  data: FileCode,
  pdf: FilePdf,
  document: FileDoc,
  presentation: FilePpt,
  ebook: Book,
  notebook: Notebook,
  spreadsheet: FileXls,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  archive: FileArchive,
};

export function DocumentExplorer(props: { projectId: string }) {
  const chatStore = useChatStore();
  const sessions = chatStore.sessions;
  const sources = projectSources(sessions, props.projectId);
  const [uploading, setUploading] = useState(false);

  // The project's most-recently-updated session, or a fresh one stamped
  // with this project's id if it has none yet -- same fallback
  // ProjectsPanel.openProject uses (projects.tsx).
  function targetSessionId(): string {
    let latestId: string | null = null;
    let latestUpdate = -1;
    for (const s of sessions) {
      if (s.projectId === props.projectId && s.lastUpdate > latestUpdate) {
        latestUpdate = s.lastUpdate;
        latestId = s.id;
      }
    }
    if (latestId) return latestId;
    chatStore.newSession(undefined, props.projectId);
    // newSession prepends the new session and resets currentSessionIndex
    // to 0, so it is always the first entry right after the call.
    return chatStore.sessions[0].id;
  }

  async function addDocuments() {
    const files: File[] = await new Promise((res) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.onchange = (e: any) => res(Array.from(e.target.files as FileList));
      input.click();
    });
    if (!files.length) return;

    setUploading(true);
    try {
      const sessionId = targetSessionId();
      for (const file of files) {
        try {
          const { source, logLines } = await ingestFile(file);
          chatStore.registerEoSourceForSession(sessionId, source);
          for (const line of logLines) {
            chatStore.pushEoLog(line.channel, line.text);
          }
        } catch (err) {
          chatStore.pushEoLog(
            "error",
            `file: "${file.name}" failed to upload — ${(err as Error).message}`,
          );
        }
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={docStyles["document-explorer"]}>
      <div className={docStyles["document-explorer-header"]}>
        <div>
          <div className={docStyles["document-explorer-kicker"]}>Documents</div>
          <div className={docStyles["document-explorer-title"]}>
            {sources.length} document{sources.length === 1 ? "" : "s"}
          </div>
        </div>
        <button
          className={docStyles["document-explorer-add"]}
          onClick={addDocuments}
          disabled={uploading}
        >
          <Plus size={14} /> {uploading ? "Adding…" : "Add documents"}
        </button>
      </div>
      {!sources.length ? (
        <div className={docStyles["document-explorer-empty"]}>
          No documents yet. Add a file to make it available to every chat in
          this project.
        </div>
      ) : (
        <div className={docStyles["document-explorer-grid"]}>
          {sources.map((source) => (
            <DocumentRow key={source.id} source={source} />
          ))}
        </div>
      )}
    </div>
  );
}

// A real component (not an inline .map() callback) for the same reason
// chat.tsx's SourceRow is: useSourceReader is a hook, and calling it from
// inside the parent's own render per array item would violate the rules of
// hooks.
function DocumentRow(props: { source: EoSource }) {
  const chatStore = useChatStore();
  const { source } = props;
  const reader = useSourceReader(source);
  const { kind, label } = kindOf(source.name, source.mimeType);
  const Icon = KIND_ICON[kind] ?? File;

  return (
    <div className={docStyles["document-row"]}>
      <label className={docStyles["document-row-main"]}>
        <input
          type="checkbox"
          checked={source.enabled}
          onChange={() =>
            chatStore.updateEoSource(source.id, (s) => ({
              ...s,
              enabled: !s.enabled,
            }))
          }
        />
        <Icon size={18} className={docStyles["document-row-icon"]} />
        <span className={docStyles["document-row-body"]}>
          <strong title={source.name}>{source.name}</strong>
          <small>
            {label} ·{" "}
            {(source.byteLength / 1024).toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}{" "}
            KB · {source.textReadable ? "text searchable" : "binary retained"}
          </small>
        </span>
        <SourceReaderTrigger state={reader} />
        <SourceReadAloudButton
          source={source}
          className={docStyles["document-row-speak"]}
        />
      </label>
      <SourceReaderPanel source={source} state={reader} />
    </div>
  );
}
