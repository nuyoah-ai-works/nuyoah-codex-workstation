import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../nuyoah/workstation/work-items-ui.js', import.meta.url), 'utf8');
// An isolated DOM fixture for draft and request transitions, not native GUI acceptance.
function setup(items = [], tasks = [], { canvas = true, context = null } = {}) {
  let document, sequence = 0, now = 1000;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.style = {}; this.disabled = false; this.hidden = false; this.value = ''; this._text = ''; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
    replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...children); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key]; }
    focus() { document.activeElement = this; }
    click() { if (!this.disabled) this.onclick?.(); }
    querySelectorAll(selector) { const tags = selector.split(','); return this.children.flatMap(child => [...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector)]); }
  }
  document = { body: new Element('body'), head: new Element('head'), createElement: tag => new Element(tag) };
  const timers = new Map();
  const canvasInstances = [], layouts = new Map();
  const window = { __NUYOAH_WORKSTATION_CONFIG__: { workItemsCommand: ['node', '/fixture/work-items.mjs'] } };
  if (canvas) window.__nuyoahWorkCanvas__ = { create({ container, storageKey, onActivate }) {
    const instance = { storageKey, destroyed: false, updates: 0, model: null, focused: null,
      update(model) {
        this.model = JSON.parse(JSON.stringify(model)); this.updates++; container.replaceChildren();
        const positions = layouts.get(storageKey) || {};
        for (const node of model.nodes) {
          if (!positions[node.id]) positions[node.id] = { x: node.x, y: node.y };
          const button = new Element('button'); button.textContent = `${node.title} ${node.subtitle || ''} ${node.badge || ''}`;
          button.setAttribute('data-node-id', node.id);
          button.setAttribute('aria-label', `${node.kind === 'item' ? '编辑事项' : node.kind === 'plan' ? '编辑节点' : node.kind === 'task' ? '打开任务' : '查看方向'}：${node.title}`);
          button.onclick = () => onActivate(node.id); container.append(button);
        }
        layouts.set(storageKey, positions);
      },
      fit() {}, arrange() {}, focus(id) { this.focused = id; },
      activate(id) { onActivate(id); },
      getLayout() { return { schemaVersion: 1, positions: layouts.get(storageKey) || {} }; },
      destroy() { this.destroyed = true; }
    }; canvasInstances.push(instance); return instance;
  } };
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(source, { window, document, Date: Clock, crypto: { randomUUID: () => `id-${++sequence}` }, setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id), Blob, URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} } });
  const api = window.__nuyoahWorkItemsUI__, container = new Element('section'), opened = [], inserted = [];
  const options = { context: context || { hostId: 'local', threadId: 'same' }, tasks, openTask: task => opened.push(task), insertText: text => { inserted.push(text); return true; } };
  document.body.append(container); api.mount(container, options);
  const initial = api.takeRequest(); api.receive({ id: initial.id, data: { schemaVersion: 1, revision: 1, updatedAt: null, items } });
  const all = () => [container, ...walk(container)];
  function walk(element) { return element.children.flatMap(child => [child, ...walk(child)]); }
  const byLabel = label => all().find(element => element.getAttribute('aria-label') === label);
  const byText = (text, tag = 'button') => all().find(element => element.tagName === tag && element.textContent === text);
  return { api, container, options, initial, opened, inserted, byLabel, byText, all, document, timers, canvasInstances, layouts,
    canvas(key = 'nuyoah.work-items-canvas.v1') { return canvasInstances.filter(instance => instance.storageKey === key && !instance.destroyed).at(-1); },
    input(label, value) { const element = byLabel(label); assert.ok(element, label); element.value = value; element.oninput(); },
    select(label, value) { const element = byLabel(label); assert.ok(element, label); element.value = value; element.onchange(); },
    refresh() { now += 11000; api.mount(container, options); return api.takeRequest(); },
    respond(request, nextItems, revision = 2) { api.receive({ id: request.id, data: { schemaVersion: 1, revision, updatedAt: null, items: nextItems } }); }
  };
}
const item = (extra = {}) => ({ id: 'work-a', title: '一个工作事项', direction: '产品', nextStep: '验证用户路径', note: '', status: 'doing', focus: true, archived: false, threadLinks: [], nodes: [], ...extra });
const node = (extra = {}) => ({ id: 'node-a', parentId: '', title: '第一步', kind: 'milestone', status: 'doing', manualStatus: 'done', source: '本轮记录', updatedAt: '2026-09-21T00:00:00Z', ...extra });

