import assert from "node:assert/strict";
import test from "node:test";

import {
  LIVE_TASK_STATUSES,
  bootstrapRemoteHistory,
  completionKind,
  taskAttentionLabel,
  readLiveView,
  saveLiveView,
  LIVE_VIEW_KEY,
  liveTaskStatus as statusWithExpiry,
  liveStateRuntimeSource,
  sortLiveTasks,
  visibleLiveTasks,
} from "../nuyoah/taskboard/live-state.mjs";

// Existing status cases exercise manual handling with expiry disabled.
const liveTaskStatus = (task, meta, now = Date.now(), hours = 0) => statusWithExpiry(task, meta, now, hours);

test("native input and approval waits require attention until resolved even if previously confirmed", () => {
  const meta = { seenAt: "2026-09-11T01:00:00Z", completedAt: "2026-09-11T02:00:00Z" };
  for (const waitingReason of ["input", "approval"]) {
    const task = { runtimeStatus: "running", waitingReason, updatedAt: meta.seenAt };
    assert.equal(liveTaskStatus(task, meta), "attention");
    assert.equal(taskAttentionLabel(task, meta), waitingReason === "input" ? "需要补充信息" : "等待授权");
    assert.equal(liveTaskStatus({ ...task, waitingReason: null }, meta), "running");
  }
  assert.equal(taskAttentionLabel({ hasFinalResponse: true }), "等待验收");
  assert.equal(taskAttentionLabel({ progress: "Please approve" }), "等待查看");
});

test("viewed history is separate from explicit old and new completion records without changing queues", () => {
  const task = { runtimeStatus: "completed", updatedAt: "2026-09-11T01:00:00Z" };
  const viewed = { seenAt: task.updatedAt };
  assert.equal(completionKind(viewed), "history");
  assert.equal(completionKind({ ...viewed, pinned: true, priority: "urgent" }), "history");
  assert.equal(completionKind({ ...viewed, initialRemoteHistory: true }), "history");
  assert.equal(completionKind({ ...viewed, manualPending: false, statusChangedAt: task.updatedAt }), "confirmed");
  assert.equal(completionKind({ ...viewed, initialRemoteHistory: true, completedAt: task.updatedAt }), "confirmed");
  assert.equal(liveTaskStatus(task, viewed), "completed");
  assert.equal(liveTaskStatus({ ...task, updatedAt: "2026-09-11T02:00:00Z" }, viewed), "attention");
});

test("saved filters, history expansion, counts and scroll survive reload while corrupt values reset", () => {
  assert.notEqual(LIVE_VIEW_KEY, "taskboard.codex-live-view.v1", "must not overwrite the orchestrator/all view selection");
  let raw = "";
  const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  const state = { projectAutoCompleteHours: 48, query: "design", projectId: "remote-project", historyOpen: true, visibleCounts: { history: 25, attention: 15 }, scrollTop: 722.5 };
  saveLiveView(storage, state);
  assert.deepEqual(readLiveView(storage), { ...state, historyOpenBySource: { project: true, chatgpt: true } });
  const separated = { ...state, historyOpenBySource: { project: true, chatgpt: false }, visibleCounts: { "project:attention": 15, "project:attention:local": 5, "project:attention:remote-fixture": 15, "chatgpt:attention": 5, "chatgpt:history": 25 } };
  saveLiveView(storage, separated);
  assert.deepEqual(readLiveView(storage), separated);
  raw = "broken";
  assert.equal(readLiveView(storage).scrollTop, 0);
  raw = JSON.stringify({ visibleCounts: { history: -4, attention: "50" }, query: {}, scrollTop: -100 });
  assert.deepEqual(readLiveView(storage).visibleCounts, {});
  assert.equal(readLiveView(storage).query, "");
});

test("first remote import treats old records as history while keeping today's new task and active work", () => {
  const cutoff = Date.parse("2026-09-11T00:00:00Z");
  const remote = { hostId: "remote-control:fixture", runtimeStatus: "completed", updatedAt: "2026-08-01T01:00:00Z", createdAt: "2026-08-01T00:00:00Z" };
  const tasks = [
    { ...remote, taskKey: "old" },
    { ...remote, taskKey: "new", createdAt: "2026-09-11T01:00:00Z" },
    { ...remote, taskKey: "active", runtimeStatus: "running" },
    { ...remote, taskKey: "manual" },
    { ...remote, taskKey: "local", hostId: "local" },
  ];
  const meta = { old: { pinned: true }, manual: { seenAt: "2026-08-01T01:00:00Z", manualPending: true } };
  const migrated = bootstrapRemoteHistory(tasks, meta, cutoff);
  assert.equal(liveTaskStatus(tasks[0], migrated.old), "completed");
  assert.equal(migrated.old.pinned, true);
  assert.equal(liveTaskStatus(tasks[1], migrated.new), "attention");
  assert.equal(liveTaskStatus(tasks[2], migrated.active), "running");
  assert.deepEqual(migrated.manual, meta.manual);
  assert.equal(migrated.local, undefined);
  assert.equal(bootstrapRemoteHistory(tasks, migrated, cutoff), migrated);
  assert.equal(liveTaskStatus({ ...tasks[0], updatedAt: "2026-09-12T00:00:00Z" }, migrated.old), "attention");
});

