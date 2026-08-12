import { useEffect, useMemo } from "react";

import styles from "./home.module.scss";

import { IconButton } from "./button";
import {
  CaretLeft,
  CaretRight,
  Chats,
  CircleHalf,
  GearSix,
  GithubLogo,
  GlobeSimple,
  Moon,
  Plus,
  Sun,
  Trash,
} from "@phosphor-icons/react";

import Locale from "../locales";

import { Theme, useAppConfig, useChatStore } from "../store";

import {
  DEFAULT_SIDEBAR_WIDTH,
  NARROW_SIDEBAR_WIDTH,
  Path,
  REPO_URL,
  WEBLLM_HOME_URL,
} from "../constant";

import { Link, useNavigate } from "react-router-dom";
import { isIOS, useMobileScreen } from "../utils";
import dynamic from "next/dynamic";
import { showConfirm, showToast } from "./ui-lib";

const ChatList = dynamic(async () => (await import("./chat-list")).ChatList, {
  loading: () => null,
});
const ProjectsPanel = dynamic(
  async () => (await import("./projects")).ProjectsPanel,
  { loading: () => null },
);

function useHotKey() {
  const chatStore = useChatStore();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey) {
        if (e.key === "ArrowUp") {
          chatStore.nextSession(-1);
        } else if (e.key === "ArrowDown") {
          chatStore.nextSession(1);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}

// Fixed-width sidebar — a ChatGPT-style shell, not a resizable pane.
// The only width choice left is collapsed (a narrow icon rail) vs. expanded
// (DEFAULT_SIDEBAR_WIDTH); no drag handle, no arbitrary in-between widths.
function useSidebarWidth() {
  const config = useAppConfig();
  const isMobileScreen = useMobileScreen();
  const shouldNarrow =
    !isMobileScreen && config.sidebarWidth === NARROW_SIDEBAR_WIDTH;

  const toggleSideBar = () => {
    config.update((config) => {
      config.sidebarWidth = shouldNarrow
        ? DEFAULT_SIDEBAR_WIDTH
        : NARROW_SIDEBAR_WIDTH;
    });
  };

  useEffect(() => {
    const barWidth = shouldNarrow
      ? NARROW_SIDEBAR_WIDTH
      : DEFAULT_SIDEBAR_WIDTH;
    const sideBarWidth = isMobileScreen ? "100vw" : `${barWidth}px`;
    document.documentElement.style.setProperty("--sidebar-width", sideBarWidth);
  }, [isMobileScreen, shouldNarrow]);

  return {
    shouldNarrow,
    toggleSideBar,
  };
}

export function SideBar(props: { className?: string }) {
  const chatStore = useChatStore();

  // drag side bar
  const { shouldNarrow, toggleSideBar } = useSidebarWidth();
  const navigate = useNavigate();
  const config = useAppConfig();
  const isMobileScreen = useMobileScreen();
  const isIOSMobile = useMemo(
    () => isIOS() && isMobileScreen,
    [isMobileScreen],
  );
  useHotKey();

  const { theme } = config;
  function nextTheme() {
    const themes = [Theme.Auto, Theme.Light, Theme.Dark];
    const themeIndex = themes.indexOf(theme);
    const nextIndex = (themeIndex + 1) % themes.length;
    const nextTheme = themes[nextIndex];
    config.update((config) => (config.theme = nextTheme));
  }

  return (
    <div
      className={`${styles.sidebar} ${props.className} ${
        shouldNarrow && styles["narrow-sidebar"]
      }`}
      style={{
        // #3016 disable transition on ios mobile screen
        transition: isMobileScreen && isIOSMobile ? "none" : undefined,
      }}
    >
      <div className={styles["sidebar-header"]}>
        <IconButton
          icon={
            shouldNarrow ? <CaretRight size={17} /> : <CaretLeft size={17} />
          }
          title={
            shouldNarrow ? "Expand conversations" : "Collapse conversations"
          }
          onClick={toggleSideBar}
          className={styles["sidebar-collapse"]}
        />
        <div className={styles["sidebar-logo"]}>F</div>
        <div className={styles["sidebar-title-container"]}>
          <div className={styles["sidebar-title"]}>{Locale.Title}</div>
          <div className={styles["sidebar-sub-title"]}>{Locale.Subtitle}</div>
        </div>
      </div>

      <div className={styles["sidebar-header-bar"]}>
        <IconButton
          icon={<Chats size={18} />}
          text={shouldNarrow ? undefined : Locale.Template.Name}
          className={styles["sidebar-bar-button"]}
          onClick={() => {
            navigate(Path.Templates, { state: { fromHome: true } });
          }}
          shadow
        />
        <IconButton
          icon={<GearSix size={18} />}
          text={shouldNarrow ? undefined : Locale.Settings.Title}
          className={styles["sidebar-bar-button"]}
          onClick={() => {
            navigate(Path.Settings);
          }}
          shadow
        />
      </div>

      <div
        className={styles["sidebar-body"]}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            navigate(Path.Home);
          }
        }}
      >
        <ProjectsPanel narrow={shouldNarrow} />
        <ChatList narrow={shouldNarrow} />
      </div>

      <div className={styles["sidebar-tail"]}>
        <div className={styles["sidebar-actions"]}>
          <div className={styles["sidebar-action"] + " " + styles.mobile}>
            <IconButton
              icon={<Trash size={18} />}
              onClick={async () => {
                if (await showConfirm(Locale.Home.DeleteChat)) {
                  chatStore.deleteSession(chatStore.currentSessionIndex);
                }
              }}
            />
          </div>
          <div className={styles["sidebar-action"]}>
            <a href={WEBLLM_HOME_URL} target="_blank" rel="noopener noreferrer">
              <IconButton icon={<GlobeSimple size={18} />} shadow />
            </a>
          </div>
          <div className={styles["sidebar-action"]}>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              <IconButton
                icon={<GithubLogo size={18} />}
                shadow
                title="eoWebLLM on GitHub"
              />
            </a>
          </div>
          <div className={styles["sidebar-action"]}>
            <IconButton
              icon={
                <>
                  {theme === Theme.Auto ? (
                    <CircleHalf size={18} />
                  ) : theme === Theme.Light ? (
                    <Sun size={18} />
                  ) : theme === Theme.Dark ? (
                    <Moon size={18} />
                  ) : null}
                </>
              }
              onClick={nextTheme}
              shadow
            />
          </div>
        </div>
        <div>
          <IconButton
            icon={<Plus size={18} />}
            text={shouldNarrow ? undefined : Locale.Home.NewChat}
            onClick={() => {
              chatStore.newSession();
              navigate(Path.Chat);
            }}
            shadow
          />
        </div>
      </div>
    </div>
  );
}
