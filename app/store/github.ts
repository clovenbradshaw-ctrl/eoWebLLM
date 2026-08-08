import { StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";

export type GithubSyncStatus = "idle" | "syncing" | "error";

const DEFAULT_GITHUB_SYNC_STATE = {
  accessToken: "",
  owner: "",
  repo: "",
  path: "history.json",
  lastSyncedSha: "",
  lastSyncTime: 0,
  syncStatus: "idle" as GithubSyncStatus,
  lastError: "",
};

export const useGithubSyncStore = createPersistStore(
  DEFAULT_GITHUB_SYNC_STATE,
  (set, get) => ({
    isConnected() {
      return !!get().accessToken;
    },

    isConfigured() {
      return !!(get().accessToken && get().owner && get().repo);
    },

    setToken(accessToken: string) {
      set({ accessToken });
    },

    disconnect() {
      set({
        accessToken: "",
        lastSyncedSha: "",
        lastSyncTime: 0,
        syncStatus: "idle",
        lastError: "",
      });
    },

    setRepo(owner: string, repo: string) {
      set({ owner, repo, lastSyncedSha: "" });
    },

    setSyncing() {
      set({ syncStatus: "syncing" });
    },

    setSynced(sha: string) {
      set({
        syncStatus: "idle",
        lastSyncedSha: sha,
        lastSyncTime: Date.now(),
        lastError: "",
      });
    },

    setSyncError(message: string) {
      set({ syncStatus: "error", lastError: message });
    },
  }),
  {
    name: StoreKey.GithubSync,
    version: 0.1,
  },
);
