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
import { countTokens } from "../client/eo-gate";
import {
  webSearch,
  formatWebSearchBlock,
  stripCitationBrackets,
  distillQuery,
} from "../client/eo-websearch";
import { planTools, planSearchQuery } from "../client/eo-tool-router";
import {
  defineAnswerSpec,
  evaluateCompliance,
  reconcileDraft,
  type AnswerSpec,
} from "../client/eo-holonic-plan";
import {
  needsMathCheck,
  defineMathSpec,
  computeMath,
  buildMathBlock,
  checkMathCompliance,
  type MathResult,
} from "../client/eo-math-check";
import {
  checkGrounding,
  annotateVoids,
  attributeCitations,
  annotateCitations,
  snipCitations,
  type GroundingReport,
  type Snippet,
} from "../client/eo-citation-check";
import {
  applyTurn,
  buildMemoryMessage,
  checkRecallDenial,
  isAcknowledgment,
  type ConversationMemory,
} from "../client/eo-memory";
import {
  retrieveCorpus,
  formatCorpusContext,
  type CorpusPassage,
  type EoSource,
} from "../client/eo-corpus";
import {
  defineTaskPlan,
  probeReading,
  routeReading,
  runTaskPlan,
  type ThinkingSystem,
} from "../client/eo-task-plan";

export type ChatMessage = RequestMessage & {
  date: string;
  streaming?: boolean;
  isError?: boolean;
  id: string;
  stopReason?: ChatCompletionFinishReason;
  model?: Model;
  usage?: CompletionUsage;
  // The actual web_search results (if any) that grounded this reply — kept
  // structured, not baked into the text, so the UI can render a clickable
  // "what did it search" affordance instead of a markdown footer the reader
  // has to scroll past the answer to find.
  webResults?: Awaited<ReturnType<typeof webSearch>>;
  // The query actually sent to the search backend this turn (may differ from
  // the raw question — see distillQuery in eo-websearch.ts) — the "what is
  // being searched" disclosure the reader sees before the results themselves.
  webQuery?: string;
  // Mechanical grounding check (see eo-citation-check.ts): did every checkable
  // claim in the reply actually occur in this turn's search snippets. Never
  // shown to the model, computed after generation, same seam as eochat's
  // checkGrounding.
  groundingReport?: GroundingReport;
  // Per-result "snip" (see eo-citation-check.ts): the one clause of each
  // search result that actually overlaps the reply's own words, so the
  // panel can show the exact sentence that grounded the answer instead of
  // the whole fetched snippet.
  webSnippets?: Snippet[];
  // The holonic DEFINE → EVALUATE → RECONCILE trace (see eo-holonic-plan.ts),
  // structured so the UI can show it inline — a "how this answer was
  // judged" panel next to Reasoning/Web search, not buried in the EOT log
  // a reader has to know to open (LAWS.md L2b: one step from the
  // artifact). System 2 runs every turn (see onFinish) — this is always
  // set on an assistant turn.
  planTrace?: PlanTrace;
  // Everything the model actually saw and every background decision that
  // shaped it, in one place — the reader-facing counterpart to the EOT log
  // (which is session-wide and easy to lose track of which turn a line
  // belongs to). Nothing here is a claim the model made about itself; it's
  // the literal system prompt/messages sent and the router/query verdicts
  // computed before the turn ran.
  promptTrace?: PromptTrace;
};

export interface PromptTrace {
  systemPrompt: string;
  sentMessages: { role: string; content: string }[];
  router?: { searched: boolean; reason: string; fellBack: boolean };
  query?: { text: string; rewritten: boolean };
}

export interface PlanTrace {
  kind: string;
  delivery: string;
  reason: string;
  minWords: number;
  mathExpression?: string;
  mathValue?: string;
  initialViolations: { type: string; severity: string; detail: string }[];
  reconciled: boolean;
  finalCompliant: boolean;
  finalViolations: { type: string; severity: string; detail: string }[];
}

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

// EOT — the eochat-style terminal log: every surf (instruction gate), fold
// (context-budget clamp), send (what actually reached the engine), and
// background task (topic naming, discourse fold) this session has run,
// named so nothing the system did is silent.
export type EoLogKind =
  "surf" | "fold" | "send" | "task" | "error" | "web" | "file";

export interface EoLogEntry {
  id: string;
  ts: number;
  kind: EoLogKind;
  text: string;
}

