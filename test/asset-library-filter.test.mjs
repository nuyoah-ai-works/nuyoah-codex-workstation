import assert from "node:assert/strict";
import test from "node:test";

import { filterLibraryResult } from "../vendor/codex-workspace-enhancer/asset-browser/asset-library-filter.js";

const library = {
  project: { id: "project-a", name: "Project A", folders: ["/project-a"] },
  assets: [
    { name: "hero.png", preview: "", kind: "image", category: "角色", smartGroup: "asset", tags: ["主角"], autoTags: ["自动·角色"] },
    { name: "draft.png", preview: "", kind: "image", category: "参考图", smartGroup: "review", tags: [], autoTags: ["自动·待确认"] },
    { name: "script.md", preview: "第一集开场", kind: "text", category: "剧本", smartGroup: "asset", tags: ["剧本"], autoTags: [] },
  ],
  counts: { all: 3, text: 1, image: 2, audio: 0, video: 0 },
  smartCounts: { asset: 2, review: 1, noise: 0 },
  settings: { columns: 5 },
};

test("shared raw library scans are filtered independently per request", () => {
  const images = filterLibraryResult(library, { kind: "image", smartGroup: "asset" });
  const scripts = filterLibraryResult(library, { query: "第一集" });

  assert.deepEqual(images.assets.map((asset) => asset.name), ["hero.png"]);
  assert.deepEqual(images.counts, { all: 1, text: 0, image: 1, audio: 0, video: 0 });
  assert.deepEqual(images.smartCounts, { asset: 1, review: 0, noise: 0 });
  assert.deepEqual(scripts.assets.map((asset) => asset.name), ["script.md"]);
  assert.deepEqual(scripts.counts, { all: 1, text: 1, image: 0, audio: 0, video: 0 });
  assert.equal(library.assets.length, 3, "filtering must not mutate the shared scan result");
});
