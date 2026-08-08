import { ChatSession } from "../store/chat";
import { useGithubSyncStore } from "../store/github";

const GITHUB_API = "https://api.github.com";
const MAX_CONFLICT_RETRIES = 3;

function toBase64Utf8(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

async function fetchCurrentSha(
  owner: string,
  repo: string,
  path: string,
  token: string,
): Promise<string | null> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`failed to read ${path}: ${res.status}`);
  }
  const data = await res.json();
  return data.sha as string;
}

async function putContents(
  owner: string,
  repo: string,
  path: string,
  token: string,
  content: string,
  sha: string | null,
): Promise<{ ok: true; sha: string } | { ok: false; conflict: boolean }> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "eoWebLLM: sync chat history",
        content: toBase64Utf8(content),
        ...(sha ? { sha } : {}),
      }),
    },
  );
  if (res.status === 409) {
    return { ok: false, conflict: true };
  }
  if (!res.ok) {
    return { ok: false, conflict: false };
  }
  const data = await res.json();
  return { ok: true, sha: data.content.sha as string };
}

export async function pushHistory(sessions: ChatSession[]): Promise<void> {
  const github = useGithubSyncStore.getState();
  if (!github.isConfigured()) return;

  const { owner, repo, path, accessToken } = github;
  const content = JSON.stringify(sessions);

  github.setSyncing();

  let sha = github.lastSyncedSha || null;
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt += 1) {
    try {
      if (!sha) {
        sha = await fetchCurrentSha(owner, repo, path, accessToken);
      }
      const result = await putContents(
        owner,
        repo,
        path,
        accessToken,
        content,
        sha,
      );
      if (result.ok) {
        github.setSynced(result.sha);
        return;
      }
      if (result.conflict) {
        // stale sha: refetch and retry
        sha = null;
        continue;
      }
      github.setSyncError(`GitHub write failed`);
      return;
    } catch (err) {
      github.setSyncError(err instanceof Error ? err.message : String(err));
      return;
    }
  }
  github.setSyncError("GitHub write failed after repeated conflicts");
}
