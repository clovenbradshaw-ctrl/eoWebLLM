"use client";

import { useEffect } from "react";
import type { Serwist } from "@serwist/window";

declare global {
  interface Window {
    // `@serwist/next/typings` declares this generated global as required.
    // Keeping the same declaration modifier lets TypeScript merge it; the
    // runtime guard below still handles browsers where registration was not
    // injected.
    serwist: Serwist;
  }
}

// register: false in next.config.mjs — auto-register throws unhandled in
// storage-restricted contexts (private browsing, sandboxed iframes), and
// Next's dev overlay then blocks the whole UI on a feature (offline
// caching) nothing else here depends on. A failed registration here just
// means no offline cache; the chat itself doesn't need it.
export default function RegisterPWA() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.serwist !== undefined) {
      window.serwist.register().catch((err) => {
        console.warn("[PWA] service worker registration skipped:", err);
      });
    }
  }, []);
  return null;
}
