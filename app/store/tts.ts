// Read-aloud playback UI state. Deliberately NOT persisted (unlike the chat
// store): it's transient per-session UI state, and the chat store persists
// its entire tree verbatim to localStorage on every update, so anything
// audio-related has to stay out of it.
import { create } from "zustand";
import { ttsController, type TTSStatus } from "../client/tts";

interface TTSStoreState {
  playingMessageId: string | null;
  status: TTSStatus;
  error: string | null;
  speak: (id: string, text: string) => void;
  stop: () => void;
}

export const useTTSStore = create<TTSStoreState>((set) => ({
  playingMessageId: null,
  status: "idle",
  error: null,
  speak: (id, text) => {
    set({ error: null });
    ttsController.speak(id, text, {
      handlers: {
        onStatusChange: (status, messageId) => {
          set({
            status,
            playingMessageId: status === "idle" ? null : messageId,
          });
        },
        onError: (error) => set({ error }),
      },
    });
  },
  stop: () => ttsController.stop(),
}));
