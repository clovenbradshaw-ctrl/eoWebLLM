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
  buildRecordSystemMessage,
  buildFoldPrompt,
  buildWarrantRecord,
  addWarrantRecord,
  parseFold,
  advanceSummaryFold,
  truncate,
} from "../client/eo-discourse";
import { createInstructionGate, countTokens } from "../client/eo-gate";
import { getInstructionFolds } from "../client/eo-instructions";
import {
  webSearch,
  formatWebSearchBlock,
  stripCitationBrackets,
  distillQuery,
} from "../client/eo-websearch";
import {
  planTools,
  planSearchQuery,
  hasExplicitSearchIntent,
} from "../client/eo-tool-router";
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
  snipCitations,
  splitSentences,
  countClaimAtoms,
  type CitationEntry,
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
  retrieveCorpusDeliberate,
  formatCorpusContext,
  questionRequestsCorpus,
  formatDeliberateContext,
  corpusCitations,
  readRawSource,
  type CorpusPassage,
  type EoSource,
} from "../client/eo-corpus";
import {
  isHypergraphHydrated,
  ensureHypergraphHydrated,
  admitHypergraphTurn,
  navigateHypergraph,
  hasHypergraphSignal,
  describeHypergraphNavigation,
  draftHypergraphThought,
  buildHypergraphThoughtBlock,
  queryUserFacts,
} from "../client/eo-hypergraph";
import { buildSelfFactsBlock } from "../client/eo-self-facts";
import { type ThinkingSystem } from "../client/eo-task-plan";
import {
  buildFoldLedger,
  buildWarrantBlock,
  classifyResponseSet,
  escalate,
  foldPressure,
  lostPressure,
  groundingDemand,
  reviewDraft,
  routeTurn,
  warrantLogLine,
  type FoldLedger,
  type GroundingDemand,
  type TurnRoute,
} from "../client/eo-warrant";

export type ChatMessage = RequestMessage & {
  date: string;
  streaming?: boolean;
  isError?: boolean;
  id: string;
  stopReason?: ChatCompletionFinishReason;
  model?: Model;
  usage?: CompletionUsage;
  // Model responses have one of two destinations. `spoken` is the single
  // response rendered to the reader. Deliberate internal calls never become
  // ChatMessages; they travel through eoRunConsciousUnspoken below. Retrieval,
  // routing arithmetic, cube checks, and provenance construction are not model
  // responses at all — they are unconscious mechanics.
  responseState?: "spoken";
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
  // The same disclosure for the reader's own sources: the byte-addressed ref
  // each passage came from, and the one clause of it the answer actually drew
  // on. A claim about the reader's document should be as followable as a claim
  // about a web result (LAWS.md L2 — audit is local).
  sourceCitations?: { ref: string; clause: string | null }[];
  // The holonic DEFINE → EVALUATE → RECONCILE trace (see eo-holonic-plan.ts),
  // structured so the UI can show it inline — a "how this answer was
  // judged" panel next to Reasoning/Web search, not buried in the EOT log
  // a reader has to know to open (LAWS.md L2b: one step from the
  // artifact). System 2 runs every turn (see onFinish) — this is always
  // set on an assistant turn.
  planTrace?: PlanTrace;
  // Which system produced this message. A turn's first assistant message is
  // the System-1 draft; any further message in the same turn is System 2 by
  // construction (see classifyResponseSet in eo-warrant.ts).
  system?: ThinkingSystem;
  // Groups every message one turn produced, so a turn that answered in three
  // utterances still reads as one turn.
  turnId?: string;
  // Why this particular message exists — "grounding", "counter-reading",
  // "correction". Set on System 2 messages only: a reader should never have to
  // guess why a second message appeared.
  responseKind?: string;
  // The turn's warrant decision (see eo-warrant.ts): what could have carried a
  // claim this turn, what was folded away, and why the turn routed the way it
  // did. Attached to the message it governed, one step from the artifact.
  warrantTrace?: WarrantTrace;
};

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

