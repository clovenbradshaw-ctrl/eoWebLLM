// Converts a message's rendered markdown into plain text worth narrating.
// Kokoro speaks whatever it's given verbatim, so syntax left in (```, **, [], #)
// would otherwise get read aloud character by character.
import type { EoSource } from "../client/eo-corpus";
import { readRawSource } from "../client/eo-corpus";
import { tryExtractText } from "../client/eo-file-extract";

/**
 * The text worth narrating for a source, resolved from its persisted bytes
 * on demand: UTF-8 sources decode straight through; container formats (PDF,
 * DOCX, ...) get re-extracted; anything else falls back to its structural
 * summary. Mirrors the source reader's "Raw" tab, which can only show bytes
 * -- this is the audio-side equivalent of that tab.
 */
export async function sourceSpeechText(source: EoSource): Promise<string> {
  const bytes = await readRawSource(source.id);
  if (source.textReadable) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return toSpeechText(text);
  }
  const extracted = await tryExtractText(bytes, source.name);
  if (extracted && extracted.trim()) return toSpeechText(extracted);
  return source.structureSummary ?? "";
}

export function toSpeechText(markdown: string): string {
  let text = markdown;

  // Fenced code blocks: don't narrate syntax, just note one was here.
  text = text.replace(/```[\s\S]*?```/g, "\nCode block.\n");

  // Inline code: keep the text, drop the backticks.
  text = text.replace(/`([^`\n]+)`/g, "$1");

  // Images: speak the alt text if present, otherwise drop entirely.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt) => alt || "");

  // Links: speak the link text only.
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Headings: read as a plain, pause-worthy sentence.
  text = text.replace(/^#{1,6}\s+(.*)$/gm, (_m, title) => {
    const trimmed = title.trim();
    return /[.!?:]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  });

  // Blockquotes: drop the leading '>' markers.
  text = text.replace(/^\s{0,3}>\s?/gm, "");

  // Horizontal rules: nothing to say.
  text = text.replace(/^\s*([-*_]\s*){3,}$/gm, "");

  // List markers: read items as plain sentences.
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+[.)]\s+/gm, "");

  // Emphasis: keep the wrapped text, drop the markers.
  text = text.replace(/(\*\*\*|___)(.+?)\1/g, "$2");
  text = text.replace(/(\*\*|__)(.+?)\1/g, "$2");
  text = text.replace(/(\*|_)(.+?)\1/g, "$2");

  // Collapse whitespace left behind by the above.
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
