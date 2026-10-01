import assert from "node:assert/strict";
import test from "node:test";
import { createRemoteTaskCatalog } from "../nuyoah/taskboard/remote-catalog.mjs";

const hostId = "remote-control:fixture";
const id = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const base = { id, name: "Remote task", updatedAt: 1789000000, cwd: "/work/example", projectId: "project", status: { type: "active" } };

test('stream deltas and identical statuses do not invalidate task views; real lifecycle changes still do', async () => {
  const changes = [];
  const catalog = createRemoteTaskCatalog({ includeLocal: true, onChange: change => changes.push(change),
    bridge: { getSharedObjectSnapshotValue: () => [] }, requestPage: async () => ({ data: [base], nextCursor: null }) });
  try {
    await catalog.refresh(); changes.length = 0;
    for (let i = 0; i < 1000; i++) catalog.handleMessage({ type: 'mcp-notification', hostId: 'local',
      method: 'item/agentMessage/delta', params: { threadId: id, delta: 'fictional stream' } });
    catalog.handleMessage({ type: 'mcp-notification', hostId: 'local', method: 'thread/status/changed', params: { threadId: id, status: base.status } });
    assert.equal(changes.length, 0);
    catalog.handleMessage({ type: 'mcp-notification', hostId: 'local', method: 'turn/completed', params: { threadId: id, turn: { status: 'completed' } } });
    assert.equal(changes.length, 1); assert.equal(changes[0].relationsChanged, true);
    assert.equal(catalog.localStatus(id).hasFinalResponse, true);
  } finally { catalog.dispose(); }
});

test('registered native transport never sends an unowned raw request', async () => {
  const calls = [];
  const bridge = { getSharedObjectSnapshotValue: () => [], sendMessageFromView() { throw new Error('raw transport used'); } };
  const catalog = createRemoteTaskCatalog({ bridge, includeLocal: true,
    requestPage: async (host, params) => {
      calls.push({ host, params });
      return { data: [{ ...base, preview: 'not retained' }], nextCursor: null };
    } });
  await catalog.refresh();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, 'local');
  assert.equal(calls[0].params.useStateDbOnly, true);
  assert.equal(catalog.localStatus(id).runtimeStatus, 'running');
  catalog.dispose();
});

