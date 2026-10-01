import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readActiveTaskThreads, trustedTaskboardRuntimeBaseUrl } from "../lib/taskboard-status.mjs";

test("Taskboard status uses the authenticated runtime URL and returns active thread ids", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-taskboard-runtime-"));
  const runtimeFile = path.join(directory, "runtime.json");
  await writeFile(runtimeFile, JSON.stringify({ url: "http://127.0.0.1:47823/private-token-1234" }));
  const requests = [];
  try {
    const result = await readActiveTaskThreads({
      runtimeFile,
      fetchImpl: async (url) => {
        requests.push(url);
        return new Response(JSON.stringify({
          tasks: [
            { status: "in_progress", threadId: "thread-active" },
            { status: "done", threadId: "thread-done" },
            { status: "in_progress", threadId: null },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.deepEqual(result, { available: true, activeThreadIds: ["thread-active"] });
    assert.deepEqual(requests, ["http://127.0.0.1:47823/private-token-1234/api/tasks"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Taskboard status fails closed while the bundled runtime is still starting", async () => {
  const result = await readActiveTaskThreads({ runtimeFile: "/missing/runtime.json" });
  assert.deepEqual(result, { available: false, activeThreadIds: [] });
});

test("custom Taskboard root URL is trusted only with the enhancer marker and pinned version", () => {
  const descriptor = {
    managedBy: "codex-sidebar-enhancer",
    version: "0.2.0-codexoptimiz.20260831",
    url: "http://127.0.0.1:47823/",
  };
  assert.equal(trustedTaskboardRuntimeBaseUrl(descriptor), "http://127.0.0.1:47823");
  assert.equal(trustedTaskboardRuntimeBaseUrl({ ...descriptor, managedBy: "unknown" }), null);
  assert.equal(trustedTaskboardRuntimeBaseUrl({ ...descriptor, version: "0.1.0" }), null);
  assert.equal(trustedTaskboardRuntimeBaseUrl({ ...descriptor, url: "http://example.com/" }), null);
});
