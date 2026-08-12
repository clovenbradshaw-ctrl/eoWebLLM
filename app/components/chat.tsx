import { useDebouncedCallback } from "use-debounce";
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  Fragment,
  RefObject,
  useContext,
} from "react";

import ShareIcon from "../icons/share.svg";
import SendWhiteIcon from "../icons/send-white.svg";
import RenameIcon from "../icons/rename.svg";
import ExportIcon from "../icons/export.svg";
import ReturnIcon from "../icons/return.svg";
import CopyIcon from "../icons/copy.svg";
import LoadingIcon from "../icons/three-dots.svg";
import LoadingButtonIcon from "../icons/loading.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import ResetIcon from "../icons/reload.svg";
import BreakIcon from "../icons/break.svg";
import DeleteIcon from "../icons/clear.svg";
import EditIcon from "../icons/rename.svg";
import ConfirmIcon from "../icons/confirm.svg";
import BrainIcon from "../icons/brain.svg";

import BottomIcon from "../icons/bottom.svg";
import StopIcon from "../icons/pause.svg";
import RobotIcon from "../icons/robot.svg";
import SpeakerIcon from "../icons/speaker.svg";

import {
  ChatMessage,
  SubmitKey,
  useChatStore,
  createMessage,
  useAppConfig,
  DEFAULT_TOPIC,
  Model,
  ModelClient,
  type PlanTrace,
  type WarrantTrace,
} from "../store";

import {
  copyToClipboard,
  selectOrCopy,
  autoGrowTextArea,
  useMobileScreen,
  getMessageTextContent,
  getMessageImages,
  isVisionModel,
  compressImage,
  splitThinking,
} from "../utils";

import dynamic from "next/dynamic";

import { Prompt, usePromptStore } from "../store/prompt";
import Locale from "../locales";

import { IconButton } from "./button";
import styles from "./chat.module.scss";

import {
  List,
  ListItem,
  Modal,
  Popover,
  showConfirm,
  showPrompt,
  showToast,
} from "./ui-lib";
import { useNavigate } from "react-router-dom";
import {
  CHAT_PAGE_SIZE,
  LAST_INPUT_KEY,
  Path,
  REQUEST_TIMEOUT_MS,
  UNFINISHED_INPUT,
} from "../constant";
import { Avatar, AvatarPicker } from "./emoji";
import { ContextPrompts, TemplateAvatar } from "./template";
import { ChatCommandPrefix, useChatCommand, useCommand } from "../command";
import { prettyObject } from "../utils/format";
import { ExportMessageModal } from "./exporter";
import { MultimodalContent } from "../client/api";
import { Template, useTemplateStore } from "../store/template";
import Image from "next/image";
import { MLCLLMContext, WebLLMContext } from "../context";
import { ChatImage } from "../typing";
import ModelSelect from "./model-select";
import {
  Globe,
  Paperclip,
  TerminalWindow,
  Scales,
  ClipboardText,
  Clock,
  Check,
  ShareNetwork,
  DotsThreeVertical,
} from "@phosphor-icons/react";
import { ingestFile } from "../client/eo-source-ingest";
import { toEOTReader, reReadSource, ledgerStats } from "../client/eo-reading";
import { persistRawSource, readRawSource } from "../client/eo-corpus";
import {
  hypergraphSnapshot,
  foldGraphOnEntity,
  hypergraphTiersSnapshot,
  hypergraphScopeId,
  ensureHypergraphHydrated,
  describeHypergraphMovement,
  type GraphTerrainSnapshot,
  type TierTerrainSnapshot,
} from "../client/eo-hypergraph";
import type { EoSource } from "../client/eo-corpus";
import {
  readAtCursors,
  diffLinkViews,
} from "../client/eo-binary/reading-diff.js";
import { MODIFIER_SCOPE_CURRENT_LENS } from "../client/eo-binary/modifier-order-lens.js";
import {
  useSourceReader,
  SourceReaderTrigger,
  SourceReaderPanel,
} from "./source-reader";
import { SourceReadAloudButton, showTTSError } from "./read-aloud";
import type { WebSearchResult } from "../client/eo-websearch";
import type { GroundingReport, Snippet } from "../client/eo-citation-check";
import type { CitationEntry } from "../client/eo-citation-check";
import { TerrainPanel } from "./terrain-panel";
import { useTTSStore } from "../store/tts";
import { toSpeechText } from "../utils/tts-text";
import type { TerrainCardRef } from "./terrain/types";
import {
  chipReasonText,
  buildCitationNumbering,
} from "./terrain/grounding-chip";
import { CitationModal } from "./terrain/citation-modal";
import type { GroundingSpan } from "../client/eo-grounding-spans";
import { CiteySprite } from "./citey";

const eotDot = (id: string) => id.replace(/\s+/g, "_").replace(/::/g, ".");

/**
 * The belief graph, as an EOT surface -- the SAME room/links/reader
 * grammar toEOTReader already emits for the Link terrain (modifier-order),
 * here for the Network terrain (emergence/graph.js's own name for "nodes
 * are Entity, edges are Link, the whole is Network"). Not a second format
 * invented for this tab: one grammar, two terrains, the same as the
 * per-source ledger viewer already runs both Fold and Events views
 * through readDocument/toEOTReader rather than a bespoke renderer per tab.
 */
function buildGraphEOT(
  snap: GraphTerrainSnapshot,
  { roomName = "graph" }: { roomName?: string } = {},
): string {
  const lines: string[] = [];
  lines.push(
    `# ── assembly 1: the room — this session's belief graph, narrowed to what a reading needs ──`,
  );
  lines.push(`${roomName} : room`);
  lines.push(
    `${roomName}.contract.ops = NUL, SIG, INS, SEG, CON, SYN, DEF, EVA`,
  );
  lines.push(`${roomName}.contract.terrains = Entity, Link, Network`);
  lines.push(`${roomName}.contract.stances = Tending, Binding, Composing`);
  lines.push(`!EVA ${roomName}`);
  lines.push("");

  if (snap.edges.length === 0) {
    lines.push(
      `# no Network-terrain structure in this reading — the room stands with no relations`,
    );
    lines.push("");
  } else {
    lines.push(
      `# ── assembly 2: the Network terrain, as links (cursor ${snap.cursor}, ${snap.edgeCount} edge(s) total believed) ──`,
    );
    for (const e of snap.edges) {
      const parts = e.edge.split("|");
      if (parts.length !== 3) continue;
      const [subject, verb, object] = parts;
      lines.push(`${eotDot(subject)} -> ${eotDot(object)}`);
      lines.push(
        `${eotDot(subject)}.relation = "${verb.replace(/^!/, "not ")}"`,
      );
      lines.push(`${eotDot(subject)}.weight = ${e.weight.toFixed(2)}`);
    }
    lines.push(`!EVA ${roomName}`);
    lines.push("");
  }

  lines.push(`# ── assembly 3: the reader surface ──`);
  lines.push(`${roomName}_reader : reader`);
  lines.push(`${roomName}_reader.room = ${roomName}`);
  lines.push(`${roomName}_reader.cursor = ${snap.cursor}`);
  lines.push(`!EVA ${roomName}_reader`);

  return lines.join("\n");
}

/**
 * The Network terrain's own click-to-pivot: every `subject -> object` line
 * in the EOT text above is a fold target, on either side -- the same
 * mechanism renderEotEntryText performs on quoted names in the Log tab,
 * reading the EOT surface text itself so what's clickable is exactly what's rendered,
 * not a shadow structure kept in sync by hand.
 */
function renderGraphEOTLine(
  line: string,
  activeEntity: string | null,
  onEntityClick: (entity: string) => void,
): React.ReactNode {
  const m = line.match(/^([^\s].*?)\s->\s(.+)$/);
  if (!m) return line;
  const [, subject, object] = m;
  const node = (id: string, key: string) => (
    <span
      key={key}
      className={
        styles["eot-entity"] +
        (activeEntity === id ? ` ${styles["eot-entity-active"]}` : "")
      }
      title={`Pivot the graph on "${id}"`}
      onClick={(e) => {
        e.stopPropagation();
        onEntityClick(id);
      }}
    >
      {id}
    </span>
  );
  return (
    <>
      {node(subject, "s")} -&gt; {node(object, "o")}
    </>
  );
}

