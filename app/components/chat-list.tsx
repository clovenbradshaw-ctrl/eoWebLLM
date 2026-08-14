import DeleteIcon from "../icons/delete.svg";

import styles from "./home.module.scss";
import {
  DragDropContext,
  Droppable,
  Draggable,
  OnDragEndResponder,
} from "@hello-pangea/dnd";

import { useChatStore } from "../store";

import { FolderSimple, X } from "@phosphor-icons/react";
import Locale from "../locales";
import { useLocation, useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { Template } from "../store/template";
import { useRef, useEffect } from "react";
import { showConfirm } from "./ui-lib";
import { useMobileScreen } from "../utils";

export function ChatItem(props: {
  onClick?: () => void;
  onDelete?: () => void;
  title: string;
  count: number;
  time: string;
  selected: boolean;
  id: string;
  index: number;
  template: Template;
}) {
  const draggableRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (props.selected && draggableRef.current) {
      draggableRef.current?.scrollIntoView({
        block: "center",
      });
    }
  }, [props.selected]);

  const { pathname: currentPath } = useLocation();
  return (
    <Draggable draggableId={`${props.id}`} index={props.index}>
      {(provided) => (
        <div
          className={`${styles["chat-item"]} ${
            props.selected &&
            (currentPath === Path.Chat || currentPath === Path.Home) &&
            styles["chat-item-selected"]
          }`}
          onClick={props.onClick}
          ref={(ele) => {
            draggableRef.current = ele;
            provided.innerRef(ele);
          }}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          title={`${props.title}\n${Locale.ChatItem.ChatItemCount(
            props.count,
          )}`}
        >
          <div className={styles["chat-item-title"]}>{props.title}</div>
          <div className={styles["chat-item-info"]}>
            <div className={styles["chat-item-count"]}>
              {Locale.ChatItem.ChatItemCount(props.count)}
            </div>
            <div className={styles["chat-item-date"]}>{props.time}</div>
          </div>

          <div
            className={styles["chat-item-delete"]}
            onClickCapture={(e) => {
              props.onDelete?.();
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <DeleteIcon />
          </div>
        </div>
      )}
    </Draggable>
  );
}

export function ChatList(props: { narrow?: boolean }) {
  const chatStore = useChatStore();
  const navigate = useNavigate();
  const isMobileScreen = useMobileScreen();

  // Collapsed sidebar is a compact nav strip, not a second narrow content
  // column — no per-chat list there (matches ProjectsPanel's own narrow gate).
  if (props.narrow) return null;

  // The list only ever shows one scope of chats at a time: the current
  // project's (currentProjectId, kept in step with the selected session by
  // the store), or — when no project is active — the unprojected chats. A
  // session whose projectId dangles (project was deleted, see deleteProject)
  // falls back into the unprojected view rather than vanishing.
  const sessions = chatStore.sessions;
  const activeProject =
    chatStore.projects.find((p) => p.id === chatStore.currentProjectId) ?? null;

  const visible = sessions
    .map((session, originalIndex) => ({ session, originalIndex }))
    .filter(({ session }) =>
      activeProject
        ? session.projectId === activeProject.id
        : !session.projectId ||
          !chatStore.projects.some((p) => p.id === session.projectId),
    );

  const onDragEnd: OnDragEndResponder = (result) => {
    const { destination, source } = result;
    if (!destination) {
      return;
    }

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    // @hello-pangea/dnd numbers its destination by the *visible* list; map
    // back to the real position inside the full sessions array.
    const fromIndex = visible[source.index]?.originalIndex;
    const toIndex = visible[destination.index]?.originalIndex;
    if (fromIndex === undefined || toIndex === undefined) return;
    chatStore.moveSession(fromIndex, toIndex);
  };

  return (
    <>
      {activeProject && (
        <div className={styles["chat-list-context"]}>
          <div
            className={styles["chat-list-context-main"]}
            role="button"
            tabIndex={0}
            title={`Open "${activeProject.name}" — this project's chats are listed below`}
            onClick={() => {
              navigate(Path.Project);
            }}
          >
            <FolderSimple size={12} />
            <span className={styles["chat-list-context-name"]}>
              {activeProject.name}
            </span>
            <span className={styles["chat-list-context-count"]}>
              {visible.length}
            </span>
          </div>
          <div
            className={styles["chat-list-context-exit"]}
            role="button"
            tabIndex={0}
            title="Back to general chats"
            onClick={() => {
              // Exit the project context properly: land on the most recent
              // unprojected chat (or start one), rather than only clearing
              // currentProjectId -- selectSession/newSession keep it tracking
              // the session we actually end up on, so the current chat can't
              // silently disappear from the list it now shows.
              let latest = -1;
              let latestIndex = -1;
              chatStore.sessions.forEach((s, i) => {
                const grouped =
                  !!s.projectId &&
                  chatStore.projects.some((p) => p.id === s.projectId);
                if (!grouped && s.lastUpdate > latest) {
                  latest = s.lastUpdate;
                  latestIndex = i;
                }
              });
              if (latestIndex >= 0) {
                chatStore.selectSession(latestIndex);
              } else {
                chatStore.newSession();
              }
              navigate(Path.Chat);
            }}
          >
            <X size={12} />
          </div>
        </div>
      )}
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="chat-list">
          {(provided) => (
            <div
              className={styles["chat-list"]}
              ref={provided.innerRef}
              {...provided.droppableProps}
            >
              {visible.map(({ session: item, originalIndex: i }, position) => (
                <ChatItem
                  title={item.topic}
                  time={new Date(item.lastUpdate).toLocaleString()}
                  count={item.messages.length}
                  key={item.id}
                  id={item.id}
                  // Draggable needs sequential indexes over the *visible*
                  // list, while selection/delete need the real position in
                  // the full sessions array -- keep the two apart.
                  index={position}
                  selected={i === chatStore.currentSessionIndex}
                  onClick={() => {
                    navigate(Path.Chat);
                    chatStore.selectSession(i);
                  }}
                  onDelete={async () => {
                    if (
                      !isMobileScreen ||
                      (await showConfirm(Locale.Home.DeleteChat))
                    ) {
                      chatStore.deleteSession(i);
                    }
                  }}
                  template={item.template}
                />
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </>
  );
}
