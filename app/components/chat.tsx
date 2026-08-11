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

import {
  ChatMessage,
  SubmitKey,
  useChatStore,
  BOT_HELLO,
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
} from "@phosphor-icons/react";
import {
  findBinaryStructure,
  formatBinaryStructureBlock,
} from "../client/eo-binary-structure";
import { tryExtractText } from "../client/eo-file-extract";
import {
  createModifierGraph,
  enrichModifierGraphFromText,
  formatModifierGraphBlock,
} from "../client/eo-modifier-graph";
import { buildReading, toEOTReader, reReadSource } from "../client/eo-reading";
import {
  isReadableUtf8,
  persistRawSource,
  persistSourceLedger,
  readRawSource,
  readSourceLedger,
} from "../client/eo-corpus";
import {
  hypergraphSnapshot,
  foldGraphOnEntity,
  hypergraphTiersSnapshot,
  type GraphTerrainSnapshot,
  type TierTerrainSnapshot,
} from "../client/eo-hypergraph";
import type { EoSource, EventLog } from "../client/eo-corpus";
import {
  readAtCursors,
  diffLinkViews,
} from "../client/eo-binary/reading-diff.js";
import { MODIFIER_SCOPE_CURRENT_LENS } from "../client/eo-binary/modifier-order-lens.js";
import { readDocument } from "../client/eo-binary/reading.js";
import { isGap } from "../client/eo-binary/nul.js";
import { nanoid } from "nanoid";
import type { WebSearchResult } from "../client/eo-websearch";
import type { GroundingReport, Snippet } from "../client/eo-citation-check";

// A breakdown of the ledger's own contents, straight from log.events --
// the append-only record, not the folded projection. Every event type
// this pipeline mints (SEG.narrow/confirm/revise/refuse) is counted, so
// the source panel can show what the ledger actually holds rather than a
// single "revisions" number.
function ledgerStats(log: {
  events: any[];
  tick: number;
}): EoSource["readLedger"] {
  const counts = {
    narrowCount: 0,
    confirmCount: 0,
    revisionCount: 0,
    refuseCount: 0,
  };
  for (const e of log.events) {
    if (e.type === "SEG.narrow") counts.narrowCount++;
    else if (e.type === "SEG.confirm") counts.confirmCount++;
    else if (e.type === "SEG.revise") counts.revisionCount++;
    else if (e.type === "SEG.refuse") counts.refuseCount++;
  }
  return { cursor: log.tick, ...counts };
}

// "Event mode": one line per raw ledger tick, in order -- the append-only
// record itself, nothing folded or hidden. supersedes/confirms are shown
// against the TICK of the event they point to (event_ids are content
// hashes, not something a human reads), so the correction chain is
// legible without leaving the ledger's own vocabulary.
function formatLedgerEventLine(e: any, idToTick: Map<string, number>): string {
  const base = `tick ${e.tick}  ${e.type}`;
  if (e.type === "SEG.refuse") {
    return `${base}  head="${e.head}"  gap=${e.gap}${
      e.reason ? ` (${e.reason})` : ""
    }  [${e.source}]`;
  }
  const edge = `${e.subject} -> ${e.object}  class="${e.class}"`;
  if (e.type === "SEG.revise") {
    return `${base}  ${edge}  -- supersedes tick ${idToTick.get(
      e.supersedes,
    )} (was "${e.priorClass}")`;
  }
  if (e.type === "SEG.confirm") {
    return `${base}  ${edge}  -- confirms tick ${idToTick.get(e.confirms)}`;
  }
  return `${base}  ${edge}`;
}

