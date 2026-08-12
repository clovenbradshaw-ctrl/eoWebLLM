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
  buildSummaryUpdatePrompt,
  buildFoldPrompt,
  buildWarrantRecord,
  addWarrantRecord,
  parseFold,
  updateSummaryWithFold,
  advanceSummaryFold,
} from "../client/eo-discourse";
import { createInstructionGate, countTokens } from "../client/eo-gate";
import { getInstructionFolds } from "../client/eo-instructions";
import { compileProjectInstructionFolds } from "../client/eo-project-instructions";
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
  extractComparisonPhrase,
  searchGithubArchetype,
  pickLicensedCandidate,
} from "../client/eo-prior-art";
import { cloneRepo, listFiles, readFileText } from "../client/eo-repo-clone";
import { checkCoherence, filterCodeFiles } from "../client/eo-coherence-check";
import { ingestFile } from "../client/eo-source-ingest";
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
  snipCitations,
  splitSentences,
  countClaimAtoms,
  type CitationEntry,
  type GroundingReport,
  type GroundingFinding,
  type Snippet,
} from "../client/eo-citation-check";
import {
  buildGroundingSpans,
  type GroundingSpan,
} from "../client/eo-grounding-spans";
import {
  resolveSpans,
  type ClaimVerdict,
  type ClaimSpan,
} from "../client/eo-revision";
import {
  applyTurn,
  buildMemoryMessage,
  checkRecallDenial,
  isAcknowledgment,
  type ConversationMemory,
} from "../client/eo-memory";
import {
  restoreConversationMind,
  recordTurn as recordMindTurn,
  recordGroundingFindings,
  type ConversationMind,
} from "../client/eo-conversation-mind";
import {
  retrieveCorpus,
  retrieveCorpusDeliberate,
  formatCorpusContext,
  formatDeliberateContext,
  corpusCitations,
  readRawSource,
  type CorpusPassage,
  type EoSource,
} from "../client/eo-corpus";
import {
  ensureHypergraphHydrated,
  admitHypergraphTurn,
  navigateHypergraph,
  hasHypergraphSignal,
  describeHypergraphNavigation,
  describeHypergraphMovement,
  draftHypergraphThought,
  buildHypergraphThoughtBlock,
  queryUserFacts,
  hypergraphScopeId,
} from "../client/eo-hypergraph";
import { buildSelfFactsBlock } from "../client/eo-self-facts";
import {
  eligibleBinarySources,
  surfBinarySources,
  formatBinarySourceContext,
} from "../client/eo-binary-structure";
import {
  defineTaskPlan,
  probeReading,
  routeReading,
  runTaskPlan,
  type ThinkingSystem,
} from "../client/eo-task-plan";
import { createLiftRegistry, liftIfValidated } from "../client/eo-lift";
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

// The lift registry: validated operator-compositions that recur become
// citeable units. In-memory for now; persistence is the caller's, per the
// module's own contract (eo-lift.ts is pure).
const liftRegistry = createLiftRegistry();

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
  // Citey's per-sentence grounding layer (see eo-grounding-spans.ts): one
  // entry per sentence that carries a checkable claim, kept live during
  // streaming and finalized/resolved after. Separate from groundingReport
  // above (a whole-turn summary) — this is span-addressed, for a per-claim
  // affordance rather than a single end-of-message verdict.
  groundingSpans?: GroundingSpan[];
  // The exact citations `groundingSpans` above was checked against —
  // persisted so a "sourced" span's supportingCitationIndexes can resolve
  // back to a real source_id (a corpus "name#start-end" ref, or a web URL)
  // at render time, without re-deriving or re-searching anything. Set once,
  // at the same point groundingSpans is finalized against the settled
  // message (not the live per-chunk one) — see the onFinish call site.
  groundingCitations?: CitationEntry[];
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
  // The prior-art pipeline (eo-prior-art.ts / eo-repo-clone.ts /
  // eo-coherence-check.ts): every stage — search, clone, coherence-check,
  // ingest — logs here whether it hit or missed. CRISPR.md's provenance
  // law (L2e, "absence is auditable") carried over: a miss at any stage is
  // a visible record, not a silent fallthrough.
  | "prior-art"
  // The warrant decision: what could carry a claim this turn, what was folded
  // away, and which system the turn routed to. Its own kind because it is the
  // line a reader checks when an answer looks ungrounded.
  | "warrant"
  // The full hypergraph navigation eoreader6 ran this turn — every span,
  // node, and edge it considered, not just the bounded slice (if any) that
  // made it into a thought block. The model sees the bounded slice; a
  // reader who opens this log sees the whole search.
  | "hypergraph"
  // The DEFINE/EVALUATE/RECONCILE decision (eo-holonic-plan.ts) — already
  // attached per-message as planTrace, but that dies with the message the
  // moment it scrolls out of view. This is the same line, in the one place
  // "warrant" and "hypergraph" already put their own per-turn decisions so a
  // reader can find every turn's shape without reopening each message.
  | "plan";

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

  // DISPLAY-ONLY toggle, deliberately not a computation toggle: checkGrounding
  // and the System 2 escalation it can trigger (chat.ts's onUserInput) run
  // UNCHANGED either way — answer safety/quality never depends on this.
  // false only suppresses the inline "Citey: ..." chip (grounding-chip.tsx)
  // and citation badges a reader sees, for a reader who finds the per-claim
  // annotations distracting. Undefined/true (the default) preserves the
  // exact behavior this app had before the toggle existed.
  groundingDisplayEnabled?: boolean;

  // set by an uploaded file (see app/client/eo-binary-structure.ts); consumed
  // and cleared by the next onUserInput call, same one-shot handoff pattern
  // as the instruction gate's per-turn system block.
  pendingFileContext?: string | null;

  // Metadata only. The original file bytes are retained separately in OPFS
  // (eo-corpus.ts), so persisted chat state never contains an accidental copy
  // of a book or archive.
  eoSources?: EoSource[];

  // Whether this conversation's own turns are admitted into the hypergraph
  // and surfaced as context — the same "enabled" concept an EoSource
  // carries, applied to the conversation itself, since it is admitted into
  // the same graph exactly like an uploaded source is (see
  // eo-hypergraph.ts's admitHypergraphTurn / isDocEnabled). Undefined means
  // enabled — this field only ever needs to be written to turn it OFF.
  eoConversationEnabled?: boolean;

  // The verbatim "desk" of stated facts (see app/client/eo-memory.ts) — a
  // small, bounded backstop that survives even when a fact falls out of
  // EO_HISTORY_TURNS and the PAST DISCOURSE fold has paraphrased it away.
  eoMemory?: ConversationMemory;

  // The append-only cross-turn mind (see app/client/eo-conversation-mind.ts,
  // ported from eochat's conversation-holon.js, wired onto the re-earned
  // @eoreader/engine/holon/task-log). NOT eo-task-controller.ts's per-turn
  // plan, which is created and discarded within one response — this is what
  // persists: a claim this conversation could not settle at turn 3 is still
  // owed at turn 20, held here rather than lost when it scrolls out of
  // EO_HISTORY_TURNS the way eoMemory's desk cannot lose it either.
  eoMind?: ConversationMind;

  // Which project (see Project below) this session belongs to, if any. A
  // session with no projectId behaves exactly as it always has -- projects
  // are purely additive grouping, never a required concept.
  projectId?: string;

  template: Template;
}

