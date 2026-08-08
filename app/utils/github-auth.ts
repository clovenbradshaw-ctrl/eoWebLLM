import {
  GITHUB_ACCESS_TOKEN_RELAY_URL,
  GITHUB_APP_CLIENT_ID,
  GITHUB_DEVICE_CODE_RELAY_URL,
} from "../constant";

export interface DeviceFlowStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export class DeviceFlowError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  const res = await fetch(GITHUB_DEVICE_CODE_RELAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ client_id: GITHUB_APP_CLIENT_ID }),
  });
  if (!res.ok) {
    throw new Error(`device code request failed: ${res.status}`);
  }
  const data = await res.json();
  if (!data.device_code) {
    throw new DeviceFlowError(data.error ?? "unknown_error");
  }
  return data as DeviceFlowStart;
}

async function requestToken(deviceCode: string): Promise<string | null> {
  const res = await fetch(GITHUB_ACCESS_TOKEN_RELAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_APP_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`access token request failed: ${res.status}`);
  }
  const data = await res.json();
  if (data.access_token) {
    return data.access_token as string;
  }
  if (data.error === "authorization_pending") {
    return null;
  }
  throw new DeviceFlowError(data.error ?? "unknown_error");
}

// Polls until the user approves on github.com, or a terminal error/cancel.
// Resolves with the access token, or rejects with a DeviceFlowError.
export function pollForToken(
  start: DeviceFlowStart,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let interval = Math.max(start.interval, 5) * 1000;
    const deadline = Date.now() + start.expires_in * 1000;

    const tick = async () => {
      if (signal.aborted) {
        reject(new DeviceFlowError("cancelled"));
        return;
      }
      if (Date.now() > deadline) {
        reject(new DeviceFlowError("expired_token"));
        return;
      }
      try {
        const token = await requestToken(start.device_code);
        if (token) {
          resolve(token);
          return;
        }
      } catch (err) {
        if (err instanceof DeviceFlowError && err.code === "slow_down") {
          interval += 5000;
        } else {
          reject(err);
          return;
        }
      }
      setTimeout(tick, interval);
    };

    setTimeout(tick, interval);
  });
}
