// Read-aloud button. Wraps the TTS pipeline (app/client/tts.ts +
// app/store/tts.ts) so any surface that wants spoken text — a chat message,
// an uploaded source, anything — can mount one without duplicating the
// play/stop/load plumbing. `getText` may resolve asynchronously (sources
// read their bytes back out of OPFS on first click), so the button owns the
// fetching state too.
import { useEffect, useState } from "react";
import SpeakerIcon from "../icons/speaker.svg";
import StopIcon from "../icons/pause.svg";
import { useTTSStore } from "../store/tts";
import { showToast } from "./ui-lib";
import { sourceSpeechText } from "../utils/tts-text";
import type { EoSource } from "../client/eo-corpus";

// Every mounted read-aloud surface subscribes to the same error slot, so a
// single pipeline failure would otherwise toast once per mounted button.
// Remember the last error we surfaced and only toast on a change.
let lastTTSErrorShown: string | null = null;
export function showTTSError(error: string) {
  if (error === lastTTSErrorShown) return;
  lastTTSErrorShown = error;
  showToast(`Read aloud failed: ${error}`);
}

export function SourceReadAloudButton(props: {
  source: EoSource;
  title?: string;
  className?: string;
  label?: string;
}) {
  const { source } = props;
  return (
    <ReadAloudButton
      id={`src:${source.id}`}
      getText={() => sourceSpeechText(source)}
      title={props.title ?? `Read "${source.name}" aloud`}
      className={props.className}
      label={props.label}
    />
  );
}

export function ReadAloudButton(props: {
  id: string;
  getText: () => string | Promise<string>;
  title?: string;
  className?: string;
  label?: string;
}) {
  const playingId = useTTSStore((s) => s.playingMessageId);
  const error = useTTSStore((s) => s.error);
  const speak = useTTSStore((s) => s.speak);
  const stop = useTTSStore((s) => s.stop);
  const [fetching, setFetching] = useState(false);

  const isPlaying = playingId === props.id;

  useEffect(() => {
    if (error) showTTSError(error);
  }, [error]);

  async function onClick() {
    if (isPlaying) {
      stop();
      return;
    }
    setFetching(true);
    try {
      const text = await props.getText();
      if (!text || !text.trim()) {
        showToast("Nothing to read aloud");
        return;
      }
      speak(props.id, text);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }

  const label = props.label;

  return (
    <button
      type="button"
      className={props.className}
      title={
        props.title ?? (isPlaying ? "Stop reading aloud" : "Read this aloud")
      }
      disabled={fetching}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      {fetching ? "…" : isPlaying ? <StopIcon /> : <SpeakerIcon />}
      {label && <span className="read-aloud-label">{label}</span>}
    </button>
  );
}