test('mount preserves an active draft and host-scoped links contain only explicit identities', () => {
  const tasks = [{ hostId: 'local', threadId: 'same', title: '同名任务', statusLabel: '执行中' }, { hostId: 'remote', threadId: 'same', title: '同名任务', statusLabel: '等待中' }];
  const f = setup([], tasks); try {
    f.byText('新建事项').click(); f.input('事项名称', '继续一件事');
    f.api.mount(f.container, f.options); assert.equal(f.byLabel('事项名称').value, '继续一件事'); assert.equal(f.api.takeRequest(), null);
    const choices = f.all().filter(element => element.className === 'nuyoah-work-task-choice'); choices[1].click();
    f.byText('保存事项').click(); const save = f.api.takeRequest();
    assert.equal(save.action, 'save'); assert.equal(save.consumer, 'work-items'); assert.equal(save.revision, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(save.item.threadLinks)), [{ hostId: 'remote', threadId: 'same' }]);
    assert.equal(save.item.status, 'idea'); assert.equal(f.byLabel('事项名称').disabled, true);
    f.respond(save, [item({ id: 'saved', title: '继续一件事' })]); assert.equal(f.byLabel('事项名称'), undefined);
  } finally { f.api.destroy(); }
});

test('stale refresh keeps the draft, blocks overwrite and permits explicit discard/reload', () => {
  const f = setup([item()]); try {
    f.byLabel('编辑事项：一个工作事项').click(); f.input('下一步', '未保存的新步骤');
    const read = f.refresh(); assert.equal(read.action, 'read');
    f.respond(read, [item({ nextStep: '另一位编辑者的新步骤' })], 2);
    assert.equal(f.byLabel('下一步').value, '未保存的新步骤'); assert.equal(f.byText('保存事项').disabled, true);
    assert.match(f.container.textContent, /另一位编辑者的新步骤/);
    f.byText('保存事项').click(); assert.equal(f.api.takeRequest(), null);
    f.byText('放弃草稿并重载').click(); assert.equal(f.byLabel('下一步').value, '另一位编辑者的新步骤');
    f.input('下一步', '核对后编辑'); f.byText('保存事项').click(); assert.equal(f.api.takeRequest().revision, 2);
  } finally { f.api.destroy(); }
});

test('plan views share edits and following the record clears only the manual override', () => {
  const f = setup([item({ nodes: [node(), node({ id: 'child', parentId: 'node-a', title: '子步骤', manualStatus: null })] })]); try {
    f.byLabel('编辑事项：一个工作事项').click(); f.byLabel('编辑节点：第一步').click();
    f.select('显示状态', ''); f.input('节点名称', '更新后的第一步');
    f.byText('计划图').click(); assert.match(f.byLabel('事项计划图').textContent, /更新后的第一步/);
    f.byLabel('计划列表').click(); assert.match(f.byLabel('事项计划列表').textContent, /更新后的第一步/);
    const parentOptions = f.byLabel('父节点').children.map(element => element.value); assert.deepEqual(parentOptions, ['']);
    f.byText('保存事项').click(); const save = f.api.takeRequest();
    assert.equal(save.item.nodes[0].title, '更新后的第一步'); assert.equal(save.item.nodes[0].manualStatus, null); assert.equal(save.item.nodes[0].status, 'doing');
    assert.equal(save.item.status, 'doing');
  } finally { f.api.destroy(); }
});

