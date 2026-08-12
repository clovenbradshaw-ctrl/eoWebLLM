// eo-code-loop.ts — the read-execute-observe-correct ReAct loop for coding
// mode: the model picks one tool call per turn (JSON only), the tool
// actually runs against the workspace (eo-code-workspace.ts), the real
// result is folded back in as an observation, repeat until "finish" or a
// step cap. Ported, not copied, from eochat/eval/agent/react-loop.mjs —
// same protocol, same fold-context discipline, same stuck-loop detection
// (verbatim algorithm), adapted for: (a) an async tool surface (lightning-fs
// is all fs.promises, unlike node:fs's sync calls the source assumes), and
// (b) a tool registry with no run_shell — see NEXT-STEPS-HANDOFF.md and
// this repo's plan doc for why real code execution is out of scope here.
//
// `generate` is injected by the caller exactly like eo-tool-router.ts's
// planTools/planSearchQuery — this file never touches WebLLMApi directly,
// it only calls the function it's given.
//
// Source of the ported logic: eochat/eval/agent/react-loop.mjs,
// eochat/eval/agent/lib/parse-action.mjs
//   https://github.com/clovenbradshaw-ctrl/eochat

export interface CodeToolResult {
  error?: string;
  [key: string]: unknown;
}

export interface CodeTool {
  description: string;
  run: (args: Record<string, unknown>) => Promise<CodeToolResult>;
}

export interface CodeToolset {
  tools: Record<string, CodeTool>;
}

export interface LoopMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface FinishVerdict {
  ok: boolean;
  reason?: string;
}

interface TranscriptEntry {
  step: number;
  tool?: string;
  args?: Record<string, unknown>;
  result?: CodeToolResult;
  raw?: string;
  malformed?: boolean;
  reason?: string;
  note?: string;
  repeatCallStreak?: number;
}

interface FoldedTurn {
  entry: TranscriptEntry;
  msgs: LoopMessage[];
}

export interface CodeSession {
  tools: Record<string, CodeTool>;
  toolNames: string[];
  system: LoopMessage;
  intro: LoopMessage;
  foldK: number;
  validateFinish: ((session: CodeSession) => FinishVerdict) | null;
  messages: LoopMessage[];
  foldedTurns: FoldedTurn[];
  transcript: TranscriptEntry[];
  finished: boolean;
  summary: string | null;
  step: number;
  callHistory: string[];
  callCounts: Map<string, number>;
  stuckLoopAbort: boolean;
  done: boolean;
}

export type StepEvent = { step: number; phase: string } & Record<
  string,
  unknown
>;

// Same tuning as the source, verbatim — a real transcript from that project
// measured these thresholds against actual repeating-loop failures; this
// app's model is no larger, so there's no reason to loosen them.
const STUCK_LOOP_NUDGE_AT = 2;
const STUCK_LOOP_ABORT_AT = 4;
const STUCK_LOOP_MAX_PERIOD = 6;
const STUCK_LOOP_HISTORY_LEN =
  STUCK_LOOP_MAX_PERIOD * (STUCK_LOOP_ABORT_AT + 1);
const DEFAULT_FOLD_K = 6;
const MAX_FOLDED_SUMMARY_LINES = 12;

interface Cycle {
  period: number;
  repeats: number;
  pattern: string[];
}

/** Verbatim port — see react-loop.mjs's own header for why this checks periods 1..6, not just immediate repeats. */
function detectCycle(
  history: string[],
  maxPeriod = STUCK_LOOP_MAX_PERIOD,
): Cycle | null {
  const n = history.length;
  for (let period = 1; period <= maxPeriod; period++) {
    if (n < period * 2) continue;
    const block = history.slice(n - period);
    let repeats = 1;
    let idx = n - period;
    while (
      idx - period >= 0 &&
      block.every((v, i) => v === history[idx - period + i])
    ) {
      repeats++;
      idx -= period;
    }
    if (repeats >= 2) return { period, repeats, pattern: block };
  }
  return null;
}

