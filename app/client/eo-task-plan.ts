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
import { foldToMouth } from "./eo-warrant";

const FOLD_PLANNER_PROMPT = `Propose the NEXT task for a reader request — one task only, never a whole plan. You are one worker in a fold: the tasks already proposed are listed below, and they are the only world you see. A new task may depend ONLY on an id already in that list. If the listed tasks already cover the work, or nothing remains worth doing, return {"tasks":[]}. Return ONLY JSON:
{"tasks":[{"id":"short id","goal":"self-contained research/writing task","dependsOn":["one of the listed ids"]}]}
You do not hold the whole request; you propose the next increment and nothing else. A task must be independently executable and must not mention a hidden plan.`;

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
export function routeReading(trace: ReadingTrace): ThinkingSystem {
  return trace.candidateReadings === "2+" ||
    trace.supportCoverage === "distributed" ||
    trace.evidenceRelation !== "consistent" ||
    trace.claimType !== "retrieval" ||
    trace.consequence === "high"
    ? "system2"
    : "system1";
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
  const material =
    formatCorpusContext(question, sources, passages) ??
    "No reader source passages are available for this turn.";
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

/**
 * Plan as sediment, not authorship. The plan is not emitted by one call that
 * reads the whole request; it accretes. Each step proposes the NEXT task only,
 * against the current live-task projection (ids + goals — bounded, and the
 * only world the proposer sees), and the controller re-validates the
 * increment. A proposal that would cycle, or that carries nothing new, is
 * refused and the fold stops. The plan that comes out is whatever the ledger
 * accumulated.
 *
 * The horizon law is enforced by construction: the fold never runs more than
 * `maxSteps`, so no single proposal call ever holds more than `maxSteps` live
 * tasks. `maxSteps` is a declared budget, not a discovered constant.
 */
export async function defineTaskPlan(
  question: string,
  generate: (system: string, user: string) => Promise<string>,
  { maxSteps = 6 } = {},
): Promise<TaskPlan> {
  let controller = createTaskController([]);
  for (let step = 0; step < maxSteps; step += 1) {
    const live =
      controller.tasks.map((t) => `- ${t.id}: ${t.goal}`).join("\n") ||
      "(none yet — you are proposing the first task)";
    const raw = await generate(
      FOLD_PLANNER_PROMPT,
      `Reader request:\n${question}\n\nTasks proposed so far:\n${live}`,
    );
    const stepPlan = parseTaskPlan(raw);
    const next = stepPlan.tasks[0];
    if (!next) break;
    let nextController;
    try {
      nextController = createTaskController([
        ...controller.tasks.map((t) => ({
          id: t.id,
          goal: t.goal,
          dependsOn: t.dependsOn,
        })),
        next,
      ]);
    } catch {
      // A proposal the controller refuses (a cycle, a malformed id) is a typed
      // gap, not a crash: the fold stops, the sediment stands.
      break;
    }
    if (nextController.tasks.length === controller.tasks.length) break;
    controller = nextController;
  }
  return {
    tasks: controller.tasks.map((t) => ({
      id: t.id,
      goal: t.goal,
      dependsOn: t.dependsOn,
    })),
  };
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
      const revised = await reconcileDraft({
        question: task.goal,
        delivery: taskSpec.delivery,
        draft,
        violations: review.violations,
        generate,
      });
      draft = revised.text;
      review = evaluateCompliance(draft, taskSpec);
    }
    finishTask(controller, task.id, draft, review.compliant);
  }
  const completed = controller.tasks.filter(
    (task) => task.status === "completed" && task.result,
  );
  const held = controller.tasks.filter(
    (task) => task.status === "held" && task.result,
  );
  // The horizon law: the mouth is a named budget, and what it withholds is
  // reported, never silent. Worked results (up to 4) reach the synthesizer;
  // the rest are named as withheld rather than vanishing.
  const mouth = foldToMouth(completed, {
    k: 4,
    id: (t) => t.id,
  });
  const parts: string[] = [];
  if (mouth.working.length) {
    parts.push(
      [
        "TASK WORKING RESULTS — these are bounded task outputs already checked by the controller. Synthesize them into one warranted answer. Distinguish direct support from inference, compare any live alternative, and preserve unresolved gaps; do not mention task planning.",
        ...mouth.working.map((task) => `TASK: ${task.goal}\n${task.result}`),
        ...(mouth.withheld
          ? [
              `(${mouth.withheld} more bounded task results were withheld from this fold — the work above is what the mouth holds.)`,
            ]
          : []),
      ].join("\n\n"),
    );
  }
  if (held.length) {
    parts.push(
      [
        "TASK GAPS — bounded task work was held, not completed. These are refusals, and a refusal is a result: do not fill them. Say plainly that they were not settled, and name the strongest live alternative or counterexample one of them found if it is stated below.",
        ...held.map((task) => `GAP: ${task.goal}\n${task.result}`),
      ].join("\n\n"),
    );
  }
  const context = parts.length ? parts.join("\n\n") : null;
  return { controller, context };
}