test('removing a parent preserves its children and newer catalog state never completes a work item', () => {
  const f = setup([item({ threadLinks: [{ hostId: 'local', threadId: 'same' }], nodes: [node(), node({ id: 'child', parentId: 'node-a', title: '子步骤' })] })], [{ hostId: 'local', threadId: 'same', title: '关联任务', statusLabel: '执行中' }]); try {
    f.byLabel('编辑事项：一个工作事项').click(); f.byLabel('编辑节点：第一步').click(); f.byText('移除节点').click();
    f.api.mount(f.container, { ...f.options, tasks: [{ hostId: 'local', threadId: 'same', title: '关联任务', statusLabel: '已确认完成' }] });
    assert.equal(f.byLabel('事项状态').value, 'doing');
    f.byText('保存事项').click(); const save = f.api.takeRequest(); assert.equal(save.item.nodes.length, 1); assert.equal(save.item.nodes[0].id, 'child'); assert.equal(save.item.nodes[0].parentId, '');
  } finally { f.api.destroy(); }
});

test('errors preserve drafts and unknown responses cannot replace active state', () => {
  const f = setup([item()]); try {
    f.byLabel('编辑事项：一个工作事项').click(); f.input('补充说明', '<script>private draft</script>');
    f.byText('保存事项').click(); const save = f.api.takeRequest();
    f.api.receive({ id: 'unknown', data: { revision: 10, items: [] } }); assert.equal(f.byLabel('补充说明').value, '<script>private draft</script>');
    f.api.receive({ id: save.id, error: '记录版本冲突' }); assert.equal(f.byLabel('补充说明').disabled, false); assert.equal(f.byLabel('补充说明').value, '<script>private draft</script>'); assert.equal(f.byText('保存事项').disabled, true);
    assert.equal(f.all().some(element => element.tagName === 'script'), false);
  } finally { f.api.destroy(); }
});

test('archiving is reversible and assistant maintenance only fills the existing composer', () => {
  const f = setup([item()]); try {
    f.byLabel('编辑事项：一个工作事项').click(); f.byText('请助手更新').click(); assert.equal(f.inserted.length, 1); assert.match(f.inserted[0], /保留稳定节点 ID/); assert.equal(f.api.takeRequest(), null);
    f.byText('归档事项').click(); const archive = f.api.takeRequest(); assert.equal(archive.archived, true); assert.equal(archive.itemId, 'work-a');
    f.respond(archive, [item({ archived: true })]); f.select('事项范围', 'archived'); f.byLabel('编辑事项：一个工作事项').click(); f.byText('恢复事项').click();
    const restore = f.api.takeRequest(); assert.equal(restore.archived, false); assert.equal(restore.revision, 2);
  } finally { f.api.destroy(); }
});

test('unrelated item updates safely advance the base without discarding a local draft', () => {
  const f = setup([item()]); try {
    f.byLabel('编辑事项：一个工作事项').click(); f.input('下一步', '本地修改');
    const read = f.refresh(); f.respond(read, [item(), item({ id: 'work-b', title: '其他事项' })], 2);
    assert.equal(f.byLabel('下一步').value, '本地修改'); assert.equal(f.byText('保存事项').disabled, false);
    f.byText('保存事项').click(); assert.equal(f.api.takeRequest().revision, 2);
  } finally { f.api.destroy(); }
});

test('unnamed new plan nodes are kept in the draft and cannot produce a rejected save', () => {
  const f = setup([item()]); try {
    f.byLabel('编辑事项：一个工作事项').click(); f.byText('添加节点').click(); f.byText('保存事项').click();
    assert.equal(f.api.takeRequest(), null); assert.match(f.container.textContent, /请填写节点名称后保存/);
    assert.equal(f.document.activeElement, f.byLabel('节点名称'));
    f.input('节点名称', '需要验证的一步'); f.byText('保存事项').click(); assert.equal(f.api.takeRequest().item.nodes[0].title, '需要验证的一步');
  } finally { f.api.destroy(); }
});

