import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../nuyoah/workstation/work-canvas.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const node = (id, x = 0, y = 0, extra = {}) => ({ id, x, y, title: id, subtitle: 'Next action', badge: '待推进', kind: 'item', tone: 'sage', ...extra });

// Isolated DOM/event math, deliberately not a substitute for native browser acceptance.
function fixture({ saved, cssZoom = 1, width = 900, height = 400, failStorage = false } = {}) {
  let mutations = 0, sequence = 0, document;
  class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  }
  class Element extends Target {
    constructor(tag) {
      super(); this.tagName = tag; this.children = []; this.attributes = new Map(); this.ownerDocument = document; this._text = ''; this.hidden = false;
      this.clientWidth = width; this.clientHeight = height; this.offsetWidth = width + 2; this.offsetHeight = height + 2; this.clientLeft = 1; this.clientTop = 1;
      this.style = new Proxy({}, { set(target, key, value) { if (target[key] !== value) mutations++; target[key] = value; return true; } });
    }
    set textContent(value) { this._text = String(value); this.children = []; mutations++; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    setAttribute(key, value) { this.attributes.set(key, String(value)); mutations++; }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); mutations++; } }
    remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; mutations++; } }
    closest(selector) { if (selector === '[data-node-id]' && this.getAttribute('data-node-id')) return this; return this.parentNode?.closest?.(selector) || null; }
    getBoundingClientRect() { return { left: 10, top: 20, width: this.offsetWidth * cssZoom, height: this.offsetHeight * cssZoom }; }
    focus() { document.activeElement = this; }
    setPointerCapture(id) { this.pointer = id; }
    hasPointerCapture(id) { return this.pointer === id; }
    releasePointerCapture() { this.pointer = null; }
  }
  document = new Target(); document.visibilityState = 'visible'; document.createElement = tag => new Element(tag); document.createElementNS = (_, tag) => new Element(tag);
  document.body = new Element('body');
  const window = new Target(), storage = new Map(), timers = new Map(), observers = [], activated = [];
  if (saved !== undefined) storage.set('layout', typeof saved === 'string' ? saved : JSON.stringify(saved));
  window.localStorage = { getItem: key => { if (failStorage) throw Error('blocked'); return storage.get(key) ?? null; }, setItem: (key, value) => { if (failStorage) throw Error('blocked'); storage.set(key, value); } };
  class Observer { constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  vm.runInNewContext(source, { window, document, ResizeObserver: Observer, setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) });
  const container = new Element('section'); document.body.append(container);
  const api = window.__nuyoahWorkCanvas__.create({ container, storageKey: 'layout', onActivate: id => activated.push(id) });
  const all = (element = container) => [element, ...element.children.flatMap(child => all(child))];
  const byClass = className => all().find(element => element.className === className);
  const viewport = byClass('nuyoah-work-canvas-viewport');
  function emit(target, type, extra = {}) {
    const event = { target, button: 0, isPrimary: true, pointerId: 1, clientX: 10 + cssZoom, clientY: 20 + cssZoom, deltaMode: 0, deltaX: 0, deltaY: 0,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    for (let current = target; current; current = current.parentNode) {
      for (const callback of [...(current.listeners.get(type) || [])]) callback(event);
      if (event.stopped) break;
    }
    return event;
  }
  return { api, container, viewport, document, window, storage, timers, observers, activated, all, byClass, emit,
    get mutations() { return mutations; },
    screen(x, y) { return { clientX: 10 + (x + 1) * cssZoom, clientY: 20 + (y + 1) * cssZoom }; },
    node(id) { return all().find(element => element.getAttribute('data-node-id') === id); },
    edge(from, to) { return all().find(element => element.getAttribute('data-edge-from') === from && element.getAttribute('data-edge-to') === to); },
    flush() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
  };
}

