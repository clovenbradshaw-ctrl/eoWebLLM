import withSerwistInit from "@serwist/next";
import { createRequire } from "module";

// next.config.mjs is loaded as a real ES module, so there is no ambient
// `require` — some environments' Node builds happen to polyfill CJS
// interop for ESM and mask that, others (e.g. this sandboxed preview
// shell) don't, which is exactly the kind of environment-dependent
// breakage `require.resolve(...)` below used to cause. createRequire
// works the same everywhere.
const require = createRequire(import.meta.url);

// Plain `next dev` (the "dev" script) sets no BUILD_MODE and must NOT
// silently become export mode — export mode forces output:'export' and
// basePath:'/eoWebLLM', neither of which next dev's HMR/chunk serving
// handles well, combined with the serwist service worker aggressively
// precaching stale chunk paths across restarts. That combination was the
// actual cause of the recurring ChunkLoadError/hydration-mismatch/404
// cycle seen all session, not a source-code bug. Only "build"/"export"/
// "export:dev" ever set BUILD_MODE explicitly (see package.json); "dev"
// deliberately does not, and defaulting it to "standalone" here — not
// "export" — is what actually makes it a normal, stable local dev server
// with no basePath and no static-export constraints.
const mode = process.env.BUILD_MODE ?? "standalone";
console.log("[Next] build mode", mode);

const disableChunk = !!process.env.DISABLE_CHUNK || mode === "export";
console.log("[Next] build with chunk: ", !disableChunk);

// worker-src needs blob: + esm.sh alongside script-src: app/worker/tts-worker.ts
// loads kokoro-js from esm.sh at runtime and spins up its own nested worker
// for threaded WASM (see that file's header comment) — without both origins
// here that nested worker is CSP-blocked and TTS silently falls back to slow
// single-threaded WASM or fails outright.
const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline' https://esm.sh;
    worker-src 'self' blob: https://esm.sh;
    connect-src 'self' blob: data: https: http:;
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https:;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allows an isolated local test server to avoid replacing the active
  // developer server's chunks in `.next`. Production keeps the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  webpack(config, { isServer, webpack, dev }) {
    if (dev) {
      // The on-disk persistent webpack cache (.next/cache/webpack) has been
      // observed corrupting mid-session during this app's dev server (ENOENT
      // on .next/server/app, unresolvable vendor-chunks/*), forcing a full
      // reload that crashes the page to blank with no recovery — hit
      // repeatedly during long-running e2e chat sessions. Memory-only cache
      // in dev avoids the corruption; build (`next build`) is unaffected.
      config.cache = { type: "memory" };
    }
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });

    config.resolve.fallback = {
      child_process: false,
    };

    // pdfjs-dist (app/client/eo-file-extract.ts) has an optional,
    // conditionally-executed `require("canvas")` for a page-rendering path
    // this app never takes (only getTextContent() is used, for text
    // extraction). `resolve.fallback` only substitutes a module that fails
    // to resolve; `canvas` is an installed package with a compiled native
    // `.node` binary, so it resolves successfully and webpack then chokes
    // trying to parse that binary as a module. `resolve.alias` forces the
    // stub unconditionally, regardless of whether the real package is
    // present. Needed for both the client and server compilation passes:
    // chat.tsx (which imports eo-file-extract.ts) is bundled for SSR too,
    // even though uploadFile only ever runs client-side.
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback, // if you miss it, all the other options in fallback, specified
        // by next.js will be dropped. Doesn't make much sense, but how it is
        fs: false, // the solution
        module: false,
        perf_hooks: false,
        // isomorphic-git (app/client/eo-repo-clone.ts) expects Node's
        // Buffer/events globals to exist — real browser polyfills, not
        // stubbed out to `false` like the Node-only builtins above, since
        // isomorphic-git actually calls into them at runtime.
        buffer: require.resolve("buffer/"),
        events: require.resolve("events/"),
      };
      config.plugins.push(
        new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] }),
      );
    }

    return config;
  },
  output: mode,
  basePath: mode === "export" ? "/eoWebLLM" : undefined,
  assetPrefix: mode === "export" ? "/eoWebLLM/" : undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: mode === "export" ? "/eoWebLLM" : "",
  },
  images: {
    unoptimized: mode === "export",
  },
  experimental: {
    forceSwcTransforms: true,
  },
};

const CorsHeaders = [
  { key: "Access-Control-Allow-Credentials", value: "true" },
  { key: "Access-Control-Allow-Origin", value: "*" },
  {
    key: "Access-Control-Allow-Methods",
    value: "*",
  },
  {
    key: "Access-Control-Allow-Headers",
    value: "*",
  },
  {
    key: "Access-Control-Max-Age",
    value: "86400",
  },
];

if (mode !== "export") {
  nextConfig.headers = async () => {
    return [
      {
        source: "/api/:path*",
        headers: CorsHeaders,
      },
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: cspHeader.replace(/\n/g, ""),
          },
          {
            key: "Content-Security-Policy-Report-Only",
            value: cspHeader.replace(/\n/g, ""),
          },
        ],
      },
    ];
  };
}

export default withSerwistInit({
  swSrc: "app/worker/service-worker.ts",
  swDest: "public/sw.js",
  // The default auto-injected registration calls `.register()` with no
  // `.catch()` -- in storage-partitioned/sandboxed contexts (private
  // browsing, embedded previews) that promise rejects and surfaces as an
  // uncaught rejection with no way to handle it from app code, since it
  // runs before any of our own effects mount. Registering it ourselves in
  // app/components/home.tsx (with a real .catch()) instead.
  register: false,
})(nextConfig);
