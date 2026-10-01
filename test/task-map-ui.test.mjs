import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../nuyoah/workstation/task-map-ui.js', import.meta.url), 'utf8');
const task = (threadId, extra = {}) => ({ hostId: 'local', threadId, title: `任务 ${threadId}`, projectId: 'p', projectName: '当前项目', runtimeStatus: 'completed', displayStatus: 'history', statusLabel: '已查看历史', ...extra });
const ref = (threadId, hostId = 'local') => ({ hostId, threadId });
const edge = (from, to, kind = 'parent') => ({ from: typeof from === 'string' ? ref(from) : from, to: typeof to === 'string' ? ref(to) : to, kind });
const id = (threadId, hostId = 'local') => JSON.stringify([hostId, threadId]);
const navigationKey = 'nuyoah.task-map-navigation.v1';
function sessionStore() {
  const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}

// State-machine fixture. Real pointer, motion and native integration are covered separately.
function setup({ tasks = [task('main')], context = { hostId: 'local', threadId: 'main', projectId: 'p', projectName: '当前项目' }, native = new Map(), canvas = true, hidden = false, sessionStorage = sessionStore() } = {}) {
  let sequence = 0, now = 1000, nativeReads = 0;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.style = {}; this.hidden = false; this.value = ''; this._text = ''; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
    replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...children); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key]; }
    click() { if (!this.disabled) this.onclick?.(); }
  }
  const events = new Map();
  const document = { body: new Element('body'), head: new Element('head'), createElement: tag => new Element(tag), visibilityState: hidden ? 'hidden' : 'visible', addEventListener(type, callback) { events.set(type, callback); }, removeEventListener(type) { events.delete(type); } };
  const instances = [], timers = new Map(), window = { sessionStorage }, opened = [], navigationOptions = [];
  if (canvas) window.__nuyoahWorkCanvas__ = { create({ container, storageKey, onActivate }) {
    const instance = { storageKey, updates: 0, destroyed: false,
      update(model) { this.updates++; this.model = JSON.parse(JSON.stringify(model)); container.replaceChildren(); for (const node of model.nodes) { const element = new Element('button'); element.textContent = node.title; element.setAttribute('data-node-id', node.id); element.onclick = () => onActivate(node.id); container.append(element); } },
      focus(value) { this.focused = value; }, destroy() { this.destroyed = true; }, activate: onActivate
    }; instances.push(instance); return instance;
  } };
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(source, { window, document, Date: Clock, crypto: { randomUUID: () => `request-${++sequence}` }, setTimeout(fn) { const key = ++sequence; timers.set(key, fn); return key; }, clearTimeout: key => timers.delete(key) });
  const api = window.__nuyoahTaskMapUI__, container = new Element('section'); document.body.append(container);
  const rootRequests = [];
  let options = { tasks, context, openTask(value, meta) { opened.push(value); navigationOptions.push(meta); return true; }, getLocalStatus(threadId) { nativeReads++; return native.get(threadId) || null; }, syncLocalRelationRoots: roots => rootRequests.push([...roots]) };
  api.mount(container, options);
  function all(element = container) { return [element, ...element.children.flatMap(all)]; }
  return { api, document, container, instances, timers, native, opened, navigationOptions, all, rootRequests, events, sessionStorage,
    openTask(id) { this.canvas.activate(id); this.byText('打开完整对话').click(); },
    get navigation() { return JSON.parse(sessionStorage.getItem(navigationKey) || '{"frames":[]}'); },
    get options() { return options; }, get nativeReads() { return nativeReads; }, get canvas() { return instances.filter(instance => !instance.destroyed).at(-1); },
    get nodes() { return this.canvas.model.nodes.filter(node => node.kind === 'task'); }, get edges() { return this.canvas.model.edges; },
    byText: text => all().find(element => element.tagName === 'button' && element.textContent === text),
    byLabel: label => all().find(element => element.getAttribute('aria-label') === label),
    mount(next = {}) { options = { ...options, ...next }; api.mount(container, options); },
    advance(ms = 11000) { now += ms; },
    respond(request, { nodes = [], edges = [], status = 'ready', coverage } = {}) { api.receive({ id: request.id, data: { status, nodes, edges, coverage } }); }
  };
}

test('current conversation includes only the real connected component across parent, fork and explicit relations', () => {
  const tasks = ['main', 'child', 'grandchild', 'unrelated', 'fork', 'linked'].map(value => task(value, value === 'linked' ? { projectId: 'elsewhere' } : {}));
  const f = setup({ tasks }); try {
    const request = f.api.takeRequest(); assert.equal(request.scope, 'conversation'); assert.equal(request.consumer, 'task-map');
    f.respond(request, { edges: [edge('main', 'child'), edge('child', 'grandchild'), edge('main', 'fork', 'fork'), edge('grandchild', 'linked', 'related')] });
    assert.deepEqual(new Set(f.nodes.map(node => node.id)), new Set(['main', 'child', 'grandchild', 'fork', 'linked'].map(value => id(value))));
    assert.equal(f.edges.length, 4); assert.equal(f.nodes.filter(node => node.current).length, 1); assert.ok(f.nodes.find(node => node.id === id('main')).current);
    assert.equal(f.nodes.some(node => node.title === '任务 unrelated'), false);
    f.openTask(id('child')); assert.equal(f.opened[0].threadId, 'child');
    const main = f.nodes.find(node => node.id === id('main')), child = f.nodes.find(node => node.id === id('child')), grandchild = f.nodes.find(node => node.id === id('grandchild'));
    assert.ok(main.x < child.x && child.x < grandchild.x);
  } finally { f.api.destroy(); }
});

