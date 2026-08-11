// eo-conversation-mind.ts — browser port of eochat's
// server/conversation-holon.js, wired onto @eoreader/engine's re-earned
// task-log (see ./eo-binary/task-log.js — a flat mirror of
// eoreader6/packages/engine/holon/task-log.js).
//
// Source of the algorithm: eochat/server/conversation-holon.js
//   https://github.com/clovenbradshaw-ctrl/eochat
//
// What this is, precisely: NOT eo-task-controller.ts. That module owns one
// turn's worked-through task decomposition — created, used, discarded per
// response. This module is the thing eoWebLLM did not have: a mind that
// persists ACROSS turns, on the session itself. A question this conversation
// could not settle at turn 3 is still owed at turn 20 — a windowed history
// forgets it the moment it scrolls out, and a summary compresses it away
// precisely because nothing came of it. Here it is a log entry, so it
// survives until something resolves it.
//
// Every refusal is named by its STANCE, derived from (operator, grain) by
// this package's own cellOf — never a separately invented vocabulary.
// DEF·Ground is Clearing (a general assumption cleared), DEF·Figure is
// Dissecting (one specific claim rejected), DEF·Pattern is Unraveling (a
// whole frame dismantled).
//
// Two things this port does NOT attempt, named rather than silently missing:
//   - The measured graph-existence-dependency null. depends_on here, as in
//     the engine module, is a DECLARED claim (shared source ids), not
//     measured against a null — see task-log.js's own header for why a real
//     one does not exist yet.
//   - Ranking refusals into a working set / retrieval mouth. They are held,
//     not surfaced — surfacing them is a real next step (see foldToWorkingSet
//     in the engine module), deliberately not built blind.

// eo-binary/task-log.js is a plain-JS flat mirror of the engine module (see
// that file's own header for why); `allowJs` without `checkJs` (tsconfig.json)
// means it imports as untyped, so this file defines the minimal structural
// shapes it consumes below rather than importing types that do not exist.
// task-log.js's own jsdoc is the source of truth for these shapes; keep them
// in sync by hand, the same commitment task-log.js's own mirroring note makes
// for behavior.
import {
  createTaskLog,
  append,
  projectTasks,
  deriveLevels,
  proposeGaps,
  ENTRY_KINDS,
  STRUCTURE_ROW,
  REFUSAL_OPERATOR,
} from "./eo-binary/task-log.js";
import type { GroundingFinding } from "./eo-citation-check.ts";

export interface TaskLog {
  entries: readonly TaskLogEntry[];
  nextSeq: number;
  admits: readonly string[];
}

export interface TaskLogEntry {
  kind: string;
  task_id: string;
  seq: number;
  [key: string]: unknown;
}

export interface LiveTask {
  task_id: string;
  operator: string | null;
  grain: string | null;
  cell: { stance: string; terrain: string } | null;
  evidence: readonly string[];
  depends_on: readonly string[];
  result: unknown;
  first_seq: number;
  [key: string]: unknown;
}

// What this mind's log may say: the Structure row (how messages hang off
// each other) plus DEF (a claim this conversation raised and could not
// settle). Not the full nine — nothing here needs INS/SIG/NUL/EVA/REC yet,
// and admitting them without a use would be exactly the silent-default this
// spine's own discipline refuses.
const CONVERSATION_ADMITS = [...STRUCTURE_ROW, REFUSAL_OPERATOR] as const;

export type ConversationMind = TaskLog;

export function createConversationMind(): ConversationMind {
  return createTaskLog({ admits: [...CONVERSATION_ADMITS] });
}

/**
 * Rehydrate a mind that came back from persisted ChatSession JSON.
 *
 * Re-declares the CURRENT admission set rather than trusting whatever was
 * stored — the same reasoning as eochat's own restoreConversationHolon: what
 * a conversation may say is a property of this module as it stands now, not
 * of whenever the session happened to be created. Pinning it to a stored
 * value would mean widening CONVERSATION_ADMITS later silently fails to
 * reach every session already in progress.
 */
export function restoreConversationMind(
  persisted: TaskLog | null | undefined,
): ConversationMind {
  if (!persisted || !Array.isArray(persisted.entries)) {
    return createConversationMind();
  }
  return Object.freeze({
    entries: Object.freeze([...persisted.entries]),
    nextSeq: persisted.nextSeq ?? persisted.entries.length,
    admits: Object.freeze([
      ...CONVERSATION_ADMITS,
    ]) as unknown as TaskLog["admits"],
  });
}

/**
 * Record one turn (message) and report whether it continues an existing
 * thread — depth > 0 iff this turn's citations share a source_id with a
 * prior turn's, existence-dependency as a stated claim, never guessed from
 * the question's own text.
 */