// A named collection of sessions that share a knowledge base -- eoWebLLM's
// take on eochat's Projects. eochat's version is server-backed (a project
// row, a retrieval-pool namespace, conversations tagged by spaceId); this
// app has no server, so a project here is just a name plus the id every
// session in it carries. The "shared knowledge base" part falls out for
// free: source bytes already live in a single global OPFS directory keyed
// by source id (see eo-corpus.ts), so nothing needs to be copied between
// sessions -- see projectSources below, which is the only piece that
// actually implements the sharing (by widening which sources a turn's
// retrieval considers, not by moving any bytes).
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  // Raw, verbatim, reader-authored standing instructions for this project.
  // Segmented (never rewritten) into gate folds by
  // eo-project-instructions.ts and surfaced per turn the same way the
  // built-in instruction set is -- see eoBuildProjectInstructionBlock.
  instructions?: string;
  instructionsUpdatedAt?: number;

  // The EOT log for every session sharing this project (see
  // hypergraphScopeId, eo-hypergraph.ts): a project's chats share one
  // hypergraph reading, so they share one admission/navigation log too --
  // the same "shared knowledge base" principle projectSources already
  // implements for source bytes, applied to the terminal. A session with
  // no projectId keeps using its own ChatSession.eoLog, unchanged.
  eoLog?: EoLogEntry[];
}

// The union of every source enabled anywhere in a project, deduped by
// source id -- a file uploaded in one session of a project becomes
// answerable from any other session in the same project. Used in place of
// a single session's own eoSources wherever retrieval or the source panel
// needs to know what a project-scoped session can see.
export function projectSources(
  sessions: ChatSession[],
  projectId: string,
): EoSource[] {
  const byId = new Map<string, EoSource>();
  for (const session of sessions) {
    if (session.projectId !== projectId) continue;
    for (const source of session.eoSources ?? []) {
      if (!byId.has(source.id)) byId.set(source.id, source);
    }
  }
  return [...byId.values()];
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

// Drop priority for eoEnforceContextBudget's `required` (system-block)
// bucket. Replaces pure push-order FIFO, which had the actual importance
// of these blocks backwards: warrant (routing/audit metadata) was pushed
// first and so was dropped FIRST under real budget pressure, while a
// user's own stated name (self-facts) — the least acceptable thing to
// silently lose — sat mid-order with no special protection. Higher value
// = kept longer / dropped later.
const EO_BLOCK_PRIORITY = {
  PROTECTED: 40, // warrant, self-facts — last resort only
  DESK: 30, // conversation "desk" verbatim backstop
  CONTEXT: 20, // web, file — this turn's situational context
  SURF: 10, // corpus, hypergraph, math — cheapest to lose
} as const;

// Safety margin for the desk/self-facts window estimate below: a System 2
// turn can emit more than one assistant message (see appendTurnResponse),
// shrinking how many *user* turns actually fit inside EO_HISTORY_TURNS*2
// raw messages. Padding the boundary later (more recent) errs toward
// treating a turn as NOT yet visible raw, so a fact is included rather
// than silently dropped when the estimate is off.
const EO_DESK_WINDOW_MARGIN_TURNS = 2;
// The router call (eo-tool-router) has no way to cap the model's output
// length — LLMConfig carries no max_tokens knob the WebLLM engine call
// forwards — so on a slow local model a verbose reply can blow past the
// ordinary fold timeout even though the router prompt asks for one line of
// JSON. Give it more slack before treating it as failed; a slow verdict
// still fails open (see the try/catch around planTools in onUserInput).
const EO_ROUTER_TIMEOUT_MS = 45000;

// Bounds how many of a cloned repo's real code files get ingested in one
// turn — same context-economy discipline as everything else the prior-art
// pipeline touches (see eo-repo-clone.ts's MAX_LISTED_FILES/MAX_FILE_BYTES):
// every ingested source is a permanent addition to the corpus a small local
// model has to be able to surf over, not a one-time cost.
const MAX_PRIOR_ART_INGEST_FILES = 15;

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
      // A timeout is a terminal outcome for this call too — release the
      // busy flag exactly like onError does. Left unset before this fix,
      // a single slow/timed-out background call anywhere in a turn could
      // leave eoEngineBusy stuck true for the rest of that turn's onFinish,
      // silently blocking topic-naming and foldNextTurn until the next
      // onUserInput force-reset it (see line ~1718) — too late to help the
      // turn that hit it.
      eoEngineBusy = false;
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

// The judge for eo-revision.ts's post-display pass: given one flagged claim
// and the top snippet a targeted search turned up for it, ask the model
// whether the snippet actually disagrees with the claim (worth striking
// through and correcting) or just doesn't speak to it (leave as a soft
// gap, not an error). A model grading its own draft is not a check — this
// grades the draft against outside text it did not write, the same
// separation eo-citation-check.ts's own comments insist on.
async function eoJudgeClaim(
  llm: LLMApi,
  modelConfig: ModelConfig,
  atom: string,
  sentence: string,
  snippet: string,
): Promise<{ verdict: ClaimVerdict; correction?: string }> {
  const raw = await eoRunBackground(
    llm,
    [
      createMessage({
        role: "system",
        content:
          'You check ONE specific fact against one search snippet. Reply with ONLY compact JSON, no prose: {"verdict":"confirmed"|"contradicted"|"unrelated","correction":"..."}. The FACT is the only thing being judged — the SENTENCE is just surrounding context, do not judge other parts of it. Use "contradicted" ONLY when the snippet is clearly about that same fact and clearly gives a different number, date, or name for it — then set "correction" to the correct fact in one short sentence. Use "confirmed" when the snippet supports the fact. Use "unrelated" when the snippet does not address the fact either way (this is the default when unsure).',
      }),
      createMessage({
        role: "user",
        content: `FACT TO CHECK: ${atom}\n\nSENTENCE (context only): ${sentence}\n\nSNIPPET: ${snippet}`,
      }),
    ],
    {
      model: modelConfig.model,
      cache: useAppConfig.getState().cacheType,
      stream: false,
      // Forced low regardless of the chat's own temperature/top_p — this is
      // a yes/no classification against a fixed snippet, not open-ended
      // generation. Verified live: at the chat's default temperature (1.0),
      // a small local model occasionally invents a "contradicted" verdict
      // with a fabricated correction over a claim the snippet actually
      // confirms — sampling noise turning a correct answer into a wrong
      // one, which is worse than never having checked at all. Ten replays
      // of one real "1889" vs. a Wikipedia snippet at temperature 1.0
      // produced "confirmed" nine times and one fabricated "contradicted
      // ...1901" — reproduced from an actual run of this feature, not a
      // hypothetical.
      temperature: 0.1,
      top_p: 0.1,
    },
    EO_ROUTER_TIMEOUT_MS,
  );
  try {
    const parsed = JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/, "")
        .trim(),
    );
    const verdict: ClaimVerdict = (
      ["confirmed", "contradicted", "unrelated"] as const
    ).includes(parsed?.verdict)
      ? parsed.verdict
      : "unrelated";
    return {
      verdict,
      correction:
        typeof parsed?.correction === "string" ? parsed.correction : undefined,
    };
  } catch {
    return { verdict: "unrelated" };
  }
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

// Compiling a project's instructions into folds re-segments the whole text
// (heading split, signal derivation, the budget-fit loop) -- real work that
// does not change between turns of the same conversation, only when the
// reader actually edits the project's instructions. Cached per project id,
// keyed also on the instructions' own length + a cheap content fingerprint
// so an edit invalidates the cache without needing an explicit bust call.
const projectFoldsCache = new Map<
  string,
  {
    key: string;
    folds: ReturnType<typeof compileProjectInstructionFolds>["folds"];
  }
