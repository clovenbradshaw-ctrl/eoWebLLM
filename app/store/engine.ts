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

// ---- shared engine single-flight coordination ----
//
// Both `/` (chat.ts's turn dispatch and background tail) and `/coding`
// (eo-code-generate.ts's tool-loop) dispatch real llm.chat() calls against
// the one WebLLMApi instance this store owns (see the file header above).
// That engine is single-flight -- only one generation may run at a time --
// so this pair of plain module-level variables, and the functions below
// that read and mutate them, are the one shared "is the engine busy" signal
// both routes coordinate through. This deliberately knows nothing about
// turns, tails, or folds -- those are chat.ts's own concepts (its own
// eoTurnTailPromise/eoFoldInFlight, layered on top of this). This only ever
// answers the one question every caller of llm.chat() needs answered
// first: is anyone else using the engine right now. WebLLMApi.chat() itself
// (app/client/webllm.ts) also queues internally as a backstop for any
// caller that skips this -- this is the coordination layer that makes
// waiting visible and voluntary instead of relying on that backstop alone.
let engineBusy = false;
let engineFreePromise: Promise<unknown> | null = null;

/** True if some caller currently holds the engine (see markEngineBusy). */
export function isEngineBusy(): boolean {
  return engineBusy;
}

/**
 * The current in-flight caller's own settlement promise, or null if the
 * engine is free. Exposed (rather than only offering waitForEngineFree)
 * for callers that need to re-run their own logic on every wake-up, not
 * just once the engine is finally free -- see chat.ts's two onUserInput
 * wait sites, which reset eoFoldInFlight on each cycle. Always re-read
 * this getter inside a loop rather than caching its result: it can change
 * out from under a waiter the instant the awaited promise settles.
 */
export function engineFreeSignal(): Promise<unknown> | null {
  return engineFreePromise;
}

/**
 * Waits, in a loop, until the engine is actually free. A LOOP, not a
 * one-shot check: engineFreeSignal() can have more than one concurrent
 * awaiter (chat.ts's own wait sites, this function, a coding-route call),
 * and when it resolves, every awaiter's continuation is scheduled at
 * once -- whichever runs first can claim the engine again (markEngineBusy)
 * before the others resume. A one-shot check would let a loser barge in
 * anyway; re-testing the condition on every wake-up is what makes this an
 * actual queue instead of a single wait that only works with one waiter.
 * Does not itself claim the engine -- pair with markEngineBusy() once this
 * resolves.
 */
export async function waitForEngineFree(): Promise<void> {
  while (engineBusy) {
    await engineFreePromise?.catch(() => {});
  }
}

/**
 * Claims the engine for the caller's own use. Call only once the engine is
 * known free (normally right after waitForEngineFree() resolves) -- this
 * does not wait itself. Returns a release() the caller must call exactly
 * once, from every settlement path (success, error, and any timeout the
 * caller imposes on itself) -- see chat.ts's eoRunBackground for why a
 * caller that gives up waiting on its OWN timeout must still not release
 * the engine until the real underlying call actually finishes: the engine
 * is single-flight, and releasing early lets a second real call collide
 * with one that's still actually running underneath. release() is
 * idempotent, safe to call more than once from redundant settlement paths
 * (a timeout racing a real completion).
 */
export function markEngineBusy(): () => void {
  engineBusy = true;
  let resolveFree: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveFree = resolve;
  });
  engineFreePromise = promise;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    engineBusy = false;
    resolveFree?.();
  };
}

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