test('a pending write cannot switch drafts or regain edit controls from catalog refresh', () => {
  const a = item(), b = item({ id: 'work-b', title: '第二事项' });
  const tasks = [{ hostId: 'local', threadId: 'one', title: '关联任务', statusLabel: '执行中' }];
  const f = setup([a, b], tasks); try {
    f.byLabel('编辑事项：一个工作事项').click(); f.byText('归档事项').click();
    const write = f.api.takeRequest();
    f.byLabel('编辑事项：第二事项').click();
    assert.equal(f.byLabel('事项名称').value, a.title);
    f.api.mount(f.container, { ...f.options, tasks: [{ ...tasks[0], statusLabel: '待处理' }] });
    assert.equal(f.byLabel('事项名称').disabled, true);
    assert.ok(f.all().filter(element => element.className === 'nuyoah-work-task-choice').every(element => element.disabled));
    f.respond(write, [{ ...a, archived: true }, b]);
    f.byLabel('编辑事项：第二事项').click(); f.input('下一步', '新的草稿');
    f.api.receive({ id: write.id, data: { revision: 2, items: [a, b] } });
    assert.equal(f.byLabel('下一步').value, '新的草稿');
  } finally { f.api.destroy(); }
});

test('a new item keeps its identity when a committed save response is lost', () => {
  const f = setup(); try {
    f.byText('新建事项').click(); f.input('事项名称', '只创建一次'); f.byText('保存事项').click();
    const save = f.api.takeRequest(); assert.ok(save.item.id);
    [...f.timers.values()].at(-1)();
    const read = f.refresh(); f.respond(read, [save.item], 2);
    assert.equal(f.byLabel('事项名称').value, '只创建一次');
    f.input('下一步', '继续同一事项'); f.byText('保存事项').click();
    const retry = f.api.takeRequest();
    assert.equal(retry.item.id, save.item.id); assert.equal(retry.revision, 2);
  } finally { f.api.destroy(); }
});

test('default canvas groups directions and exposes content before collapsed item details', () => {
  const f = setup([item(), item({ id: 'work-b', title: '准备内容', direction: '内容', focus: false, nextStep: '整理提纲' })]); try {
    const graph = f.canvas(); assert.ok(graph);
    assert.equal(f.byText('画布').getAttribute('aria-pressed'), 'true');
    assert.equal(graph.model.nodes.filter(value => value.kind === 'direction').length, 2);
    assert.equal(graph.model.edges.length, 2);
    const work = graph.model.nodes.find(value => value.id === 'item:work-a');
    assert.match(work.badge, /重点.*推进中/); assert.match(work.subtitle, /验证用户路径/);
    graph.activate('item:work-a');
    const details = f.all().find(element => element.className === 'nuyoah-work-item-details'); assert.equal(details.open, false);
    const inspector = f.all().find(element => element.className === 'nuyoah-work-editor');
    assert.ok(inspector.children.findIndex(element => element.className === 'nuyoah-work-inspector-next') < inspector.children.indexOf(details));
    assert.equal(inspector.parentNode.className, 'nuyoah-work-stage');
    graph.activate(`direction:${encodeURIComponent('内容')}`);
    assert.deepEqual(graph.model.nodes.filter(value => value.kind === 'item').map(value => value.title), ['准备内容']);
  } finally { f.api.destroy(); }
});

test('canvas task links resolve host identity and navigation retains unsaved item content', () => {
  const links = [{ hostId: 'local', threadId: 'same' }, { hostId: 'remote', threadId: 'same' }];
  const tasks = [{ ...links[0], title: '本机任务', statusLabel: '执行中' }, { ...links[1], title: '远程任务', statusLabel: '等待中' }];
  const f = setup([item({ threadLinks: links })], tasks); try {
    f.canvas().activate('item:work-a'); f.input('下一步', '仍未保存的下一步');
    const graph = f.canvas(); assert.equal(graph.model.nodes.filter(value => value.kind === 'task').length, 2);
    graph.activate(`task:${JSON.stringify(['remote', 'same'])}`);
    assert.equal(f.opened[0].hostId, 'remote');
    f.api.mount(f.container, { ...f.options, context: { hostId: 'remote', threadId: 'same' } });
    assert.equal(f.byLabel('下一步').value, '仍未保存的下一步'); assert.equal(f.api.takeRequest(), null);
    f.byText('保存事项').click(); const save = f.api.takeRequest(); assert.equal(save.item.nextStep, '仍未保存的下一步'); assert.equal(save.item.status, 'doing');
  } finally { f.api.destroy(); }
});

