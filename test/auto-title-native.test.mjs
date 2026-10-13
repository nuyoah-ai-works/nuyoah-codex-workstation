import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeTaskMapAdapter } from '../nuyoah/workstation/task-map-native.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const temporary = '22222222-2222-4222-8222-222222222222';
function fixture({ wrongModel = false, messages = null } = {}) {
  const calls = [], descriptions = {}, desc = { resolve() {} }, completed = { resolve() {} };
  let listener;
  const methods = {
    readThread: async () => ({ thread: { id, name: '现有任务', status: { type: 'idle' } } }),
    subscribe: async options => { if (options.type === 'thread') options.listener({ latestTurnId: 'turn-one', latestTurnStatus: 'completed' }); else listener = options.listener; return { [Symbol.dispose]() {} }; },
    readRecentThreadMessages: async (threadId, limits) => { calls.push({ method: 'readRecentThreadMessages', params: limits }); return messages || [{ role: 'user', text: '用户请求' }, { role: 'assistant', text: '最终答复' }]; },
    sendRequest: async (method, params) => {
      calls.push({ method, params });
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'codex_apps' }, { name: 'fixture_http' }] };
      if (method === 'config/read') return { config: { mcp_servers: { fixture_http: { url: 'https://fixture.invalid/mcp' } } } };
      if (method === 'thread/start') return { thread: { id: temporary, ephemeral: true }, model: wrongModel ? 'expensive-fixture' : 'gpt-6-luna', modelProvider: 'openai' };
      if (method === 'turn/start') {
        queueMicrotask(() => {
          listener({ method: 'item/completed', params: { threadId: temporary, item: { type: 'agentMessage', text: '{"title":"更新标题","description":"更新摘要"}' } } });
          listener({ method: 'turn/completed', params: { threadId: temporary, turn: { status: 'completed' } } });
        });
        return { turn: { id: 'generated-turn' } };
      }
      if (method === 'thread/turns/list') return { data: [{ id: 'turn-one', status: 'completed' }] };
      if (method === 'thread/items/list') return { data: params.sortDirection === 'asc'
        ? [{ turnId: 'turn-one', item: { type: 'userMessage', content: [{ type: 'text', text: '用户请求' }, { type: 'image', url: 'private-image' }] } }, { turnId: 'turn-one', item: { type: 'functionCallOutput', output: 'PRIVATE_TOOL_DATA' } }]
        : [{ turnId: 'turn-one', item: { type: 'reasoning', content: ['PRIVATE_REASONING'] } }, { turnId: 'turn-one', item: { type: 'agentMessage', phase: 'final_answer', text: '最终答复' } }] };
      return {};
    },
  };
  const client = Object.fromEntries(Object.entries(methods).map(([name, invoke]) => [name, (...args) => {
    const pending = Promise.resolve().then(() => invoke(...args)); pending[Symbol.dispose] = () => {}; return pending;
  }]));
  function manager(scope, hostId) {
    if (!scope) throw new Error('AppServerManager RPC is not connected');
    return { forHost: () => client }.forHost(hostId);
  }
  const key = 'fixture-descriptions';
  function readDesc(scope, id) { return scope.get(desc)[id]??null; }
  function writeDesc(scope, id, text) { const values = { ...load(key,{}), [id]: text }; scope.set(desc,values); }
  function load() { return descriptions; }
  const scope = { scope: { __scopeBrand: 'AppScope' }, get: () => descriptions, set() {}, watch: () => () => {} };
  const source = 'var completed=atom(X,null,{onMount:()=>subscribe({event:`turn-completed`})}),key=`thread-descriptions-v1`,desc=atom(key,{});export{completed as completed};';
  const window = { setTimeout, clearTimeout,
    document: { scripts: [{ src: 'app://-/assets/app-initial-fixture.js' }] },
    __codexRoot: { _internalRoot: { current: { memoizedState: { memoizedState: { current: scope } } } } },
  };
  const loadModule = async url => url.includes('app-initial')
    ? { module: {}, source: 'import {native} from"./app-shared-fixture.js";' }
    : { module: { manager, readDesc, writeDesc, completed, service: { threadMetadataGeneration: { generateTitle() {} } } }, source };
  return { adapter: createNativeTaskMapAdapter({ window, loadModule }), calls };
}
test('native metadata uses only Luna, disables tools and hooks, and cleans up its ephemeral thread', async () => {
  const f = fixture(), native = await f.adapter.metadataSession();
  assert.deepEqual(await native.generate('简短测试'), { title: '更新标题', description: '更新摘要' });
  const start = f.calls.find(x => x.method === 'thread/start').params;
  assert.equal(start.model, 'gpt-6-luna'); assert.equal(start.modelProvider, 'openai');
  assert.equal(start.allowProviderModelFallback, false); assert.equal(start.ephemeral, true);
  assert.equal(start.config['features.hooks'], false); assert.equal(start.config['features.unified_exec'], false);
  assert.deepEqual(start.config['mcp_servers.fixture_http'], { enabled: false });
  assert.deepEqual(start.config['mcp_servers.codex_apps'], { enabled: false, command: '' });
  assert.equal(f.calls.at(-1).method, 'thread/unsubscribe');
});
test('an unexpected model is rejected before any inference or paid fallback turn', async () => {
  const f = fixture({ wrongModel: true }), native = await f.adapter.metadataSession();
  await assert.rejects(native.generate('简短测试'));
  assert.equal(f.calls.some(x => x.method === 'turn/start'), false);
  assert.equal(f.calls.at(-1).method, 'thread/unsubscribe');
});
test('bounded input projects only user text and the final reply from the current completed turn', async () => {
  const f = fixture(), native = await f.adapter.metadataSession();
  const value = await native.read(id, 'turn-one', true);
  assert.equal(value.user, '用户请求'); assert.equal(value.assistant, '最终答复');
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_|private-image/);
  assert.deepEqual(f.calls.find(x => x.method === 'readRecentThreadMessages').params, { maxItems: 16, maxTextLength: 2000 });
  assert.equal(f.calls.some(x => x.method === 'thread/items/list'), false);
  assert.equal(await native.read(id, 'newer-turn', true), null);
});

test('mainline context reuses bounded user requests without sending earlier assistant text', async () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({ role: 'user', text: `需求${index}:` + '字'.repeat(700) }));
  messages.push({ role: 'assistant', text: 'OLD_ASSISTANT_OUTPUT' }, { role: 'user', text: '再检查一下' }, { role: 'assistant', text: '当前结果' });
  const f = fixture({ messages }), native = await f.adapter.metadataSession();
  const value = await native.read(id, 'turn-one', true);
  assert.equal(value.user, '再检查一下');
  assert.equal(value.recentRequests.length, 8);
  assert.ok(value.recentRequests.every(text => text.length <= 500));
  assert.doesNotMatch(JSON.stringify(value.recentRequests), /OLD_ASSISTANT_OUTPUT|再检查一下/);
  assert.ok(value.recentRequests.at(-1).startsWith('需求19:'));
  assert.equal(f.calls.filter(call => call.method === 'readRecentThreadMessages').length, 1);
});
