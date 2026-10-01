import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../nuyoah/workstation/task-map-ui.js', import.meta.url), 'utf8');
const ref = (threadId, hostId = 'local') => ({ hostId, threadId });
const key = (threadId, hostId = 'local') => JSON.stringify([hostId, threadId]);
const task = (threadId, extra = {}) => ({ ...ref(threadId), title: `示例任务 ${threadId}`, runtimeStatus: 'running', projectId: 'fixture', ...extra });
const edge = (from, to) => ({ from: typeof from === 'string' ? ref(from) : from, to: typeof to === 'string' ? ref(to) : to, kind: 'parent' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let n = 0; n < 5; n++) await Promise.resolve(); };
const available = target => ({ available: true, target: { ...target, title: `示例任务 ${target.threadId}` }, running: true, canSend: true, canCreate: true, parent: target.threadId === 'child' ? { ...ref('main'), title: '示例主任务' } : null, resultText: target.threadId === 'child' ? '示例已完成结果' : null });

function fixture({ inspect = async target => available(target), execute = async () => ({ status: 'succeeded', message: '补充要求已发送。' }), transport = true } = {}) {
  let sequence = 0, clock = 1000;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.style = {}; this.value = ''; this._text = ''; this.hidden = false; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(value => value.textContent).join(''); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this._text = ''; this.append(...nodes); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(value => value !== this); this.parentNode = null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    click() { if (!this.disabled) return this.onclick?.(); }
    focus() { document.activeElement = this; }
  }
  const document = { createElement: tag => new Element(tag), body: new Element('body'), head: new Element('head'), visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const storage = new Map(), timers = new Map(), inspected = [], executed = [], opened = [], canvases = [];
  const window = { sessionStorage: { getItem: name => storage.get(name), setItem: (name, value) => storage.set(name, value) } };
  if (transport) window.__nuyoahTaskActions__ = { inspect: target => { inspected.push(JSON.parse(JSON.stringify(target))); return inspect(target); }, execute: request => { executed.push(JSON.parse(JSON.stringify(request))); return execute(request); } };
  window.__nuyoahWorkCanvas__ = { create({ onActivate }) { const canvas = { update(data) { this.data = data; }, activate: onActivate, destroy() {} }; canvases.push(canvas); return canvas; } };
  class Clock extends Date { static now() { return clock; } }
  const runtime = { document, window, crypto: { randomUUID: () => `fixture-${++sequence}` }, Date: Clock, setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(source, runtime);
  let api = window.__nuyoahTaskMapUI__; const container = new Element('section'), tasks = [task('main'), task('child'), task('other'), task('child', { hostId: 'remote', title: '示例远程任务' })];
  let options = { context: { ...ref('main'), projectId: 'fixture' }, tasks, openTask(value) { opened.push(value); return true; } };
  const data = { status: 'ready', nodes: [task('unresolved', { resolved: false })], edges: [edge('main', 'child'), edge('main', 'other'), edge('main', ref('child', 'remote')), edge('main', 'unresolved')] };
  api.mount(container, options); api.receive({ id: api.takeRequest().id, data });
  const all = (node = container) => [node, ...node.children.flatMap(all)];
  return { get api() { return api; }, window, document, tasks, storage, timers, inspected, executed, opened, container,
    byText: text => all().find(node => node.tagName === 'button' && node.textContent === text),
    byLabel: text => all().find(node => node.getAttribute('aria-label') === text),
    status: () => all().find(node => node.className === 'nuyoah-task-map-action-status'),
    select: (name, host) => canvases.at(-1).activate(key(name, host)),
    input(text) { if (all().find(node => node.className === 'nuyoah-task-map-action-form').hidden) this.byText('补充要求').click(); const field = this.byLabel('任务操作内容'); field.value = text; field.oninput(); },
    mount(next = {}) { options = { ...options, ...next }; api.mount(container, options); },
    reinject() { api.retainActions(); api.destroy(); vm.runInNewContext(source, runtime); api = window.__nuyoahTaskMapUI__; api.mount(container, options); this.respond(); },
    advance(ms = 11000) { clock += ms; },
    respond() { const request = api.takeRequest(); if (request) api.receive({ id: request.id, data }); },
    get canvas() { return canvases.at(-1); }
  };
}

test('selection inspects only explicit targets; refresh keeps focus and drafts without sending or opening', async () => {
  const f = fixture(); try {
    assert.equal(f.inspected.length, 0); f.select('child'); await flush(); assert.equal(f.opened.length, 0); assert.equal(f.executed.length, 0);
    assert.deepEqual(f.inspected, [ref('child')]); assert.equal(f.canvas.data.selectedId, key('child'));
    f.input('只补充这项任务'); const input = f.byLabel('任务操作内容'); input.focus();
    f.advance(); f.mount(); f.respond(); f.api.refreshLive();
    assert.equal(f.byLabel('任务操作内容'), input); assert.equal(f.document.activeElement, input); assert.equal(input.value, '只补充这项任务'); assert.equal(f.inspected.length, 1);
    f.select('other'); await flush(); f.input('另一项要求'); f.select('child'); await flush(); assert.equal(input.value, '只补充这项任务');
    assert.equal(f.executed.length, 0); f.byText('打开完整对话').click(); assert.equal(f.opened[0].threadId, 'child');
    assert.equal([...f.storage.values()].some(value => value.includes('只补充') || value.includes('另一项要求')), false);
  } finally { f.api.destroy(); }
});

test('details precede forms and host Escape dismisses one layer at a time without losing a draft', async () => {
  const f = fixture(); try {
    assert.equal(f.api.dismiss(), false);
    f.byLabel('查找任务').click(); assert.equal(f.byLabel('查找任务').getAttribute('aria-expanded'), 'true');
    assert.equal(f.api.dismiss(), true); assert.equal(f.byLabel('查找任务').getAttribute('aria-expanded'), 'false');
    f.byLabel('地图选项').click(); assert.equal(f.api.dismiss(), true);
    f.select('child'); await flush();
    const field = f.byLabel('任务操作内容'), form = field.parentNode.parentNode;
    assert.equal(form.hidden, true); assert.equal(f.byLabel('选中任务操作').hidden, false);
    f.input('返回详情后仍保留'); assert.equal(form.hidden, false);
    assert.equal(f.api.dismiss(), true); assert.equal(form.hidden, true); assert.equal(field.value, '返回详情后仍保留');
    await f.byText('发送补充要求').click(); assert.equal(f.executed.length, 0);
    assert.equal(f.api.dismiss(), true); assert.equal(f.byLabel('选中任务操作').hidden, true);
    f.select('child'); await flush(); assert.equal(form.hidden, true);
    f.byText('补充要求').click(); assert.equal(form.hidden, false); assert.equal(field.value, '返回详情后仍保留');
    f.api.suspend(); assert.equal(f.api.dismiss(), false); assert.equal(f.executed.length, 0);
  } finally { f.api.destroy(); }
});

test('out-of-order inspection cannot enable or populate the newly selected host-scoped task', async () => {
  const first = deferred(), second = deferred(), f = fixture({ inspect: target => target.hostId === 'local' ? first.promise : second.promise });
  try {
    f.select('child'); f.select('child', 'remote'); second.resolve({ ...available(ref('child', 'remote')), resultText: '远程成果' }); await flush();
    f.byText('交给主任务继续').click(); f.input('保留远程草稿'); first.resolve({ ...available(ref('child')), resultText: '旧本机成果' }); await flush();
    assert.equal(f.byLabel('任务操作内容').value, '保留远程草稿'); assert.match(f.container.textContent, /示例远程任务/);
    f.byText('补充要求').click(); f.input('远程补充'); await f.byText('发送补充要求').click();
    assert.deepEqual(f.executed[0].target, ref('child', 'remote'));
  } finally { f.api.destroy(); }
});

test('inflight requests snapshot target and text, reject repeat clicks and keep receipt with the source task', async () => {
  const result = deferred(), f = fixture({ execute: () => result.promise }); try {
    f.select('child'); await flush(); f.input('子任务补充'); const send = f.byText('发送补充要求'); const pending = send.click();
    send.click(); assert.equal(f.executed.length, 1); assert.equal(send.disabled, true); assert.equal(f.status().getAttribute('data-status'), 'pending');
    f.select('other'); await flush(); f.input('其他任务草稿'); result.resolve({ status: 'succeeded', message: '已补充到子任务。' }); await pending;
    assert.equal(f.byLabel('任务操作内容').value, '其他任务草稿'); assert.equal(f.status().textContent.includes('已补充到'), false);
    assert.deepEqual(f.executed[0].target, ref('child')); assert.equal(f.executed[0].text, '子任务补充');
    f.select('child'); await flush(); assert.equal(f.byLabel('任务操作内容').value, ''); assert.equal(f.status().textContent, '已补充到子任务。');
  } finally { f.api.destroy(); }
});

test('unknown delivery preserves content and blocks resend with a real parent conversation check', async () => {
  const f = fixture({ execute: async () => { throw new Error('transport disconnected'); } }); try {
    f.select('child'); await flush(); f.byText('交给主任务继续').click(); assert.equal(f.byLabel('任务操作内容').value, '示例已完成结果'); f.input('编辑后的成果与继续要求');
    await f.byText('发送给主任务').click(); assert.equal(f.executed[0].action, 'deliver'); assert.deepEqual(f.executed[0].target, ref('child'));
    assert.deepEqual(f.executed[0].expectedParent, ref('main'));
    assert.equal(f.status().getAttribute('data-status'), 'unknown'); assert.equal(f.byLabel('任务操作内容').value, '编辑后的成果与继续要求');
    f.byText('发送给主任务').click(); f.select('other'); await flush(); f.select('child'); await flush(); f.byText('发送给主任务').click(); assert.equal(f.executed.length, 1);
    assert.equal(f.byText('打开对话核对').hidden, false); f.byText('打开对话核对').click(); assert.equal(f.opened.at(-1).threadId, 'main');
  } finally { f.api.destroy(); }
});

test('failed creation keeps the draft for a deliberate retry; successful creation exposes its returned child', async () => {
  let attempts = 0; const f = fixture({ execute: async () => ++attempts === 1 ? { status: 'failed', message: '未创建子任务，请重试。' } : { status: 'succeeded', message: '子任务已创建。', child: { ...ref('created'), title: '示例新任务' } } }); try {
    f.select('main'); await flush(); f.byText('拆出子任务').click(); f.input('完成一项独立检查'); const title = f.byLabel('子任务名称（可选）'); title.value = '检查任务'; title.oninput();
    await f.byText('创建子任务').click(); assert.equal(f.status().getAttribute('data-status'), 'failed'); assert.equal(f.byLabel('任务操作内容').value, '完成一项独立检查');
    await f.byText('创建子任务').click(); assert.equal(f.executed.length, 2); assert.notEqual(f.executed[0].id, f.executed[1].id); assert.equal(f.executed[1].title, '检查任务');
    assert.equal(f.byLabel('任务操作内容').value, ''); assert.equal(f.byText('打开子任务').hidden, false); f.byText('打开子任务').click(); assert.equal(f.opened.at(-1).threadId, 'created');
  } finally { f.api.destroy(); }
});

test('unresolved nodes, unavailable transport and mismatched inspection identities never authorize writes', async () => {
  for (const options of [{ transport: false }, { inspect: async () => available(ref('wrong')) }, { inspect: async target => ({ ...available(target), available: false }) }]) {
    const f = fixture(options); try { f.select('child'); await flush(); f.input('保留但不发送'); assert.equal(f.byText('发送补充要求').disabled, true); assert.equal(f.executed.length, 0); assert.match(f.status().textContent, /暂时无法操作/); } finally { f.api.destroy(); }
  }
  const f = fixture(); try { f.select('unresolved'); await flush(); f.input('不能发送'); assert.equal(f.inspected.length, 0); assert.equal(f.byText('打开完整对话').disabled, true); assert.equal(f.byText('发送补充要求').disabled, true); } finally { f.api.destroy(); }
});

test('selected completed cards stay visible until their action panel is closed', async () => {
  const f = fixture(); try {
    f.select('child'); await flush(); f.tasks.find(task => task.threadId === 'child' && task.hostId === 'local').hasFinalResponse = true;
    f.tasks.find(task => task.threadId === 'child' && task.hostId === 'local').runtimeStatus = 'completed'; f.mount(); f.advance(6001); f.api.refreshLive();
    assert.equal(f.canvas.data.nodes.some(node => node.id === key('child')), true); f.byLabel('收起操作').click(); assert.equal(f.canvas.data.nodes.some(node => node.id === key('child')), false);
  } finally { f.api.destroy(); }
});

test('operation timeout becomes uncertain and a late confirmed receipt may safely resolve it', async () => {
  const result = deferred(), f = fixture({ execute: () => result.promise }); try {
    f.select('child'); await flush(); f.input('慢速请求'); const pending = f.byText('发送补充要求').click();
    [...f.timers.values()].find(timer => timer.ms === 60000).fn(); assert.equal(f.status().getAttribute('data-status'), 'unknown'); assert.equal(f.byText('发送补充要求').disabled, true);
    result.resolve({ status: 'succeeded', message: '已确认送达。' }); await pending; assert.equal(f.status().getAttribute('data-status'), 'succeeded'); assert.equal(f.executed.length, 1);
  } finally { f.api.destroy(); }
});

test('hot reinjection preserves drafts, request identity and unknown locks, including an inflight late receipt', async () => {
  const result = deferred(), f = fixture({ execute: () => result.promise }); try {
    f.select('other'); await flush(); f.input('另一目标的内存草稿'); f.select('child'); await flush(); f.input('重注入时尚在发送的要求');
    const pending = f.byText('发送补充要求').click(), requestId = f.executed[0].id; f.reinject(); f.select('child'); await flush();
    assert.equal(f.status().getAttribute('data-status'), 'pending'); assert.equal(f.byLabel('任务操作内容').value, '重注入时尚在发送的要求'); assert.equal(f.byText('正在处理…').disabled, true);
    result.resolve({ status: 'unknown' }); await pending; assert.equal(f.status().getAttribute('data-status'), 'unknown');
    f.reinject(); f.select('child'); await flush(); assert.equal(f.status().getAttribute('data-status'), 'unknown'); assert.equal(f.byText('发送补充要求').disabled, true);
    assert.equal(f.executed.length, 1); assert.equal(f.executed[0].id, requestId); f.select('other'); await flush(); assert.equal(f.byLabel('任务操作内容').value, '另一目标的内存草稿');
  } finally { f.api.destroy(); }
});

test('inspection restores pending journal receipts and bounds result prefill with a visible truncation notice', async () => {
  const f = fixture({ inspect: async target => ({ ...available(target), resultText: '长'.repeat(17000), pendingReceipt: { id: 'old-request', action: 'deliver', target, status: 'unknown' } }) }); try {
    f.select('child'); await flush(); f.byText('交给主任务继续').click();
    assert.equal(f.byLabel('任务操作内容').value.length, 16000); assert.equal(f.byLabel('任务操作内容').maxLength, 16000);
    assert.match(f.container.textContent, /已填入部分内容/); assert.equal(f.byText('发送给主任务').disabled, true); assert.equal(f.status().getAttribute('data-status'), 'unknown');
    f.byText('打开对话核对').click(); assert.equal(f.opened.at(-1).threadId, 'main'); assert.equal(f.executed.length, 0);
  } finally { f.api.destroy(); }
});

test('a created child is reachable even when its first turn failed or is uncertain', async () => {
  for (const status of ['failed', 'unknown']) {
    const f = fixture({ execute: async () => ({ status, message: '子任务已创建，首轮尚未确认。', child: { ...ref('created'), title: '示例已创建子任务' } }) }); try {
      f.select('main'); await flush(); f.byText('拆出子任务').click(); f.input('检查发送失败后的恢复入口'); await f.byText('创建子任务').click();
      assert.equal(f.status().getAttribute('data-status'), status); assert.equal(f.byText('打开子任务').hidden, false); f.byText('打开子任务').click(); assert.equal(f.opened.at(-1).threadId, 'created');
    } finally { f.api.destroy(); }
  }
});
