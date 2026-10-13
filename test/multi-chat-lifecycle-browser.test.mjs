import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

test('real React panes pause effects without losing drafts, reuse subscriptions and release pending roots', {
  skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 60000,
}, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const { build } = await import('../vendor/codex-taskboard/node_modules/esbuild/lib/main.js');
  const native = fileURLToPath(new URL('../nuyoah/workstation/multi-chat-native.mjs', import.meta.url));
  const ui = fileURLToPath(new URL('../nuyoah/workstation/multi-chat-ui.mjs', import.meta.url));
  const bundled = await build({ write: false, bundle: true, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { resolveDir: fileURLToPath(new URL('../vendor/codex-taskboard/', import.meta.url)), contents: `
import React from 'react';
import * as ReactDOM from 'react-dom/client';
import { createNativeMultiChatAdapter } from ${JSON.stringify(native)};
import { createMultiChatUI } from ${JSON.stringify(ui)};
const AppContext = React.createContext(null);
const makeScope = brand => ({ __scopeBrand: brand, context: React.createContext(null) });
const ThreadScope = makeScope('ThreadScope'), RouteScope = makeScope('RouteScope'), ComposerScope = makeScope('ComposerScope');
window.scopeOwners = 0;
function Scope({ scope, value, children }) {
  const [retained] = React.useState(() => ({ disposed: false }));
  React.useLayoutEffect(() => {
    if (retained.disposed) throw Error('Disposed scope reused');
    window.scopeOwners++;
    return () => { retained.disposed = true; window.scopeOwners--; };
  }, [retained]);
  return React.createElement(scope.context.Provider, { value: { value } }, children);
}
function useNativeScope(scope) {
  const current = React.useContext(scope.context), ref = React.useRef(current);
  ref.current = current;
  if (!current) throw Error('Missing query client');
  const getOwnValue = () => ref.current;
  return getOwnValue();
}
window.store = { active: new Map(), ticks: new Map(), next: 0, mounts: 0, cleanups: 0 };
function Page({ renderComposer, showComposer, onNewChat } = {}) {
  const store = React.useContext(AppContext), thread = useNativeScope(ThreadScope);
  if (store !== window.store) throw Error('App context was duplicated');
  const [instance] = React.useState(() => ++store.next), [draft, setDraft] = React.useState('');
  React.useEffect(() => {
    if (store.active.has(instance)) throw Error('Duplicate subscription');
    store.active.set(instance, thread.value.clientThreadId); store.mounts++;
    const timer = setInterval(() => store.ticks.set(instance, (store.ticks.get(instance) || 0) + 1), 20);
    return () => { clearInterval(timer); store.active.delete(instance); store.cleanups++; };
  }, [store, instance, thread.value.clientThreadId]);
  return React.createElement('div', { 'data-instance': instance, style: { height: '100%' } },
    React.createElement('div', { 'data-app-action-timeline-scroll': '', style: { height: 50 } }, 'Synthetic timeline'),
    React.createElement('textarea', { 'aria-label': 'Synthetic draft', value: draft, onChange: e => setDraft(e.target.value) }));
}
function NativeWrapper({ route, children }) {
  const clientThreadId = route.clientThreadId || 'client-' + route.conversationId;
  const routeConversationId = route.conversationId, initialWorkspacePrimarySurface = 'chat';
  return React.createElement(Scope, { scope: ThreadScope, value: { clientThreadId, routeConversationId, initialWorkspacePrimarySurface } },
    React.createElement(Scope, { scope: RouteScope, value: route },
      React.createElement(Scope, { scope: ComposerScope, value: { clientThreadId, conversationId: routeConversationId } }, children)));
}
window.tasks = Array.from({ length: 4 }, (_, i) => ({ hostId: 'local', threadId: '00000000-0000-4000-8000-00000000000' + (i + 1), title: 'Synthetic ' + i }));
window.__codexRoot = ReactDOM.createRoot(document.getElementById('original'));
window.__codexRoot.render(React.createElement(AppContext.Provider, { value: window.store },
  React.createElement(NativeWrapper, { route: { routeKind: 'local-thread', conversationId: tasks[0].threadId, hostId: null } }, React.createElement(Page))));
const initial = 'app://-/assets/app-initial-fixture.js', shared = 'app://-/assets/app-shared-fixture.js', page = 'app://-/assets/local-conversation-page-fixture.js';
const sources = {
  [initial]: 'import{foo}from"./app-shared-fixture.js";import "./local-conversation-page-fixture.js";',
  [shared]: 'import{t as q}from"./rolldown-runtime-fixture.js";var react=q((e=>{e.createElement=function(){};})),dom=q((e=>{e.createRoot=function(){};}));export{react as R,dom as D};',
  [page]: 'export{Page as LocalConversationPage};',
};
window.fetch = async url => { if (!(url in sources)) throw Error('Unexpected network request'); return { ok: true, text: async () => sources[url] }; };
window.adapter = createNativeMultiChatAdapter({ window, loadModule: async url => url === shared
  ? { R: () => React, D: () => ReactDOM, H: useNativeScope } : { LocalConversationPage: Page } });
window.__codexConversationPreviewInjection__ = { getTaskboardSnapshot: () => ({ tasks }), refresh() {}, openMultiChatTask() {} };
window.ui = createMultiChatUI({ window, adapter });
` } });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font:14px system-ui}header{height:48px}main{position:absolute;left:80px;top:48px;width:1200px;height:850px}
    textarea{height:100px;width:90%}[hidden]{display:none!important}
  </style><script type="application/json" src="app://-/assets/app-initial-fixture.js"></script></head><body>
    <header><button id="nuyoah-workstation-entry">Workstation</button></header>
    <main data-app-shell-main-content-layout><div id="original" style="height:100%"></div></main>
    <script src="/fixture.js"></script></body></html>`;
  const server = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/fixture.js' ? bundled.outputFiles[0].text : html);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => store.active.size === 1 && adapter.current());
    await page.evaluate(() => ui.open());
    await page.waitForFunction(() => ui.snapshot().slots[0]?.loaded || document.querySelector('.nuyoah-chat-grid-notice'));
    assert.equal(await page.evaluate(() => ui.isOpen()), true,
      JSON.stringify(await page.evaluate(() => ({ message: document.querySelector('.nuyoah-chat-grid-notice')?.textContent, diagnostic: adapter.diagnostic() }))));
    for (let i = 1; i < 4; i++) await page.evaluate(i => ui.bind(i, tasks[i], { select: false }), i);
    await page.waitForFunction(() => store.active.size === 5);
    const owners = await page.evaluate(() => scopeOwners);
    const drafts = page.locator('#nuyoah-chat-grid textarea');
    for (let i = 0; i < 4; i++) await drafts.nth(i).fill('Draft ' + i);
    const instances = await page.locator('#nuyoah-chat-grid [data-instance]').evaluateAll(nodes => nodes.map(n => n.dataset.instance));
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.evaluate(() => { document.querySelector('main').hidden = true; ui.sync(); });
      await page.waitForFunction(() => store.active.size === 1 && ui.snapshot().suspended);
      assert.equal(await page.evaluate(() => scopeOwners), owners, 'temporary hiding must not dispose native retained stores');
      const ticks = await page.evaluate(ids => ids.map(id => store.ticks.get(Number(id)) || 0), instances);
      await page.waitForTimeout(100);
      assert.deepEqual(await page.evaluate(ids => ids.map(id => store.ticks.get(Number(id)) || 0), instances), ticks);
      await page.evaluate(() => { document.querySelector('main').hidden = false; ui.sync(); });
      await page.waitForFunction(() => store.active.size === 5 && ui.isOpen());
      assert.deepEqual(await page.locator('#nuyoah-chat-grid [data-instance]').evaluateAll(nodes => nodes.map(n => n.dataset.instance)), instances);
      for (let i = 0; i < 4; i++) assert.equal(await drafts.nth(i).inputValue(), 'Draft ' + i);
    }
    await page.evaluate(() => {
      window.testVisibility = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.testVisibility });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => store.active.size === 1);
    assert.equal(await page.evaluate(() => scopeOwners), owners);
    await page.evaluate(() => { window.testVisibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => store.active.size === 5);
    await page.evaluate(() => ui.close());
    await page.waitForFunction(() => store.active.size === 1);
    assert.equal(await page.evaluate(() => scopeOwners), 3, 'close releases pane scope owners as well as content subscriptions');
    assert.equal(await page.locator('#original').evaluate(e => e.closest('main').inert), false);
    assert.equal(await page.locator('#nuyoah-chat-grid').count(), 0);

    // The native root exists while its mount receipt is delayed. Closing must
    // cancel it immediately, without waiting for that receipt to arrive.
    await page.evaluate(() => {
      const mount = adapter.mount;
      window.receipts = [];
      adapter.mount = async (...args) => { const session = await mount(...args); return new Promise(resolve => receipts.push(() => resolve(session))); };
      void ui.open();
    });
    await page.waitForFunction(() => store.active.size === 5 && receipts.length === 4);
    await page.evaluate(() => ui.close());
    await page.waitForFunction(() => store.active.size === 1);
    await page.evaluate(() => receipts.splice(0).forEach(resolve => resolve()));
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => store.active.size), 1);
    assert.equal(await page.locator('#nuyoah-chat-grid').count(), 0);
    await page.evaluate(() => ui.destroy());
    assert.equal(await page.locator('#nuyoah-chat-layout-entry').count(), 0);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => store.mounts - store.cleanups), 1, 'only the original native subscription remains');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
