import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
const start = source.indexOf('  function currentCodexTaskContext() {');
const code = source.slice(start, source.indexOf('\n  function notifyAssetConsole(', start)).trim();
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const empty = { threadId: '', hostId: '', threadTitle: '', projectId: '', projectName: '' };
const element = attributes => ({ getAttribute: name => attributes[name] ?? null });
const row = (threadId, hostId, title = 'Task') => element({
  'data-app-action-sidebar-thread-id': threadId, 'data-app-action-sidebar-thread-host-id': hostId,
  'data-app-action-sidebar-thread-title': title,
});
function composer(ids, { width = 700, height = 120, display = 'flex', visibility = 'visible', ancestorHidden = false, placement = 'thread' } = {}) {
  return { placement, style: { display, visibility }, getBoundingClientRect: () => ({ width, height }), closest: () => ancestorHidden ? {} : null,
    // Native metadata markers can be hidden even when their owning composer is visible.
    querySelectorAll: () => ids.map(id => ({ ...element({ 'data-above-composer-conversation-id': id }), hidden: true })) };
}
function context({ active = null, roots = [], rows = [], local = [], recent = [], current = [], remote = [], hasLocalThread = () => false, grid = null } = {}) {
  const read = vm.runInNewContext(`(${code})`, {
    document: { querySelector: () => active, querySelectorAll: selector => selector.startsWith('[data-codex-composer-root]') ? roots.filter(root => root.placement === 'thread') : rows },
    getComputedStyle: node => node.style, normalizedThreadId: value => String(value || '').trim().replace(/^(?:local|cloud):/i, '').toLowerCase(),
    searchCatalogByThread: new Map(local.map(entry => [entry.threadId, entry])), recentCatalogByThread: new Map(recent.map(entry => [entry.threadId, entry])), taskCatalog: current,
    window: { __nuyoahRemoteTaskCatalog__: { snapshot: () => remote, hasLocalThread }, __nuyoahMultiChat__: grid },
  });
  return JSON.parse(JSON.stringify(read()));
}

test('the selected grid pane owns workstation context while native navigation catches up', () => {
  const grid = { isOpen: () => true, currentTarget: () => ({ hostId: 'local', threadId: b, title: 'Selected pane' }) };
  const result = context({ active: row(a, 'local', 'Other task'), grid, local: [{ threadId: b, projectId: 'chosen', projectName: 'Chosen project' }] });
  assert.equal(result.threadId, b); assert.equal(result.threadTitle, 'Selected pane'); assert.equal(result.projectId, 'chosen');
  assert.deepEqual(context({ active: row(a, 'local'), grid: { isOpen: () => true, currentTarget: () => null } }), empty);
});

test('native active identity keeps precedence and its existing local default', () => {
  const local = [{ threadId: a, projectId: 'p', projectName: 'Project', title: 'Catalog title' }];
  assert.deepEqual(context({ active: row(a, null, 'Native title'), local, roots: [composer([b])], remote: [{ threadId: a, hostId: 'remote:one' }] }),
    { threadId: a, hostId: 'local', threadTitle: 'Native title', projectId: 'p', projectName: 'Project' });
  assert.equal(context({ active: row(a, 'remote:one'), remote: [{ threadId: a, hostId: 'remote:one', projectId: 'remote-p' }] }).projectId, 'remote-p');
});

test('hidden identity marker in a unique visible thread composer resolves a known local conversation without a sidebar row', () => {
  const local = [{ threadId: a, title: 'Local task', projectId: 'p', projectName: 'Project' }];
  assert.deepEqual(context({ roots: [composer([a])], local }), { threadId: a, hostId: 'local', threadTitle: 'Local task', projectId: 'p', projectName: 'Project' });
  assert.equal(context({ roots: [composer([a]), composer([b], { width: 0 })], recent: local }).threadId, a);
  assert.equal(context({ roots: [composer([a])], current: local }).hostId, 'local');
  assert.equal(context({ active: row('', null, ''), roots: [composer([a])], local }).threadTitle, 'Local task');
});

