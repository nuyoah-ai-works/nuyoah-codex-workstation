import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  normalizedWorkspacePath,
  projectProgress,
  projectUrgency,
  workspaceMatchesFilter,
} from "../shared/project-metadata.mjs";
import { createTaskboardServer } from "../server/index.mjs";

const runningApps = [];

afterEach(async () => {
  while (runningApps.length > 0) {
    const { app, directory } = runningApps.pop();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function startServer() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-taskboard-project-profile-"));
  const app = createTaskboardServer({ dataDirectory: directory });
  const address = await app.listen({ port: 0 });
  runningApps.push({ app, directory });
  return `http://127.0.0.1:${address.port}`;
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { response, body: await response.json() };
}

test("project profiles persist Codex matching and project planning metadata", async () => {
  const baseUrl = await startServer();
  const initial = await request(baseUrl, "/api/local/project-profiles");
  assert.deepEqual(initial.body.profiles, []);

  const saved = await request(baseUrl, "/api/local/project-profiles/local", {
    method: "PUT",
    body: {
      displayName: "管理优化",
      codexProjectId: "codex-management",
      workspacePath: "C:\\Projects\\management",
      description: "优化 Codex 项目管理",
      nextPlan: "验证紧急状态与文件夹筛选",
      urgencyOverride: "high",
    },
  });
  assert.equal(saved.response.status, 200);
  assert.deepEqual(saved.body.profile, {
    projectId: "local",
    displayName: "管理优化",
    codexProjectId: "codex-management",
    workspacePath: "C:\\Projects\\management",
    description: "优化 Codex 项目管理",
    nextPlan: "验证紧急状态与文件夹筛选",
    urgencyOverride: "high",
    updatedAt: saved.body.profile.updatedAt,
  });

  const readback = await request(baseUrl, "/api/local/project-profiles");
  assert.deepEqual(readback.body.profiles, [saved.body.profile]);

  const invalid = await request(baseUrl, "/api/local/project-profiles/local", {
    method: "PUT",
    body: {
      displayName: null,
      codexProjectId: null,
      workspacePath: "relative/project",
      description: "",
      nextPlan: "",
      urgencyOverride: null,
    },
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_FIELD");
});

test("project urgency and progress stay synchronized with active issue state", () => {
  const tasks = [
    { status: "todo", priority: "medium" },
    { status: "in_progress", priority: "urgent" },
    { status: "done", priority: "urgent" },
    { status: "canceled", priority: "urgent" },
  ];
  assert.deepEqual(projectUrgency(tasks), { value: "urgent", source: "issues" });
  assert.deepEqual(projectUrgency(tasks, "low"), { value: "low", source: "manual" });
  assert.deepEqual(projectProgress(tasks), {
    total: 3,
    done: 1,
    percent: 33,
    inProgress: 1,
    inReview: 0,
    blocked: 0,
  });
});

test("workspace filtering handles macOS and Windows separators", () => {
  assert.equal(normalizedWorkspacePath("C:\\Projects\\Drama\\"), "c:/projects/drama");
  assert.equal(workspaceMatchesFilter("C:\\Projects\\Drama\\Episode-1", "c:/projects/drama"), true);
  assert.equal(workspaceMatchesFilter("/Users/demo/Drama/Episode-1", "/Users/demo/Drama"), true);
  assert.equal(workspaceMatchesFilter("/Users/demo/Assets", "/Users/demo/Drama"), false);
});
