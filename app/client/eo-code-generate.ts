// eo-code-generate.ts — the `generate` seam eo-code-loop.ts calls into,
// backed directly by WebLLMApi.chat. Not eoRunBackground (app/store/
// chat.ts) — that helper's own eoTurnTailPromise/eoFoldInFlight are
// genuinely chat concepts (a turn, a fold) coding mode has no equivalent
// of, and its retry/timeout policy is tuned for chat's own background
// calls, not a tool-loop's. But this DOES share the one thing that
// actually needs cross-surface protection: the engine itself. `/` and
// `/coding` read the exact same WebLLMApi instance (see app/store/
// engine.ts's own header on why it's a shared singleton), and that engine
// is single-flight — two real llm.chat() calls in flight at once, one from
// each route, collide on one non-reentrant worker, and the newer call's
// callbacks can simply stop firing, permanently, for the rest of the
// session (see chat.ts's own mutex-rationale comment for exactly this
// failure mode, once observed for real). So this waits out and claims
// app/store/engine.ts's shared busy signal — the same one chat.ts's own
// turn dispatch and background calls use — before ever calling llm.chat(),
// making this route a real participant in that coordination instead of
// only being caught by WebLLMApi's own internal queue as a backstop.

import type { LLMApi } from "./api";
import type { LoopMessage } from "./eo-code-loop";
import type { Model } from "../store/config";
import type { CacheType } from "../store/config";
import { waitForEngineFree, markEngineBusy } from "../store/engine";

export function makeCodeGenerate(
  llm: LLMApi,
  model: Model,
  cache: CacheType,
): (messages: LoopMessage[]) => Promise<string> {
  return async (messages: LoopMessage[]) => {
    await waitForEngineFree();
    const releaseEngine = markEngineBusy();
    return new Promise<string>((resolve, reject) => {
      llm.chat({
        messages,
        config: { model, cache, stream: false },
        onFinish(message) {
          releaseEngine();
          resolve(message);
        },
        onError(err) {
          releaseEngine();
          reject(err);
        },
      });
    });
  };
}