function summarizeResult(tool: string, result: CodeToolResult): string {
  if (result && "error" in result) {
    return `ERROR: ${String(result.error).slice(0, 140)}`;
  }
  if (tool === "read_file")
    return `ok (${String(result?.content ?? "").length} chars)`;
  if (tool === "list_files")
    return `ok (${(result?.files as unknown[])?.length ?? 0} file(s))`;
  if (
    tool === "write_file" ||
    tool === "edit_file" ||
    tool === "replace_in_file"
  )
    return "ok (written)";
  if (tool === "fetch_repo")
    return `ok (${(result?.copied as unknown[])?.length ?? 0} file(s) copied)`;
  if (tool === "check_coherence")
    return result?.coherent ? "coherent" : "NOT coherent";
  return "ok";
}

function summarizeFoldedEntry(e: TranscriptEntry): string {
  if (e.malformed)
    return `step ${e.step}: (unparseable response) — ${e.reason}`;
  if (e.note) return `step ${e.step}: ${e.note}`;
  return `step ${e.step}: ${e.tool}(${JSON.stringify(e.args)}) -> ${summarizeResult(
    e.tool!,
    e.result!,
  )}`;
}

function buildFoldedSummaryMessage(entries: TranscriptEntry[]): LoopMessage {
  const shown =
    entries.length > MAX_FOLDED_SUMMARY_LINES
      ? entries.slice(-MAX_FOLDED_SUMMARY_LINES)
      : entries;
  const withheldExtra = entries.length - shown.length;
  const header =
    withheldExtra > 0
      ? `EARLIER STEPS (folded to keep this prompt small — showing the last ${shown.length} of ${entries.length} folded step(s); ${withheldExtra} even-earlier step(s) withheld entirely):`
      : `EARLIER STEPS (folded to keep this prompt small — ${shown.length} step(s), full detail withheld):`;
  return {
    role: "user",
    content: `${header}\n${shown.map(summarizeFoldedEntry).join("\n")}`,
  };
}

function buildPromptView(
  system: LoopMessage,
  intro: LoopMessage,
  foldedTurns: FoldedTurn[],
  foldK: number,
): LoopMessage[] {
  if (foldedTurns.length <= foldK) {
    return [system, intro, ...foldedTurns.flatMap((t) => t.msgs)];
  }
  const kept = foldedTurns.slice(-foldK);
  const folded = foldedTurns.slice(0, -foldK);
  return [
    system,
    intro,
    buildFoldedSummaryMessage(folded.map((t) => t.entry)),
    ...kept.flatMap((t) => t.msgs),
  ];
}

// No run_shell in this tool set (see this file's header) — the protocol
// text is rewritten from the source accordingly, not just trimmed.
function protocolText(toolDescriptions: string[]): string {
  return `You are a coding agent working in a real (browser-side, virtual) workspace. You have exactly these tools:

${toolDescriptions.map((d) => `- ${d}`).join("\n")}

ENVIRONMENT: this workspace has no code execution — you can read, write, and edit real files, and check that a cloned repo's files actually relate to each other, but you cannot run a shell command or a test. Reason about the code instead of running it.

RULES:
- Respond with EXACTLY ONE JSON object per turn: {"tool": "<name>", "args": {...}}. Nothing else — no prose, no markdown fences.
- Call "finish" only once the requested change is actually made and, if this workspace was seeded from a real repo, check_coherence has run and reported it coherent.
- If your last action failed, read the error and fix the actual problem — do not repeat the same action unchanged.`;
}

function formatObservation(toolName: string, result: CodeToolResult): string {
  return `OBSERVATION (${toolName}): ${JSON.stringify(result)}`;
}

