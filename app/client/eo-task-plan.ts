// Complex-turn task planning and execution over the local corpus.
// The model proposes only task wording and dependencies. eo-task-controller
// owns the legal task state and cube-addressed transitions.

import {
  formatCorpusContext,
  retrieveCorpus,
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

/**
 * Kahneman-style routing, not a quality label: System 1 is the fast direct
 * path; System 2 earns its additional latency by having to coordinate several
 * constraints, evidence hops, or adversarial checks. This gate admits a
 * routing decision only; it never assigns a task's kind or cube cell.
 */
export function selectThinkingSystem(question: string): ThinkingSystem {
  const q = String(question || "").trim();
  if (!q) return "system1";
  // This is only an admission gate for a planning call; it does not assign
  // cube meaning from language. Multiple explicit concerns or a long request
  // are enough to justify asking for a task graph.
  const clauses = (
    q.match(/[;,]|(?:and|then|while|versus|vs\.?|including)\b/gi) ?? []
  ).length;
  return clauses >= 2 || q.split(/\s+/).length >= 22 ? "system2" : "system1";
}

export function isComplexRequest(question: string): boolean {
  return selectThinkingSystem(question) === "system2";
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
    const passages = await retrieveCorpus(`${question} ${task.goal}`, sources);
    const material =
      formatCorpusContext(task.goal, sources, passages) ??
      "No matching source passage was found.";
    let draft = await generate(
      "Complete exactly one bounded task. Use only the supplied source passages for factual claims. Do not mention planning, sources, or citations.",
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
        "TASK WORKING RESULTS — these are bounded task outputs already checked by the controller. Synthesize them into one direct answer; do not mention task planning.",
        ...completed.map((task) => `TASK: ${task.goal}\n${task.result}`),
      ].join("\n\n")
    : null;
  return { controller, context };
}