test('pointer dragging respects canvas and host CSS zoom, redraws edges, and never activates after a drag', () => {
  const f = fixture({ cssZoom: 1.1, saved: { schemaVersion: 1, viewport: { x: 20, y: 30, zoom: .5 }, positions: {} } });
  try {
    f.api.update({ nodes: [node('a'), node('b', 400, 0)], edges: [{ from: 'a', to: 'b' }] });
    const button = f.node('a'), edge = f.edge('a', 'b'), before = edge.getAttribute('d');
    f.emit(button, 'pointerdown', f.screen(100, 80));
    f.emit(f.viewport, 'pointermove', f.screen(150, 110));
    f.emit(f.viewport, 'pointerup', f.screen(150, 110));
    close(f.api.getLayout().positions.a.x, 100); close(f.api.getLayout().positions.a.y, 60);
    assert.equal(button.style.left, '100px'); assert.notEqual(edge.getAttribute('d'), before);
    f.emit(button, 'click'); assert.deepEqual(f.activated, []);
    // Dragging is persisted before another lifecycle event or timer can run.
    close(JSON.parse(f.storage.get('layout')).positions.a.x, 100);
    f.emit(button, 'pointerdown', f.screen(170, 140)); f.emit(f.viewport, 'pointerup', f.screen(170, 140)); f.emit(button, 'click');
    assert.deepEqual(f.activated, ['a']);
  } finally { f.api.destroy(); }
});

test('zoom preserves the cursor world point at CSS zoom 1.1; ordinary wheel and blank dragging pan', () => {
  const f = fixture({ cssZoom: 1.1 });
  try {
    f.api.update({ nodes: [node('a')], edges: [] });
    const before = plain(f.api.getLayout().viewport), anchor = { x: 345, y: 175 };
    const world = { x: (anchor.x - before.x) / before.zoom, y: (anchor.y - before.y) / before.zoom };
    const wheel = f.emit(f.viewport, 'wheel', { ...f.screen(anchor.x, anchor.y), ctrlKey: true, deltaY: -120 });
    const zoomed = f.api.getLayout().viewport;
    close((anchor.x - zoomed.x) / zoomed.zoom, world.x); close((anchor.y - zoomed.y) / zoomed.zoom, world.y);
    assert.equal(wheel.defaultPrevented, true);
    f.emit(f.viewport, 'wheel', { deltaX: 12, deltaY: 40 });
    close(f.api.getLayout().viewport.x, zoomed.x - 12); close(f.api.getLayout().viewport.y, zoomed.y - 40);
    const pan = plain(f.api.getLayout().viewport);
    f.emit(f.viewport, 'pointerdown', f.screen(400, 200)); f.emit(f.viewport, 'pointermove', f.screen(455, 230)); f.emit(f.viewport, 'pointerup', f.screen(455, 230));
    close(f.api.getLayout().viewport.x, pan.x + 55); close(f.api.getLayout().viewport.y, pan.y + 30);
    assert.deepEqual(f.activated, []);
  } finally { f.api.destroy(); }
});

test('unchanged host updates do not mutate DOM; content updates preserve positions, viewport and focused buttons', () => {
  const f = fixture();
  try {
    const data = { nodes: [node('a'), node('b', 400)], edges: [{ from: 'a', to: 'b' }] };
    f.api.update(data); f.api.focus('a');
    const element = f.node('a'); f.emit(element, 'keydown', { key: 'ArrowRight' }); f.emit(f.viewport, 'wheel', { deltaY: 20 });
    const layout = plain(f.api.getLayout()), mutations = f.mutations;
    f.api.update(data); f.api.update(plain(data));
    assert.equal(f.mutations, mutations); assert.equal(f.document.activeElement, element);
    f.api.update({ ...data, nodes: [node('a', 900, 500, { title: 'A revised title' }), node('b', 400)] });
    assert.deepEqual(plain(f.api.getLayout()), layout); assert.equal(f.node('a'), element); assert.equal(f.document.activeElement, element);
    assert.match(element.textContent, /A revised title/);
    f.api.arrange(); close(f.api.getLayout().positions.a.x, 900); close(f.api.getLayout().positions.a.y, 500);
  } finally { f.api.destroy(); }
});