test('closed workstation cancels native pages and relation refresh until reopened', async () => {
  const calls = [], timers = [];
  const bridge = { getSharedObjectSnapshotValue: () => [] };
  const catalog = createRemoteTaskCatalog({ bridge, includeLocal: true, initiallyActive: false,
    setRelationTimer: fn => { timers.push(fn); return timers.length; }, clearRelationTimer() {},
    requestPage: (host, params, { signal }) => new Promise(resolve => calls.push({ host, params, signal, resolve })) });
  catalog.setLocalRelationRoots([id]);
  await catalog.refresh();
  assert.equal(calls.length, 0);
  assert.equal(timers.length, 0);
  catalog.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  catalog.setActive(false);
  assert.ok(calls.every(call => call.signal.aborted));
  for (const call of calls) call.resolve({ data: [base], nextCursor: 'more-pages' });
  await new Promise(resolve => setImmediate(resolve));
  catalog.handleMessage({ type: 'codex-app-server-connection-changed', hostId: 'local', state: 'connected' });
  await catalog.refresh();
  assert.equal(calls.length, 2);
  assert.equal(catalog.localStatus(id), null);
  assert.equal(timers.length, 0);
  catalog.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 4);
  for (const call of calls.slice(2)) call.resolve({ data: [base], nextCursor: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(catalog.localStatus(id).runtimeStatus, 'running');
  catalog.dispose();
});

test('native timeout aborts its registered request and never falls back to raw transport', async () => {
  let signal, raw = 0;
  const catalog = createRemoteTaskCatalog({ includeLocal: true, timeoutMs: 5,
    bridge: { getSharedObjectSnapshotValue: () => [], sendMessageFromView() { raw++; } },
    requestPage: (_host, _params, options) => { signal = options.signal; return new Promise(() => {}); } });
  await catalog.refresh();
  assert.equal(signal.aborted, true);
  assert.equal(raw, 0);
  assert.equal(catalog.localStatus(id), null);
  catalog.dispose();
});

function fixture(reply, options = {}) {
  const configs = [{ hostId, displayName: "Test Mac", autoConnect: true, online: true }];
  const requests = [];
  let catalog;
  const bridge = {
    getSharedObjectSnapshotValue: (key) => key === "remote_control_connections" ? configs : [],
    sendMessageFromView: async (message) => {
      requests.push(message);
      const result = await reply(message.request.params, message, catalog);
      if (result === undefined) return;
      catalog.handleMessage({ type: "mcp-response", hostId: message.hostId, message: { id: message.request.id, ...result } });
    },
  };
  catalog = createRemoteTaskCatalog({ bridge, getProjects: () => [{ id: "project", name: "Example" }],
    refreshIntervalMs: 0, localRefreshIntervalMs: 0, retryBaseMs: 0, ...options });
  return { catalog, requests, configs };
}

function nativeTokens(value) {
  if (Array.isArray(value)) return [{ type: "array-start" }, ...value.flatMap(nativeTokens), { type: "container-end" }];
  if (value && typeof value === "object") return [{ type: "object-start" }, ...Object.entries(value).flatMap(([key, item]) => [{ type: "key", value: key }, ...nativeTokens(item)]), { type: "container-end" }];
  return [{ type: "value", value }];
}

test("large native chunked catalog replies retain owned metadata and skip conversation content", async () => {
  let privateRead = false;
  const { catalog } = fixture((params, request, api) => {
    const response = { type: "mcp-response", hostId, message: { id: request.request.id, result: {
      data: [{ ...base, preview: "private-body", turns: [{ text: "private-body" }] }], nextCursor: null,
    } } };
    const tokens = nativeTokens(response).map(token => token.value === "private-body"
      ? { type: "value", get value() { privateRead = true; throw new Error("Body must not be read"); } } : token);
    const header = { marker: "codex-host-chunked-message-v1", transferId: "transfer" };
    api.handleMessage({ ...header, sequence: 0, kind: "start" });
    let sequence = 1;
    for (let offset = 0; offset < tokens.length; offset += 7) api.handleMessage({ ...header, sequence: sequence++, kind: "chunk", tokens: tokens.slice(offset, offset + 7) });
    api.handleMessage({ ...header, sequence, kind: "end" });
    return undefined;
  }, { timeoutMs: 100 });
  await catalog.refresh();
  assert.equal(catalog.snapshot()[0].threadId, id);
  assert.equal(catalog.snapshot()[0].runtimeStatus, "running");
  assert.equal(privateRead, false);
  catalog.dispose();
});

test("unowned and incomplete chunk transfers never resolve a catalog request", async () => {
  const { catalog } = fixture((params, request, api) => {
    const header = { marker: "codex-host-chunked-message-v1", transferId: "foreign" };
    api.handleMessage({ ...header, sequence: 0, kind: "start" });
    api.handleMessage({ ...header, sequence: 1, kind: "chunk", tokens: nativeTokens({ type: "mcp-response", hostId: "other", message: { id: request.request.id, result: { data: [base] } } }) });
    api.handleMessage({ ...header, sequence: 2, kind: "end" });
    api.handleMessage({ ...header, transferId: "missing-chunk", sequence: 0, kind: "start" });
    api.handleMessage({ ...header, transferId: "missing-chunk", sequence: 2, kind: "end" });
    return undefined;
  }, { timeoutMs: 10 });
  await catalog.refresh();
  assert.equal(catalog.snapshot().length, 0);
  assert.equal(catalog.syncState().length, 1);
  catalog.dispose();
});

for (const transport of ["plain", "chunked"]) test(`${transport} native catalog retains only valid parent and fork identities without conversation or global state`, async () => {
  const ancestor = "ABCDEFAB-1234-4123-8123-ABCDEFABCDEF";
  let privateRead = false;
  const { catalog } = fixture((params, request, api) => {
    const response = { type: "mcp-response", hostId: request.hostId, message: { id: request.request.id, result: {
      data: [
        { ...base, parentThreadId: id2, forkedFromId: ancestor, preview: "private-body", turns: [{ text: "private-body" }], globalState: { text: "private-body" } },
        { ...base, id: id2, parentThreadId: "not-a-uuid", forkedFromId: { id }, preview: "private-body" },
      ], nextCursor: null,
    } } };
    if (transport === "plain") {
      for (const item of response.message.result.data) for (const name of ["preview", "turns", "globalState"]) Object.defineProperty(item, name, {
        get() { privateRead = true; throw new Error("Unrelated content must not be read"); },
      });
      return { result: response.message.result };
    }
    const tokens = nativeTokens(response).map(token => token.value === "private-body"
      ? { type: "value", get value() { privateRead = true; throw new Error("Unrelated content must not be read"); } } : token);
    const header = { marker: "codex-host-chunked-message-v1", transferId: request.request.id };
    api.handleMessage({ ...header, sequence: 0, kind: "start" });
    api.handleMessage({ ...header, sequence: 1, kind: "chunk", tokens });
    api.handleMessage({ ...header, sequence: 2, kind: "end" });
    return undefined;
  }, { includeLocal: true, timeoutMs: 100 });
  try {
    await catalog.refresh();
    const tasks = catalog.snapshot(), valid = tasks.find(task => task.threadId === id), invalid = tasks.find(task => task.threadId === id2);
    assert.equal(valid.hostId, hostId); assert.equal(valid.parentThreadId, id2); assert.equal(valid.forkedFromId, ancestor.toLowerCase());
    assert.equal(Object.hasOwn(invalid, "parentThreadId"), false); assert.equal(Object.hasOwn(invalid, "forkedFromId"), false);
    assert.equal(privateRead, false); assert.doesNotMatch(JSON.stringify(tasks), /private-body|preview|turns|globalState/);
    assert.deepEqual(catalog.localStatus(id), { runtimeStatus: "running", waitingReason: null, hasFinalResponse: false, finalAt: null });
  } finally { catalog.dispose(); }
});

test("interleaved local, remote and unrelated chunks do not erase an owned response", async () => {
  const { catalog, requests } = fixture(() => undefined, { includeLocal: true, timeoutMs: 100 });
  const work = catalog.refresh();
  assert.equal(requests.length, 2);
  const streams = requests.map((request, i) => ({
    header: { marker: "codex-host-chunked-message-v1", transferId: `owned-${i}` },
    tokens: nativeTokens({ type: "mcp-response", hostId: request.hostId, message: {
      id: request.request.id, result: { data: [base], nextCursor: null },
    } }),
  }));
  for (const stream of streams) catalog.handleMessage({ ...stream.header, sequence: 0, kind: "start" });
  catalog.handleMessage({ marker: "codex-host-chunked-message-v1", transferId: "unrelated", sequence: 0, kind: "start" });
  for (let i = 0; i < streams[0].tokens.length; i++) {
    for (const stream of streams) catalog.handleMessage({ ...stream.header, sequence: i + 1, kind: "chunk", tokens: [stream.tokens[i]] });
  }
  for (const stream of streams) catalog.handleMessage({ ...stream.header, sequence: stream.tokens.length + 1, kind: "end" });
  await work;
  assert.equal(catalog.snapshot()[0]?.runtimeStatus, "running");
  assert.equal(catalog.localStatus(id)?.runtimeStatus, "running");
  assert.deepEqual(catalog.syncState(), []);
  catalog.dispose();
});

test("notifications stay immediate while successful full scans are spaced two minutes apart", async () => {
  let clock = 1789000000000;
  const { catalog, requests } = fixture(() => ({ result: { data: [base], nextCursor: null } }),
    { now: () => clock, refreshIntervalMs: 120_000 });
  await catalog.refresh();
  for (let i = 0; i < 7; i++) { clock += 15_000; await catalog.refresh(); }
  assert.equal(requests.length, 1);
  catalog.handleMessage({ type: "mcp-notification", hostId, method: "turn/completed", params: { threadId: id, turn: { status: "completed" } } });
  assert.equal(catalog.snapshot()[0].runtimeStatus, "completed");
  clock += 15_000;
  await catalog.refresh();
  assert.equal(requests.length, 2);
  catalog.dispose();
});

test("failed scans back off 15, 30, 60 and 120 seconds and retain a complete snapshot", async () => {
  let clock = 1789000000000, fail = false;
  const { catalog, requests } = fixture(() => fail ? { error: {} } : { result: { data: [base], nextCursor: null } },
    { now: () => clock, retryBaseMs: 15_000, maxRetryMs: 120_000 });
  await catalog.refresh();
  fail = true;
  await catalog.refresh();
  let expectedRequests = 2;
  for (const delay of [15_000, 30_000, 60_000, 120_000, 120_000]) {
    assert.equal(catalog.syncState()[0].phase, "retrying");
    assert.equal(catalog.syncState()[0].hasSnapshot, true);
    assert.equal(catalog.snapshot()[0].runtimeStatus, "unknown");
    clock += delay - 1;
    await catalog.refresh();
    assert.equal(requests.length, expectedRequests);
    clock++;
    await catalog.refresh();
    assert.equal(requests.length, ++expectedRequests);
  }
  fail = false;
  clock += 120_000;
  await catalog.refresh();
  assert.deepEqual(catalog.syncState(), []);
  catalog.dispose();
});

test("native disconnect cancels in-flight scans and reconnect immediately replaces them", async () => {
  const { catalog, requests } = fixture(() => undefined, { refreshIntervalMs: 120_000 });
  const work = catalog.refresh();
  catalog.handleMessage({ type: "codex-app-server-connection-changed", hostId, state: "error" });
  assert.equal(catalog.syncState()[0].phase, "disconnected");
  await catalog.refresh();
  assert.equal(requests.length, 1);
  catalog.handleMessage({ type: "codex-app-server-connection-changed", hostId, state: "connecting" });
  assert.equal(catalog.syncState()[0].phase, "connecting");
  await catalog.refresh();
  assert.equal(requests.length, 1);
  catalog.handleMessage({ type: "codex-app-server-connection-changed", hostId, state: "connected" });
  assert.equal(requests.length, 2);
  await work; // The cancelled scan must not clear the replacement's loading flag.
  assert.equal(catalog.syncState()[0].loading, true);
  catalog.handleMessage({ type: "mcp-response", hostId, message: { id: requests[0].request.id, result: { data: [base] } } });
  assert.equal(catalog.snapshot().length, 0);
  catalog.handleMessage({ type: "mcp-response", hostId, message: { id: requests[1].request.id, result: { data: [{ ...base, id: id2 }] } } });
  await new Promise(setImmediate);
  assert.deepEqual(catalog.syncState(), []);
  assert.equal(catalog.snapshot()[0].threadId, id2);
  catalog.dispose();
});

test("offline and disabled hosts stop scans without accepting a late success", async () => {
  const { catalog, configs, requests } = fixture(() => undefined);
  const work = catalog.refresh();
  configs[0].online = false;
  await catalog.refresh();
  await work;
  assert.equal(catalog.syncState()[0].phase, "offline");
  catalog.handleMessage({ type: "mcp-response", hostId, message: { id: requests[0].request.id, result: { data: [base] } } });
  assert.equal(catalog.snapshot().length, 0);
  configs[0].autoConnect = false;
  await catalog.refresh();
  assert.equal(catalog.syncState()[0].phase, "paused");
  assert.equal(requests.length, 1);
  catalog.dispose();
});

test("whole-scan deadline prevents endless distinct cursors from keeping loading alive", async () => {
  let clock = 1789000000000, slow = false;
  const { catalog, requests } = fixture(() => {
    if (slow) clock += 30_000;
    return { result: { data: [slow ? { ...base, id: id2 } : base], nextCursor: slow ? String(clock) : null } };
  }, { now: () => clock, scanTimeoutMs: 60_000 });
  await catalog.refresh();
  slow = true;
  await catalog.refresh();
  assert.equal(requests.length, 3);
  assert.equal(catalog.snapshot()[0].threadId, id);
  assert.equal(catalog.syncState()[0].phase, "retrying");
  assert.equal(catalog.syncState()[0].loading, false);
  catalog.dispose();
});

test("native local metadata and remote flag-only changes track unresolved waits without importing local cards", async () => {
  const { catalog } = fixture(() => ({ result: { data: [{ ...base, status: { type: "active", activeFlags: ["waitingOnApproval"] } }], nextCursor: null } }), { includeLocal: true });
  await catalog.refresh();
  assert.equal(catalog.snapshot().length, 1);
  assert.equal(catalog.snapshot()[0].waitingReason, "approval");
  assert.equal(catalog.localStatus(id).waitingReason, "approval");
  for (const target of [hostId, "local"]) {
    catalog.handleMessage({ type: "mcp-notification", hostId: target, method: "thread/status/changed", params: { threadId: id, status: { type: "active", activeFlags: ["waitingOnUserInput"] } } });
  }
  assert.equal(catalog.snapshot()[0].waitingReason, "input");
  assert.equal(catalog.localStatus(id).waitingReason, "input");
  catalog.handleMessage({ type: "mcp-notification", hostId, method: "thread/status/changed", params: { threadId: id, status: { type: "active", activeFlags: [] } } });
  assert.equal(catalog.snapshot()[0].waitingReason, null);
  catalog.handleMessage({ type: "codex-app-server-connection-changed", hostId: "local", state: "disconnected" });
  assert.equal(catalog.localStatus(id), null);
  catalog.dispose();
});

test("ordinary local and remote scans preserve their existing request contract and never import local cards", async () => {
  let privateRead = false;
  const child = { ...base, id: id2, name: "Child conversation", source: { subAgent: { thread_spawn: { parent_thread_id: id } } },
    get preview() { privateRead = true; throw new Error("Conversation preview must not be read"); },
    get turns() { privateRead = true; throw new Error("Conversation turns must not be read"); } };
  const { catalog, requests } = fixture((params, request) => ({ result: request.hostId === "local"
    ? params.cursor ? { data: [child], nextCursor: null } : { data: [base], nextCursor: "children" }
    : { data: [base], nextCursor: null } }), { includeLocal: true });
  try {
    await catalog.refresh();
    const local = requests.filter(request => request.hostId === "local"), remote = requests.filter(request => request.hostId === hostId);
    assert.equal(local.length, 2); assert.equal(local[1].request.params.cursor, "children");
    for (const request of local) {
      assert.equal(request.request.method, "thread/list"); assert.equal(request.request.params.useStateDbOnly, true);
      assert.equal(request.request.params.sourceKinds, undefined); assert.equal(request.request.params.ancestorThreadId, undefined);
    }
    assert.equal(remote.length, 1);
    assert.deepEqual(remote[0].request.params, { archived: false, limit: 100, sortKey: "updated_at", sortDirection: "desc", useStateDbOnly: true });
    assert.deepEqual(catalog.localStatus(id2), { runtimeStatus: "running", waitingReason: null, hasFinalResponse: false, finalAt: null });
    assert.deepEqual(catalog.snapshot().map(task => [task.hostId, task.threadId]), [[hostId, id]]);
    assert.equal(privateRead, false);
  } finally { catalog.dispose(); }
});

test("native child notifications track running, input and approval waits, completion and a new turn through localStatus only", async () => {
  const now = 1789000010000;
  const { catalog } = fixture((params, request) => ({ result: { data: request.hostId === "local"
    ? [{ ...base, id: id2, status: { type: "idle" } }] : [], nextCursor: null } }), { includeLocal: true, now: () => now });
  const notify = (method, params) => catalog.handleMessage({ type: "mcp-notification", hostId: "local", method, params: { threadId: id2, ...params } });
  try {
    await catalog.refresh(); assert.deepEqual(catalog.localStatus(id2), { runtimeStatus: "completed", waitingReason: null, hasFinalResponse: false, finalAt: null });
    notify("turn/started", {}); assert.deepEqual(catalog.localStatus(id2), { runtimeStatus: "running", waitingReason: null, hasFinalResponse: false, finalAt: null });
    notify("thread/status/changed", { status: { type: "active", activeFlags: ["waitingOnUserInput"] } });
    assert.deepEqual(catalog.localStatus(id2), { runtimeStatus: "running", waitingReason: "input", hasFinalResponse: false, finalAt: null });
    notify("thread/status/changed", { status: { type: "active", activeFlags: ["waitingOnApproval"] } });
    assert.deepEqual(catalog.localStatus(id2), { runtimeStatus: "running", waitingReason: "approval", hasFinalResponse: false, finalAt: null });
    notify("turn/completed", { turn: { status: "completed" } });
    assert.deepEqual(catalog.localStatus(id2), { runtimeStatus: "completed", waitingReason: null, hasFinalResponse: true, finalAt: now });
    notify("turn/started", {}); assert.deepEqual(catalog.localStatus(id2), { runtimeStatus: "running", waitingReason: null, hasFinalResponse: false, finalAt: null });
    assert.deepEqual(catalog.snapshot(), []);
  } finally { catalog.dispose(); }
});

test("disconnected local child states stay unavailable despite late notifications until a successful reconnect scan", async () => {
  let status = "active";
  const { catalog } = fixture((params, request) => ({ result: { data: request.hostId === "local"
    ? [{ ...base, id: id2, status: { type: status } }] : [], nextCursor: null } }), { includeLocal: true, now: () => 1789000010000 });
  try {
    await catalog.refresh(); assert.equal(catalog.localStatus(id2).runtimeStatus, "running");
    catalog.handleMessage({ type: "mcp-notification", hostId: "local", method: "turn/started", params: { threadId: id2 } });
    catalog.handleMessage({ type: "codex-app-server-connection-changed", hostId: "local", state: "disconnected" });
    assert.equal(catalog.localStatus(id2), null);
    catalog.handleMessage({ type: "mcp-notification", hostId: "local", method: "turn/started", params: { threadId: id2 } });
    assert.equal(catalog.localStatus(id2), null);
    status = "idle";
    catalog.handleMessage({ type: "codex-app-server-connection-changed", hostId: "local", state: "connected" });
    await new Promise(setImmediate);
    assert.deepEqual(catalog.localStatus(id2), { runtimeStatus: "completed", waitingReason: null, hasFinalResponse: false, finalAt: null });
    assert.deepEqual(catalog.snapshot(), []);
  } finally { catalog.dispose(); }
});

test("observed remote completion survives catalog refresh but is cleared on a new turn", async () => {
  const now = 1789000010000;
  const { catalog } = fixture(() => ({ result: { data: [{ ...base, status: { type: "idle" } }], nextCursor: null } }), { now: () => now });
  await catalog.refresh();
  catalog.handleMessage({ type: "mcp-notification", hostId, method: "turn/completed", params: { threadId: id, turn: { status: "completed" } } });
  assert.equal(catalog.snapshot()[0].hasFinalResponse, true);
  await catalog.refresh();
  assert.equal(catalog.snapshot()[0].hasFinalResponse, true);
  catalog.handleMessage({ type: "mcp-notification", hostId, method: "turn/started", params: { threadId: id } });
  assert.equal(catalog.snapshot()[0].hasFinalResponse, false);
  catalog.dispose();
});

test("local completion evidence requires a successful turn and is cleared by failure, unknown status and a newer snapshot", async () => {
  let clock = 1789000010000, status = "notLoaded", updatedAt = base.updatedAt;
  const { catalog } = fixture((params, request) => ({ result: { data: request.hostId === "local"
    ? [{ ...base, id: id2, updatedAt, status: { type: status } }] : [], nextCursor: null } }),
  { includeLocal: true, now: () => clock });
  const notify = (method, params) => catalog.handleMessage({ type: "mcp-notification", hostId: "local", method, params: { threadId: id2, ...params } });
  try {
    await catalog.refresh(); assert.equal(catalog.localStatus(id2).hasFinalResponse, false);
    notify("turn/completed", { turn: { status: "completed" } });
    assert.equal(catalog.localStatus(id2).hasFinalResponse, true);
    assert.equal(catalog.localStatus(id2).finalAt, clock);
    status = "idle"; await catalog.refresh(); assert.equal(catalog.localStatus(id2).hasFinalResponse, true);
    notify("thread/status/changed", { status: { type: "systemError" } });
    assert.deepEqual(catalog.localStatus(id2), { runtimeStatus: "failed", waitingReason: null, hasFinalResponse: false, finalAt: null });
    notify("turn/completed", { turn: { status: "completed" } });
    notify("thread/status/changed", { status: { type: "unrecognized" } });
    assert.equal(catalog.localStatus(id2).hasFinalResponse, false);
    notify("turn/completed", { turn: { status: "completed" } });
    clock += 1000; updatedAt = clock; await catalog.refresh();
    assert.deepEqual(catalog.localStatus(id2), { runtimeStatus: "completed", waitingReason: null, hasFinalResponse: false, finalAt: null });
    notify("turn/completed", { turn: { status: "interrupted" } });
    assert.equal(catalog.localStatus(id2).hasFinalResponse, false);
  } finally { catalog.dispose(); }
});

test("scoped local completion evidence is unavailable after expiry or disconnection and cannot be revived by a late notification", async () => {
  let clock = 1789000010000;
  const { catalog } = fixture(params => ({ result: { data: params.ancestorThreadId
    ? [{ ...base, id: id2, parentThreadId: id, status: { type: "idle" } }] : [], nextCursor: null } }),
  { includeLocal: true, now: () => clock });
  const complete = () => catalog.handleMessage({ type: "mcp-notification", hostId: "local", method: "turn/completed", params: { threadId: id2, turn: { status: "completed" } } });
  try {
    catalog.setLocalRelationRoots([id]); await catalog.refresh();
    assert.equal(catalog.localStatus(id2).hasFinalResponse, false);
    complete(); assert.equal(catalog.localStatus(id2).hasFinalResponse, true);
    clock += 15_000; assert.equal(catalog.localStatus(id2), null);
    await catalog.refresh(); assert.equal(catalog.localStatus(id2).hasFinalResponse, true);
    catalog.handleMessage({ type: "codex-app-server-connection-changed", hostId: "local", state: "disconnected" });
    complete(); assert.equal(catalog.localStatus(id2), null);
  } finally { catalog.dispose(); }
});

test("remote catalog reads every page with native host identity and only retains metadata", async () => {
  const { catalog, requests } = fixture((params) => ({ result: params.cursor
    ? { data: [{ ...base, id: id2, status: { type: "idle" }, updatedAt: 1789000000000 }], nextCursor: null }
    : { data: [{ ...base, preview: "private prompt", turns: [{ private: true }] }], nextCursor: "next" } }));
  await catalog.refresh();
  assert.equal(requests.length, 2);
  assert.ok(requests.every(r => r.hostId === hostId && r.request.method === "thread/list" && r.request.params.archived === false));
  assert.equal(requests[1].request.params.cursor, "next");
  const tasks = catalog.snapshot();
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].taskKey, `${hostId}/${id}`);
  assert.equal(tasks[0].runtimeStatus, "running");
  assert.equal(tasks[0].projectName, "Example");
  assert.equal(tasks[0].updatedAt, tasks[1].updatedAt);
  assert.equal(tasks[0].workspacePathStatus, "unknown");
  assert.doesNotMatch(JSON.stringify(tasks), /private/);
  catalog.dispose();
});