test("confirmed local work ignores catalog metadata changes but reopens for actual execution", () => {
  const meta = { seenAt: "2026-09-17T10:00:00Z", completedAt: "2026-09-17T10:01:00Z" };
  const task = { runtimeStatus: "completed", updatedAt: "2026-09-18T10:00:00Z", activityAt: "2026-09-17T09:59:00Z" };
  assert.equal(liveTaskStatus(task, meta), "completed");
  assert.equal(liveTaskStatus({ ...task, activityAt: null }, meta), "completed");
  assert.equal(liveTaskStatus({ ...task, activityAt: null }), "attention");
  assert.equal(liveTaskStatus({ ...task, activityAt: "2026-09-18T09:59:00Z" }, meta), "attention");
  assert.equal(liveTaskStatus({ ...task, runtimeStatus: "running" }, meta), "running");
  const precise = { ...meta, seenActivityAt: task.activityAt };
  assert.equal(liveTaskStatus({ ...task, activityAt: "2026-09-17T09:59:30Z" }, precise), "attention");
});

test("an old remote thread with new work is never bootstrapped into hidden history", () => {
  const task = { hostId: "remote", taskKey: "remote/resumed", runtimeStatus: "completed",
    createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-09-18T10:00:00Z" };
  const meta = bootstrapRemoteHistory([task], {}, Date.parse("2026-09-18T00:00:00Z"));
  assert.equal(meta[task.taskKey], undefined);
  assert.equal(liveTaskStatus(task, meta[task.taskKey]), "attention");
});

test("live task state keeps runtime truth ahead of local handling metadata", () => {
  assert.equal(liveTaskStatus({ runtimeStatus: "running" }, { manualPending: true }), "running");
  assert.equal(liveTaskStatus({ runtimeStatus: "failed", updatedAt: "2026-09-02T10:00:00Z" }, {
    seenAt: "2026-09-02T09:00:00Z",
  }), "failed");
  assert.equal(liveTaskStatus({ runtimeStatus: "failed", updatedAt: "2026-09-02T10:00:00Z" }, {
    seenAt: "2026-09-02T10:00:00Z",
  }), "completed");
  assert.equal(liveTaskStatus({ runtimeStatus: "completed", updatedAt: "2026-09-02T10:00:00Z" }, {
    seenAt: "2026-09-02T09:00:00Z",
  }), "attention");
  assert.equal(liveTaskStatus({ runtimeStatus: "completed", updatedAt: "2026-09-02T10:00:00Z" }, {
    seenAt: "2026-09-02T10:00:00Z",
  }), "completed");
});

test("manual pin and priority sort only within an already selected status", () => {
  const tasks = [
    { threadId: "normal", updatedAt: "2026-09-02T11:00:00Z" },
    { threadId: "urgent", updatedAt: "2026-09-02T09:00:00Z" },
    { threadId: "pinned", updatedAt: "2026-09-02T08:00:00Z" },
  ];
  assert.deepEqual(sortLiveTasks(tasks, {
    urgent: { priority: "urgent" },
    pinned: { pinned: true },
  }).map((task) => task.threadId), ["pinned", "urgent", "normal"]);
});

test("selecting the third task never promotes it in any of the four status columns", () => {
  for (const status of LIVE_TASK_STATUSES) {
    const tasks = [1, 2, 3, 4].map((position) => ({
      threadId: `${status}-${position}`,
      displayStatus: status,
    }));
    const selectedThreadId = `${status}-3`;
    const visible = visibleLiveTasks(tasks, 4);

    assert.equal(visible.findIndex((task) => task.threadId === selectedThreadId), 2, `${status} must keep the selected task third`);
    assert.deepEqual(visible.map((task) => task.threadId), tasks.map((task) => task.threadId));
  }
});


test("only idle ChatGPT attention expires after 72 hours without altering acknowledgements", () => {
  const now = Date.parse("2026-09-30T04:00:00Z");
  const threshold = now - 72 * 60 * 60 * 1000;
  const task = { source: "chatgpt", runtimeStatus: "completed", updatedAt: new Date(threshold).toISOString() };
  for (const state of [ { liveTaskStatus: statusWithExpiry, completionKind, bootstrapRemoteHistory }, (0, eval)(liveStateRuntimeSource()) ]) {
    const meta = { manualPending: true, pinned: true };
    assert.equal(state.liveTaskStatus(task, meta, now), "completed");
    assert.equal(state.completionKind(meta, task, now), "automatic");
    assert.deepEqual(meta, { manualPending: true, pinned: true });
    assert.equal(state.liveTaskStatus({ ...task, updatedAt: new Date(threshold + 1).toISOString() }, {}, now), "attention");
    assert.equal(state.liveTaskStatus({ ...task, updatedAt: new Date(threshold - 1).toISOString() }, {}, now), "completed");
    assert.equal(state.liveTaskStatus({ ...task, source: undefined }, {}, now, 0), "attention");
    assert.equal(state.liveTaskStatus({ ...task, runtimeStatus: "running" }, meta, now), "running");
    assert.equal(state.liveTaskStatus({ ...task, runtimeStatus: "failed" }, {}, now), "failed");
    assert.equal(state.liveTaskStatus({ ...task, updatedAt: "" }, {}, now), "attention");
    assert.equal(state.liveTaskStatus({ ...task, updatedAt: "invalid" }, {}, now), "attention");
    assert.equal(state.liveTaskStatus({ ...task, updatedAt: new Date(now + 1).toISOString() }, {}, now), "attention");
    const confirmed = { seenAt: task.updatedAt, completedAt: task.updatedAt };
    assert.equal(state.completionKind(confirmed, task, now), "confirmed");
    const previousConfirmation = { seenAt: new Date(threshold - 1000).toISOString(), completedAt: task.updatedAt };
    assert.equal(state.completionKind(previousConfirmation, task, now), "automatic");
    assert.equal(state.liveTaskStatus({ ...task, activityAt: new Date(now).toISOString() }, confirmed, now), "attention");
    assert.equal(state.liveTaskStatus({ ...task, updatedAt: new Date(now).toISOString(), activityAt: task.updatedAt }, {}, now), "completed");
    const imported = { seenAt: task.updatedAt, initialRemoteHistory: true };
    assert.equal(state.liveTaskStatus({ ...task, updatedAt: new Date(now - 48 * 3600000).toISOString() }, imported, now), "attention");
    assert.equal(state.bootstrapRemoteHistory([{ ...task, hostId: "chatgpt", taskKey: "chatgpt:fixture" }], meta, now), meta);
  }
});


test("project expiry is reversible, uses actual activity and respects runtime and manual resets", () => {
  const now = Date.parse("2026-10-13T10:00:00Z");
  const old = new Date(now - 48 * 3600000).toISOString();
  const task = { runtimeStatus: "completed", activityAt: old, updatedAt: new Date(now).toISOString() };
  for (const states of [{ liveTaskStatus: statusWithExpiry, completionKind }, (0, eval)(liveStateRuntimeSource())]) {
    assert.equal(states.liveTaskStatus(task, {}, now), "completed");
    assert.equal(states.completionKind({}, task, now), "automatic");
    assert.equal(states.liveTaskStatus(task, {}, now - 1), "attention");
    assert.equal(states.liveTaskStatus(task, {}, now, 0), "attention");
    assert.equal(states.liveTaskStatus(task, {}, now, 72), "attention");
    for (const runtimeStatus of ["running", "failed", "unknown"]) {
      assert.equal(states.liveTaskStatus({ ...task, runtimeStatus }, {}, now), runtimeStatus === "unknown" ? "attention" : runtimeStatus);
    }
    for (const waitingReason of ["input", "approval"]) assert.equal(states.liveTaskStatus({ ...task, waitingReason }, {}, now), "attention");
    for (const activityAt of [null, "invalid", new Date(now).toISOString()]) assert.equal(states.liveTaskStatus({ ...task, activityAt }, {}, now), "attention");
    const manual = { manualPending: true, statusChangedAt: new Date(now).toISOString() };
    assert.equal(states.liveTaskStatus(task, manual, now), "attention");
    assert.equal(states.liveTaskStatus(task, manual, now + 48 * 3600000), "completed");
    assert.equal(states.completionKind({ seenAt: old, initialHistory: true }, task, now), "history");
    assert.equal(states.completionKind({ seenAt: old, completedAt: old }, task, now), "confirmed");
    assert.equal(states.completionKind({ seenAt: new Date(now - 72 * 3600000).toISOString(), initialHistory: true }, task, now), "automatic");
  }
  let raw;
  const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  for (const hours of [0, 24, 48, 72, 168]) {
    saveLiveView(storage, { projectAutoCompleteHours: hours });
    assert.equal(readLiveView(storage).projectAutoCompleteHours, hours);
  }
});

test("read markers track clicks separately from handling and reopen on new activity", async () => {
  const { taskReadStatus } = await import('../nuyoah/taskboard/live-state.mjs');
  const task = { runtimeStatus: 'completed', activityAt: '2026-10-13T10:00:00Z', updatedAt: '2026-10-13T11:00:00Z' };
  assert.equal(taskReadStatus(task, { seenAt: task.updatedAt, completedAt: task.updatedAt }), 'unread');
  const meta = { viewedAt: '2026-10-13T12:00:00Z', viewedActivityAt: task.activityAt };
  assert.equal(taskReadStatus(task, meta), 'read');
  assert.equal(statusWithExpiry(task, meta, Date.parse(meta.viewedAt)), 'attention');
  assert.equal(taskReadStatus({ ...task, updatedAt: '2026-10-14T12:00:00Z' }, meta), 'read');
  assert.equal(taskReadStatus({ ...task, activityAt: '2026-10-13T10:01:00Z' }, meta), 'unread');
  assert.equal(taskReadStatus(task, {}), 'unread');
});