export function recordTurn(
  mind: ConversationMind,
  { messageId, sourceIds = [] }: { messageId: string; sourceIds?: string[] },
): { mind: ConversationMind; promoted: boolean; depth: number } {
  if (!messageId) throw new TypeError("recordTurn requires a messageId");

  const priorTasks = projectTasks(mind);
  const ids = new Set(sourceIds);
  const depends_on = priorTasks
    .filter((t: LiveTask) =>
      (t.evidence ?? []).some((src: string) => ids.has(src)),
    )
    .map((t: LiveTask) => t.task_id);

  const nextMind = append(mind, {
    kind: ENTRY_KINDS.PROPOSE,
    task_id: messageId,
    depends_on,
    evidence: sourceIds,
  });

  const tasks = projectTasks(nextMind);
  const { levels } = deriveLevels(tasks) as {
    levels: { task_id: string; depth: number }[];
  };
  const depth = levels.find((l) => l.task_id === messageId)?.depth ?? 0;

  return { mind: nextMind, promoted: depth > 0, depth };
}

export interface Refusal {
  id: string;
  stance: string | null;
  grain: string | null;
  what: string | null;
  raisedBy: string | null;
  reason: string | null;
}

/** Record something this conversation could not settle. */
export function recordRefusal(
  mind: ConversationMind,
  {
    messageId,
    what,
    grain = "Figure",
    reason,
  }: {
    messageId: string;
    what: string;
    grain?: "Ground" | "Figure" | "Pattern";
    reason?: string;
  },
): ConversationMind {
  if (!messageId)
    throw new TypeError("recordRefusal requires the messageId that raised it");
  if (!what)
    throw new TypeError("recordRefusal requires what could not be settled");
  return proposeGaps(mind, [
    {
      task_id: `open:${messageId}:${what.slice(0, 60)}`,
      grain,
      reason: reason || "raised in this conversation and not settled",
      depends_on: [messageId],
      question: what,
      raised_by: messageId,
    },
  ]);
}

/** What this conversation has not settled, oldest first. Empty is a real answer. */
export function refusals(mind: ConversationMind): Refusal[] {
  return projectTasks(mind)
    .filter((t: LiveTask) => t.operator === REFUSAL_OPERATOR)
    .map((t: LiveTask) => ({
      id: t.task_id,
      stance: t.cell?.stance ?? null,
      grain: t.grain ?? null,
      what: (t as any).question ?? null,
      raisedBy: (t as any).raised_by ?? null,
      reason: (t as any).reason ?? null,
    }));
}

/** Resolve one. Supersession, so the record of it having been open survives. */
export function resolveRefusal(
  mind: ConversationMind,
  { id, messageId, answer }: { id: string; messageId: string; answer?: string },
): ConversationMind {
  if (!id) throw new TypeError("resolveRefusal requires the refusal's id");
  if (!messageId)
    throw new TypeError(
      "resolveRefusal requires the messageId that resolved it",
    );
  return append(mind, {
    kind: ENTRY_KINDS.SUPERSEDE,
    task_id: `resolved:${id}`,
    supersedes: id,
    description: answer ?? null,
    resolved_by: messageId,
  });
}

// Which grain a grounding finding refuses at. eo-citation-check.ts currently
// emits one kind ("unsupported_claim" — a claim in none of this turn's
// checked sources), narrower than eochat's citation-check.js because this
// app never lets the model write [n] brackets in the first place (see
// eo-citation-check.ts's own header). Figure grain: one specific claim
// rejected, per CUBE.md's reading of the third row.
const FINDING_GRAIN: Record<
  GroundingFinding["kind"],
  "Ground" | "Figure" | "Pattern"
> = {
  unsupported_claim: "Figure",
};

/**
 * Carry a turn's grounding findings (eo-citation-check.ts's checkGrounding)
 * into the conversation's own mind. Already computed, already shown inline
 * on the message (annotateVoids) — what this adds is that the fact a claim
 * went unsupported survives past the message that made it, the same way
 * eochat's carryGaps kept citation-check.js's findings from dying on the
 * per-answer record.
 */
export function recordGroundingFindings(
  mind: ConversationMind,
  { messageId, findings }: { messageId: string; findings: GroundingFinding[] },
): ConversationMind {
  if (!messageId)
    throw new TypeError("recordGroundingFindings requires a messageId");
  let next = mind;
  for (const f of findings) {
    if (!f?.kind) continue;
    next = recordRefusal(next, {
      messageId,
      what: f.text,
      grain: FINDING_GRAIN[f.kind] ?? "Figure",
      reason: `${f.kind}: ${f.absent.length === 1 ? `"${f.absent[0]}" occurs` : `"${f.absent.join('", "')}" occur`} in none of this turn's checked sources`,
    });
  }
  return next;
}
