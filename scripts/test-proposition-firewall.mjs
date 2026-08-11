import { test } from "node:test";
import assert from "node:assert/strict";

import {
  admitPropositions,
  createGraph,
  draftSearchTerms,
  extractSourcePropositions,
} from "../app/client/eo-proposition-firewall.ts";

const source = {
  sourceId: "opfs:brief",
  byteStart: 0,
  byteEnd: 42,
  retrievalEvent: "turn-1:corpus-surf",
  extractionMethod: "eoreader6:relations",
};

test("a System 1 fabrication can supply search terms but creates no graph state", () => {
  const graph = createGraph({ gamma: 0.9, pruneBelow: 0.001 });
  const result = admitPropositions(graph, [
    {
      subject: "Fabricated Person",
      verb: "founded",
      object: "Fabricated Company",
      polarity: "+",
      origin: "draft-candidate",
      source,
    },
  ]);

  assert.deepEqual(
    draftSearchTerms("Fabricated Person founded Fabricated Company"),
    ["fabricated", "person", "founded", "company"],
  );
  assert.equal(result.rejected, 1);
  assert.equal(result.reading, null);
  assert.equal(graph.nodes.size, 0);
  assert.equal(graph.edges.size, 0);
  assert.equal(graph.tick, 0);
});

test("only source-spanned material can become graph evidence", () => {
  assert.throws(
    () =>
      extractSourcePropositions({
        text: "Ada builds engines.",
        origin: "retrieved",
        source: { ...source, byteEnd: 0 },
      }),
    /source id, byte span, retrieval event, and extraction method/,
  );
});

test("independently retrieved evidence alone advances the eoreader6 graph", () => {
  const graph = createGraph({ gamma: 0.9, pruneBelow: 0.001 });
  const result = admitPropositions(graph, [
    {
      subject: "Ada",
      verb: "builds",
      object: "engines",
      polarity: "+",
      origin: "retrieved",
      source,
    },
  ]);

  assert.equal(result.admitted.length, 1);
  assert.equal(result.rejected, 0);
  assert.equal(graph.nodes.size, 2);
  assert.equal(graph.edges.size, 1);
  assert.equal(graph.tick, 1);
});
