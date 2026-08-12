import { test } from "node:test";
import assert from "node:assert/strict";

import { checkCoherence, filterCodeFiles } from "../app/client/eo-coherence-check.ts";

// A minimal in-memory stand-in for lightning-fs's fs.promises surface —
// checkCoherence only ever calls readFile(path), so that's all this fakes.
// No IndexedDB, no browser, no real clone: this proves the PORTED ALGORITHM
// (import-graph construction + deriveLevels' existence-dependency test) is
// correct, the same real-vs-fake split eochat's own coherence-check.mjs
// tests draw (a real clone was validated separately, live, against
// d11z/asperitas — see CRISPR-AGENT-LOOP-HANDOFF.md).
function fakeRepo(files) {
  return {
    dir: "/repo",
    fs: {
      promises: {
        readFile: async (path) => {
          const rel = path.replace(/^\/repo\//, "");
          if (!(rel in files)) throw new Error(`ENOENT: ${path}`);
          return new TextEncoder().encode(files[rel]);
        },
      },
    },
  };
}

test("checkCoherence: a real chain of relative imports is coherent, zero isolated", async () => {
  const cloned = fakeRepo({
    "index.js": `import { helper } from "./util";\nhelper();`,
    "util.js": `import { CONST } from "./constants";\nexport function helper() { return CONST; }`,
    "constants.js": `export const CONST = 1;`,
  });
  const files = ["index.js", "util.js", "constants.js"];
  const result = await checkCoherence(cloned, files);
  assert.equal(result.coherent, true);
  assert.deepEqual(result.isolated, []);
  assert.ok(result.relatedCount >= 2, "index->util and util->constants must both earn a real relation");
});

test("checkCoherence: a file with zero import edges to anything else is isolated, catching an incoherent pile", async () => {
  const cloned = fakeRepo({
    "index.js": `import { helper } from "./util";\nhelper();`,
    "util.js": `export function helper() { return 1; }`,
    "unrelated.js": `export const nothing = "not imported by, or importing, anything else here";`,
  });
  const files = ["index.js", "util.js", "unrelated.js"];
  const result = await checkCoherence(cloned, files);
  assert.equal(result.coherent, false);
  assert.deepEqual(result.isolated, ["unrelated.js"]);
});

test("checkCoherence: require() is recognized alongside import", async () => {
  const cloned = fakeRepo({
    "a.js": `const b = require("./b");\nb();`,
    "b.js": `module.exports = function b() {};`,
  });
  const files = ["a.js", "b.js"];
  const result = await checkCoherence(cloned, files);
  assert.equal(result.coherent, true);
});

test("checkCoherence: a bare (non-relative) import is external, never a false edge into the snip", async () => {
  const cloned = fakeRepo({
    "a.js": `import React from "react";\nimport { b } from "./b";`,
    "b.js": `export const b = 1;`,
  });
  const files = ["a.js", "b.js"];
  const result = await checkCoherence(cloned, files);
  assert.equal(result.coherent, true);
  // "react" must never appear as a task_id / relation target — only real
  // files in the snip can be related.
  assert.ok(result.relations.every((r) => files.includes(r.a) && files.includes(r.b)));
});

test("checkCoherence: a lone file is vacuously coherent, not reported isolated", async () => {
  const cloned = fakeRepo({ "solo.js": `export const x = 1;` });
  const result = await checkCoherence(cloned, ["solo.js"]);
  assert.equal(result.coherent, true);
  assert.deepEqual(result.isolated, []);
});

test("filterCodeFiles: keeps real code extensions, drops markdown/config/lockfiles", () => {
  const files = ["README.md", "package.json", "src/index.ts", "src/util.jsx", "yarn.lock", "LICENSE"];
  assert.deepEqual(filterCodeFiles(files), ["src/index.ts", "src/util.jsx"]);
});
