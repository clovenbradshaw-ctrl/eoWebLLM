// coding.ts — coding-mode workspace metadata, persisted the same way
// chat.ts/config.ts are (Zustand + createPersistStore, localStorage-backed).
//
// Deliberately holds ONLY metadata (id, name, seed repo URL, timestamps) —
// file bytes live in lightning-fs/IndexedDB (eo-code-workspace.ts), never in
// this persisted JSON blob, matching eo-corpus.ts's existing "large content
// stays out of Zustand's persisted state" rule stated in that file's header.

import { nanoid } from "nanoid";
import { StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";

export interface CodingWorkspaceMeta {
  id: string;
  name: string;
  seedRepoUrl: string | null;
  createdAt: number;
  lastOpenedAt: number;
}

const DEFAULT_STATE = {
  workspaces: [] as CodingWorkspaceMeta[],
  currentWorkspaceId: null as string | null,
};

export const useCodingStore = createPersistStore(
  DEFAULT_STATE,
  (set, get) => ({
    createWorkspace(name: string, seedRepoUrl: string | null = null) {
      const meta: CodingWorkspaceMeta = {
        id: nanoid(),
        name: name.trim() || "untitled workspace",
        seedRepoUrl,
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      };
      set({
        workspaces: [...get().workspaces, meta],
        currentWorkspaceId: meta.id,
      });
      return meta;
    },
    openWorkspace(id: string) {
      set({ currentWorkspaceId: id });
      const workspaces = get().workspaces.map((w) =>
        w.id === id ? { ...w, lastOpenedAt: Date.now() } : w,
      );
      set({ workspaces });
    },
    removeWorkspace(id: string) {
      const workspaces = get().workspaces.filter((w) => w.id !== id);
      const currentWorkspaceId =
        get().currentWorkspaceId === id ? null : get().currentWorkspaceId;
      set({ workspaces, currentWorkspaceId });
    },
  }),
  {
    name: StoreKey.Coding,
    version: 1,
  },
);
