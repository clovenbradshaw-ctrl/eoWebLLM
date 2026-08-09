"use client";

require("../polyfill");

import styles from "./home.module.scss";

import log from "loglevel";
import dynamic from "next/dynamic";
import { useState, useEffect, useRef } from "react";
import {
  HashRouter as Router,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import { ServiceWorkerMLCEngine } from "@mlc-ai/web-llm";

import MlcIcon from "../icons/mlc.svg";
import LoadingIcon from "../icons/three-dots.svg";

import Locale from "../locales";
import { getCSSVar, useMobileScreen } from "../utils";
import { DEFAULT_MODELS, Path, SlotID } from "../constant";
import { ErrorBoundary } from "./error";
import { getISOLang, getLang } from "../locales";
import { SideBar } from "./sidebar";
import { useAppConfig } from "../store/config";
import { WebLLMApi } from "../client/webllm";
import { ModelClient, useChatStore } from "../store";
import { useGithubAutoSync } from "../store/sync-effect";
import { MLCLLMContext, WebLLMContext } from "../context";
import { MlcLLMApi } from "../client/mlcllm";

export function Loading(props: { noLogo?: boolean }) {
  return (
    <div className={styles["loading-content"] + " no-dark"}>
      {!props.noLogo && (
        <div className={styles["loading-content-logo"] + " no-dark mlc-icon"}>
          <MlcIcon />
        </div>
      )}
      <LoadingIcon />
    </div>
  );
}

export function ErrorScreen(props: { message: string }) {
  return (
    <div className={styles["error-screen"] + " no-dark"}>
      <p>{props.message}</p>
    </div>
  );
}

const Settings = dynamic(async () => (await import("./settings")).Settings, {
  loading: () => <Loading noLogo />,
});

const Chat = dynamic(async () => (await import("./chat")).Chat, {
  loading: () => <Loading noLogo />,
});

const TemplatePage = dynamic(
  async () => (await import("./template")).TemplatePage,
  {
    loading: () => <Loading noLogo />,
  },
);

export function useSwitchTheme() {
  const config = useAppConfig();

  useEffect(() => {
    document.body.classList.remove("light");
    document.body.classList.remove("dark");

    if (config.theme === "dark") {
      document.body.classList.add("dark");
    } else if (config.theme === "light") {
      document.body.classList.add("light");
    }

    const metaDescriptionDark = document.querySelector(
      'meta[name="theme-color"][media*="dark"]',
    );
    const metaDescriptionLight = document.querySelector(
      'meta[name="theme-color"][media*="light"]',
    );

    if (config.theme === "auto") {
      metaDescriptionDark?.setAttribute("content", "#151515");
      metaDescriptionLight?.setAttribute("content", "#fafafa");
    } else {
      const themeColor = getCSSVar("--theme-color");
      metaDescriptionDark?.setAttribute("content", themeColor);
      metaDescriptionLight?.setAttribute("content", themeColor);
    }
  }, [config.theme]);
}

function useHtmlLang() {
  useEffect(() => {
    const lang = getISOLang();
    const htmlLang = document.documentElement.lang;

    if (lang !== htmlLang) {
      document.documentElement.lang = lang;
    }
  }, []);
}

const useHasHydrated = () => {
  const [hasHydrated, setHasHydrated] = useState<boolean>(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  return hasHydrated;
};

const loadAsyncFonts = () => {
  const linkEl = document.createElement("link");
  linkEl.rel = "stylesheet";
  linkEl.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/fonts/font.css`;
  document.head.appendChild(linkEl);
};

function Screen() {
  const config = useAppConfig();
  const location = useLocation();
  const isHome = location.pathname === Path.Home;
  const isMobileScreen = useMobileScreen();
  const shouldTightBorder = config.tightBorder && !isMobileScreen;

  useEffect(() => {
    loadAsyncFonts();
  }, []);

  return (
    <div
      className={
        styles.container +
        ` ${shouldTightBorder ? styles["tight-container"] : styles.container} ${
          getLang() === "ar" ? styles["rtl-screen"] : ""
        }`
      }
    >
      <>
        <SideBar className={isHome ? styles["sidebar-show"] : ""} />

        <div className={styles["window-content"]} id={SlotID.AppBody}>
          <Routes>
            <Route path={Path.Home} element={<Chat />} />
            <Route path={Path.Templates} element={<TemplatePage />} />
            <Route path={Path.Chat} element={<Chat />} />
            <Route path={Path.Settings} element={<Settings />} />
          </Routes>
        </div>
      </>
    </div>
  );
}

const useWebLLM = () => {
  const config = useAppConfig();
  const [webllm, setWebLLM] = useState<WebLLMApi | undefined>(undefined);
  const [isWebllmActive, setWebllmAlive] = useState(false);
  const webllmRef = useRef<WebLLMApi>();

  // Initialize WebLLM engine
  useEffect(() => {
    let disposed = false;
    // One tab owns one worker. A shared service-worker engine can be interrupted
    // by another tab's abort/reload, which corrupts the exact multi-tab chat
    // isolation this app promises. WebGPU model bytes are still shared by the
    // browser cache; generation state is deliberately tab-local.
    const api = new WebLLMApi("webWorker", config.logLevel);
    webllmRef.current = api;
    setWebLLM(api);
    setWebllmAlive(true);

    return () => {
      disposed = true;
      if (webllmRef.current === api) webllmRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (webllm?.webllm.type !== "serviceWorker") return;
    const heartbeat = setInterval(() => {
      if (webllmRef.current?.webllm.type === "serviceWorker") {
        // 10s per heartbeat, dead after 30 seconds of inactivity
        setWebllmAlive(
          webllmRef.current.webllm.engine.missedHeartbeat < 3,
        );
      }
    }, 10_000);
    return () => clearInterval(heartbeat);
  }, [webllm]);

  return { webllm, isWebllmActive };
};

const useMlcLLM = () => {
  const config = useAppConfig();
  const [mlcllm, setMlcLlm] = useState<MlcLLMApi | undefined>(undefined);

  useEffect(() => {
    setMlcLlm(new MlcLLMApi(config.modelConfig.mlc_endpoint));
  }, [config.modelConfig.mlc_endpoint, setMlcLlm]);

  return mlcllm;
};

const useLoadUrlParam = () => {
  const config = useAppConfig();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let modelConfig: any = {
      model: params.get("model"),
      temperature: params.has("temperature")
        ? parseFloat(params.get("temperature")!)
        : null,
      top_p: params.has("top_p") ? parseFloat(params.get("top_p")!) : null,
      max_tokens: params.has("max_tokens")
        ? parseInt(params.get("max_tokens")!)
        : null,
      presence_penalty: params.has("presence_penalty")
        ? parseFloat(params.get("presence_penalty")!)
        : null,
      frequency_penalty: params.has("frequency_penalty")
        ? parseFloat(params.get("frequency_penalty")!)
        : null,
    };
    Object.keys(modelConfig).forEach((key) => {
      // If the value of the key is null, delete the key
      if (modelConfig[key] === null) {
        delete modelConfig[key];
      }
    });
    if (Object.keys(modelConfig).length > 0) {
      log.info("Loaded model config from URL params", modelConfig);
      config.updateModelConfig(modelConfig);
    }
  }, []);
};

const useStopStreamingMessages = () => {
  const chatStore = useChatStore();

  // Clean up bad chat messages due to refresh during generating
  useEffect(() => {
    chatStore.stopStreaming();
  }, []);
};

const useLogLevel = (webllm?: WebLLMApi) => {
  const config = useAppConfig();

  // Update log level once app config loads
  useEffect(() => {
    log.setLevel(config.logLevel);
    if (webllm?.webllm?.engine) {
      webllm.webllm.engine.setLogLevel(config.logLevel);
    }
  }, [config.logLevel, webllm?.webllm?.engine]);
};

const useModels = (mlcllm: MlcLLMApi | undefined) => {
  const config = useAppConfig();

  useEffect(() => {
    if (config.modelClientType == ModelClient.WEBLLM) {
      config.setModels(DEFAULT_MODELS);
    } else if (config.modelClientType == ModelClient.MLCLLM_API) {
      if (mlcllm) {
        mlcllm.models().then((models) => {
          config.setModels(models);
        });
      }
    }
  }, [config.modelClientType, mlcllm]);
};

// Start the selected in-browser model as soon as the engine is available.
// Chat remains usable while this runs, but the usual first-turn download wait
// is moved to app startup and its progress is shown in the existing session UI.
const usePreloadModel = (webllm: WebLLMApi | undefined, active: boolean) => {
  const config = useAppConfig();
  const chatStore = useChatStore();
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    if (!webllm || !active || config.modelClientType !== ModelClient.WEBLLM)
      return;
    const model = config.modelConfig.model;
    if (attempted.current.has(model)) return;
    attempted.current.add(model);
    let cancelled = false;

    chatStore.updateCurrentSession((session) => {
      session.modelLoadProgress = { progress: 0, text: `Preparing ${model}` };
    });
    webllm
      .preload(
        {
          ...config.modelConfig,
          cache: config.cacheType,
          enable_thinking: config.enableThinking,
        },
        (progress, text) => {
          if (cancelled) return;
          chatStore.updateCurrentSession((session) => {
            session.modelLoadProgress = { progress, text };
          });
        },
      )
      .then(() => {
        if (cancelled) return;
        chatStore.updateCurrentSession((session) => {
          session.modelLoadProgress = null;
        });
        chatStore.pushEoLog("task", `model: ${model} ready before first turn`);
      })
      .catch((err) => {
        if (cancelled) return;
        chatStore.updateCurrentSession((session) => {
          session.modelLoadProgress = null;
        });
        chatStore.pushEoLog(
          "error",
          `model preload failed — ${(err as Error).message}`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    webllm,
    active,
    config.modelClientType,
    config.modelConfig,
    config.cacheType,
    config.enableThinking,
  ]);
};

export function Home() {
  const hasHydrated = useHasHydrated();
  const { webllm, isWebllmActive } = useWebLLM();
  const mlcllm = useMlcLLM();

  useSwitchTheme();
  useHtmlLang();
  useLoadUrlParam();
  useStopStreamingMessages();
  useModels(mlcllm);
  usePreloadModel(webllm, isWebllmActive);
  useLogLevel(webllm);
  useGithubAutoSync();

  if (!hasHydrated || !webllm || !isWebllmActive) {
    return <Loading />;
  }

  if (!isWebllmActive) {
    return <ErrorScreen message={Locale.ServiceWorker.Error} />;
  }

  return (
    <ErrorBoundary>
      <Router>
        <WebLLMContext.Provider value={webllm}>
          <MLCLLMContext.Provider value={mlcllm}>
            <Screen />
          </MLCLLMContext.Provider>
        </WebLLMContext.Provider>
      </Router>
    </ErrorBoundary>
  );
}
