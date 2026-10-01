import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskRelationsService } from '../nuyoah/workstation/task-relations.mjs';
import { createProjectView } from '../nuyoah/workstation/project-view.mjs';
import { liveStateRuntimeSource } from '../nuyoah/taskboard/live-state.mjs';

// Real Chromium, production project entry, canvas and relation reader. All tasks,
// native navigation/status events and session files below are fictional fixtures.
const root = new URL('../', import.meta.url);
const ids = Object.fromEntries(['main', 'child', 'grandchild', 'peer', 'fork', 'linked', 'other'].map((key, index) => [key, `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`]));
const identity = (name, hostId = 'local') => JSON.stringify([hostId, ids[name]]);
function between(source, start, end) { const from = source.indexOf(start), to = source.indexOf(end, from); assert.ok(from >= 0 && to > from); return source.slice(from, to); }
const titles = { main: '演示：把工作任务连成地图', child: '演示：关系数据', grandchild: '演示：校验任务身份', peer: '演示：同项目独立任务', fork: '演示：派生方案', linked: '演示：跨项目关联', other: '演示：其他项目' };
const tasks = Object.entries(ids).filter(([name]) => name !== 'grandchild').map(([name, threadId]) => ({ hostId: 'local', threadId, title: titles[name], projectId: ['linked', 'other'].includes(name) ? 'content' : 'workstation', projectName: ['linked', 'other'].includes(name) ? '内容项目' : '工作站项目', runtimeStatus: ['main', 'child'].includes(name) ? 'running' : 'completed', updatedAt: '2026-09-22T03:00:00Z' }));