test("notification during pagination wins over a stale list result", async () => {
  const { catalog } = fixture((params, message, api) => {
    if (params.cursor) api.handleMessage({ type: "mcp-notification", hostId, method: "turn/completed", params: { threadId: id, turn: { status: "failed" } } });
    return { result: { data: params.cursor ? [] : [base], nextCursor: params.cursor ? null : "next" } };
  });
  await catalog.refresh();
  assert.equal(catalog.snapshot()[0].runtimeStatus, "failed");
  catalog.dispose();
});

test("disconnect keeps the last complete catalog without reporting running or failed; reconnect reconciles archives", async () => {
  let fail = false;
  let archived = false;
  const { catalog, configs } = fixture(() => fail ? { error: {} } : { result: { data: archived ? [] : [base], nextCursor: null } });
  await catalog.refresh();
  fail = true;
  await catalog.refresh();
  assert.equal(catalog.snapshot().length, 1);
  assert.equal(catalog.snapshot()[0].runtimeStatus, "unknown");
  configs[0].online = false;
  await catalog.refresh();
  assert.equal(catalog.snapshot()[0].statusAvailable, false);
  configs[0].online = true;
  fail = false;
  archived = true;
  await catalog.refresh();
  assert.equal(catalog.snapshot().length, 0);
  catalog.dispose();
});