const EO_LOG_MAX = 400;

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

  // set only while the engine is downloading/compiling a model (once per
  // model switch); null once the model is ready
  modelLoadProgress: { progress: number; text: string } | null;

  // eoWebLLM bounded-context state (see app/client/eo-discourse.ts)
  eoSummary?: EoSummary | null;
  eoLastFoldIndex: number;
  eoLog?: EoLogEntry[];

  // web calling (see app/client/eo-websearch.ts): when on, the next question
  // is searched before it reaches the model, same shape as eochat's
  // per-conversation webSearch toggle.
  webSearchEnabled?: boolean;

  // set by an uploaded file (see app/client/eo-binary-structure.ts); consumed
  // and cleared by the next onUserInput call, same one-shot handoff pattern
  // as the instruction gate's per-turn system block.
  pendingFileContext?: string | null;

  // Metadata only. The original file bytes are retained separately in OPFS
  // (eo-corpus.ts), so persisted chat state never contains an accidental copy
  // of a book or archive.
  eoSources?: EoSource[];

  // The verbatim "desk" of stated facts (see app/client/eo-memory.ts) — a
  // small, bounded backstop that survives even when a fact falls out of
  // EO_HISTORY_TURNS and the PAST DISCOURSE fold has paraphrased it away.
  eoMemory?: ConversationMemory;

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
// The router call (eo-tool-router) has no way to cap the model's output
// length — LLMConfig carries no max_tokens knob the WebLLM engine call
// forwards — so on a slow local model a verbose reply can blow past the
// ordinary fold timeout even though the router prompt asks for one line of
// JSON. Give it more slack before treating it as failed; a slow verdict
// still fails open (see the try/catch around planTools in onUserInput).
const EO_ROUTER_TIMEOUT_MS = 45000;

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

// fold's hard guarantee: the assembled prompt must never exceed the model's
// context window. getMessagesWithMemory bounds normal history by turn count,
// but a single oversized turn (e.g. a small model echoing a long system
// prompt back into its own reply) can still blow the budget on the next
// turn. This is the final backstop so a ContextWindowSizeExceededError can
// never reach the engine: drop the oldest droppable (non-system) messages
// first, and if the required system context alone is still too big, fold it
// down by truncating the largest one. Every engine call — the visible chat
// turn, the background topic-naming call, and the background fold/summary
// calls — routes through this before reaching llm.chat().
const EO_OUTPUT_TOKEN_RESERVE = 512;
const EO_FEEDBACK_GUARD =
  "Evaluate only supplied material. Do not invent facts. List risks, missing decisions, and three actions. Be concise: under 120 words.";

function isFeedbackRequest(text: string): boolean {
  return /\b(feedback|review|critique|assess|evaluate)\b/i.test(text);
}

function eoMessageTokens(m: RequestMessage): number {
  return countTokens(getMessageTextContent(m)) + 4;
}

