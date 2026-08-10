import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../app/client/eo-corpus.ts", import.meta.url),
  "utf8",
);

function bodyBetween(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test("spoken corpus context contains passage text but no OPFS identity", () => {
  const body = bodyBetween(
    "export function formatCorpusContext",
    "export function formatDeliberateContext",
  );
  assert.match(body, /p\.text\.trim\(\)/);
  assert.doesNotMatch(
    body,
    /p\.source\.(?:id|name)|p\.byte(?:Start|End)|bytes?\s*\$\{/i,
  );
});

test("deliberate model context also keeps OPFS identity unconscious", () => {
  const body = source.slice(source.indexOf("export function formatDeliberateContext"));
  assert.match(body, /p\.text\.trim\(\)/);
  assert.doesNotMatch(
    body,
    /p\.source\.(?:id|name)|p\.byte(?:Start|End)|bytes?\s*\$\{/i,
  );
});

test("an available corpus bears only on explicit source-reading turns", () => {
  const route = bodyBetween(
    "export function questionRequestsCorpus",
    "interface TextChunk",
  );
  assert.match(route, /source\|sources\|document/);
  assert.match(route, /source\.name\.toLowerCase/);

  const store = readFileSync(
    new URL("../app/store/chat.ts", import.meta.url),
    "utf8",
  );
  assert.match(store, /corpusRequested\s*&&/);
  assert.match(
    store,
    /enabledSources:\s*corpusRequested\s*\?\s*sourcesReadable\.length\s*:\s*0/,
  );
});