test("repeated cursors never replace a complete catalog with partial results", async () => {
  let loop = false;
  const { catalog } = fixture(() => ({ result: { data: [loop ? { ...base, id: id2 } : base], nextCursor: loop ? "loop" : null } }));
  await catalog.refresh();
  loop = true;
  await catalog.refresh();
  assert.deepEqual(catalog.snapshot().map(t => t.threadId), [id]);
  assert.equal(catalog.snapshot()[0].statusAvailable, false);
  catalog.dispose();
});

test("native notifications update status and archive only the matching host", async () => {
  const { catalog } = fixture(() => ({ result: { data: [base], nextCursor: null } }));
  await catalog.refresh();
  catalog.handleMessage({ type: "mcp-notification", hostId: "remote-control:other", method: "thread/archived", params: { threadId: id } });
  assert.equal(catalog.snapshot().length, 1);
  catalog.handleMessage({ type: "mcp-notification", hostId, method: "thread/status/changed", params: { threadId: id, status: { type: "idle" } } });
  assert.equal(catalog.snapshot()[0].runtimeStatus, "completed");
  catalog.handleMessage({ type: "mcp-notification", hostId, method: "thread/archived", params: { threadId: id } });
  assert.equal(catalog.snapshot().length, 0);
  catalog.dispose();
});

