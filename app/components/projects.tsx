import styles from "./home.module.scss";
import { showConfirm, showPrompt } from "./ui-lib";
import {
  FolderSimple,
  PencilSimple,
  Plus,
  X,
  ChatCircle,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { useChatStore, projectSources, type Project } from "../store";

// eoWebLLM's take on eochat's Projects screen (a named collection with its
// own knowledge base) -- see the Project/projectSources comments in
// store/chat.ts for why this is a thin, purely client-side, additive layer
// rather than a port of eochat's server-backed version. Sits above the
// existing session list rather than replacing it: a project is just a tag
// a handful of sessions share, not a separate storage system.
export function ProjectsPanel(props: { narrow?: boolean }) {
  const chatStore = useChatStore();
  const navigate = useNavigate();
  const projects = chatStore.projects;
  const sessions = chatStore.sessions;

  if (props.narrow) return null;

  async function createProject() {
    const name = await showPrompt("Name this project", "", 1);
    if (!name.trim()) return;
    const project = chatStore.createProject(name.trim());
    openProject(project.id);
  }

  // Opens the project page (project.tsx) -- its Chats/Documents/
  // Instructions tabs, not straight into a chat. openLatestChat below is
  // the fast one-click-into-chat shortcut for the reader who just wants to
  // keep talking.
  function openProject(projectId: string) {
    chatStore.setCurrentProjectId(projectId);
    navigate(Path.Project);
  }

  // Opens a project's most recently active session, or starts a fresh one
  // stamped with this project's id if it has none yet -- the same
  // auto-create-a-first-conversation move eochat's switchProject makes.
  function openLatestChat(projectId: string) {
    let latestIndex = -1;
    let latestUpdate = -1;
    sessions.forEach((s, i) => {
      if (s.projectId === projectId && s.lastUpdate > latestUpdate) {
        latestUpdate = s.lastUpdate;
        latestIndex = i;
      }
    });
    if (latestIndex >= 0) {
      chatStore.selectSession(latestIndex);
    } else {
      chatStore.newSession(undefined, projectId);
    }
    navigate(Path.Chat);
  }

  async function renameProject(project: Project) {
    const name = await showPrompt("Rename project", project.name, 1);
    if (!name.trim() || name.trim() === project.name) return;
    chatStore.renameProject(project.id, name.trim());
  }

  async function deleteProject(project: Project) {
    const confirmed = await showConfirm(
      `Delete project "${project.name}"? Its chats stay -- they just stop being grouped.`,
    );
    if (confirmed) chatStore.deleteProject(project.id);
  }

  return (
    <div className={styles["projects-panel"]}>
      <div className={styles["projects-panel-header"]}>
        <span>Projects</span>
        <div
          className={styles["projects-panel-add"]}
          onClick={createProject}
          title="New project"
        >
          <Plus size={13} />
        </div>
      </div>
      {projects.length === 0 ? (
        <div className={styles["projects-panel-empty"]}>
          Group chats around a shared set of documents.
        </div>
      ) : (
        projects.map((project) => {
          const sessionCount = sessions.filter(
            (s) => s.projectId === project.id,
          ).length;
          const sourceCount = projectSources(sessions, project.id).length;
          return (
            <div key={project.id} className={styles["projects-panel-item"]}>
              <div
                className={styles["projects-panel-item-main"]}
                onClick={() => openProject(project.id)}
              >
                <FolderSimple
                  size={14}
                  className={styles["projects-panel-item-icon"]}
                />
                <span className={styles["projects-panel-item-name"]}>
                  {project.name}
                </span>
                <span className={styles["projects-panel-item-meta"]}>
                  {sessionCount} chat{sessionCount === 1 ? "" : "s"} ·{" "}
                  {sourceCount} source{sourceCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className={styles["projects-panel-item-actions"]}>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    openLatestChat(project.id);
                  }}
                  title="Open latest chat"
                >
                  <ChatCircle size={12} />
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    renameProject(project);
                  }}
                  title="Rename project"
                >
                  <PencilSimple size={12} />
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteProject(project);
                  }}
                  title="Delete project"
                >
                  <X size={12} />
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
