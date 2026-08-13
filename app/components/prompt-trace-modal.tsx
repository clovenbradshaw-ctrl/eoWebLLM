import { useState } from "react";

import { Modal } from "./ui-lib";
import { IconButton } from "./button";
import CopyIcon from "../icons/copy.svg";
import type { ChatMessage } from "../store";
import { copyToClipboard } from "../utils";

// Opened by clicking "View prompt" on an assistant reply — see chat.tsx.
// Shows exactly what reached the engine for that turn: every message in
// order (role, full content) plus the model/config it was sent with. This
// is the request itself (captured at send time — see debugRequest in
// store/chat.ts), not a re-derivation, so it can never drift from what the
// model actually saw.

const ROLE_LABEL: Record<string, string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
};

function contentText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((c) =>
      c.type === "text" ? (c.text ?? "") : `[image: ${c.image_url?.url ?? ""}]`,
    )
    .join("\n");
}

export function PromptTraceModal(props: {
  message: ChatMessage;
  onClose: () => void;
}) {
  const req = props.message.debugRequest;
  const [copied, setCopied] = useState(false);

  if (!req) return null;

  const json = JSON.stringify(req, null, 2);

  const onCopy = async () => {
    await copyToClipboard(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="screen-model-container">
      <Modal
        title="Prompt trace"
        onClose={props.onClose}
        defaultMax
        actions={[
          <IconButton
            key="copy"
            text={copied ? "Copied!" : "Copy JSON"}
            icon={<CopyIcon />}
            bordered
            onClick={onCopy}
          />,
          <IconButton
            key="close"
            text="Close"
            bordered
            onClick={props.onClose}
          />,
        ]}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              fontSize: 12,
              opacity: 0.6,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>
              Model: <code>{req.model}</code>
            </span>
            <span>
              {req.messages.length} message
              {req.messages.length === 1 ? "" : "s"}
            </span>
            <span>
              {req.messages.reduce(
                (n, m) => n + contentText(m.content).length,
                0,
              )}{" "}
              chars
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {req.messages.map((m, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid var(--border-in-light)",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    textTransform: "uppercase",
                    opacity: 0.65,
                    padding: "6px 10px",
                    background: "var(--gray)",
                    borderBottom: "1px solid var(--border-in-light)",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{ROLE_LABEL[m.role] ?? m.role}</span>
                  <span style={{ opacity: 0.7, fontWeight: 400 }}>#{i}</span>
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: "10px 12px",
                    fontSize: 13,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 320,
                    overflow: "auto",
                    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                  }}
                >
                  {contentText(m.content)}
                </pre>
              </div>
            ))}
          </div>

          <details>
            <summary style={{ fontSize: 12, opacity: 0.6, cursor: "pointer" }}>
              Raw config
            </summary>
            <pre
              style={{
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                marginTop: 6,
              }}
            >
              {JSON.stringify(req.config, null, 2)}
            </pre>
          </details>
        </div>
      </Modal>
    </div>
  );
}