function eoEnforceContextBudget(
  messages: RequestMessage[],
  contextWindowSize: number,
  label: string,
): { messages: RequestMessage[]; logText: string } {
  if (messages.length === 0) {
    return { messages, logText: `fold: ${label} — nothing to send` };
  }
  const budget = Math.max(
    contextWindowSize - EO_OUTPUT_TOKEN_RESERVE,
    Math.min(contextWindowSize, 256),
  );

  // last message is the anchor — the actual question or instruction this
  // call exists to answer — never dropped, only truncated as a last resort
  const anchor = messages[messages.length - 1];
  const rest = messages.slice(0, -1);
  const required: RequestMessage[] = [];
  const droppable: RequestMessage[] = [];
  for (const m of rest) {
    (m.role === "system" ? required : droppable).push(m);
  }

  const sum = (list: RequestMessage[]) =>
    list.reduce((total, m) => total + eoMessageTokens(m), 0);
  let total = sum(required) + sum(droppable) + eoMessageTokens(anchor);

  let droppedCount = 0;
  while (droppable.length && total > budget) {
    total -= eoMessageTokens(droppable.shift()!);
    droppedCount += 1;
  }
  while (required.length && total > budget) {
    total -= eoMessageTokens(required.shift()!);
    droppedCount += 1;
  }

  const kept = [...required, ...droppable, anchor];
  let truncated = false;
  if (total > budget) {
    truncated = true;
    const overflow = total - budget;
    const text = getMessageTextContent(anchor);
    const keepChars = Math.max(0, text.length - Math.ceil(overflow * 3.5));
    kept[kept.length - 1] = {
      ...anchor,
      content: `${text.slice(0, keepChars)}\n\n[...folded to fit the model's context window]`,
    };
  }

  const finalTokens = kept.reduce((t, m) => t + eoMessageTokens(m), 0);
  const logText =
    `fold: ${label} — kept ${kept.length}/${messages.length} msg(s), ` +
    `dropped ${droppedCount}, truncated=${truncated}, ` +
    `${finalTokens}/${budget} tokens (window ${contextWindowSize})`;

  return { messages: kept, logText };
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
    modelLoadProgress: null,
    eoSummary: null,
    eoLastFoldIndex: 0,
    webSearchEnabled: false,
    pendingFileContext: null,
    eoSources: [],

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
            modelLoadProgress: null,
          })),
        }));
      },

      pushEoLog(kind: EoLogKind, text: string) {
        get().updateCurrentSession((session) => {
          const entry: EoLogEntry = {
            id: nanoid(),
            ts: Date.now(),
            kind,
            text,
          };
          session.eoLog = [...(session.eoLog ?? []), entry].slice(-EO_LOG_MAX);
        });
      },

      onNewMessage(message: ChatMessage, llm: LLMApi) {
        get().updateCurrentSession((session) => {
          session.messages = session.messages.concat();
          session.lastUpdate = Date.now();
        });
        get().updateStat(message);
        get().summarizeSession(llm);
      },

      toggleWebSearch() {
        get().updateCurrentSession((session) => {
          session.webSearchEnabled = !session.webSearchEnabled;
        });
      },

      // one-shot handoff from an uploaded file (see eo-binary-structure.ts)
      // into the next turn's context; call sites append across multiple
      // files uploaded before a send, then onUserInput consumes and clears it.
      attachFileContext(block: string) {
        get().updateCurrentSession((session) => {
          session.pendingFileContext = session.pendingFileContext
            ? `${session.pendingFileContext}\n\n${block}`
            : block;
        });
      },

      registerEoSource(source: EoSource) {
        get().updateCurrentSession((session) => {
          const existing = session.eoSources ?? [];
          session.eoSources = [
            ...existing.filter((s) => s.id !== source.id),
            source,
          ];
        });
      },

      // Returns whether the turn was actually accepted — false means the
      // caller's composer text was never sent (still mid-preparation on a
      // prior turn) and the caller must NOT clear its input, or the reader's
      // just-typed message silently vanishes with nothing sent and no bubble
      // to show for it (the composer was cleared on the promise that a
      // fire-and-forget call would definitely take it).
      async onUserInput(
        content: string,
        llm: LLMApi,
        attachImages?: ChatImage[],
      ): Promise<boolean> {
        const modelConfig = useAppConfig.getState().modelConfig;

        const userContent = fillTemplateWith(content, useAppConfig.getState());
        log.debug("[User Input] after template: ", userContent);

        // Reserve this conversation before any asynchronous surf, web route,
        // or System-1 probe. Previously `isGenerating` was set only just
        // before llm.chat(), leaving a window where rapid Enter/click sends
        // could start duplicate, competing turns against one local engine.
        if (get().currentSession().isGenerating) {
          get().pushEoLog(
            "task",
            "turn: ignored while a prior turn is preparing",
          );
          return false;
        }
        get().updateCurrentSession((session) => {
          session.isGenerating = true;
          session.modelLoadProgress = null;
        });

        // web calling (surf-time, before the turn is assembled): the Web
        // Search toggle only enables the CAPABILITY for this session — a
        // small background model call (eo-tool-router) then decides, per
        // turn, whether THIS question actually needs it. That call is the
        // "mechanics" doing the steering: no keyword/regex scan of the
        // question, just the model's own read of it, same seam eochat's
        // defineAnswerSpec planner uses for its `lookup` field.
        const session0 = get().currentSession();
        // The desk's turn counter (see eo-memory.ts) — this turn's index
        // among user turns, computed before this turn's own message is
        // appended, same basis getMessagesWithMemory uses for userTurnCount.
        const turnIndex = session0.messages.filter(
          (m) => m.role === "user" && !m.isError,
        ).length;
        const extraSystemBlocks: string[] = [];
        // Starts fast by default. A bounded first reading may promote this
        // turn; later completion work uses the same recorded route.
        let readingSystem: ThinkingSystem = "system1";
        // Populated only if web_search actually ran this turn; onFinish below
        // uses it to mechanically strip any self-authored [n] brackets and
        // attach the real source list — the talker itself is never told
        // citations exist (see formatWebSearchBlock in eo-websearch.ts).
        let turnWebResults: Awaited<ReturnType<typeof webSearch>> = [];
        let turnWebQuery = "";
        // Router/query verdicts, captured for promptTrace below regardless
        // of whether a search actually ran — "the router looked and said no"
        // is itself part of the reader-facing trace, not just a search hit.
        let turnRouterTrace: PromptTrace["router"];
        let turnQueryTrace: PromptTrace["query"];
        // Last real exchange before this turn, verbatim — grounds the
        // router/query-writer below when userContent itself is a topic-less
        // follow-up ("do a web search to check that"). Without it the
        // background model sees only that fragment and hallucinates an
        // unrelated topic instead of continuing the actual conversation.
        const routerContext = session0.messages
          .filter((m) => !m.isError && getMessageTextContent(m).trim())
          .slice(-2)
          .map(
            (m) =>
              `${m.role}: ${getMessageTextContent(m).trim().slice(0, 500)}`,
          )
          .join("\n");
        if (session0.webSearchEnabled && userContent.trim()) {
          // Router failure (parse failure OR the background call itself
          // timing out/erroring on a slow local model) must fail OPEN, same
          // as eochat's own `lookup` field: a verdict that never arrived is
          // not evidence the question didn't need a search — it's just a
          // model that was too slow to answer the routing question. Only a
          // decision that POSITIVELY said "no tools" suppresses the search.
          let decision: Awaited<ReturnType<typeof planTools>>;
          try {
            decision = await planTools({
              question: userContent.trim(),
              context: routerContext || undefined,
              tools: [
                {
                  name: "web_search",
                  description:
                    "Looks up a specific, checkable, possibly time-sensitive fact " +
                    "on the web (Wikipedia + DuckDuckGo). Not for greetings, " +
                    "opinions, or follow-ups about what was already said.",
                },
              ],
              generate: (systemPrompt, userPrompt) =>
                eoRunBackground(
                  llm,
                  [
                    createMessage({ role: "system", content: systemPrompt }),
                    createMessage({ role: "user", content: userPrompt }),
                  ],
                  {
                    model: modelConfig.model,
                    cache: useAppConfig.getState().cacheType,
                    stream: false,
                  },
                  EO_ROUTER_TIMEOUT_MS,
                ),
            });
          } catch (err) {
            decision = {
              tools: ["web_search"],
              reason: `router call failed — ${(err as Error).message}`,
              fellBack: true,
            };
          }
          get().pushEoLog(
            "web",
            `route: ${decision.tools.length ? decision.tools.join(", ") : "no tools"} — ${decision.reason}${decision.fellBack ? " (fell back)" : ""}`,
          );
          turnRouterTrace = {
            searched: decision.tools.includes("web_search"),
            reason: decision.reason,
            fellBack: decision.fellBack,
          };
          if (decision.tools.includes("web_search")) {
            try {
              const rawQuestion = userContent.trim();
              const { query: rewrittenQuery, rewritten } =
                await planSearchQuery({
                  question: rawQuestion,
                  context: routerContext || undefined,
                  fallback: distillQuery(rawQuestion) || rawQuestion,
                  generate: (systemPrompt, userPrompt) =>
                    eoRunBackground(
                      llm,
                      [
                        createMessage({
                          role: "system",
                          content: systemPrompt,
                        }),
                        createMessage({ role: "user", content: userPrompt }),
                      ],
                      {
                        model: modelConfig.model,
                        cache: useAppConfig.getState().cacheType,
                        stream: false,
                      },
                      EO_ROUTER_TIMEOUT_MS,
                    ),
                });
              turnWebQuery = rewrittenQuery;
              turnQueryTrace = { text: turnWebQuery, rewritten };
              get().pushEoLog(
                "web",
                rewritten
                  ? `query: "${rawQuestion.slice(0, 60)}" -> "${turnWebQuery}"`
                  : `query: "${turnWebQuery}" (rewrite unavailable, used fallback)`,
              );
              const results = await webSearch(turnWebQuery);
              turnWebResults = results;
              const block = formatWebSearchBlock(turnWebQuery, results);
              extraSystemBlocks.push(block);
              get().pushEoLog(
                "web",
                `web: ${results.length} result(s) for "${userContent.trim().slice(0, 80)}"`,
              );
            } catch (err) {
              get().pushEoLog(
                "error",
                `web: search failed — ${(err as Error).message}`,
              );
            }
          }
        }

        // file structure (see eo-binary-structure.ts): consume whatever an
        // upload queued for this turn, then clear it so it isn't resent.
        const pendingFile = get().currentSession().pendingFileContext;
        if (pendingFile) {
          extraSystemBlocks.push(pendingFile);
          get().updateCurrentSession((session) => {
            session.pendingFileContext = null;
          });
          get().pushEoLog("file", `file: attached context for this turn`);
        }

        // conversation memory (the "desk", see eo-memory.ts): a verbatim
        // backstop for stated facts, injected every turn regardless of
        // whether EO_HISTORY_TURNS or the PAST DISCOURSE fold still holds
        // the turn that stated them.
        const memoryBlock = buildMemoryMessage(session0.eoMemory);
        if (memoryBlock) {
          extraSystemBlocks.push(memoryBlock);
        }

        // Source corpus surf: the complete original bytes remain in OPFS.
        // This turn only receives the best matching, byte-addressed passages.
        // No prefix is ever promoted to "the file", and a later question can
        // surface a different part of the same raw source.
        const sources = session0.eoSources ?? [];
        let corpusPassages: CorpusPassage[] = [];
        let corpusBlock: string | null = null;
        if (
          sources.some((s) => s.enabled && s.textReadable) &&
          userContent.trim()
        ) {
          try {
            const passages = await retrieveCorpus(userContent.trim(), sources);
            corpusPassages = passages;
            corpusBlock = formatCorpusContext(
              userContent.trim(),
              sources,
              passages,
            );
            get().pushEoLog(
              "file",
              `surf: ${passages.length} passage(s) from ${sources.filter((s) => s.enabled && s.textReadable).length} enabled source(s)`,
            );
          } catch (err) {
            get().pushEoLog(
              "error",
              `source corpus: ${(err as Error).message}`,
            );
          }
        }

        // Every reader turn begins with a cheap System-1 probe. The resulting
        // route is a declared policy over encountered coverage, alternatives,
        // contradictions, and gaps—not a classifier over the request wording.
        if (userContent.trim()) {
          try {
            const background = (systemPrompt: string, userPrompt: string) =>
              eoRunBackground(
                llm,
                [
                  createMessage({ role: "system", content: systemPrompt }),
                  createMessage({ role: "user", content: userPrompt }),
                ],
                {
                  model: modelConfig.model,
                  cache: useAppConfig.getState().cacheType,
                  stream: false,
                },
                EO_ROUTER_TIMEOUT_MS,
              );
            const probe = await probeReading({
              question: userContent.trim(),
              sources,
              passages: corpusPassages,
              generate: background,
            });
            readingSystem = routeReading(
              probe.trace,
              sources.some((source) => source.enabled && source.textReadable),
              corpusPassages.length > 0,
            );
            get().pushEoLog(
              "task",
              `System 1 probe: candidates=${probe.trace.candidateReadings}, coverage=${probe.trace.supportCoverage}, evidence=${probe.trace.evidenceRelation}, claim=${probe.trace.claimType}; route=${readingSystem}`,
            );

            // Slow work starts only after the first reading encountered a
            // live alternative, distributed/conflicting/missing evidence, or
            // a claim that exceeds retrieval.
            if (readingSystem === "system2") {
              const taskPlan = await defineTaskPlan(
                userContent.trim(),
                background,
              );
              if (taskPlan.tasks.length >= 2) {
                const taskRun = await runTaskPlan({
                  question: userContent.trim(),
                  plan: taskPlan,
                  sources,
                  generate: background,
                });
                if (taskRun.context) extraSystemBlocks.push(taskRun.context);
                else if (corpusBlock) extraSystemBlocks.push(corpusBlock);
                get().pushEoLog(
                  "task",
                  `System 2 task controller: ${taskRun.controller.tasks.length} task(s), ` +
                    `${taskRun.controller.tasks.filter((t) => t.status === "completed").length} completed, ` +
                    `${taskRun.controller.tasks.filter((t) => t.status === "dropped").length} dropped, ` +
                    `closure=${taskRun.controller.closed}`,
                );
              }
              // A legal graph is optional. If the planner finds no genuine
              // dependent work, retain the ordinary surfaced passages.
              else if (corpusBlock) extraSystemBlocks.push(corpusBlock);
            }
            // The final System-1 answer needs the full surf once; the compact
            // probe result stays in the trace/log instead of duplicating it.
            else if (corpusBlock) extraSystemBlocks.push(corpusBlock);
          } catch (err) {
            // A failed probe or slow path must fail open to the direct answer.
            if (corpusBlock) extraSystemBlocks.push(corpusBlock);
            get().pushEoLog(
              "error",
              `reading probe/task controller: ${(err as Error).message}`,
            );
          }
        }

        // holonic DEFINE — moved to a System-1/System-2 split (Kahneman's
        // terms, chosen deliberately over a mechanical pre-gate): System 1
        // is this turn's ordinary streamed answer, generated immediately,
        // never blocked on a planning call and never pre-shaped by one — no
        // regex heuristic decides in advance whether "this ask needs
        // planning," because that guess is itself the thing a fixed
        // pattern can't make well. System 2 is DEFINE → EVALUATE →
        // RECONCILE, which now runs AFTER the System-1 draft exists (see
        // onFinish below), unconditionally, every turn — slow and
        // deliberate, but never gating the fast path's first token. The
        // model judges its own draft against a spec it writes after seeing
        // it, and only pays the extra (visible, reconciled) cost when its
        // own judgment finds something to fix.
        let answerSpec: AnswerSpec | null = null;

        // math DEFINE (see eo-math-check.ts): the model never does the
        // arithmetic. Gated by needsMathCheck — a mechanical regex, no
        // model call — so plain chat never pays this round trip. When it
        // fires, a small background call extracts the literal expression
        // (resolving references to earlier turns, e.g. "4 of them" against
        // an earlier $125), mathjs computes the ground truth, and that
        // value is handed to the model as a fact to state, not a
        // computation to perform. Fails open: any extraction/compute
        // failure just means no math directive is added.
        let mathResult: MathResult | null = null;
        let mathExpression = "";
        if (userContent.trim() && needsMathCheck(userContent.trim())) {
          try {
            const mathSpec = await defineMathSpec({
              question: userContent.trim(),
              generate: (systemPrompt, userPrompt) =>
                eoRunBackground(
                  llm,
                  [
                    createMessage({ role: "system", content: systemPrompt }),
                    createMessage({ role: "user", content: userPrompt }),
                  ],
                  {
                    model: modelConfig.model,
                    cache: useAppConfig.getState().cacheType,
                    stream: false,
                  },
                  EO_ROUTER_TIMEOUT_MS,
                ),
            });
            if (mathSpec.hasMath) {
              const result = computeMath(
                mathSpec.expression,
                mathSpec.currency,
              );
              if (result.ok) {
                mathResult = result;
                mathExpression = mathSpec.expression;
                const mathBlock = buildMathBlock(mathSpec, result);
                if (mathBlock) extraSystemBlocks.push(mathBlock);
                get().pushEoLog(
                  "task",
                  `math: ${mathSpec.expression} = ${result.formatted}`,
                );
              } else {
                get().pushEoLog(
                  "error",
                  `math: could not evaluate "${mathSpec.expression}" — skipped`,
                );
              }
            }
          } catch (err) {
            get().pushEoLog(
              "error",
              `math: DEFINE call failed — ${(err as Error).message}`,
            );
          }
        }

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

        // get recent messages, then fold them down to fit the model's
        // context window so the engine can never reject the request.
        // The engine requires every system message to precede any other
        // role (SystemMessageOrderError) — recentMessages already leads
        // with its own system block, so web/file context must be spliced
        // in there too, not merely appended before the user turn.
        const recentMessages = get().getMessagesWithMemory(userContent);
        const systemPrefixLen = recentMessages.findIndex(
          (m) => m.role !== "system",
        );
        const splitAt =
          systemPrefixLen === -1 ? recentMessages.length : systemPrefixLen;
        const systemPrefix = recentMessages.slice(0, splitAt);
        const rest = recentMessages.slice(splitAt);
        const extraMessages = extraSystemBlocks.map((block) =>
          createMessage({ role: "system", content: block }),
        );
        const budgetResult = eoEnforceContextBudget(
          systemPrefix.concat(extraMessages, rest, [userMessage]),
          modelConfig.context_window_size ?? 4096,
          "chat turn",
        );
        // The engine (see @mlc-ai/web-llm ChatModule request validation)
        // allows a system message ONLY at index 0 — a second one anywhere
        // else throws SystemMessageOrderError, even if every system message
        // is contiguous at the front. eoEnforceContextBudget already sorts
        // all kept system messages to the front (its `required` bucket), so
        // merging them into one here is enough to satisfy that constraint.
        const budgeted = budgetResult.messages;
        const leadingSystemEnd = budgeted.findIndex((m) => m.role !== "system");
        const systemEnd =
          leadingSystemEnd === -1 ? budgeted.length : leadingSystemEnd;
        const sendMessages =
          systemEnd > 1
            ? [
                createMessage({
                  role: "system",
                  content: budgeted
                    .slice(0, systemEnd)
                    .map((m) => getMessageTextContent(m))
                    .join("\n\n---\n\n"),
                }),
                ...budgeted.slice(systemEnd),
              ]
            : budgeted;
        get().pushEoLog("fold", budgetResult.logText);
        get().pushEoLog(
          "send",
          `send: ${sendMessages.length} msg(s) to ${modelConfig.model} — ` +
            sendMessages
              .map((m) => `${m.role}(${eoMessageTokens(m)}t)`)
              .join(", "),
        );

        log.debug("Messages: ", sendMessages);

        // Reader-facing counterpart to the pushEoLog lines above — same
        // facts, attached to this turn's message instead of the session-wide
        // EOT log, so a reader watching one reply doesn't have to open a
        // separate panel and match timestamps back to it.
        botMessage.promptTrace = {
          systemPrompt: getMessageTextContent(sendMessages[0]),
          sentMessages: sendMessages
            .slice(1)
            .map((m) => ({ role: m.role, content: getMessageTextContent(m) })),
          router: turnRouterTrace,
          query: turnQueryTrace,
        };

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
          onProgress(progress, text) {
            get().updateCurrentSession((session) => {
              session.modelLoadProgress = { progress, text };
            });
          },
          onUpdate(message) {
            botMessage.streaming = true;
            if (message) {
              botMessage.content = message;
            }
            get().updateCurrentSession((session) => {
              session.modelLoadProgress = null;
              session.messages = session.messages.concat();
            });
          },
          async onFinish(message, stopReason, usage) {
            botMessage.streaming = false;
            botMessage.usage = usage;
            botMessage.stopReason = stopReason;
            if (message) {
              if (!this.config.enable_thinking) {
                message = message.replace(/<think>\s*<\/think>/g, "");
              }

              // System 2: DEFINE now, against the System-1 draft that
              // already exists — unconditional, every turn, no mechanical
              // pre-gate deciding in advance whether this turn "needed" it.
              // Runs after generation so it never delays the first token;
              // its only visible cost is a reconcile rewrite, and only when
              // its own judgment of the draft actually finds something
              // wrong with it.
              if (readingSystem === "system2" && userContent.trim()) {
                try {
                  answerSpec = await defineAnswerSpec({
                    question: userContent.trim(),
                    draft: message,
                    webEnabled: !!session0.webSearchEnabled,
                    generate: (systemPrompt, userPrompt) =>
                      eoRunBackground(
                        llm,
                        [
                          createMessage({
                            role: "system",
                            content: systemPrompt,
                          }),
                          createMessage({ role: "user", content: userPrompt }),
                        ],
                        {
                          model: modelConfig.model,
                          cache: useAppConfig.getState().cacheType,
                          stream: false,
                        },
                        EO_ROUTER_TIMEOUT_MS,
                      ),
                  });
                  get().pushEoLog(
                    "task",
                    `plan: kind="${answerSpec.kind}" delivery=${answerSpec.delivery} minWords=${answerSpec.compliance.minWords}${answerSpec.reason ? ` — ${answerSpec.reason}` : ""}`,
                  );
                } catch (err) {
                  get().pushEoLog(
                    "error",
                    `plan: DEFINE call failed — ${(err as Error).message}`,
                  );
                }
              }

              // holonic EVALUATE → RECONCILE (see eo-holonic-plan.ts and
              // eo-math-check.ts): a pure mechanical check against the
              // DEFINE-decided compliance contract (leak vocabulary,
              // word-count floor, form shape) and, when this turn had a
              // computed math ground truth, whether the draft states that
              // exact value — no model grading its own answer or its own
              // arithmetic. One bounded rewrite if either check fails;
              // ships as-is (flagged, never silently) if the rewrite still
              // doesn't clear it, so a stubborn violation is visible
              // rather than looping.
              if (answerSpec || mathResult) {
                const delivery = answerSpec?.delivery ?? "direct response";
                let eva = answerSpec
                  ? evaluateCompliance(message, answerSpec)
                  : { compliant: true, violations: [] };
                if (mathResult) {
                  const mathViolations = checkMathCompliance(
                    message,
                    mathResult,
                  );
                  if (mathViolations.length) {
                    eva = {
                      compliant: false,
                      violations: [...eva.violations, ...mathViolations],
                    };
                  }
                }
                const initialViolations = eva.violations;
                let reconciled = false;
                if (!eva.compliant) {
                  get().pushEoLog(
                    "task",
                    `eval: non-compliant — ${eva.violations.map((v) => v.type).join(", ")}`,
                  );
                  try {
                    const revised = await reconcileDraft({
                      question: userContent.trim(),
                      delivery,
                      draft: message,
                      violations: eva.violations,
                      generate: (systemPrompt, userPrompt) =>
                        eoRunBackground(
                          llm,
                          [
                            createMessage({
                              role: "system",
                              content: systemPrompt,
                            }),
                            createMessage({
                              role: "user",
                              content: userPrompt,
                            }),
                          ],
                          {
                            model: modelConfig.model,
                            cache: useAppConfig.getState().cacheType,
                            stream: false,
                          },
                          EO_ROUTER_TIMEOUT_MS,
                        ),
                    });
                    if (revised && revised.trim()) {
                      message = revised.trim();
                      reconciled = true;
                      eva = answerSpec
                        ? evaluateCompliance(message, answerSpec)
                        : { compliant: true, violations: [] };
                      if (mathResult) {
                        const mathViolations = checkMathCompliance(
                          message,
                          mathResult,
                        );
                        if (mathViolations.length) {
                          eva = {
                            compliant: false,
                            violations: [...eva.violations, ...mathViolations],
                          };
                        }
                      }
                    }
                  } catch (err) {
                    get().pushEoLog(
                      "error",
                      `reconcile: failed — ${(err as Error).message}`,
                    );
                  }
                  get().pushEoLog(
                    "task",
                    eva.compliant
                      ? "reconcile: now compliant"
                      : `reconcile: still non-compliant — ${eva.violations.map((v) => v.type).join(", ")} (shipped flagged, not blocked)`,
                  );
                }

                // Visible trace (see PlanTrace above, PlanPanel in chat.tsx):
                // the same DEFINE/EVALUATE/RECONCILE outcome just logged to
                // the EOT panel, also attached to the message itself so the
                // reader sees it inline, one step from the artifact, the way
                // a reasoning block works — not only in a log they have to
                // know to open.
                botMessage.planTrace = {
                  kind: answerSpec?.kind ?? "arithmetic",
                  delivery: answerSpec?.delivery ?? "direct response",
                  reason: answerSpec?.reason ?? "",
                  minWords: answerSpec?.compliance.minWords ?? 0,
                  mathExpression: mathResult ? mathExpression : undefined,
                  mathValue: mathResult?.formatted ?? undefined,
                  initialViolations,
                  reconciled,
                  finalCompliant: eva.compliant,
                  finalViolations: eva.violations,
                };
              }

              // Mechanical citation surface: the talker was never told
              // citations exist, so strip any [n] it wrote anyway. The real
              // source list is attached as structured data (webResults),
              // not text — the UI renders it as a clickable panel (see
              // WebSearchPanel in chat.tsx) instead of a markdown footer the
              // reader has to scroll past the answer to find.
              //
              // LAWS.md L2e — absence is auditable: a search that ran and
              // found nothing must render differently from a turn that never
              // searched at all, or the reader can't tell "checked, nothing
              // there" from "never checked". Gated on turnWebQuery (set the
              // moment a search is attempted), not turnWebResults.length, so
              // a zero-result search still surfaces as a disclosed gap.
              if (turnWebQuery) {
                message = stripCitationBrackets(message);
                botMessage.webResults = turnWebResults;
                botMessage.webQuery = turnWebQuery;
                if (turnWebResults.length) {
                  const citations = turnWebResults.map((r, i) => ({
                    index: i + 1,
                    source_id: r.url,
                    text: r.snippet,
                  }));
                  const report = checkGrounding(message, citations, {
                    question: userContent.trim(),
                  });
                  // Citations are inserted first, which shifts every offset
                  // after them — checkGrounding is re-run on the
                  // now-cited text so annotateVoids' atom offsets (used for
                  // the reader-facing report below) are never applied
                  // against stale positions.
                  const attributions = attributeCitations(
                    message,
                    citations,
                    report,
                  );
                  message = annotateCitations(message, attributions);
                  const finalReport = attributions.length
                    ? checkGrounding(message, citations, {
                        question: userContent.trim(),
                      })
                    : report;
                  message = annotateVoids(message, finalReport);
                  botMessage.groundingReport = finalReport;
                  // Snipping (see eo-citation-check.ts, ported from
                  // eochat's citation-check.js bestClause): show the one
                  // clause of each result that actually overlaps the
                  // reply's vocabulary, not the whole fetched snippet.
                  botMessage.webSnippets = snipCitations(message, citations);
                  get().pushEoLog(
                    "web",
                    finalReport.clean
                      ? `grounding: clean (${finalReport.atomsChecked} claim(s) checked, ${attributions.length} cited)`
                      : `grounding: ${finalReport.findings.length} unsupported claim(s) of ${finalReport.atomsChecked} checked, ${attributions.length} cited${finalReport.truncated ? ` (${finalReport.truncated.dropped} more truncated)` : ""}`,
                  );
                }
              }

              // Conversation memory (the "desk", see eo-memory.ts): advance
              // it with this turn's exchange, then check the finished
              // answer for a false denial of something already recorded
              // here — the exact failure mode the desk exists to catch
              // (a fact fell out of EO_HISTORY_TURNS, the fold paraphrased
              // it away, and the model denies it was ever said).
              const acked = isAcknowledgment(message);
              const denial = checkRecallDenial({
                question: userContent.trim(),
                answer: message,
                facts: session0.eoMemory?.facts ?? [],
              });
              if (denial.verdict === "FLAGGED") {
                get().pushEoLog(
                  "error",
                  `memory: false denial of a recorded fact — ${denial.flags[0]?.detail ?? ""}`,
                );
              }
              get().updateCurrentSession((session) => {
                session.eoMemory = applyTurn(session.eoMemory, turnIndex, {
                  userText: userContent.trim(),
                  assistantText: message,
                  confirmed: acked,
                });
              });

              botMessage.content = message;
              get().onNewMessage(botMessage, llm);
            }
            get().updateCurrentSession((session) => {
              session.isGenerating = false;
              session.modelLoadProgress = null;
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
              session.modelLoadProgress = null;
            });

            console.error("[Chat] failed ", error);
          },
        });
        return true;
      },

      getMessagesWithMemory(nextQuestion?: string) {
        const session = get().currentSession();
        const clearContextIndex = session.clearContextIndex ?? 0;

        const out: ChatMessage[] = [];

        // 0. No mandatory system prompt. Context belongs to the reader: only
        // explicitly chosen template content, folded discourse, and surfaced
        // source material may use the model's limited context window. The one
        // exception is a 19-word guard for an explicit feedback request: the
        // zero-prompt ablation found that it is the smallest addition that
        // stops small local models from inventing review criteria or rambling.
        if (nextQuestion && isFeedbackRequest(nextQuestion)) {
          out.push(
            createMessage({ role: "system", content: EO_FEEDBACK_GUARD }),
          );
        }
        //
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
          const topicBudget = eoEnforceContextBudget(
            messages.concat(
              createMessage({
                role: "user",
                content: Locale.Store.Prompt.Topic,
              }),
            ),
            modelConfig.context_window_size ?? 4096,
            "topic naming",
          );
          const topicMessages = topicBudget.messages;
          get().pushEoLog("fold", topicBudget.logText);
          // one background engine call per turn: if the topic call takes the
          // slot now, the fold for this turn is deferred to a later onNewMessage
          if (!eoEngineBusy) {
            get().pushEoLog("task", "task: topic-naming started");
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
                const topic =
                  message.length > 0 ? trimTopic(message) : DEFAULT_TOPIC;
                get().updateCurrentSession(
                  (session) => (session.topic = topic),
                );
                get().pushEoLog(
                  "task",
                  `task: topic-naming finished — "${topic}"`,
                );
              })
              .catch((err) => {
                log.error("[Topic] ", err);
                get().pushEoLog("error", `task: topic-naming failed — ${err}`);
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

            get().pushEoLog("task", `task: fold started (turn ${userIdx})`);

            // phase 1: fold this turn to its discourse contribution
            let turnFold: string;
            try {
              const foldBudget = eoEnforceContextBudget(
                [{ role: "user", content: buildFoldPrompt(question, answer) }],
                modelConfig.context_window_size ?? 4096,
                "fold phase 1",
              );
              get().pushEoLog("fold", foldBudget.logText);
              const rawFold = await eoRunBackground(
                llm,
                foldBudget.messages,
                foldConfig,
                EO_FOLD_TIMEOUT_MS,
              );
              turnFold = parseFold(rawFold);
            } catch (err) {
              // interrupted or failed — leave unfolded so the next turn retries
              get().pushEoLog("error", `task: fold phase 1 failed — ${err}`);
              return;
            }
            if (!turnFold) return;
            get().pushEoLog("task", `task: fold phase 1 done — "${turnFold}"`);

            // phase 2: refresh the running summary; fall back to a pure
            // advance on any failure so no fold is ever lost
            let next: EoSummary;
            try {
              const updatePrompt = buildSummaryUpdatePrompt(prev, [
                ...(prev.folds ?? []),
                turnFold,
              ]);
              const summaryBudget = eoEnforceContextBudget(
                [{ role: "user", content: updatePrompt }],
                modelConfig.context_window_size ?? 4096,
                "fold phase 2",
              );
              get().pushEoLog("fold", summaryBudget.logText);
              const raw = await eoRunBackground(
                llm,
                summaryBudget.messages,
                foldConfig,
                EO_FOLD_TIMEOUT_MS,
              );
              next = updateSummaryWithFold(prev, turnFold, raw);
              get().pushEoLog(
                "task",
                "task: fold phase 2 done — summary updated",
              );
            } catch (err) {
              next = advanceSummaryFold(prev, turnFold);
              get().pushEoLog(
                "error",
                `task: fold phase 2 failed, advanced without summary update — ${err}`,
              );
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
    version: 0.3,
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
      if (version < 0.3) {
        const store = persistedState as typeof DEFAULT_CHAT_STATE;
        store.sessions.forEach((s) => {
          s.modelLoadProgress = null;
        });
        return store;
      }
      return persistedState;
    },
  },
);