test("a newly added remote project's native membership beats the session working directory", async () => {
  const { catalog } = fixture(() => ({ result: { data: [{ ...base, projectId: null }], nextCursor: null } }), {
    getProjects: () => [
      { id: "other-device", name: "Other", hostId: "remote-control:other", path: base.cwd },
      { id: "new-project", name: "New project", hostId, path: "/project/root", threadIds: [id] },
    ],
  });
  await catalog.refresh();
  assert.equal(catalog.snapshot()[0].projectId, "new-project");
  assert.equal(catalog.snapshot()[0].projectName, "New project");
  catalog.dispose();
});

test("failed remote turns remain failed through idle notifications and list refresh until another run", async () => {
  const { catalog } = fixture(() => ({ result: { data: [{ ...base, status: { type: "idle" } }], nextCursor: null } }));
  await catalog.refresh();
  catalog.handleMessage({ type: "mcp-notification", hostId, method: "turn/completed", params: { threadId: id, turn: { status: "failed" } } });
  catalog.handleMessage({ type: "mcp-notification", hostId, method: "thread/status/changed", params: { threadId: id, status: { type: "idle" } } });
  await catalog.refresh();
  assert.equal(catalog.snapshot()[0].runtimeStatus, "failed");
  catalog.handleMessage({ type: "mcp-notification", hostId, method: "turn/started", params: { threadId: id } });
  assert.equal(catalog.snapshot()[0].runtimeStatus, "running");
  catalog.dispose();
});

