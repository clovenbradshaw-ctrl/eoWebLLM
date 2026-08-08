import { trimTopic, getMessageTextContent } from "../utils";

import log from "loglevel";
import Locale, { getLang } from "../locales";
import { showToast } from "../components/ui-lib";
import { ModelConfig, Model, useAppConfig, ConfigType } from "./config";
import { createEmptyTemplate, Template } from "./template";
import { DEFAULT_INPUT_TEMPLATE, DEFAULT_MODELS, StoreKey } from "../constant";
import {
  RequestMessage,
  MultimodalContent,
  LLMApi,
  LLMConfig,
} from "../client/api";
import { estimateTokenLength } from "../utils/token";
import { nanoid } from "nanoid";
import { createPersistStore } from "../utils/store";
import { ChatCompletionFinishReason, CompletionUsage } from "@mlc-ai/web-llm";
import { ChatImage } from "../typing";
import {
  emptySummary,
  EoSummary,
  buildSummarySystemMessage,
  buildSummaryUpdatePrompt,
  buildFoldPrompt,
  parseFold,
  updateSummaryWithFold,
  advanceSummaryFold,
} from "../client/eo-discourse";
import { createInstructionGate } from "../client/eo-gate";
import { getInstructionFolds } from "../client/eo-instructions";

export type ChatMessage = RequestMessage & {
  date: string;
  streaming?: boolean;
  isError?: boolean;
  id: string;
  stopReason?: ChatCompletionFinishReason;
  model?: Model;
  usage?: CompletionUsage;
};

export function createMessage(override: Partial<ChatMessage>): ChatMessage {
  return {
    id: nanoid(),
    date: new Date().toLocaleString(),
    role: "user",
    content: "",
    stopReason: "stop",
    ...override,
  };
}

export interface ChatStat {
  tokenCount: number;
  wordCount: number;
  charCount: number;
}

export interface ChatSession {
  id: string;
  topic: string;

  memoryPrompt: string;
  messages: ChatMessage[];
  stat: ChatStat;
  lastUpdate: number;
  lastSummarizeIndex: number;
  clearContextIndex?: number;
  isGenerating: boolean;

  // eoWebLLM bounded-context state (see app/client/eo-discourse.ts)
  eoSummary?: EoSummary | null;
  eoLastFoldIndex: number;

  template: Template;
}

export const DEFAULT_TOPIC = Locale.Store.DefaultTopic;
export const BOT_HELLO: ChatMessage = createMessage({
  role: "assistant",
  content: Locale.Store.BotHello,
});

// eoWebLLM bounded-context tuning: this many recent turns stay verbatim,
// everything older lives only as the PAST DISCOURSE summary + folds, so the
// context window never grows past a fixed ceiling.
const EO_HISTORY_TURNS = 8;
const EO_FOLD_TIMEOUT_MS = 30000;

// The WebLLM engine is single-flight: background calls (fold/summary, topic)
// must never overlap each other or the streaming answer. eoFoldInFlight guards
// the fold chain; eoEngineBusy tracks a background call that may still occupy
// the engine (including a timed-out ghost) and the next user turn aborts it.
let eoFoldInFlight = false;
let eoEngineBusy = false;

// Run one non-streaming background model call, tracking engine occupancy.
function eoRunBackground(
  llm: LLMApi,
  messages: RequestMessage[],
  config: LLMConfig,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("eo background model call timed out"));
    }, timeoutMs);
    eoEngineBusy = true;
    llm.chat({
      messages,
      config,
      onFinish(message) {
        eoEngineBusy = false;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(message);
      },
      onError(err) {
        eoEngineBusy = false;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    });
  });
}

// surf: build the RULES IN FORCE block for the current turn from the eochat
// instruction set, keyword-surfaced against the question + recent history.
function eoBuildInstructionBlock(
  question: string,
  session: ChatSession,
  clearContextIndex: number,
): string | null {
  try {
    const folds = getInstructionFolds();
    if (!folds.length) return null;
    const history = getRecentUserQuestions(session, clearContextIndex, 3);
    const report = createInstructionGate(folds).gate({ question, history });
    return report.systemMessage || null;
  } catch (err) {
    log.warn("[eo] instruction gate failed:", err);
    return null;
  }
}