test('reload before debounce retains both drag and latest wheel view through pagehide or hidden visibility', () => {
  const f = fixture();
  f.api.update({ nodes: [node('a')], edges: [] });
  f.emit(f.node('a'), 'pointerdown', f.screen(200, 120)); f.emit(f.viewport, 'pointermove', f.screen(270, 155)); f.emit(f.viewport, 'pointerup', f.screen(270, 155));
  f.emit(f.viewport, 'wheel', { ...f.screen(300, 160), metaKey: true, deltaY: -90 });
  f.emit(f.viewport, 'wheel', { deltaX: 25, deltaY: 45 });
  const expected = plain(f.api.getLayout());
  f.emit(f.window, 'pagehide');
  const restored = fixture({ saved: f.storage.get('layout') });
  try {
    restored.api.update({ nodes: [node('a')], edges: [] });
    assert.deepEqual(plain(restored.api.getLayout()), expected);
    restored.emit(restored.viewport, 'wheel', { deltaY: 20 }); restored.document.visibilityState = 'hidden'; restored.emit(restored.document, 'visibilitychange');
    assert.deepEqual(JSON.parse(restored.storage.get('layout')), plain(restored.api.getLayout()));
  } finally { f.api.destroy(); restored.api.destroy(); }
});

test('corrupt or non-finite stored values cannot poison layout and blocked storage keeps interactions usable', () => {
  for (const saved of ['{broken', { schemaVersion: 1, viewport: { x: 'bad', y: 0, zoom: 8 }, positions: { a: { x: 1e20, y: 0 }, b: { x: 77, y: 88 } } }]) {
    const f = fixture({ saved });
    try {
      f.api.update({ nodes: [node('a', 12, 20), node('b', 300)], edges: [] });
      close(f.api.getLayout().positions.a.x, 12); assert.ok(Number.isFinite(f.api.getLayout().viewport.zoom));
      if (typeof saved === 'object') close(f.api.getLayout().positions.b.x, 77);
      assert.equal(f.api.getLayout().viewport.zoom >= .75, true);
    } finally { f.api.destroy(); }
  }
  const blocked = fixture({ failStorage: true });
  try {
    blocked.api.update({ nodes: [node('a')], edges: [] }); blocked.flush();
    blocked.emit(blocked.node('a'), 'keydown', { key: 'ArrowRight' }); blocked.emit(blocked.node('a'), 'keydown', { key: 'Enter' });
    assert.deepEqual(blocked.activated, ['a']); assert.match(blocked.container.textContent, /布局暂未保存/);
  } finally { blocked.api.destroy(); }
});

test('first layout stays readable, explicit fit shows the full bounds, and destroy releases lifecycle listeners', () => {
  const f = fixture({ width: 450, height: 300 });
  const nodes = Array.from({ length: 8 }, (_, i) => node(`task-${i}`, 300, i * 140));
  f.api.update({ nodes, edges: [] }); assert.equal(f.api.getLayout().viewport.zoom, .75);
  f.api.fit(); assert.ok(f.api.getLayout().viewport.zoom < .3);
  const zoom = f.api.getLayout().viewport.zoom;
  f.emit(f.node('task-0'), 'keydown', { key: 'ArrowDown', shiftKey: true }); close(f.api.getLayout().positions['task-0'].y, 50 / zoom);
  const before = f.api.getLayout().viewport.y; f.emit(f.viewport, 'keydown', { key: 'ArrowDown' }); close(f.api.getLayout().viewport.y, before - 10);
  f.api.destroy();
  assert.equal(f.container.children.length, 0); assert.equal(f.timers.size, 0); assert.ok(f.observers.every(observer => observer.disconnected));
  assert.ok([...f.window.listeners.values(), ...f.document.listeners.values(), ...f.viewport.listeners.values()].every(set => set.size === 0));
  const mutations = f.mutations; f.api.update({ nodes: [node('late')], edges: [] }); assert.equal(f.mutations, mutations);
});

