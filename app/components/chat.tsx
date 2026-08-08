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
import PromptIcon from "../icons/prompt.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import ResetIcon from "../icons/reload.svg";
import BreakIcon from "../icons/break.svg";
import DeleteIcon from "../icons/clear.svg";
import EditIcon from "../icons/rename.svg";
import ConfirmIcon from "../icons/confirm.svg";
import ImageIcon from "../icons/image.svg";
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
  type PromptTrace,
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
import { Globe, Paperclip, TerminalWindow } from "@phosphor-icons/react";
import { findBinaryStructure } from "../client/eo-binary-structure";
import { isReadableUtf8, persistRawSource } from "../client/eo-corpus";
import { nanoid } from "nanoid";
import type { WebSearchResult } from "../client/eo-websearch";
import type { GroundingReport, Snippet } from "../client/eo-citation-check";

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
      {showUploadImage && (
        <ChatAction
          onClick={props.uploadImage}
          text={Locale.Chat.InputActions.UploadImage}
          icon={props.uploading ? <LoadingButtonIcon /> : <ImageIcon />}
        />
      )}
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
        onClick={props.showPromptSetting}
        text={Locale.Chat.Actions.EditConversation}
        icon={<EditIcon />}
      />
      <ChatAction
        onClick={props.showPromptHints}
        text={Locale.Chat.InputActions.QuickPrompt}
        icon={<PromptIcon />}
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

// The engine can decode faster than a human reads, and onUpdate delivers
// whatever it has whenever it has it — in bursts, not a steady drip. Paced
// reveal decouples "how much text exists" from "how much is shown": it only
// ever holds back text that's already arrived (never waits on generation,
// so a slow model is never made to look slower), advancing toward the full
// string at a fixed reading pace and snapping to complete the moment
// streaming ends rather than dragging out the tail after the model is done.
const READING_CHARS_PER_SEC = 45;

function usePacedReveal(fullText: string, streaming: boolean): string {
  const [shownLen, setShownLen] = useState(fullText.length);
  const shownLenRef = useRef(shownLen);
  shownLenRef.current = shownLen;

  useEffect(() => {
    if (!streaming) {
      setShownLen(fullText.length);
      return;
    }
    if (shownLenRef.current > fullText.length) {
      // A fresh turn started (content reset) — don't hold a stale, larger
      // reveal position against shorter new text.
      setShownLen(fullText.length);
    }
    let raf: number;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setShownLen((len) => {
        const target = fullText.length;
        if (len >= target) return len;
        const next = len + READING_CHARS_PER_SEC * dt;
        return next >= target ? target : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullText, streaming]);

  return fullText.slice(0, Math.floor(shownLen));
}

// Wraps Markdown with usePacedReveal — its own component instance (not
// called inline inside the messages.map below) so each message gets a
// stable hook slot regardless of how the list's length changes render to
// render; calling the hook directly inside the map would violate the Rules
// of Hooks the moment a new message is appended mid-stream.
function PacedAnswer(props: {
  text: string;
  streaming: boolean;
  loading: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClickCapture: () => void;
  fontSize: number;
  parentRef: RefObject<HTMLDivElement>;
  defaultShow: boolean;
}) {
  const paced = usePacedReveal(props.text, props.streaming);
  return (
    <Markdown
      content={paced}
      loading={props.loading}
      onContextMenu={props.onContextMenu}
      onDoubleClickCapture={props.onDoubleClickCapture}
      fontSize={props.fontSize}
      parentRef={props.parentRef}
      defaultShow={props.defaultShow}
    />
  );
}

// A collapsible reasoning panel, like Claude's extended-thinking display:
// collapsed by default once the answer has started, auto-expanded while the
// model is still inside the <think> block so a reader can watch it reason
// live instead of staring at a spinner.
function ThinkingPanel(props: { thinking: string; open: boolean }) {
  return (
    <details
      open={props.open}
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
          opacity: 0.6,
          userSelect: "none",
        }}
      >
        {props.open ? "Reasoning…" : "Reasoning"}
      </summary>
      <div
        style={{
          marginTop: 8,
          whiteSpace: "pre-wrap",
          opacity: 0.75,
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        {props.thinking.trim()}
      </div>
    </details>
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
          opacity: 0.6,
          userSelect: "none",
        }}
      >
        {`\u{1F4CB} Plan — ${t.kind} · ${t.delivery} · ${status}`}
      </summary>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          opacity: 0.85,
        }}
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
                Rewrite did not run (background call failed) — shipped as
                drafted, flagged here.
              </div>
            )}
          </div>
        ) : (
          <div style={{ opacity: 0.7 }}>
            No violations on the first pass — no rewrite needed.
          </div>
        )}
      </div>
    </details>
  );
}

