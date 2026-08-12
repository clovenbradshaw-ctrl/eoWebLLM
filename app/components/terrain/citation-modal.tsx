import { useMemo } from "react";

import { Modal } from "../ui-lib";
import { IconButton } from "../button";
import type { GroundingSpan } from "../../client/eo-grounding-spans";
import {
  type CitationEntry,
  splitSentences,
  snipCitations,
  checkConsistency,
} from "../../client/eo-citation-check";
import { corpusFieldTarget } from "./grounding-chip";
import type { OnNavigate } from "./types";

// The citation modal — opened by clicking a numbered [n] chip
// (grounding-chip.tsx). Shows the source's own verbatim excerpt for the
// span that was clicked ("Citey's snip") plus a real but narrowly-scoped
// mechanical consistency check between that excerpt and the reply's own
// sentence. Deliberately does NOT claim to judge meaning — see
// checkConsistency's own header in eo-citation-check.ts for why negation
// and numbers are the only two features checked.

function findContainingSentence(content: string, start: number): string {
  const sentences = splitSentences(content);
  const hit = sentences.find((s) => start >= s.start && start < s.end);
  return (hit ?? sentences[sentences.length - 1])?.text.trim() ?? content;
}

export function CitationModal(props: {
  messageContent: string;
  span: GroundingSpan;
  citation: CitationEntry;
  citationNumber?: number;
  onNavigate?: OnNavigate;
  onClose: () => void;
}) {
  const { span, citation } = props;

  const replySentence = useMemo(
    () => findContainingSentence(props.messageContent, span.start),
    [props.messageContent, span.start],
  );

  const snip = useMemo(() => {
    const [result] = snipCitations(replySentence, [citation]);
    return result?.clause ?? citation.text;
  }, [replySentence, citation]);

  const consistency = useMemo(
    () => checkConsistency(replySentence, snip),
    [replySentence, snip],
  );

  const fieldTarget = corpusFieldTarget(citation);
  const isWeb = /^https?:\/\//i.test(citation.source_id);

  const hasIssue =
    consistency.negationMismatch || consistency.unsupportedNumbers.length > 0;

  return (
    <div className="screen-model-container">
      <Modal
        title={
          span.state === "echoed"
            ? "Citation — echoes this source"
            : "Citation — sourced"
        }
        onClose={props.onClose}
        actions={[
          ...(fieldTarget && props.onNavigate
            ? [
                <IconButton
                  key="field"
                  text="Open in Field"
                  bordered
                  onClick={() => {
                    props.onNavigate!({
                      kind: "field",
                      params: fieldTarget,
                    });
                    props.onClose();
                  }}
                />,
              ]
            : []),
          <IconButton
            key="close"
            text="Close"
            bordered
            onClick={props.onClose}
          />,
        ]}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
              {props.citationNumber !== undefined
                ? `[${props.citationNumber}] `
                : ""}
              This turn&rsquo;s own line
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>{replySentence}</div>
          </div>

          <div>
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
              Citey&rsquo;s snip — the source&rsquo;s own words
            </div>
            <div
              style={{
                fontSize: 14,
                lineHeight: 1.5,
                fontStyle: "italic",
                borderLeft: "2px solid var(--primary)",
                paddingLeft: 10,
              }}
            >
              “{snip}”
            </div>
            <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>
              {isWeb ? (
                <a href={citation.source_id} target="_blank" rel="noreferrer">
                  {citation.source_id}
                </a>
              ) : fieldTarget ? (
                `From ${fieldTarget.sourceName}`
              ) : (
                citation.source_id
              )}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
              Mechanical check — negation and numbers only, not a meaning
              judgment
            </div>
            {hasIssue ? (
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                {consistency.negationMismatch && (
                  <div>
                    ⚠ The two sentences disagree on whether a negation word
                    (&ldquo;not&rdquo;, &ldquo;never&rdquo;, ...) appears at all
                    — worth checking which one is right.
                  </div>
                )}
                {consistency.unsupportedNumbers.length > 0 && (
                  <div>
                    ⚠ This line states{" "}
                    {consistency.unsupportedNumbers.length === 1
                      ? "a number"
                      : "numbers"}{" "}
                    ({consistency.unsupportedNumbers.join(", ")}) not present in
                    the snip above.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 13.5, lineHeight: 1.5, opacity: 0.75 }}>
                No negation or number mismatch found — not proof the claim is
                correct, only that these two narrow checks didn&rsquo;t flag
                anything.
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
