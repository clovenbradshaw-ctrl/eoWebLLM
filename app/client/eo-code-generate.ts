// eo-code-generate.ts — the `generate` seam eo-code-loop.ts calls into,
// backed directly by WebLLMApi.chat. Not eoRunBackground (app/store/chat.ts)
// on purpose: that helper's single-flight `eoEngineBusy` guard coordinates
// against the CONVERSATIONAL chat page's own turn flow (streaming replies,
// fold/topic background calls) — coding mode is a separate route with its
// own sequential loop (eo-code-loop.ts already awaits one generate() call
// at a time), so it needs the same non-streaming call shape but not that
// specific cross-surface coordination.

import type { LLMApi } from "./api";
import type { LoopMessage } from "./eo-code-loop";
import type { Model } from "../store/config";
import type { CacheType } from "../store/config";

export function makeCodeGenerate(
  llm: LLMApi,
  model: Model,
  cache: CacheType,
): (messages: LoopMessage[]) => Promise<string> {
  return (messages: LoopMessage[]) =>
    new Promise<string>((resolve, reject) => {
      llm.chat({
        messages,
        config: { model, cache, stream: false },
        onFinish(message) {
          resolve(message);
        },
        onError(err) {
          reject(err);
        },
      });
    });
}