test("disposal settles in-flight requests and the renderer factory is self-contained", async () => {
  const factory = (0, eval)(`(${createRemoteTaskCatalog.toString()})`);
  assert.equal(typeof factory, "function");
  const { catalog } = fixture(() => undefined);
  const refreshing = catalog.refresh();
  catalog.dispose();
  await refreshing;
  assert.deepEqual(catalog.snapshot(), []);
});

test("remote inventory excludes old unadded projects but retains genuinely running tasks", async () => {
  const { catalog } = fixture(() => ({ result: { data: [
    { ...base, id, projectId: "old-project", status: { type: "idle" } },
    { ...base, id: id2, projectId: "old-project", status: { type: "active" } },
  ], nextCursor: null } }));
  await catalog.refresh();
  assert.deepEqual(catalog.snapshot().map(t => t.threadId), [id2]);
  catalog.dispose();
});

test("an admitted remote worker survives completion, disconnect and refresh until archived", async () => {
  let status = "active", fail = false;
  const { catalog } = fixture(() => fail ? { error: {} } : { result: { data: [
    { ...base, projectId: "unassigned", status: { type: status } },
  ], nextCursor: null } }, { getProjects: () => [] });
  await catalog.refresh();
  assert.equal(catalog.snapshot().length, 1);
  catalog.handleMessage({ type: "mcp-notification", hostId, method: "turn/completed", params: { threadId: id, turn: { status: "completed" } } });
  assert.equal(catalog.snapshot()[0].runtimeStatus, "completed");
  status = "idle";
  await catalog.refresh();
  assert.equal(catalog.snapshot().length, 1);
  fail = true;
  await catalog.refresh();
  assert.equal(catalog.snapshot()[0].runtimeStatus, "unknown");
  catalog.handleMessage({ type: "mcp-notification", hostId, method: "thread/archived", params: { threadId: id } });
  assert.equal(catalog.snapshot().length, 0);
  catalog.dispose();
});

test("hot reload retains only already admitted metadata for hosts still configured", async () => {
  const { catalog, configs } = fixture(() => ({ error: {} }), { initialTasks: [
    { hostId, threadId: id, runtimeStatus: "completed", updatedAt: "2026-09-18T10:00:00Z" },
    { hostId: "removed-host", threadId: id2, runtimeStatus: "completed" },
  ], getProjects: () => [] });
  await catalog.refresh();
  assert.deepEqual(catalog.snapshot().map(t => t.threadId), [id]);
  assert.equal(catalog.snapshot()[0].runtimeStatus, "unknown");
  assert.equal(catalog.syncState()[0].hasSnapshot, true);
  configs.length = 0;
  await catalog.refresh();
  assert.deepEqual(catalog.snapshot(), []);
  catalog.dispose();
});

test("native sidebar cache restores added-project tasks as unknown until a full scan succeeds", async () => {
  let fail = true;
  const { catalog } = fixture(() => fail ? { error: {} } : { result: { data: [], nextCursor: null } }, {
    initialCatalog: [
      { hostId, threadId: id, displayTitle: "Cached worker", cwd: "/work/example", sourceUpdatedAt: 1789000000 },
      { hostId, threadId: id2, displayTitle: "Unadded history", cwd: "/work/unadded", sourceUpdatedAt: 1789000000 },
    ], getProjects: () => [{ id: "project", hostId, path: "/work/example", name: "Example" }],
  });
  await catalog.refresh();
  assert.deepEqual(catalog.snapshot().map(t => t.threadId), [id]);
  assert.equal(catalog.snapshot()[0].runtimeStatus, "unknown");
  fail = false;
  await catalog.refresh();
  assert.deepEqual(catalog.snapshot(), []);
  catalog.dispose();
});

for (const transport of ["plain", "chunked"]) test(`${transport} local descendant scans start only for visible relation roots and retain metadata on every page`, async () => {
  let privateRead = false;
  const child = { ...base, id: id2, parentThreadId: id, status: { type: "active" }, preview: "private-body", turns: [{ text: "private-body" }] };
  const { catalog, requests } = fixture((params, request, api) => {
    const data = params.ancestorThreadId ? params.cursor ? [child] : [] : request.hostId === "local" ? [base] : [];
    const result = { data, nextCursor: params.ancestorThreadId && !params.cursor ? "descendants" : null };
    if (transport === "plain") {
      for (const item of data) for (const field of ["preview", "turns"]) if (item === child) Object.defineProperty(item, field, {
        configurable: true, get() { privateRead = true; throw new Error("No child bodies"); },
      });
      return { result };
    }
    const tokens = nativeTokens({ type: "mcp-response", hostId: request.hostId, message: { id: request.request.id, result } })
      .map(token => token.value === "private-body" ? { type: "value", get value() { privateRead = true; throw new Error("No child bodies"); } } : token);
    const header = { marker: "codex-host-chunked-message-v1", transferId: request.request.id };
    api.handleMessage({ ...header, sequence: 0, kind: "start" });
    api.handleMessage({ ...header, sequence: 1, kind: "chunk", tokens });
    api.handleMessage({ ...header, sequence: 2, kind: "end" });
  }, { includeLocal: true, localRefreshIntervalMs: 15_000, refreshIntervalMs: 120_000 });
  try {
    await catalog.refresh(); assert.equal(requests.some(request => request.request.params.ancestorThreadId), false);
    assert.equal(catalog.localStatus(id2), null);
    catalog.setLocalRelationRoots([id]); await catalog.refresh();
    const scoped = requests.filter(request => request.request.params.ancestorThreadId);
    assert.equal(scoped.length, 2);
    for (const request of scoped) {
      assert.equal(request.hostId, "local"); assert.equal(request.request.params.ancestorThreadId, id);
      assert.equal(request.request.params.useStateDbOnly, true); assert.ok(request.request.params.sourceKinds.includes("subAgentThreadSpawn"));
    }
    assert.equal(catalog.localStatus(id2).runtimeStatus, "running"); assert.deepEqual(catalog.snapshot(), []);
    assert.equal(privateRead, false);
    catalog.setLocalRelationRoots([id, id]); await catalog.refresh();
    assert.equal(requests.filter(request => request.request.params.ancestorThreadId).length, 2);
    catalog.setLocalRelationRoots([]); assert.equal(catalog.localStatus(id2), null);
  } finally { catalog.dispose(); }
});

