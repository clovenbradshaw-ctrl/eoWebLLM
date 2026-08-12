// engine.ts — the WebLLM engine as a module-level singleton instead of
// component-local state, so a second top-level route (app/coding/page.tsx)
// can reuse the already-loaded model instead of re-downloading/re-compiling
// weights on every navigation.
//
// Previously this lived entirely inside home.tsx's `useWebLLM` hook as
// `useState`, provided only to `Home`'s own subtree via `WebLLMContext`
// (app/context.ts) — fine when this was the only route in the app, wrong
// once a second route exists, since React state dies when its component
// unmounts on navigation. A plain (non-persisted — an engine instance isn't
// serializable, doesn't need to survive a reload) Zustand store lives
// outside any one route's component tree, so both `/` and `/coding` read
// the same instance. `ensureWebLLMInit` is idempotent (guarded by
// `initStarted`) so calling it from both routes' mount effects is safe —
// only the first caller actually starts initialization.
//
// `WebLLMContext` (app/context.ts) is unchanged and still how chat.tsx
// consumes the engine — home.tsx now just feeds it from this store instead
// of local state.

import { LogLevel, ServiceWorkerMLCEngine } from "@mlc-ai/web-llm";
import log from "loglevel";
import { create } from "zustand";
import { WebLLMApi } from "../client/webllm";

interface EngineState {
  webllm: WebLLMApi | undefined;
  isWebllmActive: boolean;
  setWebllm: (webllm: WebLLMApi, active: boolean) => void;
  setActive: (active: boolean) => void;
}

export const useEngineStore = create<EngineState>((set) => ({
  webllm: undefined,
  isWebllmActive: false,
  setWebllm: (webllm, active) => set({ webllm, isWebllmActive: active }),
  setActive: (active) => set({ isWebllmActive: active }),
}));

let initStarted = false;
let fallbackTimeout: ReturnType<typeof setTimeout> | undefined;
let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

/**
 * Starts WebLLM engine detection/initialization exactly once per page load,
 * regardless of how many mounted routes call it. Ported unchanged from
 * home.tsx's former useWebLLM effects (service worker registration, a 2s
 * fallback to a web worker if the service worker never reports readiness,
 * WebGPU-in-service-worker probing, and a 10s heartbeat once a service
 * worker engine is live) — only the "where does this state live" part
 * changed.
 */
export function ensureWebLLMInit(logLevel: LogLevel): void {
  if (initStarted) return;
  initStarted = true;

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      log.info("Service Worker registration failed, using web worker.", err);
    });
  }

  fallbackTimeout = setTimeout(() => {
    const { webllm, isWebllmActive } = useEngineStore.getState();
    if (!webllm && !isWebllmActive) {
      log.info(
        "Service Worker activation is timed out. Falling back to use web worker.",
      );
      useEngineStore
        .getState()
        .setWebllm(new WebLLMApi("webWorker", logLevel), true);
    }
  }, 2_000);

  if ("serviceWorker" in navigator) {
    log.info("Service Worker API is available and in use.");
    navigator.serviceWorker.ready.then(() => {
      log.info("Service Worker is activated.");
      const request = {
        kind: "checkWebGPUAvilability",
        uuid: crypto.randomUUID(),
        content: "",
      };

      const sendEventInterval = setInterval(() => {
        navigator.serviceWorker.controller?.postMessage(request);
      }, 200);

      const webGPUCheckCallback = (event: MessageEvent) => {
        const message = event.data;
        if (message.kind === "return" && message.uuid === request.uuid) {
          const isWebGPUAvailable = message.content;
          log.info(
            isWebGPUAvailable
              ? "Service Worker has WebGPU Available."
              : "Service Worker does not have available WebGPU.",
          );
          const { webllm, isWebllmActive } = useEngineStore.getState();
          if (!webllm && !isWebllmActive) {
            const engine = new WebLLMApi(
              isWebGPUAvailable ? "serviceWorker" : "webWorker",
              logLevel,
            );
            useEngineStore.getState().setWebllm(engine, true);
            clearTimeout(fallbackTimeout);

            if (engine.webllm.type === "serviceWorker") {
              heartbeatInterval = setInterval(() => {
                const current = useEngineStore.getState().webllm;
                if (!current) return;
                useEngineStore
                  .getState()
                  .setActive(
                    !!current.webllm.engine &&
                      (current.webllm.engine as ServiceWorkerMLCEngine)
                        .missedHeartbeat < 3,
                  );
              }, 10_000);
            }
          }
          navigator.serviceWorker.removeEventListener(
            "message",
            webGPUCheckCallback,
          );
          clearInterval(sendEventInterval);
        }
      };
      navigator.serviceWorker.addEventListener("message", webGPUCheckCallback);
    });
  } else {
    log.info(
      "Service Worker API is unavailable. Falling back to use web worker.",
    );
    useEngineStore
      .getState()
      .setWebllm(new WebLLMApi("webWorker", logLevel), true);
    clearTimeout(fallbackTimeout);
  }
}
