import { useEffect } from "react";

import styles from "./settings.module.scss";
import CloseIcon from "../icons/close.svg";

import { List, ListItem, Select, showConfirm } from "./ui-lib";
import { ModelConfigList } from "./model-config";

import { IconButton } from "./button";
import {
  SubmitKey,
  useChatStore,
  Theme,
  useAppConfig,
  CacheType,
} from "../store";

import Locale from "../locales";
import { InputRange } from "./input-range";
import { Path } from "../constant";
import { useNavigate } from "react-router-dom";

function DangerItems() {
  const chatStore = useChatStore();
  const appConfig = useAppConfig();

  return (
    <List>
      <ListItem
        title={Locale.Settings.Danger.Reset.Title}
        subTitle={Locale.Settings.Danger.Reset.SubTitle}
      >
        <IconButton
          text={Locale.Settings.Danger.Reset.Action}
          onClick={async () => {
            if (await showConfirm(Locale.Settings.Danger.Reset.Confirm)) {
              appConfig.reset();
            }
          }}
          type="danger"
        />
      </ListItem>
      <ListItem
        title={Locale.Settings.Danger.Clear.Title}
        subTitle={Locale.Settings.Danger.Clear.SubTitle}
      >
        <IconButton
          text={Locale.Settings.Danger.Clear.Action}
          onClick={async () => {
            if (await showConfirm(Locale.Settings.Danger.Clear.Confirm)) {
              chatStore.clearAllData();
            }
          }}
          type="danger"
        />
      </ListItem>
    </List>
  );
}

export function Settings() {
  const navigate = useNavigate();
  const config = useAppConfig();
  const updateConfig = config.update;

  useEffect(() => {
    const keydownEvent = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        navigate(Path.Home);
      }
    };
    document.addEventListener("keydown", keydownEvent);
    return () => {
      document.removeEventListener("keydown", keydownEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="window-header">
      <div className="window-header-title">
        <div className="window-header-main-title">{Locale.Settings.Title}</div>
        <div className="window-header-sub-title">
          {Locale.Settings.SubTitle}
        </div>
      </div>
      <div className="window-actions">
        <div className="window-action-button"></div>
        <div className="window-action-button"></div>
        <div className="window-action-button">
          <IconButton
            icon={<CloseIcon />}
            onClick={() => navigate(Path.Home)}
            bordered
          />
        </div>
      </div>

      <div className={styles["settings"]}>
        <List>
          <ModelConfigList />
        </List>

        <List>
          <ListItem title={Locale.Settings.SendKey}>
            <Select
              value={config.submitKey}
              onChange={(e) => {
                updateConfig(
                  (config) =>
                    (config.submitKey = e.target.value as any as SubmitKey),
                );
              }}
            >
              {Object.values(SubmitKey).map((v) => (
                <option value={v} key={v}>
                  {v}
                </option>
              ))}
            </Select>
          </ListItem>

          <ListItem title={Locale.Settings.Theme}>
            <Select
              value={config.theme}
              onChange={(e) => {
                updateConfig(
                  (config) => (config.theme = e.target.value as any as Theme),
                );
              }}
            >
              {Object.values(Theme).map((v) => (
                <option value={v} key={v}>
                  {v}
                </option>
              ))}
            </Select>
          </ListItem>

          <ListItem
            title={Locale.Settings.FontSize.Title}
            subTitle={Locale.Settings.FontSize.SubTitle}
          >
            <InputRange
              title={`${config.fontSize ?? 14}px`}
              value={config.fontSize}
              min="12"
              max="40"
              step="1"
              onChange={(e) =>
                updateConfig(
                  (config) =>
                    (config.fontSize = Number.parseInt(e.currentTarget.value)),
                )
              }
            ></InputRange>
          </ListItem>

          <ListItem
            title={Locale.Settings.HistoryCount.Title}
            subTitle={Locale.Settings.HistoryCount.SubTitle}
          >
            <InputRange
              title={config.historyMessageCount.toString()}
              value={config.historyMessageCount}
              min="0"
              max="64"
              step="1"
              onChange={(e) =>
                config.update(
                  (config) =>
                    (config.historyMessageCount = e.target.valueAsNumber),
                )
              }
            ></InputRange>
          </ListItem>

          <ListItem title={Locale.Memory.Title} subTitle={Locale.Memory.Send}>
            <input
              type="checkbox"
              checked={config.sendMemory}
              onChange={(e) =>
                config.update(
                  (config) => (config.sendMemory = e.currentTarget.checked),
                )
              }
            ></input>
          </ListItem>

          <ListItem
            title={Locale.Settings.CacheType.Title}
            subTitle={Locale.Settings.CacheType.SubTitle}
          >
            <Select
              value={config.cacheType}
              onChange={(e) => {
                updateConfig(
                  (config) =>
                    (config.cacheType = e.currentTarget
                      .value as any as CacheType),
                );
              }}
            >
              <option value="cache" key="cache">
                Cache
              </option>
              <option value="index_db" key="index_db">
                Index DB
              </option>
            </Select>
          </ListItem>
        </List>

        <DangerItems />
      </div>
    </div>
  );
}