test("relation status expires after fifteen seconds and failed scoped scans never fall back to a stale main running state", async () => {
  let clock = 1789000000000, fail = false, archived = false;
  const { catalog, requests } = fixture((params, request) => params.ancestorThreadId && fail ? { error: {} } : { result: {
    data: request.hostId === "local" && !(params.ancestorThreadId && archived) ? [{ ...base, id: id2 }] : [], nextCursor: null,
  } }, { includeLocal: true, now: () => clock, localRefreshIntervalMs: 120_000, refreshIntervalMs: 120_000, retryBaseMs: 15_000 });
  try {
    catalog.setLocalRelationRoots([id]); await catalog.refresh();
    assert.equal(catalog.localStatus(id2).runtimeStatus, "running");
    clock += 15_000; assert.equal(catalog.localStatus(id2), null);
    fail = true; await catalog.refresh(); assert.equal(catalog.localStatus(id2), null);
    const count = requests.length; clock += 14_999; await catalog.refresh(); assert.equal(requests.length, count);
    fail = false; clock++; await catalog.refresh(); assert.equal(catalog.localStatus(id2).runtimeStatus, "running");
    archived = true; clock += 15_000; await catalog.refresh(); assert.equal(catalog.localStatus(id2), null);
    assert.deepEqual(catalog.snapshot(), []);
  } finally { catalog.dispose(); }
});

test("relation notifications track real waits and completion, reject disconnected updates and refresh on reconnect", async () => {
  let clock = 1789000000000, state = "active";
  const { catalog } = fixture((params) => ({ result: { data: params.ancestorThreadId
    ? [{ ...base, id: id2, parentThreadId: id, status: { type: state } }] : [], nextCursor: null } }),
  { includeLocal: true, now: () => clock, localRefreshIntervalMs: 120_000, refreshIntervalMs: 120_000 });
  const notify = (method, params) => catalog.handleMessage({ type: "mcp-notification", hostId: "local", method, params: { threadId: id2, ...params } });
  try {
    catalog.setLocalRelationRoots([id]); await catalog.refresh();
    notify("thread/status/changed", { status: { type: "active", activeFlags: ["waitingOnUserInput"] } });
    assert.equal(catalog.localStatus(id2).waitingReason, "input");
    notify("thread/status/changed", { status: { type: "active", activeFlags: ["waitingOnApproval"] } });
    assert.equal(catalog.localStatus(id2).waitingReason, "approval");
    clock += 16_000; notify("turn/completed", { turn: { status: "completed" } });
    assert.equal(catalog.localStatus(id2).runtimeStatus, "completed");
    notify("turn/started", {}); assert.equal(catalog.localStatus(id2).runtimeStatus, "running");
    catalog.handleMessage({ type: "codex-app-server-connection-changed", hostId: "local", state: "disconnected" });
    notify("turn/started", {}); assert.equal(catalog.localStatus(id2), null);
    state = "idle";
    catalog.handleMessage({ type: "codex-app-server-connection-changed", hostId: "local", state: "connected" });
    await catalog.refresh(); assert.equal(catalog.localStatus(id2).runtimeStatus, "completed");
    assert.deepEqual(catalog.snapshot(), []);
  } finally { catalog.dispose(); }
});

test("clearing a relation root cancels only its owner and rejects late child responses without cancelling ordinary hosts", async () => {
  const { catalog, requests } = fixture(() => undefined, { includeLocal: true, timeoutMs: 100 });
  try {
    const normal = catalog.refresh();
    catalog.setLocalRelationRoots([id]);
    await new Promise(setImmediate);
    const scoped = requests.find(request => request.request.params.ancestorThreadId);
    catalog.setLocalRelationRoots([]);
    const respond = (request, data) => catalog.handleMessage({ type: "mcp-response", hostId: request.hostId,
      message: { id: request.request.id, result: { data, nextCursor: null } } });
    respond(scoped, [{ ...base, id: id2 }]);
    for (const request of requests.filter(request => !request.request.params.ancestorThreadId)) respond(request, [base]);
    await normal; await new Promise(setImmediate);
    assert.equal(catalog.localStatus(id).runtimeStatus, "running"); assert.equal(catalog.localStatus(id2), null);
    assert.deepEqual(catalog.snapshot().map(task => task.threadId), [id]);
  } finally { catalog.dispose(); }
});

test("relation roots are validated and capped at sixteen with four concurrent scoped scans", async () => {
  let active = 0, maximum = 0;
  const { catalog, requests } = fixture(async (params) => {
    if (params.ancestorThreadId) { active++; maximum = Math.max(maximum, active); await new Promise(setImmediate); active--; }
    return { result: { data: [], nextCursor: null } };
  }, { includeLocal: true });
  try {
    const roots = Array.from({ length: 22 }, (_, index) => `${(index + 1).toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`);
    catalog.setLocalRelationRoots(["invalid", roots[0], roots[0], ...roots]);
    await catalog.refresh();
    const scoped = requests.filter(request => request.request.params.ancestorThreadId);
    assert.equal(scoped.length, 16); assert.equal(new Set(scoped.map(request => request.request.params.ancestorThreadId)).size, 16);
    assert.equal(maximum, 4); assert.deepEqual(catalog.snapshot(), []);
  } finally { catalog.dispose(); }
});

