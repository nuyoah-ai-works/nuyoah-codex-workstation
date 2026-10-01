import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkItemsStore, handleWorkItemsRequest } from '../nuyoah/workstation/work-items-store.mjs';
import { TaskContextStore } from '../nuyoah/workstation/task-context-store.mjs';
import { createProjectView } from '../nuyoah/workstation/project-view.mjs';
import { liveStateRuntimeSource } from '../nuyoah/taskboard/live-state.mjs';

// Real Chromium and production UI/store, with fictional native-host/catalog fixtures.
// Nothing connects to the desktop, its session data, or the production Workstation store.
const id = '11111111-1111-4111-8111-111111111111';
const root = new URL('../', import.meta.url);
function between(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `production source section exists: ${start}`);
  return source.slice(from, to);
}
async function fixtureHTML() {
  const [host, workItems, taskContext, workCanvas] = await Promise.all(['inject/conversation-preview.user.js', 'nuyoah/workstation/work-items-ui.js', 'nuyoah/workstation/task-context-ui.js', 'nuyoah/workstation/work-canvas.js'].map(file => readFile(new URL(file, root), 'utf8')));
  const projectSource = between(host, "  let projectSubview = 'map'", '\n  function openProjectOverview()');
  const css = between(host, '      #${PROJECT_OVERVIEW_PAGE_ID} {', '\n      #codex-taskboard-page[data-nuyoah-workstation-frame="true"]')
    .replaceAll('${PROJECT_OVERVIEW_PAGE_ID}', 'nuyoah-workstation-project-page').replaceAll('${WORKSTATION_HEADER_CLASS}', 'nuyoah-workstation-header');
  const script = `
    window.__NUYOAH_WORKSTATION_CONFIG__ = { workItemsCommand:['node','/fixture/scripts/work-items.mjs'], taskContextCommand:['node','/fixture/scripts/task-context.mjs'] };
    window.fixtureTasks = [
      {hostId:'local',threadId:'${id}',projectId:'demo-project',projectName:'演示项目',title:'本机方案任务',runtimeStatus:'running',updatedAt:'2026-09-21T09:00:00Z'},
      {hostId:'fixture-remote',threadId:'${id}',projectId:'demo-project',projectName:'演示项目',title:'远程复核任务',runtimeStatus:'completed',updatedAt:'2026-09-21T08:00:00Z'}
    ];
    window.fixtureContext = {hostId:'local',threadId:'',projectId:'demo-project',projectName:'演示项目',threadTitle:''};
    window.fixtureOpened = []; window.fixtureInserted = [];
    const PROJECT_OVERVIEW_PAGE_ID = 'nuyoah-workstation-project-page', ALL_FOLDER_ID = 'all', activeFolderId = 'all', folderSources = new Map();
    let projectOverviewPage;
    function currentCodexTaskContext(){ return {...window.fixtureContext}; }
    function getTaskboardSnapshot(){ return {tasks:window.fixtureTasks}; }
    function normalizedThreadId(value){return value;}
    function revealThread(value){ window.fixtureRevealed = value; }
    function insertPlainTextIntoComposer(value){window.fixtureInserted.push(value);return true;}
    function createWorkstationHeader(){const header=document.createElement('header');header.textContent='项目工作站';header.className='nuyoah-workstation-header';return header;}
    function initializeWorkspacePanel(page){return page;}
    window.__nuyoahProjectView__ = (${createProjectView.toString()})({storage:localStorage,states:${liveStateRuntimeSource()}});
    ${workCanvas}
    ${workItems}
    ${taskContext}
    ${projectSource}
    for(const task of window.fixtureTasks){
      const row=document.createElement('button');row.textContent=task.title;row.setAttribute('data-app-action-sidebar-thread-id',task.threadId);row.setAttribute('data-app-action-sidebar-thread-host-id',task.hostId);
      row.onclick=()=>{window.fixtureOpened.push({hostId:task.hostId,threadId:task.threadId});window.fixtureContext={...task,threadTitle:task.title};};
      document.querySelector('[data-fixture-sidebar]').append(row);
    }
    projectOverviewPage=createProjectOverviewPage();projectOverviewPage.hidden=false;document.querySelector('[data-fixture-surface]').append(projectOverviewPage);renderProjectOverview();
    window.fixtureRender=renderProjectOverview;
    let pumping;
    window.fixtureDrain=()=>{
      if(pumping)return pumping;
      pumping=(async()=>{
        for(let n=0;n<30;n++){
          const work=window.__nuyoahWorkItemsUI__.takeRequest(), request=work||window.__nuyoahTaskContextUI__.takeRequest();if(!request)break;
          const response=await window.fixtureRequest(request);
          (work?window.__nuyoahWorkItemsUI__:window.__nuyoahTaskContextUI__).receive(response);
        }
      })().finally(()=>{pumping=null;});return pumping;
    };
    setInterval(()=>window.fixtureDrain(),25);
  `;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>工作事项隔离浏览器验收</title><style>
    *{box-sizing:border-box}body{margin:0;font:17px/1.5 system-ui,sans-serif;color:#24282b;background:#f6f6f4;--nuyoah-workstation-font-size:17px;--color-token-bg-primary:#fff;--color-token-foreground:#24282b;--color-token-text-secondary:#687078}
    body[data-theme=dark]{color:#ececec;background:#191c20;--color-token-bg-primary:#25282d;--color-token-foreground:#ececec;--color-token-text-secondary:#b4bac4;color-scheme:dark}
    .fixture-banner{height:52px;padding:12px 20px;font-size:14px;border-bottom:1px solid #8884}.fixture-shell{display:flex;height:calc(100vh - 52px);width:100%;justify-content:flex-end}.fixture-chat{flex:1;min-width:0;padding:28px}.fixture-chat h1{font-size:24px}.fixture-chat p{max-width:30em;color:var(--color-token-text-secondary)}[data-fixture-sidebar]{display:grid;gap:10px;width:240px}[data-fixture-sidebar] button{font:inherit;color:inherit;background:transparent;border:1px solid #8884;border-radius:8px;padding:8px;text-align:left}
    .nuyoah-workstation-header{padding:13px 20px;border-bottom:1px solid #8884;font-weight:600}
    ${css}
    #nuyoah-workstation-project-page{--codex-workspace-panel-width:420px;max-width:none}
  </style></head><body><div class="fixture-banner">隔离浏览器验收 · 虚构示例 · 非正式 Codex 宿主</div><main class="fixture-shell" data-fixture-surface><section class="fixture-chat"><h1>跨任务推进一件事</h1><p>这里使用临时目录中的测试记录，验证工作事项、计划以及任务工作台之间的连接。</p><nav aria-label="模拟原生任务入口" data-fixture-sidebar></nav></section></main><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>`;
}

test('work items browser journey uses real stores and production project subviews in an isolated Chromium host', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const directory = await mkdtemp(path.join(tmpdir(), 'nuyoah-work-items-browser-'));
  const store = new WorkItemsStore(directory), contexts = new TaskContextStore(directory), errors = [];
  let browser, server;
  try {
    await contexts.update(id, { section: 'summary', revision: 0, value: { goal: '虚构任务：验证同一项目方案', progress: '浏览器夹具中的已记录进展', nextStep: '复核界面入口' } });
    const html = await fixtureHTML(); server = createServer((req, response) => { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1120, height: 940 } }); page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('fixtureRequest', async request => {
      if (request.consumer === 'work-items') return handleWorkItemsRequest(store, request);
      if (request.action === 'skills:history') return { id: request.id, skillHistory: { status: 'unavailable', skills: [], checked: 0, total: 0 } };
      assert.equal(request.action, 'read', 'the task context fixture permits only local summary reads');
      assert.equal(request.threadId, id); return { id: request.id, threadId: id, data: await contexts.view(id) };
    });
    const drain = () => page.evaluate(() => window.fixtureDrain());
    const work = page.locator('[data-nuyoah-work-items-view]');
    const open = async () => {
      await work.locator('.nuyoah-work-canvas-host').first().locator('button[data-node-id^="item:"]').filter({ hasText: '演示：完成项目方案' }).click();
      const details = work.locator('.nuyoah-work-item-details');
      if (!await details.evaluate(e => e.open)) await details.locator('summary').first().click();
    };
    const save = async () => { await work.getByRole('button', { name: '保存事项', exact: true }).click(); await drain(); };
    const refresh = async () => { await work.getByRole('button', { name: '工作事项选项', exact: true }).click(); await work.getByRole('button', { name: '重新读取工作事项', exact: true }).click(); await drain(); };
    await page.goto(`http://127.0.0.1:${server.address().port}`); await drain();
    await page.getByRole('button', { name: '工作事项', exact: true }).click(); await drain();
    assert.equal(await work.getByRole('button', { name: '新建事项', exact: true }).isEnabled(), true);
    assert.equal(await work.locator('.nuyoah-work-canvas-viewport').count(), 0);
    assert.equal(await work.getByText('记下一件想推进的事', { exact: true }).isVisible(), true);
    assert.equal(await work.locator('.nuyoah-work-menu').isVisible(), false);
    assert.equal(await work.getByRole('textbox', { name: '搜索工作事项', exact: true }).isVisible(), false);
    const geometry = await page.locator('.nuyoah-project-overview-body').evaluate(element => ({ height: element.clientHeight, width: element.clientWidth, scrollWidth: element.scrollWidth }));
    assert.ok(geometry.height >= 300, `project body remains usable after adding the subnav: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.scrollWidth <= geometry.width + 1, '420px panel has no horizontal overflow');

    // Keyboard activation and subview switches preserve the same unsaved editor.
    await work.getByRole('button', { name: '新建事项', exact: true }).focus(); await page.keyboard.press('Enter');
    await work.getByRole('textbox', { name: '事项名称', exact: true }).fill('演示：完成项目方案');
    await work.getByRole('textbox', { name: '工作方向', exact: true }).fill('产品开发');
    await work.getByRole('textbox', { name: '下一步', exact: true }).fill('先验证用户路径');
    await page.getByRole('button', { name: '当前项目', exact: true }).click();
    await page.getByRole('button', { name: '工作事项', exact: true }).click();
    assert.equal(await work.getByRole('textbox', { name: '下一步', exact: true }).inputValue(), '先验证用户路径');
    await save(); let data = await store.read(); assert.equal(data.items.length, 1); assert.deepEqual(data.items[0].threadLinks, []);
    const stageGeometry = () => work.evaluate(element => {
      const stage = element.querySelector('.nuyoah-work-stage'), body = element.closest('.nuyoah-project-overview-body');
      const rect = stage.getBoundingClientRect();
      return { height: rect.height, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
        width: rect.width, bodyHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight };
    });
    const initialStage = await stageGeometry();
    assert.ok(initialStage.height > initialStage.bodyHeight * .75, `the canvas receives the main viewport: ${JSON.stringify(initialStage)}`);
    assert.ok(initialStage.bodyScrollHeight <= initialStage.bodyHeight + 1, 'the page does not scroll a fixed-height canvas out of view');

    // Secondary tools are reachable by keyboard, and Escape closes only the transient control.
    await work.getByRole('button', { name: '工作事项选项', exact: true }).focus(); await page.keyboard.press('Enter');
    assert.equal(await work.getByRole('button', { name: '查找与筛选', exact: true }).isVisible(), true);
    await page.keyboard.press('Enter');
    assert.equal(await work.getByRole('textbox', { name: '搜索工作事项', exact: true }).isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await work.getByRole('textbox', { name: '搜索工作事项', exact: true }).isVisible(), false);
    await open();
    const narrowInspector = await work.locator('.nuyoah-work-editor').boundingBox();
    const selectedStage = await stageGeometry();
    assert.equal(selectedStage.height, initialStage.height, 'opening the inspector never pushes the canvas downward');
    assert.ok(narrowInspector.width >= selectedStage.width - 30 && narrowInspector.y > selectedStage.top, 'a narrow panel uses a bottom inspector');
    await work.getByRole('textbox', { name: '下一步', exact: true }).fill('Escape 后继续的草稿');
    await page.keyboard.press('Escape');
    assert.equal(await work.locator('.nuyoah-work-editor').isVisible(), false);
    await open();
    assert.equal(await work.getByRole('textbox', { name: '下一步', exact: true }).inputValue(), 'Escape 后继续的草稿');
    await work.getByRole('button', { name: '放弃草稿', exact: true }).click();

    // Layout changes are persisted independently and must never save item content.
    const canvas = work.locator('.nuyoah-work-canvas').first();
    const viewport = canvas.locator('.nuyoah-work-canvas-viewport');
    await viewport.scrollIntoViewIfNeeded();
    const canvasNode = canvas.locator('button[data-node-id]').first();
    const movingId = await canvasNode.getAttribute('data-node-id');
    const positionBefore = await canvasNode.evaluate(e => ({ x: parseFloat(e.style.left), y: parseFloat(e.style.top) }));
    const box = await canvasNode.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 30, { steps: 6 }); await page.mouse.up();
    const positionAfter = await canvasNode.evaluate(e => ({ x: parseFloat(e.style.left), y: parseFloat(e.style.top) }));
    assert.ok(positionAfter.x > positionBefore.x && positionAfter.y > positionBefore.y, 'pointer drag moves the node in world coordinates');
    assert.equal(await work.locator('.nuyoah-work-editor').isVisible(), false, 'dragging does not activate the item editor');
    assert.equal((await store.read()).revision, data.revision, 'moving a node does not mutate the canonical record');
    const zoomBefore = Number(await viewport.getAttribute('data-zoom'));
    await canvas.getByRole('button', { name: '放大画布', exact: true }).click();
    assert.ok(Number(await viewport.getAttribute('data-zoom')) > zoomBefore);
    const panBefore = Number(await viewport.getAttribute('data-pan-y'));
    const area = await viewport.boundingBox(); await page.mouse.move(area.x + 12, area.y + 12); await page.mouse.wheel(0, 60);
    await page.waitForFunction(previous => Number(document.querySelector('.nuyoah-work-canvas-viewport').dataset.panY) !== previous, panBefore);
    await page.reload(); await drain();
    const restored = await work.locator('button[data-node-id]').evaluateAll((nodes, id) => { const e = nodes.find(n => n.dataset.nodeId === id); return e && { x: parseFloat(e.style.left), y: parseFloat(e.style.top) }; }, movingId);
    assert.deepEqual(restored, positionAfter, 'reload restores layout separately from the work item');
    await work.locator('.nuyoah-work-canvas').first().getByRole('button', { name: '适应全部节点', exact: true }).click();

    // The native desktop uses CSS zoom; screen movement must still track the pointer.
    await page.evaluate(() => document.body.style.zoom = '1.1');
    await canvas.getByRole('button', { name: '适应全部节点', exact: true }).click();
    const scaledNode = canvas.locator('button[data-node-id]').first();
    const scaledBefore = await scaledNode.boundingBox();
    await page.mouse.move(scaledBefore.x + scaledBefore.width / 2, scaledBefore.y + scaledBefore.height / 2); await page.mouse.down();
    await page.mouse.move(scaledBefore.x + scaledBefore.width / 2 + 33, scaledBefore.y + scaledBefore.height / 2 + 22, { steps: 6 }); await page.mouse.up();
    const scaledAfter = await scaledNode.boundingBox();
    assert.ok(Math.abs(scaledAfter.x - scaledBefore.x - 33) < 1 && Math.abs(scaledAfter.y - scaledBefore.y - 22) < 1, 'drag follows the pointer at native CSS zoom 1.1');
    const scaledArea = await viewport.boundingBox(), anchor = { x: scaledArea.x + scaledArea.width * .7, y: scaledArea.y + scaledArea.height * .7 };
    const worldAtAnchor = () => viewport.evaluate((e, a) => {
      const r = e.getBoundingClientRect(), x = (a.x-r.left)/(r.width/e.offsetWidth)-e.clientLeft, y = (a.y-r.top)/(r.height/e.offsetHeight)-e.clientTop;
      return { x: (x-Number(e.dataset.panX))/Number(e.dataset.zoom), y: (y-Number(e.dataset.panY))/Number(e.dataset.zoom) };
    }, anchor);
    const anchoredBefore = await worldAtAnchor(), scaledZoom = Number(await viewport.getAttribute('data-zoom'));
    await page.mouse.move(anchor.x, anchor.y); await page.keyboard.down('Control'); await page.mouse.wheel(0, -40);
    await page.waitForFunction(previous => Number(document.querySelector('.nuyoah-work-canvas-viewport').dataset.zoom) !== previous, scaledZoom); await page.keyboard.up('Control');
    const anchoredAfter = await worldAtAnchor();
    assert.ok(Math.abs(anchoredAfter.x-anchoredBefore.x)<1 && Math.abs(anchoredAfter.y-anchoredBefore.y)<1, 'zoom keeps the pointer anchored at native CSS zoom 1.1');
    await page.evaluate(() => document.body.style.zoom = '');
    await canvas.getByRole('button', { name: '适应全部节点', exact: true }).click();

    await open(); await work.getByText('添加关联任务', { exact: true }).click();
    await work.locator('.nuyoah-work-task-choice').filter({ hasText: '本机方案任务' }).click();
    await work.locator('.nuyoah-work-task-choice').filter({ hasText: '远程复核任务' }).click(); await save();
    data = await store.read(); assert.deepEqual(data.items[0].threadLinks, [{ hostId: 'local', threadId: id }, { hostId: 'fixture-remote', threadId: id }]);

    await open(); await work.getByRole('button', { name: '添加节点', exact: true }).click();
    await work.getByRole('textbox', { name: '节点名称', exact: true }).fill('整理方案');
    await work.getByRole('combobox', { name: '显示状态', exact: true }).selectOption('done');
    await work.getByRole('button', { name: '添加节点', exact: true }).click();
    await work.getByRole('textbox', { name: '节点名称', exact: true }).fill('验证界面');
    await work.getByRole('combobox', { name: '父节点', exact: true }).selectOption({ label: '整理方案' });
    await work.getByRole('button', { name: '计划图', exact: true }).click();
    assert.match(await work.getByLabel('事项计划图').innerText(), /整理方案[\s\S]*验证界面/); await save();
    data = await store.read(); assert.equal(data.items[0].nodes[0].manualStatus, 'done');
    await open(); await work.locator('.nuyoah-work-plan button[data-node-id^="plan:"]').filter({ hasText: '整理方案' }).click();
    await work.getByRole('combobox', { name: '显示状态', exact: true }).selectOption('');
    await work.getByRole('textbox', { name: '节点名称', exact: true }).fill('整理方案与边界');
    await work.getByRole('button', { name: '计划列表', exact: true }).click();
    assert.match(await work.getByLabel('事项计划列表').innerText(), /整理方案与边界/); await save();
    data = await store.read(); assert.equal(data.items[0].nodes[0].manualStatus, null); assert.equal(data.items[0].nodes[0].status, 'todo');

    // A real out-of-process-equivalent store write conflicts with, but cannot erase, the draft.
    await open(); await work.getByRole('textbox', { name: '下一步', exact: true }).fill('留在浏览器里的草稿');
    data = await store.read(); await store.save({ ...data.items[0], nextStep: '另一个编辑者已记录的下一步' }, data.revision);
    await refresh(); assert.equal(await work.getByRole('textbox', { name: '下一步', exact: true }).inputValue(), '留在浏览器里的草稿');
    assert.equal(await work.getByRole('button', { name: '保存事项', exact: true }).isDisabled(), true);
    await work.getByText('查看最新记录', { exact: true }).click(); assert.equal(await work.locator('.nuyoah-work-conflict').getByText('下一步 · 另一个编辑者已记录的下一步', { exact: true }).isVisible(), true);
    await work.getByRole('button', { name: '放弃草稿并重载', exact: true }).click();
    await work.locator('.nuyoah-work-item-details > summary').click();
    assert.equal(await work.getByRole('textbox', { name: '下一步', exact: true }).inputValue(), '另一个编辑者已记录的下一步');

    await work.getByRole('button', { name: '归档事项', exact: true }).click(); await drain(); assert.equal((await store.read()).items[0].archived, true);
    await work.getByRole('button', { name: '工作事项选项', exact: true }).click();
    await work.getByRole('button', { name: '已归档事项', exact: true }).click();
    await work.getByRole('button', { name: '收起筛选', exact: true }).click(); await open();
    await work.getByRole('button', { name: '恢复事项', exact: true }).click(); await drain(); assert.equal((await store.read()).items[0].archived, false);
    await page.reload(); await drain(); assert.equal(await work.locator('button[data-node-id^="item:"]').filter({ hasText: '演示：完成项目方案' }).isVisible(), true);
    await open(); assert.equal(await work.getByRole('textbox', { name: '下一步', exact: true }).inputValue(), '另一个编辑者已记录的下一步');

    // The production openProjectTask entry returns to the existing production summary UI.
    await work.locator('.nuyoah-work-link').getByRole('button', { name: '本机方案任务', exact: true }).click(); await drain();
    assert.deepEqual(await page.evaluate(() => window.fixtureOpened), [{ hostId: 'local', threadId: id }]);
    assert.equal(await page.locator('[data-nuyoah-project-task-view]').getByText('虚构任务：验证同一项目方案', { exact: true }).isVisible(), true);
    assert.equal(await work.isVisible(), false);

    await page.getByRole('button', { name: '工作事项', exact: true }).click(); await drain();
    await work.getByRole('button', { name: '计划图', exact: true }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.body.dataset.theme = value, theme);
      const bounds = await work.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth, color: getComputedStyle(element).color, background: getComputedStyle(document.querySelector('#nuyoah-workstation-project-page')).backgroundColor }));
      assert.ok(bounds.client > 300 && bounds.client <= 420); assert.ok(bounds.scroll <= bounds.client + 1, `${theme} panel has no horizontal overflow`); assert.notEqual(bounds.color, bounds.background);
      await work.locator('.nuyoah-work-plan button[data-node-id^="plan:"]').filter({ hasText: '整理方案与边界' }).focus(); await page.keyboard.press('Enter');
      assert.equal(await work.getByRole('textbox', { name: '节点名称', exact: true }).isVisible(), true);
      const focusStyle = await work.locator('.nuyoah-work-plan button[data-node-id^="plan:"]').filter({ hasText: '整理方案与边界' }).evaluate(element => ({ width: getComputedStyle(element).outlineWidth, style: getComputedStyle(element).outlineStyle }));
      assert.notEqual(focusStyle.width, '0px'); assert.notEqual(focusStyle.style, 'none');
    }
    await page.evaluate(() => document.body.dataset.theme = 'light');
    if (process.env.NUYOAH_WORK_ITEMS_SCREENSHOT) {
      await mkdir(path.dirname(process.env.NUYOAH_WORK_ITEMS_SCREENSHOT), { recursive: true });
      const details = work.locator('.nuyoah-work-item-details');
      if (await details.evaluate(e => e.open)) await details.locator('summary').first().click();
      await work.locator('.nuyoah-work-editor').evaluate(e => e.scrollTop = 0);
      await page.screenshot({ path: process.env.NUYOAH_WORK_ITEMS_SCREENSHOT, fullPage: true });
      // Additional presentation evidence uses clearly fictional content in this same temporary store.
      await work.getByRole('button', { name: '关闭', exact: true }).click();
      // Reset the earlier deliberate drag before testing automatic placement of new nodes.
      await work.locator('.nuyoah-work-canvas').first().getByRole('button', { name: '整理节点布局', exact: true }).click();
      for (const [title, direction, nextStep, status] of [
        ['示例：完成产品体验升级', '产品开发', '复核主要交互与布局', 'doing'],
        ['示例：准备本周内容', '内容创作', '确定选题与文章结构', 'todo'],
        ['示例：整理素材资料', '日常事务', '归档已完成项目的产出', 'waiting']
      ]) {
        const current = await store.read();
        await store.save({ id: '', title, direction, nextStep, status, note: '', focus: status === 'doing', archived: false, threadLinks: [], nodes: [] }, current.revision);
      }
      await refresh();
      const itemBoxes = await work.locator('.nuyoah-work-canvas-host').first().locator('button[data-node-id]').evaluateAll(nodes => nodes.map(e => ({x:parseFloat(e.style.left),y:parseFloat(e.style.top),w:parseFloat(e.style.width),h:parseFloat(e.style.height)})));
      for (let i=0;i<itemBoxes.length;i++) for (let j=i+1;j<itemBoxes.length;j++) {
        const a=itemBoxes[i], b=itemBoxes[j];
        assert.ok(a.x+a.w<=b.x || b.x+b.w<=a.x || a.y+a.h<=b.y || b.y+b.h<=a.y, 'newly prioritised items do not cover the saved positions of existing nodes');
      }
      await page.setViewportSize({ width: 1600, height: 1120 });
      await page.locator('#nuyoah-workstation-project-page').evaluate(e => e.style.setProperty('--codex-workspace-panel-width', '960px'));
      await work.locator('.nuyoah-work-canvas').first().getByRole('button', { name: '整理节点布局', exact: true }).click();
      await work.locator('.nuyoah-work-canvas-host').first().scrollIntoViewIfNeeded();
      const parsed = path.parse(process.env.NUYOAH_WORK_ITEMS_SCREENSHOT);
      await page.screenshot({ path: path.join(parsed.dir, `${parsed.name}-overview${parsed.ext}`), fullPage: true });
    }
    // A wide panel moves the same inspector to the right without growing the page.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.locator('#nuyoah-workstation-project-page').evaluate(e => e.style.setProperty('--codex-workspace-panel-width', '960px'));
    await open();
    const wideStage = await stageGeometry(), wideInspector = await work.locator('.nuyoah-work-editor').boundingBox();
    assert.ok(wideStage.width > 700, 'wide inspector test exercises the wide container');
    assert.ok(wideInspector.x > wideStage.left + wideStage.width * .5 && wideInspector.width <= 360, 'wide panels use a right inspector');
    assert.ok(wideInspector.y >= wideStage.top && wideInspector.y + wideInspector.height <= wideStage.bottom, 'the inspector stays within the canvas viewport');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await work.locator('.nuyoah-work-editor').evaluate(element => getComputedStyle(element).scrollBehavior), 'auto');
    assert.deepEqual(errors, [], 'the real browser reports no uncaught UI exceptions');
  } finally {
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true });
  }
});
