/* eslint-disable @next/next/no-page-custom-font */
import localFont from "next/font/local";
import "./styles/globals.scss";
import "./styles/markdown.scss";
import "./styles/highlight.scss";
import { getClientConfig } from "./config/client";
import { type Metadata } from "next";

// Self-hosted type, same origin as the app (CSP font-src 'self').
// Instrument Sans is a variable font (400–700) loaded in one normal + one
// italic file; IBM Plex Mono is the fixed-pitch companion for code.
const instrument = localFont({
  src: [
    {
      path: "./fonts/instrument-sans-latin.woff2",
      weight: "400 700",
      style: "normal",
    },
    {
      path: "./fonts/instrument-sans-latin-italic.woff2",
      weight: "400 700",
      style: "italic",
    },
  ],
  variable: "--font-instrument",
  display: "swap",
});

const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400-latin.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-500-latin.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-mono-600-latin.woff2", weight: "600" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://clovenbradshaw-ctrl.github.io/eoWebLLM/"),
  title: "Elinor",
  description:
    "Chat with AI large language models running natively in your browser, gated by a surf/fold instruction set. Private, server-free, bounded-context AI conversations.",
  keywords: [
    "eoWebLLM",
    "WebLLM",
    "AI chat",
    "machine learning",
    "browser AI",
    "language model",
    "no server",
  ],
  authors: [{ name: "eoWebLLM" }],
  publisher: "eoWebLLM",
  creator: "eoWebLLM",
  robots: "index, follow",
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
  },
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#151515" },
  ],
  appleWebApp: {
    title: "eoWebLLM",
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    url: "https://clovenbradshaw-ctrl.github.io/eoWebLLM/",
    title: "eoWebLLM",
    description:
      "Chat with AI large language models running natively in your browser, gated by a surf/fold instruction set",
    siteName: "eoWebLLM",
    images: [
      {
        url: "https://clovenbradshaw-ctrl.github.io/eoWebLLM/favicon-32x32.png",
        width: 32,
        height: 32,
        alt: "eoWebLLM - Browser-based AI conversation",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "eoWebLLM",
    description:
      "Chat with AI large language models running natively in your browser, gated by a surf/fold instruction set",
    images: [
      "https://clovenbradshaw-ctrl.github.io/eoWebLLM/favicon-32x32.png",
    ],
  },
  alternates: {
    canonical: "https://clovenbradshaw-ctrl.github.io/eoWebLLM/",
  },
};

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return (
    <html lang="en">
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content={cspHeader.replace(/\n/g, "")}
        />
        <meta name="config" content={JSON.stringify(getClientConfig())} />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href={`${basePath}/apple-touch-icon.png`}
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href={`${basePath}/favicon-32x32.png`}
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href={`${basePath}/favicon-16x16.png`}
        />
        <link rel="manifest" href={`${basePath}/site.webmanifest`} />
        <link
          rel="mask-icon"
          href={`${basePath}/safari-pinned-tab.svg`}
          color="#062578"
        />
        <meta name="msapplication-TileColor" content="#2b5797" />
        <meta name="theme-color" content="#ffffff" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "eoWebLLM",
              url: "https://clovenbradshaw-ctrl.github.io/eoWebLLM/",
              description:
                "Chat with AI large language models running natively in your browser, gated by a surf/fold instruction set. Private, server-free, bounded-context AI conversations.",
              applicationCategory: "Artificial Intelligence",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              operatingSystem: "Web Browser",
              creator: {
                "@type": "Organization",
                name: "WebLLM",
              },
            }),
          }}
        />
      </head>
      <body className={`${instrument.variable} ${plexMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