test('canvas layout is separate from the plan, and unchanged reads do not recreate its editor', () => {
  const f = setup([item({ nodes: [node()] })]); try {
    f.canvas().activate('item:work-a'); const key = 'nuyoah.work-item-plan-canvas.v1:work-a', graph = f.canvas(key);
    assert.ok(graph); graph.activate('plan:node-a');
    const title = f.byLabel('节点名称'); f.layouts.get(key)['plan:node-a'] = { x: 777, y: 333 };
    const read = f.refresh(); f.respond(read, [item({ nodes: [node()] })], 2);
    assert.equal(f.canvas(key), graph); assert.equal(f.byLabel('节点名称'), title);
    f.input('节点名称', '画布即时更新'); assert.equal(graph.model.nodes.find(value => value.id === 'plan:node-a').title, '画布即时更新');
    assert.equal(f.byLabel('节点名称'), title);
    f.byLabel('计划列表').click(); f.byText('计划图').click(); assert.deepEqual(f.canvas(key).getLayout().positions['plan:node-a'], { x: 777, y: 333 });
    f.byText('保存事项').click(); const save = f.api.takeRequest();
    assert.equal(save.revision, 2); assert.equal(save.item.nodes[0].title, '画布即时更新');
    assert.equal(Object.hasOwn(save.item.nodes[0], 'x'), false); assert.equal(Object.hasOwn(save.item.nodes[0], 'y'), false);
  } finally { f.api.destroy(); }
});

test('an empty store invites creation and never imports project history into the canvas', () => {
  const tasks = [
    { hostId: 'local', threadId: 'a', projectId: 'first', title: '项目一历史任务', statusLabel: '执行中' },
    { hostId: 'local', threadId: 'b', projectId: 'second', title: '项目二历史任务', statusLabel: '待处理' },
    { hostId: 'remote', threadId: 'a', projectId: 'first', title: '远程历史任务', statusLabel: '等待中' }
  ];
  const f = setup([], tasks, { context: { hostId: 'local', threadId: 'a', projectId: 'first' } }); try {
    assert.equal(f.canvas(), undefined); assert.match(f.container.textContent, /记下一件想推进的事/);
    assert.doesNotMatch(f.container.textContent, /历史任务/); assert.equal(f.api.takeRequest(), null);
    for (const context of [{ hostId: 'local', threadId: 'b', projectId: 'second' }, { hostId: 'remote', threadId: 'a' }]) {
      f.api.mount(f.container, { ...f.options, context });
      assert.equal(f.canvas(), undefined); assert.doesNotMatch(f.container.textContent, /历史任务/);
      assert.equal(f.api.takeRequest(), null);
    }
    f.byLabel('创建第一件事项').click(); assert.equal(f.all().find(element => element.className === 'nuyoah-work-item-details').open, true);
    assert.ok(f.byLabel('事项名称')); assert.equal(f.api.takeRequest(), null);
  } finally { f.api.destroy(); }
});

test('the list remains usable when the optional canvas component is unavailable', () => {
  const f = setup([item({ nodes: [node()] })], [], { canvas: false }); try {
    assert.equal(f.byText('画布').hidden, true); assert.equal(f.canvas(), undefined);
    f.byLabel('编辑事项：一个工作事项').click(); f.byLabel('编辑节点：第一步').click(); f.input('节点名称', '文字列表仍可编辑');
    f.byText('保存事项').click(); assert.equal(f.api.takeRequest().item.nodes[0].title, '文字列表仍可编辑');
  } finally { f.api.destroy(); }
});