function getRecentUserQuestions(
  session: ChatSession,
  clearContextIndex: number,
  n: number,
): string[] {
  const out: string[] = [];
  const msgs = session.messages;
  for (
    let i = msgs.length - 1;
    i >= Math.max(clearContextIndex, 0) && out.length < n;
    i -= 1
  ) {
    const m = msgs[i];
    if (!m || m.role !== "user" || m.isError) continue;
    const t = getMessageTextContent(m).trim();
    if (t) out.push(t);
  }
  return out;
}

function createEmptySession(): ChatSession {
  return {
    id: nanoid(),
    topic: DEFAULT_TOPIC,
    memoryPrompt: "",
    messages: [],
    stat: {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
    },
    lastUpdate: Date.now(),
    lastSummarizeIndex: 0,
    isGenerating: false,
    eoSummary: null,
    eoLastFoldIndex: 0,

    template: createEmptyTemplate(),
  };
}

function countMessages(msgs: ChatMessage[]) {
  return msgs.reduce(
    (pre, cur) => pre + estimateTokenLength(getMessageTextContent(cur)),
    0,
  );
}

function fillTemplateWith(input: string, modelConfig: ConfigType) {
  // Find the model in the DEFAULT_MODELS array that matches the modelConfig.model
  const modelInfo = DEFAULT_MODELS.find(
    (m) => m.name === modelConfig.modelConfig.model,
  );

  const vars = {
    provider: modelInfo?.provider || "unknown",
    model: modelConfig.modelConfig.model,
    time: new Date().toString(),
    lang: getLang(),
    input: input,
  };

  let output = modelConfig.template ?? DEFAULT_INPUT_TEMPLATE;

  // remove duplicate
  if (input.startsWith(output)) {
    output = "";
  }

  // must contains {{input}}
  const inputVar = "{{input}}";
  if (!output.includes(inputVar)) {
    output += "\n" + inputVar;
  }

  Object.entries(vars).forEach(([name, value]) => {
    const regex = new RegExp(`{{${name}}}`, "g");
    output = output.replace(regex, value.toString()); // Ensure value is a string
  });

  return output;
}

const DEFAULT_CHAT_STATE = {
  sessions: [createEmptySession()],
  currentSessionIndex: 0,
};

