// eo-instructions.ts — loads the instruction folds the eoWebLLM gate surfaces
// per turn ("surf").
//
// The corpus lives in this repository, at `instruction-set/`, and is compiled
// into `app/client/eo-instruction-set.ts` by `scripts/gen-instruction-bundle.mjs`.
// One source, checked in, versioned with the code that reads it.
//
// It did not start here. The folds were written for eochat
// (github.com/clovenbradshaw-ctrl/eochat) and this app loaded them from that
// repository at runtime, over the GitHub contents API, treating the checked-in
// bundle as an offline fallback to a "canonical" copy that lived somewhere
// else. That arrangement cannot survive eochat being retired, and it was
// already worse than it looked: nothing ever called the refresh, so every turn
// this app has served was already answered from the bundle. What is removed
// here is a network path to a disappearing repository that no code took, plus
// the localStorage cache that existed only to make that path cheap.
//
// The instruction set is now eoWebLLM's own. Editing a fold means editing
// `instruction-set/*.md` here and regenerating the bundle — a change that
// arrives with a diff and a build, rather than silently, on someone else's
// main branch.

import {
  BUNDLED_INSTRUCTION_SET,
  BUNDLED_INSTRUCTION_SOURCE,
} from "./eo-instruction-set";
import { InstructionFold, parseInstructionFolds } from "./eo-gate";

export const EOCHAT_INSTRUCTION_SOURCE = BUNDLED_INSTRUCTION_SOURCE;

/** Where the folds are edited, for the audit line and the settings panel. */
export const INSTRUCTION_DIR_PATH = "instruction-set";

// Parsed once at module load. A malformed fold throws here rather than
// half-loading a corpus (see parseInstructionFolds: a conditional fold with no
// signals can never surface, so it fails loudly instead of becoming a wall).
const currentRaws: string[] = BUNDLED_INSTRUCTION_SET;
const currentSource = BUNDLED_INSTRUCTION_SOURCE;
const currentFolds: InstructionFold[] = parseInstructionFolds(currentRaws);

export function getInstructionFolds(): InstructionFold[] {
  return currentFolds;
}

export function getInstructionSource(): string {
  return currentSource;
}

export function getInstructionStats() {
  return {
    folds: currentFolds.length,
    always: currentFolds.filter((f) => f.always).length,
    conditional: currentFolds.filter((f) => !f.always).length,
    source: currentSource,
  };
}
