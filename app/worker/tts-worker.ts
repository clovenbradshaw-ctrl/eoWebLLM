// Web Worker: owns the KokoroTTS model instance and streams synthesized
// audio back to the main thread so ONNX inference never blocks the UI.
//
// kokoro-js's ONNX backend (onnxruntime-web) has an open, unresolved
// bundler-compatibility bug with webpack (microsoft/onnxruntime#22615,
// hexgrad/kokoro#100): it fails to parse a WebGPU backend file that uses
// import.meta and spins up its own nested worker for threaded WASM, neither
// of which webpack's static bundling handles. Loading it as a genuine
// runtime ESM import from esm.sh — not a webpack-bundled module — sidesteps
// the bug entirely: the browser's native module loader runs it the way it
// was actually built to run. See next.config.mjs for the matching CSP
// allowance. The `kokoro-js` import below is `import type` only (erased at
// compile time) so TypeScript can still type-check against it.
import type { KokoroTTS as KokoroTTSType, GenerateOptions } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_CDN_URL = "https://esm.sh/kokoro-js@1.2.1";

export type TTSWorkerRequest =
  | { type: "load" }
  | { type: "speak"; id: string; text: string; voice: string }
  | { type: "cancel"; id: string };

export type TTSWorkerResponse =
  | { type: "load-progress"; progress: unknown }
  | { type: "ready" }
  | { type: "load-error"; error: string }
  | {
      type: "chunk";
      id: string;
      seq: number;
      audio: Float32Array;
      samplingRate: number;
      text: string;
    }
  | { type: "done"; id: string }
  | { type: "error"; id: string; error: string };

let ttsPromise: Promise<KokoroTTSType> | null = null;
let activeId: string | null = null;
const cancelledIds = new Set<string>();

function post(msg: TTSWorkerResponse, transfer?: Transferable[]) {
  // @ts-expect-error postMessage transfer overload
  self.postMessage(msg, transfer);
}

function loadModel(): Promise<KokoroTTSType> {
  if (!ttsPromise) {
    ttsPromise = (
      import(/* webpackIgnore: true */ KOKORO_CDN_URL) as Promise<{
        KokoroTTS: typeof import("kokoro-js").KokoroTTS;
      }>
    )
      .then(({ KokoroTTS }) =>
        KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: "q8",
          device: "wasm",
          progress_callback: (progress: unknown) => {
            post({ type: "load-progress", progress });
          },
        }),
      )
      .then((tts) => {
        post({ type: "ready" });
        return tts;
      })
      .catch((err) => {
        ttsPromise = null;
        post({
          type: "load-error",
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      });
  }
  return ttsPromise;
}

async function speak(id: string, text: string, voice: string) {
  activeId = id;
  cancelledIds.delete(id);
  try {
    const tts = await loadModel();
    if (cancelledIds.has(id)) return;

    let seq = 0;
    for await (const { text: sentenceText, audio } of tts.stream(text, {
      voice: voice as GenerateOptions["voice"],
    })) {
      if (cancelledIds.has(id)) return;
      const samples = audio.audio;
      post(
        {
          type: "chunk",
          id,
          seq: seq++,
          audio: samples,
          samplingRate: audio.sampling_rate,
          text: sentenceText,
        },
        [samples.buffer],
      );
    }
    if (!cancelledIds.has(id)) post({ type: "done", id });
  } catch (err) {
    if (!cancelledIds.has(id)) {
      post({
        type: "error",
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    cancelledIds.delete(id);
    if (activeId === id) activeId = null;
  }
}

self.onmessage = (event: MessageEvent<TTSWorkerRequest>) => {
  const msg = event.data;
  switch (msg.type) {
    case "load":
      loadModel().catch(() => {});
      break;
    case "speak":
      if (activeId && activeId !== msg.id) cancelledIds.add(activeId);
      void speak(msg.id, msg.text, msg.voice);
      break;
    case "cancel":
      cancelledIds.add(msg.id);
      break;
  }
};