export const useChatStore = createPersistStore(
  DEFAULT_CHAT_STATE,
  (set, _get) => {
    function get() {
      return {
        ..._get(),
        ...methods,
      };
    }

    const methods = {
      clearSessions() {
        set(() => ({
          sessions: [createEmptySession()],
          currentSessionIndex: 0,
        }));
      },

      selectSession(index: number) {
        set({
          currentSessionIndex: index,
        });
      },

      moveSession(from: number, to: number) {
        set((state) => {
          const { sessions, currentSessionIndex: oldIndex } = state;

          // move the session
          const newSessions = [...sessions];
          const session = newSessions[from];
          newSessions.splice(from, 1);
          newSessions.splice(to, 0, session);

          // modify current session id
          let newIndex = oldIndex === from ? to : oldIndex;
          if (oldIndex > from && oldIndex <= to) {
            newIndex -= 1;
          } else if (oldIndex < from && oldIndex >= to) {
            newIndex += 1;
          }

          return {
            currentSessionIndex: newIndex,
            sessions: newSessions,
          };
        });
      },

      newSession(template?: Template) {
        const session = createEmptySession();

        if (template) {
          session.template = {
            ...template,
          };
          session.topic = template.name;
        }

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [session].concat(state.sessions),
        }));
      },

      nextSession(delta: number) {
        const n = get().sessions.length;
        const limit = (x: number) => (x + n) % n;
        const i = get().currentSessionIndex;
        get().selectSession(limit(i + delta));
      },

      deleteSession(index: number) {
        const deletingLastSession = get().sessions.length === 1;
        const deletedSession = get().sessions.at(index);

        if (!deletedSession) return;

        const sessions = get().sessions.slice();
        sessions.splice(index, 1);

        const currentIndex = get().currentSessionIndex;
        let nextIndex = Math.min(
          currentIndex - Number(index < currentIndex),
          sessions.length - 1,
        );

        if (deletingLastSession) {
          nextIndex = 0;
          sessions.push(createEmptySession());
        }

        // for undo delete action
        const restoreState = {
          currentSessionIndex: get().currentSessionIndex,
          sessions: get().sessions.slice(),
        };

        set(() => ({
          currentSessionIndex: nextIndex,
          sessions,
        }));

        showToast(
          Locale.Home.DeleteToast,
          {
            text: Locale.Home.Revert,
            onClick() {
              set(() => restoreState);
            },
          },
          5000,
        );
      },

      currentSession() {
        let index = get().currentSessionIndex;
        const sessions = get().sessions;

        if (index < 0 || index >= sessions.length) {
          index = Math.min(sessions.length - 1, Math.max(0, index));
          set(() => ({ currentSessionIndex: index }));
        }

        const session = sessions[index];

        return session;
      },

      resetGeneratingStatus() {
        set((state) => ({
          ...state,
          sessions: state.sessions.map((session) => ({
            ...session,
            isGenerating: false,
          })),
        }));
      },

      onNewMessage(message: ChatMessage, llm: LLMApi) {
        get().updateCurrentSession((session) => {
          session.messages = session.messages.concat();
          session.lastUpdate = Date.now();
        });
        get().updateStat(message);
        get().summarizeSession(llm);
      },

      onUserInput(content: string, llm: LLMApi, attachImages?: ChatImage[]) {
        const modelConfig = useAppConfig.getState().modelConfig;

        const userContent = fillTemplateWith(content, useAppConfig.getState());
        log.debug("[User Input] after template: ", userContent);

        let mContent: string | MultimodalContent[] = userContent;

        if (attachImages && attachImages.length > 0) {
          mContent = [
            {
              type: "text",
              text: userContent,
            },
          ];
          mContent = mContent.concat(
            attachImages.map((imageData) => {
              return {
                type: "image_url",
                image_url: {
                  url: imageData.url,
                },
                dimension: {
                  width: imageData.width,
                  height: imageData.height,
                },
              };
            }),
          );
        }
        let userMessage: ChatMessage = createMessage({
          role: "user",
          content: mContent,
        });

        const botMessage: ChatMessage = createMessage({
          role: "assistant",
          streaming: true,
          model: modelConfig.model,
        });

        // get recent messages
        const recentMessages = get().getMessagesWithMemory(userContent);
        const sendMessages = recentMessages.concat(userMessage);

        log.debug("Messages: ", sendMessages);

        // save user's and bot's message
        get().updateCurrentSession((session) => {
          const savedUserMessage = {
            ...userMessage,
            content: mContent,
          };
          session.messages = session.messages.concat([
            savedUserMessage,
            botMessage,
          ]);
          session.isGenerating = true;
        });

        // make request — the engine is single-flight, so first interrupt any
        // background fold/topic call that may still occupy it
        if (eoEngineBusy) {
          eoEngineBusy = false;
          eoFoldInFlight = false;
          llm.abort();
        }
        llm.chat({
          messages: sendMessages,
          config: {
            ...modelConfig,
            cache: useAppConfig.getState().cacheType,
            stream: true,
            enable_thinking: useAppConfig.getState().enableThinking,
          },
          onUpdate(message) {
            botMessage.streaming = true;
            if (message) {
              botMessage.content = message;
            }
            get().updateCurrentSession((session) => {
              session.messages = session.messages.concat();
            });
          },
          onFinish(message, stopReason, usage) {
            botMessage.streaming = false;
            botMessage.usage = usage;
            botMessage.stopReason = stopReason;
            if (message) {
              if (!this.config.enable_thinking) {
                message = message.replace(/<think>\s*<\/think>/g, "");
              }
              botMessage.content = message;
              get().onNewMessage(botMessage, llm);
            }
            get().updateCurrentSession((session) => {
              session.isGenerating = false;
            });
          },
          onError(error) {
            const errorMessage =
              error.message || error.toString?.() || undefined;
            const isAborted = errorMessage?.includes("aborted");
            botMessage.content += "\n\n" + errorMessage;
            botMessage.streaming = false;
            userMessage.isError = !isAborted;
            botMessage.isError = !isAborted;
            get().updateCurrentSession((session) => {
              session.messages = session.messages.concat();
              session.isGenerating = false;
            });

            console.error("[Chat] failed ", error);
          },
        });
      },

      getMessagesWithMemory(nextQuestion?: string) {
        const session = get().currentSession();
        const clearContextIndex = session.clearContextIndex ?? 0;

        const out: ChatMessage[] = [];

        // 0. instruction gate (surf): rules in force for THIS turn
        const gateBlock = eoBuildInstructionBlock(
          nextQuestion?.trim() ?? "",
          session,
          clearContextIndex,
        );
        if (gateBlock) {
          out.push(createMessage({ role: "system", content: gateBlock }));
        }

        // 1. pre-defined in-context prompts (reader-defined template context)
        for (const c of session.template.context) {
          const text = getMessageTextContent(c);
          if (c.role === "system" && text.trim()) {
            out.push(createMessage({ role: "system", content: text }));
          }
        }

        // 2. PAST DISCOURSE: the folded summary once turns fall out of the
        //    verbatim window (raw history is never resent past this point)
        const userTurnCount = session.messages.filter(
          (m) => m.role === "user" && !m.isError,
        ).length;
        if (
          clearContextIndex === 0 &&
          userTurnCount > EO_HISTORY_TURNS &&
          session.eoSummary
        ) {
          const summaryText = buildSummarySystemMessage(session.eoSummary);
          if (summaryText) {
            out.push(createMessage({ role: "system", content: summaryText }));
          }
        }

        // 3. verbatim recent turns (bounded recency window)
        const windowStart = Math.max(
          clearContextIndex,
          session.messages.length - EO_HISTORY_TURNS * 2,
        );
        for (let i = windowStart; i < session.messages.length; i += 1) {
          const m = session.messages[i];
          if (!m || m.isError || m.streaming) continue;
          if (m.role === "system") continue;
          out.push(m);
        }

        return out;
      },

      updateMessage(
        sessionIndex: number,
        messageIndex: number,
        updater: (message?: ChatMessage) => void,
      ) {
        const sessions = get().sessions;
        const session = sessions.at(sessionIndex);
        const messages = session?.messages;
        updater(messages?.at(messageIndex));
        set(() => ({ sessions }));
      },

      resetSession() {
        get().updateCurrentSession((session) => {
          session.messages = [];
          session.memoryPrompt = "";
          session.eoSummary = null;
          session.eoLastFoldIndex = 0;
        });
      },

      summarizeSession(llm: LLMApi) {
        const config = useAppConfig.getState();
        const session = get().currentSession();
        const modelConfig = useAppConfig.getState().modelConfig;

        // remove error messages if any
        const messages = session.messages;

        // should summarize topic after chating more than 50 words
        const SUMMARIZE_MIN_LEN = 50;
        if (
          config.enableAutoGenerateTitle &&
          session.topic === DEFAULT_TOPIC &&
          countMessages(messages) >= SUMMARIZE_MIN_LEN
        ) {
          const topicMessages = messages.concat(
            createMessage({
              role: "user",
              content: Locale.Store.Prompt.Topic,
            }),
          );
          // one background engine call per turn: if the topic call takes the
          // slot now, the fold for this turn is deferred to a later onNewMessage
          if (!eoEngineBusy) {
            eoRunBackground(
              llm,
              topicMessages,
              {
                model: modelConfig.model,
                cache: useAppConfig.getState().cacheType,
                stream: false,
                enable_thinking: false, // never think for topic
              },
              EO_FOLD_TIMEOUT_MS,
            )
              .then((message) => {
                get().updateCurrentSession(
                  (session) =>
                    (session.topic =
                      message.length > 0 ? trimTopic(message) : DEFAULT_TOPIC),
                );
              })
              .catch((err) => {
                log.error("[Topic] ", err);
              });
          }
        } else {
          get().foldNextTurn(llm);
        }
      },

      // fold: compress completed turns into the PAST DISCOURSE summary. Runs
      // as one background model call (fold, then summary refresh), guarded so
      // it never overlaps another engine call; the next user turn interrupts
      // it. A fold that never completes is retried after the next turn.
      foldNextTurn(llm: LLMApi) {
        if (eoFoldInFlight || eoEngineBusy) return;
        eoFoldInFlight = true;
        const run = async () => {
          try {
            const modelConfig = useAppConfig.getState().modelConfig;
            const foldConfig: LLMConfig = {
              model: modelConfig.model,
              cache: useAppConfig.getState().cacheType,
              stream: false,
              enable_thinking: false,
              temperature: modelConfig.temperature,
            };
            const session = get().currentSession();
            const clearContextIndex = session.clearContextIndex ?? 0;
            if (clearContextIndex > 0) return;

            const msgs = session.messages;
            const startIdx = session.eoLastFoldIndex ?? 0;
            let userIdx = -1;
            let assistantIdx = -1;
            for (let i = startIdx; i < msgs.length - 1; i += 1) {
              const m = msgs[i];
              const next = msgs[i + 1];
              if (
                m &&
                next &&
                m.role === "user" &&
                next.role === "assistant" &&
                !m.isError &&
                !next.isError &&
                !next.streaming &&
                next.content
              ) {
                userIdx = i;
                assistantIdx = i + 1;
                break;
              }
            }
            if (userIdx < 0) return;

            const question = getMessageTextContent(msgs[userIdx]);
            const answer = getMessageTextContent(msgs[assistantIdx]);
            const prev = session.eoSummary ?? emptySummary();

            // phase 1: fold this turn to its discourse contribution
            let turnFold: string;
            try {
              const rawFold = await eoRunBackground(
                llm,
                [{ role: "user", content: buildFoldPrompt(question, answer) }],
                foldConfig,
                EO_FOLD_TIMEOUT_MS,
              );
              turnFold = parseFold(rawFold);
            } catch {
              // interrupted or failed — leave unfolded so the next turn retries
              return;
            }
            if (!turnFold) return;

            // phase 2: refresh the running summary; fall back to a pure
            // advance on any failure so no fold is ever lost
            let next: EoSummary;
            try {
              const updatePrompt = buildSummaryUpdatePrompt(prev, [
                ...(prev.folds ?? []),
                turnFold,
              ]);
              const raw = await eoRunBackground(
                llm,
                [{ role: "user", content: updatePrompt }],
                foldConfig,
                EO_FOLD_TIMEOUT_MS,
              );
              next = updateSummaryWithFold(prev, turnFold, raw);
            } catch {
              next = advanceSummaryFold(prev, turnFold);
            }

            get().updateCurrentSession((session) => {
              session.eoSummary = next;
              session.eoLastFoldIndex = assistantIdx + 1;
            });
          } finally {
            eoFoldInFlight = false;
          }
        };
        run();
      },

      stopStreaming() {
        const sessions = get().sessions;
        sessions.forEach((session) => {
          if (session.messages.length === 0) {
            return;
          }
          const messages = [...session.messages];
          const lastMessage = messages[messages.length - 1];
          if (
            lastMessage.role === "assistant" &&
            lastMessage.streaming &&
            lastMessage.content.length === 0
          ) {
            // This message generation is interrupted by refresh and is stuck
            messages.splice(session.messages.length - 1, 1);
          }
          // Reset streaming status for all messages
          session.messages = messages.map((m) => ({
            ...m,
            streaming: false,
          }));
        });
        set(() => ({ sessions }));
      },

      updateStat(message: ChatMessage) {
        get().updateCurrentSession((session) => {
          session.stat.charCount += message.content.length;
          // TODO: should update chat count and word count
        });
      },

      updateCurrentSession(updater: (session: ChatSession) => void) {
        const sessions = get().sessions;
        const index = get().currentSessionIndex;
        updater(sessions[index]);
        set(() => ({ sessions }));
      },

      clearAllData() {
        localStorage.clear();
        location.reload();
      },
    };

    return methods;
  },
  {
    name: StoreKey.Chat,
    version: 0.2,
    migrate(persistedState, version): any {
      if (version < 0.1) {
        const store = persistedState as typeof DEFAULT_CHAT_STATE;
        store.sessions.forEach((s) => {
          s.messages.forEach((m) => {
            m.stopReason = "stop";
          });
        });
        return store;
      }
      if (version < 0.2) {
        const store = persistedState as typeof DEFAULT_CHAT_STATE;
        store.sessions.forEach((s) => {
          s.eoSummary = null;
          s.eoLastFoldIndex = 0;
        });
        return store;
      }
      return persistedState;
    },
  },
);
