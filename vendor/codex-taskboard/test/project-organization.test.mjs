import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { createTaskboardServer } from "../server/index.mjs";

const runningApps = [];

afterEach(async () => {
  while (runningApps.length > 0) {
    const { app, directory } = runningApps.pop();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function startServer(configure) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-taskboard-organize-test-"));
  const options = configure ? await configure(directory) : {};
  const app = createTaskboardServer({
    dataDirectory: directory,
    codexStatePath: path.join(directory, "missing-codex-state.json"),
    ...options,
  });
  const address = await app.listen({ port: 0 });
  runningApps.push({ app, directory });
  return `http://127.0.0.1:${address.port}`;
}

async function request(baseUrl, pathname, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : undefined };
}

test("automation organization is a persisted issue type that can be edited", async () => {
  const baseUrl = await startServer();
  const created = await request(baseUrl, "/api/tasks", {
    method: "POST",
    body: {
      title: "整理历史项目",
      issueType: "automation_organization",
      status: "todo",
    },
  });

  assert.equal(created.response.status, 201);
  assert.equal(created.body.task.issueType, "automation_organization");

  const updated = await request(baseUrl, `/api/tasks/${created.body.task.id}`, {
    method: "PATCH",
    body: {
      version: created.body.task.version,
      issueType: "standard",
      threadId: "thread-edit-type",
    },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.task.issueType, "standard");
});

test("organizing project history classifies every unique project into todo exactly once", async () => {
  const baseUrl = await startServer();
  for (const project of [
    { id: "target", name: "为工作而奋斗", workspacePath: "/workspace/work" },
    { id: "rongshen", name: "熔神短剧", workspacePath: "/workspace/drama" },
  ]) {
    const created = await request(baseUrl, "/api/projects", { method: "POST", body: project });
    assert.equal(created.response.status, 201);
  }

  const organize = () => request(baseUrl, "/api/projects/target/organize-history", {
    method: "POST",
    body: {
      threadId: "thread-organize",
      projects: [
        { id: "duplicate-drama", name: "短剧副本", workspacePath: "/workspace/./drama/" },
      ],
    },
  });

  const first = await organize();
  assert.equal(first.response.status, 201);
  assert.deepEqual(
    {
      sourceCount: first.body.sourceCount,
      createdCount: first.body.createdCount,
      skippedCount: first.body.skippedCount,
    },
    { sourceCount: 3, createdCount: 3, skippedCount: 0 },
  );
  assert.equal(first.body.tasks.every((task) => task.status === "todo"), true);
  assert.equal(first.body.tasks.every((task) => task.issueType === "automation_organization"), true);

  const drama = first.body.tasks.find((task) => task.sourceProjectId === "rongshen");
  assert.ok(drama);
  assert.equal(drama.sourceWorkspacePath, "/workspace/drama");
  assert.equal(drama.projectCategory, "content-production");
  assert.equal(drama.classificationBasis.some((basis) => basis.includes("熔神")), true);

  const missingDirectory = first.body.tasks.find((task) => task.sourceProjectId === "local");
  assert.ok(missingDirectory);
  assert.equal(missingDirectory.sourceWorkspacePath, null);
  assert.match(missingDirectory.description, /待补充项目目录/);

  const second = await organize();
  assert.equal(second.response.status, 200);
  assert.deepEqual(
    {
      sourceCount: second.body.sourceCount,
      createdCount: second.body.createdCount,
      skippedCount: second.body.skippedCount,
    },
    { sourceCount: 3, createdCount: 0, skippedCount: 3 },
  );

  const tasks = await request(baseUrl, "/api/tasks?projectId=target&status=todo");
  assert.equal(tasks.response.status, 200);
  assert.equal(tasks.body.tasks.length, 3);
});

test("unknown issue types are rejected", async () => {
  const baseUrl = await startServer();
  const result = await request(baseUrl, "/api/tasks", {
    method: "POST",
    body: { title: "Invalid type", issueType: "magic" },
  });

  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, "INVALID_FIELD");
});

test("project organization includes Codex history that is not persisted in Taskboard", async () => {
  const baseUrl = await startServer(async (directory) => {
    const codexStatePath = path.join(directory, "codex-state.json");
    await writeFile(codexStatePath, JSON.stringify({
      "local-projects": {
        target: { id: "target", name: "Target from Codex", rootPaths: ["/workspace/target"] },
        historical: { id: "historical", name: "历史短剧", rootPaths: ["/workspace/history"] },
      },
    }));
    return { codexStatePath };
  });
  const target = await request(baseUrl, "/api/projects", {
    method: "POST",
    body: { id: "target", name: "Target", workspacePath: null },
  });
  assert.equal(target.response.status, 201);

  const result = await request(baseUrl, "/api/projects/target/organize-history", {
    method: "POST",
    body: { threadId: "thread-codex-history" },
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.sourceCount, 3);
  const historical = result.body.tasks.find((task) => task.sourceProjectId === "historical");
  assert.ok(historical);
  assert.equal(historical.sourceProjectName, "历史短剧");
  assert.equal(historical.sourceWorkspacePath, "/workspace/history");
  assert.equal(historical.projectCategory, "content-production");
});
