// Main-thread controller for read-aloud playback. Owns the TTS worker and
// a Web Audio scheduling queue so sentence N+1 can keep decoding while
// sentence N is still playing.
import type { TTSWorkerRequest, TTSWorkerResponse } from "../worker/tts-worker";

export type TTSStatus = "idle" | "loading" | "playing" | "error";

export interface TTSHandlers {
  onStatusChange?: (status: TTSStatus, messageId: string | null) => void;
  onError?: (error: string) => void;
}

const DEFAULT_VOICE = "af_heart";
// First chunk needs a small lead-in so `start()` never targets a time
// that has already passed by the time the buffer is scheduled.
const SCHEDULING_LEAD_SECONDS = 0.05;

class TTSController {
  private worker: Worker | null = null;
  private audioCtx: AudioContext | null = null;
  private nextStartTime = 0;
  private currentId: string | null = null;
  private pendingSources: AudioBufferSourceNode[] = [];
  private streamEnded = false;
  private handlers: TTSHandlers = {};

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL("../worker/tts-worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (event: MessageEvent<TTSWorkerResponse>) =>
        this.handleMessage(event.data);
    }
    return this.worker;
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    if (this.audioCtx.state === "suspended") {
      void this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  private handleMessage(msg: TTSWorkerResponse) {
    switch (msg.type) {
      case "load-error":
        this.handlers.onError?.(msg.error);
        this.stop();
        break;
      case "chunk":
        if (msg.id !== this.currentId) return;
        this.scheduleChunk(msg.audio, msg.samplingRate);
        this.setStatus("playing");
        break;
      case "done":
        if (msg.id !== this.currentId) return;
        this.streamEnded = true;
        this.maybeFinish();
        break;
      case "error":
        if (msg.id !== this.currentId) return;
        this.handlers.onError?.(msg.error);
        this.stop();
        break;
    }
  }

  private scheduleChunk(audio: Float32Array, samplingRate: number) {
    const ctx = this.ensureAudioContext();
    const buffer = ctx.createBuffer(1, audio.length, samplingRate);
    // The transferred buffer is always a plain ArrayBuffer (never shared),
    // but TS's typed-array generics can't know that across a worker boundary.
    buffer.copyToChannel(audio as Float32Array<ArrayBuffer>, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(
      this.nextStartTime,
      ctx.currentTime + SCHEDULING_LEAD_SECONDS,
    );
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.pendingSources.push(source);
    source.onended = () => {
      this.pendingSources = this.pendingSources.filter((s) => s !== source);
      this.maybeFinish();
    };
  }

  private maybeFinish() {
    if (this.streamEnded && this.pendingSources.length === 0) {
      const finishedId = this.currentId;
      this.currentId = null;
      this.setStatus("idle", finishedId);
    }
  }

  private setStatus(
    status: TTSStatus,
    messageId: string | null = this.currentId,
  ) {
    this.handlers.onStatusChange?.(status, messageId);
  }

  /** Synthesize and play `text` for message `id`, replacing any current playback. */
  speak(
    id: string,
    text: string,
    opts: { voice?: string; handlers?: TTSHandlers } = {},
  ) {
    this.stop();
    this.handlers = opts.handlers ?? {};
    this.currentId = id;
    this.streamEnded = false;
    this.nextStartTime = 0;
    this.setStatus("loading", id);
    this.ensureAudioContext();

    const req: TTSWorkerRequest = {
      type: "speak",
      id,
      text,
      voice: opts.voice ?? DEFAULT_VOICE,
    };
    this.ensureWorker().postMessage(req);
  }

  /** Stop any in-flight synthesis and playback. */
  stop() {
    if (this.currentId) {
      const req: TTSWorkerRequest = { type: "cancel", id: this.currentId };
      this.worker?.postMessage(req);
    }
    for (const source of this.pendingSources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped/ended
      }
    }
    this.pendingSources = [];
    this.nextStartTime = 0;
    this.streamEnded = false;

    const wasPlayingId = this.currentId;
    this.currentId = null;
    if (wasPlayingId) this.setStatus("idle", wasPlayingId);
  }

  get playingId(): string | null {
    return this.currentId;
  }
}

export const ttsController = new TTSController();
