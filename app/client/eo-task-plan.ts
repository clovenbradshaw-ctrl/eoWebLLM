// Complex-turn task planning and execution over the local corpus.
// The model proposes only task wording and dependencies. eo-task-controller
// owns the legal task state and cube-addressed transitions.

import {
  formatCorpusContext,
  retrieveCorpus,
  type CorpusPassage,
  type EoSource,
} from "./eo-corpus";
import {
  evaluateCompliance,
  reconcileDraft,
  type AnswerSpec,
} from "./eo-holonic-plan";
import {
  createTaskController,
  finishTask,
  nextLegalTask,
  startTask,
  type TaskController,
  type TaskDefinition,
} from "./eo-task-controller";

const TASK_PLANNER_PROMPT = `Plan a complex reader request as a small dependency graph. Return ONLY JSON:
{"tasks":[{"id":"short id","goal":"self-contained research/writing task","dependsOn":["earlier id"]}]}
Use 2–6 tasks only when the request has genuinely distinct dependent parts. Otherwise return {"tasks":[]}. A task must be independently executable and must not mention a hidden plan.`;

export interface TaskPlan {
  tasks: TaskDefinition[];
}

export type ThinkingSystem = "system1" | "system2";

/** The observable shape encountered during a bounded first reading. */
export interface ReadingTrace {
  candidateReadings: "1" | "2+";
  supportCoverage: "local" | "distributed";
  evidenceRelation: "consistent" | "conflicting" | "missing";
  claimType: "retrieval" | "inference" | "attribution";
  consequence: "low" | "high";
  tentativeReading: string;
  rationale: string;
}

export interface ReadingProbe {
  trace: ReadingTrace;
  passages: CorpusPassage[];
}

const READING_PROBE_PROMPT = `Perform one cheap, provisional reading pass. Do not plan a response and do not infer the reader's desired format from wording. Inspect the supplied material, make a short tentative reading, and report the SHAPE of what you encountered.

Return ONLY JSON:
{"candidateReadings":"1|2+","supportCoverage":"local|distributed","evidenceRelation":"consistent|conflicting|missing","claimType":"retrieval|inference|attribution","tentativeReading":"short provisional answer grounded in what was surfaced","rationale":"brief account of alternatives, conflict, coverage, or gaps"}

Use "2+" only where materially different readings remain live. Use "distributed" when support requires separated passages or sources. Use "missing" when surfaced material cannot carry the needed link. "inference" means the provisional answer goes beyond direct retrieval; "attribution" means it assigns motive, intent, authorship, identity, or responsibility. Never pretend unsurfaced material was checked.`;

const DEFAULT_TRACE: ReadingTrace = {
  candidateReadings: "1",
  supportCoverage: "local",
  evidenceRelation: "missing",
  claimType: "retrieval",
  consequence: "low",
  tentativeReading: "No provisional reading was available.",
  rationale: "The first-pass reader did not return a usable trace.",
};

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  fallback: T,
): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

function parseReadingTrace(
  raw: string,
  consequence: ReadingTrace["consequence"],
): ReadingTrace {
  const text = String(raw || "")
    .replace(/```[\s\S]*?\n?/g, "")
    .replace(/```/g, "");
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match)
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        /* default below */
      }
  }
  return {
    candidateReadings: enumValue(
      parsed?.candidateReadings,
      ["1", "2+"] as const,
      DEFAULT_TRACE.candidateReadings,
    ),
    supportCoverage: enumValue(
      parsed?.supportCoverage,
      ["local", "distributed"] as const,
      DEFAULT_TRACE.supportCoverage,
    ),
    evidenceRelation: enumValue(
      parsed?.evidenceRelation,
      ["consistent", "conflicting", "missing"] as const,
      DEFAULT_TRACE.evidenceRelation,
    ),
    claimType: enumValue(
      parsed?.claimType,
      ["retrieval", "inference", "attribution"] as const,
      DEFAULT_TRACE.claimType,
    ),
    consequence,
    tentativeReading: String(
      parsed?.tentativeReading || DEFAULT_TRACE.tentativeReading,
    )
      .trim()
      .slice(0, 1200),
    rationale: String(parsed?.rationale || DEFAULT_TRACE.rationale)
      .trim()
      .slice(0, 800),
  };
}

/** Policy over observed reading conditions; it never inspects question wording. */
export function routeReading(
  trace: ReadingTrace,
  hasReaderCorpus = false,
  hasMatchedEvidence = false,
): ThinkingSystem {
  // A direct, local retrieval with an actual surfaced passage is allowed to
  // finish tentatively in System 1. A small model occasionally labels this
  // situation "missing" simply because it cannot prove global coverage; that
  // is not a reason to spend a slow planning pass on a bounded lookup.
  if (
    hasMatchedEvidence &&
    trace.candidateReadings === "1" &&
    trace.supportCoverage === "local" &&
    trace.claimType === "retrieval" &&
    trace.evidenceRelation !== "conflicting" &&
    trace.consequence !== "high"
  ) {
    return "system1";
  }
  return trace.candidateReadings === "2+" ||
    trace.supportCoverage === "distributed" ||
    trace.evidenceRelation === "conflicting" ||
    (hasReaderCorpus && trace.evidenceRelation === "missing") ||
    trace.claimType !== "retrieval" ||
    trace.consequence === "high"
    ? "system2"
    : "system1";
}