// The EOT terminal's click-to-fold: every quoted name inside a log line
// (a source, a search query, a topic, an expression -- whatever the
// entry itself named) is a click target. Clicking one narrows the whole
// terminal to just the lines mentioning that name, reusing the ledger
// viewer's own "fold" vocabulary above for narrowing a full history down
// to what one thing did.
function renderEotEntryText(
  text: string,
  activeEntity: string | null,
  onEntityClick: (entity: string) => void,
): React.ReactNode[] {
  const re = /"([^"]{1,80})"/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const entity = match[1];
    parts.push(
      <span
        key={`eot-entity-${key++}`}
        className={
          styles["eot-entity"] +
          (activeEntity === entity ? ` ${styles["eot-entity-active"]}` : "")
        }
        title={`Fold the log on "${entity}"`}
        onClick={(e) => {
          e.stopPropagation();
          onEntityClick(entity);
        }}
      >
        &quot;{entity}&quot;
      </span>,
    );
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// A terrain section (Atmosphere / Lens / Paradigm) -- rendered only when
// the reading has actually reached it (tier.observations > 0), never as an
// empty placeholder. tiers.js's own sparsification means a higher terrain
// existing at all IS the finding: it only observes what disturbed the one
// below it. Genuine Bayesian-surprise shifts (recentShifts) are the
// "meaningful" content highlighted here -- ordinary placed observations
// are summarised as a count, never listed individually.
function renderTerrain(tier: {
  name: string;
  observations: number;
  shifts: number;
  novelRate: number;
  recentShifts: { at: number; forms?: string[]; surprise?: number }[];
}): React.ReactNode {
  if (tier.observations === 0) return null;
  return (
    <div key={tier.name} className={styles["eot-terrain"]}>
      <div className={styles["eot-terrain-header"]}>
        {tier.name[0].toUpperCase() + tier.name.slice(1)}
      </div>
      <div className={styles["eot-terrain-stats"]}>
        {tier.observations} observation{tier.observations === 1 ? "" : "s"} ·{" "}
        {tier.shifts} shift{tier.shifts === 1 ? "" : "s"} · novel rate{" "}
        {(tier.novelRate * 100).toFixed(0)}%
      </div>
      {tier.shifts === 0 ? (
        <div className={styles["eot-graph-empty"]}>
          Nothing here has moved belief further than this terrain&apos;s own
          continuation would have -- no shift yet.
        </div>
      ) : (
        tier.recentShifts.map((s, i) => (
          <div key={i} className={styles["eot-shift"]}>
            at {s.at}
            {typeof s.surprise === "number"
              ? ` · surprise ${s.surprise.toFixed(3)}`
              : ""}
            {s.forms?.length ? (
              <span className={styles["eot-shift-forms"]}>
                {" "}
                — {s.forms.slice(0, 6).join(", ")}
              </span>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

export function ScrollDownToast(prop: { show: boolean; onclick: () => void }) {
  return (
    <div
      className={
        styles["toast-container"] + (prop.show ? ` ${styles["show"]}` : "")
      }
    >
      <div className={styles["toast-content"]} onClick={() => prop.onclick()}>
        <BottomIcon />
      </div>
    </div>
  );
}

export function SessionConfigModel(props: { onClose: () => void }) {
  const [showPicker, setShowPicker] = useState(false);
  const config = useAppConfig();
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const templateStore = useTemplateStore();
  const navigate = useNavigate();

  const updateTemplate = (updater: (value: Template) => void) => {
    const template = { ...session.template };
    updater(template);
    chatStore.updateCurrentSession((session) => (session.template = template));
  };

  return (
    <div className="screen-model-container">
      <Modal
        title={Locale.Context.Edit}
        onClose={() => props.onClose()}
        actions={[
          <IconButton
            key="reset"
            icon={<ResetIcon />}
            bordered
            text={Locale.Chat.Config.Reset}
            onClick={async () => {
              if (await showConfirm(Locale.Memory.ResetConfirm)) {
                chatStore.updateCurrentSession(
                  (session) => (session.memoryPrompt = ""),
                );
              }
            }}
          />,
          <IconButton
            key="copy"
            icon={<CopyIcon />}
            bordered
            text={Locale.Chat.Config.SaveAs}
            onClick={() => {
              showPrompt(Locale.Template.Config.Name, session.topic, 1).then(
                (templateName) => {
                  updateTemplate((template) => {
                    template.name = templateName;
                  });
                  navigate(Path.Templates);
                  setTimeout(() => {
                    templateStore.create(session.template);
                  }, 500);
                },
              );
            }}
          />,
          <IconButton
            type="primary"
            key="ok"
            icon={<ConfirmIcon />}
            bordered
            text={Locale.Chat.Config.Confirm}
            onClick={props.onClose}
          />,
        ]}
      >
        <ContextPrompts
          context={session.template.context}
          updateContext={(updater) => {
            const context = session.template.context.slice();
            updater(context);
            updateTemplate((template) => (template.context = context));
          }}
        />

        <List>
          <ListItem
            title={Locale.Chat.EditMessage.Topic.Title}
            subTitle={Locale.Chat.EditMessage.Topic.SubTitle}
          >
            <input
              type="text"
              value={session.topic}
              onInput={(e) =>
                chatStore.updateCurrentSession(
                  (session) => (session.topic = e.currentTarget.value),
                )
              }
            ></input>
          </ListItem>
          <ListItem title={Locale.Template.Config.Avatar}>
            <Popover
              content={
                <AvatarPicker
                  onEmojiClick={(emoji) => {
                    updateTemplate((template) => (template.avatar = emoji));
                    setShowPicker(false);
                  }}
                ></AvatarPicker>
              }
              open={showPicker}
              onClose={() => setShowPicker(false)}
            >
              <div
                onClick={() => setShowPicker(true)}
                style={{ cursor: "pointer" }}
              >
                <TemplateAvatar
                  avatar={session.template.avatar}
                  model={config.modelConfig.model}
                  name={session.template.name}
                />
              </div>
            </Popover>
          </ListItem>
          <ListItem
            title={Locale.Template.Config.HideContext.Title}
            subTitle={Locale.Template.Config.HideContext.SubTitle}
          >
            <input
              type="checkbox"
              checked={session.template.hideContext}
              onChange={(e) => {
                updateTemplate((template) => {
                  template.hideContext = e.currentTarget.checked;
                });
              }}
            ></input>
          </ListItem>
        </List>
      </Modal>
    </div>
  );
}

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
});

function useSubmitHandler() {
  const config = useAppConfig();
  const submitKey = config.submitKey;
  const isComposing = useRef(false);

  useEffect(() => {
    const onCompositionStart = () => {
      isComposing.current = true;
    };
    const onCompositionEnd = () => {
      isComposing.current = false;
    };

    window.addEventListener("compositionstart", onCompositionStart);
    window.addEventListener("compositionend", onCompositionEnd);

    return () => {
      window.removeEventListener("compositionstart", onCompositionStart);
      window.removeEventListener("compositionend", onCompositionEnd);
    };
  }, []);

  const shouldSubmit = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Fix Chinese input method "Enter" on Safari
    if (e.keyCode == 229) return false;
    if (e.key !== "Enter") return false;
    if (e.key === "Enter" && (e.nativeEvent.isComposing || isComposing.current))
      return false;
    return (
      (config.submitKey === SubmitKey.AltEnter && e.altKey) ||
      (config.submitKey === SubmitKey.CtrlEnter && e.ctrlKey) ||
      (config.submitKey === SubmitKey.ShiftEnter && e.shiftKey) ||
      (config.submitKey === SubmitKey.MetaEnter && e.metaKey) ||
      (config.submitKey === SubmitKey.Enter &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.metaKey)
    );
  };

  return {
    submitKey,
    shouldSubmit,
  };
}

export type RenderPompt = Pick<Prompt, "title" | "content">;

export function PromptHints(props: {
  prompts: RenderPompt[];
  onPromptSelect: (prompt: RenderPompt) => void;
}) {
  const noPrompts = props.prompts.length === 0;
  const [selectIndex, setSelectIndex] = useState(0);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectIndex(0);
  }, [props.prompts.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (noPrompts || e.metaKey || e.altKey || e.ctrlKey) {
        return;
      }
      // arrow up / down to select prompt
      const changeIndex = (delta: number) => {
        e.stopPropagation();
        e.preventDefault();
        const nextIndex = Math.max(
          0,
          Math.min(props.prompts.length - 1, selectIndex + delta),
        );
        setSelectIndex(nextIndex);
        selectedRef.current?.scrollIntoView({
          block: "center",
        });
      };

      if (e.key === "ArrowUp") {
        changeIndex(1);
      } else if (e.key === "ArrowDown") {
        changeIndex(-1);
      } else if (e.key === "Enter") {
        const selectedPrompt = props.prompts.at(selectIndex);
        if (selectedPrompt) {
          props.onPromptSelect(selectedPrompt);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.prompts.length, selectIndex]);

  if (noPrompts) return null;
  return (
    <div className={styles["prompt-hints"]}>
      {props.prompts.map((prompt, i) => (
        <div
          ref={i === selectIndex ? selectedRef : null}
          className={
            styles["prompt-hint"] +
            ` ${i === selectIndex ? styles["prompt-hint-selected"] : ""}`
          }
          key={prompt.title + i.toString()}
          onClick={() => props.onPromptSelect(prompt)}
          onMouseEnter={() => setSelectIndex(i)}
        >
          <div className={styles["hint-title"]}>{prompt.title}</div>
          <div className={styles["hint-content"]}>{prompt.content}</div>
        </div>
      ))}
    </div>
  );
}

function ClearContextDivider() {
  const chatStore = useChatStore();

  return (
    <div
      className={styles["clear-context"]}
      onClick={() =>
        chatStore.updateCurrentSession(
          (session) => (session.clearContextIndex = undefined),
        )
      }
    >
      <div className={styles["clear-context-tips"]}>{Locale.Context.Clear}</div>
      <div className={styles["clear-context-revert-btn"]}>
        {Locale.Context.Revert}
      </div>
    </div>
  );
}

function ChatAction(props: {
  text: string;
  icon: JSX.Element;
  onClick: () => void;
  fullWidth?: boolean;
  selected?: boolean;
}) {
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({
    full: 16,
    icon: 16,
  });

  function updateWidth() {
    if (!iconRef.current || !textRef.current) return;
    const getWidth = (dom: HTMLDivElement) => dom.getBoundingClientRect().width;
    const textWidth = getWidth(textRef.current);
    const iconWidth = getWidth(iconRef.current);
    setWidth({
      full: textWidth + iconWidth,
      icon: iconWidth,
    });
  }

  return props.fullWidth ? (
    <div
      className={`${styles["chat-input-action"]} clickable ${styles["full-width"]} ${props.selected ? styles["selected"] : ""}`}
      onClick={props.onClick}
    >
      <div ref={iconRef} className={styles["icon"]}>
        {props.icon}
      </div>
      <div className={styles["text"]} ref={textRef}>
        {props.text}
      </div>
    </div>
  ) : (
    <div
      className={`${styles["chat-input-action"]} clickable ${props.selected ? styles["selected"] : ""}`}
      onClick={() => {
        props.onClick();
        setTimeout(updateWidth, 1);
      }}
      onMouseEnter={updateWidth}
      onTouchStart={updateWidth}
      style={
        {
          "--icon-width": `${width.icon}px`,
          "--full-width": `${width.full}px`,
        } as React.CSSProperties
      }
    >
      <div ref={iconRef} className={styles["icon"]}>
        {props.icon}
      </div>
      <div className={styles["text"]} ref={textRef}>
        {props.text}
      </div>
    </div>
  );
}

function useScrollToBottom(
  scrollRef: RefObject<HTMLDivElement>,
  detach: boolean = false,
) {
  // for auto-scroll

  const [autoScroll, setAutoScroll] = useState(true);
  function scrollDomToBottom() {
    const dom = scrollRef.current;
    if (dom) {
      requestAnimationFrame(() => {
        setAutoScroll(true);
        dom.scrollTo(0, dom.scrollHeight);
      });
    }
  }

  // auto scroll
  useEffect(() => {
    if (autoScroll && !detach) {
      scrollDomToBottom();
    }
  });

  return {
    scrollRef,
    autoScroll,
    setAutoScroll,
    scrollDomToBottom,
  };
}

export function ChatActions(props: {
  uploadFile: () => void;
  setAttachImages: (images: ChatImage[]) => void;
  setUploading: (uploading: boolean) => void;
  scrollToBottom: () => void;
  showPromptSetting: () => void;
  showPromptHints: () => void;
  hitBottom: boolean;
  uploading: boolean;
  uploadingFile: boolean;
}) {
  const config = useAppConfig();
  const chatStore = useChatStore();
  const session = chatStore.currentSession();

  // switch model
  const currentModel = config.modelConfig.model;
  const models = config.models;
  const [showModelSelector, setShowModelSelector] = useState(false);

  useEffect(() => {
    if (!isVisionModel(currentModel)) {
      props.setAttachImages([]);
      props.setUploading(false);
    }
  }, [chatStore, currentModel, models]);

  return (
    <div className={styles["chat-input-actions"]}>
      <ChatAction
        onClick={() => chatStore.toggleWebSearch()}
        text="Web Search"
        icon={<Globe size={16} />}
        selected={!!session.webSearchEnabled}
      />
      <ChatAction
        onClick={() => chatStore.toggleGroundingDisplay()}
        text="Grounding Citations"
        icon={<Scales size={16} />}
        selected={session.groundingDisplayEnabled !== false}
      />
      <ChatAction
        onClick={props.uploadFile}
        text="Attach File"
        icon={
          props.uploadingFile ? <LoadingButtonIcon /> : <Paperclip size={16} />
        }
      />
      <ChatAction
        text={Locale.Chat.InputActions.Clear}
        icon={<BreakIcon />}
        onClick={() => {
          chatStore.updateCurrentSession((session) => {
            if (session.clearContextIndex === session.messages.length) {
              session.clearContextIndex = undefined;
            } else {
              session.clearContextIndex = session.messages.length;
              session.memoryPrompt = ""; // will clear memory
            }
          });
        }}
      />
      {config.modelConfig.model.toLowerCase().startsWith("qwen3") && (
        <ChatAction
          onClick={() =>
            config.update(
              (config) => (config.enableThinking = !config.enableThinking),
            )
          }
          text={Locale.Settings.THINKING}
          icon={<BrainIcon />}
          selected={config.enableThinking}
        />
      )}
      <ChatAction
        onClick={() => setShowModelSelector(true)}
        text={currentModel}
        icon={<RobotIcon />}
        fullWidth
      />
      {showModelSelector && (
        <ModelSelect
          onClose={() => {
            setShowModelSelector(false);
          }}
          availableModels={models.map((m) => m.name)}
          onSelectModel={(modelName) => {
            config.selectModel(modelName as Model);
            showToast(modelName);
          }}
        />
      )}
    </div>
  );
}

// Shared shell for every collapsible reasoning trace (thinking, plan,
// warrant, ...), styled like Claude's extended-thinking display: a small
// clock while the step is still running, a checkmark + "Done" once it has
// resolved, and an italic muted-gray body so the trace reads as scratch
// work rather than part of the answer. Collapsed, this must stay a plain
// line of text with no box around it (LAWS.md L1) — the border/indent live
// only on the opened body in chat.module.scss's .trace-panel rules.
function TracePanel(props: {
  label: React.ReactNode;
  running: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <details
      id={props.id}
      open={props.defaultOpen ?? props.running}
      className={styles["trace-panel"]}
    >
      <summary className={styles["trace-panel-summary"]}>
        <span
          aria-hidden
          className={
            styles["trace-panel-icon"] +
            (props.running ? ` ${styles["trace-panel-icon-running"]}` : "")
          }
        >
          {props.running ? <Clock size={13} /> : <Check size={13} />}
        </span>
        <span className={styles["trace-panel-label"]}>{props.label}</span>
      </summary>
      <div className={styles["trace-panel-body"]}>{props.children}</div>
    </details>
  );
}

// A collapsible reasoning panel, like Claude's extended-thinking display:
// collapsed by default once the answer has started, auto-expanded while the
// model is still inside the <think> block so a reader can watch it reason
// live instead of staring at a spinner.
function ThinkingPanel(props: { thinking: string; open: boolean }) {
  return (
    <TracePanel label="Reasoning" running={props.open} defaultOpen={props.open}>
      <div
        style={{
          whiteSpace: "pre-wrap",
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        {props.thinking.trim()}
      </div>
    </TracePanel>
  );
}

// The holonic DEFINE → EVALUATE → RECONCILE trace (see PlanTrace in
// store/chat.ts, populated in onUserInput's onFinish), shown the same way
// ThinkingPanel shows a model's own <think> block: a reasoning-style
// affordance the reader can open, one step from the message it explains
// (LAWS.md L2b), not only visible in the separate EOT log panel. Reader-
// facing evidence, not decoration — every line here is a real field off
// the trace the turn actually produced, so "is this running / can I
// verify it" is answerable by opening this panel, not by trusting a claim.
function PlanPanel(props: { trace: PlanTrace }) {
  const t = props.trace;
  const hadViolations = t.initialViolations.length > 0;
  const status = !hadViolations
    ? "clean on first pass"
    : t.reconciled
      ? t.finalCompliant
        ? "revised — now compliant"
        : "revised — still flagged"
      : "flagged, not revised";
  return (
    <TracePanel
      label={
        <>
          <ClipboardText size={13} className={styles["trace-panel-glyph"]} />
          Plan — {t.kind} · {t.delivery} · {status}
        </>
      }
      running={false}
    >
      {t.reason && <div>Why: {t.reason}</div>}
      <div>
        Contract: delivery={t.delivery}, minWords={t.minWords}
        {t.mathExpression && `, ${t.mathExpression} = ${t.mathValue}`}
      </div>
      {hadViolations ? (
        <div>
          <div style={{ opacity: 0.7 }}>Initial check found:</div>
          {t.initialViolations.map((v, i) => (
            <div key={i}>
              – [{v.type}/{v.severity}] {v.detail}
            </div>
          ))}
          {t.reconciled ? (
            <div style={{ marginTop: 4 }}>
              Rewrote once to fix these.{" "}
              {t.finalCompliant
                ? "Recheck: compliant."
                : `Recheck: still non-compliant — ${t.finalViolations.map((v) => v.type).join(", ")} (shipped anyway, flagged here rather than looping).`}
            </div>
          ) : (
            <div style={{ marginTop: 4, opacity: 0.7 }}>
              Rewrite did not run (background call failed) — shipped as drafted,
              flagged here.
            </div>
          )}
        </div>
      ) : (
        <div style={{ opacity: 0.7 }}>
          No violations on the first pass — no rewrite needed.
        </div>
      )}
    </TracePanel>
  );
}

// The warrant decision (see WarrantTrace in store/chat.ts, eo-warrant.ts):
// what could have carried a claim this turn, what was folded away unread, and
// why the turn routed to System 1 or System 2. This is the panel a reader
// opens when an answer looks ungrounded — it says, in the turn's own numbers,
// whether anything outside the model bore on the question at all.
function WarrantPanel(props: { trace: WarrantTrace; id?: string }) {
  const t = props.trace;
  const headline =
    t.system === "system2"
      ? t.groundingRequired
        ? "checked against what this turn actually read"
        : "deliberated"
      : "answered from general knowledge";
  return (
    <TracePanel
      id={props.id}
      label={
        <>
          <Scales size={13} className={styles["trace-panel-glyph"]} />
          Warrant — {t.system === "system2" ? "System 2" : "System 1"} ·{" "}
          {headline}
        </>
      }
      running={false}
    >
      <div>
        Routed at {t.stage},{" "}
        {t.mechanical
          ? "with no model call — from the turn's own counts"
          : "on a model's reading of the turn"}
        .
      </div>
      {t.channels.length > 0 && (
        <div>
          <div style={{ opacity: 0.7 }}>What bore on this turn:</div>
          {t.channels.map((c, i) => (
            <div key={i}>
              – {c.channel}: {c.note}
            </div>
          ))}
        </div>
      )}
      {t.checkedChannels.length > 0 && (
        <div>Claims were checked against: {t.checkedChannels.join(", ")}.</div>
      )}
      {t.unfoldChannels.length > 0 && (
        <div>
          Folded and not read this turn: {t.unfoldChannels.join(", ")} — the
          answer must not rest on it.
        </div>
      )}
      {t.forbiddenChannels.length > 0 && (
        <div>
          Cannot carry a claim: {t.forbiddenChannels.join(", ")} (a paraphrase
          has no source to check).
        </div>
      )}
      <div style={{ opacity: 0.7 }}>
        Fold pressure {Math.round(t.foldPressure * 100)}% of bearing material
        held back
        {t.lostPressure > 0 &&
          `, ${Math.round(t.lostPressure * 100)}% of it unrecoverable`}
        .
      </div>
      {t.reasons.map((r, i) => (
        <div key={i} style={{ opacity: 0.7 }}>
          · {r}
        </div>
      ))}
    </TracePanel>
  );
}

// Citey, surfaced only when it has something to say — one unresolved span
// per message (contradicted takes priority over an unconfirmed "owned"
// span), in plain language, never DEF/EVA/REC vocabulary. The full record
// this is a teaser for already exists as WarrantPanel below; clicking here
// opens and scrolls to it rather than duplicating its content.
function CiteyNote(props: {
  spans?: GroundingSpan[];
  citations?: CitationEntry[];
  warrantPanelId: string;
}) {
  const flagged = props.spans?.find(
    (s) => s.state === "contradicted" || s.state === "owned",
  );
  if (!flagged) return null;

  const citation =
    flagged.state === "sourced" && flagged.supportingCitationIndexes.length
      ? props.citations?.find(
          (c) => c.index === flagged.supportingCitationIndexes[0],
        )
      : undefined;

  return (
    <div
      className={styles["citey-note"]}
      role="button"
      tabIndex={0}
      onClick={() => {
        const panel = document.getElementById(props.warrantPanelId);
        if (!panel) return;
        (panel as HTMLDetailsElement).open = true;
        panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }}
    >
      <CiteySprite size={22} groundingState="gap" />
      <div className={styles["citey-note-text"]}>
        <b>Citey:</b> {chipReasonText(flagged, citation)}
      </div>
    </div>
  );
}

// The same "follow it home" affordance the web panel gives, for the reader's
// own sources: each byte range the answer was checked against, and the one
// clause of it the answer actually drew on.
function SourceCitationsPanel(props: {
  citations: { ref: string; clause: string | null }[];
}) {
  const used = props.citations.filter((c) => c.clause);
  return (
    <details
      style={{
        margin: "0 0 10px",
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid var(--border-in-light)",
        background: "var(--gray)",
        fontSize: "13px",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          color: "var(--black)",
          opacity: 0.7,
          userSelect: "none",
        }}
      >
        {`\u{1F4C4} Your sources — ${props.citations.length} passage${props.citations.length === 1 ? "" : "s"} read, ${used.length} drawn on`}
      </summary>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          opacity: 0.85,
        }}
      >
        {props.citations.map((c, i) => (
          <div key={i}>
            <div style={{ opacity: 0.7, fontFamily: "monospace" }}>{c.ref}</div>
            {c.clause ? (
              <div style={{ marginTop: 2 }}>“{c.clause}”</div>
            ) : (
              <div style={{ marginTop: 2, opacity: 0.6 }}>
                read, but nothing in the answer drew on it specifically
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

// The "what did it search" affordance: a collapsible list of the actual
// web_search results that grounded this reply, each title a real clickable
// link to the source — not a claim the model made, structured data the
// store attached (see ChatMessage.webResults / eo-tool-router.ts).
function WebSearchPanel(props: {
  results: WebSearchResult[];
  query?: string;
  groundingReport?: GroundingReport;
  snippets?: Snippet[];
}) {
  const report = props.groundingReport;
  const snipFor = (i: number) => props.snippets?.find((s) => s.index === i + 1);
  return (
    <details
      style={{
        margin: "0 0 10px",
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid var(--border-in-light)",
        background: "var(--gray)",
        fontSize: "13px",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          color: "var(--black)",
          opacity: 0.7,
          userSelect: "none",
        }}
      >
        {`🔎 Searched "${props.query ?? ""}" — ${props.results.length} result${props.results.length === 1 ? "" : "s"}`}
        {report && (
          <span style={{ marginLeft: 8 }}>
            {report.clean
              ? `· ✓ grounded (${report.atomsChecked} checked)`
              : `· ⚠ ${report.findings.length} unsupported claim${report.findings.length === 1 ? "" : "s"}`}
          </span>
        )}
      </summary>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {props.results.map((r, i) => {
          const snip = snipFor(i);
          return (
            <div key={i}>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontWeight: 600 }}
              >
                {r.title}
              </a>
              <span style={{ opacity: 0.5 }}> · {r.source}</span>
              {snip?.clause ? (
                <div style={{ marginTop: 2 }}>
                  <mark
                    style={{
                      background: "var(--primary)",
                      opacity: 0.85,
                      color: "var(--white)",
                      padding: "0 2px",
                      borderRadius: 3,
                    }}
                  >
                    {snip.clause}
                  </mark>
                </div>
              ) : (
                // No clause overlapped the reply's own words — show only a
                // short lead-in, not the whole fetched snippet, so a result
                // the reply didn't actually draw from doesn't read as if it
                // did (LAWS.md L3: no silent over-disclosure either).
                <div
                  style={{ opacity: 0.6, marginTop: 2, fontStyle: "italic" }}
                >
                  {r.snippet.slice(0, 100)}
                  {r.snippet.length > 100 ? "…" : ""}
                </div>
              )}
            </div>
          );
        })}
        {report && !report.clean && (
          <div
            style={{
              borderTop: "1px solid var(--border-in-light)",
              paddingTop: 8,
            }}
          >
            <div style={{ opacity: 0.7, marginBottom: 4 }}>
              Claims not found verbatim in the search results above (marked
              inline as [⊘ not in search results]):
            </div>
            {report.findings
              .filter((f) => !f.echoesQuestion)
              .map((f, i) => (
                <div key={i} style={{ opacity: 0.75 }}>
                  &ldquo;{f.text}&rdquo;
                </div>
              ))}
            {report.truncated && (
              <div style={{ opacity: 0.6, marginTop: 4, fontStyle: "italic" }}>
                {report.truncated.dropped} more unsupported claim
                {report.truncated.dropped === 1 ? "" : "s"} not shown (
                {report.truncated.reported} of {report.truncated.total} total).
              </div>
            )}
          </div>
        )}
        {!props.results.length && (
          <div style={{ opacity: 0.6, fontStyle: "italic" }}>
            No results found for this query — the reply below is not grounded in
            a web search.
          </div>
        )}
      </div>
    </details>
  );
}

export function DeleteImageButton(props: { deleteImage: () => void }) {
  return (
    <div className={styles["delete-image"]} onClick={props.deleteImage}>
      <DeleteIcon />
    </div>
  );
}

// One row in the session's source panel: the checkbox/name/enable row plus
// its View/Re-read actions and (when expanded) the Fold/Events/Raw reader
// panel. A real component, not an inline .map() callback, because
// useSourceReader is a hook -- calling it per array item from inside the
// parent's own render would violate the rules of hooks (the hook-call count
// would vary with session.eoSources.length instead of staying fixed for
// ChatInner itself).
function SourceRow(props: {
  source: EoSource;
  rereading: boolean;
  onToggleEnabled: () => void;
  onReread: () => void;
}) {
  const { source } = props;
  const reader = useSourceReader(source);
  return (
    <div className={styles["source-item"]}>
      <label className={styles["source-row"]}>
        <input
          type="checkbox"
          checked={source.enabled}
          onChange={props.onToggleEnabled}
        />
        <span className={styles["source-row-body"]}>
          <strong title={source.name}>{source.name}</strong>
          <small>
            {(source.byteLength / 1024).toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}{" "}
            KB · {source.textReadable ? "text searchable" : "binary retained"}
            {source.structure
              ? ` · ${source.structure.clearings} ${source.structure.clearings === 1 ? "boundary" : "boundaries"}`
              : ""}
            {source.readLedger?.revisionCount
              ? ` · ${source.readLedger.revisionCount} revision${source.readLedger.revisionCount === 1 ? "" : "s"}`
              : ""}
          </small>
        </span>
        <SourceReaderTrigger state={reader} />
        <SourceReadAloudButton
          source={source}
          className={styles["source-speak"]}
        />
        {source.textReadable && (
          <button
            type="button"
            className={styles["source-reread"]}
            title="Re-read this source against its ledger"
            disabled={props.rereading}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onReread();
            }}
          >
            {props.rereading ? "Re-reading…" : "Re-read"}
          </button>
        )}
      </label>
      <SourceReaderPanel source={source} state={reader} />
    </div>
  );
}

function ChatInner() {
  type RenderMessage = ChatMessage & { preview?: boolean };

  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const config = useAppConfig();
  const fontSize = config.fontSize;

  const isStreaming = session.messages.some((m) => m.streaming);

  // The entity-mention affordance's target list (see entity-mention.tsx):
  // the session's own hypergraph's strongest nodes, by mention — the SAME
  // source the Entity terrain card reads, so a clickable mention always
  // lands on a card that exists. Not reactive by itself (eo-hypergraph.ts
  // is module state), so keyed on the two things that grow it: new turns
  // and new sources. Empty until the graph has anything — no graph, no
  // mentions, no dead click targets.
  const entityMentionIds = useMemo(() => {
    const snap = hypergraphSnapshot(hypergraphScopeId(session), {
      limit: 120,
    });
    return snap?.nodes.map((n) => n.id) ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.projectId, session.messages.length]);

  const ttsPlayingId = useTTSStore((s) => s.playingMessageId);
  const ttsError = useTTSStore((s) => s.error);
  const ttsSpeak = useTTSStore((s) => s.speak);
  const ttsStop = useTTSStore((s) => s.stop);

  const [showExport, setShowExport] = useState(false);
  const [showEoLog, setShowEoLog] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  // The currently-open citation modal (grounding-chip.tsx's [n] markers),
  // if any — carries the whole span/citation set the clicked message
  // rendered with, so the modal can compute its own citation number and a
  // "view in Field" target without re-deriving them from message state.
  const [openCitation, setOpenCitation] = useState<{
    content: string;
    spans: GroundingSpan[];
    citations: CitationEntry[];
    span: GroundingSpan;
    citation: CitationEntry;
  } | null>(null);
  // The terminal's active click-to-fold target, if any (see
  // renderEotEntryText below): a name pulled from a log line's own
  // quoted text, narrowing the terminal to only the lines that name it.
  const [eotFoldEntity, setEotFoldEntity] = useState<string | null>(null);
  // Which terrain the terminal is showing -- "log" is the existing running
  // event feed; "graph" is the belief graph + tier stack, added alongside
  // it, never replacing it.
  const [eotTerminalTab, setEotTerminalTab] = useState<"log" | "graph">("log");
  // Manual surf/fold over the graph terrain: the same substring fold a
  // click on a node already performs, driven by typing instead.
  const [eotGraphSearch, setEotGraphSearch] = useState("");
  // Same free-text fold, for the Log tab -- typing narrows the event feed
  // the same way clicking a quoted entity in a log line already does.
  const [eotLogSearch, setEotLogSearch] = useState("");
  const [showSources, setShowSources] = useState(false);

  // The terrain panel's own nav history — every card opened this session
  // (a citation chip click, or a cross-link inside an already-open card)
  // pushes here through openTerrainCard, the single entry point both
  // trigger sites share (docs/citey-structured-grounding.md). `terrainPanelOpen`
  // is deliberately separate from the history/index below: closing the
  // panel is not the same as forgetting where it was, so reopening resumes
  // the same card instead of always restarting fresh.
  const [terrainHistory, setTerrainHistory] = useState<TerrainCardRef[]>([]);
  const [terrainHistoryIndex, setTerrainHistoryIndex] = useState(-1);
  const [terrainPanelOpen, setTerrainPanelOpen] = useState(false);
  const showTerrainPanel = terrainPanelOpen && terrainHistoryIndex >= 0;
  const activeTerrainCard =
    terrainHistoryIndex >= 0 ? terrainHistory[terrainHistoryIndex] : null;

  // openTerrainCard is called from deep inside card components (via
  // onNavigate) where a stale closure over terrainHistoryIndex would
  // truncate history to the wrong point — this ref always holds the
  // current index for that one splice, without making openTerrainCard's
  // own identity depend on it (which would re-thread a new callback into
  // every card on every navigation).
  const terrainHistoryIndexRef = useRef(terrainHistoryIndex);
  terrainHistoryIndexRef.current = terrainHistoryIndex;

  const openTerrainCard = useCallback((ref: TerrainCardRef) => {
    setTerrainHistory((h) => [
      ...h.slice(0, terrainHistoryIndexRef.current + 1),
      ref,
    ]);
    setTerrainHistoryIndex((i) => i + 1);
    setTerrainPanelOpen(true);
    setShowEoLog(false);
  }, []);

  const terrainBack = () => setTerrainHistoryIndex((i) => Math.max(0, i - 1));
  const terrainForward = () =>
    setTerrainHistoryIndex((i) => Math.min(terrainHistory.length - 1, i + 1));
  const closeTerrainPanel = () => setTerrainPanelOpen(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [userInput, setUserInput] = useState("");
  const { submitKey, shouldSubmit } = useSubmitHandler();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrolledToBottom = scrollRef?.current
    ? Math.abs(
        scrollRef.current.scrollHeight -
          (scrollRef.current.scrollTop + scrollRef.current.clientHeight),
      ) <= 1
    : false;
  const { setAutoScroll, scrollDomToBottom } = useScrollToBottom(
    scrollRef,
    isScrolledToBottom,
  );
  const [hitBottom, setHitBottom] = useState(true);
  const isMobileScreen = useMobileScreen();
  const navigate = useNavigate();
  const [attachImages, setAttachImages] = useState<ChatImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [rereadingSourceId, setRereadingSourceId] = useState<string | null>(
    null,
  );
  const [showEditPromptModal, setShowEditPromptModal] = useState(false);
  const webllm = useContext(WebLLMContext)!;
  const mlcllm = useContext(MLCLLMContext)!;

  const llm =
    config.modelClientType === ModelClient.MLCLLM_API ? mlcllm : webllm;

  const models = config.models;

  // prompt hints
  const promptStore = usePromptStore();
  const [promptHints, setPromptHints] = useState<RenderPompt[]>([]);
  const onSearch = useDebouncedCallback(
    (text: string) => {
      const matchedPrompts = promptStore.search(text);
      setPromptHints(matchedPrompts);
    },
    100,
    { leading: true, trailing: true },
  );

  // auto grow input
  const [inputRows, setInputRows] = useState(2);
  const measure = useDebouncedCallback(
    () => {
      const rows = inputRef.current ? autoGrowTextArea(inputRef.current) : 1;
      const inputRows = Math.min(
        20,
        Math.max(2 + Number(!isMobileScreen), rows),
      );
      setInputRows(inputRows);
    },
    100,
    {
      leading: true,
      trailing: true,
    },
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(measure, [userInput]);

  // chat commands shortcuts
  const chatCommands = useChatCommand({
    new: () => chatStore.newSession(),
    prev: () => chatStore.nextSession(-1),
    next: () => chatStore.nextSession(1),
    clear: () =>
      chatStore.updateCurrentSession(
        (session) => (session.clearContextIndex = session.messages.length),
      ),
    del: () => chatStore.deleteSession(chatStore.currentSessionIndex),
  });

  // only search prompts when user input is short
  const SEARCH_TEXT_LIMIT = 30;
  const onInput = (text: string) => {
    setUserInput(text);
    const n = text.trim().length;

    // clear search results
    if (n === 0) {
      setPromptHints([]);
    } else if (text.startsWith(ChatCommandPrefix)) {
      setPromptHints(chatCommands.search(text));
    } else if (!config.disablePromptHint && n < SEARCH_TEXT_LIMIT) {
      // check if need to trigger auto completion
      if (text.startsWith("/")) {
        let searchText = text.slice(1);
        onSearch(searchText);
      }
    }
  };

  const onSubmit = (userInput: string) => {
    if (userInput.trim() === "") return;

    const matchCommand = chatCommands.match(userInput);
    if (matchCommand.matched) {
      setUserInput("");
      setPromptHints([]);
      matchCommand.invoke();
      return;
    }

    // `isStreaming` alone used to leave a gap open: it only reflects the
    // visible token stream, which chat.ts's onFinish can outlive by several
    // seconds while its background live fact-check pass is still running
    // (see the `botMessage.streaming = true` held there for exactly this).
    // `session.isGenerating` now spans that whole tail, so checking both is
    // what actually keeps a second submit from landing mid-turn and
    // corrupting the in-flight message with an overlapping revision pass.
    if (isStreaming || session.isGenerating) return;

    chatStore.onUserInput(userInput, llm, attachImages);
    setAttachImages([]);
    localStorage.setItem(LAST_INPUT_KEY, userInput);
    setUserInput("");
    setPromptHints([]);
    if (!isMobileScreen) inputRef.current?.focus();
    setAutoScroll(true);
  };

  const onPromptSelect = (prompt: RenderPompt) => {
    setTimeout(() => {
      setPromptHints([]);

      const matchedChatCommand = chatCommands.match(prompt.content);
      if (matchedChatCommand.matched) {
        // if user is selecting a chat command, just trigger it
        matchedChatCommand.invoke();
        setUserInput("");
      } else {
        // or fill the prompt
        setUserInput(prompt.content);
      }
      inputRef.current?.focus();
    }, 30);
  };

  // stop response
  const onUserStop = () => {
    llm.abort();
    chatStore.stopStreaming();
  };

  // Reset session status on initial loading
  useEffect(() => {
    chatStore.resetGeneratingStatus();
  }, []);

  // Surface TTS pipeline failures (model download, synthesis) as toasts.
  useEffect(() => {
    if (ttsError) showTTSError(ttsError);
  }, [ttsError]);

  useEffect(() => {
    chatStore.updateCurrentSession((session) => {
      const stopTiming = Date.now() - REQUEST_TIMEOUT_MS;
      session.messages.forEach((m) => {
        // check if should stop all stale messages
        if (m.isError || new Date(m.date).getTime() < stopTiming) {
          if (m.streaming) {
            m.streaming = false;
          }

          if (m.content.length === 0) {
            m.isError = true;
            m.content = prettyObject({
              error: true,
              message: "empty response",
            });
          }
        }
      });
      session.messages = session.messages.filter((m) => m.content.length > 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // check if should send message
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // if ArrowUp and no userInput, fill with last input
    if (
      e.key === "ArrowUp" &&
      userInput.length <= 0 &&
      !(e.metaKey || e.altKey || e.ctrlKey)
    ) {
      setUserInput(localStorage.getItem(LAST_INPUT_KEY) ?? "");
      e.preventDefault();
      return;
    }
    if (shouldSubmit(e) && promptHints.length === 0) {
      // Read the textarea's own live DOM value, not the closed-over
      // `userInput` state — a fast Enter right after the last keystroke can
      // fire before React has committed that keystroke's onInput, and
      // onSubmit silently no-ops on an empty/stale string with no feedback
      // to the reader (LAWS.md L1d: failure must be a signal). The DOM
      // value is authoritative at the instant of this keydown; React state
      // is one render behind it in exactly this race.
      onSubmit(e.currentTarget.value);
      e.preventDefault();
    }
  };
  const onRightClick = (e: any, message: ChatMessage) => {
    // copy to clipboard
    if (selectOrCopy(e.currentTarget, getMessageTextContent(message))) {
      if (userInput.length === 0) {
        setUserInput(getMessageTextContent(message));
      }

      e.preventDefault();
    }
  };

  const deleteMessage = (msgId?: string) => {
    chatStore.updateCurrentSession(
      (session) =>
        (session.messages = session.messages.filter((m) => m.id !== msgId)),
    );
  };

  const onDelete = (msgId: string) => {
    deleteMessage(msgId);
  };

  const onResend = (message: ChatMessage) => {
    // when it is resending a message
    // 1. for a user's message, find the next bot response
    // 2. for a bot's message, find the last user's input
    // 3. delete original user input and bot's message
    // 4. resend the user's input

    const resendingIndex = session.messages.findIndex(
      (m) => m.id === message.id,
    );

    if (resendingIndex < 0 || resendingIndex >= session.messages.length) {
      console.error("[Chat] failed to find resending message", message);
      return;
    }

    let userMessage: ChatMessage | undefined;
    let botMessage: ChatMessage | undefined;

    if (message.role === "assistant") {
      // if it is resending a bot's message, find the user input for it
      botMessage = message;
      for (let i = resendingIndex; i >= 0; i -= 1) {
        if (session.messages[i].role === "user") {
          userMessage = session.messages[i];
          break;
        }
      }
    } else if (message.role === "user") {
      // if it is resending a user's input, find the bot's response
      userMessage = message;
      for (let i = resendingIndex; i < session.messages.length; i += 1) {
        if (session.messages[i].role === "assistant") {
          botMessage = session.messages[i];
          break;
        }
      }
    }

    if (userMessage === undefined) {
      console.error("[Chat] failed to resend", message);
      return;
    }

    // delete the original messages
    deleteMessage(userMessage.id);
    deleteMessage(botMessage?.id);

    // resend the message
    const textContent = getMessageTextContent(userMessage);
    const images = getMessageImages(userMessage);
    chatStore.onUserInput(textContent, llm, images);
    inputRef.current?.focus();
  };

  const context: RenderMessage[] = useMemo(() => {
    return session.template.hideContext ? [] : session.template.context.slice();
  }, [session.template.context, session.template.hideContext]);

  // No static hello placeholder here: the greeting only appears once the
  // model has loaded and runStartupGreeting actually asks it to say hello,
  // streaming that real message into session.messages.

  // preview messages
  const renderMessages = useMemo(() => {
    return context.concat(session.messages as RenderMessage[]);
  }, [context, session.messages, session.messages.length]);

  const [msgRenderIndex, _setMsgRenderIndex] = useState(
    Math.max(0, renderMessages.length - CHAT_PAGE_SIZE),
  );
  function setMsgRenderIndex(newIndex: number) {
    newIndex = Math.min(renderMessages.length - CHAT_PAGE_SIZE, newIndex);
    newIndex = Math.max(0, newIndex);
    _setMsgRenderIndex(newIndex);
  }

  const messages = useMemo(() => {
    const endRenderIndex = Math.min(
      msgRenderIndex + 3 * CHAT_PAGE_SIZE,
      renderMessages.length,
    );
    return renderMessages.slice(msgRenderIndex, endRenderIndex);
  }, [msgRenderIndex, renderMessages]);

  const onChatBodyScroll = (e: HTMLElement) => {
    const bottomHeight = e.scrollTop + e.clientHeight;
    const edgeThreshold = e.clientHeight;

    const isTouchTopEdge = e.scrollTop <= edgeThreshold;
    const isTouchBottomEdge = bottomHeight >= e.scrollHeight - edgeThreshold;
    const isHitBottom =
      bottomHeight >= e.scrollHeight - (isMobileScreen ? 4 : 10);

    const prevPageMsgIndex = msgRenderIndex - CHAT_PAGE_SIZE;
    const nextPageMsgIndex = msgRenderIndex + CHAT_PAGE_SIZE;

    if (isTouchTopEdge && !isTouchBottomEdge) {
      setMsgRenderIndex(prevPageMsgIndex);
    } else if (isTouchBottomEdge) {
      setMsgRenderIndex(nextPageMsgIndex);
    }

    setHitBottom(isHitBottom);
    setAutoScroll(isHitBottom);
  };
  function scrollToBottom() {
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);
    scrollDomToBottom();
  }

  // clear context index = context length + index in messages
  const clearContextIndex =
    (session.clearContextIndex ?? -1) >= 0
      ? session.clearContextIndex! + context.length - msgRenderIndex
      : -1;

  const autoFocus = !isMobileScreen; // wont auto focus on mobile screen
  const showMaxIcon = !isMobileScreen;

  useCommand({
    fill: setUserInput,
    submit: (text) => {
      onSubmit(text);
    },
  });

  // remember unfinished input
  useEffect(() => {
    // try to load from local storage
    const key = UNFINISHED_INPUT(session.id);
    const mayBeUnfinishedInput = localStorage.getItem(key);
    if (mayBeUnfinishedInput && userInput.length === 0) {
      setUserInput(mayBeUnfinishedInput);
      localStorage.removeItem(key);
    }

    const dom = inputRef.current;
    return () => {
      localStorage.setItem(key, dom?.value ?? "");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const currentModel = config.modelConfig.model;
      if (!isVisionModel(currentModel)) {
        return;
      }
      const items =
        event.clipboardData.items || (await navigator.clipboard.read());
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          event.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const images: ChatImage[] = [];
            images.push(...attachImages);
            images.push(
              ...(await new Promise<ChatImage[]>((res, rej) => {
                setUploading(true);
                const imagesData: ChatImage[] = [];
                compressImage(file, 256 * 1024)
                  .then((imageData) => {
                    imagesData.push(imageData);
                    setUploading(false);
                    res(imagesData);
                  })
                  .catch((e) => {
                    setUploading(false);
                    rej(e);
                  });
              })),
            );
            const imagesLength = images.length;

            if (imagesLength > 3) {
              images.splice(3, imagesLength - 3);
            }
            setAttachImages(images);
          }
        }
      }
    },
    [attachImages, chatStore],
  );

  // Above this many raw bytes, skip the CPU-heavy passes (UTF-8 decode,
  // modifier tagging, PDF/XLSX extraction) and keep only the lossless OPFS
  // write plus the O(byteLength) entropy scan (already block-capped by
  // Arbitrary file upload — any type, not just images. Original bytes are
  // retained losslessly in OPFS; no prefix is sent as if it were the entire
  // source. The eoreader6 boundary pass is source metadata; PDF/XLSX/DOCX/
  // PPTX/ODF/EPUB/RTF bytes get a best-effort text extraction
  // (eo-file-extract.ts, via eo-source-ingest.ts's ingestFile) and, once
  // extracted, are treated exactly like any other text file from here on —
  // same modifier-graph/EOT pipeline, same textReadable: true, same
  // eligibility for eo-corpus.ts's turn-time corpus surf. What actually
  // reaches a chat turn is always decided later, at turn time, by surf
  // (eo-corpus.ts for text, eo-binary-structure.ts for the rest) — never
  // here.
  async function uploadFile() {
    const files: File[] = await new Promise((res) => {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.multiple = true;
      fileInput.onchange = (event: any) => {
        res(Array.from(event.target.files as FileList));
      };
      fileInput.click();
    });
    if (!files.length) return;

    setUploadingFile(true);
    let succeeded = 0;
    let lastSucceededName = "";
    try {
      for (const file of files) {
        try {
          const { source, logLines } = await ingestFile(file);
          chatStore.registerEoSource(source);
          for (const line of logLines)
            chatStore.pushEoLog(line.channel, line.text);
          // Admit into the hypergraph right away — a source used to sit
          // registered-but-ungrounded (Network/Entity/etc. all reporting
          // "no graph yet") until the reader's first chat turn happened to
          // trigger ensureHypergraphHydrated's own re-scan. A reader who
          // opens Terrain right after uploading should see the graph a
          // source actually produced, not "add a source to start one" for
          // a source that's already sitting right above it.
          if (source.textReadable) {
            try {
              const bytes = await readRawSource(source.id);
              const text = new TextDecoder("utf-8", { fatal: true }).decode(
                bytes,
              );
              const movements = ensureHypergraphHydrated(
                hypergraphScopeId(session),
                [{ id: source.id, text }],
                [],
              );
              for (const m of movements)
                chatStore.pushEoLog(
                  "hypergraph",
                  describeHypergraphMovement(m),
                );
            } catch {
              // Best-effort — the source still registers and will be
              // picked up by the next message's own re-scan either way.
            }
          }
          succeeded++;
          lastSucceededName = file.name;
        } catch (err) {
          chatStore.pushEoLog(
            "error",
            `file: "${file.name}" failed to upload — ${(err as Error).message}`,
          );
        }
      }
      const failed = files.length - succeeded;
      if (succeeded > 0) {
        showToast(
          succeeded === 1
            ? `${lastSucceededName} added to this chat's source corpus`
            : `${succeeded} file(s) added to this chat's source corpus`,
        );
      }
      if (failed > 0) {
        showToast(
          failed === 1
            ? `1 file failed to upload — see the EOT log`
            : `${failed} files failed to upload — see the EOT log`,
        );
      }
    } finally {
      setUploadingFile(false);
    }
  }

  // A file picker that resolves to null on cancel instead of hanging —
  // unlike uploadFile's promise, which never resolves if the user backs
  // out (fine there, since nothing depends on the cancel path; rereadSource
  // below does).
  async function pickReplacementFile(): Promise<File | null> {
    return new Promise((resolve) => {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.onchange = (event: any) => {
        resolve((event.target.files as FileList)[0] ?? null);
      };
      fileInput.oncancel = () => resolve(null);
      fileInput.click();
    });
  }

  // Re-reads a source against its persisted ledger. Offers to replace the
  // source's bytes first (e.g. the underlying file changed on disk) —
  // cancelling the picker just re-reads what's already stored, which
  // mostly exercises the confirm path unless the tagger/typology itself
  // changed since the last read. Either way, a disagreement with what the
  // ledger already held mints a real SEG.revise event (never overwriting
  // the prior entry); the before/after Link-terrain views are compared via
  // reading-diff.js's readAtCursors + diffLinkViews (the multi-cursor
  // projection built for exactly this) to report what actually changed.
  async function rereadSource(source: EoSource) {
    if (!source.textReadable) return;
    setRereadingSourceId(source.id);
    try {
      const replacement = await pickReplacementFile();
      let bytes: Uint8Array;
      if (replacement) {
        bytes = new Uint8Array(await replacement.arrayBuffer());
        await persistRawSource(source.id, bytes);
      } else {
        bytes = await readRawSource(source.id);
      }
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const result = await reReadSource(source.id, decoded);

      const readerEOT =
        result.reading && !("gap" in result.reading)
          ? toEOTReader(result, { roomName: `source_${source.id}` })
          : undefined;
      chatStore.updateCurrentSession((current) => {
        current.eoSources = (current.eoSources ?? []).map((s) =>
          s.id === source.id
            ? {
                ...s,
                ...(readerEOT ? { readerEOT } : {}),
                ...(replacement
                  ? {
                      byteLength: bytes.length,
                      mimeType: replacement.type || "application/octet-stream",
                    }
                  : {}),
              }
            : s,
        );
      });

      chatStore.recordSourceLedger(source.id, ledgerStats(result.log));

      let summary = `${result.revisions.length} revision(s)`;
      const cursors = readAtCursors(
        result.log,
        [{ lensDef: MODIFIER_SCOPE_CURRENT_LENS, terrain: "Link" }],
        [
          { name: "before", cursor: result.cursorBeforeThisRun },
          { name: "after", cursor: result.log.tick },
        ],
      );
      if (!("gap" in cursors)) {
        const viewA = cursors[0].lenses.find(
          (l: any) => l.terrain === "Link",
        ).view;
        const viewB = cursors[1].lenses.find(
          (l: any) => l.terrain === "Link",
        ).view;
        const diff = diffLinkViews(viewA, viewB);
        summary = `${diff.added.length} new, ${diff.changed.length} revised, ${diff.unchanged.length} unchanged`;
      }

      chatStore.pushEoLog(
        "file",
        `file: ${result.isFirstRead ? "read" : "re-read"} "${source.name}" — ${summary}, cursor ${result.log.tick}`,
      );
    } catch (err) {
      chatStore.pushEoLog(
        "error",
        `file: re-read "${source.name}" failed — ${(err as Error).message}`,
      );
    } finally {
      setRereadingSourceId(null);
    }
  }

  return (
    <div className={styles.chat} key={session.id}>
      <div className="window-header">
        {isMobileScreen && (
          <div className="window-actions">
            <div className={"window-action-button"}>
              <IconButton
                icon={<ReturnIcon />}
                title={Locale.Chat.Actions.ChatList}
                onClick={() => navigate(Path.Home)}
              />
            </div>
          </div>
        )}

        <div className={`window-header-title ${styles["chat-body-title"]}`}>
          <div
            className={`window-header-main-title ${styles["chat-body-main-title"]}`}
            onClickCapture={() => setShowEditPromptModal(true)}
          >
            {!session.topic ? DEFAULT_TOPIC : session.topic}
          </div>
          <div className="window-header-sub-title">
            {Locale.Chat.SubTitle(session.messages.length)}
            {session.template.name &&
              session.template.name !== DEFAULT_TOPIC && (
                <> &middot; responding as {session.template.name}</>
              )}
          </div>
        </div>
        <div className="window-actions">
          <div className="window-action-button">
            <IconButton
              icon={<ShareNetwork size={16} />}
              title="Terrain — entities, relations, and their sources"
              onClick={() => {
                if (showTerrainPanel) {
                  closeTerrainPanel();
                } else if (activeTerrainCard) {
                  // Resume wherever this session's panel was last left --
                  // history/index persist across a close.
                  setTerrainPanelOpen(true);
                  setShowEoLog(false);
                } else {
                  openTerrainCard({ kind: "network", params: {} });
                }
              }}
            />
          </div>
          <div className="window-action-button">
            <IconButton
              icon={<Paperclip size={16} />}
              title="Sources — this chat's local corpus"
              onClick={() => setShowSources((v) => !v)}
            />
          </div>
          {/* Rename/Share/Export/EOT-log/Maximize used to each get their own
              always-visible icon (7 buttons total on desktop) — collapsed
              into one overflow menu since Terrain/Sources are the two a
              reader actually reaches for during a session; the rest are
              occasional or dev-facing. Rename doubles as a no-op here since
              clicking the title itself already opens the same modal
              (window-header-main-title's onClickCapture above) — kept in
              the menu anyway since a reader scanning a menu for "rename"
              shouldn't have to already know that secondary affordance. */}
          <div className="window-action-button">
            <Popover
              open={showHeaderMenu}
              onClose={() => setShowHeaderMenu(false)}
              content={
                <div className={styles["header-menu"]}>
                  <div
                    className={styles["header-menu-item"]}
                    onClick={() => {
                      setShowHeaderMenu(false);
                      setShowEditPromptModal(true);
                    }}
                  >
                    <RenameIcon /> Rename
                  </div>
                  <div
                    className={styles["header-menu-item"]}
                    onClick={() => {
                      setShowHeaderMenu(false);
                      const params = new URLSearchParams({
                        model: config.modelConfig.model,
                        temperature: config.modelConfig.temperature.toString(),
                        top_p: config.modelConfig.top_p.toString(),
                        max_tokens: config.modelConfig.max_tokens.toString(),
                        presence_penalty:
                          config.modelConfig.presence_penalty.toString(),
                        frequency_penalty:
                          config.modelConfig.frequency_penalty.toString(),
                      });
                      const shareUrl = new URL(
                        `${window.location.origin}${window.location.pathname}?${params}`,
                      );
                      copyToClipboard(shareUrl.href);
                    }}
                  >
                    <ShareIcon /> {Locale.Chat.Actions.Share}
                  </div>
                  <div
                    className={styles["header-menu-item"]}
                    onClick={() => {
                      setShowHeaderMenu(false);
                      setShowExport(true);
                    }}
                  >
                    <ExportIcon /> {Locale.Chat.Actions.Export}
                  </div>
                  <div
                    className={styles["header-menu-item"]}
                    onClick={() => {
                      setShowHeaderMenu(false);
                      setShowEoLog((v) => {
                        if (!v) closeTerrainPanel();
                        return !v;
                      });
                    }}
                  >
                    <TerminalWindow size={17} /> EOT — system log
                  </div>
                  {showMaxIcon && (
                    <div
                      className={styles["header-menu-item"]}
                      onClick={() => {
                        setShowHeaderMenu(false);
                        config.update(
                          (config) =>
                            (config.tightBorder = !config.tightBorder),
                        );
                      }}
                    >
                      {config.tightBorder ? <MinIcon /> : <MaxIcon />}{" "}
                      {config.tightBorder ? "Restore window" : "Maximize"}
                    </div>
                  )}
                </div>
              }
            >
              <IconButton
                icon={<DotsThreeVertical size={18} />}
                title="More"
                onClick={() => setShowHeaderMenu((v) => !v)}
              />
            </Popover>
          </div>
        </div>
      </div>

      {showEoLog &&
        (() => {
          // Newest first -- a running terminal is read for "what just
          // happened", not scrolled to the bottom to find it. Every event
          // pushed this session stays in the feed (EO_LOG_MAX bounds the
          // session's own ring buffer, not this render); folding on an
          // entity only narrows which of them are shown, never drops them
          // from the underlying log.
          // A project-scoped session's EOT log is the PROJECT's shared log
          // (hypergraphScopeId's own reasoning, applied to the log) -- go
          // through the selector rather than session.eoLog directly, or a
          // project's chats would each read a different, diverging history.
          const orderedEoLog = [...chatStore.sessionEoLog(session)].reverse();
          const logQuery = eotFoldEntity || eotLogSearch.trim() || null;
          const eotEntries = logQuery
            ? orderedEoLog.filter((entry) =>
                entry.text.toLowerCase().includes(logQuery.toLowerCase()),
              )
            : orderedEoLog;

          // Graph terrain: the same click-to-fold entity, OR a typed
          // search — "manually surf and fold" — drive the identical
          // substring pivot foldGraphOnEntity already performs.
          const graphQuery = eotFoldEntity || eotGraphSearch.trim() || null;
          const graphSnap: GraphTerrainSnapshot | null =
            eotTerminalTab === "graph"
              ? foldGraphOnEntity(hypergraphScopeId(session), graphQuery)
              : null;
          const tiersSnap: TierTerrainSnapshot | null =
            eotTerminalTab === "graph"
              ? hypergraphTiersSnapshot(hypergraphScopeId(session))
              : null;

          return (
            <div className={styles["eot-panel"]}>
              <div className={styles["eot-panel-header"]}>
                <div className={styles["eot-panel-tabs"]}>
                  <div
                    className={
                      styles["eot-panel-tab"] +
                      (eotTerminalTab === "log"
                        ? ` ${styles["eot-panel-tab-active"]}`
                        : "")
                    }
                    onClick={() => setEotTerminalTab("log")}
                  >
                    Log
                  </div>
                  <div
                    className={
                      styles["eot-panel-tab"] +
                      (eotTerminalTab === "graph"
                        ? ` ${styles["eot-panel-tab-active"]}`
                        : "")
                    }
                    onClick={() => setEotTerminalTab("graph")}
                    title="The belief graph and tier stack this session has read so far"
                  >
                    Graph
                  </div>
                </div>
                <div
                  className={styles["eot-panel-close"]}
                  onClick={() => setShowEoLog(false)}
                  title="Close system log"
                >
                  ✕ Close
                </div>
              </div>

              {eotTerminalTab === "log" && (
                <>
                  <input
                    className={styles["eot-graph-search"]}
                    type="text"
                    placeholder="Search / fold the log — a name, a kind…"
                    value={eotLogSearch}
                    onChange={(e) => setEotLogSearch(e.target.value)}
                  />
                  {logQuery && (
                    <div className={styles["eot-panel-fold"]}>
                      Folded on &quot;{logQuery}&quot; — showing{" "}
                      {eotEntries.length} of {orderedEoLog.length} event
                      {orderedEoLog.length === 1 ? "" : "s"}
                      <span
                        className={styles["eot-panel-fold-clear"]}
                        onClick={() => {
                          setEotFoldEntity(null);
                          setEotLogSearch("");
                        }}
                      >
                        Clear
                      </span>
                    </div>
                  )}
                  {!orderedEoLog.length ? (
                    <div className={styles["eot-panel-empty"]}>
                      EOT — nothing has run yet this session. Send a message to
                      see surf (instruction gate), fold (context-budget clamp),
                      send (what reached the engine), and background tasks
                      (topic naming, discourse fold) logged here as they happen.
                    </div>
                  ) : !eotEntries.length ? (
                    <div className={styles["eot-panel-empty"]}>
                      No events mention &quot;{logQuery}&quot;.
                    </div>
                  ) : (
                    eotEntries.map((entry) => (
                      <div key={entry.id}>
                        [{new Date(entry.ts).toLocaleTimeString()}]{" "}
                        <span
                          className={
                            styles["eot-entry-kind"] +
                            " " +
                            (styles[`eot-entry-${entry.kind}`] ?? "")
                          }
                        >
                          {entry.kind.toUpperCase()}
                        </span>
                        {renderEotEntryText(
                          entry.text,
                          eotFoldEntity,
                          (entity) =>
                            setEotFoldEntity((current) =>
                              current === entity ? null : entity,
                            ),
                        )}
                      </div>
                    ))
                  )}
                </>
              )}

              {eotTerminalTab === "graph" && (
                <>
                  <input
                    className={styles["eot-graph-search"]}
                    type="text"
                    placeholder="Search / fold the graph — a name, a relation…"
                    value={eotGraphSearch}
                    onChange={(e) => setEotGraphSearch(e.target.value)}
                  />
                  {!graphSnap ? (
                    <div className={styles["eot-panel-empty"]}>
                      EOT — no graph yet this session. Send a message or add a
                      source to start one.
                    </div>
                  ) : (
                    <>
                      <div className={styles["eot-graph-stats"]}>
                        <span className={styles["eot-graph-cursor"]}>
                          cursor {graphSnap.cursor}
                        </span>
                        {graphSnap.nodeCount} node
                        {graphSnap.nodeCount === 1 ? "" : "s"} total ·{" "}
                        {graphSnap.edgeCount} edge
                        {graphSnap.edgeCount === 1 ? "" : "s"} total
                      </div>
                      {graphQuery && (
                        <div className={styles["eot-panel-fold"]}>
                          Folded on &quot;{graphQuery}&quot; — showing{" "}
                          {graphSnap.edges.length} edge
                          {graphSnap.edges.length === 1 ? "" : "s"}
                          <span
                            className={styles["eot-panel-fold-clear"]}
                            onClick={() => {
                              setEotFoldEntity(null);
                              setEotGraphSearch("");
                            }}
                          >
                            Clear
                          </span>
                        </div>
                      )}
                      {!graphSnap.edges.length ? (
                        <div className={styles["eot-graph-empty"]}>
                          {graphQuery
                            ? `No relation matches "${graphQuery}".`
                            : "No relations read yet."}
                        </div>
                      ) : (
                        buildGraphEOT(graphSnap, { roomName: "graph" })
                          .split("\n")
                          .map((line, i) => (
                            <div key={i} className={styles["eot-graph-edge"]}>
                              {renderGraphEOTLine(
                                line,
                                eotFoldEntity,
                                (entity) =>
                                  setEotFoldEntity((current) =>
                                    current === entity ? null : entity,
                                  ),
                              )}
                            </div>
                          ))
                      )}
                      {tiersSnap?.tiers.map(renderTerrain)}
                    </>
                  )}
                </>
              )}
            </div>
          );
        })()}

      {showSources && (
        <aside className={styles["source-panel"]} aria-label="Source corpus">
          <div className={styles["source-panel-header"]}>
            <div>
              <div className={styles["source-panel-kicker"]}>Source corpus</div>
              <div className={styles["source-panel-title"]}>
                {session.eoSources?.length ?? 0} local source
                {(session.eoSources?.length ?? 0) === 1 ? "" : "s"}
              </div>
            </div>
            <button
              onClick={() => setShowSources(false)}
              aria-label="Close sources"
            >
              ×
            </button>
          </div>
          <p className={styles["source-panel-note"]}>
            Original files stay in this browser in full. Each turn surfaces only
            matching passages from the enabled sources.
          </p>
          <button
            className={styles["source-add"]}
            onClick={uploadFile}
            disabled={uploadingFile}
          >
            <Paperclip size={14} /> {uploadingFile ? "Adding…" : "Add sources"}
          </button>
          <div className={styles["source-item"]}>
            <label className={styles["source-row"]}>
              <input
                type="checkbox"
                checked={session.eoConversationEnabled !== false}
                onChange={() =>
                  chatStore.updateCurrentSession((current) => {
                    current.eoConversationEnabled =
                      current.eoConversationEnabled === false;
                  })
                }
              />
              <span className={styles["source-row-body"]}>
                <strong>This conversation</strong>
                <small>
                  {session.messages.length} message
                  {session.messages.length === 1 ? "" : "s"} · admitted into the
                  same graph as an uploaded source
                </small>
              </span>
            </label>
          </div>
          <div className={styles["source-list"]}>
            {!session.eoSources?.length ? (
              <div className={styles["source-empty"]}>
                No sources yet. Add a file to make it available to this chat.
              </div>
            ) : (
              session.eoSources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  rereading={rereadingSourceId === source.id}
                  onToggleEnabled={() =>
                    chatStore.updateCurrentSession((current) => {
                      current.eoSources = (current.eoSources ?? []).map((s) =>
                        s.id === source.id ? { ...s, enabled: !s.enabled } : s,
                      );
                    })
                  }
                  onReread={() => rereadSource(source)}
                />
              ))
            )}
          </div>
        </aside>
      )}

      <div className={styles["chat-main-row"]}>
        <div className={styles["chat-main-column"]}>
          <div
            className={styles["chat-body"]}
            ref={scrollRef}
            onScroll={(e) => onChatBodyScroll(e.currentTarget)}
            onMouseDown={() => inputRef.current?.blur()}
            onTouchStart={() => {
              inputRef.current?.blur();
              setAutoScroll(false);
            }}
          >
            <div className={styles["chat-action-context"]}>
              <ChatAction
                text={Locale.Chat.Actions.EditConversation}
                icon={<EditIcon />}
                onClick={() => setShowEditPromptModal(true)}
                fullWidth
              />
            </div>
            {session.modelLoadProgress && (
              <div className={styles["model-load-progress"]}>
                <div className={styles["model-load-progress-header"]}>
                  <span className={styles["model-load-progress-title"]}>
                    <span className={styles["model-load-spinner"]} />
                    {Locale.Chat.ModelLoading.Title}
                  </span>
                  <span>
                    {Math.round(session.modelLoadProgress.progress * 100)}%
                  </span>
                </div>
                <div className={styles["model-load-progress-track"]}>
                  <div
                    className={styles["model-load-progress-bar"]}
                    style={{
                      width: `${Math.round(
                        session.modelLoadProgress.progress * 100,
                      )}%`,
                    }}
                  />
                </div>
                <div className={styles["model-load-progress-text"]}>
                  {session.modelLoadProgress.text}
                </div>
                <div className={styles["model-load-progress-note"]}>
                  {Locale.Chat.ModelLoading.Note}
                </div>
              </div>
            )}
            {messages.map((message, i) => {
              const isUser = message.role === "user";
              const isContext = i < context.length;
              const showActions =
                i > 0 &&
                !(message.preview || message.content.length === 0) &&
                !isContext;
              const showTyping = message.preview || message.streaming;
              const speechId = `msg:${message.id ?? i}`;
              const speechPlaying = ttsPlayingId === speechId;

              const shouldShowClearContextDivider = i === clearContextIndex - 1;

              return (
                <Fragment key={`${i}/${message.id}`}>
                  <div
                    className={
                      isUser
                        ? styles["chat-message-user"]
                        : styles["chat-message"]
                    }
                  >
                    <div className={styles["chat-message-container"]}>
                      <div className={styles["chat-message-header"]}>
                        <div className={styles["chat-message-avatar"]}>
                          {!isUser && (
                            <>
                              {["system"].includes(message.role) ? (
                                <Avatar avatar="2699-fe0f" /> // Gear icon
                              ) : (
                                <TemplateAvatar
                                  avatar={session.template.avatar}
                                  model={
                                    message.model || config.modelConfig.model
                                  }
                                  streamedText={getMessageTextContent(message)}
                                  name={session.template.name}
                                />
                              )}
                            </>
                          )}
                        </div>
                        <div
                          className={styles["chat-message-role-name-container"]}
                        >
                          {message.role === "system" && (
                            <div
                              className={`${styles["chat-message-role-name"]} ${styles["no-hide"]}`}
                            >
                              {Locale.Chat.Roles.System}
                            </div>
                          )}
                          {showActions && (
                            <div className={styles["chat-message-actions"]}>
                              <div className={styles["chat-input-actions"]}>
                                <ChatAction
                                  text={Locale.Chat.Actions.Edit}
                                  icon={<EditIcon />}
                                  onClick={async () => {
                                    const newMessage = await showPrompt(
                                      Locale.Chat.Actions.Edit,
                                      getMessageTextContent(message),
                                      10,
                                    );
                                    let newContent:
                                      string | MultimodalContent[] = newMessage;
                                    const images = getMessageImages(message);
                                    if (images.length > 0) {
                                      newContent = [
                                        { type: "text", text: newMessage },
                                      ];
                                      for (let i = 0; i < images.length; i++) {
                                        newContent.push({
                                          type: "image_url",
                                          image_url: {
                                            url: images[i].url,
                                          },
                                          dimension: {
                                            width: images[i].width,
                                            height: images[i].height,
                                          },
                                        });
                                      }
                                    }
                                    chatStore.updateCurrentSession(
                                      (session) => {
                                        const m = session.template.context
                                          .concat(session.messages)
                                          .find((m) => m.id === message.id);
                                        if (m) {
                                          m.content = newContent;
                                        }
                                      },
                                    );
                                  }}
                                />
                                {message.streaming ? (
                                  <ChatAction
                                    text={Locale.Chat.Actions.Stop}
                                    icon={<StopIcon />}
                                    onClick={() => onUserStop()}
                                  />
                                ) : (
                                  <>
                                    <ChatAction
                                      text={Locale.Chat.Actions.Retry}
                                      icon={<ResetIcon />}
                                      onClick={() => onResend(message)}
                                    />

                                    <ChatAction
                                      text={
                                        speechPlaying ? "Stop" : "Read aloud"
                                      }
                                      icon={
                                        speechPlaying ? (
                                          <StopIcon />
                                        ) : (
                                          <SpeakerIcon />
                                        )
                                      }
                                      selected={speechPlaying}
                                      onClick={() => {
                                        if (speechPlaying) {
                                          ttsStop();
                                          return;
                                        }
                                        const full =
                                          getMessageTextContent(message);
                                        const { rest } = splitThinking(full);
                                        const text = toSpeechText(rest || full);
                                        if (!text.trim()) {
                                          showToast("Nothing to read aloud");
                                          return;
                                        }
                                        ttsSpeak(speechId, text);
                                      }}
                                    />

                                    <ChatAction
                                      text={Locale.Chat.Actions.Delete}
                                      icon={<DeleteIcon />}
                                      onClick={() => onDelete(message.id ?? i)}
                                    />

                                    <ChatAction
                                      text={Locale.Chat.Actions.Copy}
                                      icon={<CopyIcon />}
                                      onClick={() =>
                                        copyToClipboard(
                                          getMessageTextContent(message),
                                        )
                                      }
                                    />
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      {showTyping && (
                        <div className={styles["chat-message-status"]}>
                          {Locale.Chat.Typing}
                        </div>
                      )}
                      <div className={styles["chat-message-item"]}>
                        {(() => {
                          const fullText = getMessageTextContent(message);
                          const { thinking, rest, open } = !isUser
                            ? splitThinking(fullText)
                            : {
                                thinking: null as string | null,
                                rest: fullText,
                                open: false,
                              };
                          // groundingSpans' [start,end) are offsets into the
                          // FULL text chat.ts ran buildGroundingSpans against
                          // (fullText above), not `rest` — splitThinking only
                          // ever removes a PREFIX (the <think> block, plus
                          // leading whitespace), so `rest` is always an exact
                          // suffix of fullText, and this length difference is
                          // the exact shift, with no need to re-derive
                          // splitThinking's own <think>-close-tag arithmetic.
                          const spanShift = fullText.length - rest.length;
                          const shiftedGroundingSpans =
                            !isUser && message.groundingSpans && spanShift >= 0
                              ? message.groundingSpans
                                  .map((s) => ({
                                    ...s,
                                    start: s.start - spanShift,
                                    end: s.end - spanShift,
                                  }))
                                  .filter(
                                    (s) => s.start >= 0 && s.end <= rest.length,
                                  )
                              : undefined;
                          return (
                            <>
                              {thinking && (
                                <ThinkingPanel
                                  thinking={thinking}
                                  open={open && !!message.streaming}
                                />
                              )}
                              {!isUser && message.responseKind && (
                                <div
                                  style={{
                                    marginBottom: 8,
                                    fontSize: "12px",
                                    opacity: 0.65,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                  }}
                                >
                                  {`\u{2696} System 2 · ${message.responseKind.replace(/-/g, " ")}`}
                                </div>
                              )}
                              {/* Warrant/Plan trace panels hidden per feedback — the
                                  per-message "Warrant — System 1..." / "Plan — ..."
                                  lines above the reply. Data is still collected
                                  (message.warrantTrace/planTrace); CiteyNote's
                                  click-to-open still no-ops safely without a
                                  rendered panel. Re-enable by uncommenting below.
                              {!isUser && message.warrantTrace && (
                                <WarrantPanel
                                  trace={message.warrantTrace}
                                  id={`warrant-${message.id ?? i}`}
                                />
                              )}
                              {!isUser && message.planTrace && (
                                <PlanPanel trace={message.planTrace} />
                              )}
                              */}
                              {!isUser && message.sourceCitations?.length ? (
                                <SourceCitationsPanel
                                  citations={message.sourceCitations}
                                />
                              ) : null}
                              {!isUser && message.webResults !== undefined && (
                                <WebSearchPanel
                                  results={message.webResults}
                                  query={message.webQuery}
                                  groundingReport={message.groundingReport}
                                  snippets={message.webSnippets}
                                />
                              )}
                              <Markdown
                                content={rest}
                                loading={
                                  (message.preview || message.streaming) &&
                                  message.content.length === 0 &&
                                  !isUser
                                }
                                onContextMenu={(e) => onRightClick(e, message)}
                                onDoubleClickCapture={() => {
                                  if (!isMobileScreen) return;
                                  setUserInput(getMessageTextContent(message));
                                }}
                                fontSize={fontSize}
                                parentRef={scrollRef}
                                defaultShow={i >= messages.length - 6}
                                groundingSpans={
                                  session.groundingDisplayEnabled === false
                                    ? undefined
                                    : shiftedGroundingSpans
                                }
                                groundingCitations={
                                  session.groundingDisplayEnabled === false
                                    ? undefined
                                    : message.groundingCitations
                                }
                                onOpenCitation={(span, citation) =>
                                  setOpenCitation({
                                    content: rest,
                                    spans: shiftedGroundingSpans ?? [],
                                    citations: message.groundingCitations ?? [],
                                    span,
                                    citation,
                                  })
                                }
                                entityMentionIds={entityMentionIds}
                                onEntityClick={(entity) =>
                                  openTerrainCard({
                                    kind: "entity",
                                    params: { entity },
                                  })
                                }
                              />
                              {!isUser && (
                                <CiteyNote
                                  spans={shiftedGroundingSpans}
                                  citations={message.groundingCitations}
                                  warrantPanelId={`warrant-${message.id ?? i}`}
                                />
                              )}
                            </>
                          );
                        })()}
                        {getMessageImages(message).length == 1 && (
                          <Image
                            className={styles["chat-message-item-image"]}
                            src={getMessageImages(message)[0].url}
                            width={getMessageImages(message)[0].width}
                            height={getMessageImages(message)[0].height}
                            alt=""
                          />
                        )}
                        {getMessageImages(message).length > 1 && (
                          <div
                            className={styles["chat-message-item-images"]}
                            style={
                              {
                                "--image-count":
                                  getMessageImages(message).length,
                              } as React.CSSProperties
                            }
                          >
                            {getMessageImages(message).map((image, index) => {
                              return (
                                <Image
                                  className={
                                    styles["chat-message-item-image-multi"]
                                  }
                                  key={index}
                                  src={image.url}
                                  width={image.width}
                                  height={image.height}
                                  alt=""
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {/* Per-message timestamp hidden per feedback — the
                          "System Prompt" context-marker label stays (it's
                          not a date, it flags the clear-context boundary). */}
                      {isContext && (
                        <div className={styles["chat-message-action-date"]}>
                          <div>{Locale.Chat.IsContext}</div>
                        </div>
                      )}
                    </div>
                  </div>
                  {shouldShowClearContextDivider && <ClearContextDivider />}
                </Fragment>
              );
            })}
          </div>
          <div className={styles["chat-input-panel"]}>
            <ScrollDownToast onclick={scrollToBottom} show={!hitBottom} />
            <PromptHints
              prompts={promptHints}
              onPromptSelect={onPromptSelect}
            />

            <ChatActions
              uploadFile={uploadFile}
              setAttachImages={setAttachImages}
              setUploading={setUploading}
              scrollToBottom={scrollToBottom}
              hitBottom={hitBottom}
              uploading={uploading}
              uploadingFile={uploadingFile}
              showPromptSetting={() => setShowEditPromptModal(true)}
              showPromptHints={() => {
                // Click again to close
                if (promptHints.length > 0) {
                  setPromptHints([]);
                  return;
                }

                inputRef.current?.focus();
                setUserInput("/");
                onSearch("");
              }}
            />
            <label
              className={`${styles["chat-input-panel-inner"]} ${
                attachImages.length != 0
                  ? styles["chat-input-panel-inner-attach"]
                  : ""
              }`}
              htmlFor="chat-input"
            >
              <textarea
                id="chat-input"
                ref={inputRef}
                className={styles["chat-input"]}
                placeholder={Locale.Chat.Input(submitKey)}
                onInput={(e) => onInput(e.currentTarget.value)}
                value={userInput}
                onKeyDown={onInputKeyDown}
                onFocus={scrollToBottom}
                onClick={scrollToBottom}
                onPaste={handlePaste}
                rows={inputRows}
                autoFocus={autoFocus}
                style={{
                  fontSize: config.fontSize,
                }}
              />
              {attachImages.length != 0 && (
                <div className={styles["attach-images"]}>
                  {attachImages.map((image, index) => {
                    return (
                      <div
                        key={index}
                        className={styles["attach-image"]}
                        style={{ backgroundImage: `url("${image.url}")` }}
                      >
                        <div className={styles["attach-image-template"]}>
                          <DeleteImageButton
                            deleteImage={() => {
                              setAttachImages(
                                attachImages.filter((_, i) => i !== index),
                              );
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {isStreaming ? (
                <IconButton
                  icon={<StopIcon />}
                  text={Locale.Chat.InputActions.Stop}
                  className={styles["chat-input-send"]}
                  type="primary"
                  onClick={() => onUserStop()}
                />
              ) : (
                <IconButton
                  icon={<SendWhiteIcon />}
                  text={Locale.Chat.Send}
                  className={styles["chat-input-send"]}
                  type="primary"
                  onClick={() => onSubmit(userInput)}
                />
              )}
            </label>
          </div>
        </div>
        {showTerrainPanel && (
          <TerrainPanel
            session={session}
            active={activeTerrainCard}
            canBack={terrainHistoryIndex > 0}
            canForward={terrainHistoryIndex < terrainHistory.length - 1}
            onBack={terrainBack}
            onForward={terrainForward}
            onNavigate={openTerrainCard}
            onClose={closeTerrainPanel}
          />
        )}
      </div>

      {showExport && (
        <ExportMessageModal onClose={() => setShowExport(false)} />
      )}

      {showEditPromptModal && (
        <SessionConfigModel onClose={() => setShowEditPromptModal(false)} />
      )}

      {openCitation && (
        <CitationModal
          messageContent={openCitation.content}
          span={openCitation.span}
          citation={openCitation.citation}
          citationNumber={buildCitationNumbering(
            openCitation.spans,
            openCitation.citations,
          ).get(openCitation.citation.index)}
          onNavigate={openTerrainCard}
          onClose={() => setOpenCitation(null)}
        />
      )}
    </div>
  );
}

export function Chat() {
  const chatStore = useChatStore();
  const sessionIndex = chatStore.currentSessionIndex;
  return <ChatInner key={sessionIndex}></ChatInner>;
}