test('a newly prioritized node avoids every existing position while arrange restores the supplied layout', () => {
  const f = fixture();
  try {
    f.api.update({ nodes: [node('old-a', 300, 0), node('old-b', 300, 140)], edges: [] });
    f.emit(f.node('old-a'), 'keydown', { key: 'ArrowDown' });
    const old = plain(f.api.getLayout());
    const data = { nodes: [node('new-priority', 300, 0), node('old-a', 300, 150), node('old-b', 300, 300)], edges: [] };
    f.api.update(data);
    const next = f.api.getLayout();
    assert.deepEqual(plain(next.positions['old-a']), old.positions['old-a']);
    assert.deepEqual(plain(next.positions['old-b']), old.positions['old-b']);
    assert.deepEqual(plain(next.viewport), old.viewport);
    for (const id of ['old-a', 'old-b']) {
      const a = next.positions['new-priority'], b = next.positions[id];
      assert.ok(a.y >= b.y + parseFloat(f.node(id).style.height) || a.y + parseFloat(f.node('new-priority').style.height) <= b.y, `${id} is not obscured`);
    }
    close(next.positions['new-priority'].x, 300);
    const mutations = f.mutations; f.api.update(data); assert.equal(f.mutations, mutations);
    f.api.arrange();
    for (const raw of data.nodes) assert.deepEqual(plain(f.api.getLayout().positions[raw.id]), { x: raw.x, y: raw.y });
  } finally { f.api.destroy(); }
});

test('restored nodes reserve their full rectangles before new nodes even when they appear last', () => {
  const f = fixture({ saved: { schemaVersion: 1, viewport: { x: 10, y: 20, zoom: 1 }, positions: { existing: { x: 300, y: 0 } } } });
  try {
    f.api.update({ nodes: [node('new-a', 300, 0), node('new-b', 300, 0), node('existing', 300, 280, { height: 180 })], edges: [] });
    const { positions } = f.api.getLayout();
    assert.deepEqual(plain(positions.existing), { x: 300, y: 0 });
    assert.ok(positions['new-a'].y >= 180);
    assert.ok(positions['new-b'].y >= positions['new-a'].y + parseFloat(f.node('new-a').style.height));
  } finally { f.api.destroy(); }
});

test('caller activity and current conversation are independent from selection and preserve node identity and layout', () => {
  const f = fixture();
  try {
    const graph = activity => ({ nodes: [node('a', 0, 0, { kind: 'task', activity, current: true }), node('b', 400)], edges: [{ from: 'a', to: 'b' }], selectedId: 'b' });
    f.api.update(graph('running')); f.flush();
    const button = f.node('a'), other = f.node('b'), layout = plain(f.api.getLayout()), saved = f.storage.get('layout');
    assert.equal(button.getAttribute('data-activity'), 'running'); assert.equal(button.getAttribute('data-current'), 'true');
    assert.equal(button.getAttribute('aria-current'), 'true'); assert.equal(button.getAttribute('data-selected'), 'false');
    assert.equal(other.getAttribute('data-selected'), 'true'); assert.equal(other.getAttribute('data-activity'), 'idle');
    assert.match(button.getAttribute('aria-label'), /进行中/); assert.match(button.getAttribute('aria-label'), /当前对话/);
    assert.equal(f.byClass('nuyoah-work-canvas-node-dot').hidden, false);
    const mutations = f.mutations; f.api.update(plain(graph('running'))); assert.equal(f.mutations, mutations);
    for (const [activity, label] of [['waiting', '等待中'], ['completed', '已完成'], ['failed', '失败'], ['unknown', '状态未知'], ['idle', '']]) {
      f.api.update(graph(activity));
      assert.equal(f.node('a'), button); assert.equal(button.getAttribute('data-activity'), activity);
      assert.ok(button.getAttribute('aria-label').includes(label)); assert.equal(button.getAttribute('aria-current'), 'true');
      assert.equal(f.byClass('nuyoah-work-canvas-node-dot').hidden, activity === 'idle');
      assert.equal(f.byClass('nuyoah-work-canvas-node-dot').textContent, activity === 'completed' ? '✓' : '');
      assert.deepEqual(plain(f.api.getLayout()), layout); assert.equal(f.storage.get('layout'), saved); assert.equal(f.timers.size, 0);
    }
    f.api.update({ nodes: [node('a', 0, 0, { activity: 'recently-updated', current: false })] });
    assert.equal(button.getAttribute('data-activity'), 'idle'); assert.equal(button.getAttribute('aria-current'), 'false');
    assert.equal(f.byClass('nuyoah-work-canvas-node-signal').hidden, true);
    assert.doesNotMatch(button.getAttribute('aria-label'), /进行中|当前对话|状态未知/);
    assert.equal(button.style.transform, undefined); assert.equal(button.style.left, '0px'); assert.equal(button.style.top, '0px');
  } finally { f.api.destroy(); }
});