// Everything that happened before a single word of the visible answer was
// written: fold/surf bookkeeping, the router's search-or-not verdict, the
// query rewrite, and the literal system+message payload sent to the model.
// Deliberately styled apart from the spoken answer (dashed border, mono
// font, no message-bubble background) — this is process, not the reply;
// conflating the two visually is exactly what made the "reasoning" work
// invisible before (buried in a session-wide EOT log instead of sitting
// next to the turn it explains).
// One flat scrollable feed instead of nested <details> — nesting each add
// their own summary line and padding, which is what made the old version
// tall. Auto-open (and auto-scrolled to the bottom) while the turn is still
// preparing, so a reader watching it live sees the same "thinking" motion
// Claude's reasoning block has instead of dead air; closes itself once the
// spoken answer starts, collapsing to a single low-contrast line that's
// trivial to skip over rather than a block competing with the answer.
function SurfPanel(props: { trace: PromptTrace; open: boolean }) {
  const t = props.trace;
  const [manuallyOpen, setManuallyOpen] = useState<boolean | null>(null);
  const open = manuallyOpen ?? props.open;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, t.systemPrompt.length]);

  const lines: string[] = [];
  if (t.router) {
    lines.push(
      `router: ${t.router.searched ? "web_search" : "no tools"} — ${t.router.reason}${t.router.fellBack ? " (fell back)" : ""}`,
    );
  } else {
    lines.push("router: not called this turn");
  }
  if (t.query) {
    lines.push(
      `query: "${t.query.text}"${t.query.rewritten ? " (rewritten)" : " (fallback)"}`,
    );
  }
  // System prompt itself is no longer shown here — it's fixed/near-empty
  // now that the instruction gate is gone (see getMessagesWithMemory's "no
  // mandatory system prompt" comment in store/chat.ts), so per-turn it adds
  // nothing a reader doesn't already know. What varies turn to turn — and
  // what's actually worth surfacing — is the folded/retrieved content below.
  lines.push(`context: ${t.sentMessages.length} prior message(s)`);
  for (const m of t.sentMessages) lines.push(`${m.role}: ${m.content}`);

  return (
    <div
      style={{
        margin: "0 0 8px",
        fontSize: "11px",
        fontFamily: "var(--font-mono, monospace)",
        opacity: 0.55,
      }}
    >
      <div
        role="button"
        onClick={() => setManuallyOpen(!open)}
        style={{
          cursor: "pointer",
          userSelect: "none",
          fontStyle: "italic",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span style={{ display: "inline-block", width: 10 }}>
          {open ? "▾" : "▸"}
        </span>
        {props.open ? "surfing & folding…" : "surf & fold"}
      </div>
      {open && (
        <div
          ref={scrollRef}
          style={{
            marginTop: 4,
            marginLeft: 14,
            maxHeight: 120,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            borderLeft: "2px solid var(--border-in-light)",
            paddingLeft: 8,
          }}
        >
          {lines.join("\n")}
        </div>
      )}
    </div>
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
              <span style={{ opacity: 0.6 }}>[{i + 1}]</span>{" "}
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

    localStorage.setItem(LAST_INPUT_KEY, userInput);
    chatStore.onUserInput(userInput, llm, attachImages).then((accepted) => {
      // A prior turn still mid-preparation makes this a no-op (see
      // onUserInput's isGenerating guard) — leave the typed text in place
      // rather than clearing it out from under the reader with nothing
      // sent to show for it.
      if (!accepted) return;
      setAttachImages([]);
      setUserInput("");
      setPromptHints([]);
      if (!isMobileScreen) inputRef.current?.focus();
      setAutoScroll(true);
    });
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
    return context.concat(session.messages as RenderMessage[]).concat(
      userInput.length > 0 && config.sendPreviewBubble
        ? [
            {
              ...createMessage({
                role: "user",
                content: userInput,
              }),
              preview: true,
            },
          ]
        : [],
    );
  }, [
    config.sendPreviewBubble,
    context,
    session.messages,
    session.messages.length,
    userInput,
  ]);

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

  // Arbitrary file upload — any type, not just images. Original bytes are
  // retained losslessly in OPFS; no prefix is sent as if it were the entire
  // source. The eoreader6 boundary pass is source metadata, while turn-time
  // surf later chooses passages from the complete enabled corpus.
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
    try {
      for (const file of files) {
        const buffer = new Uint8Array(await file.arrayBuffer());
        const structure = findBinaryStructure(buffer);
        const id = nanoid();
        await persistRawSource(id, buffer);
        const textReadable = isReadableUtf8(buffer);
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
        });
        chatStore.pushEoLog(
          "file",
          `file: ingested "${file.name}" — ${buffer.length} raw byte(s) in OPFS, ` +
            `${structure.clearings.length} clearing(s), ${textReadable ? "UTF-8 corpus" : "binary corpus"}`,
        );
      }
      showToast(
        files.length === 1
          ? `${files[0].name} added to this chat's source corpus`
          : `${files.length} files added to this chat's source corpus`,
      );
    } finally {
      setUploadingFile(false);
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
                bordered
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
                bordered
                onClick={() => setShowEditPromptModal(true)}
              />
            </div>
          )}
          <div className="window-action-button">
            <IconButton
              icon={<ShareIcon />}
              bordered
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
              bordered
              title={Locale.Chat.Actions.Export}
              onClick={() => {
                setShowExport(true);
              }}
            />
          </div>
          <div className="window-action-button">
            <IconButton
              icon={<Paperclip size={16} />}
              bordered
              title="Sources — this chat's local corpus"
              onClick={() => setShowSources((v) => !v)}
            />
          </div>
          <div className="window-action-button">
            <IconButton
              icon={<TerminalWindow size={17} />}
              bordered
              title="EOT — system log"
              onClick={() => setShowEoLog((v) => !v)}
            />
          </div>
          {showMaxIcon && (
            <div className="window-action-button">
              <IconButton
                icon={config.tightBorder ? <MinIcon /> : <MaxIcon />}
                bordered
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

      {showEoLog && (
        <div className={styles["eot-panel"]}>
          <div
            className={styles["eot-panel-close"]}
            onClick={() => setShowEoLog(false)}
            title="Close system log"
          >
            ✕ Close
          </div>
          {!session.eoLog?.length ? (
            <div className={styles["eot-panel-empty"]}>
              EOT — nothing has run yet this session. Send a message to see surf
              (instruction gate), fold (context-budget clamp), send (what
              reached the engine), and background tasks (topic naming, discourse
              fold) logged here as they happen.
            </div>
          ) : (
            session.eoLog.map((entry) => (
              <div key={entry.id}>
                [{new Date(entry.ts).toLocaleTimeString()}]{" "}
                <span
                  className={
                    styles["eot-entry-kind"] +
                    " " +
                    styles[`eot-entry-${entry.kind}`]
                  }
                >
                  {entry.kind.toUpperCase()}
                </span>
                {entry.text}
              </div>
            ))
          )}
        </div>
      )}

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
                <label key={source.id} className={styles["source-row"]}>
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
                    </small>
                  </span>
                </label>
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
              <span>{Locale.Chat.ModelLoading.Title}</span>
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
                          {!isUser && message.promptTrace && (
                            <SurfPanel
                              trace={message.promptTrace}
                              open={
                                !!message.streaming &&
                                message.content.length === 0
                              }
                            />
                          )}
                          {!isUser && message.planTrace && (
                            <PlanPanel trace={message.planTrace} />
                          )}
                          {!isUser && message.webResults !== undefined && (
                            <WebSearchPanel
                              results={message.webResults}
                              query={message.webQuery}
                              groundingReport={message.groundingReport}
                              snippets={message.webSnippets}
                            />
                          )}
                          <PacedAnswer
                            text={rest}
                            streaming={!isUser && !!message.streaming}
                            loading={
                              !!(message.preview || message.streaming) &&
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