test('project membership is host-scoped; only parent edges inherit a missing project binding', () => {
  const f = setup({ tasks: [task('main'), task('peer'), task('main', { hostId: 'remote' }), task('different', { projectId: 'q' })] }); try {
    f.respond(f.api.takeRequest()); f.byText('当前项目').click(); const request = f.api.takeRequest();
    f.respond(request, { nodes: [task('child', { projectId: null }), task('grandchild', { projectId: '__unassigned__' }), task('fork', { projectId: null }), task('related', { projectId: null }), task('remote-child', { hostId: 'remote', projectId: null })], edges: [edge('main', 'child'), edge('child', 'grandchild'), edge('main', 'fork', 'fork'), edge('main', 'related', 'related'), edge('main', ref('remote-child', 'remote'))] });
    assert.deepEqual(new Set(f.nodes.map(node => node.id)), new Set(['main', 'peer', 'child', 'grandchild'].map(value => id(value))));
    assert.equal(f.edges.length, 2); assert.ok(f.canvas.storageKey.includes('project'));
    f.byText('全局').click(); f.respond(f.api.takeRequest(), { nodes: [task('child', { projectId: null })], edges: [edge('main', 'child')] });
    assert.equal(f.nodes.length, 5); assert.equal(f.edges.length, 1);
    const headings = f.canvas.model.nodes.filter(node => node.kind === 'root'); assert.equal(headings.length, 3);
    assert.equal(f.edges.some(value => value.from.startsWith('project:') || value.to.startsWith('project:')), false);
  } finally { f.api.destroy(); }
});