// "Fold mode": the ledger's append-only trail projected through
// MODIFIER_SCOPE_CURRENT_LENS (latest tick per node) and formatted as an
// EOT reader surface -- the clean, current reading a projection is for,
// as opposed to event mode's raw, unfolded history.
function renderFoldedEOT(log: EventLog, roomName: string): string {
  const reading = readDocument(
    log,
    [{ lensDef: MODIFIER_SCOPE_CURRENT_LENS, terrain: "Link" }],
    log.tick,
  );
  if (isGap(reading)) return `# reading refused: ${reading.gap}`;
  return toEOTReader({ reading, refused: [] } as any, { roomName });
}

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
  uploadImage: () => void;
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
  const [showUploadImage, setShowUploadImage] = useState(false);

  useEffect(() => {
    const show = isVisionModel(currentModel);
    setShowUploadImage(show);
    if (!show) {
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
}) {
  return (
    <details
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
function WarrantPanel(props: { trace: WarrantTrace }) {
  const t = props.trace;
  const headline =
    t.system === "system2"
      ? t.groundingRequired
        ? "checked against what this turn actually read"
        : "deliberated"
      : "answered from general knowledge";
  return (
    <TracePanel
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

function ChatInner() {
  type RenderMessage = ChatMessage & { preview?: boolean };

  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const config = useAppConfig();
  const fontSize = config.fontSize;

  const isStreaming = session.messages.some((m) => m.streaming);

  const [showExport, setShowExport] = useState(false);
  const [showEoLog, setShowEoLog] = useState(false);
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
  // The source panel's ledger viewer: which source is expanded, which of
  // its two modes is showing (the raw append-only event log, or the
  // folded/projected current reading), and the full ledger loaded back
  // from OPFS for whichever source is expanded (the panel row itself only
  // carries the summary counts in readLedger, not the full event list).
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [sourceViewMode, setSourceViewMode] = useState<
    "event" | "fold" | "raw"
  >("fold");
  const [expandedLedger, setExpandedLedger] = useState<EventLog | null>(null);
  const [expandedLedgerLoading, setExpandedLedgerLoading] = useState(false);
  // The source's actual bytes, decoded on demand for the "Raw" tab -- the
  // Fold/Event tabs above only ever show the *derived* EOT reading or
  // ledger, never the file a reader actually uploaded. Loaded lazily (not
  // alongside the ledger) since most views into a source never need it.
  const [rawSource, setRawSource] = useState<
    | { sourceId: string; kind: "text"; text: string }
    | { sourceId: string; kind: "image"; url: string }
    | null
  >(null);
  const [rawSourceLoading, setRawSourceLoading] = useState(false);
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

    if (isStreaming) return;

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

  if (
    context.length === 0 &&
    session.messages.at(0)?.content !== BOT_HELLO.content
  ) {
    const copiedHello = Object.assign({}, BOT_HELLO);
    context.push(copiedHello);
  }

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

  async function uploadImage() {
    const images: ChatImage[] = [];
    images.push(...attachImages);

    images.push(
      ...(await new Promise<ChatImage[]>((res, rej) => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept =
          "image/png, image/jpeg, image/webp, image/heic, image/heif";
        fileInput.multiple = true;
        fileInput.onchange = (event: any) => {
          setUploading(true);
          const files = event.target.files;
          const imagesData: ChatImage[] = [];
          for (let i = 0; i < files.length; i++) {
            const file = event.target.files[i];
            compressImage(file, 256 * 1024)
              .then((imageData) => {
                imagesData.push(imageData);
                if (
                  imagesData.length === 3 ||
                  imagesData.length === files.length
                ) {
                  setUploading(false);
                  res(imagesData);
                }
              })
              .catch((e) => {
                setUploading(false);
                rej(e);
              });
          }
        };
        fileInput.click();
      })),
    );

    const imagesLength = images.length;
    if (imagesLength > 3) {
      images.splice(3, imagesLength - 3);
    }
    setAttachImages(images);
  }

  // Above this many raw bytes, skip the CPU-heavy passes (UTF-8 decode,
  // modifier tagging, PDF/XLSX extraction) and keep only the lossless OPFS
  // write plus the O(byteLength) entropy scan (already block-capped by
  // findBinaryStructure's own chooseBlockSize) — a large file is still
  // "uploaded" in full, it just isn't analyzed on the main thread.
  const MAX_ANALYSIS_BYTES = 50 * 1024 * 1024;
  // Above this many decoded characters, skip modifier-graph/EOT reading
  // specifically (the two regex-based taggers over the whole document) —
  // the source still registers as textReadable and stays fully surfable by
  // eo-corpus.ts's retrieveCorpus, it just doesn't also get a reading.
  const MAX_READING_CHARS = 2_000_000;

  // Arbitrary file upload — any type, not just images. Original bytes are
  // retained losslessly in OPFS; no prefix is sent as if it were the entire
  // source. The eoreader6 boundary pass is source metadata; PDF/XLSX bytes
  // get a best-effort text extraction (eo-file-extract.ts) and, once
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
          const buffer = new Uint8Array(await file.arrayBuffer());
          const id = nanoid();
          await persistRawSource(id, buffer);

          const withinAnalysisBudget = buffer.length <= MAX_ANALYSIS_BYTES;
          const structure = withinAnalysisBudget
            ? findBinaryStructure(buffer)
            : {
                byteLength: buffer.length,
                blockSize: 0,
                blockCount: 0,
                clearings: [],
                gap: "too_large_for_analysis",
              };

          // A decoded string this function can treat as the source's text:
          // either it's already valid UTF-8, or a format-specific extractor
          // (PDF/XLSX) pulled text out of a container that isn't.
          let decoded: string | null = null;
          let textReadable = false;
          if (withinAnalysisBudget) {
            if (isReadableUtf8(buffer)) {
              try {
                decoded = new TextDecoder("utf-8", { fatal: true }).decode(
                  buffer,
                );
                textReadable = true;
              } catch {
                // Coarser isReadableUtf8 sample passed but the full decode
                // didn't; falls through to the binary path below.
              }
            } else {
              decoded = await tryExtractText(buffer, file.name);
              textReadable = decoded !== null;
            }
          }

          // Modifier-order graph enrichment + EOT reading: only for text
          // that decoded cleanly (whether native UTF-8 or extracted), and
          // only ever the disclosed-scope English demo tagger (see
          // eo-modifier-graph.ts) — a non-English document simply yields
          // zero stacks, never a guess. Skipped above MAX_READING_CHARS: the
          // source is still textReadable and still fully corpus-surfable,
          // it just doesn't also carry a reading.
          let modifierGraphSummary:
            | { applied: number; refusedCount: number; entityNodes: string[] }
            | undefined;
          let readerEOT: string | undefined;
          let readLedger: EoSource["readLedger"] | undefined;
          if (decoded && decoded.length <= MAX_READING_CHARS) {
            try {
              const graph = createModifierGraph();
              const report = enrichModifierGraphFromText(graph, decoded);
              modifierGraphSummary = {
                applied: report.applied,
                refusedCount: report.refused.length,
                entityNodes: report.entityNodes,
              };
              if (report.applied > 0) {
                chatStore.pushEoLog(
                  "file",
                  formatModifierGraphBlock(file.name, report),
                );
              }
              const readingResult = buildReading(decoded);
              const eotText = toEOTReader(readingResult, {
                roomName: `source_${id}`,
              });
              if (readingResult.reading && !("gap" in readingResult.reading)) {
                readerEOT = eotText;
                chatStore.pushEoLog(
                  "file",
                  `file: "${file.name}" — read as EOT: a room + ${
                    readingResult.reading.lenses?.find(
                      (l: any) => l.terrain === "Link",
                    )?.view?.length ?? 0
                  } narrowing link(s), cursor ${readingResult.reading.cursor}`,
                );
              }
              // Persist the ledger itself, not just the rendered EOT text —
              // every source gets a real read log from first upload, so a
              // later "Re-read" always has something to resolve against.
              await persistSourceLedger(id, readingResult.log);
              readLedger = ledgerStats(readingResult.log);
            } catch {
              // A reading failure just means no modifier-graph enrichment
              // for this file, not a broken upload.
            }
          }

          // A source's structureSummary is the ONLY material
          // eo-binary-structure.ts's turn-time surf can later score and
          // show for it — computed once, here, never re-derived per turn.
          // Only non-text sources carry one: a text source's real content
          // is what gets surfaced, not a structural summary of it.
          const structureSummary = textReadable
            ? undefined
            : formatBinaryStructureBlock(file.name, structure);

          chatStore.registerEoSource({
            id,
            name: file.name || "(unnamed file)",
            byteLength: buffer.length,
            mimeType: file.type || "application/octet-stream",
            textReadable,
            enabled: true,
            addedAt: Date.now(),
            structure: {
              clearings: structure.clearings.length,
              blockCount: structure.blockCount,
            },
            structureSummary,
            modifierGraph: modifierGraphSummary,
            readerEOT,
            readLedger,
          });
          chatStore.pushEoLog(
            "file",
            `file: ingested "${file.name}" — ${buffer.length} raw byte(s) in OPFS, ` +
              `${structure.clearings.length} clearing(s), ` +
              `${textReadable ? "UTF-8 corpus" : "binary corpus"}` +
              (withinAnalysisBudget ? "" : " (too large for analysis)"),
          );
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

  // Opens (or closes, on a second click) the ledger viewer for one
  // source, loading its full persisted event log back from OPFS -- the
  // summary counts on EoSource.readLedger are enough for the row's badge,
  // but "event mode" needs every tick, and "fold mode" needs the whole
  // log to project through MODIFIER_SCOPE_CURRENT_LENS.
  async function toggleSourceView(source: EoSource) {
    if (expandedSourceId === source.id) {
      setExpandedSourceId(null);
      setExpandedLedger(null);
      setRawSource((current) => {
        if (current?.kind === "image") URL.revokeObjectURL(current.url);
        return null;
      });
      return;
    }
    setExpandedSourceId(source.id);
    setExpandedLedger(null);
    setRawSource((current) => {
      if (current?.kind === "image") URL.revokeObjectURL(current.url);
      return null;
    });
    // Sources with no ledger (images, other binaries) never had a Fold/
    // Event tab to land on -- Raw is the only tab they have.
    setSourceViewMode(source.readLedger ? "fold" : "raw");
    setExpandedLedgerLoading(true);
    try {
      const ledger = await readSourceLedger(source.id);
      setExpandedLedger(ledger);
    } finally {
      setExpandedLedgerLoading(false);
    }
  }

  // Decodes a source's actual bytes for the "Raw" tab -- text is decoded
  // straight through (the same decode retrieveCorpus already does), images
  // become an object URL. Cached in rawSource so switching tabs back and
  // forth doesn't re-read OPFS every time.
  async function loadRawSource(source: EoSource) {
    setSourceViewMode("raw");
    if (rawSource?.sourceId === source.id) return;
    setRawSourceLoading(true);
    try {
      const bytes = await readRawSource(source.id);
      if (source.mimeType.startsWith("image/")) {
        const url = URL.createObjectURL(
          // readRawSource's Uint8Array is backed by a real ArrayBuffer
          // (arrayBuffer() below), but TS's DOM lib types Uint8Array's
          // buffer as ArrayBufferLike (which also admits SharedArrayBuffer),
          // so it doesn't structurally satisfy Blob's BlobPart.
          new Blob([bytes as unknown as BlobPart], { type: source.mimeType }),
        );
        setRawSource({ sourceId: source.id, kind: "image", url });
      } else {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        setRawSource({ sourceId: source.id, kind: "text", text });
      }
    } catch {
      setRawSource({
        sourceId: source.id,
        kind: "text",
        text: "(couldn't read this source's raw bytes)",
      });
    } finally {
      setRawSourceLoading(false);
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
          </div>
        </div>
        <div className="window-actions">
          {!isMobileScreen && (
            <div className="window-action-button">
              <IconButton
                icon={<RenameIcon />}
                onClick={() => setShowEditPromptModal(true)}
              />
            </div>
          )}
          <div className="window-action-button">
            <IconButton
              icon={<ShareIcon />}
              title={Locale.Chat.Actions.Share}
              onClick={() => {
                const params = new URLSearchParams({
                  model: config.modelConfig.model,
                  temperature: config.modelConfig.temperature.toString(),
                  top_p: config.modelConfig.top_p.toString(),
                  max_tokens: config.modelConfig.max_tokens.toString(),
                  presence_penalty:
                    config.modelConfig.presence_penalty.toString(),
                  frequency_penalty:
                    config.modelConfig.frequency_penalty.toString(),
                  // template: chatStore.currentSession().template;
                });
                const shareUrl = new URL(
                  `${window.location.origin}${window.location.pathname}?${params}`,
                );
                copyToClipboard(shareUrl.href);
              }}
            />
          </div>
          <div className="window-action-button">
            <IconButton
              icon={<ExportIcon />}
              title={Locale.Chat.Actions.Export}
              onClick={() => {
                setShowExport(true);
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
          <div className="window-action-button">
            <IconButton
              icon={<TerminalWindow size={17} />}
              title="EOT — system log"
              onClick={() => setShowEoLog((v) => !v)}
            />
          </div>
          {showMaxIcon && (
            <div className="window-action-button">
              <IconButton
                icon={config.tightBorder ? <MinIcon /> : <MaxIcon />}
                onClick={() => {
                  config.update(
                    (config) => (config.tightBorder = !config.tightBorder),
                  );
                }}
              />
            </div>
          )}
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
          const orderedEoLog = [...(session.eoLog ?? [])].reverse();
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
              ? foldGraphOnEntity(session.id, graphQuery)
              : null;
          const tiersSnap: TierTerrainSnapshot | null =
            eotTerminalTab === "graph"
              ? hypergraphTiersSnapshot(session.id)
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
          <div className={styles["source-list"]}>
            {!session.eoSources?.length ? (
              <div className={styles["source-empty"]}>
                No sources yet. Add a file to make it available to this chat.
              </div>
            ) : (
              session.eoSources.map((source) => (
                <div key={source.id} className={styles["source-item"]}>
                  <label className={styles["source-row"]}>
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      onChange={() =>
                        chatStore.updateCurrentSession((current) => {
                          current.eoSources = (current.eoSources ?? []).map(
                            (s) =>
                              s.id === source.id
                                ? { ...s, enabled: !s.enabled }
                                : s,
                          );
                        })
                      }
                    />
                    <span className={styles["source-row-body"]}>
                      <strong title={source.name}>{source.name}</strong>
                      <small>
                        {(source.byteLength / 1024).toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}{" "}
                        KB ·{" "}
                        {source.textReadable
                          ? "text searchable"
                          : "binary retained"}
                        {source.structure
                          ? ` · ${source.structure.clearings} ${source.structure.clearings === 1 ? "boundary" : "boundaries"}`
                          : ""}
                        {source.readLedger?.revisionCount
                          ? ` · ${source.readLedger.revisionCount} revision${source.readLedger.revisionCount === 1 ? "" : "s"}`
                          : ""}
                      </small>
                    </span>
                    {(source.readLedger ||
                      source.textReadable ||
                      source.mimeType.startsWith("image/")) && (
                      <button
                        type="button"
                        className={styles["source-view"]}
                        title="View this source's actual content, its ledger, or the folded reading"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleSourceView(source);
                        }}
                      >
                        {expandedSourceId === source.id ? "Hide" : "View"}
                      </button>
                    )}
                    {source.textReadable && (
                      <button
                        type="button"
                        className={styles["source-reread"]}
                        title="Re-read this source against its ledger"
                        disabled={rereadingSourceId === source.id}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          rereadSource(source);
                        }}
                      >
                        {rereadingSourceId === source.id
                          ? "Re-reading…"
                          : "Re-read"}
                      </button>
                    )}
                  </label>

                  {expandedSourceId === source.id && (
                    <div className={styles["source-reading"]}>
                      <div className={styles["source-reading-tabs"]}>
                        {source.readLedger && (
                          <>
                            <button
                              type="button"
                              className={
                                styles["source-reading-tab"] +
                                (sourceViewMode === "fold"
                                  ? " " + styles["active"]
                                  : "")
                              }
                              onClick={() => setSourceViewMode("fold")}
                            >
                              Fold — current reading
                            </button>
                            <button
                              type="button"
                              className={
                                styles["source-reading-tab"] +
                                (sourceViewMode === "event"
                                  ? " " + styles["active"]
                                  : "")
                              }
                              onClick={() => setSourceViewMode("event")}
                            >
                              Events — raw ledger
                            </button>
                          </>
                        )}
                        {(source.textReadable ||
                          source.mimeType.startsWith("image/")) && (
                          <button
                            type="button"
                            className={
                              styles["source-reading-tab"] +
                              (sourceViewMode === "raw"
                                ? " " + styles["active"]
                                : "")
                            }
                            onClick={() => loadRawSource(source)}
                          >
                            Raw — the actual file
                          </button>
                        )}
                        {source.readLedger && (
                          <span className={styles["source-reading-stats"]}>
                            cursor {source.readLedger.cursor} ·{" "}
                            {source.readLedger.narrowCount} narrow ·{" "}
                            {source.readLedger.confirmCount} confirmed ·{" "}
                            {source.readLedger.revisionCount} revised ·{" "}
                            {source.readLedger.refuseCount} refused
                          </span>
                        )}
                      </div>
                      {sourceViewMode === "raw" ? (
                        rawSourceLoading ? (
                          <div className={styles["source-reading-body"]}>
                            Reading the source&apos;s raw bytes…
                          </div>
                        ) : rawSource?.sourceId !== source.id ? (
                          <div className={styles["source-reading-body"]}>
                            &nbsp;
                          </div>
                        ) : rawSource.kind === "image" ? (
                          <div className={styles["source-reading-body"]}>
                            <img
                              src={rawSource.url}
                              alt={source.name}
                              className={styles["source-reading-image"]}
                            />
                          </div>
                        ) : (
                          <pre className={styles["source-reading-body"]}>
                            {rawSource.text}
                          </pre>
                        )
                      ) : expandedLedgerLoading ? (
                        <div className={styles["source-reading-body"]}>
                          Loading ledger…
                        </div>
                      ) : !expandedLedger ? (
                        <div className={styles["source-reading-body"]}>
                          No persisted ledger for this source yet.
                        </div>
                      ) : sourceViewMode === "fold" ? (
                        <pre className={styles["source-reading-body"]}>
                          {renderFoldedEOT(
                            expandedLedger,
                            `source_${source.id}`,
                          )}
                        </pre>
                      ) : (
                        <pre className={styles["source-reading-body"]}>
                          {(() => {
                            const idToTick = new Map(
                              expandedLedger.events.map((e: any) => [
                                e.event_id,
                                e.tick,
                              ]),
                            );
                            return expandedLedger.events
                              .map((e: any) =>
                                formatLedgerEventLine(e, idToTick),
                              )
                              .join("\n");
                          })()}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>
      )}

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

          const shouldShowClearContextDivider = i === clearContextIndex - 1;

          return (
            <Fragment key={`${i}/${message.id}`}>
              <div
                className={
                  isUser ? styles["chat-message-user"] : styles["chat-message"]
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
                              model={message.model || config.modelConfig.model}
                            />
                          )}
                        </>
                      )}
                    </div>
                    <div className={styles["chat-message-role-name-container"]}>
                      {message.role === "system" && (
                        <div
                          className={`${styles["chat-message-role-name"]} ${styles["no-hide"]}`}
                        >
                          {Locale.Chat.Roles.System}
                        </div>
                      )}
                      {message.role === "assistant" && (
                        <div className={styles["chat-message-role-name"]}>
                          {models.find((m) => m.name === message.model)
                            ? models.find((m) => m.name === message.model)!
                                .display_name
                            : message.model}
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
                                let newContent: string | MultimodalContent[] =
                                  newMessage;
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
                                chatStore.updateCurrentSession((session) => {
                                  const m = session.template.context
                                    .concat(session.messages)
                                    .find((m) => m.id === message.id);
                                  if (m) {
                                    m.content = newContent;
                                  }
                                });
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
                      const { thinking, rest, open } = !isUser
                        ? splitThinking(getMessageTextContent(message))
                        : {
                            thinking: null as string | null,
                            rest: getMessageTextContent(message),
                            open: false,
                          };
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
                          {!isUser && message.warrantTrace && (
                            <WarrantPanel trace={message.warrantTrace} />
                          )}
                          {!isUser && message.planTrace && (
                            <PlanPanel trace={message.planTrace} />
                          )}
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
                          />
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
                            "--image-count": getMessageImages(message).length,
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
                  <div className={styles["chat-message-action-date"]}>
                    <div>
                      {isContext
                        ? Locale.Chat.IsContext
                        : message.date.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
              {shouldShowClearContextDivider && <ClearContextDivider />}
            </Fragment>
          );
        })}
      </div>
      <div className={styles["chat-input-panel"]}>
        <ScrollDownToast onclick={scrollToBottom} show={!hitBottom} />
        <PromptHints prompts={promptHints} onPromptSelect={onPromptSelect} />

        <ChatActions
          uploadImage={uploadImage}
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

      {showExport && (
        <ExportMessageModal onClose={() => setShowExport(false)} />
      )}

      {showEditPromptModal && (
        <SessionConfigModel onClose={() => setShowEditPromptModal(false)} />
      )}
    </div>
  );
}

export function Chat() {
  const chatStore = useChatStore();
  const sessionIndex = chatStore.currentSessionIndex;
  return <ChatInner key={sessionIndex}></ChatInner>;
}