test('running animation stops while dragging, hidden or reduced motion without erasing static state', () => {
  const f = fixture();
  f.api.update({ nodes: [node('a', 0, 0, { activity: 'running' })] });
  const button = f.node('a'), root = f.byClass('nuyoah-work-canvas');
  assert.equal(root.getAttribute('data-motion-paused'), 'false');
  f.emit(button, 'pointerdown', f.screen(200, 120)); f.emit(f.viewport, 'pointermove', f.screen(230, 145));
  assert.equal(f.viewport.getAttribute('data-dragging'), 'true');
  f.emit(f.viewport, 'pointerup', f.screen(230, 145)); assert.equal(f.viewport.getAttribute('data-dragging'), 'false');
  f.document.visibilityState = 'hidden'; f.emit(f.document, 'visibilitychange'); assert.equal(root.getAttribute('data-motion-paused'), 'true');
  assert.equal(button.getAttribute('data-activity'), 'running'); assert.equal(f.byClass('nuyoah-work-canvas-node-dot').hidden, false);
  f.document.visibilityState = 'visible'; f.emit(f.document, 'visibilitychange'); assert.equal(root.getAttribute('data-motion-paused'), 'false');
  const css = f.all().find(element => element.tagName === 'style').textContent;
  assert.match(css, /\[data-motion-paused="true"\][^{]+\{animation:none!important\}/);
  assert.match(css, /\[data-dragging="true"\][^{]+\{animation:none!important\}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{[^}]+animation:none!important/);
  assert.match(css, /@keyframes nuyoah-work-canvas-glow\{[^}]+box-shadow:/);
  assert.doesNotMatch(css.match(/@keyframes nuyoah-work-canvas-glow\{[^\n]+/)?.[0] || '', /transform:/);
  for (const condition of ['data-motion-paused="true"', 'data-dragging="true"', 'prefers-reduced-motion:reduce']) {
    const block = css.split('\n').find(line => line.includes(condition) && line.includes('animation:none!important'));
    assert.match(block, /\.nuyoah-work-canvas-node::after/);
  }
  f.api.destroy(); assert.ok([...f.document.listeners.values(), ...f.window.listeners.values()].every(set => set.size === 0));
});

test('typed relation labels update and follow dragged cards without rebuilding the edge', () => {
  const f = fixture();
  try {
    const graph = (kind, label) => ({ nodes: [node('a'), node('b', 400)], edges: [{ from: 'a', to: 'b', kind, label }] });
    f.api.update(graph('parent', '子对话'));
    const path = f.edge('a', 'b'), label = f.all().find(element => element.getAttribute('class') === 'nuyoah-work-canvas-edge-label');
    assert.equal(path.getAttribute('data-kind'), 'parent'); assert.equal(label.textContent, '子对话'); assert.equal(label.getAttribute('display'), 'inline');
    const before = label.getAttribute('y'); f.emit(f.node('a'), 'keydown', { key: 'ArrowDown' }); assert.notEqual(label.getAttribute('y'), before);
    for (const kind of ['fork', 'related', 'membership']) {
      f.api.update(graph(kind, '关联'));
      assert.equal(f.edge('a', 'b'), path); assert.equal(path.getAttribute('data-kind'), kind); assert.equal(label.textContent, '关联');
    }
    const mutations = f.mutations; f.api.update(graph('membership', '关联')); assert.equal(f.mutations, mutations);
    f.api.update(graph(undefined, undefined)); assert.equal(path.getAttribute('data-kind'), ''); assert.equal(label.getAttribute('display'), 'none');
    f.api.update({ nodes: [node('a')], edges: [] }); assert.equal(path.parentNode, null); assert.equal(label.parentNode, null);
  } finally { f.api.destroy(); }
});

test('real browser renders state motion, disables it for reduced motion and dragging, and preserves node geometry', {
  skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE || !process.env.NUYOAH_TEST_BROWSER,
}, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
    await page.setContent('<!doctype html><style>body{margin:20px;background:#f8faf9;color:#24352b;font:14px system-ui}#canvas{height:500px;zoom:1.1}</style><div id="canvas"></div>');
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      window.example = { nodes: [
        { id: 'current', title: '示例：主对话', badge: '待继续', kind: 'task', current: true, x: 0, y: 30 },
        { id: 'worker', title: '示例：子对话', badge: '进行中', activity: 'running', kind: 'task', x: 340, y: 30 },
      ], edges: [{ from: 'current', to: 'worker', kind: 'parent', label: '子对话' }] };
      window.canvas = window.__nuyoahWorkCanvas__.create({ container: document.getElementById('canvas') });
      window.canvas.update(window.example);
    });
    const running = page.locator('[data-node-id="worker"]'), current = page.locator('[data-node-id="current"]');
    const inspect = element => ({ left: element.style.left, top: element.style.top, transform: getComputedStyle(element).transform,
      animation: getComputedStyle(element).animationName, shadow: getComputedStyle(element).boxShadow,
      border: getComputedStyle(element).borderColor, sweep: getComputedStyle(element, '::after').animationName,
      sweepPosition: getComputedStyle(element, '::after').backgroundPosition, sweepContent: getComputedStyle(element, '::after').content,
      pulse: getComputedStyle(element.querySelector('.nuyoah-work-canvas-node-dot')).animationName });
    const original = await running.evaluate(inspect);
    assert.equal(original.transform, 'none'); assert.equal(original.animation, 'nuyoah-work-canvas-glow'); assert.equal(original.pulse, 'nuyoah-work-canvas-pulse');
    assert.equal(original.sweep, 'nuyoah-work-canvas-sweep'); assert.equal(original.border, 'rgb(60, 170, 114)');
    assert.equal((await current.evaluate(inspect)).animation, 'none');
    await page.waitForFunction(shadow => getComputedStyle(document.querySelector('[data-node-id="worker"]')).boxShadow !== shadow, original.shadow);
    const animated = await running.evaluate(inspect);
    assert.equal(animated.left, original.left); assert.equal(animated.top, original.top); assert.equal(animated.transform, 'none');
    assert.notEqual(animated.sweepPosition, original.sweepPosition);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await running.evaluate(inspect);
    assert.equal(reduced.animation, 'none'); assert.equal(reduced.pulse, 'none'); assert.equal(reduced.sweep, 'none'); assert.notEqual(reduced.shadow, 'none');
    assert.equal(reduced.border, original.border);
    assert.equal(await running.getAttribute('data-activity'), 'running');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#canvas').evaluate(element => { element.hidden = true; });
    const hidden = await running.evaluate(inspect);
    assert.equal(hidden.animation, 'none'); assert.equal(hidden.pulse, 'none'); assert.equal(hidden.sweep, 'none');
    await page.locator('#canvas').evaluate(element => { element.hidden = false; });
    await page.locator('.nuyoah-work-canvas').evaluate(element => { element.dataset.motionPaused = 'true'; });
    const paused = await running.evaluate(inspect);
    assert.equal(paused.animation, 'none'); assert.equal(paused.pulse, 'none'); assert.equal(paused.sweep, 'none');
    await page.locator('.nuyoah-work-canvas').evaluate(element => { element.dataset.motionPaused = 'false'; });
    const box = await running.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 22, box.y + box.height / 2 + 11);
    assert.equal((await running.evaluate(inspect)).animation, 'none');
    assert.equal((await running.evaluate(inspect)).pulse, 'none'); assert.equal((await running.evaluate(inspect)).sweep, 'none'); await page.mouse.up();
    assert.equal((await running.evaluate(inspect)).animation, 'nuyoah-work-canvas-glow');
    assert.equal((await running.evaluate(inspect)).sweep, 'nuyoah-work-canvas-sweep');
    if (process.env.NUYOAH_WORK_CANVAS_ACTIVITY_SCREENSHOT) await page.screenshot({ path: process.env.NUYOAH_WORK_CANVAS_ACTIVITY_SCREENSHOT });
    const updated = await page.evaluate(() => {
      const button = document.querySelector('[data-node-id="worker"]'), layout = JSON.stringify(window.canvas.getLayout());
      window.example.nodes[1].activity = 'waiting'; window.canvas.update(window.example);
      return { sameNode: button === document.querySelector('[data-node-id="worker"]'), sameLayout: layout === JSON.stringify(window.canvas.getLayout()), aria: button.getAttribute('aria-label') };
    });
    assert.equal(updated.sameNode, true); assert.equal(updated.sameLayout, true); assert.match(updated.aria, /等待中/);
    const stopped = await running.evaluate(inspect);
    assert.equal(stopped.animation, 'none'); assert.equal(stopped.pulse, 'none'); assert.equal(stopped.sweep, 'none'); assert.equal(stopped.sweepContent, 'none');
    await page.evaluate(() => { window.example.nodes[1].activity = 'completed'; window.canvas.update(window.example); });
    assert.match(await running.getAttribute('aria-label'), /已完成/);
    assert.equal(await running.locator('.nuyoah-work-canvas-node-dot').innerText(), '✓');
    const completed = await running.evaluate(inspect);
    assert.equal(completed.animation, 'none'); assert.equal(completed.pulse, 'none'); assert.equal(completed.sweep, 'none');
    await page.evaluate(() => window.canvas.destroy()); assert.equal(await page.locator('.nuyoah-work-canvas').count(), 0);
  } finally { await browser.close(); }
});