// The fast probe reads the evidence shape, not a second full copy of the
// surf. This is a mechanical context saving: source/range provenance and
// representative text remain, while the answer and System 2 tasks retain the
// full bounded surf when they genuinely need it.
function formatProbeMaterial(
  sources: EoSource[],
  passages: CorpusPassage[],
): string {
  const readable = sources.filter(
    (source) => source.enabled && source.textReadable,
  );
  if (!readable.length)
    return "No reader source passages are available for this turn.";
  if (!passages.length) {
    return `Reader corpus: ${readable.length} enabled source(s), but no matching passage was surfaced.`;
  }
  const excerpts = passages
    .slice(0, 3)
    .map(
      (passage, index) =>
        `[${index + 1}] ${passage.source.name} · bytes ${passage.byteStart}–${passage.byteEnd}\n${passage.text.trim().slice(0, 700)}`,
    );
  return `COMPACT READING SURF — ${passages.length} matching passage(s) were found. These excerpts are only for the first reading pass; do not assume they are the full sources.\n\n${excerpts.join("\n\n")}`;
}

/** Always surface, read tentatively, and record the encountered conditions first. */
export async function probeReading({
  question,
  sources,
  passages,
  consequence = "low",
  generate,
}: {
  question: string;
  sources: EoSource[];
  passages: CorpusPassage[];
  consequence?: ReadingTrace["consequence"];
  generate: (system: string, user: string) => Promise<string>;
}): Promise<ReadingProbe> {
  const material = formatProbeMaterial(sources, passages);
  const raw = await generate(
    READING_PROBE_PROMPT,
    `Reader question:\n${question}\n\n${material}`,
  );
  return { trace: parseReadingTrace(raw, consequence), passages };
}

function normalize(raw: any): TaskPlan {
  const tasks = Array.isArray(raw?.tasks) ? raw.tasks : [];
  return {
    tasks: tasks
      .slice(0, 6)
      .map((task: any) => ({
        id: String(task?.id || "task").slice(0, 80),
        goal: String(task?.goal || "")
          .trim()
          .slice(0, 500),
        dependsOn: Array.isArray(task?.dependsOn)
          ? task.dependsOn.map(String).slice(0, 6)
          : [],
      }))
      .filter((task: TaskDefinition) => task.goal.length > 0),
  };
}

export function parseTaskPlan(raw: string): TaskPlan {
  const text = String(raw || "")
    .replace(/```[\s\S]*?\n?/g, "")
    .replace(/```/g, "");
  try {
    return normalize(JSON.parse(text));
  } catch {
    /* scan below */
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === "{") depth++;
      if (text[j] === "}") depth--;
      if (depth === 0) {
        try {
          return normalize(JSON.parse(text.slice(i, j + 1)));
        } catch {
          break;
        }
      }
    }
  }
  return { tasks: [] };
}

export async function defineTaskPlan(
  question: string,
  generate: (system: string, user: string) => Promise<string>,
): Promise<TaskPlan> {
  return parseTaskPlan(
    await generate(TASK_PLANNER_PROMPT, `Reader request:\n${question}`),
  );
}

export interface TaskRunResult {
  controller: TaskController;
  context: string | null;
}

/** Execute legal tasks serially; each sees only its own surfaced evidence. */
export async function runTaskPlan({
  question,
  plan,
  sources,
  generate,
}: {
  question: string;
  plan: TaskPlan;
  sources: EoSource[];
  generate: (system: string, user: string) => Promise<string>;
}): Promise<TaskRunResult> {
  const controller = createTaskController(plan.tasks);
  const taskSpec: AnswerSpec = {
    kind: "task result",
    delivery: "bounded working result",
    reason: "",
    compliance: { minWords: 20, require: [], forbid: [], language: null },
  };
  while (true) {
    const task = nextLegalTask(controller);
    if (!task) break;
    startTask(controller, task.id);
    const supporting = await retrieveCorpus(
      `${question} ${task.goal}`,
      sources,
    );
    // A second, deliberately skeptical surf makes System 2 do a different
    // operation than merely taking longer: it must look for exceptions and
    // competing readings before it turns a task result into working context.
    const skeptical = await retrieveCorpus(
      `counterexample limitation exception alternative contradiction ${task.goal}`,
      sources,
    );
    const seen = new Set<string>();
    const passages = [...supporting, ...skeptical]
      .filter((passage) => {
        const key = `${passage.source.id}:${passage.byteStart}:${passage.byteEnd}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
    const material =
      formatCorpusContext(task.goal, sources, passages) ??
      "No matching source passage was found.";
    let draft = await generate(
      "Complete exactly one bounded task. Use only the supplied source passages for factual claims. State direct support separately from inference, name the strongest live alternative or counterexample when one exists, and preserve an unresolved gap instead of filling it. Do not mention planning, sources, or citations.",
      `Reader request: ${question}\n\nTask: ${task.goal}\n\n${material}`,
    );
    let review = evaluateCompliance(draft, taskSpec);
    if (!review.compliant) {
      draft = await reconcileDraft({
        question: task.goal,
        delivery: taskSpec.delivery,
        draft,
        violations: review.violations,
        generate,
      });
      review = evaluateCompliance(draft, taskSpec);
    }
    finishTask(controller, task.id, draft, review.compliant);
  }
  const completed = controller.tasks.filter(
    (task) => task.status === "completed" && task.result,
  );
  const context = completed.length
    ? [
        "TASK WORKING RESULTS — these are bounded task outputs already checked by the controller. Synthesize them into one warranted answer. Distinguish direct support from inference, compare any live alternative, and preserve unresolved gaps; do not mention task planning.",
        ...completed.map((task) => `TASK: ${task.goal}\n${task.result}`),
      ].join("\n\n")
    : null;
  return { controller, context };
}
