import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CodexProductionProjectSync,
  reconcileCodexProjects,
} from "../vendor/codex-workspace-enhancer/asset-browser/codex-production-project-sync.js";

test("discovers media-production Codex projects without importing an ordinary code project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-production-projects-"));
  const productionRoot = path.join(root, "短剧角色制作");
  const codeRoot = path.join(root, "sidebar-code");
  await mkdir(path.join(productionRoot, "03-视觉资产", "角色"), { recursive: true });
  await mkdir(path.join(codeRoot, "public"), { recursive: true });

  const productionThread = "11111111-1111-4111-8111-111111111111";
  const codeThread = "22222222-2222-4222-8222-222222222222";
  const globalStatePath = path.join(root, "global-state.json");
  const sessionIndexPath = path.join(root, "session-index.jsonl");
  await writeFile(globalStatePath, JSON.stringify({
    "local-projects": {
      production: { id: "production", name: "短剧角色制作", rootPaths: [productionRoot] },
      code: { id: "code", name: "侧栏代码工具", rootPaths: [codeRoot] },
    },
    "thread-project-assignments": {
      [productionThread]: { projectId: "production" },
      [codeThread]: { projectId: "code" },
    },
  }));
  await writeFile(sessionIndexPath, [
    JSON.stringify({ id: productionThread, thread_name: "批量生成角色图", updated_at: "2026-08-20T00:00:00Z" }),
    JSON.stringify({ id: codeThread, thread_name: "修复 README 图片链接", updated_at: "2026-08-20T00:00:00Z" }),
  ].join("\n") + "\n");

  const sync = new CodexProductionProjectSync({ globalStatePath, sessionIndexPath });
  const candidates = await sync.discover({
    associations: [
      { threadId: productionThread, cwd: productionRoot, kind: "image", assetPath: path.join(root, "generated", "role.png") },
      { threadId: codeThread, cwd: codeRoot, kind: "image", assetPath: path.join(root, "generated", "screenshot.png") },
    ],
  });

  assert.deepEqual(candidates.map((candidate) => candidate.codexProjectId), ["production"]);
  assert.deepEqual(candidates[0].folders, [productionRoot]);
  assert.deepEqual(candidates[0].generatedKinds, ["image"]);
  assert.match(candidates[0].reason, /生成记录/);
});

test("requires production intent for generic media folders and never cross-links an ambiguous shared root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-production-boundaries-"));
  const productionRoot = path.join(root, "短剧制作");
  const codeRoot = path.join(root, "sidebar-code");
  const sharedRoot = path.join(root, "共享素材");
  await mkdir(path.join(productionRoot, "角色图"), { recursive: true });
  await mkdir(path.join(codeRoot, "assets"), { recursive: true });
  await mkdir(path.join(codeRoot, "output"), { recursive: true });
  await mkdir(path.join(sharedRoot, "图片"), { recursive: true });

  const productionThread = "33333333-3333-4333-8333-333333333333";
  const codeThread = "44444444-4444-4444-8444-444444444444";
  const globalStatePath = path.join(root, "global-state.json");
  const sessionIndexPath = path.join(root, "session-index.jsonl");
  await writeFile(globalStatePath, JSON.stringify({
    "local-projects": {
      production: { id: "production", name: "短剧制作", rootPaths: [productionRoot, sharedRoot] },
      code: { id: "code", name: "侧栏代码工具", rootPaths: [codeRoot, sharedRoot] },
    },
    "thread-project-assignments": {
      [productionThread]: { projectId: "production" },
      [codeThread]: { projectId: "code" },
    },
  }));
  await writeFile(sessionIndexPath, [
    JSON.stringify({ id: productionThread, thread_name: "生成短剧角色图片", updated_at: "2026-08-20T00:00:00Z" }),
    JSON.stringify({ id: codeThread, thread_name: "更新 README 截图链接", updated_at: "2026-08-20T00:00:00Z" }),
  ].join("\n") + "\n");

  const sync = new CodexProductionProjectSync({ globalStatePath, sessionIndexPath });
  const candidates = await sync.discover({
    associations: [
      { threadId: productionThread, cwd: productionRoot, kind: "image", assetPath: path.join(productionRoot, "角色图", "role.png") },
      { threadId: codeThread, cwd: codeRoot, kind: "image", assetPath: path.join(codeRoot, "output", "screenshot.png") },
    ],
  });

  assert.deepEqual(candidates.map((candidate) => candidate.codexProjectId), ["production"]);
  assert.deepEqual(candidates[0].folders, [productionRoot]);
});

test("reconciliation creates stable synchronized projects and preserves manual edits", () => {
  const firstRoot = path.resolve("/projects/drama/assets");
  const secondRoot = path.resolve("/projects/drama/audio");
  const manualRoot = path.resolve("/projects/drama/manual-references");
  const candidate = {
    codexProjectId: "codex-drama",
    name: "短剧制作",
    folders: [firstRoot, secondRoot],
    generatedKinds: ["image", "audio"],
    reason: "2 个 Codex 生成记录",
  };

  const created = reconcileCodexProjects([], [candidate], { now: "2026-08-20T00:00:00.000Z" });
  assert.equal(created.changed, true);
  assert.equal(created.created.length, 1);
  assert.deepEqual(created.projects[0].folders, [firstRoot, secondRoot]);
  assert.equal(created.projects[0].codexSync.projectId, "codex-drama");
  assert.equal(created.projects[0].codexSync.userCustomizedFolders, false);

  const customized = structuredClone(created.projects);
  customized[0].name = "我的短剧资产";
  customized[0].folders.push(manualRoot);
  customized[0].codexSync.userCustomizedName = true;
  customized[0].codexSync.userCustomizedFolders = true;
  customized[0].codexSync.excludedFolders = [secondRoot];

  const updated = reconcileCodexProjects(customized, [{ ...candidate, name: "Codex 新名称" }], {
    now: "2026-08-20T01:00:00.000Z",
  });
  assert.equal(updated.projects[0].name, "我的短剧资产");
  assert.deepEqual(updated.projects[0].folders, [firstRoot, manualRoot]);
  assert.deepEqual(updated.projects[0].codexSync.managedFolders, [firstRoot]);
});

test("an existing manual project is linked instead of duplicated", () => {
  const root = path.resolve("/projects/animation");
  const projects = [{ id: "manual-animation", name: "动画资产", path: root, folders: [root], scanRoots: ["."] }];
  const result = reconcileCodexProjects(projects, [{
    codexProjectId: "codex-animation",
    name: "动画制作",
    folders: [root],
    generatedKinds: ["video"],
    reason: "Codex 视频生成记录",
  }], { now: "2026-08-20T00:00:00.000Z" });

  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].id, "manual-animation");
  assert.equal(result.projects[0].codexSync.projectId, "codex-animation");
  assert.equal(result.projects[0].codexSync.userCustomizedName, true);
  assert.equal(result.projects[0].codexSync.userCustomizedFolders, true);
});