function extractJSONObject(text: string): any | null {
  const src = String(text ?? "");
  const start = src.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = src.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseAction(
  text: string,
  knownTools: string[],
):
  | { ok: true; tool: string; args: Record<string, unknown> }
  | { ok: false; reason: string } {
  const obj = extractJSONObject(text);
  if (!obj || typeof obj !== "object") {
    return {
      ok: false,
      reason: "no valid JSON object found in the model's response",
    };
  }
  if (typeof obj.tool !== "string" || !knownTools.includes(obj.tool)) {
    return {
      ok: false,
      reason: `"tool" must be one of ${knownTools.join(", ")}, got ${JSON.stringify(obj.tool)}`,
    };
  }
  const args = obj.args && typeof obj.args === "object" ? obj.args : {};
  return { ok: true, tool: obj.tool, args };
}

export function createSession({
  taskPrompt,
  toolset,
  foldK = DEFAULT_FOLD_K,
  validateFinish = null,
}: {
  taskPrompt: string;
  toolset: CodeToolset;
  foldK?: number;
  validateFinish?: ((session: CodeSession) => FinishVerdict) | null;
}): CodeSession {
  const toolNames = Object.keys(toolset.tools);
  const system: LoopMessage = {
    role: "system",
    content: protocolText(toolNames.map((n) => toolset.tools[n].description)),
  };
  const intro: LoopMessage = { role: "user", content: `TASK:\n${taskPrompt}` };

  return {
    tools: toolset.tools,
    toolNames,
    system,
    intro,
    foldK,
    validateFinish,
    messages: [system, intro],
    foldedTurns: [],
    transcript: [],
    finished: false,
    summary: null,
    step: 0,
    callHistory: [],
    callCounts: new Map(),
    stuckLoopAbort: false,
    done: false,
  };
}

export function promptViewFor(session: CodeSession): LoopMessage[] {
  return buildPromptView(
    session.system,
    session.intro,
    session.foldedTurns,
    session.foldK,
  );
}

/**
 * Apply exactly one raw model response to a session. Async, unlike the
 * source's synchronous version — every tool here reads/writes through
 * lightning-fs's fs.promises API. Mutates and returns `session`.
 */
export async function applyResponse(
  session: CodeSession,
  raw: string,
): Promise<{ events: StepEvent[]; done: boolean }> {
  const events: StepEvent[] = [];
  const step = session.step;
  session.step += 1;

  const assistantMsg: LoopMessage = { role: "assistant", content: raw };
  session.messages.push(assistantMsg);
  events.push({ step, phase: "assistant_raw", raw });

  const parsed = parseAction(raw, session.toolNames);
  if (!parsed.ok) {
    session.callHistory.push(`malformed:${parsed.reason}`);
    if (session.callHistory.length > STUCK_LOOP_HISTORY_LEN)
      session.callHistory.shift();
    const cycle = detectCycle(session.callHistory);

    const entry: TranscriptEntry = {
      step,
      raw,
      malformed: true,
      reason: parsed.reason,
      repeatCallStreak: cycle && cycle.repeats > 1 ? cycle.repeats : undefined,
    };
    session.transcript.push(entry);
    events.push({ ...entry, phase: "malformed" } as StepEvent);

    let nudge = `Your last response could not be parsed: ${parsed.reason}. Respond with exactly one JSON object: {"tool": "<name>", "args": {...}}.`;
    if (cycle && cycle.repeats >= STUCK_LOOP_NUDGE_AT) {
      nudge += ` STUCK LOOP: you have repeated this same ${cycle.period > 1 ? `${cycle.period}-step ` : ""}mistake ${cycle.repeats} times in a row. Stop guessing tool names — you only have: ${session.toolNames.join(", ")}.`;
    }
    const nudgeMsg: LoopMessage = { role: "user", content: nudge };
    session.messages.push(nudgeMsg);
    session.foldedTurns.push({ entry, msgs: [assistantMsg, nudgeMsg] });

    if (cycle && cycle.repeats >= STUCK_LOOP_ABORT_AT) {
      session.stuckLoopAbort = true;
      const abortEntry: TranscriptEntry = {
        step,
        note: `aborted after ${cycle.repeats} repeats of the same ${cycle.period > 1 ? `${cycle.period}-step cycle` : "malformed response"} (stuck loop, not a step-budget exhaustion)`,
      };
      session.transcript.push(abortEntry);
      events.push({ ...abortEntry, phase: "aborted" } as StepEvent);
      session.done = true;
    }
    return { events, done: session.done };
  }

  if (parsed.tool === "finish") {
    const verdict = session.validateFinish
      ? session.validateFinish(session)
      : { ok: true };
    if (!verdict.ok) {
      const callKey = `finish:refused:${verdict.reason}`;
      session.callHistory.push(callKey);
      if (session.callHistory.length > STUCK_LOOP_HISTORY_LEN)
        session.callHistory.shift();
      const cycle = detectCycle(session.callHistory);

      const entry: TranscriptEntry = {
        step,
        tool: "finish",
        args: parsed.args,
        result: { error: verdict.reason },
        repeatCallStreak:
          cycle && cycle.repeats > 1 ? cycle.repeats : undefined,
      };
      session.transcript.push(entry);
      events.push({ ...entry, phase: "tool_result" } as StepEvent);

      let observation = `OBSERVATION (finish): refused — ${verdict.reason}`;
      if (cycle && cycle.repeats >= STUCK_LOOP_NUDGE_AT) {
        observation += `\n\nSTUCK LOOP: you have tried to finish for the same unmet reason ${cycle.repeats} times in a row. Do the thing the reason names, then finish.`;
      }
      const observationMsg: LoopMessage = {
        role: "user",
        content: observation,
      };
      session.messages.push(observationMsg);
      session.foldedTurns.push({ entry, msgs: [assistantMsg, observationMsg] });

      if (cycle && cycle.repeats >= STUCK_LOOP_ABORT_AT) {
        session.stuckLoopAbort = true;
        const abortEntry: TranscriptEntry = {
          step,
          note: `aborted after ${cycle.repeats} refused finish attempts for the same unmet reason (stuck loop, not a step-budget exhaustion)`,
        };
        session.transcript.push(abortEntry);
        events.push({ ...abortEntry, phase: "aborted" } as StepEvent);
        session.done = true;
      }
      return { events, done: session.done };
    }

    session.finished = true;
    session.summary =
      typeof parsed.args.summary === "string"
        ? (parsed.args.summary as string)
        : "(no summary given)";
    const entry: TranscriptEntry = { step, tool: "finish", args: parsed.args };
    session.transcript.push(entry);
    events.push({ ...entry, phase: "finish" } as StepEvent);
    session.done = true;
    return { events, done: true };
  }

  events.push({
    step,
    phase: "tool_call",
    tool: parsed.tool,
    args: parsed.args,
  });
  const tool = session.tools[parsed.tool];
  const result = await tool.run(parsed.args);
  const callKey = `${parsed.tool}:${JSON.stringify(parsed.args)}`;
  const isFailure = !!(result && "error" in result);

  session.callHistory.push(callKey);
  if (session.callHistory.length > STUCK_LOOP_HISTORY_LEN)
    session.callHistory.shift();
  const cycle = detectCycle(session.callHistory);
  const totalRepeats = (session.callCounts.get(callKey) ?? 0) + 1;
  session.callCounts.set(callKey, totalRepeats);
  const scatteredRepeat = !cycle && totalRepeats >= STUCK_LOOP_NUDGE_AT;

  const entry: TranscriptEntry = {
    step,
    tool: parsed.tool,
    args: parsed.args,
    result,
    repeatCallStreak:
      cycle && cycle.repeats > 1
        ? cycle.repeats
        : scatteredRepeat
          ? totalRepeats
          : undefined,
  };
  session.transcript.push(entry);
  events.push({ ...entry, phase: "tool_result" } as StepEvent);

  let observation = formatObservation(parsed.tool, result);
  if (cycle && cycle.repeats >= STUCK_LOOP_NUDGE_AT) {
    if (cycle.period === 1) {
      const outcome = isFailure
        ? "failed the SAME way"
        : "returned the SAME result";
      const fix = isFailure
        ? "re-read the OBSERVATION above (or call read_file again) and base your next argument on what it actually says, not on what you expect it to say"
        : "you already have this result — act on it (e.g. write_file) instead of asking again";
      observation += `\n\nSTUCK LOOP: this is the ${cycle.repeats}${cycle.repeats === 2 ? "nd" : cycle.repeats === 3 ? "rd" : "th"} time in a row you have called ${parsed.tool} with the EXACT SAME arguments, and it has ${outcome} every time. Repeating it again will not help. Stop: ${fix}.`;
    } else {
      const steps = cycle.pattern.map((k) => k.split(":")[0]).join(" → ");
      observation += `\n\nSTUCK LOOP: you have repeated this SAME ${cycle.period}-step sequence ${cycle.repeats} times in a row: ${steps}. None of it is making progress. Stop repeating the cycle — re-read every OBSERVATION above (not just the last one) and try something genuinely different, or call finish and report what actually blocked you.`;
    }
  } else if (scatteredRepeat) {
    observation += `\n\nREPEATED CALL: you have called ${parsed.tool} with these EXACT SAME arguments ${totalRepeats} times now this session (not in a row — other calls happened in between, but this one keeps coming back unchanged). The result will not change. Stop calling it again with the same arguments; act on the result you already have.`;
  }
  const observationMsg: LoopMessage = { role: "user", content: observation };
  session.messages.push(observationMsg);
  session.foldedTurns.push({ entry, msgs: [assistantMsg, observationMsg] });

  if (cycle && cycle.repeats >= STUCK_LOOP_ABORT_AT) {
    session.stuckLoopAbort = true;
    const abortEntry: TranscriptEntry = {
      step,
      note:
        cycle.period === 1
          ? `aborted after ${cycle.repeats} consecutive identical ${isFailure ? "failing " : ""}${parsed.tool} calls (stuck loop, not a step-budget exhaustion)`
          : `aborted after ${cycle.repeats} repeats of the same ${cycle.period}-step cycle (stuck loop, not a step-budget exhaustion)`,
    };
    session.transcript.push(abortEntry);
    events.push({ ...abortEntry, phase: "aborted" } as StepEvent);
    session.done = true;
  } else if (!cycle && totalRepeats >= STUCK_LOOP_ABORT_AT) {
    session.stuckLoopAbort = true;
    const abortEntry: TranscriptEntry = {
      step,
      note: `aborted after ${totalRepeats} scattered-but-identical ${parsed.tool} calls with the same arguments (stuck loop, not a step-budget exhaustion) — the periodic detector never saw it because other, different calls sat between each repeat`,
    };
    session.transcript.push(abortEntry);
    events.push({ ...abortEntry, phase: "aborted" } as StepEvent);
    session.done = true;
  }

  return { events, done: session.done };
}

/**
 * Drives a session to completion, calling `generate` (the caller's WebLLM
 * seam, matching eo-tool-router.ts's convention) once per step.
 */
export async function runCodeLoop({
  taskPrompt,
  toolset,
  generate,
  maxSteps = 12,
  foldK = DEFAULT_FOLD_K,
  onStep = null,
  validateFinish = null,
}: {
  taskPrompt: string;
  toolset: CodeToolset;
  generate: (messages: LoopMessage[]) => Promise<string>;
  maxSteps?: number;
  foldK?: number;
  onStep?: ((event: StepEvent) => void) | null;
  validateFinish?: ((session: CodeSession) => FinishVerdict) | null;
}): Promise<{
  finished: boolean;
  summary: string | null;
  stepsRun: number;
  hitStepCap: boolean;
  stuckLoopAbort: boolean;
  transcript: TranscriptEntry[];
}> {
  const emit = onStep
    ? (event: StepEvent) => {
        try {
          onStep(event);
        } catch (err) {
          console.error(
            `[eo-code-loop] onStep handler threw: ${(err as Error).message}`,
          );
        }
      }
    : () => {};

  const session = createSession({ taskPrompt, toolset, foldK, validateFinish });

  let step = 0;
  for (; step < maxSteps; step++) {
    const promptView = promptViewFor(session);
    if (session.foldedTurns.length > foldK) {
      emit({
        step,
        phase: "folded",
        keptTurns: Math.min(session.foldedTurns.length, foldK),
        foldedTurns: session.foldedTurns.length - foldK,
      });
    }
    emit({ step, phase: "generating" });
    const raw = await generate(promptView);
    const { events, done } = await applyResponse(session, raw);
    for (const event of events) emit(event);
    if (done) break;
  }

  return {
    finished: session.finished,
    summary: session.summary,
    stepsRun: session.transcript.length,
    hitStepCap:
      !session.finished && !session.stuckLoopAbort && step >= maxSteps,
    stuckLoopAbort: session.stuckLoopAbort,
    transcript: session.transcript,
  };
}