export interface WarrantTrace {
  system: ThinkingSystem;
  /** True when the route was reached without asking the model anything. */
  mechanical: boolean;
  stage: string;
  reasons: string[];
  groundingRequired: boolean;
  checkedChannels: string[];
  unfoldChannels: string[];
  forbiddenChannels: string[];
  channels: { channel: string; note: string }[];
  foldPressure: number;
  lostPressure: number;
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
  | "surf"
  | "fold"
  | "send"
  | "task"
  | "error"
  | "web"
  | "file"
  // The warrant decision: what could carry a claim this turn, what was folded
  // away, and which system the turn routed to. Its own kind because it is the
  // line a reader checks when an answer looks ungrounded.
  | "warrant"
  // The full hypergraph navigation eoreader6 ran this turn — every span,
  // node, and edge it considered, not just the bounded slice (if any) that
  // made it into a thought block. The model sees the bounded slice; a
  // reader who opens this log sees the whole search.
  | "hypergraph";

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
// Two verbatim turns are enough for local coherence; everything older is
// folded. This prevents an eight-turn prompt ramp before the bound engages.
const EO_HISTORY_TURNS = 2;
const EO_FOLD_TIMEOUT_MS = 12_000;
// Build-time acceptance ablation. Normal builds keep the model fold; test
// builds can prove whether no fold or an unconscious mechanical fold is
// sufficient without mocking the engine or bypassing the production client.
const EO_FOLD_MODE =
  process.env.NEXT_PUBLIC_EO_FOLD_MODE === "none" ||
  process.env.NEXT_PUBLIC_EO_FOLD_MODE === "mechanical"
    ? process.env.NEXT_PUBLIC_EO_FOLD_MODE
    : "model";
// The router call (eo-tool-router) has no way to cap the model's output
// length — LLMConfig carries no max_tokens knob the WebLLM engine call
// forwards — so on a slow local model a verbose reply can blow past the
// ordinary fold timeout even though the router prompt asks for one line of
// JSON. Give it more slack before treating it as failed; a slow verdict
// still fails open (see the try/catch around planTools in onUserInput).
const EO_ROUTER_TIMEOUT_MS = 45000;

// The WebLLM engine is single-flight. Genuinely deliberate internal responses
// must never overlap the spoken answer. Topic naming is unconscious; the one
// bounded fold and genuinely deliberate checks are conscious-but-unspoken.
// eoEngineBusy tracks either short internal response (or a timed-out ghost).
let eoFoldInFlight = false;
let eoEngineBusy = false;

// Run one conscious-but-unspoken model response, tracking engine occupancy.
// Its caller must retain the parsed result in routing/checking state. This path
// never creates a ChatMessage; only the main streaming call is `spoken`.
function eoRunConsciousUnspoken(
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
      eoEngineBusy = false;
      // A timed-out unspoken response must not survive as an orphaned engine
      // generation and interfere with the next visible send.
      void llm.abort();
      reject(new Error("eo conscious-unspoken model call timed out"));
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
// Returns the log line alongside the block so the EOT panel can show exactly
// which folds surfaced and which stayed folded, per turn.
interface EoGateOutcome {
  systemMessage: string | null;
  logText: string | null;
  /** Counts the warrant ledger reads (see eo-warrant.ts). */
  stats: { active: number; folded: number; crowdedOut: number; gap: boolean };
}

const NO_GATE: EoGateOutcome["stats"] = {
  active: 0,
  folded: 0,
  crowdedOut: 0,
  gap: false,
};

function eoBuildInstructionBlock(
  question: string,
  session: ChatSession,
  clearContextIndex: number,
  opts: { mode?: ThinkingSystem; claims?: string[] } = {},
): EoGateOutcome {
  try {
    const folds = getInstructionFolds();
    if (!folds.length)
      return { systemMessage: null, logText: null, stats: NO_GATE };
    const history = getRecentUserQuestions(session, clearContextIndex, 3);
    const report = createInstructionGate(folds).gate({
      question,
      history,
      mode: opts.mode,
      claims: opts.claims,
    });
    const s = report.stats;
    const logText =
      `surf(${s.mode}): ${s.active} active fold(s) [${report.activeIds.join(", ")}], ` +
      `${s.folded} folded, gap=${s.gap}, ` +
      `${s.usedTokens}/${s.budget} tokens` +
      (s.unfoldedIds.length
        ? `, unfolded [${s.unfoldedIds.join(", ")}] against a ${s.ceiling} ceiling`
        : "") +
      (s.rejectedByBudget
        ? `, ${s.rejectedByBudget} matched but did not fit [${s.crowdedOutIds.join(", ")}]`
        : "");
    return {
      systemMessage: report.systemMessage || null,
      logText,
      stats: {
        active: s.active,
        folded: s.folded,
        crowdedOut: s.rejectedByBudget,
        gap: s.gap,
      },
    };
  } catch (err) {
    log.warn("[eo] instruction gate failed:", err);
    return {
      systemMessage: null,
      logText: `surf: instruction gate failed — ${(err as Error).message}`,
      stats: NO_GATE,
    };
  }
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
function eoMessageTokens(m: RequestMessage): number {
  return countTokens(getMessageTextContent(m)) + 4;
}

function eoEnforceContextBudget(
  messages: RequestMessage[],
  contextWindowSize: number,
  label: string,
): {
  messages: RequestMessage[];
  logText: string;
  // What the clamp had to lose. The warrant ledger reads these: material the
  // clamp dropped is material whose provenance this turn cannot account for.
  dropped: number;
  truncated: boolean;
} {
  if (messages.length === 0) {
    return {
      messages,
      logText: `fold: ${label} — nothing to send`,
      dropped: 0,
      truncated: false,
    };
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

  return { messages: kept, logText, dropped: droppedCount, truncated };
}

function eoWarrantTrace(
  ledger: FoldLedger,
  demand: GroundingDemand,
  route: TurnRoute,
): WarrantTrace {
  return {
    system: route.system,
    mechanical: route.mechanical,
    stage: route.stage,
    reasons: route.reasons.slice(0, 6),
    groundingRequired: demand.required,
    checkedChannels: demand.check,
    unfoldChannels: demand.mustUnfold,
    forbiddenChannels: demand.forbidden,
    channels: ledger.channels.map((c) => ({
      channel: c.channel,
      note: c.note,
    })),
    foldPressure: Math.round(foldPressure(ledger) * 100) / 100,
    lostPressure: Math.round(lostPressure(ledger) * 100) / 100,
  };
}

// At most this many extra utterances per turn. Ungating multiple responses is
// not the same as uncapping them: an unbounded set on a local engine is a
// reader watching messages accumulate with no idea when it stops. Whatever the
// cap drops is logged rather than silently discarded (LAWS.md L3).
const EO_MAX_SYSTEM2_RESPONSES = 1;

// The sentences of a draft that actually asserted something checkable. These
// are what the System 2 surf searches against — support has to be looked for
// where the answer committed itself, and the answer's vocabulary is not the
// question's.
function eoClaimSentences(draft: string, max = 8): string[] {
  return splitSentences(draft)
    .map((s) => s.text.trim())
    .filter((t) => t && countClaimAtoms(t) > 0)
    .slice(0, max);
}

/**
 * The System 2 pass: what a turn does after its fast answer already exists.
 *
 * Three things happen here, and they are three different operations rather
 * than one operation with more patience:
 *
 *   the surf runs again, differently — against the claims the draft made
 *   instead of the words the question used, looking for counterexamples as
 *   well as support, and reading each hit in wider context than the first pass
 *   took it in;
 *
 *   the rules are re-gated in checking mode — the same verbatim instruction
 *   bodies handed over as obligations to test the answer against, with folds
 *   the fast pass crowded out pulled back in;
 *
 *   and the turn may annotate its reply. The acceptance contract is one user
 *   message to one completed assistant message, so later findings are folded
 *   into the existing reply instead of creating an orphaned second bubble.
 *
 * Every extra response is EARNED by a mechanical condition — an actual failed
 * check, an actual retrieved counterexample. None of them is the model
 * deciding it has more to say.
 */
async function eoRunSystem2(input: {
  llm: LLMApi;
  get: () => any;
  modelConfig: ModelConfig;
  turnId: string;
  question: string;
  draft: string;
  sources: EoSource[];
  alreadySurfaced: CorpusPassage[];
  ledger: FoldLedger;
  demand: GroundingDemand;
  route: TurnRoute;
  grounding: GroundingReport | null;
  session: ChatSession;
  clearContextIndex: number;
}): Promise<{ emitted: ChatMessage[]; probeRoute: TurnRoute | null }> {
  const {
    llm,
    get,
    modelConfig,
    turnId,
    question,
    draft,
    sources,
    demand,
    grounding,
  } = input;

  const claims = eoClaimSentences(draft);
  const background = (systemPrompt: string, userPrompt: string) =>
    eoRunConsciousUnspoken(
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

  // 1. The deliberate re-surf.
  let deliberate: Awaited<ReturnType<typeof retrieveCorpusDeliberate>> = {
    passages: [],
    contrastive: [],
  };
  if (sources.some((s) => s.enabled && s.textReadable)) {
    try {
      deliberate = await retrieveCorpusDeliberate({
        question,
        claims,
        sources,
        alreadySurfaced: input.alreadySurfaced,
      });
      get().pushEoLog(
        "surf",
        `surf(system2): ${deliberate.passages.length} passage(s) against the draft's own claims, ` +
          `${deliberate.contrastive.length} searched as possible counterevidence`,
      );
    } catch (err) {
      get().pushEoLog(
        "error",
        `surf(system2): deliberate re-surf failed — ${(err as Error).message}`,
      );
    }
  }

  // 2. The rules, re-gated in checking mode.
  const checkGate = eoBuildInstructionBlock(
    question,
    input.session,
    input.clearContextIndex,
    { mode: "system2", claims },
  );
  if (checkGate.logText) get().pushEoLog("surf", checkGate.logText);

  // 3. The mechanical route already states why System 2 exists. A second model
  //    must not generate a hidden "probe" merely to restate that arithmetic.
  let probeRoute: TurnRoute | null = null;
  get().pushEoLog(
    "task",
    "state(unconscious): System 2 route retained its mechanical reasons; no hidden probe response",
  );

  const emitted: ChatMessage[] = [];
  const earned: { kind: string; run: () => Promise<string | null> }[] = [];

  // 3a. A grounding note is earned by a failed check, or by claims made over
  //     material this turn never actually read.
  const unsupported = grounding?.findings ?? [];
  const externalUnread = demand.mustUnfold.filter((c) =>
    ["corpus", "web", "file"].includes(c),
  );
  if (unsupported.length || (claims.length && externalUnread.length)) {
    earned.push({
      kind: "grounding",
      run: async () => {
        const checked =
          grounding?.channels.join(" and ") || "the material read this turn";
        if (unsupported.length)
          return (
            `Checked against ${checked}: ${unsupported.length} claim(s) were not supported — ` +
            unsupported
              .slice(0, 5)
              .map((f) => `"${f.text}"`)
              .join(", ") +
            `. Treat them as unverified.`
          );
        if (externalUnread.length)
          return `The answer depends on ${externalUnread.join(" and ")} material that was not surfaced this turn, so that part remains unverified.`;
        return null;
      },
    });
  }

  // 3b. A counter-reading is earned by the contrastive surf actually
  //     retrieving something, or by the probe reporting a second live reading
  //     — not by the model feeling uncertain.
  const contested = false;
  if (deliberate.contrastive.length || contested) {
    earned.push({
      kind: "counter-reading",
      run: async () => {
        const material = formatDeliberateContext(
          claims.join(" "),
          deliberate.passages,
          deliberate.contrastive,
        );
        if (!material && !contested) return null;
        const raw = await background(
          "An answer has already been given. You are checking it against material retrieved specifically because it might cut against it. Say plainly whether anything actually does. If something does, name it and say what it changes. If nothing does, say the check was made and the answer held — in one sentence. Never invent a tension the material does not contain.",
          [
            material ??
              "No competing passage was retrieved from the reader's sources.",
            `The answer given:\n${draft.slice(0, 1500)}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
        return String(raw || "").trim() || null;
      },
    });
  }

  if (earned.length > EO_MAX_SYSTEM2_RESPONSES) {
    get().pushEoLog(
      "warrant",
      `system 2: ${earned.length} responses earned, capped at ${EO_MAX_SYSTEM2_RESPONSES} — dropped ${earned
        .slice(EO_MAX_SYSTEM2_RESPONSES)
        .map((e) => e.kind)
        .join(", ")}`,
    );
  }

  for (const item of earned.slice(0, EO_MAX_SYSTEM2_RESPONSES)) {
    try {
      const text = await item.run();
      if (!text) continue;
      emitted.push(
        createMessage({
          role: "assistant",
          content: text,
          model: modelConfig.model,
          system: "system2",
          turnId,
          responseKind: item.kind,
        }),
      );
      get().pushEoLog("warrant", `system 2: attached a ${item.kind} note`);
    } catch (err) {
      get().pushEoLog(
        "error",
        `system 2: ${item.kind} response failed — ${(err as Error).message}`,
      );
    }
  }

  return { emitted, probeRoute };
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

      // A turn's second and later utterances.
      //
      // Until now a turn was one message, structurally: onFinish could rewrite
      // the draft in place but had no way to say a second thing. That is a real
      // limit on what System 2 can do — some findings are not edits. "The
      // figure you just read is not in the source you think it came from" is
      // not a revision of the answer, it is a different speech act about it,
      // and folding it into the prose either buries it or distorts the answer
      // to make room. So System 2 can now speak again instead.
      //
      // Every such message is System 2 by construction (classifyResponseSet in
      // eo-warrant.ts), carries the same turnId as the draft, and names why it
      // exists — a reader must never wonder where a second message came from.
      appendTurnResponse(input: {
        turnId: string;
        content: string;
        responseKind: string;
        model?: Model;
        warrantTrace?: WarrantTrace;
        groundingReport?: GroundingReport;
      }) {
        const message = createMessage({
          role: "assistant",
          content: input.content,
          model: input.model,
          system: "system2",
          turnId: input.turnId,
          responseKind: input.responseKind,
          warrantTrace: input.warrantTrace,
          groundingReport: input.groundingReport,
        });
        get().updateCurrentSession((session) => {
          session.messages = session.messages.concat([message]);
          session.lastUpdate = Date.now();
        });
        return message;
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

      recordSourceLedger(sourceId: string, readLedger: EoSource["readLedger"]) {
        get().updateCurrentSession((session) => {
          session.eoSources = (session.eoSources ?? []).map((s) =>
            s.id === sourceId ? { ...s, readLedger } : s,
          );
        });
      },

      async onUserInput(
        content: string,
        llm: LLMApi,
        attachImages?: ChatImage[],
      ) {
        // A send may arrive while another conversation's fold/System 2 call
        // still owns the shared local engine. Interrupt that work before any
        // routing or planning call for this turn; waiting until the final chat
        // request lets the new turn itself disappear into the occupied engine.
        if (eoEngineBusy) {
          eoEngineBusy = false;
          eoFoldInFlight = false;
          await llm.abort();
        }

        const modelConfig = useAppConfig.getState().modelConfig;

        const userContent = fillTemplateWith(content, useAppConfig.getState());
        log.debug("[User Input] after template: ", userContent);

        // web calling (surf-time, before the turn is assembled): the Web
        // Search toggle only enables the CAPABILITY for this session — a
        // small background model call (eo-tool-router) then decides, per
        // turn, whether THIS question actually needs it. That call is the
        // "mechanics" doing the steering: no keyword/regex scan of the
        // question, just the model's own read of it, same seam eochat's
        // defineAnswerSpec planner uses for its `lookup` field.
        const session0 = get().currentSession();

        // Admit the reader's own message to the visible transcript BEFORE any
        // pre-turn pass (web routing, surf, math) runs — a send that spends
        // seconds planning must not look like it dropped the question. The
        // object below is the same reference the transcript renders, so the
        // later content mutation (multimodal form) still shows live.
        let userMessage: ChatMessage = createMessage({
          role: "user",
          content: userContent,
        });
        get().updateCurrentSession((session) => {
          session.messages = session.messages.concat([userMessage]);
          session.lastUpdate = Date.now();
        });

        // The desk's turn counter (see eo-memory.ts) — this turn's index
        // among user turns, computed after this turn's own message is
        // appended, same basis getMessagesWithMemory uses for userTurnCount.
        const turnIndex = session0.messages.filter(
          (m) => m.role === "user" && !m.isError,
        ).length;
        const extraSystemBlocks: string[] = [];
        // Populated only if web_search actually ran this turn; onFinish below
        // uses it to mechanically strip any self-authored [n] brackets and
        // attach the real source list — the talker itself is never told
        // citations exist (see formatWebSearchBlock in eo-websearch.ts).
        let turnWebResults: Awaited<ReturnType<typeof webSearch>> = [];
        let turnWebQuery = "";
        if (session0.webSearchEnabled && userContent.trim()) {
          // Router failure (parse failure OR the background call itself
          // timing out/erroring on a slow local model) must fail OPEN, same
          // as eochat's own `lookup` field: a verdict that never arrived is
          // not evidence the question didn't need a search — it's just a
          // model that was too slow to answer the routing question. Only a
          // decision that POSITIVELY said "no tools" suppresses the search.
          let decision: Awaited<ReturnType<typeof planTools>>;
          if (hasExplicitSearchIntent(userContent)) {
            // The reader already named the tool ("research dolphins",
            // "look up X") — don't hand that to a model-judged call that
            // might read the topic as too broad for its "specific,
            // checkable fact" framing and talk itself out of searching.
            decision = {
              tools: ["web_search"],
              reason: "explicit search intent in the reader's own words",
              fellBack: false,
            };
          } else {
            try {
              decision = await planTools({
                question: userContent.trim(),
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
                  eoRunConsciousUnspoken(
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
          }
          get().pushEoLog(
            "web",
            `route: ${decision.tools.length ? decision.tools.join(", ") : "no tools"} — ${decision.reason}${decision.fellBack ? " (fell back)" : ""}`,
          );
          if (decision.tools.includes("web_search")) {
            try {
              const rawQuestion = userContent.trim();
              const { query: rewrittenQuery, rewritten } =
                await planSearchQuery({
                  question: rawQuestion,
                  fallback: distillQuery(rawQuestion) || rawQuestion,
                  generate: (systemPrompt, userPrompt) =>
                    eoRunConsciousUnspoken(
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
        const fileAttached = !!pendingFile;
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

        // Structured self-facts (see eo-self-facts.js): unlike the desk
        // above, this is not a verbatim sentence the model has to re-find
        // in prose — it is a bounded, always-included list read directly
        // off the belief graph (eo-hypergraph.ts::queryUserFacts), with no
        // relevance gate and no background model call. A user's own name
        // is exactly the class of fact that must never depend on either a
        // small model's own attention over raw history, or a second small
        // model correctly judging the fact "relevant" to this question.
        const selfFactsBlock = buildSelfFactsBlock(queryUserFacts(session0.id));
        if (selfFactsBlock) {
          extraSystemBlocks.push(selfFactsBlock);
        }

        // Source corpus surf: the complete original bytes remain in OPFS.
        // This turn only receives the best matching, byte-addressed passages.
        // No prefix is ever promoted to "the file", and a later question can
        // surface a different part of the same raw source.
        const sources = session0.eoSources ?? [];
        const corpusRequested = questionRequestsCorpus(
          userContent.trim(),
          sources,
        );
        let corpusPassages: CorpusPassage[] = [];
        if (
          corpusRequested &&
          sources.some((s) => s.enabled && s.textReadable) &&
          userContent.trim()
        ) {
          try {
            const passages = await retrieveCorpus(userContent.trim(), sources);
            corpusPassages = passages;
            const corpusBlock = formatCorpusContext(
              userContent.trim(),
              sources,
              passages,
            );
            if (corpusBlock) extraSystemBlocks.push(corpusBlock);
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

        // Hypergraph surf/fold (eo-hypergraph.ts): eoreader6's own mechanical
        // navigation over the accumulated corpus + relation graph — surf
        // (executePrompt) and fold (foldSpans), plus the graph nodes/edges
        // that actually touch this turn's own words. Gated on that touch: a
        // standing dump of the graph's strongest edges, re-announced every
        // turn regardless of relevance, would be bloat, not signal. Only a
        // bounded, model-written prose "thought" — never the raw graph —
        // ever reaches the talking model; the full navigation is always
        // logged to the "hypergraph" channel for a reader who wants to see
        // the whole search.
        let hypergraphEdgesConsidered = 0;
        let hypergraphThoughtDrafted = false;
        if (userContent.trim()) {
          try {
            if (!isHypergraphHydrated(session0.id)) {
              const hydrateSources: { id: string; text: string }[] = [];
              for (const s of sources.filter(
                (s) => s.enabled && s.textReadable,
              )) {
                try {
                  const text = new TextDecoder("utf-8", { fatal: true }).decode(
                    await readRawSource(s.id),
                  );
                  hydrateSources.push({ id: s.id, text });
                } catch {
                  // A source that fails to decode is simply not hydrated —
                  // the same fail-open discipline retrieveCorpus already uses.
                }
              }
              const hydrateTurns = session0.messages
                .filter((m) => !m.isError && !m.streaming)
                .map((m) => ({ id: m.id, content: getMessageTextContent(m) }));
              ensureHypergraphHydrated(
                session0.id,
                hydrateSources,
                hydrateTurns,
              );
            }

            const nav = navigateHypergraph(session0.id, userContent.trim());
            if (nav) {
              get().pushEoLog("hypergraph", describeHypergraphNavigation(nav));
              hypergraphEdgesConsidered = nav.relevantEdges.length;
              if (hasHypergraphSignal(nav)) {
                const thought = await draftHypergraphThought({
                  navigation: nav,
                  question: userContent.trim(),
                  generate: (systemPrompt, userPrompt) =>
                    eoRunConsciousUnspoken(
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
                if (thought) {
                  extraSystemBlocks.push(buildHypergraphThoughtBlock(thought));
                  hypergraphThoughtDrafted = true;
                  get().pushEoLog("hypergraph", `thought: ${thought}`);
                }
              }
            }
          } catch (err) {
            get().pushEoLog("error", `hypergraph: ${(err as Error).message}`);
          }
        }

        // The reading probe and the task controller used to run HERE, before a
        // single token could stream — three sequential background model calls
        // on a local engine, in front of an answer the reader is watching an
        // empty box for. That contradicted the thing they were named after:
        // System 1 is the fast pass, and a fast pass that waits on two model
        // calls is not one (LAWS.md L1 — no dead air). They now run in the
        // System 2 phase in onFinish, where their cost is paid after the
        // reader already has an answer to read.
        //
        // What replaces them here is the part that has to run first and can:
        // the warrant ledger. It is arithmetic over counts this turn already
        // produced, so it costs nothing, cannot time out, and cannot be talked
        // out of firing by a model having a bad day (LAWS.md L11c).

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
                eoRunConsciousUnspoken(
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
        // multimodal form (images) is finalized here — the admitted message
        // up top is the same object, so its rendered content updates live
        userMessage.content = mContent;

        // Admitted AFTER this turn's own navigation ran, so the graph a
        // question is checked against never includes the question's own
        // words as if they were prior context.
        if (userContent.trim()) {
          admitHypergraphTurn(session0.id, {
            id: userMessage.id,
            content: userContent,
          });
        }

        // Every message this turn emits shares a turn id. The first one is the
        // System-1 draft by definition: it is what the model said before
        // anything checked it.
        const turnId = nanoid();
        let botMessage: ChatMessage = createMessage({
          role: "assistant",
          streaming: true,
          model: modelConfig.model,
          system: "system1",
          responseState: "spoken",
          turnId,
        });

        // get recent messages, then fold them down to fit the model's
        // context window so the engine can never reject the request.
        // The engine requires every system message to precede any other
        // role (SystemMessageOrderError) — recentMessages already leads
        // with its own system block, so web/file context must be spliced
        // in there too, not merely appended before the user turn.
        const assembled = get().getMessagesWithMemory(userContent);
        const recentMessages = assembled.messages;
        const systemPrefixLen = recentMessages.findIndex(
          (m) => m.role !== "system",
        );
        const splitAt =
          systemPrefixLen === -1 ? recentMessages.length : systemPrefixLen;
        const systemPrefix = recentMessages.slice(0, splitAt);
        const rest = recentMessages.slice(splitAt);
        const contextWindow = modelConfig.context_window_size ?? 4096;
        const buildMessages = (blocks: string[]) =>
          systemPrefix.concat(
            blocks.map((block) =>
              createMessage({ role: "system", content: block }),
            ),
            // the admitted transcript copy of this turn's question would
            // otherwise be re-sent by getMessagesWithMemory — drop it so the
            // question appears exactly once in the prompt
            rest.filter((m) => m.id !== userMessage.id),
            [userMessage],
          );

        // What the clamp has to lose is itself a warrant fact — material it
        // dropped is material this turn cannot account for — so the clamp runs
        // once to find out, the ledger reads the result, and the clamp runs
        // again over the turn with the warrant block added. Both passes are
        // pure arithmetic over token counts; the second is the one that ships.
        const dryRun = eoEnforceContextBudget(
          buildMessages(extraSystemBlocks),
          contextWindow,
          "chat turn (pre-warrant)",
        );

        const sourcesReadable = sources.filter(
          (s) => s.enabled && s.textReadable,
        );
        const ledger = buildFoldLedger({
          gate: assembled.gate,
          corpus: {
            enabledSources: corpusRequested ? sourcesReadable.length : 0,
            sourcesSurfaced: new Set(corpusPassages.map((p) => p.source.id))
              .size,
            passages: corpusPassages.length,
          },
          web: {
            attempted: !!turnWebQuery,
            results: turnWebResults.length,
          },
          file: { attached: fileAttached },
          desk: { facts: session0.eoMemory?.facts?.length ?? 0 },
          hypergraph: {
            edgesConsidered: hypergraphEdgesConsidered,
            thoughtDrafted: hypergraphThoughtDrafted,
          },
          discourse: assembled.discourse,
          budget: {
            droppedMessages: dryRun.dropped,
            truncated: dryRun.truncated,
          },
        });
        const demand = groundingDemand(ledger);
        const preRoute = routeTurn(ledger, demand);
        // Zero-prompt ablation baseline: System 1 does not need the warrant
        // explanation in its model context because the same accounting is
        // attached mechanically to the visible reply. Add it only when a
        // pre-answer condition has actually earned System 2.
        const warrantBlock =
          preRoute.system === "system2"
            ? buildWarrantBlock(ledger, demand)
            : "";
        get().pushEoLog("warrant", warrantLogLine(ledger, demand, preRoute));

        const budgetResult = eoEnforceContextBudget(
          buildMessages(
            warrantBlock
              ? [warrantBlock, ...extraSystemBlocks]
              : extraSystemBlocks,
          ),
          contextWindow,
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

        // save the bot's placeholder — the user's message was already admitted
        // at the top of onUserInput so it renders the instant the reader hits
        // send
        get().updateCurrentSession((session) => {
          // Keep the callback-owned object outside Immer. If the exact same
          // object is inserted here, Immer freezes it and later WebLLM
          // onUpdate/onFinish mutations silently leave the stored reply
          // empty. Store a snapshot and replace it by id in each callback.
          session.messages = session.messages.concat([{ ...botMessage }]);
          session.lastUpdate = Date.now();
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
            botMessage = {
              ...botMessage,
              streaming: true,
              ...(message ? { content: message } : {}),
            };
            get().updateCurrentSession((session) => {
              session.modelLoadProgress = null;
              // The store snapshots objects passed through Immer. Mutating the
              // callback's original botMessage does not reliably mutate that
              // snapshot (WebLLM often emits only a final update). Replace the
              // stored message explicitly so every client path renders it.
              session.messages = session.messages.some(
                (stored) => stored.id === botMessage.id,
              )
                ? session.messages.map((stored) =>
                    stored.id === botMessage.id ? { ...botMessage } : stored,
                  )
                : session.messages.concat([{ ...botMessage }]);
            });
          },
          async onFinish(message, stopReason, usage) {
            // Never mutate the value previously handed to Immer. WebLLM can
            // deliver its first content only at onFinish, after that value has
            // been frozen by the store.
            botMessage = {
              ...botMessage,
              streaming: false,
              usage,
              stopReason,
            };
            if (message) {
              if (!this.config.enable_thinking) {
                message = message.replace(/<think>\s*<\/think>/g, "");
              }

              // The assistant's own reply is content too — admitted here so
              // the graph accumulates entities and relations discussed in
              // either direction of the conversation, not only in what the
              // reader typed or uploaded.
              admitHypergraphTurn(session0.id, {
                id: botMessage.id,
                content: message,
              });

              // System 2: DEFINE against the draft only when the mechanical
              // pre-route found real warrant pressure. System 1 must remain a
              // single model call; unconditional planning made even ordinary
              // local turns pay multiple slow generations after the draft.
              if (userContent.trim() && preRoute.system === "system2") {
                try {
                  answerSpec = await defineAnswerSpec({
                    question: userContent.trim(),
                    draft: message,
                    webEnabled: !!session0.webSearchEnabled,
                    generate: (systemPrompt, userPrompt) =>
                      eoRunConsciousUnspoken(
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
                        eoRunConsciousUnspoken(
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
              const webCitations: CitationEntry[] = [];
              if (turnWebQuery) {
                message = stripCitationBrackets(message);
                botMessage.webResults = turnWebResults;
                botMessage.webQuery = turnWebQuery;
                webCitations.push(
                  ...turnWebResults.map((r, i) => ({
                    index: i + 1,
                    source_id: r.url,
                    text: r.snippet,
                  })),
                );
              }

              // The check now covers every external channel this turn
              // surfaced, not only the web. It used to fire when a search had
              // run and stay silent when the answer was about a document the
              // reader had handed over — which is exactly backwards: the
              // reader can sanity-check a claim about a news snippet far more
              // easily than a claim about page 400 of their own PDF. Same
              // mechanical check, same union index, more channels in it.
              const sourceCits = corpusCitations(corpusPassages);
              const allCitations: CitationEntry[] = [
                ...webCitations,
                ...sourceCits.map((c, i) => ({
                  ...c,
                  index: webCitations.length + i + 1,
                })),
              ];
              const checkedChannels: string[] = [];
              if (webCitations.length) checkedChannels.push("web");
              if (sourceCits.length) checkedChannels.push("your sources");

              let groundingReport: GroundingReport | null = null;
              if (allCitations.length) {
                groundingReport = checkGrounding(message, allCitations, {
                  question: userContent.trim(),
                  channels: checkedChannels,
                });
                message = annotateVoids(message, groundingReport);
                botMessage.groundingReport = groundingReport;
                // Snipping (see eo-citation-check.ts, ported from
                // eochat's citation-check.js bestClause): show the one
                // clause of each result that actually overlaps the
                // reply's vocabulary, not the whole fetched snippet.
                if (webCitations.length)
                  botMessage.webSnippets = snipCitations(message, webCitations);
                if (sourceCits.length) {
                  const snips = snipCitations(message, sourceCits);
                  botMessage.sourceCitations = sourceCits.map((c, i) => ({
                    ref: c.source_id,
                    clause: snips[i]?.clause ?? null,
                  }));
                }
                get().pushEoLog(
                  "warrant",
                  groundingReport.clean
                    ? `grounding: clean against ${checkedChannels.join(" + ")} (${groundingReport.atomsChecked} claim(s) checked)`
                    : `grounding: ${groundingReport.findings.length} unsupported claim(s) of ${groundingReport.atomsChecked} checked against ${checkedChannels.join(" + ")}${groundingReport.truncated ? ` (${groundingReport.truncated.dropped} more truncated)` : ""}`,
                );
              }

              // ── System 2 ──────────────────────────────────────────────
              //
              // The monitor pass. Everything above was mechanical; this is
              // where the turn decides whether the fast answer can stand.
              // reviewDraft reads the finished draft against the ledger — how
              // many checkable claims it made, how many failed — so a turn
              // that looked ordinary going in can still escalate on what it
              // actually said.
              const claimAtoms = countClaimAtoms(message);
              const draftRoute = reviewDraft({
                ledger,
                demand,
                claimAtoms,
                unsupported: groundingReport?.findings.length ?? 0,
              });
              let turnRoute = escalate(preRoute, draftRoute);
              botMessage.warrantTrace = eoWarrantTrace(
                ledger,
                demand,
                turnRoute,
              );

              if (turnRoute.system === "system2" && userContent.trim()) {
                try {
                  const extra = await eoRunSystem2({
                    llm,
                    get,
                    modelConfig,
                    turnId,
                    question: userContent.trim(),
                    draft: message,
                    sources,
                    alreadySurfaced: corpusPassages,
                    ledger,
                    demand,
                    route: turnRoute,
                    grounding: groundingReport,
                    session: session0,
                    clearContextIndex: session0.clearContextIndex ?? 0,
                  });
                  turnRoute = escalate(
                    turnRoute,
                    extra.probeRoute,
                    classifyResponseSet(1),
                  );
                  if (extra.emitted.length) {
                    message += extra.emitted
                      .map(
                        (note) =>
                          `\n\n---\n\n**System 2 — ${(note.responseKind ?? "check").replace(/-/g, " ")}**\n\n${getMessageTextContent(note)}`,
                      )
                      .join("");
                  }
                  botMessage.warrantTrace = eoWarrantTrace(
                    ledger,
                    demand,
                    turnRoute,
                  );
                } catch (err) {
                  // LAWS.md L1d — a path that can fail emits on failure. The
                  // draft still stands; what is lost is the second opinion,
                  // and the reader is told that is what was lost.
                  get().pushEoLog(
                    "error",
                    `system 2: check pass failed — ${(err as Error).message}`,
                  );
                }
              }

              get().pushEoLog(
                "warrant",
                `route: ${turnRoute.system} (${turnRoute.stage}, ${turnRoute.mechanical ? "mechanical" : "model-raised"}) — ${turnRoute.reasons[0] ?? ""}`,
              );

              // The System 2 fold: what this turn established and the
              // addresses it was checked against (see eo-discourse.ts). Built
              // from work already done, so it costs no model call and cannot
              // disagree with the check it reports.
              if (turnRoute.system === "system2" && allCitations.length) {
                const open: string[] = [];
                if (demand.mustUnfold.length)
                  open.push(
                    `not read this turn: ${demand.mustUnfold.join(", ")}`,
                  );
                for (const c of ledger.channels)
                  if (c.checkedEmpty)
                    open.push(`${c.channel} was consulted and came back empty`);
                const record = buildWarrantRecord({
                  turn: turnIndex,
                  // The gist is a handle for the turn, not its warrant, so it
                  // is taken mechanically off the front of the answer rather
                  // than paid for with a model call. The refs below are what
                  // actually carry it.
                  gist: message.replace(/\s+/g, " ").trim(),
                  channels: [...demand.check],
                  refs: allCitations.map((c) => c.source_id),
                  unsupported: (groundingReport?.findings ?? []).map(
                    (f) => f.text,
                  ),
                  open,
                });
                get().updateCurrentSession((session) => {
                  session.eoSummary = addWarrantRecord(
                    session.eoSummary,
                    record,
                  );
                });
                get().pushEoLog(
                  "fold",
                  `record: turn ${turnIndex} filed with ${record.refs.length} address(es)` +
                    (record.unsupported.length
                      ? `, ${record.unsupported.length} unsupported claim(s) noted`
                      : ""),
                );
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
              get().updateCurrentSession((session) => {
                session.messages = session.messages.some(
                  (stored) => stored.id === botMessage.id,
                )
                  ? session.messages.map((stored) =>
                      stored.id === botMessage.id ? { ...botMessage } : stored,
                    )
                  : session.messages.concat([{ ...botMessage }]);
              });
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
            botMessage = {
              ...botMessage,
              content:
                getMessageTextContent(botMessage) + "\n\n" + errorMessage,
              streaming: false,
            };
            userMessage.isError = !isAborted;
            botMessage.isError = !isAborted;
            get().updateCurrentSession((session) => {
              session.messages = session.messages.some(
                (stored) => stored.id === botMessage.id,
              )
                ? session.messages.map((stored) =>
                    stored.id === botMessage.id ? { ...botMessage } : stored,
                  )
                : session.messages.concat([{ ...botMessage }]);
              session.isGenerating = false;
              session.modelLoadProgress = null;
            });

            console.error("[Chat] failed ", error);
          },
        });
      },

      // Returns the assembled turn AND the surf's own accounting, because the
      // warrant ledger (eo-warrant.ts) is built out of exactly the numbers the
      // gate produced here — how many rules are in force, how many stayed
      // folded, how many matched and did not fit. Recomputing them at the call
      // site would be a second gate run that could disagree with this one.
      getMessagesWithMemory(nextQuestion?: string) {
        const session = get().currentSession();
        const clearContextIndex = session.clearContextIndex ?? 0;

        const out: ChatMessage[] = [];

        // 0. Zero-prompt ablation baseline. System 1 starts with no eo rules
        // in model context. Retrieval bytes, explicit reader templates, and
        // bounded memory may still be added below because they carry the
        // requested material itself. The deliberate rule surf remains
        // available to System 2 after a real trigger.
        const gate = { systemMessage: null, logText: null, stats: NO_GATE };
        get().pushEoLog(
          "surf",
          "surf(system1): zero-prompt ablation — 0 instruction tokens",
        );

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
        const summaryInPrompt =
          clearContextIndex === 0 &&
          userTurnCount > EO_HISTORY_TURNS &&
          !!session.eoSummary;
        if (summaryInPrompt) {
          const summaryText = buildSummarySystemMessage(session.eoSummary);
          if (summaryText) {
            out.push(createMessage({ role: "system", content: summaryText }));
          }
        }

        // 2b. ON RECORD: the System 2 folds — earlier turns that were checked,
        //     carrying the addresses they were checked against. Unlike the
        //     paraphrase above these survive the recency window without
        //     becoming unciteable, so they go in whether or not the summary
        //     does (see eo-discourse.ts).
        const recordText = buildRecordSystemMessage(session.eoSummary);
        if (clearContextIndex === 0 && recordText) {
          out.push(createMessage({ role: "system", content: recordText }));
        }

        // 3. verbatim recent turns (bounded recency window)
        const windowStart = Math.max(
          clearContextIndex,
          session.messages.length - EO_HISTORY_TURNS * 2,
        );
        let verbatimTurns = 0;
        for (let i = windowStart; i < session.messages.length; i += 1) {
          const m = session.messages[i];
          if (!m || m.isError || m.streaming) continue;
          if (m.role === "system") continue;
          if (m.role === "user") verbatimTurns += 1;
          out.push(m);
        }

        return {
          messages: out,
          gate: gate.stats,
          discourse: {
            turnCount: userTurnCount,
            folds: session.eoSummary?.folds?.length ?? 0,
            verbatimTurns,
            summaryInPrompt,
          },
        };
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

        // remove error messages if any
        const messages = session.messages;

        // should summarize topic after chating more than 50 words
        const SUMMARIZE_MIN_LEN = 50;
        if (
          config.enableAutoGenerateTitle &&
          session.topic === DEFAULT_TOPIC &&
          countMessages(messages) >= SUMMARIZE_MIN_LEN
        ) {
          const firstUser = messages.find((m) => m.role === "user");
          const topic = firstUser
            ? trimTopic(truncate(getMessageTextContent(firstUser), 72))
            : DEFAULT_TOPIC;
          get().updateCurrentSession((current) => (current.topic = topic));
          get().pushEoLog(
            "task",
            `state(unconscious): topic constructed — "${topic}"`,
          );
        }
        get().foldNextTurn(llm);
      },

      // fold: one fast conscious-but-unspoken response, retained verbatim as
      // the bounded discourse fold. There is no second summary rewrite and no
      // hidden topic call. This is the minimal single-model baseline: one
      // spoken answer plus at most one short unspoken fold.
      foldNextTurn(llm: LLMApi) {
        if (eoFoldInFlight || eoEngineBusy) return;
        eoFoldInFlight = true;
        const run = async () => {
          try {
            const modelConfig = useAppConfig.getState().modelConfig;
            const session = get().currentSession();
            const clearContextIndex = session.clearContextIndex ?? 0;
            if (clearContextIndex > 0) return;

            const msgs = session.messages;
            const completedTurns = msgs.filter(
              (message) => message.role === "assistant" && !message.isError,
            ).length;
            if (completedTurns <= EO_HISTORY_TURNS) {
              get().pushEoLog(
                "fold",
                `state(unconscious): fold deferred — ${completedTurns}/${EO_HISTORY_TURNS} verbatim turn(s), no context pressure`,
              );
              return;
            }
            if (EO_FOLD_MODE === "none") {
              get().pushEoLog(
                "fold",
                "state(unconscious): fold ablation — disabled despite context pressure",
              );
              return;
            }
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
            let turnFold = "";
            let foldState: "conscious-unspoken" | "unconscious" =
              "conscious-unspoken";
            if (EO_FOLD_MODE === "mechanical") {
              turnFold = truncate(`${question} → ${answer}`, 100);
              foldState = "unconscious";
            } else {
              try {
                const raw = await eoRunConsciousUnspoken(
                  llm,
                  [
                    {
                      role: "user",
                      content: buildFoldPrompt(question, answer),
                    },
                  ],
                  {
                    model: modelConfig.model,
                    cache: useAppConfig.getState().cacheType,
                    stream: false,
                    enable_thinking: false,
                    temperature: 0,
                  },
                  EO_FOLD_TIMEOUT_MS,
                );
                turnFold = parseFold(raw);
              } catch (err) {
                // A fold that misses its strict latency budget degrades to an
                // unconscious truncation; it never delays or deletes a reply.
                turnFold = truncate(`${question} → ${answer}`, 100);
                foldState = "unconscious";
                get().pushEoLog(
                  "error",
                  `state(conscious-unspoken): fast fold aborted — ${err}`,
                );
              }
            }
            if (foldState === "unconscious") {
              get().pushEoLog(
                "fold",
                `state(unconscious): mechanical fold retained — mode=${EO_FOLD_MODE}`,
              );
            }
            if (!turnFold) return;
            const next: EoSummary = advanceSummaryFold(prev, turnFold);

            get().updateCurrentSession((session) => {
              session.eoSummary = next;
              session.eoLastFoldIndex = assistantIdx + 1;
            });
            get().pushEoLog(
              "fold",
              `state(${foldState}): folded turn ${userIdx} — "${turnFold}"`,
            );
          } finally {
            eoFoldInFlight = false;
          }
        };
        // Let the just-finished spoken engine call release its single-flight
        // lock before the unspoken fold starts.
        setTimeout(run, 0);
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
