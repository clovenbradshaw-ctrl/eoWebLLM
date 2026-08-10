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
