import withSerwistInit from "@serwist/next";

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

const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline';
    worker-src 'self';
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
  webpack(config, { isServer }) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });

    config.resolve.fallback = {
      child_process: false,
    };

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback, // if you miss it, all the other options in fallback, specified
        // by next.js will be dropped. Doesn't make much sense, but how it is
        fs: false, // the solution
        module: false,
        perf_hooks: false,
      };
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
  // Auto-register throws unhandled (e.g. storage-restricted contexts: private
  // browsing, sandboxed iframes) and Next's dev overlay then blocks the whole
  // UI on a feature (offline caching) nothing else here depends on. Registered
  // manually below with a caught, logged-only failure instead.
  register: false,
})(nextConfig);
