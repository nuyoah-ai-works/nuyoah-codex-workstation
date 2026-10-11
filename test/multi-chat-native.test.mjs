import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeMultiChatAdapter } from '../nuyoah/workstation/multi-chat-native.mjs';

const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
function fixture({ remote = false, broken = false, hiddenFirst = false, offline = false } = {}) {
  const rendered = [], disposed = [], calls = [], states = [], projectRows = [], bindings = [];
  const projects = { a: { name: '文件夹甲', rootPaths: ['/synthetic/project-a'] }, b: { name: '文件夹乙', rootPaths: ['/synthetic/project-b'] } };
  let renderIndex = 0, hookIndex = 0;
  const React = { Component: class {}, createElement: (type, props, ...children) => ({ type, props, children }), useEffect(effect) { effect(); },
    useState(initial) { const state = states[renderIndex] ||= [], index = hookIndex++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = value; }]; } };
  const ReactDOM = { createRoot: (container, options) => ({ render: tree => rendered.push({ container, tree, options }), unmount: () => disposed.push(container) }) };
  function Page({ renderComposer, showComposer, onNewChat }) { return null; }
  function NewComposer(e) { return e.useAsbDirect===!0 ? null : 'native first-turn composer'; }
  function Scope() {}
  let activeRoute;
  function NativeUseScope(scope) { const useRef = null, getOwnValue = null; if (false) throw Error('Missing query client'); return { value: scope.__scopeBrand === 'RouteScope' ? activeRoute
    : { clientThreadId: activeRoute.clientThreadId || 'native-client-' + (activeRoute.hostId || 'local'), routeConversationId: activeRoute.conversationId || null } }; }
  function NativeWrapper({ route, children }) { const clientThreadId = 'native-client', routeConversationId = route.conversationId, initialWorkspacePrimarySurface = 'chat'; return children; }
  const scopes = ['ComposerScope', 'RouteScope', 'ThreadScope'].map(brand => ({ type: Scope, memoizedProps: { scope: { __scopeBrand: brand },
    value: brand === 'RouteScope' ? { routeKind: 'local-thread', conversationId: ids[0], hostId: remote ? 'remote' : null,
      persistentWorkspace: { session: { conversationId: ids[0] } } } : { kind: 'native', clientThreadId: ids[0] } } }));
  const provider = { tag: 10, type: { displayName: 'AppScope' }, memoizedProps: { value: new Map() } };
  const wrapper = { type: NativeWrapper, memoizedProps: { route: { routeKind: 'local-thread' } }, return: provider };
  scopes.forEach((scope, index) => { scope.return = scopes[index + 1] || wrapper; });
  const fiber = { type: Page, return: scopes[0], child: { tag: 5, stateNode: { getBoundingClientRect: () => ({ width: 100, height: 100 }), closest: () => null }, child: { type: NewComposer, sibling: { memoizedProps: { model: 'fixture-a', reasoningEffort: 'medium', models: ['fixture-a','fixture-b'].map(model => ({model,displayName:model,supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}],defaultReasoningEffort:'medium'})), modelOptions: [], onSelectModel() {} } } } } };
  const initial = 'app://-/assets/app-initial-example.js', shared = 'app://-/assets/app-shared-example.js', page = 'app://-/assets/local-conversation-page-example.js';
  const sources = {
    [initial]: 'import{foo}from"./app-shared-example.js";import "./local-conversation-page-example.js";',
    [shared]: 'import{t as q}from"./rolldown-runtime-example.js";var prod=q((e=>{e.createElement=function(){};})),react=q(((e,t)=>{t.exports=prod()}));var domProd=q((e=>{e.createRoot=function(){};})),dom=q(((e,t)=>{t.exports=domProd()}));export{react as R,dom as D};',
    [page]: 'export{x as LocalConversationPage};',
  };
  let nextId = 0;
  const window = { crypto: { randomUUID: () => ids[nextId++] }, document: { scripts: [{ src: initial }], querySelectorAll: selector => selector.includes('sidebar-project-row') ? projectRows : [] }, __codexRoot: { _internalRoot: { current: fiber } },
    electronBridge: { getInitialSidebarBootstrap: () => ({ globalStateEntries: [{ key: 'local-projects', value: projects }] }),
      getSharedObjectSnapshotValue: key => key === 'remote_control_connections' ? ['remote', 'remote:fixture', 'remote_fixture'].map(hostId => ({ hostId, name: '验证设备', online: !offline, autoConnect: true })) : [] },
    fetch: async url => { calls.push(url); return { ok: !broken, text: async () => sources[url] || '' }; } };
  if (hiddenFirst) {
    const visible = { getBoundingClientRect: () => ({ width: 600, height: 300 }), closest: () => null, getAttribute: () => null,
      __reactFiberFixture: fiber.child };
    fiber.child.return = fiber; fiber.child.stateNode = visible;
    const hidden = { ...visible, getBoundingClientRect: () => ({ width: 0, height: 0 }), __reactFiberFixture: null };
    const area = { getBoundingClientRect: () => ({ width: 1200, height: 800 }), closest: () => null,
      querySelectorAll: () => [hidden, visible], contains: () => true };
    visible.parentElement = area; hidden.parentElement = area;
    window.document.querySelectorAll = selector => selector.includes('sidebar-project-row') ? projectRows : [area];
  }
  const adapter = createNativeMultiChatAdapter({ window, loadModule: async url => url === shared ? { R: () => React, D: () => ReactDOM, H: NativeUseScope,
    services: { threadProjectAssignments: { setAssignment: async args => bindings.push(args) } } } : { LocalConversationPage: Page } });
  function render(index, wrongHost = false, resolved = {}) { const wrapper = rendered[index].tree.children[0];
    activeRoute = { ...wrapper.props.route, ...resolved, ...(wrongHost ? { hostId: 'wrong-host' } : {}) }; renderIndex = index; hookIndex = 0; return wrapper.children[0].type(); }
  return { adapter, rendered, disposed, calls, bindings, provider, projects, projectRows, render,
    composer(index, wrongHost = false, resolved = {}) { return render(index, wrongHost, resolved).props.value; } };
}
test('imported folder selection binds each draft project and cwd independently without an OS dialog or remount', async () => {
  const f = fixture(), targets = [f.adapter.newTarget(), f.adapter.newTarget()], selected = [];
  const sessions = [];
  for (let i = 0; i < 2; i++) sessions.push(await f.adapter.mount({ isConnected: true }, targets[i], { onFolder: folder => selected.push([i, folder?.projectId || null]) }));
  const content = index => f.render(index).children[0].children[0];
  const select = index => content(index).children[0].children[1];
  const choose = (index, id) => select(index).props.onChange({ target: { value: id } });
  choose(0, 'a'); choose(1, 'b');
  assert.equal(content(0).children[2].props.defaultCwd, '/synthetic/project-a');
  assert.deepEqual(content(0).children[2].props.surfacePlacement, { kind: 'thread' });
  assert.equal(content(1).children[2].props.defaultCwd, '/synthetic/project-b');
  assert.deepEqual(content(0).children[2].props.selectedProject, { type: 'local', projectId: 'a' });
  assert.deepEqual(selected, [[0, 'a'], [1, 'b']]);
  choose(0, 'not-imported'); assert.equal(content(0).children[2].props.defaultCwd, undefined);
  assert.equal(f.adapter.selectFolder, undefined);
  choose(0, 'a'); delete f.projects.a; select(0).props.onFocus();
  assert.equal(content(0).children[2].props.submitDisabled, true);
  assert.equal(content(0).children[0].children[2].children[0], '原文件夹已移除，请重新选择。');
  assert.equal(f.rendered.length, 2);
  f.projects.windows = { name: 'Windows 示例', rootPaths: ['C:\\synthetic\\project'] }; assert.ok(f.adapter.importedFolders().some(p => p.cwd === 'C:\\synthetic\\project'));
  const row = (id, hostId = 'local') => ({ getAttribute: attr => attr.endsWith('-id') ? id : '导入示例',
    __reactFiberFixture: { memoizedProps: { group: { projectId: id, projectKind: hostId === 'local' ? 'local' : 'remote', hostId, path: '/synthetic/live-' + id } } } });
  f.projectRows.push(row('new'), row('remote', 'remote'));
  select(1).props.onFocus(); assert.equal(f.adapter.importedFolders().length, 2);
  assert.ok(select(1).children.some(option => option.props?.disabled && option.props.value === 'remote'));
  choose(1, 'new'); assert.equal(content(1).children[2].props.defaultCwd, '/synthetic/live-new');
  const count = selected.length; sessions[0].dispose(); choose(0, 'new'); assert.equal(selected.length, count);
});
test('new panes use distinct native client drafts and adopt real identities without remounting or sending', async () => {
  const f = fixture(), targets = [f.adapter.newTarget(), f.adapter.newTarget()], receipts = [];
  assert.notEqual(targets[0].clientThreadId, targets[1].clientThreadId);
  const sessions = [];
  for (const target of targets) sessions.push(await f.adapter.mount({ isConnected: true }, target, { onTarget: target => receipts.push(target) }));
  for (let i = 0; i < 2; i++) {
    const route = f.rendered[i].tree.children[0].props.route, composer = f.composer(i);
    assert.equal(route.routeKind, 'client-local-thread'); assert.equal(route.conversationId, undefined);
    assert.equal(composer.kind, 'local'); assert.equal(composer.browserTabMentionConversationId, targets[i].clientThreadId);
    assert.equal(composer.placement, 'main'); assert.equal(composer.clientThreadId, targets[i].clientThreadId);
    assert.equal(composer.conversationId, null);
    assert.equal(composer.routeConversationId, null);
  }
  assert.deepEqual(receipts, []);
  const composer = f.composer(0, false, { routeKind: 'local-thread', conversationId: ids[0] });
  assert.equal(composer.clientThreadId, targets[0].clientThreadId); assert.equal(composer.conversationId, ids[0]);
  assert.deepEqual(receipts, [{ hostId: 'local', threadId: ids[0] }]);
  assert.equal(f.rendered.length, 2);
  sessions[0].dispose(); f.composer(0, false, { conversationId: ids[1] }); assert.equal(receipts.length, 1);
  await assert.rejects(f.adapter.mount({ isConnected: true }, { hostId: 'remote', clientThreadId: targets[0].clientThreadId }));
  await assert.rejects(f.adapter.mount({ isConnected: true }, { hostId: 'local', clientThreadId: 'client-new-thread:bad' }));
});
test('native creation hooks bind the selected project before its first turn and retain the selected cwd through draft clearing', async () => {
  const f = fixture(), target = f.adapter.newTarget(), receipts = [];
  const session = await f.adapter.mount({ isConnected: true }, target, { onTarget: value => receipts.push(value) });
  const content = () => f.render(0).children[0].children[0];
  content().children[0].children[1].props.onChange({ target: { value: 'a' } });
  const composer = content().children[2].props;
  assert.deepEqual(f.bindings, []); assert.deepEqual(receipts, []);
  composer.onLocalSubmitStart(); composer.onProjectChange(null);
  await composer.beforeFirstTurn(ids[0]);
  assert.deepEqual(f.bindings, [{ hostId: 'local', threadId: ids[0], assignment: { projectKind: 'local', projectId: 'a' } }]);
  composer.onLocalConversationCreated(ids[0]);
  assert.deepEqual(receipts, [{ hostId: 'local', threadId: ids[0], selectedCwd: '/synthetic/project-a' }]);
  f.render(0, false, { conversationId: ids[0] }); assert.equal(receipts.length, 1);
  session.dispose();
  await composer.beforeFirstTurn(ids[1]);
  assert.equal(f.bindings.length, 2);
  assert.deepEqual(f.bindings[1], { hostId: 'local', threadId: ids[1], assignment: { projectKind: 'local', projectId: 'a' } });
  composer.onLocalConversationCreated(ids[1]); assert.equal(receipts.length, 1);
  delete f.projects.a;
  await assert.rejects(composer.beforeFirstTurn(ids[1]));
  assert.equal(f.bindings.length, 2);
  assert.equal(f.adapter.diagnostic().kind, 'project_binding_stale_folder');
});
test('pending models and effort stay independent and override only their own native submission settings', async () => {
  const f = fixture(), targets = [f.adapter.newTarget(), f.adapter.newTarget()], selections = [];
  for (let i = 0; i < 2; i++) await f.adapter.mount({ isConnected: true }, targets[i], { onModel: value => selections.push([i, value]) });
  const content = i => f.render(i).children[0].children[0];
  const controls = i => content(i).children[1];
  controls(0).children[0].children[1].props.onChange({ target: { value: 'fixture-b' } });
  controls(0).children[1].children[1].props.onChange({ target: { value: 'high' } });
  assert.equal(controls(1).children[0].children[1].props.value, 'fixture-a');
  assert.equal(controls(1).children[1].children[1].props.value, 'medium');
  const context = { collaborationMode: { mode: 'plan', settings: { model: 'global-model', reasoning_effort: 'low', developer_instructions: 'preserve-fixture' } }, prompt: 'fixture prompt' };
  const a = await content(0).children[2].props.prepareLocalSubmit(context);
  const b = await content(1).children[2].props.prepareLocalSubmit(context);
  assert.deepEqual(a.collaborationMode, { mode: 'plan', settings: { model: 'fixture-b', reasoning_effort: 'high', developer_instructions: 'preserve-fixture' } });
  assert.equal(b.collaborationMode.settings.model, 'fixture-a');
  assert.equal(context.collaborationMode.settings.model, 'global-model');
  assert.equal(a.prompt, context.prompt); assert.equal(selections.length, 2);
  controls(0).children[1].children[1].props.onChange({ target: { value: 'unsupported-effort' } });
  assert.equal(selections.length, 2);
});
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
