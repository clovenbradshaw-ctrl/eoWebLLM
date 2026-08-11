declare module "*.jpg";
declare module "*.png";
declare module "*.woff2";
declare module "*.woff";
declare module "*.ttf";
declare module "*.scss" {
  const content: Record<string, string>;
  export default content;
}

declare module "*.svg";

// pdfjs-dist ships full types only under its legacy/ build path (which pulls
// in Node-oriented canvas/path2d-polyfill deps this browser-only app doesn't
// want — see next.config.mjs's `canvas: false` fallback and
// app/client/eo-file-extract.ts's own header). The plain build/ path used
// there has no .d.ts; its actual shape is the same public API, just
// untyped here.
declare module "pdfjs-dist/build/pdf";

// kokoro-js is loaded at runtime from a CDN (see app/worker/tts-worker.ts),
// not installed as a dependency — this satisfies the `import type`/
// `typeof import(...)` uses there for compile-time checking only, with the
// minimal shape tts-worker.ts actually references; erased before runtime.
declare module "kokoro-js" {
  export interface GenerateOptions {
    voice?: string;
    [key: string]: unknown;
  }
  export class KokoroTTS {
    static from_pretrained(
      modelId: string,
      options?: unknown,
    ): Promise<KokoroTTS>;
    generate(text: string, options?: GenerateOptions): Promise<unknown>;
    stream(
      text: string,
      options?: GenerateOptions,
    ): AsyncGenerator<{
      text: string;
      audio: { audio: Float32Array; sampling_rate: number };
    }>;
  }
}