test('same thread UUID on different hosts remains separate and cyclic links terminate', () => {
  const f = setup({ tasks: [task('main'), task('main', { hostId: 'remote', title: '远程同ID' }), task('other')] }); try {
    f.respond(f.api.takeRequest(), { edges: [edge('main', 'other'), edge('other', 'main'), edge('other', ref('main', 'remote'), 'related')] });
    assert.equal(f.nodes.length, 3); assert.equal(new Set(f.nodes.map(node => node.id)).size, 3);
    assert.equal(f.nodes.find(node => node.id === id('main', 'remote')).current, false);
    assert.ok(f.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
    f.openTask(id('main', 'remote')); assert.equal(f.opened[0].hostId, 'remote');
  } finally { f.api.destroy(); }
});

test('an unbound child can open its inherited project after navigation', () => {
  const f = setup({ context: { hostId: 'local', threadId: 'child' }, tasks: [task('main'), task('child', { projectId: '' })] }); try {
    f.respond(f.api.takeRequest(), { edges: [edge('main', 'child')] }); f.byText('当前项目').click();
    f.respond(f.api.takeRequest(), { nodes: [task('child')], edges: [edge('main', 'child')] });
    assert.equal(f.nodes.length, 2); assert.equal(f.container.textContent.includes('尚未绑定项目'), false); assert.ok(f.canvas.storageKey.endsWith('["project","local","p"]'));
  } finally { f.api.destroy(); }
});

test('unknown remote nodes retain identity and cannot navigate; resolved local children can', () => {
  const f = setup(); try {
    f.respond(f.api.takeRequest(), { nodes: [task('local-child', { projectId: null, resolved: true }), task('remote-child', { hostId: 'remote', resolved: true })], edges: [edge('main', 'local-child'), edge('main', ref('remote-child', 'remote')), edge('main', ref('unknown-uuid', 'remote'), 'related')] });
    assert.equal(f.nodes.find(node => node.id === id('unknown-uuid', 'remote')).title, '待同步任务');
    f.openTask(id('unknown-uuid', 'remote')); f.openTask(id('remote-child', 'remote')); assert.equal(f.opened.length, 0); assert.match(f.container.textContent, /暂时只能查看/);
    f.openTask(id('local-child')); assert.equal(f.opened[0].threadId, 'local-child');
  } finally { f.api.destroy(); }
});

test('live activity honours approval waits, unknown availability and current marker independently', () => {
  const native = new Map([['main', { runtimeStatus: 'running', waitingReason: null }], ['child', { runtimeStatus: 'running', waitingReason: 'approval' }]]);
  const f = setup({ tasks: [task('main'), task('child'), task('offline', { runtimeStatus: 'running', displayStatus: 'running', statusAvailable: false })], native }); try {
    f.respond(f.api.takeRequest(), { nodes: [task('db-child', { resolved: true, runtimeStatus: 'unknown', displayStatus: undefined, statusLabel: undefined })], edges: [edge('main', 'child'), edge('main', 'offline'), edge('main', 'db-child')] });
    assert.equal(f.nodes.find(node => node.id === id('main')).activity, 'running');
    assert.equal(f.nodes.find(node => node.id === id('child')).activity, 'waiting');
    assert.equal(f.nodes.find(node => node.id === id('offline')).activity, 'unknown');
    const canvas = f.canvas; native.set('main', { runtimeStatus: 'completed', waitingReason: null }); native.set('db-child', { runtimeStatus: 'running', waitingReason: null }); f.api.refreshLive();
    assert.equal(f.canvas, canvas); assert.notEqual(f.nodes.find(node => node.id === id('main')).activity, 'running');
    assert.equal(f.nodes.find(node => node.id === id('main')).current, true);
    assert.equal(f.nodes.find(node => node.id === id('db-child')).activity, 'running'); assert.equal(f.api.takeRequest(), null);
    native.delete('db-child'); f.api.refreshLive(); assert.equal(f.nodes.find(node => node.id === id('db-child')).activity, 'unknown'); assert.equal(f.nodes.find(node => node.id === id('db-child')).badge, '');
    native.set('db-child', { runtimeStatus: 'running', waitingReason: null }); f.api.refreshLive(); assert.equal(f.nodes.find(node => node.id === id('db-child')).activity, 'running');
    f.mount({ getLocalStatus() { throw new Error('disconnected'); } }); assert.equal(f.nodes.find(node => node.id === id('main')).activity, 'unknown');
    const reads = f.nativeReads; f.api.suspend(); native.set('db-child', { runtimeStatus: 'completed' }); f.api.refreshLive(); assert.equal(f.nativeReads, reads);
  } finally { f.api.destroy(); }
});

test('unavailable remote activity and label override stale waiting or running metadata', () => {
  const f = setup({ tasks: [task('main'), task('remote', { hostId: 'remote', statusAvailable: false, runtimeStatus: 'unknown', displayStatus: 'attention', waitingReason: 'approval', statusLabel: '等待查看' })] }); try {
    f.respond(f.api.takeRequest(), { edges: [edge('main', ref('remote', 'remote'), 'related')] });
    const remote = f.nodes.find(node => node.id === id('remote', 'remote')); assert.equal(remote.activity, 'unknown'); assert.equal(remote.badge, '');
  } finally { f.api.destroy(); }
});

test('context and scope changes reject stale responses and keep separate canvas preferences', () => {
  const f = setup({ tasks: [task('main'), task('next')] }); try {
    f.respond(f.api.takeRequest()); const firstKey = f.canvas.storageKey; f.advance(); f.mount(); const old = f.api.takeRequest();
    f.mount({ context: { hostId: 'local', threadId: 'next', projectId: 'p' } }); const next = f.api.takeRequest();
    f.respond(old, { nodes: [task('old-child')], edges: [edge('main', 'old-child')] }); assert.equal(f.byLabel('对话关系画布').hidden, true);
    f.respond(next, { nodes: [task('new-child')], edges: [edge('next', 'new-child')] }); assert.equal(f.nodes.length, 2); assert.notEqual(f.canvas.storageKey, firstKey);
    const nextKey = f.canvas.storageKey; f.byText('全局').click(); const global = f.api.takeRequest(); f.byText('当前对话').click(); const returned = f.api.takeRequest();
    assert.equal(f.canvas.storageKey, nextKey); assert.equal(f.nodes.length, 2);
    f.respond(global, { nodes: [task('pollution')], edges: [edge('next', 'pollution')] }); assert.equal(f.nodes.some(node => node.id === id('pollution')), false);
    f.respond(returned, { nodes: [task('new-child')], edges: [edge('next', 'new-child')] }); assert.equal(f.nodes.length, 2);
  } finally { f.api.destroy(); }
});

test('refresh errors, malformed responses and timeouts preserve the last useful map', () => {
  const f = setup(); try {
    f.respond(f.api.takeRequest(), { nodes: [task('child')], edges: [edge('main', 'child')] }); const canvas = f.canvas;
    f.advance(); f.mount(); let refresh = f.api.takeRequest(); f.api.receive({ id: refresh.id, error: 'private implementation failure' });
    assert.equal(f.nodes.length, 2); assert.equal(f.canvas, canvas); assert.match(f.container.textContent, /已保留现有地图/); assert.equal(f.container.textContent.includes('private implementation'), false);
    f.byLabel('重新读取任务关联').click(); refresh = f.api.takeRequest(); f.respond(refresh, { status: 'unavailable' }); assert.equal(f.nodes.length, 2);
    f.byLabel('重新读取任务关联').click(); f.api.takeRequest(); [...f.timers.values()][0](); assert.equal(f.nodes.length, 2); assert.match(f.container.textContent, /更新未完成/);
    f.byLabel('重新读取任务关联').click(); refresh = f.api.takeRequest(); f.respond(refresh, { nodes: [task('child')], edges: [edge('main', 'child')], status: 'partial' }); assert.match(f.container.textContent, /部分关联尚未同步/);
  } finally { f.api.destroy(); }
});

test('failed and unavailable relationship reads remain visible until a manual retry', () => {
  const f = setup(); try {
    let request = f.api.takeRequest();
    assert.equal(f.byLabel('重新读取任务关联').disabled, true);
    f.api.receive({ id: request.id, error: 'read failed' });
    assert.equal(f.byLabel('重新读取任务关联').disabled, false);
    assert.match(f.container.textContent, /无法读取任务关联/);
    f.advance(30000); f.mount(); f.mount();
    assert.equal(f.api.takeRequest(), null);
    assert.match(f.container.textContent, /无法读取任务关联/);

    f.byLabel('重新读取任务关联').click();
    request = f.api.takeRequest();
    f.respond(request, { status: 'unavailable' });
    assert.match(f.container.textContent, /暂时无法读取关联/);
    f.advance(30000); f.mount();
    assert.equal(f.api.takeRequest(), null);
    assert.match(f.container.textContent, /暂时无法读取关联/);

    f.byLabel('重新读取任务关联').click();
    request = f.api.takeRequest();
    f.respond(request);
    f.advance(11000); f.mount();
    request = f.api.takeRequest();
    assert.ok(request);
    [...f.timers.values()][0]();
    assert.match(f.container.textContent, /关联更新未完成/);
    f.advance(11000); f.mount();
    assert.equal(f.api.takeRequest(), null);
  } finally { f.api.destroy(); }
});

test('polling is visible-only, context changes refresh immediately and identical mounts do not rebuild canvas', () => {
  const f = setup({ hidden: true }); try {
    assert.equal(f.api.takeRequest(), null); assert.equal(f.nativeReads, 0);
    f.document.visibilityState = 'visible'; f.mount(); f.respond(f.api.takeRequest());
    const canvas = f.canvas, updates = canvas.updates; f.mount(); f.mount(); assert.equal(canvas.updates, updates); assert.equal(f.api.takeRequest(), null);
    f.advance(); f.document.visibilityState = 'hidden'; f.mount(); assert.equal(f.api.takeRequest(), null);
    f.document.visibilityState = 'visible'; f.mount(); assert.ok(f.api.takeRequest());
    f.api.suspend(); assert.equal(f.api.takeRequest(), null); f.mount(); assert.ok(f.api.takeRequest());
  } finally { f.api.destroy(); }
});

test('large related families remain reachable with a visible budget and search beyond the first page', () => {
  const children = Array.from({ length: 95 }, (_, index) => task(`child-${String(index).padStart(2, '0')}`));
  const f = setup({ tasks: [task('main'), ...children] }); try {
    f.respond(f.api.takeRequest(), { edges: children.map(child => edge('main', child.threadId)) });
    assert.equal(f.nodes.length, 80); assert.match(f.container.textContent, /已显示 80 \/ 96/);
    const search = f.byLabel('查找地图中的任务'); search.value = 'child-94'; search.oninput(); f.byLabel('定位任务：任务 child-94').click();
    assert.ok(f.nodes.some(node => node.id === id('child-94'))); assert.equal(f.canvas.focused, id('child-94'));
    const more = f.all().find(node => node.tagName === 'button' && node.textContent.startsWith('显示更多任务')); more.click(); assert.equal(f.nodes.length, 96); assert.equal(f.edges.length, 95);
  } finally { f.api.destroy(); }
});

test('missing project, no current task, fallback UI and destruction are explicit and safe', () => {
  const f = setup({ context: {}, tasks: [], canvas: false }); try {
    assert.equal(f.api.takeRequest(), null); assert.match(f.container.textContent, /打开一个对话/);
    f.byText('当前项目').click(); f.respond(f.api.takeRequest()); assert.match(f.container.textContent, /尚未绑定项目/);
    f.byText('全局').click(); f.respond(f.api.takeRequest(), { nodes: [task('local', { resolved: true })] });
    f.all().find(node => node.tagName === 'button' && node.textContent.startsWith('任务 local')).click(); f.byText('打开完整对话').click(); assert.equal(f.opened[0].threadId, 'local');
  } finally { f.api.destroy(); }
  assert.equal(f.container.children.length, 0); assert.equal(f.timers.size, 0); assert.equal(f.api.takeRequest(), null);
});

test('no selected conversation stays a normal empty state across refreshes while project and global still work', () => {
  const f = setup({ context: { hostId: 'local', projectId: 'p' }, tasks: [task('main'), task('peer')] }); try {
    assert.equal(f.api.takeRequest(), null);
    for (let index = 0; index < 3; index++) { f.advance(); f.mount(); f.byLabel('重新读取任务关联').click(); assert.equal(f.api.takeRequest(), null); assert.match(f.container.textContent, /打开一个对话/); assert.equal(f.container.textContent.includes('失败'), false); assert.equal(f.container.textContent.includes('保留现有地图'), false); }
    f.byText('当前项目').click(); const project = f.api.takeRequest(); assert.equal(project.scope, 'project'); f.respond(project); assert.equal(f.nodes.length, 2);
    f.byText('全局').click(); const global = f.api.takeRequest(); assert.equal(global.scope, 'global'); f.respond(global); assert.equal(f.nodes.length, 2);
    f.byText('当前对话').click(); assert.equal(f.api.takeRequest(), null); assert.match(f.container.textContent, /打开一个对话/); assert.equal(f.byLabel('对话关系画布').hidden, true);
    f.mount({ context: { hostId: 'local', threadId: 'main', projectId: 'p' } }); assert.equal(f.api.takeRequest().threadId, 'main');
  } finally { f.api.destroy(); }
});

test('visible maps subscribe only actual local parent roots and release them without status-tick churn', () => {
  const f = setup({ tasks: [task('main'), task('child'), task('grandchild'), task('peer'), task('fork'), task('remote', { hostId: 'remote' })] }); try {
    assert.deepEqual(f.rootRequests, [[]]);
    const data = { edges: [edge('main', 'child'), edge('child', 'grandchild'), edge('main', 'fork', 'fork'), edge('main', ref('remote', 'remote'))] };
    f.respond(f.api.takeRequest(), data); assert.deepEqual(f.rootRequests.at(-1), ['main']);
    const count = f.rootRequests.length; f.api.refreshLive(); f.mount(); f.native.set('child', { runtimeStatus: 'running' }); f.api.refreshLive(); assert.equal(f.rootRequests.length, count);
    f.api.suspend(); assert.deepEqual(f.rootRequests.at(-1), []); f.api.suspend(); assert.equal(f.rootRequests.length, count + 1);
    f.mount(); assert.deepEqual(f.rootRequests.at(-1), ['main']); f.respond(f.api.takeRequest(), data);
    f.document.visibilityState = 'hidden'; f.events.get('visibilitychange')(); assert.deepEqual(f.rootRequests.at(-1), []);
    f.document.visibilityState = 'visible'; f.events.get('visibilitychange')(); assert.deepEqual(f.rootRequests.at(-1), ['main']);
    f.mount({ context: { hostId: 'local', threadId: 'peer', projectId: 'p' } }); f.respond(f.api.takeRequest()); assert.deepEqual(f.rootRequests.at(-1), []);
    f.byText('全局').click(); f.respond(f.api.takeRequest(), data); assert.deepEqual(f.rootRequests.at(-1), ['main']);
  } finally { f.api.destroy(); }
  assert.deepEqual(f.rootRequests.at(-1), []); assert.equal(f.events.size, 0);
});

test('relation status subscriptions are capped at 16 real displayed roots', () => {
  const families = Array.from({ length: 20 }, (_, index) => ({ parent: task(`parent-${index}`), child: task(`child-${index}`) }));
  const f = setup({ tasks: families.flatMap(group => [group.parent, group.child]), context: { hostId: 'local', projectId: 'p' } }); try {
    f.byText('当前项目').click(); f.respond(f.api.takeRequest(), { edges: families.map(group => edge(group.parent.threadId, group.child.threadId)) });
    assert.equal(f.rootRequests.at(-1).length, 16); assert.ok(f.rootRequests.at(-1).every(value => value.startsWith('parent-')));
  } finally { f.api.destroy(); }
});

test('a searched child beyond the node budget subscribes its real ancestor even when that parent is not drawn', () => {
  const tasks = Array.from({ length: 80 }, (_, index) => task(`a-${index}`)); tasks.push(task('z-parent'), task('z-child'));
  const f = setup({ tasks, context: { hostId: 'local', projectId: 'p' } }); try {
    f.byText('当前项目').click(); f.respond(f.api.takeRequest(), { edges: [edge('z-parent', 'z-child')] }); assert.deepEqual(f.rootRequests.at(-1), []);
    const search = f.byLabel('查找地图中的任务'); search.value = 'z-child'; search.oninput(); f.byLabel('定位任务：任务 z-child').click();
    assert.equal(f.nodes.some(node => node.id === id('z-parent')), false); assert.equal(f.nodes.some(node => node.id === id('z-child')), true); assert.deepEqual(f.rootRequests.at(-1), ['z-parent']);
  } finally { f.api.destroy(); }
});

test('archived catalog entries remain only in a genuinely connected conversation map', () => {
  const f = setup({ tasks: [task('main'), task('child', { archived: true }), task('peer', { archived: true })] }); try {
    f.respond(f.api.takeRequest(), { edges: [edge('main', 'child')] }); assert.deepEqual(new Set(f.nodes.map(node => node.id)), new Set([id('main'), id('child')]));
    f.byText('当前项目').click(); f.respond(f.api.takeRequest()); assert.deepEqual(f.nodes.map(node => node.id), [id('main')]);
    f.byText('全局').click(); f.respond(f.api.takeRequest()); assert.deepEqual(f.nodes.map(node => node.id), [id('main')]);
  } finally { f.api.destroy(); }
});

test('return navigation survives an empty child context, stale source markers and failed return attempts', () => {
  const tasks = [task('main', { title: '主对话', preview: 'not stored', workspacePath: '/private/fixture' }), task('child')];
  const f = setup({ tasks }); try {
    f.respond(f.api.takeRequest(), { edges: [edge('main', 'child')] });
    f.byText('当前项目').click(); f.respond(f.api.takeRequest(), { edges: [edge('main', 'child')] });
    const sourceLayout = f.canvas.storageKey;
    f.openTask(id('child'));
    assert.equal(f.navigation.frames.length, 1); assert.equal(f.byText('返回上一对话').parentNode.hidden, false);
    assert.equal(f.byText('返回上一对话').parentNode.textContent.includes('主对话'), true);
    assert.equal(f.sessionStorage.getItem(navigationKey).includes('/private/fixture'), false);
    assert.equal(f.sessionStorage.getItem(navigationKey).includes('not stored'), false);
    f.mount(); assert.equal(f.navigation.frames.length, 1); // Native source row can linger during routing.
    f.mount({ context: {} }); assert.equal(f.navigation.frames.length, 1);
    const missing = f.api.takeRequest(); if (missing) f.api.receive({ id: missing.id, error: 'unavailable' });
    assert.equal(f.byText('返回上一对话').parentNode.hidden, false);
    const realOpen = f.options.openTask;
    f.mount({ openTask: () => false }); f.byText('返回上一对话').click(); assert.equal(f.navigation.frames.length, 1); assert.equal(f.navigation.returnTo, null);
    f.mount({ openTask: () => { throw new Error('unavailable'); } }); f.byText('返回上一对话').click(); assert.equal(f.navigation.frames.length, 1);
    f.mount({ openTask: realOpen }); f.byText('返回上一对话').click();
    assert.equal(f.opened.at(-1).threadId, 'main'); assert.equal(f.navigationOptions.at(-1).returning, true);
    assert.equal(f.navigation.frames.length, 1); // Initiation alone does not prove that the source opened.
    f.mount({ context: { hostId: 'local', threadId: 'main', projectId: 'p' } });
    assert.equal(f.navigation.frames.length, 0); assert.equal(f.byText('返回上一对话').parentNode.hidden, true);
    assert.equal(f.byText('当前项目').getAttribute('aria-pressed'), 'true'); assert.equal(f.canvas.storageKey, sourceLayout);
  } finally { f.api.destroy(); }
});

test('nested map navigation returns one conversation at a time and restores each source scope', () => {
  const tasks = ['main', 'child', 'grandchild'].map(value => task(value)), data = { edges: [edge('main', 'child'), edge('child', 'grandchild')] };
  const f = setup({ tasks }); try {
    f.respond(f.api.takeRequest(), data); const mainLayout = f.canvas.storageKey;
    f.openTask(id('child')); f.mount({ context: { hostId: 'local', threadId: 'child', projectId: 'p' } }); f.respond(f.api.takeRequest(), data);
    f.byText('全局').click(); f.respond(f.api.takeRequest(), data); const childLayout = f.canvas.storageKey;
    f.openTask(id('grandchild')); f.mount({ context: { hostId: 'local', threadId: 'grandchild', projectId: 'p' } }); f.respond(f.api.takeRequest(), data);
    assert.equal(f.navigation.frames.length, 2); assert.equal(f.navigation.frames[1].arrived, true);
    f.byText('当前项目').click(); f.respond(f.api.takeRequest(), data);
    f.byText('返回上一对话').click(); assert.equal(f.opened.at(-1).threadId, 'child'); assert.equal(f.navigation.frames.length, 2);
    f.mount({ context: { hostId: 'local', threadId: 'child', projectId: 'p' } });
    assert.equal(f.navigation.frames.length, 1); assert.equal(f.byText('全局').getAttribute('aria-pressed'), 'true'); assert.equal(f.canvas.storageKey, childLayout);
    f.byText('返回上一对话').click(); f.mount({ context: { hostId: 'local', threadId: 'main', projectId: 'p' } });
    assert.equal(f.navigation.frames.length, 0); assert.equal(f.byText('当前对话').getAttribute('aria-pressed'), 'true'); assert.equal(f.canvas.storageKey, mainLayout);
  } finally { f.api.destroy(); }
});

test('clicking an ancestor trims the return path, while an unrelated native selection clears it', () => {
  const tasks = ['main', 'child', 'grandchild', 'unrelated'].map(value => task(value)), data = { edges: [edge('main', 'child'), edge('child', 'grandchild')] };
  const f = setup({ tasks }); try {
    f.respond(f.api.takeRequest(), data);
    for (const name of ['child', 'grandchild']) { f.openTask(id(name)); f.mount({ context: { hostId: 'local', threadId: name, projectId: 'p' } }); f.respond(f.api.takeRequest(), data); }
    f.openTask(id('main')); assert.equal(f.navigation.frames.length, 2); assert.equal(f.navigation.returnTo, 0); assert.equal(f.navigationOptions.at(-1).returning, true);
    f.mount({ context: { hostId: 'local', threadId: 'main', projectId: 'p' } }); f.respond(f.api.takeRequest(), data); assert.equal(f.navigation.frames.length, 0);
    f.openTask(id('child')); f.mount({ context: { hostId: 'local', threadId: 'unrelated', projectId: 'p' } });
    assert.equal(f.navigation.frames.length, 0); assert.equal(f.byText('返回上一对话').parentNode.hidden, true);
  } finally { f.api.destroy(); }
});

test('return path survives suspension and reinjection without requiring a known current conversation', () => {
  const sessionStorage = sessionStore(), tasks = [task('main'), task('child')], data = { edges: [edge('main', 'child')] };
  const first = setup({ tasks, sessionStorage });
  first.respond(first.api.takeRequest(), data); first.openTask(id('child')); first.api.suspend(); first.api.destroy();
  const f = setup({ tasks, sessionStorage, context: {} }); try {
    assert.equal(f.byText('返回上一对话').parentNode.hidden, false); assert.equal(f.api.takeRequest(), null);
    f.byText('返回上一对话').click(); assert.equal(f.opened.at(-1).threadId, 'main'); assert.equal(f.navigationOptions.at(-1).returning, true);
    f.mount({ context: { hostId: 'local', threadId: 'main' } }); assert.equal(f.navigation.frames.length, 0);
  } finally { f.api.destroy(); }
});

test('self clicks and unknown sources do not create returns; host identity and rejected navigation are preserved', () => {
  const f = setup({ tasks: [task('main'), task('main', { hostId: 'remote', title: '远程同ID' })] }); try {
    f.respond(f.api.takeRequest(), { edges: [edge('main', ref('main', 'remote'))] });
    f.openTask(id('main')); assert.equal(f.navigation.frames.length, 0);
    const realOpen = f.options.openTask; f.mount({ openTask: () => false }); f.openTask(id('main', 'remote')); assert.equal(f.navigation.frames.length, 0);
    f.mount({ openTask: realOpen }); f.openTask(id('main', 'remote'));
    assert.equal(f.navigation.frames[0].from.hostId, 'local'); assert.equal(f.navigation.frames[0].to.hostId, 'remote');
    f.mount({ context: { hostId: 'remote', threadId: 'main' } }); f.byText('返回上一对话').click();
    assert.equal(f.opened.at(-1).hostId, 'local');
    f.mount({ context: { hostId: 'local', threadId: 'main' } }); f.mount({ context: {} });
    f.byText('全局').click(); f.respond(f.api.takeRequest()); f.openTask(id('main', 'remote')); assert.equal(f.navigation.frames.length, 0);
  } finally { f.api.destroy(); }
});

test('session return metadata is bounded and invalid entries cannot become navigation targets', () => {
  const sessionStorage = sessionStore();
  sessionStorage.setItem(navigationKey, JSON.stringify({ version: 1, frames: Array.from({ length: 24 }, (_, index) => ({ from: { ...task(`task-${index}`), preview: 'private body' }, to: task(`task-${index + 1}`), scope: 'conversation', arrived: true })) }));
  const f = setup({ sessionStorage, context: {} }); try {
    f.byText('返回上一对话').click();
    assert.equal(f.navigation.frames.length, 20); assert.equal(f.opened.at(-1).threadId, 'task-23');
    assert.equal(f.sessionStorage.getItem(navigationKey).includes('private body'), false);
  } finally { f.api.destroy(); }
  sessionStorage.setItem(navigationKey, JSON.stringify({ version: 1, frames: [{ from: { threadId: 'main' }, to: ref('child'), scope: 'conversation' }, { from: ref('main'), to: ref('child'), scope: '__proto__' }] }));
  const empty = setup({ sessionStorage }); try { assert.equal(empty.byText('返回上一对话').parentNode.hidden, true); } finally { empty.api.destroy(); }
});

test('confirmed completion briefly shows success then folds without treating idle or attention as completion', () => {
  const native = new Map([['main', { runtimeStatus: 'running' }], ['done', { runtimeStatus: 'completed', hasFinalResponse: true, finalAt: 900 }], ['idle', { runtimeStatus: 'completed', hasFinalResponse: false }], ['waiting', { runtimeStatus: 'running', waitingReason: 'approval', hasFinalResponse: true }]]);
  const f = setup({ tasks: ['main', 'done', 'idle', 'waiting'].map(name => task(name)), native }); try {
    f.respond(f.api.takeRequest(), { edges: ['done', 'idle', 'waiting'].map(name => edge('main', name)) });
    assert.equal(f.nodes.find(node => node.id === id('done')).activity, 'completed');
    assert.equal(f.nodes.find(node => node.id === id('done')).badge, '已完成');
    assert.equal(f.nodes.find(node => node.id === id('idle')).activity, 'idle');
    assert.equal(f.nodes.find(node => node.id === id('waiting')).activity, 'waiting');
    f.advance(5999); f.api.refreshLive(); assert.equal(f.nodes.some(node => node.id === id('done')), true);
    f.advance(1); f.api.refreshLive(); assert.equal(f.nodes.some(node => node.id === id('done')), false);
    assert.equal(f.nodes.some(node => node.id === id('idle')), true); assert.equal(f.nodes.some(node => node.id === id('waiting')), true);
    f.byLabel('查看已收起任务（1）').click(); assert.equal(f.nodes.some(node => node.id === id('done')), true);
    f.byLabel('收起已完成任务').click(); assert.equal(f.nodes.some(node => node.id === id('done')), false);
    assert.deepEqual(f.rootRequests.at(-1), ['main']); // Keep watching folded children for a real resume.
    native.set('done', { runtimeStatus: 'running', hasFinalResponse: false }); f.api.refreshLive();
    assert.equal(f.nodes.find(node => node.id === id('done')).activity, 'running');
    native.set('done', { runtimeStatus: 'completed', hasFinalResponse: true, finalAt: 7000 }); f.api.refreshLive();
    assert.equal(f.nodes.find(node => node.id === id('done')).badge, '已完成');
  } finally { f.api.destroy(); }
});

test('archived local child with independent final evidence completes when its live status disappears', () => {
  const native = new Map([['main', { runtimeStatus: 'running' }]]);
  const f = setup({ tasks: [task('main')], native }); try {
    f.respond(f.api.takeRequest(), { nodes: [
      task('done', { archived: true, runtimeStatus: 'unknown', displayStatus: undefined, hasFinalResponse: true, finalAt: 900, agentCompletion: true }),
      task('unconfirmed', { archived: true, runtimeStatus: 'unknown', displayStatus: undefined }),
    ], edges: [edge('main', 'done'), edge('main', 'unconfirmed')] });
    assert.equal(f.nodes.find(node => node.id === id('done')).activity, 'completed');
    assert.equal(f.nodes.find(node => node.id === id('done')).badge, '已完成');
    assert.equal(f.nodes.find(node => node.id === id('unconfirmed')).activity, 'unknown');
    f.advance(6000); f.api.refreshLive();
    assert.equal(f.nodes.some(node => node.id === id('done')), false);
    assert.equal(f.nodes.find(node => node.id === id('unconfirmed')).activity, 'unknown');
    native.set('done', { runtimeStatus: 'running', hasFinalResponse: false }); f.api.refreshLive();
    assert.equal(f.nodes.find(node => node.id === id('done')).activity, 'running');
  } finally { f.api.destroy(); }
});

test('manual completion survives missing local status while disconnected remote completion stays unknown', () => {
  const f = setup({ tasks: [task('main'), task('manual', { displayStatus: 'completed' }),
    task('remote', { hostId: 'remote', statusAvailable: false, runtimeStatus: 'unknown', hasFinalResponse: true })] }); try {
    f.respond(f.api.takeRequest(), { edges: [edge('main', 'manual'), edge('main', ref('remote', 'remote'))] });
    assert.equal(f.nodes.find(node => node.id === id('manual')).activity, 'completed');
    assert.equal(f.nodes.find(node => node.id === id('remote', 'remote')).activity, 'unknown');
  } finally { f.api.destroy(); }
});

test('completed parents preserve the path to active descendants and only fold after the descendant finishes', () => {
  const native = new Map([['main', { runtimeStatus: 'completed', hasFinalResponse: true }], ['child', { runtimeStatus: 'completed', hasFinalResponse: true }], ['grandchild', { runtimeStatus: 'running' }]]);
  const f = setup({ tasks: ['main', 'child', 'grandchild'].map(name => task(name)), native }); try {
    f.respond(f.api.takeRequest(), { edges: [edge('main', 'child'), edge('child', 'grandchild')] });
    f.advance(6000); f.api.refreshLive(); assert.equal(f.nodes.length, 3); assert.equal(f.edges.length, 2);
    native.set('grandchild', { runtimeStatus: 'completed', hasFinalResponse: true, finalAt: 7000 }); f.api.refreshLive();
    f.advance(6000); f.api.refreshLive(); assert.deepEqual(f.nodes.map(node => node.id), [id('main')]);
    assert.equal(f.byLabel('查看已收起任务（2）').parentNode != null, true);
  } finally { f.api.destroy(); }
});

test('unknown or failed status cannot auto-fold even with stale completion and same UUID on another host stays separate', () => {
  const tasks = [task('main'), task('same', { hostId: 'remote', hasFinalResponse: true }), task('same', { hasFinalResponse: true }), task('failed', { hasFinalResponse: true }), task('manual', { displayStatus: 'completed' })];
  const native = new Map([['main', { runtimeStatus: 'running' }], ['same', { runtimeStatus: 'unknown', statusAvailable: false }], ['failed', { runtimeStatus: 'failed' }], ['manual', { runtimeStatus: 'idle' }]]);
  const f = setup({ tasks, native }); try {
    f.respond(f.api.takeRequest(), { edges: [edge('main', ref('same', 'remote')), edge('main', 'same'), edge('main', 'failed'), edge('main', 'manual')] });
    f.advance(6000); f.api.refreshLive();
    assert.equal(f.nodes.some(node => node.id === id('same', 'remote')), false);
    assert.equal(f.nodes.find(node => node.id === id('same')).activity, 'unknown');
    assert.equal(f.nodes.find(node => node.id === id('failed')).activity, 'failed');
    assert.equal(f.nodes.some(node => node.id === id('manual')), false);
  } finally { f.api.destroy(); }
});

test('Chinese task copy replaces technical agent labels and uses the actual delegated description when available', () => {
  const f = setup({ tasks: [task('main'), task('child', { title: 'task_map_ui', description: '让主对话与子任务在同一张画布上连线。' }), task('generic', { title: 'unrecognized_worker' })] }); try {
    f.respond(f.api.takeRequest(), { edges: [edge('main', 'child'), edge('main', 'generic')] });
    const child = f.nodes.find(node => node.id === id('child'));
    assert.equal(child.title, '任务地图界面'); assert.equal(child.subtitle, '让主对话与子任务在同一张画布上连线。'); assert.equal(child.sourceTitle, 'task_map_ui'); assert.equal(child.badge, '');
    assert.match(f.nodes.find(node => node.id === id('generic')).subtitle, /主对话/);
  } finally { f.api.destroy(); }
});

test('completion display preferences survive reinjection while source records remain unchanged', () => {
  const sessionStorage = sessionStore(), tasks = [task('main'), task('child', { hasFinalResponse: true, finalAt: 900 })], original = JSON.stringify(tasks);
  const native = new Map([['main', { runtimeStatus: 'running' }], ['child', { runtimeStatus: 'completed' }]]);
  const first = setup({ tasks, native, sessionStorage }); first.respond(first.api.takeRequest(), { edges: [edge('main', 'child')] }); first.advance(6000); first.api.refreshLive(); first.api.destroy();
  const f = setup({ tasks, native, sessionStorage }); try {
    f.advance(6000); f.respond(f.api.takeRequest(), { edges: [edge('main', 'child')] });
    assert.equal(f.nodes.some(node => node.id === id('child')), false); assert.equal(JSON.stringify(tasks), original);
    assert.equal(sessionStorage.getItem('nuyoah.task-map-completed-view.v1').includes('hasFinalResponse'), false);
    assert.equal(sessionStorage.getItem('nuyoah.task-map-completed-view.v1').includes('任务 child'), false);
  } finally { f.api.destroy(); }
});


test('relation events coalesce, retain one follow-up during a read, and stop after failure or suspension', () => {
  const f = setup(); try {
    const first = f.api.takeRequest();
    for (let i = 0; i < 100; i++) f.api.invalidateRelations();
    assert.equal(f.api.takeRequest(), null);
    f.respond(first);
    const fire = () => { const [key, callback] = [...f.timers][0]; f.timers.delete(key); callback(); };
    assert.equal(f.timers.size, 1); fire();
    const second = f.api.takeRequest(); assert.ok(second);
    f.respond(second);
    for (let i = 0; i < 100; i++) f.api.invalidateRelations();
    assert.equal(f.timers.size, 1); fire();
    const third = f.api.takeRequest();
    f.api.invalidateRelations(); f.api.receive({ id: third.id, error: 'unavailable' });
    f.api.invalidateRelations(); assert.equal(f.timers.size, 0);
    f.byLabel('重新读取任务关联').click(); f.respond(f.api.takeRequest());
    f.api.invalidateRelations(); assert.equal(f.timers.size, 1);
    f.api.suspend(); assert.equal(f.timers.size, 0); f.api.invalidateRelations(); assert.equal(f.timers.size, 0);
  } finally { f.api.destroy(); }
});
