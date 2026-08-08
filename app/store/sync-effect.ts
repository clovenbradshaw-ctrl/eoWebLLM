import { useEffect } from "react";
import { useChatStore } from "./chat";
import { useGithubSyncStore } from "./github";
import { pushHistory } from "../utils/github-sync";

const SYNC_DEBOUNCE_MS = 5000;

// Debounced background push of chat history to GitHub whenever sessions
// change, only while a repo is connected and configured (see settings.tsx).
export function useGithubAutoSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let syncing = false;
    let pending = false;

    const runSync = () => {
      if (syncing) {
        pending = true;
        return;
      }
      if (!useGithubSyncStore.getState().isConfigured()) return;
      syncing = true;
      pending = false;
      pushHistory(useChatStore.getState().sessions).finally(() => {
        syncing = false;
        if (pending) runSync();
      });
    };

    const unsubscribe = useChatStore.subscribe((state) => {
      void state.sessions;
      if (timer) clearTimeout(timer);
      timer = setTimeout(runSync, SYNC_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
