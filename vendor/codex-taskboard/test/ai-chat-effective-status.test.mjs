import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activeAiChatRun,
  effectiveAiChatThreadStatus,
} from "../web/src/aiChatState.ts";

function thread(status, currentRun = null) {
  return {
    id: "thread-1",
    title: "Conversation",
    status,
    origin: {
      projectId: "project-1",
      projectName: "Project",
      workspacePath: "/tmp/project",
    },
    codexThreadId: null,
    model: "gpt-5.6-sol",
    reasoningEffort: "low",
    sandbox: "danger-full-access",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    currentRun,
  };
}

function run(id, status) {
  return {
    id,
    threadId: "thread-1",
    status,
  };
}

test("completed run records override a stale running thread snapshot", () => {
  const staleRun = run("run-1", "running");
  const snapshot = {
    thread: thread("running", staleRun),
    events: [],
    runs: [run("run-1", "completed")],
  };

  assert.equal(activeAiChatRun(snapshot), null);
  assert.equal(effectiveAiChatThreadStatus(snapshot), "idle");
});

test("a genuinely running run keeps the conversation in processing state", () => {
  const runningRun = run("run-1", "running");
  const snapshot = {
    thread: thread("running", runningRun),
    events: [],
    runs: [runningRun],
  };

  assert.equal(activeAiChatRun(snapshot)?.id, "run-1");
  assert.equal(effectiveAiChatThreadStatus(snapshot), "running");
});

test("failed threads remain failed when no run is active", () => {
  const snapshot = {
    thread: thread("failed"),
    events: [],
    runs: [run("run-1", "failed")],
  };

  assert.equal(activeAiChatRun(snapshot), null);
  assert.equal(effectiveAiChatThreadStatus(snapshot), "failed");
});