>();

function getProjectInstructionFolds(project: Project) {
  const text = project.instructions ?? "";
  const key = `${text.length}:${text.slice(0, 64)}`;
  const cached = projectFoldsCache.get(project.id);
  if (cached && cached.key === key) return cached.folds;
  const { folds } = compileProjectInstructionFolds(text);
  projectFoldsCache.set(project.id, { key, folds });
  return folds;
}

// surf: the same mechanism as eoBuildInstructionBlock above, but over a
// project's own reader-authored instructions (see eo-project-instructions.ts)
// rather than the built-in rulebook. Unlike the built-in rules -- which are
// deliberately withheld from the visible generation turn and only checked
// against the finished draft in the System-2 pass (see withRulesInForce
// below) -- a project's instructions are meant to shape the answer as it is
// written, so this block is pushed into the primary turn itself (see
// getMessagesWithMemory) rather than only logged.
function eoBuildProjectInstructionBlock(
  question: string,
  session: ChatSession,
  project: Project | undefined,
  clearContextIndex: number,
  opts: { mode?: ThinkingSystem; claims?: string[] } = {},
): EoGateOutcome {
  try {
    if (!project || !project.instructions?.trim()) {
      return { systemMessage: null, logText: null, stats: NO_GATE };
    }
    const folds = getProjectInstructionFolds(project);
    if (!folds.length) {
      return { systemMessage: null, logText: null, stats: NO_GATE };
    }
    const history = getRecentUserQuestions(session, clearContextIndex, 3);
    const report = createInstructionGate(folds).gate({
      question,
      history,
      mode: opts.mode,
      claims: opts.claims,
      label: "PROJECT INSTRUCTIONS THIS TURN",
    });
    const s = report.stats;
    const logText =
      `surf(project,${s.mode}): ${s.active} active fold(s) [${report.activeIds.join(", ")}], ` +
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
    log.warn("[eo] project instruction gate failed:", err);
    return {
      systemMessage: null,
      logText: `surf: project instruction gate failed — ${(err as Error).message}`,
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

// Untagged system messages (template context, PAST DISCOURSE, ON RECORD)
// default to CONTEXT — mid-tier, same as before this priority scheme
// existed, neither specially protected nor specially expendable.
function eoBlockPriority(m: RequestMessage): number {
  return m.eoPriority ?? EO_BLOCK_PRIORITY.CONTEXT;
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
  // Lowest-priority-first, not push-order FIFO — see EO_BLOCK_PRIORITY.
  // Oldest-of-equal-priority still breaks ties first (stable scan, first
  // match at the lowest priority wins), matching the previous FIFO
  // behavior within a tier.
  while (required.length && total > budget) {
    let dropIdx = 0;
    let dropPriority = eoBlockPriority(required[0]);
    for (let i = 1; i < required.length; i++) {
      const p = eoBlockPriority(required[i]);
      if (p < dropPriority) {
        dropPriority = p;
        dropIdx = i;
      }
    }
    total -= eoMessageTokens(required[dropIdx]);
    required.splice(dropIdx, 1);
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
const EO_MAX_SYSTEM2_RESPONSES = 3;

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
 *   and the turn may speak again. Some findings are not edits. "That figure
 *   isn't in the source you think it came from" is a different speech act
 *   about the answer, not a revision of it, and rewriting the answer to
 *   contain its own disclaimer either buries the finding or distorts the
 *   answer to make room.
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
  const background = (systemPrompt: string, userPrompt: string) => {
    const budgeted = eoEnforceContextBudget(
      [
        createMessage({ role: "system", content: systemPrompt }),
        createMessage({ role: "user", content: userPrompt }),
      ],
      modelConfig.context_window_size ?? 4096,
      "system2 background call",
    );
    if (budgeted.dropped) get().pushEoLog("fold", budgeted.logText);
    return eoRunBackground(
      llm,
      budgeted.messages,
      {
        model: modelConfig.model,
        cache: useAppConfig.getState().cacheType,
        stream: false,
      },
      EO_ROUTER_TIMEOUT_MS,
    );
  };

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

  // RULES IN FORCE THIS TURN, actually reaching a generation pass: until
  // now this gate's systemMessage was computed and logged (.logText/.stats
  // above) but never sent to any model — the same is true of System-1's own
  // call to eoBuildInstructionBlock in getMessagesWithMemory, deliberately,
  // per its own comment ("do not spend the visible answer's context on its
  // verbose rule bodies"). System 2 is the deliberate, escalated pass and
  // has no equivalent excuse: every "earned" response below is new reader-
  // facing text, generated by a background call with no other guardrail on
  // it. Only wraps prompts that produce prose the reader will see — not
  // probeReading/defineTaskPlan, which are task-internal.
  const withRulesInForce = (systemPrompt: string): string =>
    checkGate.systemMessage
      ? `${systemPrompt}\n\n${checkGate.systemMessage}`
      : systemPrompt;

  // 3. The reading probe. It used to run before the first token, where it was
  //    a model call standing between the reader and any answer at all. Here it
  //    costs the reader nothing: they are already reading. Its verdict can
  //    only raise the route (escalate() is monotone), so a probe that times
  //    out on a slow local engine subtracts a second opinion and never
  //    subtracts a check.
  let probeRoute: TurnRoute | null = null;
  let probeTrace: Awaited<ReturnType<typeof probeReading>>["trace"] | null =
    null;
  try {
    const probe = await probeReading({
      question,
      sources,
      passages: [...input.alreadySurfaced, ...deliberate.passages],
      generate: background,
    });
    probeTrace = probe.trace;
    probeRoute = {
      system: routeReading(probe.trace),
      stage: "probe",
      mechanical: false,
      reasons: [
        `probe: candidates=${probe.trace.candidateReadings}, coverage=${probe.trace.supportCoverage}, evidence=${probe.trace.evidenceRelation}, claim=${probe.trace.claimType}`,
      ],
    };
    get().pushEoLog("task", `system 2 probe: ${probeRoute.reasons[0]}`);
  } catch (err) {
    get().pushEoLog(
      "error",
      `system 2 probe: ${(err as Error).message} — route stands on the mechanical reasons alone`,
    );
  }

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
        const findings = unsupported
          .slice(0, 8)
          .map(
            (f) =>
              `- "${f.text}" (${f.atomKind}) is not in ${grounding?.channels.join(" or ") || "the material checked"}`,
          )
          .join("\n");
        const unread = externalUnread.length
          ? `\nMaterial that exists but was not read this turn: ${externalUnread.join(", ")}.`
          : "";
        const raw = await background(
          withRulesInForce(
            "You are checking an answer that has already been given. Write a short, plain note to the reader about what in it is NOT supported by the material actually consulted. Name the specific claims. Do not restate the answer, do not apologise, do not hedge with generalities about AI limitations. If something merely was not checked, say it was not checked rather than saying it is wrong. Three sentences at most.",
          ),
          `The answer given:\n${draft.slice(0, 2000)}\n\nUnsupported claims found by a mechanical check:\n${findings || "(none)"}${unread}`,
        );
        const text = String(raw || "").trim();
        // L1d — the note must exist even if the model call for it does not.
        // A mechanically composed fallback is worse prose and the same fact.
        if (text) return text;
        if (!unsupported.length) return null;
        return (
          `Checked against ${grounding?.channels.join(" and ") || "this turn's material"}: ` +
          `${unsupported.length} thing(s) in that answer are not in it — ` +
          unsupported
            .slice(0, 5)
            .map((f) => `"${f.text}"`)
            .join(", ") +
          `. Treat those as unverified.`
        );
      },
    });
  }

  // 3b. A counter-reading is earned by the contrastive surf actually
  //     retrieving something, or by the probe reporting a second live reading
  //     — not by the model feeling uncertain.
  const contested =
    probeTrace?.candidateReadings === "2+" ||
    probeTrace?.evidenceRelation === "conflicting";
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
          withRulesInForce(
            "An answer has already been given. You are checking it against material retrieved specifically because it might cut against it. Say plainly whether anything actually does. If something does, name it and say what it changes. If nothing does, say the check was made and the answer held — in one sentence. Never invent a tension the material does not contain.",
          ),
          [
            material ??
              "No competing passage was retrieved from the reader's sources.",
            probeTrace ? `A first reading noted: ${probeTrace.rationale}` : "",
            `The answer given:\n${draft.slice(0, 1500)}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
        return String(raw || "").trim() || null;
      },
    });
  }

  // 3c. A worked-through result is earned when the request genuinely has
  //     separable dependent parts. The task controller (eo-task-controller.ts)
  //     owns legality; the model only proposes wording. This ran before the
  //     first token until now, which meant a multi-part question paid for a
  //     whole dependency graph before showing the reader anything.
  if (probeRoute?.system === "system2" && sources.length) {
    earned.push({
      kind: "worked-through",
      run: async () => {
        const plan = await defineTaskPlan(question, background);
        if (plan.tasks.length < 2) return null;
        const run = await runTaskPlan({
          question,
          plan,
          sources,
          generate: background,
        });
        get().pushEoLog(
          "task",
          `system 2 task controller: ${run.controller.tasks.length} task(s), ` +
            `${run.controller.tasks.filter((t) => t.status === "completed").length} completed, ` +
            `${run.controller.tasks.filter((t) => t.status === "held").length} held, ` +
            `closure=${run.controller.closed}, halted_by=${run.controller.halted_by}`,
        );
        // The lift rule: a fully-closed (validated) shape that recurs becomes
        // a citeable unit. Held controllers are refusals — reported, never
        // lifted (the gate lives in eo-lift.ts's liftIfValidated).
        const { unit, isNew } = liftIfValidated(liftRegistry, run.controller, {
          now: Date.now(),
        });
        if (unit)
          get().pushEoLog(
            "lift",
            `${isNew ? "" : "lifted again: "}validated composition ${unit.signature} (×${unit.count})${isNew ? " — first repeat" : ""}`,
          );
        if (!run.context) return null;
        const raw = await background(
          withRulesInForce(
            "Synthesize the bounded task results below into one warranted addition to an answer the reader already has. Do not repeat what the answer already said. Distinguish direct support from inference, name any live alternative, and preserve an unresolved gap rather than filling it. Never mention tasks, planning, or that you were given results.",
          ),
          `${run.context}\n\nThe answer already given:\n${draft.slice(0, 1500)}`,
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
        get().appendTurnResponse({
          turnId,
          content: text,
          responseKind: item.kind,
          model: modelConfig.model,
        }),
      );
      get().pushEoLog("warrant", `system 2: emitted a ${item.kind} response`);
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
  projects: [] as Project[],
  // Which project the Project page (project.tsx) is showing, if any --
  // this app has no per-entity URLs (Chat itself is just "whatever
  // currentSessionIndex points at"), so this is the same store-driven
  // navigation pattern applied to a project instead of a session.
  currentProjectId: null as string | null,
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

      newSession(template?: Template, projectId?: string) {
        const session = createEmptySession();

        if (template) {
          session.template = {
            ...template,
          };
          session.topic = template.name;
        }
        if (projectId) session.projectId = projectId;

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [session].concat(state.sessions),
        }));
      },

      createProject(name: string): Project {
        const project: Project = { id: nanoid(), name, createdAt: Date.now() };
        set((state) => ({ projects: [project].concat(state.projects) }));
        return project;
      },

      renameProject(id: string, name: string) {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, name } : p,
          ),
        }));
      },

      setCurrentProjectId(id: string | null) {
        set(() => ({ currentProjectId: id }));
      },

      updateProjectInstructions(id: string, text: string) {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id
              ? { ...p, instructions: text, instructionsUpdatedAt: Date.now() }
              : p,
          ),
        }));
      },

      // Sessions keep their projectId even after the project itself is
      // deleted, the same way eochat leaves a conversation's spaceId alone
      // on project delete -- they just fall back to behaving like any other
      // ungrouped session (see projectSources: a dangling id simply never
      // matches a project again).
      deleteProject(id: string) {
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
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
        const entry: EoLogEntry = {
          id: nanoid(),
          ts: Date.now(),
          kind,
          text,
        };
        const session = get().sessions[get().currentSessionIndex];
        // A project-scoped session shares its EOT log with every other
        // session in the project (hypergraphScopeId's own reasoning,
        // applied to the log, not only the graph/tiers) -- write to the
        // PROJECT, not the session, so opening a sibling chat sees the same
        // history rather than a silently different one.
        if (session?.projectId) {
          const projectId = session.projectId;
          set((state) => ({
            projects: state.projects.map((p) =>
              p.id === projectId
                ? {
                    ...p,
                    eoLog: [...(p.eoLog ?? []), entry].slice(-EO_LOG_MAX),
                  }
                : p,
            ),
          }));
          return;
        }
        get().updateCurrentSession((session) => {
          session.eoLog = [...(session.eoLog ?? []), entry].slice(-EO_LOG_MAX);
        });
      },

      /** The EOT log a session should actually display -- the project's
       *  shared log when it has one, else the session's own. Every reader
       *  of eoLog (chat.tsx's terminal panel) should go through this, not
       *  `session.eoLog` directly, or a project's chats read divergent
       *  histories despite sharing one hypergraph. */
      sessionEoLog(session: ChatSession): EoLogEntry[] {
        if (session.projectId) {
          const project = get().projects.find(
            (p) => p.id === session.projectId,
          );
          return project?.eoLog ?? [];
        }
        return session.eoLog ?? [];
      },

      // See app/client/eo-conversation-mind.ts's own header: eoLog (above) is
      // a human-readable audit trail — its warrant/hypergraph lines are
      // STRINGS, a summary of a turn's structured state that does not survive
      // the turn. This is the structured, foldable state itself: whether this
      // turn continues an existing thread (shared source ids, existence-
      // dependency), and any claim it made that none of its checked sources
      // actually support, held as an open, addressable refusal rather than
      // compressed into a line only a human re-reads.
      recordEoMindTurn(messageId: string, sourceIds: string[]) {
        get().updateCurrentSession((session) => {
          let mind = restoreConversationMind(session.eoMind ?? null);
          mind = recordMindTurn(mind, { messageId, sourceIds }).mind;
          session.eoMind = mind;
        });
      },

      recordEoMindGrounding(messageId: string, findings: GroundingFinding[]) {
        if (!findings.length) return;
        get().updateCurrentSession((session) => {
          const mind = restoreConversationMind(session.eoMind ?? null);
          session.eoMind = recordGroundingFindings(mind, {
            messageId,
            findings,
          });
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

      // See groundingDisplayEnabled's own comment: this flips a DISPLAY
      // flag only. checkGrounding/System 2 escalation are never touched by
      // this action or by reading this flag anywhere else in the store.
      toggleGroundingDisplay() {
        get().updateCurrentSession((session) => {
          session.groundingDisplayEnabled =
            session.groundingDisplayEnabled === false ? true : false;
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

      // Same as registerEoSource, but for callers that are not necessarily
      // looking at the target session (e.g. the project document explorer,
      // which registers an upload onto a project's latest session while the
      // reader may be viewing a different session or no session at all).
      registerEoSourceForSession(sessionId: string, source: EoSource) {
        get().update((state) => {
          const session = state.sessions.find((s) => s.id === sessionId);
          if (!session) return;
          const existing = session.eoSources ?? [];
          session.eoSources = [
            ...existing.filter((s) => s.id !== source.id),
            source,
          ];
        });
      },

      recordSourceLedger(sourceId: string, readLedger: EoSource["readLedger"]) {
        get().updateEoSource(sourceId, (s) => ({ ...s, readLedger }));
      },

      // Finds whichever session actually owns a source (not necessarily the
      // current one -- a project-scoped source panel shows every session's
      // sources, see projectSources) and applies `updater` to it there.
      // Plain updateCurrentSession silently no-ops when a source belongs to
      // a different session in the same project, since its .map() never
      // matches; every mutation to an existing EoSource (toggling enabled,
      // recording a re-read) should go through this instead.
      updateEoSource(
        sourceId: string,
        updater: (source: EoSource) => EoSource,
      ) {
        get().update((state) => {
          for (const session of state.sessions) {
            const idx = (session.eoSources ?? []).findIndex(
              (s) => s.id === sourceId,
            );
            if (idx === -1) continue;
            session.eoSources = session.eoSources!.map((s, i) =>
              i === idx ? updater(s) : s,
            );
            break;
          }
        });
      },

      async onUserInput(
        content: string,
        llm: LLMApi,
        attachImages?: ChatImage[],
      ) {
        // Defense in depth, not the primary guard: chat.tsx's onSubmit is
        // expected to keep a second call from ever reaching here (see its
        // own isStreaming/isGenerating check), but this store method has no
        // caller of its own to verify that — a future call site (a retry
        // button, a keyboard shortcut, a test) could skip it. A turn already
        // in flight, including its background live-check tail (see
        // `session.isGenerating` held true there), must never be allowed to
        // share mutable module state with a second one — a real run of the
        // live fact-check feature corrupted a message exactly this way.
        if (get().currentSession().isGenerating) {
          log.warn("[User Input] dropped — a turn is already in flight");
          return;
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
        // Same recency boundary getMessagesWithMemory's verbatim window
        // uses (EO_HISTORY_TURNS), estimated here since this runs before
        // that window is built — a fact whose lastTurn falls on or after
        // this boundary is (estimated to be) already visible raw, so the
        // desk/self-facts blocks below skip restating it.
        const oldestVerbatimTurn = Math.max(
          1,
          turnIndex - EO_HISTORY_TURNS + 1 + EO_DESK_WINDOW_MARGIN_TURNS,
        );
        const extraSystemBlocks: { text: string; priority: number }[] = [];
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
              get().pushEoLog(
                "web",
                rewritten
                  ? `query: "${rawQuestion.slice(0, 60)}" -> "${turnWebQuery}"`
                  : `query: "${turnWebQuery}" (rewrite unavailable, used fallback)`,
              );
              const results = await webSearch(turnWebQuery);
              turnWebResults = results;
              const block = formatWebSearchBlock(turnWebQuery, results);
              extraSystemBlocks.push({
                text: block,
                priority: EO_BLOCK_PRIORITY.CONTEXT,
              });
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

        // Prior-art pipeline (CRISPR.md's retrieve-before-hand-coding
        // pipeline, ported from eochat — see CRISPR-AGENT-LOOP-HANDOFF.md):
        // triggered by a MECHANICAL condition on the message text, never an
        // LLM JSON tool-call decision — the same "physics" precedent as
        // hasExplicitSearchIntent above, just for a different capability. A
        // reader who compares their ask to a named existing kind ("like
        // Hacker News but for dolphins") gets a real, licensed
        // implementation searched, cloned, coherence-checked, and ingested
        // as grounded, citable source material — never invented structure
        // from nothing. Every stage logs whether it hit or missed
        // (CRISPR.md's L2e, "absence is auditable") — a miss at ANY stage
        // (no archetype found, no license, incoherent clone) is a real,
        // visible record, and the pipeline simply stops there; it never
        // falls back to silently answering as if nothing was tried.
        const comparisonPhrase = extractComparisonPhrase(userContent);
        if (comparisonPhrase) {
          try {
            const { candidates, error: searchError } =
              await searchGithubArchetype(comparisonPhrase);
            if (searchError) {
              get().pushEoLog(
                "prior-art",
                `search failed for "${comparisonPhrase}" — ${searchError}`,
              );
            } else if (!candidates.length) {
              get().pushEoLog(
                "prior-art",
                `no known archetype for "${comparisonPhrase}" — building from scratch is the honest next step`,
              );
            } else {
              get().pushEoLog(
                "prior-art",
                `search: "${comparisonPhrase}" -> ${candidates.length} candidate(s), top: ${candidates[0].repo} (${candidates[0].stars} stars, ${candidates[0].license})`,
              );
              const licensed = pickLicensedCandidate(candidates);
              if (!licensed) {
                get().pushEoLog(
                  "prior-art",
                  `no candidate has an allowed license — refusing to clone (CRISPR.md L2)`,
                );
              } else {
                const cloneUrl = licensed.url.endsWith(".git")
                  ? licensed.url
                  : `${licensed.url}.git`;
                const { result: cloned, error: cloneError } =
                  await cloneRepo(cloneUrl);
                if (cloneError || !cloned) {
                  get().pushEoLog(
                    "prior-art",
                    `clone failed for ${licensed.repo} — ${cloneError}`,
                  );
                } else {
                  const allFiles = await listFiles(cloned);
                  const codeFiles = filterCodeFiles(allFiles);
                  const coherence = await checkCoherence(cloned, codeFiles);
                  get().pushEoLog(
                    "prior-art",
                    `cloned ${licensed.repo}: ${allFiles.length} file(s), coherence: ${
                      coherence.coherent
                        ? "coherent"
                        : `${coherence.isolated.length} isolated file(s)`
                    }`,
                  );
                  if (!coherence.coherent) {
                    get().pushEoLog(
                      "prior-art",
                      `refusing to ingest an incoherent pile — isolated: ${coherence.isolated.slice(0, 5).join(", ")}`,
                    );
                  } else {
                    let ingestedCount = 0;
                    for (const relPath of codeFiles.slice(
                      0,
                      MAX_PRIOR_ART_INGEST_FILES,
                    )) {
                      const { text, error: readError } = await readFileText(
                        cloned,
                        relPath,
                      );
                      if (readError || text === null) {
                        get().pushEoLog(
                          "prior-art",
                          `skipped ${relPath} — ${readError}`,
                        );
                        continue;
                      }
                      try {
                        const file = new File(
                          [text],
                          `${licensed.repo.replace("/", "__")}/${relPath}`,
                          { type: "text/plain" },
                        );
                        const { source, logLines } = await ingestFile(file);
                        get().registerEoSource(source);
                        for (const line of logLines)
                          get().pushEoLog(line.channel, line.text);
                        ingestedCount++;
                      } catch (err) {
                        get().pushEoLog(
                          "prior-art",
                          `ingest failed for ${relPath} — ${(err as Error).message}`,
                        );
                      }
                    }
                    get().pushEoLog(
                      "prior-art",
                      `ingested ${ingestedCount}/${codeFiles.length} file(s) from ${licensed.repo} — now part of the answerable corpus, cited like any other source`,
                    );
                  }
                }
              }
            }
          } catch (err) {
            get().pushEoLog(
              "prior-art",
              `pipeline failed — ${(err as Error).message}`,
            );
          }
        }

        // Non-text source surf (see eo-binary-structure.ts): a binary/
        // unreadable upload's only turn-time material is its structural
        // summary, and — same discipline as the text corpus surf just below
        // — it only reaches the prompt when THIS turn's own words actually
        // match that source by name or type, computed fresh every turn from
        // the live source list. Never a stored one-shot block replayed on
        // the next turn regardless of relevance (LAWS.md L2 — surf and fold
        // access a source; nothing goes straight into the context window).
        // A project-scoped session searches every source uploaded anywhere
        // in the project, not just its own -- see projectSources.
        const sources = session0.projectId
          ? projectSources(get().sessions, session0.projectId)
          : (session0.eoSources ?? []);
        const binaryEligible = eligibleBinarySources(sources);
        let binarySurfaced: typeof binaryEligible = [];
        if (binaryEligible.length && userContent.trim()) {
          binarySurfaced = surfBinarySources(userContent.trim(), sources);
          const binaryBlock = formatBinarySourceContext(
            binaryEligible.length,
            binarySurfaced,
          );
          if (binaryBlock)
            extraSystemBlocks.push({
              text: binaryBlock,
              priority: EO_BLOCK_PRIORITY.CONTEXT,
            });
          get().pushEoLog(
            "file",
            `binary surf: ${binarySurfaced.length} structural summary/ies from ${binaryEligible.length} eligible non-text source(s)`,
          );
        }
        const fileAttached = binarySurfaced.length > 0;

        // conversation memory (the "desk", see eo-memory.ts): a verbatim
        // backstop for stated facts, injected every turn regardless of
        // whether EO_HISTORY_TURNS or the PAST DISCOURSE fold still holds
        // the turn that stated them.
        const memoryBlock = buildMemoryMessage({
          hot: session0.eoMemory?.hot,
          facts: session0.eoMemory?.facts,
          oldestVerbatimTurn,
        });
        if (memoryBlock) {
          extraSystemBlocks.push({
            text: memoryBlock,
            priority: EO_BLOCK_PRIORITY.DESK,
          });
        }

        // Structured self-facts (see eo-self-facts.ts): unlike the desk
        // above, this is not a verbatim sentence the model has to re-find
        // in prose — it is a bounded, always-included list read directly
        // off the belief graph (eo-hypergraph.ts::queryUserFacts), with no
        // relevance gate and no background model call. A user's own name
        // is exactly the class of fact that must never depend on either a
        // small model's own attention over raw history, or a second small
        // model correctly judging the fact "relevant" to this question.
        const selfFactsBlock = buildSelfFactsBlock(
          queryUserFacts(session0.id, oldestVerbatimTurn),
        );
        if (selfFactsBlock) {
          extraSystemBlocks.push({
            text: selfFactsBlock,
            priority: EO_BLOCK_PRIORITY.PROTECTED,
          });
        }

        // Source corpus surf: the complete original bytes remain in OPFS.
        // This turn only receives the best matching, byte-addressed passages.
        // No prefix is ever promoted to "the file", and a later question can
        // surface a different part of the same raw source. `sources` itself
        // was already hoisted above, for the non-text surf.
        let corpusPassages: CorpusPassage[] = [];
        if (
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
            if (corpusBlock)
              extraSystemBlocks.push({
                text: corpusBlock,
                priority: EO_BLOCK_PRIORITY.SURF,
              });
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
            // Always re-scan for anything not yet admitted — no longer
            // gated on isHypergraphHydrated (see eo-hypergraph.ts's own
            // note: that gate used to make a source uploaded after a
            // chat's first message silently never reach the graph;
            // admitOnce's own per-doc dedup already makes re-running this
            // safe and cheap on repeat calls).
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
            const hydrateTurns =
              session0.eoConversationEnabled === false
                ? []
                : session0.messages
                    .filter((m) => !m.isError && !m.streaming)
                    .map((m) => ({
                      id: m.id,
                      content: getMessageTextContent(m),
                    }));
            const movements = ensureHypergraphHydrated(
              hypergraphScopeId(session0),
              hydrateSources,
              hydrateTurns,
            );
            // EOT log, per admission — Amendment XXVI (eoreader6/SEED.md):
            // say which terrain a reading actually reached, honestly, not
            // only report on it at query time via navigateHypergraph below.
            for (const m of movements) {
              get().pushEoLog("hypergraph", describeHypergraphMovement(m));
            }

            const nav = navigateHypergraph(
              hypergraphScopeId(session0),
              userContent.trim(),
            );
            if (nav) {
              get().pushEoLog("hypergraph", describeHypergraphNavigation(nav));
              hypergraphEdgesConsidered = nav.relevantEdges.length;
              if (hasHypergraphSignal(nav)) {
                const thought = await draftHypergraphThought({
                  navigation: nav,
                  question: userContent.trim(),
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
                if (thought) {
                  extraSystemBlocks.push({
                    text: buildHypergraphThoughtBlock(thought),
                    priority: EO_BLOCK_PRIORITY.SURF,
                  });
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
                if (mathBlock)
                  extraSystemBlocks.push({
                    text: mathBlock,
                    priority: EO_BLOCK_PRIORITY.SURF,
                  });
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
        if (userContent.trim() && session0.eoConversationEnabled !== false) {
          const m = admitHypergraphTurn(
            hypergraphScopeId(session0),
            { id: userMessage.id, content: userContent },
            turnIndex,
          );
          if (m) get().pushEoLog("hypergraph", describeHypergraphMovement(m));
        }

        // Every message this turn emits shares a turn id. The first one is the
        // System-1 draft by definition: it is what the model said before
        // anything checked it.
        const turnId = nanoid();
        const botMessage: ChatMessage = createMessage({
          role: "assistant",
          streaming: true,
          model: modelConfig.model,
          system: "system1",
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
        const buildMessages = (blocks: { text: string; priority: number }[]) =>
          systemPrefix.concat(
            blocks.map((block) =>
              createMessage({
                role: "system",
                content: block.text,
                eoPriority: block.priority,
              }),
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
            enabledSources: sourcesReadable.length,
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
        const warrantBlock = buildWarrantBlock(ledger, demand);
        get().pushEoLog("warrant", warrantLogLine(ledger, demand, preRoute));

        const budgetResult = eoEnforceContextBudget(
          buildMessages(
            warrantBlock
              ? [
                  { text: warrantBlock, priority: EO_BLOCK_PRIORITY.PROTECTED },
                  ...extraSystemBlocks,
                ]
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

        // Citey's grounding layer needs to know what this turn already
        // gathered (web/corpus) to tell "sourced" from "owned" — and needs
        // to know it live, while the draft is still streaming, not only
        // once onFinish runs. Everything it depends on (turnWebResults,
        // turnWebQuery, corpusPassages) was already produced by the
        // pre-generation search/surf above, so it can be built once, here,
        // before the first token arrives.
        const liveCitations: CitationEntry[] = turnWebQuery
          ? turnWebResults.map((r, i) => ({
              index: i + 1,
              source_id: r.url,
              text: r.snippet,
            }))
          : [];
        liveCitations.push(
          ...corpusCitations(corpusPassages).map((c, i) => ({
            ...c,
            index: liveCitations.length + i + 1,
          })),
        );

        // save the bot's placeholder — the user's message was already admitted
        // at the top of onUserInput so it renders the instant the reader hits
        // send
        get().updateCurrentSession((session) => {
          session.messages = session.messages.concat([botMessage]);
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
            botMessage.streaming = true;
            if (message) {
              botMessage.content = message;
              // Recomputed from scratch on every chunk rather than
              // incrementally diffed — buildGroundingSpans is cheap regex
              // work, not a model call, so there's no perf reason to do
              // anything cleverer, and recomputing avoids any drift between
              // an incremental pass and the finished text.
              botMessage.groundingSpans = buildGroundingSpans(message, {
                citations: liveCitations,
                question: userContent.trim(),
              });
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

              // The assistant's own reply is content too — admitted here so
              // the graph accumulates entities and relations discussed in
              // either direction of the conversation, not only in what the
              // reader typed or uploaded. Skipped when the reader has
              // turned the conversation off as a source.
              const botMovement =
                session0.eoConversationEnabled === false
                  ? null
                  : admitHypergraphTurn(
                      hypergraphScopeId(session0),
                      { id: botMessage.id, content: message },
                      turnIndex,
                    );
              if (botMovement)
                get().pushEoLog(
                  "hypergraph",
                  describeHypergraphMovement(botMovement),
                );

              // System 2: DEFINE now, against the System-1 draft that
              // already exists — unconditional, every turn, no mechanical
              // pre-gate deciding in advance whether this turn "needed" it.
              // Runs after generation so it never delays the first token;
              // its only visible cost is a reconcile rewrite, and only when
              // its own judgment of the draft actually finds something
              // wrong with it.
              if (userContent.trim()) {
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
                    if (revised.echoDetected) {
                      get().pushEoLog(
                        "task",
                        `reconcile: rewrite echoed the prompt scaffold (KL=${revised.echoKLBits?.toFixed(2) ?? "n/a"} bits) — kept the original draft`,
                      );
                    } else if (revised.text && revised.text.trim()) {
                      message = revised.text.trim();
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
              // citations exist, so strip any [n] it wrote anyway — whether
              // it drew on web results or on numbered corpus passages
              // (formatCorpusContext in eo-corpus.ts numbers those the same
              // way). The real source list is attached as structured data
              // (webResults / sourceCitations below), not text — the UI
              // renders it as a clickable panel (see WebSearchPanel /
              // SourceCitationsPanel in chat.tsx) instead of a markdown
              // footer the reader has to scroll past the answer to find.
              // Stripping used to be gated on turnWebQuery alone, which left
              // corpus-cited turns' raw [1]/[2] text unstripped since
              // formatCorpusContext numbers passages the same way a web
              // search does.
              if (turnWebQuery || corpusPassages.length) {
                message = stripCitationBrackets(message);
              }

              // LAWS.md L2e — absence is auditable: a search that ran and
              // found nothing must render differently from a turn that never
              // searched at all, or the reader can't tell "checked, nothing
              // there" from "never checked". Gated on turnWebQuery (set the
              // moment a search is attempted), not turnWebResults.length, so
              // a zero-result search still surfaces as a disclosed gap.
              const webCitations: CitationEntry[] = [];
              if (turnWebQuery) {
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
                // No longer annotated into the text itself (see
                // eo-grounding-spans.ts) — Citey's per-sentence badges now
                // carry this, computed fresh below from the finished
                // message rather than inline void markers baked into it.
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
                get().recordEoMindGrounding(
                  botMessage.id,
                  groundingReport.findings,
                );
              }

              // Every turn is proposed into the mind regardless of whether it
              // cited anything — an uncited turn cannot be found dependent on
              // a prior one, which is the honest answer, not a guess (see
              // eo-conversation-mind.ts's recordTurn).
              get().recordEoMindTurn(
                botMessage.id,
                allCitations.map((c) => c.source_id),
              );

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
                  // Emitting more than one response IS the System 2 verdict
                  // (see classifyResponseSet) — recorded, not inferred.
                  turnRoute = escalate(
                    turnRoute,
                    extra.probeRoute,
                    classifyResponseSet(1 + extra.emitted.length),
                  );
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

              // ── Citey's grounding layer, finalized ─────────────────────
              //
              // The live per-chunk spans from onUpdate were built against a
              // still-growing string; recompute once against the finished
              // `message` so offsets and sentence boundaries are final, then
              // commit the message immediately — the reader is never made
              // to wait on a network round trip to see the answer.
              botMessage.groundingSpans = buildGroundingSpans(message, {
                citations: allCitations,
                question: userContent.trim(),
              });
              botMessage.groundingCitations = allCitations;
              botMessage.content = message;

              // Spans eligible for the async resolve pass: numbers marked
              // "checking" (nothing gathered this turn to check them
              // against yet), and names marked "owned" (searched anyway,
              // for the verbatim-clause affordance, but never given an
              // asserted verdict — see eo-revision.ts's module header for
              // why a name never earns "checking" in the first place).
              const toResolve = botMessage.groundingSpans.filter(
                (s) => s.state === "checking" || s.atomKind === "name",
              );
              if (toResolve.length && !eoEngineBusy) {
                // Held true for the whole background pass, not just the
                // visible token stream — chat.tsx's onSubmit guard (and the
                // store-level re-entrancy check in onUserInput) both key off
                // this. A real run of the string-splicing predecessor of
                // this pass proved the gap: once the visible text looks
                // finished, a reader can reasonably send a follow-up right
                // then, and without this flag staying up a second turn was
                // free to start while this one's background judge calls
                // were still in flight.
                botMessage.streaming = true;
                get().onNewMessage(botMessage, llm);
                const msgId = botMessage.id;
                const finalContent = message;
                const spans: ClaimSpan[] = toResolve.map((s) => ({
                  text: s.text,
                  start: s.start,
                  end: s.end,
                  atomKind: s.atomKind,
                }));
                void (async () => {
                  try {
                    const { checks, truncated } = await resolveSpans(
                      finalContent,
                      spans,
                      (atom, sentence, snippet) =>
                        eoJudgeClaim(llm, modelConfig, atom, sentence, snippet),
                      webSearch,
                    );
                    const contradicted = checks.filter(
                      (c) => c.verdict === "contradicted",
                    ).length;
                    get().updateCurrentSession((session) => {
                      const target = session.messages.find(
                        (m) => m.id === msgId,
                      );
                      if (!target?.groundingSpans) return;
                      // Update each resolved span IN PLACE, matched by
                      // offset — never touching `target.content`. This is
                      // the whole point of the redesign: no shared string
                      // for two resolutions to collide on.
                      for (const c of checks) {
                        const span = target.groundingSpans.find(
                          (s) =>
                            s.start === c.span.start && s.end === c.span.end,
                        );
                        if (!span) continue;
                        span.clause = c.clause;
                        span.sourceTitle = c.source?.title;
                        span.sourceUrl = c.source?.url;
                        if (c.judged) {
                          span.state =
                            c.verdict === "contradicted"
                              ? "contradicted"
                              : c.verdict === "confirmed"
                                ? "sourced"
                                : "owned";
                          span.correction = c.correction;
                        } else if (span.state === "checking") {
                          span.state = "owned";
                        }
                      }
                    });
                    get().pushEoLog(
                      "warrant",
                      `grounding: ${checks.length} span(s) resolved, ${contradicted} contradicted` +
                        (truncated
                          ? ` (${truncated.dropped} more left unresolved)`
                          : ""),
                    );
                  } catch (err) {
                    get().pushEoLog(
                      "error",
                      `grounding resolve failed — ${(err as Error).message}`,
                    );
                  } finally {
                    botMessage.streaming = false;
                    get().updateCurrentSession((session) => {
                      session.isGenerating = false;
                      session.modelLoadProgress = null;
                      session.messages = session.messages.concat();
                    });
                  }
                })();
                return;
              } else {
                get().onNewMessage(botMessage, llm);
              }
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

        // 0. Keep the latest warrant-aware surf for routing and audit, but do
        // not spend the visible answer's context on its verbose rule bodies.
        // The reader gets their folded discourse and material first. An
        const gate = eoBuildInstructionBlock(
          nextQuestion?.trim() ?? "",
          session,
          clearContextIndex,
          { mode: "system1" },
        );
        if (gate.logText) {
          get().pushEoLog("surf", gate.logText);
        }

        // 0b. A project's own standing instructions, unlike the built-in
        // rulebook above, are meant to shape the answer as it is generated
        // rather than only check it afterward -- so this block, when the
        // gate produces one, actually joins the prompt (tagged DESK: more
        // durable than this-turn situational context, below the protected
        // warrant/self-facts tier). See eoBuildProjectInstructionBlock.
        const project = session.projectId
          ? get().projects.find((p) => p.id === session.projectId)
          : undefined;
        const projectGate = eoBuildProjectInstructionBlock(
          nextQuestion?.trim() ?? "",
          session,
          project,
          clearContextIndex,
          { mode: "system1" },
        );
        if (projectGate.logText) {
          get().pushEoLog("surf", projectGate.logText);
        }
        if (projectGate.systemMessage) {
          out.push(
            createMessage({
              role: "system",
              content: projectGate.systemMessage,
              eoPriority: EO_BLOCK_PRIORITY.DESK,
            }),
          );
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
        // summaryInPrompt must reflect whether a system message was actually
        // pushed below, not merely whether session.eoSummary exists. It
        // becomes truthy after the very first successful fold phase 1, even
        // when phase 2 (the model call that sets .topic) fails and falls
        // back to advanceSummaryFold (eo-discourse.ts), which does not set
        // .topic — and buildSummarySystemMessage returns null whenever
        // .topic is unset. Gating on existence alone let the warrant ledger
        // and its EOT log line claim "summary in prompt" on turns where
        // getMessagesWithMemory never actually pushed anything for it.
        const summaryEligible =
          clearContextIndex === 0 && userTurnCount > EO_HISTORY_TURNS;
        const summaryText = summaryEligible
          ? buildSummarySystemMessage(session.eoSummary)
          : null;
        if (summaryText) {
          out.push(createMessage({ role: "system", content: summaryText }));
        }
        const summaryInPrompt = !!summaryText;

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
          } else {
            get().pushEoLog(
              "task",
              "task: topic-naming skipped — engine busy with another background call",
            );
          }
        }

        // The discourse fold used to live in the `else` above, making it
        // mutually exclusive with topic-naming: until the topic call
        // SUCCEEDS and moves session.topic off DEFAULT_TOPIC, every turn
        // took the `if` branch above and foldNextTurn was never reached at
        // all — not delayed, skipped outright, every turn, for as long as
        // topic-naming kept failing/timing out on a slow local model.
        // foldNextTurn has its own eoFoldInFlight/eoEngineBusy guard, so
        // it's safe to always attempt it here regardless of whether
        // topic-naming just took the engine slot above.
        get().foldNextTurn(llm);
      },

      // fold: compress completed turns into the PAST DISCOURSE summary. Runs
      // as one background model call (fold, then summary refresh), guarded so
      // it never overlaps another engine call; the next user turn interrupts
      // it. A fold that never completes is retried after the next turn.
      foldNextTurn(llm: LLMApi) {
        if (eoFoldInFlight || eoEngineBusy) {
          get().pushEoLog(
            "fold",
            eoFoldInFlight
              ? "fold: skipped — a fold is already in flight"
              : "fold: skipped — engine busy with another background call",
          );
          return;
        }
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

      // Startup warmup ("prime the pump"): once home.tsx's usePreloadModel has
      // downloaded and loaded the model, run ONE tiny inference — ask the model
      // to greet the reader — so the first real turn doesn't pay the engine's
      // cold-start latency (first-call compile, KV-cache warm), and a brand-new
      // session opens with the model's OWN words instead of the static BOT_HELLO
      // render-time injection. Same single-flight discipline as every background
      // call here: eoEngineBusy is set, so a reader who starts typing a real
      // question has onUserInput abort this warmup (see the eoEngineBusy check
      // before llm.chat) rather than collide on the engine.
      async runStartupGreeting(llm: LLMApi) {
        const session = get().currentSession();
        // Never interrupt a real turn, never double-fire alongside a background
        // call, and never drop a greeting into a conversation already underway.
        if (session.isGenerating || eoEngineBusy || session.messages.length > 0)
          return;

        const greeting = createMessage({
          role: "assistant",
          streaming: true,
          content: "",
        });
        get().updateCurrentSession((s) => {
          s.messages = s.messages.concat([greeting]);
        });

        const modelConfig = useAppConfig.getState().modelConfig;
        eoEngineBusy = true;
        try {
          await new Promise<void>((resolve) => {
            llm.chat({
              messages: [
                createMessage({
                  role: "system",
                  content:
                    "You are a helpful assistant about to open a conversation. Say a short, warm greeting to the reader — one or two sentences, no preamble, no markdown, no quotes.",
                }),
                createMessage({ role: "user", content: "Say hello." }),
              ],
              config: {
                ...modelConfig,
                cache: useAppConfig.getState().cacheType,
                stream: true,
                enable_thinking: useAppConfig.getState().enableThinking,
              },
              onUpdate(message) {
                greeting.content = message;
                // Shallow-copy the array so the transcript re-renders on every
                // chunk (same pattern onUserInput's streaming onUpdate uses).
                get().updateCurrentSession((s) => {
                  s.messages = s.messages.concat();
                });
              },
              onFinish(message) {
                greeting.streaming = false;
                greeting.content = message;
                get().updateCurrentSession((s) => {
                  s.messages = s.messages.concat();
                });
                get().pushEoLog(
                  "task",
                  "greeting: model warmed up and said hello on cold start",
                );
                resolve();
              },
              onError(err) {
                // Aborted by a real turn, or the engine failed the warmup —
                // either way the half-streamed warmup must not linger in the
                // transcript. No placeholder covers the gap; the session
                // just opens with an empty transcript.
                get().updateCurrentSession((s) => {
                  s.messages = s.messages.filter((m) => m.id !== greeting.id);
                });
                get().pushEoLog(
                  "error",
                  `greeting warmup dropped — ${(err as Error)?.message ?? err}`,
                );
                resolve();
              },
            });
          });
        } finally {
          eoEngineBusy = false;
        }
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

// Dev-only hook: expose the store on `window` so an external e2e driver can
// observe message/generation state without DOM-sniffing. No-op in production
// builds for consumers (module is only ever imported client-side here).
if (typeof window !== "undefined") {
  (window as any).__CHAT_STORE__ = useChatStore;
}