for (const failure of ['error', 'timeout']) test(`a background read ${failure} preserves the focused editor and canvas until read recovery`, () => {
  const original = item({ nodes: [node()] }), key = 'nuyoah.work-item-plan-canvas.v1:work-a';
  const f = setup([original]); try {
    f.canvas().activate('item:work-a'); f.canvas(key).activate('plan:node-a');
    f.input('节点名称', '输入中的节点标题');
    const input = f.byLabel('节点名称'), canvas = f.canvas(key); input.focus();
    const read = f.refresh(); assert.equal(f.byText('保存事项').disabled, true);
    if (failure === 'error') f.api.receive({ id: read.id, error: '暂时无法读取' });
    else [...f.timers.values()].at(-1)();
    assert.equal(f.byLabel('节点名称'), input); assert.equal(f.document.activeElement, input);
    assert.equal(f.canvas(key), canvas); assert.equal(canvas.destroyed, false);
    assert.equal(input.value, '输入中的节点标题'); assert.equal(input.disabled, false);
    assert.equal(f.byText('保存事项').disabled, true);
    const retry = f.refresh(); f.respond(retry, [original], 1);
    assert.equal(f.byLabel('节点名称'), input); assert.equal(f.document.activeElement, input);
    assert.equal(f.canvas(key), canvas); assert.equal(f.byText('保存事项').disabled, false);
    f.byText('保存事项').click(); assert.equal(f.api.takeRequest().item.nodes[0].title, '输入中的节点标题');
  } finally { f.api.destroy(); }
});


test('one toolbar keeps secondary controls hidden until requested and Escape preserves drafts', () => {
  const f = setup([item()]); try {
    const toolbar = f.all().find(element => element.className === 'nuyoah-work-toolbar');
    assert.ok(toolbar); assert.doesNotMatch(toolbar.textContent, /刷新|导出|工作事项/);
    const menu = f.all().find(element => element.className === 'nuyoah-work-menu');
    const filters = f.all().find(element => element.className === 'nuyoah-work-filters');
    assert.equal(menu.hidden, true); assert.equal(filters.hidden, true);
    f.byLabel('工作事项选项').click(); assert.equal(menu.hidden, false);
    assert.equal(f.byLabel('工作事项选项').getAttribute('aria-expanded'), 'true');
    f.byText('查找与筛选').click(); assert.equal(menu.hidden, true); assert.equal(filters.hidden, false);
    assert.equal(f.document.activeElement, f.byLabel('搜索工作事项'));
    f.input('搜索工作事项', 'does-not-match'); assert.match(f.container.textContent, /没有符合筛选的事项/);
    f.byText('清除筛选').click(); assert.equal(f.byLabel('搜索工作事项').value, '');
    assert.equal(f.api.dismiss(), true); assert.equal(filters.hidden, true);
    f.byLabel('编辑事项：一个工作事项').click(); f.input('下一步', '保持的草稿');
    const inspector = f.all().find(element => element.className === 'nuyoah-work-editor');
    assert.equal(f.api.dismiss(), true); assert.equal(inspector.hidden, true);
    assert.equal(f.byLabel('下一步').value, '保持的草稿'); assert.equal(f.api.takeRequest(), null);
    f.byLabel('编辑事项：一个工作事项').click(); assert.equal(inspector.hidden, false);
    assert.equal(f.byLabel('下一步').value, '保持的草稿');
    f.byText('保存事项').click(); assert.equal(f.api.takeRequest().item.nextStep, '保持的草稿');
  } finally { f.api.destroy(); }
});

test('calm work item styles share native tokens and keep the inspector inside the viewport', () => {
  for (const token of ['surface', 'canvas-bg', 'subtle', 'border', 'text', 'muted', 'accent', 'accent-soft']) assert.match(source, new RegExp('--nuyoah-' + token));
  assert.match(source, /@container \(max-width:700px\)/);
  assert.match(source, /nuyoah-work-editor\{position:absolute/);
  assert.doesNotMatch(source, /currentProjectTasks|projectTaskLimit/);
});
