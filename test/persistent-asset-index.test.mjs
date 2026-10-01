import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PersistentAssetIndex,
  sameAssetIndexFolders,
} from "../vendor/codex-workspace-enhancer/asset-browser/persistent-asset-index.js";

test("asset index survives service restarts and patches only affected paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-asset-index-"));
  const filePath = path.join(root, "state", ".asset-library-index.json");
  const project = { id: "story", name: "短剧", folders: [path.join(root, "assets")] };
  const rolePath = path.join(project.folders[0], "角色", "hero.png");
  const scenePath = path.join(project.folders[0], "场景", "street.png");
  const role = { id: "role", sourcePath: rolePath, name: "hero.png", mtimeMs: 1 };
  const scene = { id: "scene", sourcePath: scenePath, name: "street.png", mtimeMs: 2 };

  try {
    const first = new PersistentAssetIndex({ filePath });
    await first.replaceProject(project, [role, scene], "2026-08-31T00:00:00.000Z");

    const restarted = new PersistentAssetIndex({ filePath });
    assert.deepEqual((await restarted.getProject(project.id)).assets.map((asset) => asset.id), ["role", "scene"]);

    await restarted.patchProject(project, {
      upserts: [{ ...role, mtimeMs: 3 }],
      removePrefixes: [path.dirname(scenePath)],
    }, "2026-08-31T00:01:00.000Z");
    const patched = await restarted.getProject(project.id);
    assert.deepEqual(patched.assets.map((asset) => asset.id), ["role"]);
    assert.equal(patched.assets[0].mtimeMs, 3);
    assert.equal(patched.updatedAt, "2026-08-31T00:01:00.000Z");
    assert.equal(JSON.parse(await readFile(filePath, "utf8")).schemaVersion, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("asset index folder comparison is order independent and path normalized", () => {
  assert.equal(sameAssetIndexFolders(["/a", "/b/../b"], ["/b", "/a"]), true);
  assert.equal(sameAssetIndexFolders(["/a"], ["/a", "/b"]), false);
});
