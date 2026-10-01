import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeMultiChatAdapter } from '../nuyoah/workstation/multi-chat-native.mjs';

const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
function fixture({ remote = false, broken = false, hiddenFirst = false, offline = false } = {}) {
  const rendered = [], disposed = [], calls = [];
  const React = { Component: class {}, createElement: (type, props, ...children) => ({ type, props, children }), useEffect() {} };
  const ReactDOM = { createRoot: (container, options) => ({ render: tree => rendered.push({ container, tree, options }), unmount: () => disposed.push(container) }) };
  function Page({ renderComposer, showComposer, onNewChat }) { return null; }
  function Scope() {}
  let activeRoute;
  function NativeUseScope(scope) { const useRef = null, getOwnValue = null; if (false) throw Error('Missing query client'); return { value: scope.__scopeBrand === 'RouteScope' ? activeRoute
    : { clientThreadId: 'native-client-' + (activeRoute.hostId || 'local'), routeConversationId: activeRoute.conversationId } }; }
  function NativeWrapper({ route, children }) { const clientThreadId = 'native-client', routeConversationId = route.conversationId, initialWorkspacePrimarySurface = 'chat'; return children; }
  const scopes = ['ComposerScope', 'RouteScope', 'ThreadScope'].map(brand => ({ type: Scope, memoizedProps: { scope: { __scopeBrand: brand },
    value: brand === 'RouteScope' ? { routeKind: 'local-thread', conversationId: ids[0], hostId: remote ? 'remote' : null,
      persistentWorkspace: { session: { conversationId: ids[0] } } } : { kind: 'native', clientThreadId: ids[0] } } }));
  const provider = { tag: 10, type: { displayName: 'AppScope' }, memoizedProps: { value: new Map() } };
  const wrapper = { type: NativeWrapper, memoizedProps: { route: { routeKind: 'local-thread' } }, return: provider };
  scopes.forEach((scope, index) => { scope.return = scopes[index + 1] || wrapper; });
  const fiber = { type: Page, return: scopes[0], child: { tag: 5, stateNode: { getBoundingClientRect: () => ({ width: 100, height: 100 }), closest: () => null } } };
  const initial = 'app://-/assets/app-initial-example.js', shared = 'app://-/assets/app-shared-example.js', page = 'app://-/assets/local-conversation-page-example.js';
  const sources = {
    [initial]: 'import{foo}from"./app-shared-example.js";import "./local-conversation-page-example.js";',
    [shared]: 'import{t as q}from"./rolldown-runtime-example.js";var prod=q((e=>{e.createElement=function(){};})),react=q(((e,t)=>{t.exports=prod()}));var domProd=q((e=>{e.createRoot=function(){};})),dom=q(((e,t)=>{t.exports=domProd()}));export{react as R,dom as D};',
    [page]: 'export{x as LocalConversationPage};',
  };
  const window = { document: { scripts: [{ src: initial }] }, __codexRoot: { _internalRoot: { current: fiber } },
    electronBridge: { getSharedObjectSnapshotValue: key => key === 'remote_control_connections' ? ['remote', 'remote:fixture', 'remote_fixture'].map(hostId => ({ hostId, name: '验证设备', online: !offline, autoConnect: true })) : [] },
    fetch: async url => { calls.push(url); return { ok: !broken, text: async () => sources[url] || '' }; } };
  if (hiddenFirst) {
    const visible = { getBoundingClientRect: () => ({ width: 600, height: 300 }), closest: () => null, getAttribute: () => null,
      __reactFiberFixture: fiber.child };
    fiber.child.return = fiber; fiber.child.stateNode = visible;
    const hidden = { ...visible, getBoundingClientRect: () => ({ width: 0, height: 0 }), __reactFiberFixture: null };
    const area = { getBoundingClientRect: () => ({ width: 1200, height: 800 }), closest: () => null,
      querySelectorAll: () => [hidden, visible], contains: () => true };
    visible.parentElement = area; hidden.parentElement = area;
    window.document.querySelectorAll = () => [area];
  }
  const adapter = createNativeMultiChatAdapter({ window, loadModule: async url => url === shared ? { R: () => React, D: () => ReactDOM, H: NativeUseScope } : { LocalConversationPage: Page } });
  return { adapter, rendered, disposed, calls, provider,
    composer(index, wrongHost = false) { const wrapper = rendered[index].tree.children[0];activeRoute = { ...wrapper.props.route, ...(wrongHost ? { hostId: 'wrong-host' } : {}) }; return wrapper.children[0].type().props.value; } };
}
test('native multi-chat mounts distinct task scopes over the existing app context without submitting turns', async () => {
  const f = fixture(); assert.deepEqual(f.adapter.current(), { hostId: 'local', threadId: ids[0] });
  const sessions = [];
  for (const threadId of ids) sessions.push(await f.adapter.mount({ isConnected: true }, { hostId: 'local', threadId }));
  assert.equal(f.rendered.length, 2);
  for (let i = 0; i < 2; i++) {
    const wrapper = f.rendered[i].tree.children[0];
    assert.equal(wrapper.props.route.conversationId, ids[i]); assert.equal(wrapper.props.route.pathname, '/local/' + ids[i]);
    assert.equal(wrapper.type.name, 'NativeWrapper'); assert.equal(wrapper.props.archivedConversationPreview, false);
    assert.equal(wrapper.props.route.persistentWorkspace, undefined);
    assert.equal(f.rendered[i].tree.props.value, f.provider.memoizedProps.value);
  }
  assert.equal(f.calls.length, 3);
  sessions[0].dispose(); sessions[0].dispose(); sessions[1].dispose(); assert.equal(f.disposed.length, 2);
});
test('unknown or disconnected devices and invalid tasks fail before loading modules', async () => {
  const f = fixture();
  for (const target of [{ hostId: 'unknown-host', threadId: ids[0] }, { hostId: 'local', threadId: 'bad' }]) await assert.rejects(f.adapter.mount({ isConnected: true }, target));
  await assert.rejects(f.adapter.mount({ isConnected: false }, { hostId: 'local', threadId: ids[0] }));
  assert.equal(f.calls.length, 0);
  const unavailable = fixture({ offline: true }); await assert.rejects(unavailable.adapter.mount({ isConnected: true }, { hostId: 'remote', threadId: ids[0] }), { code: 'remote_unavailable' }); assert.equal(unavailable.calls.length, 0);
});
test('configured remote tasks use host-scoped routes and composers even when thread IDs match local tasks', async () => {
  const f = fixture({ remote: true }); assert.deepEqual(f.adapter.current(), { hostId: 'remote', threadId: ids[0] });
  for (const hostId of ['local', 'remote']) await f.adapter.mount({ isConnected: true }, { hostId, threadId: ids[0] });
  const route = f.rendered[1].tree.children[0].props.route;
  assert.notEqual(f.rendered[0].options.identifierPrefix, f.rendered[1].options.identifierPrefix);
  assert.match(f.rendered[1].options.identifierPrefix, /^[a-zA-Z][a-zA-Z0-9_-]*$/);
  assert.equal(route.routeKind, 'local-thread'); assert.equal(route.hostId, 'remote'); assert.equal(new URLSearchParams(route.search).get('hostId'), 'remote');
  assert.equal(f.composer(0).clientThreadId, 'native-client-local'); assert.equal(f.composer(1).clientThreadId, 'native-client-remote');
  assert.throws(() => f.composer(1, true), /Native conversation identity mismatch/);
  for (const hostId of ['remote:fixture', 'remote_fixture']) await f.adapter.mount({ isConnected: true }, { hostId, threadId: ids[0] });
  const prefixes = f.rendered.map(r => r.options.identifierPrefix); assert.equal(new Set(prefixes).size, 4);
  for (const prefix of prefixes) assert.match(prefix, /^[a-zA-Z][a-zA-Z0-9_-]*$/);
});
test('incompatible native bundles fail closed and permit a later fresh discovery', async () => {
  const f = fixture({ broken: true }); await assert.rejects(f.adapter.prepare()); await assert.rejects(f.adapter.prepare());
  assert.equal(f.rendered.length, 0); assert.equal(f.calls.length, 2);
});
test('retained hidden editors cannot replace the identity of the visible native conversation', () => {
  const f = fixture({ hiddenFirst: true });
  assert.deepEqual(f.adapter.current(), { hostId: 'local', threadId: ids[0] });
});