async function fixtureHTML() {
  const [host, canvas, map] = await Promise.all(['inject/conversation-preview.user.js', 'nuyoah/workstation/work-canvas.js', 'nuyoah/workstation/task-map-ui.js'].map(file => readFile(new URL(file, root), 'utf8')));
  const projectSource = between(host, "  let projectSubview = 'map'", '\n  function openProjectOverview()');
  const css = between(host, '      #${PROJECT_OVERVIEW_PAGE_ID} {', '\n      #codex-taskboard-page[data-nuyoah-workstation-frame="true"]').replaceAll('${PROJECT_OVERVIEW_PAGE_ID}', 'nuyoah-workstation-project-page').replaceAll('${WORKSTATION_HEADER_CLASS}', 'nuyoah-workstation-header');
  const script = `
    window.fixtureTasks=${JSON.stringify(tasks)};window.fixtureIDs=${JSON.stringify(ids)};window.fixtureOpened=[];
    window.fixtureContext={...window.fixtureTasks[0],threadTitle:window.fixtureTasks[0].title};
    window.fixtureStatuses=new Map(window.fixtureTasks.map(task=>[task.threadId,{runtimeStatus:task.runtimeStatus,waitingReason:null}]));
    window.fixtureStatuses.set(window.fixtureIDs.grandchild,{runtimeStatus:'running',waitingReason:'approval'});
    window.fixtureRootRequests=[];window.__nuyoahRemoteTaskCatalog__={localStatus:id=>window.fixtureStatuses.get(id)||null,setLocalRelationRoots:roots=>window.fixtureRootRequests.push([...roots])};
    window.fixtureClock=0;const originalNow=Date.now;Date.now=()=>originalNow()+window.fixtureClock;
    const PROJECT_OVERVIEW_PAGE_ID='nuyoah-workstation-project-page',ALL_FOLDER_ID='all',activeFolderId='all',folderSources=new Map();let projectOverviewPage;
    function currentCodexTaskContext(){return {...window.fixtureContext};}
    function getTaskboardSnapshot(){return {tasks:window.fixtureTasks};}
    function normalizedThreadId(value){return value;}
    function revealThread(value){window.fixtureRevealed=value;}
    function insertPlainTextIntoComposer(){return false;}
    function createWorkstationHeader(){const node=document.createElement('header');node.textContent='项目工作站';node.className='nuyoah-workstation-header';return node;}
    function initializeWorkspacePanel(page){return page;}
    window.__nuyoahProjectView__=(${createProjectView.toString()})({storage:localStorage,states:${liveStateRuntimeSource()}});
    ${canvas}
    ${map}
    ${projectSource}
    for(const task of window.fixtureTasks){const row=document.createElement('button');row.textContent=task.title;row.dataset.appActionSidebarThreadId=task.threadId;row.dataset.appActionSidebarThreadHostId=task.hostId;row.onclick=()=>{window.fixtureOpened.push(task.threadId);window.fixtureContext={...task,threadTitle:task.title};renderProjectOverview();};document.querySelector('[data-fixture-sidebar]').append(row);}
    projectOverviewPage=createProjectOverviewPage();projectOverviewPage.hidden=false;document.querySelector('[data-fixture-surface]').append(projectOverviewPage);renderProjectOverview();
    window.fixtureRender=renderProjectOverview;
    window.fixtureSelect=name=>{const task=window.fixtureTasks.find(task=>task.threadId===window.fixtureIDs[name]);window.fixtureContext={...task,threadTitle:task.title};renderProjectOverview();};
    window.fixtureDrain=async()=>{for(let index=0;index<20;index++){const request=window.__nuyoahTaskMapUI__.takeRequest();if(!request)break;window.__nuyoahTaskMapUI__.receive(await window.fixtureRequest(request,window.fixtureTasks));}};
  `;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>任务地图隔离浏览器验收</title><style>
    *{box-sizing:border-box}body{margin:0;font:17px/1.5 system-ui,sans-serif;color:#252b28;background:#f5f5f2;--nuyoah-workstation-font-size:17px;--color-token-bg-primary:#fff;--color-token-foreground:#252b28;--color-token-text-secondary:#63716a}body[data-theme=dark]{color:#ededed;background:#191d1b;--color-token-bg-primary:#262c28;--color-token-foreground:#ededed;--color-token-text-secondary:#bdc7c0;color-scheme:dark}
    .fixture-banner{height:48px;padding:12px 18px;font-size:13px;border-bottom:1px solid #8884}.fixture-shell{display:flex;height:calc(100vh - 48px);justify-content:flex-end}.fixture-chat{flex:1;padding:24px;min-width:0}.fixture-chat h1{font-size:24px}.fixture-chat p{font-size:14px;color:var(--color-token-text-secondary)}[data-fixture-sidebar]{display:grid;gap:7px;max-width:300px}[data-fixture-sidebar] button{font:inherit;color:inherit;background:transparent;border:1px solid #8884;border-radius:8px;padding:8px;text-align:left}.nuyoah-workstation-header{padding:13px 20px;border-bottom:1px solid #8884;font-weight:600}
    ${css}
    #nuyoah-workstation-project-page{--codex-workspace-panel-width:420px;max-width:none}
  </style></head><body><div class="fixture-banner">虚构示例 · 隔离浏览器验收 · 非正式 Codex 宿主</div><main class="fixture-shell" data-fixture-surface><section class="fixture-chat"><h1>任务之间的真实关系</h1><p>示例包含主对话、子任务、孙任务、派生任务，以及独立项目任务。</p><nav aria-label="模拟原生任务入口" data-fixture-sidebar></nav></section></main><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>`;
}

test('task map browser journey uses production entry and relation service with real canvas interactions', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const directory = await mkdtemp(path.join(tmpdir(), 'nuyoah-task-map-browser-')); let browser, server;
  try {
    const rows = [];
    for (const [name, id] of Object.entries(ids)) {
      const parent = name === 'child' ? ids.main : name === 'grandchild' ? ids.child : null;
      const source = parent ? { subagent: { thread_spawn: { parent_thread_id: parent } } } : null;
      const file = path.join(directory, `${name}.jsonl`), payload = { id, ...(name === 'fork' ? { forked_from_id: ids.main } : {}), ...(source ? { source } : {}) };
      const lines = [{ type: 'session_meta', payload }];
      if (name === 'main') lines.push({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ text: `明确关联 codex://threads/${ids.linked}` }] } });
      await writeFile(file, lines.map(value => JSON.stringify(value)).join('\n') + '\n');
      rows.push({ id, title: titles[name], project_id: ['linked', 'other'].includes(name) ? 'content' : name === 'grandchild' ? '' : 'workstation', source, thread_source: parent ? 'subagent' : name === 'fork' ? 'agent_forked_thread' : 'cli', rollout_path: file });
    }
    const service = new TaskRelationsService({ metadata: async () => ({ rows, partial: false }) }), html = await fixtureHTML();
    server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } }), errors = []; page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('fixtureRequest', async (request, catalog) => { assert.equal(request.consumer, 'task-map'); return { id: request.id, data: await service.view({ ...request, tasks: catalog }) }; });
    const drain = () => page.evaluate(() => window.fixtureDrain());
    const map = page.locator('[data-nuyoah-task-map-view]'), canvas = map.locator('.nuyoah-work-canvas'), viewport = canvas.locator('.nuyoah-work-canvas-viewport');
    const node = name => canvas.locator(`button[data-node-id='${identity(name)}']`);
    const nodeIDs = () => canvas.locator('button[data-kind="task"]').evaluateAll(nodes => nodes.map(node => node.dataset.nodeId));
    const select = async name => { await page.evaluate(name => window.fixtureSelect(name), name); await drain(); };
    await page.goto(`http://127.0.0.1:${server.address().port}`); await drain();
    assert.deepEqual(new Set(await nodeIDs()), new Set(['main', 'child', 'grandchild', 'fork', 'linked'].map(name => identity(name))));
    assert.deepEqual(await page.evaluate(() => window.fixtureRootRequests.at(-1)), [ids.main]);
    assert.equal(await node('main').getAttribute('data-current'), 'true'); assert.equal(await node('grandchild').getAttribute('data-activity'), 'waiting');
    assert.equal(await canvas.locator('path[data-kind="parent"]').count(), 2); assert.equal(await canvas.locator('path[data-kind="fork"]').count(), 1); assert.equal(await canvas.locator('path[data-kind="related"]').count(), 1);
    const patterns = await canvas.locator('path').evaluateAll(paths => Object.fromEntries(paths.map(path => [path.dataset.kind, getComputedStyle(path).strokeDasharray])));
    assert.notEqual(patterns.parent, patterns.fork); assert.notEqual(patterns.fork, patterns.related);
    await canvas.getByRole('button', { name: '适应全部节点', exact: true }).click();
    await node('child').click(); await map.getByRole('button', { name: '打开完整对话', exact: true }).click(); await drain(); assert.equal(await page.evaluate(() => window.fixtureOpened.at(-1)), ids.child);
    assert.equal(await node('child').getAttribute('data-current'), 'true'); assert.equal(await map.isVisible(), true); assert.equal(await page.locator('[data-project-subview="map"]').getAttribute('aria-pressed'), 'true');
    await map.getByRole('button', { name: '当前项目', exact: true }).click(); await drain();
    assert.deepEqual(new Set(await nodeIDs()), new Set(['main', 'child', 'grandchild', 'peer', 'fork'].map(name => identity(name))));
    await map.getByRole('button', { name: '全局', exact: true }).click(); await drain(); assert.equal((await nodeIDs()).length, 7);
    assert.equal(await canvas.locator('button[data-kind="root"]').count(), 2);
    assert.equal(await canvas.locator('path[data-edge-from^="project:"]').count(), 0);
    await map.getByRole('button', { name: '当前对话', exact: true }).click(); await drain(); await select('main');

    // Native status pushes update animation and text in place, including DB-only children.
    const changeStatus = (name, status) => page.evaluate(({ name, status }) => { window.fixtureStatuses.set(window.fixtureIDs[name], status); window.__nuyoahTaskMapUI__.refreshLive(); }, { name, status });
    const animation = element => element.evaluate(node => getComputedStyle(node).animationName);
    const rootRequestCount = await page.evaluate(() => window.fixtureRootRequests.length);
    assert.notEqual(await animation(node('child')), 'none');
    await changeStatus('child', { runtimeStatus: 'running', waitingReason: 'approval' }); assert.equal(await node('child').getAttribute('data-activity'), 'waiting'); assert.equal(await animation(node('child')), 'none'); assert.equal(await node('child').locator('.nuyoah-work-canvas-node-badge').isVisible(), false);
    await changeStatus('child', { runtimeStatus: 'completed', waitingReason: null }); assert.equal(await animation(node('child')), 'none'); assert.equal(await node('child').getAttribute('data-activity'), 'idle');
    await changeStatus('child', { runtimeStatus: 'running', waitingReason: null }); assert.notEqual(await animation(node('child')), 'none');
    await changeStatus('child', null); assert.equal(await node('child').getAttribute('data-activity'), 'unknown'); assert.equal(await animation(node('child')), 'none'); assert.equal(await node('child').locator('.nuyoah-work-canvas-node-badge').isVisible(), false);
    await changeStatus('child', { runtimeStatus: 'running', waitingReason: null }); assert.notEqual(await animation(node('child')), 'none');
    await changeStatus('grandchild', { runtimeStatus: 'running', waitingReason: null }); assert.equal(await node('grandchild').getAttribute('data-activity'), 'running');
    assert.equal(await page.evaluate(() => window.fixtureRootRequests.length), rootRequestCount);

    // Pointer movement, keyboard movement and status polling share the same layout.
    await canvas.getByRole('button', { name: '适应全部节点', exact: true }).click(); const box = await node('main').boundingBox();
    const before = await node('main').evaluate(node => ({ x: parseFloat(node.style.left), y: parseFloat(node.style.top) }));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 18, { steps: 5 }); await page.mouse.up();
    const moved = await node('main').evaluate(node => ({ x: parseFloat(node.style.left), y: parseFloat(node.style.top) })); assert.ok(moved.x > before.x && moved.y > before.y);
    await map.getByRole('button', { name: '查找任务', exact: true }).click();
    await map.getByRole('searchbox', { name: '查找地图中的任务', exact: true }).fill('关系数据');
    await page.evaluate(() => { window.fixtureClock += 11000; window.fixtureRender(); }); await drain();
    assert.equal(await map.getByRole('searchbox', { name: '查找地图中的任务', exact: true }).evaluate(node => document.activeElement === node), true);
    assert.deepEqual(await node('main').evaluate(node => ({ x: parseFloat(node.style.left), y: parseFloat(node.style.top) })), moved);
    await node('main').focus(); await page.keyboard.press('ArrowRight'); const keyed = await node('main').evaluate(node => parseFloat(node.style.left)); assert.ok(keyed > moved.x);
    await page.reload(); await drain(); assert.equal(await node('main').evaluate(node => parseFloat(node.style.left)), keyed);

    // A late successful response from another conversation cannot replace this map.
    const old = await page.evaluate(() => { window.fixtureClock += 11000; window.fixtureRender(); return window.__nuyoahTaskMapUI__.takeRequest(); });
    const oldResponse = { id: old.id, data: await service.view({ ...old, tasks }) };
    await select('peer'); await page.evaluate(response => window.__nuyoahTaskMapUI__.receive(response), oldResponse); assert.deepEqual(await nodeIDs(), [identity('peer')]);
    assert.deepEqual(await page.evaluate(() => window.fixtureRootRequests.at(-1)), []);
    await select('main');
    await page.locator('[data-project-subview="tasks"]').click();
    assert.equal(await map.locator('.nuyoah-task-map').getAttribute('data-active'), 'false');
    assert.deepEqual(await page.evaluate(() => window.fixtureRootRequests.at(-1)), []);
    assert.equal(await node('main').evaluate(node => getComputedStyle(node).animationPlayState), 'paused');
    await page.locator('[data-project-subview="map"]').click(); await drain();
    assert.deepEqual(await page.evaluate(() => window.fixtureRootRequests.at(-1)), [ids.main]);

    // The supported 420 px workstation panel remains usable in both themes.
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.body.dataset.theme = theme, theme);
      const geometry = await page.locator('.nuyoah-project-overview-body').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth })); assert.ok(geometry.width >= 380 && geometry.scroll <= geometry.width + 1);
      await map.getByRole('button', { name: '全局', exact: true }).focus(); await page.keyboard.press('Enter'); await drain(); assert.equal((await nodeIDs()).length, 7);
      await map.getByRole('button', { name: '当前对话', exact: true }).click(); await drain();
    }
    await page.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await animation(node('main')), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' }); assert.notEqual(await animation(node('main')), 'none');
    // A project/new-task landing page has no selected conversation; this is not a read failure.
    await page.evaluate(() => { window.fixtureContext = { hostId: 'local', projectId: 'workstation', projectName: '工作站项目' }; window.fixtureRender(); });
    for (let index = 0; index < 2; index++) {
      await page.evaluate(() => { window.fixtureClock += 11000; window.fixtureRender(); }); await map.getByRole('button', { name: '地图选项', exact: true }).click(); await map.getByRole('button', { name: '重新读取任务关联', exact: true }).click();
      assert.equal(await page.evaluate(() => window.__nuyoahTaskMapUI__.takeRequest()), null); assert.match(await map.locator('.nuyoah-task-map-status').textContent(), /打开一个对话/);
    }
    await map.getByRole('button', { name: '当前项目', exact: true }).click(); await drain(); assert.equal((await nodeIDs()).length, 5);
    await map.getByRole('button', { name: '全局', exact: true }).click(); await drain(); assert.equal((await nodeIDs()).length, 7);
    await map.getByRole('button', { name: '当前对话', exact: true }).click(); assert.match(await map.locator('.nuyoah-task-map-status').textContent(), /打开一个对话/); await select('main');

    // DB-only children have no native sidebar row. Exercise the production
    // route fallback and return path, including a child with no composer identity.
    await page.evaluate(() => {
      document.querySelector(`[data-app-action-sidebar-thread-id="${window.fixtureIDs.child}"]`).remove();
      window.fixtureNativeRoutes = []; window.fixtureEmptyChild = true;
      window.addEventListener('message', event => {
        if (event.data?.type !== 'navigate-to-route') return;
        const id = event.data.path?.match(/^\/local\/([\da-f-]+)$/)?.[1]; if (!id) return;
        window.fixtureNativeRoutes.push(id);
        const task = window.fixtureTasks.find(task => task.threadId === id)
          || { hostId: 'local', threadId: id, title: '演示：校验任务身份', projectId: 'workstation', projectName: '工作站项目' };
        window.fixtureContext = window.fixtureEmptyChild && id === window.fixtureIDs.child ? {} : { ...task, threadTitle: task.title };
        window.fixtureRender();
      });
    });
    await map.getByRole('button', { name: '当前项目', exact: true }).click(); await drain();
    const parentLayout = await node('main').evaluate(node => ({ left: node.style.left, top: node.style.top }));
    await canvas.getByRole('button', { name: '适应全部节点', exact: true }).click(); await node('child').click(); await map.getByRole('button', { name: '打开完整对话', exact: true }).click();
    await page.waitForFunction(id => window.fixtureNativeRoutes.at(-1) === id, ids.child); await drain();
    assert.deepEqual(await page.evaluate(() => window.fixtureContext), {});
    const back = map.getByRole('button', { name: '返回上一对话', exact: true });
    assert.equal(await back.isVisible(), true); assert.match(await map.locator('.nuyoah-task-map-back').textContent(), /把工作任务连成地图/);
    // Reinjection preserves the return source even without a selected task.
    await page.addScriptTag({ content: await readFile(new URL('nuyoah/workstation/task-map-ui.js', root), 'utf8') });
    await page.evaluate(() => window.fixtureRender()); assert.equal(await back.isVisible(), true);
    await back.click(); await page.waitForFunction(id => window.fixtureContext.threadId === id, ids.main); await drain();
    assert.equal(await back.isVisible(), false);
    assert.equal(await map.getByRole('button', { name: '当前项目', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await node('main').evaluate(node => ({ left: node.style.left, top: node.style.top })), parentLayout);

    // Main -> DB-only child -> grandchild returns one level at a time.
    await page.evaluate(() => { window.fixtureEmptyChild = false; });
    await map.getByRole('button', { name: '当前对话', exact: true }).click(); await drain();
    await canvas.getByRole('button', { name: '适应全部节点', exact: true }).click(); await node('child').click(); await map.getByRole('button', { name: '打开完整对话', exact: true }).click();
    await page.waitForFunction(id => window.fixtureContext.threadId === id, ids.child); await drain();
    await canvas.getByRole('button', { name: '适应全部节点', exact: true }).click(); await node('grandchild').click(); await map.getByRole('button', { name: '打开完整对话', exact: true }).click();
    await page.waitForFunction(id => window.fixtureContext.threadId === id, ids.grandchild); await drain();
    await back.click(); await page.waitForFunction(id => window.fixtureContext.threadId === id, ids.child); await drain();
    assert.equal(await back.isVisible(), true);
    await back.click(); await page.waitForFunction(id => window.fixtureContext.threadId === id, ids.main); await drain();
    assert.equal(await back.isVisible(), false);
    // Completed leaves leave the working map after visible success feedback;
    // opening history is reversible and an actual resume restores the card.
    await page.evaluate(() => {
      const child = window.fixtureTasks.find(task => task.threadId === window.fixtureIDs.child);
      child.title = 'task_map_ui'; child.description = '把相关对话连接成可操作的任务地图。';
      window.fixtureStatuses.set(window.fixtureIDs.child, { runtimeStatus: 'running', waitingReason: null });
      window.fixtureStatuses.set(window.fixtureIDs.grandchild, { runtimeStatus: 'completed', hasFinalResponse: true, finalAt: 12345 });
      window.fixtureRender();
    });
    assert.equal(await node('child').locator('.nuyoah-work-canvas-node-title').textContent(), '任务地图界面');
    assert.match(await node('child').locator('.nuyoah-work-canvas-node-subtitle').textContent(), /相关对话/);
    assert.equal(await node('child').getAttribute('title'), 'task_map_ui');
    assert.equal(await node('child').locator('.nuyoah-work-canvas-node-badge').isVisible(), false);
    assert.equal(await node('grandchild').getAttribute('data-activity'), 'completed');
    assert.match(await node('grandchild').textContent(), /已完成/);
    await page.evaluate(() => { window.fixtureClock += 6001; window.__nuyoahTaskMapUI__.refreshLive(); });
    assert.equal(await node('grandchild').count(), 0);
    const completedHistory = map.getByRole('button', { name: '查看已收起任务（1）', exact: true });
    await completedHistory.focus(); await page.keyboard.press('Enter');
    assert.equal(await node('grandchild').count(), 1);
    await map.getByRole('button', { name: '收起已完成任务', exact: true }).click();
    await changeStatus('grandchild', { runtimeStatus: 'running', hasFinalResponse: false, waitingReason: null });
    assert.equal(await node('grandchild').count(), 1); assert.notEqual(await animation(node('grandchild')), 'none');
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width: 420, height: 850 });
      await page.evaluate(theme => { document.body.dataset.theme = theme; }, theme);
      const geometry = await map.evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
      assert.ok(geometry.scroll <= geometry.width + 1);
    }
    await page.setViewportSize({ width: 1180, height: 1000 });
    assert.deepEqual(errors, []);
    if (process.env.NUYOAH_TASK_MAP_SCREENSHOT) {
      await mkdir(path.dirname(process.env.NUYOAH_TASK_MAP_SCREENSHOT), { recursive: true });
      await page.setViewportSize({ width: 1540, height: 1100 }); await page.evaluate(() => { document.body.dataset.theme = 'light'; document.querySelector('#nuyoah-workstation-project-page').style.setProperty('--codex-workspace-panel-width', '950px'); });
      await page.waitForFunction(() => document.querySelector('.nuyoah-task-map-canvas').clientWidth >= 900);
      await canvas.getByRole('button', { name: '整理节点布局', exact: true }).click(); await canvas.getByRole('button', { name: '适应全部节点', exact: true }).click();
      await page.screenshot({ path: process.env.NUYOAH_TASK_MAP_SCREENSHOT, fullPage: true });
    }
  } finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