test('calm cards retain complete Chinese text lines at supported font sizes and focus above an inspector', {
  skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE || !process.env.NUYOAH_TEST_BROWSER,
}, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
    await page.setContent('<!doctype html><style>body{margin:20px;font:17px/1.5 system-ui}#canvas{height:660px}</style><div id="canvas"></div>');
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      window.example = { nodes: [{ id: 'long', title: '示例：完成产品体验升级', subtitle: '下一步 · 复核主要交互与布局', badge: '重点 · 推进中', x: 0, y: 0 }] };
      window.canvas = window.__nuyoahWorkCanvas__.create({ container: document.querySelector('#canvas') }); window.canvas.update(window.example);
    });
    for (const fontSize of [17, 22]) {
      await page.evaluate(fontSize => { document.body.style.fontSize = `${fontSize}px`; window.canvas.update(window.example); }, fontSize);
      const lines = await page.locator('[data-node-id="long"]').evaluate(element => {
        const node = element.getBoundingClientRect(), title = element.querySelector('.nuyoah-work-canvas-node-title'), subtitle = element.querySelector('.nuyoah-work-canvas-node-subtitle');
        return { titleHeight: title.clientHeight, titleLine: parseFloat(getComputedStyle(title).lineHeight), subtitleHeight: subtitle.clientHeight, subtitleLine: parseFloat(getComputedStyle(subtitle).lineHeight), bottom: subtitle.getBoundingClientRect().bottom, nodeBottom: node.bottom };
      });
      assert.ok(Math.abs(lines.titleHeight / lines.titleLine - 2) < .06, 'two complete title lines remain visible');
      assert.ok(Math.abs(lines.subtitleHeight / lines.subtitleLine - Math.round(lines.subtitleHeight / lines.subtitleLine)) < .06, 'subtitle height ends on a complete line');
      assert.ok(lines.bottom < lines.nodeBottom - 10);
    }
    const inset = await page.evaluate(() => { window.canvas.focus('long', { bottomInset: 420 }); const card = document.querySelector('[data-node-id="long"]').getBoundingClientRect(), viewport = document.querySelector('.nuyoah-work-canvas-viewport').getBoundingClientRect(); return { cardBottom: card.bottom, unobscuredBottom: viewport.bottom - 420 }; });
    assert.ok(inset.cardBottom < inset.unobscuredBottom);
  } finally { await browser.close(); }
});
