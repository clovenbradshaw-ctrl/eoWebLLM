// eo-instructions.ts — loads the instruction folds the eoWebLLM gate surfaces
// per turn ("surf").
//
// Strategy (stable first):
//   1. Bundled snapshot (app/client/eo-instruction-set.ts) is the synchronous
//      baseline — the gate always has a corpus, even offline.
//   2. The live, canonical copy is the "gh version" — eochat's
//      instruction-set on GitHub. On load we refresh from it in the
//      background and cache the freshest copy in localStorage, so the app
//      tracks the canonical instruction set instead of freezing at build time.
//
// Caching: raw markdown texts + fetch timestamp under one key. A cached copy
// newer than REFRESH_TTL_MS is used without re-fetching; stale caches refresh
// lazily. Any fetch failure falls back to whatever we have (cache, then
// bundle) — a loading failure must never break the gate.

import {
  BUNDLED_INSTRUCTION_SET,
  BUNDLED_INSTRUCTION_SOURCE,
} from "./eo-instruction-set";
import { InstructionFold, parseInstructionFolds } from "./eo-gate";

export const EOCHAT_INSTRUCTION_SOURCE = BUNDLED_INSTRUCTION_SOURCE;

// The eochat repository the instruction set is cited from.
export const EOCHAT_REPO = "clovenbradshaw-ctrl/eochat";
export const EOCHAT_INSTRUCTION_DIR_PATH = "instruction-set";

const CACHE_KEY = "eoWebLLM.instructionSet";
const REFRESH_TTL_MS = 24 * 60 * 60 * 1000; // re-fetch at most once a day

interface CachedSet {
  raws: string[];
  source: string;
  fetchedAt: number;
}

let currentRaws: string[] = BUNDLED_INSTRUCTION_SET;
let currentSource = BUNDLED_INSTRUCTION_SOURCE;
let currentFolds: InstructionFold[] = parseInstructionFolds(currentRaws);
let refreshInFlight: Promise<boolean> | null = null;

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

function readCache(): CachedSet | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSet;
    if (!Array.isArray(parsed.raws) || parsed.raws.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cache: CachedSet) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable — live copy just won't survive reload */
  }
}

function adopt(raws: string[], source: string) {
  // A parse failure here means the upstream set changed shape in a way this
  // parser can't read — keep the current folds rather than handing the gate a
  // broken corpus.
  try {
    const folds = parseInstructionFolds(raws);
    currentRaws = raws;
    currentSource = source;
    currentFolds = folds;
    writeCache({ raws, source, fetchedAt: Date.now() });
    return true;
  } catch (err) {
    console.warn("[eo-instructions] rejected upstream instruction set:", err);
    return false;
  }
}

// List instruction-set files from the eochat GitHub repo via the contents API,
// then fetch each raw markdown file. Returns [] on any failure.
async function fetchLiveInstructionSet(): Promise<string[]> {
  const apiUrl = `https://api.github.com/repos/${EOCHAT_REPO}/contents/${EOCHAT_INSTRUCTION_DIR_PATH}`;
  const res = await fetch(apiUrl, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const listing = (await res.json()) as {
    name?: string;
    download_url?: string;
  }[];
  const entries = (Array.isArray(listing) ? listing : []).filter(
    (e) => e.name && e.name.endsWith(".md") && e.download_url,
  );
  if (!entries.length) throw new Error("no .md files listed");
  const raws: string[] = [];
  for (const entry of entries) {
    const rawRes = await fetch(entry.download_url!);
    if (!rawRes.ok) throw new Error(`fetch ${entry.name}: ${rawRes.status}`);
    raws.push(await rawRes.text());
  }
  return raws;
}

// Refresh from the canonical (gh) source. Called on app mount; resolves true
// if a newer live set was adopted, false if we kept the existing one.
export function refreshInstructionsFromGitHub(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    // A fresh cache beats a network round-trip on every page load.
    const cached = readCache();
    if (
      cached &&
      cached.raws.length &&
      Date.now() - cached.fetchedAt < REFRESH_TTL_MS
    ) {
      return adopt(cached.raws, cached.source);
    }
    try {
      const raws = await fetchLiveInstructionSet();
      return adopt(
        raws,
        `https://github.com/${EOCHAT_REPO}/tree/main/${EOCHAT_INSTRUCTION_DIR_PATH}`,
      );
    } catch (err) {
      console.warn(
        "[eo-instructions] could not reach the canonical instruction set — using the bundled snapshot:",
        err,
      );
      if (cached && cached.raws.length) {
        return adopt(cached.raws, cached.source);
      }
      return false;
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}