test('composer identity resolves a unique explicit row host or remote catalog host without guessing local', () => {
  assert.deepEqual(context({ roots: [composer([a])], rows: [row(a, 'remote:one', 'Remote task')] }),
    { threadId: a, hostId: 'remote:one', threadTitle: 'Remote task', projectId: '', projectName: '' });
  const result = context({ roots: [composer([a])], remote: [{ threadId: a, hostId: 'remote:one', title: 'Remote task', projectId: 'remote-p' }] });
  assert.equal(result.hostId, 'remote:one'); assert.equal(result.projectId, 'remote-p'); assert.equal(result.threadTitle, 'Remote task');
  assert.deepEqual(context({ roots: [composer([a])], rows: [row(a, null)] }), empty);
  assert.deepEqual(context({ roots: [composer([a])], local: [{ threadId: b, title: 'Same title' }] }), empty);
});

test('same UUID on multiple hosts stays unresolved even if only one matching sidebar row is rendered', () => {
  const roots = [composer([a])], local = [{ threadId: a }], remote = [{ threadId: a, hostId: 'remote:one' }];
  assert.deepEqual(context({ roots, local, remote }), empty);
  assert.deepEqual(context({ roots, rows: [row(a, 'local')], remote }), empty);
  assert.deepEqual(context({ roots, remote: [...remote, { threadId: a, hostId: 'remote:two' }] }), empty);
  assert.deepEqual(context({ roots, rows: [row(a, 'remote:one'), row(a, 'remote:two')] }), empty);
});

test('child conversation resolves from admitted native identity without depending on fresh running state, and stays conservative across hosts', () => {
  const roots = [composer([a])], hasLocalThread = id => id === a;
  assert.equal(context({ roots, hasLocalThread }).threadId, a);
  assert.equal(context({ roots, hasLocalThread }).hostId, 'local');
  assert.deepEqual(context({ roots, hasLocalThread, remote: [{ threadId: a, hostId: 'remote:one' }] }), empty);
  assert.deepEqual(context({ roots, hasLocalThread: () => false }), empty);
  assert.deepEqual(context({ roots, hasLocalThread: () => ({ runtimeStatus: 'running' }) }), empty);
  assert.deepEqual(context({ roots, hasLocalThread: () => { throw new Error('Unavailable'); } }), empty);
  assert.equal(context({ roots, hasLocalThread: () => { throw new Error('Unavailable'); }, local: [{ threadId: a }] }).hostId, 'local');
});

test('multiple visible composers, hidden composers, new-task composers and conflicting or invalid identities cannot select a task', () => {
  const local = [{ threadId: a }, { threadId: b }];
  for (const roots of [[], [composer([a]), composer([b])], [composer([a], { height: 0 })], [composer([a], { display: 'none' })],
    [composer([a], { visibility: 'hidden' })], [composer([a], { ancestorHidden: true })], [composer([a], { placement: 'new-task' })],
    [composer([a, b])], [composer(['invalid'])]]) assert.deepEqual(context({ roots, local }), empty);
});

test('browser DOM composer fallback accepts a display-none marker and rejects a hidden or ambiguous owning composer', {
  skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE || !process.env.NUYOAH_TEST_BROWSER,
}, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div data-codex-composer-root data-composer-placement="thread" style="width:600px;height:120px"><span style="display:none" data-above-composer-conversation-id="${a}"></span></div>`);
    await page.addScriptTag({ content: `const normalizedThreadId=value=>String(value||'').trim().toLowerCase(); const searchCatalogByThread=new Map([['${a}',{threadId:'${a}',title:'Fixture task'}]]); const recentCatalogByThread=new Map(), taskCatalog=[]; ${code}` });
    assert.equal(await page.evaluate(() => currentCodexTaskContext().threadId), a);
    await page.evaluate(() => document.querySelector('[data-codex-composer-root]').style.visibility = 'hidden');
    assert.deepEqual(await page.evaluate(() => currentCodexTaskContext()), empty);
    await page.evaluate(() => { const root = document.querySelector('[data-codex-composer-root]'); root.style.visibility = 'visible'; document.body.append(root.cloneNode(true)); });
    assert.deepEqual(await page.evaluate(() => currentCodexTaskContext()), empty);
    await page.evaluate(() => {
      document.querySelectorAll('[data-codex-composer-root]')[1].remove(); searchCatalogByThread.clear();
      window.__nuyoahRemoteTaskCatalog__ = { snapshot: () => [], hasLocalThread: () => true, localStatus: () => null };
    });
    assert.equal(await page.evaluate(() => currentCodexTaskContext().hostId), 'local');
  } finally { await browser.close(); }
});