test("scoped descendant paging has a sixteen-page budget and preserves unavailable status after an incomplete scan", async () => {
  let pages = 0, loop = false, clock = 1789000000000;
  const { catalog } = fixture((params) => ({ result: { data: params.ancestorThreadId ? [{ ...base, id: id2 }] : [],
    nextCursor: params.ancestorThreadId && loop ? `page-${++pages}` : null } }),
  { includeLocal: true, now: () => clock, localRefreshIntervalMs: 120_000, refreshIntervalMs: 120_000 });
  try {
    catalog.setLocalRelationRoots([id]); await catalog.refresh(); assert.equal(catalog.localStatus(id2).runtimeStatus, "running");
    loop = true; clock += 15_000; await catalog.refresh();
    assert.equal(pages, 16); assert.equal(catalog.localStatus(id2), null);
  } finally { catalog.dispose(); }
});

test("verified local child identity survives state expiry, failures and root unsubscribe without preserving running state", async () => {
  let clock = 1789000000000;
  const { catalog } = fixture(params => ({ result: { data: params.ancestorThreadId ? [{ ...base, id: id2 }] : [], nextCursor: null } }),
    { includeLocal: true, now: () => clock });
  try {
    catalog.setLocalRelationRoots([id]); await catalog.refresh();
    assert.equal(catalog.hasLocalThread(id2), true); assert.equal(catalog.hasLocalThread("invalid"), false);
    clock += 15_000; assert.equal(catalog.localStatus(id2), null); assert.equal(catalog.hasLocalThread(id2), true);
    catalog.handleMessage({ type: "codex-app-server-connection-changed", hostId: "local", state: "disconnected" });
    catalog.setLocalRelationRoots([]); assert.equal(catalog.localStatus(id2), null); assert.equal(catalog.hasLocalThread(id2), true);
    catalog.dispose(); assert.equal(catalog.hasLocalThread(id2), false); assert.equal(catalog.localStatus(id2), null);
  } finally { catalog.dispose(); }
});

test("unrelated thread-started notifications during a scoped scan never enter its child status cache", async () => {
  const third = "33333333-3333-4333-8333-333333333333";
  const { catalog } = fixture((params, request, api) => {
    if (!params.ancestorThreadId) return { result: { data: [], nextCursor: null } };
    api.handleMessage({ type: "mcp-notification", hostId: "local", method: "thread/started",
      params: { thread: { ...base, id: third, parentThreadId: "44444444-4444-4444-8444-444444444444" } } });
    return { result: { data: [{ ...base, id: id2, parentThreadId: id }], nextCursor: null } };
  }, { includeLocal: true });
  try {
    catalog.setLocalRelationRoots([id]); await catalog.refresh();
    assert.equal(catalog.localStatus(id2).runtimeStatus, "running");
    assert.equal(catalog.localStatus(third), null); assert.deepEqual(catalog.snapshot(), []);
  } finally { catalog.dispose(); }
});

test("relation deadlines refresh independently of a misaligned global tick and cancel timers without extending stale running state", async () => {
  let clock = 3000, sequence = 0, fail = false;
  const timers = new Map(), scannedAt = [];
  const { catalog } = fixture(params => {
    if (params.ancestorThreadId) scannedAt.push(clock);
    return params.ancestorThreadId && fail ? { error: {} } : { result: {
      data: params.ancestorThreadId ? [{ ...base, id: id2, parentThreadId: id }] : [], nextCursor: null,
    } };
  }, { includeLocal: true, now: () => clock, localRefreshIntervalMs: 120_000, refreshIntervalMs: 120_000,
    retryBaseMs: 15_000, setRelationTimer: (callback, delay) => {
      const timerId = ++sequence; timers.set(timerId, { callback, due: clock + delay }); return timerId;
    }, clearRelationTimer: timerId => timers.delete(timerId) });
  async function fireDue(at) {
    clock = at;
    for (const [timerId, timer] of [...timers]) if (timer.due <= clock) { timers.delete(timerId); timer.callback(); }
    await new Promise(setImmediate);
  }
  try {
    catalog.setLocalRelationRoots([id]); await catalog.refresh();
    assert.deepEqual(scannedAt, [3000]); assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].due, 18000);
    clock = 15000; await catalog.refresh(); // The independent global tick is too early.
    assert.deepEqual(scannedAt, [3000]); assert.equal([...timers.values()][0].due, 18000);
    await fireDue(18000);
    assert.deepEqual(scannedAt, [3000, 18000]); assert.equal(catalog.localStatus(id2).runtimeStatus, "running");
    const diagnostic = catalog.diagnostics().find(value => value.scope === "local-relations");
    assert.equal(diagnostic.rootThreadId, id); assert.equal(diagnostic.available, true); assert.equal(diagnostic.ageMs, 0);
    fail = true; await fireDue(33000);
    assert.equal(catalog.localStatus(id2), null); assert.equal([...timers.values()][0].due, 48000);
    assert.equal(catalog.diagnostics().find(value => value.scope === "local-relations").failures, 1);
    catalog.setLocalRelationRoots([]); await new Promise(setImmediate);
    assert.equal(timers.size, 0); await fireDue(48000); assert.deepEqual(scannedAt, [3000, 18000, 33000]);
    fail = false; catalog.setLocalRelationRoots([id]); await catalog.refresh(); assert.equal(timers.size, 1);
    catalog.handleMessage({ type: "codex-app-server-connection-changed", hostId: "local", state: "disconnected" });
    assert.equal(timers.size, 0);
    catalog.handleMessage({ type: "codex-app-server-connection-changed", hostId: "local", state: "connected" });
    await catalog.refresh(); assert.equal(timers.size, 1);
    catalog.dispose(); assert.equal(timers.size, 0);
  } finally { catalog.dispose(); }
});
