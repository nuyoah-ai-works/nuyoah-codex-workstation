import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import vm from 'node:vm';
import { createChatGptCatalog } from '../nuyoah/taskboard/chatgpt-catalog.mjs';
import { createRemoteTaskCatalog } from '../nuyoah/taskboard/remote-catalog.mjs';

const source = await readFile(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
const vendorSource = await readFile(new URL('../vendor/codex-taskboard/inject/codex-taskboard.user.js', import.meta.url), 'utf8');
const injectorSource = await readFile(new URL('../scripts/injector.mjs', import.meta.url), 'utf8');
const bootstrapStart = injectorSource.indexOf('  const remoteSource = ') + '  const remoteSource = '.length;
const bootstrapEnd = injectorSource.indexOf(';\n  const projectSource', bootstrapStart);
assert.ok(bootstrapStart > 0 && bootstrapEnd > bootstrapStart);
const remoteBootstrap = vm.runInNewContext(injectorSource.slice(bootstrapStart, bootstrapEnd), { createRemoteTaskCatalog, createChatGptCatalog });

test('native mode never runs sidebar enhancement work, including after data refresh', () => {
  const start = source.indexOf('  function sync() {');
  const end = source.indexOf('\n  function setPreviews(', start);
  const calls = [];
  let visible = false;
  const context = {
    destroyed: false, workstationDrag: null, snapshotDepth: 0, sidebarMode: 'native',
    isWorkstationVisible: () => visible,
    currentCodexTaskContext: () => ({ threadId: 'fixture' }),
    findCustomShortcutPageMount: () => null,
    syncAssetConsoleContext: () => {},
    window: { __nuyoahSkillTimeline__: { sync: () => calls.push('timeline') } },
  };
  for (const name of ['ensureNativeWorkstationEntry', 'ensureSkillOrganizer', 'ensureTaskboardWorkstationHeader',
    'syncWorkstationLayout', 'renderProjectOverview', 'resumeSkillsGroupingOpenRequest']) context[name] = () => calls.push(name);
  for (const name of ['ensureShortcutGrid', 'ensureViewToggle', 'ensureShortcutSettingsButton', 'ensureSectionTabs',
    'ensureFolderSwitcher', 'visibleRows', 'applySummary', 'ensureVirtualPinnedRows', 'ensureGlobalRecentRows',
    'ensureInterruptedRows', 'sortNativePinnedRows', 'enhanceTooltip']) context[name] = () => assert.fail(`native sidebar called ${name}`);
  const sync = vm.runInNewContext(`(${source.slice(start, end)})`, context);
  sync();
  assert.deepEqual(calls, ['ensureNativeWorkstationEntry']);
  calls.length = 0;
  visible = true;
  sync();
  assert.deepEqual(calls, ['ensureNativeWorkstationEntry', 'ensureSkillOrganizer', 'ensureTaskboardWorkstationHeader',
    'syncWorkstationLayout', 'renderProjectOverview', 'timeline', 'resumeSkillsGroupingOpenRequest']);
});

test('native sidebar stays intact while the isolated workstation opens, closes and reloads', {
  skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 60000,
}, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  let browser, server;
  const errors = [];
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;display:flex;font:14px system-ui;height:900px}
      aside{width:260px;flex:none;padding:12px}main{display:flex;flex:1;min-width:0;padding-top:48px}
      header[data-testid]{position:fixed;top:0;left:260px;right:0;height:48px;display:flex;align-items:center;justify-content:flex-end}
      [data-app-shell-main-content-layout]{flex:1;min-width:0}.app-shell-main-content-frame{height:100%}
    </style></head><body><aside><nav role="navigation"><button id="native-new">新对话</button>
      <section id="native-projects" role="region" aria-labelledby="native-title" data-app-action-sidebar-section data-app-action-sidebar-section-collapsed="true">
      <h2 id="native-title" data-app-action-sidebar-section-heading="项目">项目</h2><button data-app-action-sidebar-section-toggle>展开项目</button>
      <div role="list" id="native-list"><div role="listitem" id="native-item"><div role="button" tabindex="0"
      data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="local:11111111-1111-4111-8111-111111111111"
      data-app-action-sidebar-thread-title="示例任务" aria-current="page"><span data-thread-title="true">示例任务</span></div></div></div>
      <div id="native-collapsed" hidden>折叠内容</div></section></nav></aside><main>
      <header data-testid="app-shell-header-context-menu-surface"><button id="native-share">分享</button></header>
      <div data-app-shell-main-content-layout><div class="app-shell-main-content-frame"><p>虚构验收对话</p></div></div>
    </main><script>window.nativeClicks=0;document.querySelector('aside').addEventListener('click',()=>window.nativeClicks++);</script></body></html>`;
    server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1700, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const baseline = await page.locator('aside').evaluate(node => node.outerHTML);
    // The vendor can attach before workstation configuration exists. Its entry
    // must fail closed, then remain absent when the config arrives and refreshes.
    await page.evaluate(() => { window.__CODEX_TASKBOARD_SOURCE_HASH__ = 'native-sidebar-fixture'; });
    await page.addScriptTag({ content: vendorSource });
    assert.equal(await page.locator('#codex-taskboard-entry').count(), 0);
    await page.evaluate(() => {
      window.__NUYOAH_WORKSTATION_CONFIG__ = {};
      window.__CODEX_TASKBOARD_URL__ = `${location.origin}/?host=codex`;
      window.catalogRequests = []; window.catalogRawSends = 0; window.chatCatalogReads = 0;
      window.electronBridge = {
        getSharedObjectSnapshotValue: () => [], getInitialSidebarBootstrap: () => ({ catalogEntries: [] }),
        sendMessageFromView: () => { window.catalogRawSends++; throw new Error('Raw host transport must not run'); },
      };
      window.__nuyoahNativeTaskAdapter__ = {
        listChatGptThreads: async () => { window.chatCatalogReads++; return []; },
        listThreads: (hostId, params, { signal }) => new Promise((resolve, reject) => {
          const request = { hostId, params, aborted: false, resolve };
          window.catalogRequests.push(request);
          signal.addEventListener('abort', () => { request.aborted = true; reject(new Error('Fixture cancellation')); }, { once: true });
        }),
      };
      window.__codexTaskboardInjection__.refresh();
    });
    await page.addScriptTag({ content: source.replace('function renderProjectOverview() {', 'function renderProjectOverview() { window.__renderProbe = (window.__renderProbe || 0) + 1;') });
    await page.addScriptTag({ content: remoteBootstrap });
    await page.evaluate(() => window.__nuyoahRemoteTaskCatalog__.refresh());
    assert.equal(await page.evaluate(() => window.catalogRequests.length), 0);
    assert.equal(await page.locator('#codex-taskboard-entry').count(), 0);
    assert.equal(await page.evaluate(() => window.__codexConversationPreviewInjection__.sidebarMode), 'native');
    assert.equal(await page.locator('aside').evaluate(node => node.outerHTML), baseline);
    const entry = page.getByRole('button', { name: '工作站', exact: true });
    assert.equal(await entry.count(), 1);
    await page.evaluate(() => {
      const api = window.__codexConversationPreviewInjection__;
      api.setPreviews([{ key: 'local:11111111-1111-4111-8111-111111111111\n示例任务', summary: '不应注入原生列表' }]);
      api.setUsage({ available: true, remainingPercent: 50 });
      api.setTaskCatalog([{ threadId: '11111111-1111-4111-8111-111111111111', title: '示例任务', updatedAt: '2026-09-26T00:00:00Z' }]);
      api.revealThread('11111111-1111-4111-8111-111111111111');
    });
    assert.equal(await page.locator('aside').evaluate(node => node.outerHTML), baseline);
    await entry.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__codexConversationPreviewInjection__.isWorkstationVisible());
    await page.waitForFunction(() => window.catalogRequests.length === 1);
    assert.equal(await page.locator('#nuyoah-workstation-project-page').isVisible(), true);
    assert.equal(await page.evaluate(() => window.chatCatalogReads), 0, 'the project panel does not poll ChatGPT');
    assert.equal(await page.locator('aside').evaluate(node => node.outerHTML), baseline);
    const renderCounts = await page.evaluate(() => {
      const api = window.__codexConversationPreviewInjection__;
      const task = { threadId: '11111111-1111-4111-8111-111111111111', title: '示例任务', updatedAt: '2026-09-28T00:00:00Z' };
      const snapshot = { previews: [], usage: null, searchCatalog: [], recentCatalog: [task], taskCatalog: [task], interruptedCatalog: [], pinnedThreadIds: [], activeThreadIds: [] };
      window.__renderProbe = 0;
      for (const [setter, key] of [['setPreviews','previews'], ['setUsage','usage'], ['setSearchCatalog','searchCatalog'], ['setRecentCatalog','recentCatalog'], ['setTaskCatalog','taskCatalog'], ['setInterruptedCatalog','interruptedCatalog'], ['setPinnedThreads','pinnedThreadIds'], ['setActiveProjectThreads','activeThreadIds']]) api[setter](snapshot[key]);
      const separate = window.__renderProbe;
      window.__renderProbe = 0; api.applySnapshot(snapshot);
      return { separate, batched: window.__renderProbe, title: api.getTaskboardSnapshot().tasks.find(item => item.threadId === task.threadId)?.title };
    });
    assert.deepEqual(renderCounts, { separate: 8, batched: 1, title: '示例任务' });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__codexConversationPreviewInjection__.isWorkstationVisible());
    await page.waitForFunction(() => window.catalogRequests[0].aborted);
    await page.evaluate(() => window.__nuyoahRemoteTaskCatalog__.refresh());
    assert.equal(await page.evaluate(() => window.catalogRequests.length), 1, 'closed workstation does not resume scanning');

    // Real vendor Taskboard opening must not click collapsed native sections.
    // Its page transport is restricted to this fictional loopback fixture.
    await page.evaluate(() => window.__codexConversationPreviewInjection__.openWorkstationPanel('taskboard'));
    await page.waitForFunction(() => window.catalogRequests.length === 2);
    assert.equal(await page.locator('#codex-taskboard-page').isVisible(), true);
    await page.waitForFunction(() => window.chatCatalogReads === 1);
    assert.equal(await page.locator('aside').evaluate(node => node.outerHTML), baseline);
    assert.equal(await page.evaluate(() => window.nativeClicks), 0);
    await page.evaluate(() => {
      window.__codexTaskboardInjection__.refresh();
      window.__codexTaskboardInjection__.close(false);
    });
    await page.waitForFunction(() => window.catalogRequests[1].aborted);
    assert.equal(await page.evaluate(async () => {
      await window.__nuyoahChatGptCatalog__.refresh(); return window.chatCatalogReads;
    }), 1, 'closing the task panel stops ChatGPT reads');
    assert.equal(await page.locator('#codex-taskboard-entry').count(), 0);
    assert.equal(await page.evaluate(() => window.catalogRawSends), 0);
    await page.addScriptTag({ content: source });
    assert.equal(await entry.count(), 1);
    assert.equal(await page.locator('aside').evaluate(node => node.outerHTML), baseline);
    assert.equal(await page.evaluate(() => window.nativeClicks), 0);

    // Recover legacy injected rows and CSS ordering without removing native rows,
    // changing native collapsed sections or clearing native semantic attributes.
    await page.evaluate(() => {
      const list = document.getElementById('native-list'), item = document.getElementById('native-item');
      list.dataset.codexSidebarFolderCatalogList = 'true'; item.style.order = '5';
      item.dataset.codexSidebarNativeAliasHidden = ''; item.dataset.codexSidebarSemanticDuplicateHidden = '';
      const generated = document.createElement('div'); generated.setAttribute('role', 'listitem');
      generated.innerHTML = '<div data-codex-sidebar-folder-catalog-row="true">旧生成行</div>'; list.append(generated);
      const virtual = document.createElement('section'); virtual.dataset.codexSidebarVirtualSection = '置顶'; list.after(virtual);
    });
    await page.addScriptTag({ content: source });
    assert.deepEqual(await page.evaluate(() => ({
      count: document.getElementById('native-list').children.length,
      order: document.getElementById('native-item').style.order,
      alias: document.getElementById('native-item').hasAttribute('data-codex-sidebar-native-alias-hidden'),
      duplicate: document.getElementById('native-item').hasAttribute('data-codex-sidebar-semantic-duplicate-hidden'),
      collapsed: document.getElementById('native-collapsed').hidden,
      role: document.getElementById('native-projects').getAttribute('role'),
      label: document.getElementById('native-projects').getAttribute('aria-labelledby'),
      virtual: document.querySelectorAll('[data-codex-sidebar-virtual-section]').length,
    })), { count: 1, order: '', alias: false, duplicate: false, collapsed: true, role: 'region', label: 'native-title', virtual: 0 });

    // The updated shell keeps hidden pages and paints an end-slot overlay over
    // the main context surface. A DOM .click() would miss this regression.
    await page.evaluate(() => {
      const header = document.querySelector('header[data-testid]');
      header.removeAttribute('data-testid');
      header.setAttribute('data-app-shell-titlebar', 'true');
      header.innerHTML = `<div data-testid="app-shell-header-context-menu-surface" style="position:absolute;inset:0;display:flex;justify-content:flex-end;align-items:center"></div>
        <div data-app-shell-header-slot="end" style="position:relative;margin-left:auto;z-index:2;background:Canvas">
        <div data-app-shell-header-slot-content style="display:flex;align-items:center"><button id="native-tab">新建标签页</button></div></div>`;
      const hidden = header.cloneNode(true);
      hidden.querySelector('#native-tab').removeAttribute('id');
      hidden.style.visibility = 'hidden'; document.querySelector('main').prepend(hidden);
      const inactivePage = document.createElement('main'); inactivePage.hidden = true;
      inactivePage.style.display = 'none';
      inactivePage.innerHTML = '<div data-app-shell-main-content-layout><div class="app-shell-main-content-frame"></div></div>';
      document.body.prepend(inactivePage);
      document.querySelector('main:not([hidden]) .app-shell-main-content-frame').style.height = '100%';
      document.querySelector('main:not([hidden]) .app-shell-main-content-frame').className = 'updated-frame';
      window.nativeTabs = 0; document.getElementById('native-tab').onclick = () => window.nativeTabs++;
      window.__codexConversationPreviewInjection__.refresh();
    });
    await page.waitForFunction(() => document.getElementById('nuyoah-workstation-entry')?.parentElement.hasAttribute('data-app-shell-header-slot-content'));
    assert.equal(await entry.count(), 1);
    await entry.click();
    await page.waitForFunction(() => window.__codexConversationPreviewInjection__.isWorkstationVisible());
    await page.evaluate(() => window.__codexConversationPreviewInjection__.openWorkstationPanel('project'));
    assert.equal(await page.locator('#nuyoah-workstation-project-page').evaluate(node => node.parentElement.hasAttribute('data-app-shell-main-content-layout')), false);
    assert.equal(await page.locator('#nuyoah-workstation-project-page').evaluate(node => node.parentElement.tagName), 'MAIN');
    await page.evaluate(() => {
      const inactive = document.querySelector('main[hidden]');
      inactive.append(document.getElementById('nuyoah-workstation-project-page'));
    });
    assert.equal(await page.evaluate(() => window.__codexConversationPreviewInjection__.isWorkstationVisible()), false);
    await entry.click();
    await page.waitForFunction(() => window.__codexConversationPreviewInjection__.isWorkstationVisible());
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__codexConversationPreviewInjection__.isWorkstationVisible());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'nuyoah-workstation-entry');
    await page.locator('#native-tab').last().click();
    assert.equal(await page.evaluate(() => window.nativeTabs), 1);
    for (const width of [1100, 1700]) {
      await page.setViewportSize({ width, height: 900 });
      await entry.click();
      await page.keyboard.press('Escape');
      assert.equal(await entry.evaluate(node => {
        const r = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), true);
    }
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await entry.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__codexConversationPreviewInjection__.isWorkstationVisible());
    await page.keyboard.press('Escape');
    await page.addScriptTag({ content: source });
    assert.equal(await entry.count(), 1);
    await entry.click();
    await page.waitForFunction(() => window.__codexConversationPreviewInjection__.isWorkstationVisible());
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.nativeClicks), 0);
    await page.evaluate(() => window.__codexConversationPreviewInjection__.destroy());
    await page.evaluate(() => window.__codexTaskboardInjection__.destroy());
    assert.equal(await entry.count(), 0);
    assert.equal(await page.locator('#codex-conversation-preview-style').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
});
