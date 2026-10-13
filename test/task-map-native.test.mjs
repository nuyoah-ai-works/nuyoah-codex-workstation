import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createNativeTaskMapAdapter } from '../nuyoah/workstation/task-map-native.mjs';

const threadId = '11111111-1111-4111-8111-111111111111';
const childId = '22222222-2222-4222-8222-222222222222';
const target = { hostId: 'local', threadId, title: '虚构任务' };
const entry = 'app://-/assets/index-fixture.js';
const moduleUrl = 'app://-/assets/app-initial-fixture.js';
const source = 'p=zE(({currentPermissions:e})=>e??null),c=zE(({latestCollaborationMode:e})=>e,eq),w=zE(({workspaceKind:e})=>e),a=sf($,({get:e})=>qv(e,Nr.THREAD_PROJECT_ASSIGNMENTS));export{p as permissions,c as collaboration,w as workspaceKind,a as assignments};';

function fixture(overrides = {}) {
  const calls = [], fetched = [], disposed = [];
  const permissions = { approvalPolicy: 'on-request', approvalsReviewer: 'user',
    sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/fixture/project'] }, runtimeWorkspaceRoots: ['/fixture/project'] };
  const mode = { mode: 'default', settings: { model: 'fixture-model', reasoning_effort: 'high', developer_instructions: null } };
  const selectors = { permissions: { resolve() {} }, collaboration: { resolve() {} }, workspaceKind: { resolve() {} }, assignments: { resolve() {} } };
  const methods = {
    readThread: async (id, options) => ({ thread: { id, name: '虚构本机任务', cwd: '/fixture/project', parentThreadId: childId, status: { type: 'idle' } } }),
    sendRequest: async (method, params) => method === 'thread/turns/list' ? { data: [{ id: 'fixture-turn', status: 'completed' }] }
      : { data: [{ turnId: 'fixture-turn', item: { type: 'agentMessage', phase: 'final_answer', text: '虚构最后成果' } }] },
    sendFollowUpMessage: async () => 'fixture-new-turn',
    resumeConversation: async () => ({ status: 'ready' }),
    getThreadExecutionState: async () => ({ latestModel: 'fixture-model', latestReasoningEffort: 'high' }),
    ...overrides.methods,
  };
  const client = Object.fromEntries(Object.entries(methods).map(([method, invoke]) => [method, (...args) => {
    calls.push({ method, args });
    const pending = Promise.resolve().then(() => invoke(...args));
    pending[Symbol.dispose] = () => disposed.push(method);
    return pending;
  }]));
  function managerGetter(scope, hostId) {
    if (!scope) throw new Error('AppServerManager RPC is not connected');
    return { forHost: () => client }.forHost(hostId);
  }
  async function nativeCreate(scope, hostId, params) {
    // Native discovery anchors: preparePrimaryRuntimeForFirstTurn readThreadCreationInputs .startConversation(
    calls.push({ method: 'nativeCreate', args: [hostId, params] });
    return overrides.create ? overrides.create(params) : { status: 'created', conversationId: childId,
      firstTurn: { status: 'accepted', turnId: 'fixture-child-turn' } };
  }
  const scope = { scope: { __scopeBrand: 'AppScope' }, queryClient: { getQueryCache: () => ({ getAll: () => overrides.queries || [] }) },
    query: { getOrFetch: async () => overrides.pins || [] }, get: selector => selector === selectors.permissions ? permissions
    : selector === selectors.workspaceKind ? 'project' : selector === selectors.assignments
      ? { [threadId]: { projectKind: 'local', projectId: 'fixture-project' } } : mode, set() {} };
  const window = { document: { scripts: [{ src: entry }] },
    __codexRoot: { _internalRoot: { current: { memoizedState: { memoizedState: { current: scope } } } } },
    fetch: async url => { fetched.push(url); return { ok: true, text: async () => url === entry ? 'import "./app-initial-fixture.js";' : source }; } };
  const loadModule = async url => {
    if (url === 'app://-/assets/app-shared-fixture.js') return { module: overrides.sharedModule || {} };
    assert.equal(url, moduleUrl);
    return { module: { managerGetter, nativeCreate, ...selectors, ...overrides.module }, source: overrides.source ?? source };
  };
  return { adapter: createNativeTaskMapAdapter({ window, loadModule }), window, scope, loadModule, calls, fetched, disposed, permissions, mode };
}

test('inspect dynamically resolves a current local asset and projects a bounded final only', async () => {
  const f = fixture();
  const result = await f.adapter.inspect(target);
  assert.equal(result.available, true);
  assert.deepEqual(result.target, { ...target, title: '虚构本机任务' });
  assert.equal(result.canCreate, true); assert.equal(result.parent, childId);
  assert.equal(result.resultText, '虚构最后成果');
  assert.deepEqual(f.fetched, [entry]);
  assert.deepEqual(f.calls.map(call => call.method), ['readThread', 'sendRequest', 'sendRequest']);
  assert.deepEqual(f.calls[0].args, [threadId, { includeTurns: false }]);
  assert.equal(f.calls[1].args[1].limit, 1); assert.equal(f.calls[2].args[1].limit, 50);
  assert.deepEqual(f.disposed, ['readThread', 'sendRequest', 'sendRequest']);
});
test('working-directory verification reads only the selected task metadata without turns or execution', async () => {
  const f = fixture();
  assert.deepEqual(await f.adapter.readTaskMetadata(target), { hostId: 'local', threadId, cwd: '/fixture/project' });
  assert.deepEqual(f.calls, [{ method: 'readThread', args: [threadId, { includeTurns: false }] }]);
  assert.deepEqual(f.disposed, ['readThread']);
  await assert.rejects(f.adapter.readTaskMetadata({ ...target, hostId: 'remote' }));
  assert.equal(f.calls.length, 1);
});

test('catalog uses the native request table with fixed metadata-only parameters', async () => {
  const f = fixture({ methods: { sendRequest: async () => ({ data: [], nextCursor: null }) } });
  await f.adapter.listThreads('local', { limit: 999, archived: true, includeTurns: true, cursor: 'next' });
  assert.deepEqual(f.calls, [{ method: 'sendRequest', args: ['thread/list', {
    archived: false, limit: 100, sortKey: 'updated_at', sortDirection: 'desc', useStateDbOnly: true, cursor: 'next',
  }, { timeoutMs: 12000 }] }]);
  assert.deepEqual(f.disposed, ['sendRequest']);
  await assert.rejects(f.adapter.listThreads('unknown-device', {}));
  assert.equal(f.calls.length, 1);
  f.window.electronBridge = { getSharedObjectSnapshotValue: key => key === 'remote_control_connections'
    ? [{ hostId: 'remote-control:fixture', online: true, autoConnect: true }] : [] };
  await f.adapter.listThreads('remote-control:fixture', { ancestorThreadId: threadId });
  assert.equal(f.calls.at(-1).args[1].ancestorThreadId, undefined);
});

test('catalog follows the explicit shared-bundle RPC accessor after the shell update', async () => {
  const f = fixture({ methods: { sendRequest: async () => ({ data: [], nextCursor: null }) },
    module: { managerGetter: undefined }, source: 'import{x}from"./app-shared-fixture.js";' + source });
  function sharedGetter(scope, hostId) {
    if (!scope) throw new Error('AppServerManager RPC is not connected');
    return { forHost: () => ({ sendRequest: async () => ({ data: [{ id: threadId }], nextCursor: null }) }) }.forHost(hostId);
  }
  const adapter = createNativeTaskMapAdapter({ window: f.window, loadModule: async url => url.endsWith('/app-shared-fixture.js')
    ? { module: { sharedGetter } } : f.loadModule(url) });
  assert.equal((await adapter.listThreads('local', { limit: 1 })).data[0].id, threadId);
  const ambiguous = fixture({ module: { managerGetter: undefined }, source: 'import{x}from"./app-shared-one.js";import{y}from"./app-shared-two.js";' + source });
  await assert.rejects(ambiguous.adapter.listThreads('local', {}), e => e.code === 'incompatible');
  assert.equal(ambiguous.calls.length, 0);
});
test('metadata supports the native deferred host RPC accessor without creating a runtime', async () => {
  const f = fixture({ module: { managerGetter: undefined }, source: 'import{x}from"./app-shared-fixture.js";' + source });
  function deferredGetter(scope, hostId) {
    if (!scope) throw new Error('AppServerManager RPC is unavailable for hostId:');
    return { forHost: () => ({ readThread: async id => ({ thread: { id, cwd: '/fixture/project', status: { type: 'idle' } } }) }) }.forHost(hostId);
  }
  const adapter = createNativeTaskMapAdapter({ window: f.window, loadModule: async url => url.endsWith('/app-shared-fixture.js')
    ? { module: { deferredGetter } } : f.loadModule(url) });
  assert.equal((await adapter.readTaskMetadata(target)).cwd, '/fixture/project');
});

test('closing during native discovery or an in-flight catalog request releases it', async () => {
  const before = fixture(), cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(before.adapter.listThreads('local', {}, { signal: cancelled.signal }));
  assert.equal(before.calls.length, 0);
  const f = fixture({ methods: { sendRequest: () => new Promise(() => {}) } });
  const controller = new AbortController();
  const pending = f.adapter.listThreads('local', {}, { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending);
  assert.ok(f.disposed.includes('sendRequest'));
});

test('send preserves native settings and delegates an active task to the high-level coordinator', async () => {
  const f = fixture({ methods: { readThread: async id => ({ thread: { id, status: { type: 'active' } } }) } });
  const result = await f.adapter.send(target, '  虚构追加要求  ');
  assert.equal(result.status, 'sent'); assert.equal(result.turnId, 'fixture-new-turn');
  assert.deepEqual(f.calls.at(-1), { method: 'sendFollowUpMessage', args: [threadId, { prompt: '虚构追加要求' }] });
  assert.ok(!f.calls.some(call => call.method === 'sendRequest'));
});

test('remote targets and malformed local identities cannot reach the renderer client', async () => {
  const f = fixture();
  for (const bad of [{ ...target, hostId: 'remote-control:fixture' }, { ...target, threadId: 'not-a-uuid' }]) {
    await assert.rejects(f.adapter.inspect(bad), error => error.code === 'invalid_target');
    await assert.rejects(f.adapter.send(bad, 'hello'), error => error.outcome === 'failed');
    await assert.rejects(f.adapter.create(bad, { text: 'hello' }), error => error.outcome === 'failed');
  }
  assert.equal(f.calls.length, 0); assert.equal(f.fetched.length, 0);
});

test('empty and oversized messages fail before a request is sent', async () => {
  const f = fixture();
  for (const text of ['', '  ', 'x'.repeat(32001)]) await assert.rejects(f.adapter.send(target, text), error => error.code === 'invalid_message');
  assert.equal(f.calls.length, 0);
});

test('native target identity is checked before a mutation', async () => {
  const f = fixture({ methods: { readThread: async () => ({ thread: { id: childId } }) } });
  await assert.rejects(f.adapter.send(target, 'hello'), error => error.code === 'missing');
  assert.deepEqual(f.calls.map(call => call.method), ['readThread']);
});

test('native result failure does not disable sending and never uses commentary as final', async () => {
  const f = fixture({ methods: { sendRequest: async method => method === 'thread/turns/list'
    ? { data: [{ id: 'fixture-turn', status: 'completed' }] }
    : { data: [{ type: 'agentMessage', phase: 'commentary', text: 'PRIVATE_SENTINEL' }] } } });
  const result = await f.adapter.inspect(target);
  assert.equal(result.canSend, true); assert.equal(result.resultText, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
  const broken = fixture({ methods: { sendRequest: async () => { throw new Error('/private/sentinel'); } } });
  const unavailable = await broken.adapter.inspect(target);
  assert.equal(unavailable.canSend, true); assert.equal(unavailable.resultAvailable, false);
  assert.doesNotMatch(JSON.stringify(unavailable), /private/);
});

test('only completed turn finals are returned and text is bounded', async () => {
  const f = fixture({ methods: { sendRequest: async method => method === 'thread/turns/list'
    ? { data: [{ id: 'fixture-turn', status: 'completed' }] }
    : { data: [{ type: 'agentMessage', phase: 'final_answer', text: 'x'.repeat(15000) }] } } });
  const result = await f.adapter.inspect(target);
  assert.equal(result.resultText.length, 12000);
  assert.equal(result.resultTruncated, true);
  assert.equal(f.calls[2].args[1].turnId, 'fixture-turn');
  const active = fixture({ methods: { sendRequest: async () => ({ data: [{ id: 'active-turn', status: 'inProgress' }, { id: 'previous-turn', status: 'completed' }] }) } });
  assert.equal((await active.adapter.inspect(target)).resultText, null);
  assert.equal(active.calls.length, 2);
});

test('new task uses one clean prompt with exact native permissions and project settings', async () => {
  const f = fixture();
  const result = await f.adapter.create(target, { text: '虚构独立工作', title: '虚构子任务' });
  assert.deepEqual(result.child, { hostId: 'local', threadId: childId, title: '虚构子任务' });
  assert.equal(result.status, 'created');
  const params = f.calls.find(call => call.method === 'nativeCreate').args[1];
  assert.deepEqual(params.input, [{ type: 'text', text: '虚构独立工作', text_elements: [] }]);
  assert.equal(params.permissionsConfig, f.permissions); assert.equal(params.collaborationMode, f.mode);
  assert.deepEqual(params.workspaceRoots, ['/fixture/project']); assert.equal(params.cwd, '/fixture/project');
  assert.deepEqual(params.projectAssignment, { projectKind: 'local', projectId: 'fixture-project' });
  assert.ok(!f.calls.some(call => /fork|sendRequest|readConversationContext/.test(call.method)));
  assert.equal(params.parentThreadId, undefined); assert.equal(params.history, undefined);
});

test('creation fails closed when native permissions cannot be resolved', async () => {
  const f = fixture({ source: 'export{}' });
  assert.equal((await f.adapter.inspect(target)).canCreate, false);
  await assert.rejects(f.adapter.create(target, { text: 'hello' }), error => error.code === 'incompatible');
  assert.ok(!f.calls.some(call => call.method === 'nativeCreate'));
});

test('known created identity survives first-turn rejection or an unknown outcome', async () => {
  for (const status of ['rejected', 'outcome-unknown', 'not-started']) {
    const f = fixture({ create: async () => ({ status: 'created', conversationId: childId, firstTurn: { status } }) });
    await assert.rejects(f.adapter.create(target, { text: 'hello' }), error => {
      assert.equal(error.child.threadId, childId);
      assert.equal(error.outcome, status === 'outcome-unknown' ? 'unknown' : 'failed');
      return true;
    });
  }
});

test('mutating transport failures are unknown unless delivery was explicitly rejected', async () => {
  for (const [details, outcome] of [[{}, 'unknown'], [{ delivery: { stage: 'not-sent' } }, 'failed'], [{ jsonRpcCode: -32602 }, 'unknown']]) {
    const f = fixture({ methods: { sendFollowUpMessage: async () => { throw Object.assign(new Error('/private/sentinel'), details); } } });
    await assert.rejects(f.adapter.send(target, 'hello'), error => {
      assert.equal(error.outcome, outcome); assert.equal(error.definite, outcome === 'failed'); assert.doesNotMatch(error.message, /private/); return true;
    });
  }
});

test('factory remains self-contained when serialized into an isolated renderer', async () => {
  const f = fixture();
  const make = vm.runInNewContext(`(${createNativeTaskMapAdapter.toString()})`, { URL, Symbol });
  const adapter = make({ window: f.window, loadModule: f.loadModule });
  const result = await adapter.inspect(target);
  assert.equal(result.available, true); assert.equal(result.canCreate, true);
});


test('ChatGPT source reuses native recent metadata and strips snippets, bodies and unknown identities', async () => {
  const reads = [];
  async function nativeChats(params) {
    // Inspected native function discovery anchors: Failed to list ChatGPT threads pinnedThreads scope.query.getOrFetch(pinnedNative)
    reads.push(params);
    return { isUnavailable: false, pinnedThreads: [], threads: [
      { id: threadId, kind: 'chatgpt', title: '虚构聊天', status: 'active', updatedAt: 1790000000, preview: 'PRIVATE_SENTINEL', messages: ['PRIVATE_SENTINEL'] },
      { id: childId, kind: 'codex', title: '不得混入' }, { id: 'bad', kind: 'chatgpt' },
    ] };
  }
  let initialized = false;
  function initializeChats() { /* Native anchors: chatgpt-thread-list chatgpt-thread-search */ initialized = true; }
  const f = fixture({ pins: [{}, {}, {}, {}], module: { managerGetter: undefined, nativeChats, initializeChats, chatPins: { resolve() {} } }, source: source.replace('export{', 'function chatInit(){return init(() => { const key = `chatgpt-thread-list`; });}export{chatInit as initializeChats,pinnedNative as chatPins,') });
  const result = await f.adapter.listChatGptThreads();
  assert.equal(initialized, true); assert.equal(reads.length, 1); assert.equal(reads[0].limit, 96, 'four pinned slots must fit under the server limit of 100'); assert.equal(reads[0].query, '');
  assert.deepEqual(result, [{ id: threadId, title: '虚构聊天', status: 'active', updatedAt: 1790000000, pinned: false }]);
  assert.equal(f.calls.length, 0, 'ChatGPT listing must not call Codex readThread or turns/items');
  await assert.rejects(fixture().adapter.listChatGptThreads(), /不支持/);
});

test('native account failures block optional ChatGPT network reads and resume only after native recovery', async () => {
  let pins = 0, lists = 0, gate = 'error';
  const query = { queryKey: ['usage-settings', 'accounts-check', 'fixture-version', 'fixture-account'], isActive: () => true,
    get state() { return { status: gate, data: gate === 'success' ? {} : undefined }; } };
  async function nativeChats() {
    // Discovery anchors: Failed to list ChatGPT threads pinnedThreads scope.query.getOrFetch(pinnedNative)
    lists++;
    return { isUnavailable: false, pinnedThreads: [], threads: [] };
  }
  function initializeChats() {}
  const f = fixture({ queries: [query], module: { nativeChats, initializeChats, chatPins: { resolve() {} } },
    source: source.replace('export{', 'function chatInit(){ const key = `chatgpt-thread-list`; }export{chatInit as initializeChats,pinnedNative as chatPins,') });
  f.scope.query.getOrFetch = async () => { pins++; return []; };
  for (gate of ['error', 'pending']) await assert.rejects(f.adapter.listChatGptThreads(), { code: 'settings_unavailable' });
  assert.equal(pins, 0); assert.equal(lists, 0);
  gate = 'success'; await f.adapter.listChatGptThreads(); assert.equal(pins, 1); assert.equal(lists, 1);
  const accountKey = query.queryKey;
  gate = 'error';
  for (const detail of ['payment-methods', 'auto-top-up', 'auto-top-up-pricing', 'workspace-monthly-usage']) {
    query.queryKey = ['usage-settings', detail, 'fixture-account'];
    await f.adapter.listChatGptThreads();
  }
  assert.equal(lists, 5, 'billing failures are not native account checks');
  query.queryKey = accountKey;
  gate = 'error'; query.isActive = () => false;
  await f.adapter.listChatGptThreads(); assert.equal(lists, 6, 'inactive historical errors do not block the current account');
  query.isActive = () => true; query.queryKey = ['accounts', 'optimized', 'old-account'];
  await f.adapter.listChatGptThreads(); assert.equal(lists, 7, 'an old optimized check is not the current workspace-policy gate');
  query.queryKey = ['accounts', 'settings', 'fixture-account']; gate = 'success';
  f.scope.query.getOrFetch = async () => { pins++; gate = 'error'; return []; };
  await assert.rejects(f.adapter.listChatGptThreads(), { code: 'settings_unavailable' });
  assert.equal(lists, 7, 'account failure during pin loading stops the next request');
  gate = 'success'; f.scope.query.getOrFetch = async () => [];
  query.queryKey = ['workspace-policy', 'fixture-account'];
  // A failure after the helper returned an empty list must not erase old cards.
  let checks = 0;
  query.isActive = () => { if (++checks === 3) gate = 'error'; return true; };
  await assert.rejects(f.adapter.listChatGptThreads(), { code: 'settings_unavailable' });
});
