import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { createProjectView } from '../nuyoah/workstation/project-view.mjs';
import { liveStateRuntimeSource } from '../nuyoah/taskboard/live-state.mjs';

// Production DOM, CSS, and capture-phase keyboard routing in isolated Chromium.
// Service responses are fictional and in memory; this never touches native tasks.
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const root = new URL('../', import.meta.url);
function between(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `production section exists: ${start}`);
  return source.slice(from, to);
}
async function fixtureHTML() {
  const [host, taskContext] = await Promise.all(['inject/conversation-preview.user.js', 'nuyoah/workstation/task-context-ui.js'].map(file => readFile(new URL(file, root), 'utf8')));
  const projectSource = between(host, "  let projectSubview = 'map'", '\n  function openProjectOverview()');
  const keyboardSource = between(host, '  function handleWorkspaceEnhancementKeydown(event)', '\n  function workspaceCommand(value)');
  const css = between(host, '      #${PROJECT_OVERVIEW_PAGE_ID} {', '\n      #codex-taskboard-page[data-nuyoah-workstation-frame="true"]')
    .replaceAll('${PROJECT_OVERVIEW_PAGE_ID}', 'nuyoah-workstation-project-page').replaceAll('${WORKSTATION_HEADER_CLASS}', 'nuyoah-workstation-header');
  const script = `
    localStorage.setItem('nuyoah-project-subview','tasks');
    window.__NUYOAH_WORKSTATION_CONFIG__={taskContextCommand:['node','/fixture/task-context.mjs']};
    const tasks=[
      {hostId:'local',threadId:'${first}',projectId:'fixture-project',projectName:'虚构验收项目',title:'示例任务甲',runtimeStatus:'running',updatedAt:'2026-09-21T09:00:00Z'},
      {hostId:'local',threadId:'${second}',projectId:'fixture-project',projectName:'虚构验收项目',title:'示例任务乙',runtimeStatus:'completed',updatedAt:'2026-09-21T08:00:00Z'}
    ];
    let context={...tasks[0],threadTitle:tasks[0].title},projectOverviewPage;
    const PROJECT_OVERVIEW_PAGE_ID='nuyoah-workstation-project-page',ALL_FOLDER_ID='all',activeFolderId='all',folderSources=new Map();
    const workstationDrag=null,skillContextMenu=null,assetConsolePage=null,SKILL_ORGANIZER_ID='fixture-skills';
    function currentCodexTaskContext(){return {...context};}
    function getTaskboardSnapshot(){return {tasks};}
    function normalizedThreadId(value){return value;}
    function revealThread(){}
    function insertPlainTextIntoComposer(value){window.fixtureInserted.push(value);return true;}
    function createWorkstationHeader(){const h=document.createElement('header');h.className='nuyoah-workstation-header';h.textContent='项目工作站';return h;}
    function initializeWorkspacePanel(page){return page;}
    function currentComposer(){return null;}
    function closeProjectOverview(){projectOverviewPage.hidden=true;window.fixtureClosed++;}
    window.fixtureInserted=[];window.fixtureClosed=0;
    window.__nuyoahProjectView__=(${createProjectView.toString()})({storage:localStorage,states:${liveStateRuntimeSource()}});
    ${taskContext}
    ${projectSource}
    ${keyboardSource}
    document.addEventListener('keydown',handleWorkspaceEnhancementKeydown,true);
    for(const task of tasks){
      const b=document.createElement('button');b.textContent=task.title;b.dataset.appActionSidebarThreadId=task.threadId;b.dataset.appActionSidebarThreadHostId=task.hostId;
      b.onclick=()=>{context={...task,threadTitle:task.title};renderProjectOverview();};document.querySelector('nav[data-fixture-sidebar]').append(b);
    }
    projectOverviewPage=createProjectOverviewPage();projectOverviewPage.hidden=false;document.querySelector('main').append(projectOverviewPage);renderProjectOverview();
    window.fixtureTake=()=>{const result=[];for(let request;(request=window.__nuyoahTaskContextUI__.takeRequest());)result.push(request);return result;};
    window.fixtureReceive=response=>window.__nuyoahTaskContextUI__.receive(response);
  `;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>当前项目隔离验收</title><style>
    *{box-sizing:border-box}body{margin:0;font:17px/1.5 system-ui,sans-serif;color:#24282b;background:#f6f6f4;--nuyoah-workstation-font-size:17px;--color-token-bg-primary:#fff;--color-token-foreground:#24282b;--color-token-text-secondary:#687078}
    body[data-theme=dark]{color:#ececec;background:#191c20;--color-token-bg-primary:#25282d;--color-token-foreground:#ececec;--color-token-text-secondary:#b4bac4;color-scheme:dark}
    main{display:flex;height:100vh;justify-content:flex-end}.fixture-chat{flex:1;min-width:0;padding:28px}.fixture-chat button{display:block;margin:12px 0;font:inherit}.nuyoah-workstation-header{padding:13px 20px;border-bottom:1px solid #8884;font-weight:600}
    ${css}
    #nuyoah-workstation-project-page{--codex-workspace-panel-width:420px;max-width:none}
  </style></head><body><main><section class="fixture-chat"><h1>当前项目隔离验收</h1><p>虚构文件和任务，不连接正式宿主。</p><nav data-fixture-sidebar></nav></section></main><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
function dataFor(threadId, patch = {}) {
  const isFirst = threadId === first, prefix = isFirst ? '甲' : '乙';
  return { threadId, revision: 1, summary: { goal: `${prefix}任务的虚构目标`, nextStep: `${prefix}任务的下一步`, progress: `${prefix}任务的已记录进展`, agreements: '保留用户确认' }, notes: '', references: [], excludedReferencePaths: [],
    tokenSmart: { status: 'not_observed' }, coldHistory: { enabled: false, archives: [] },
    automaticReferences: { status: 'ready', relatedThreads: [], references: Array.from({ length: isFirst ? 5 : 1 }, (_, i) => ({ relation: 'output', label: `${prefix}产出-${i + 1}.md`, path: `/fixture/${prefix}-output-${i + 1}.md`, exists: true, automatic: true, evidence: 'delivery', modifiedAt: 1800000000000 - i * 1000 })) }, ...patch };
}

test('calm project view keeps output previews scoped, records lazy, drafts intact and late responses isolated', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const errors = [], requests = []; let browser, server;
  try {
    const html = await fixtureHTML();
    server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(html); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1120, height: 1000 } }); page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    const take = async () => { const batch = await page.evaluate(() => window.fixtureTake()); requests.push(...batch); return batch; };
    const receive = response => page.evaluate(value => window.fixtureReceive(value), response);
    const read = async () => { const batch = await take(); assert.equal(batch.length, 1, `only the selected summary is read: ${JSON.stringify(batch.map(({ action, threadId }) => ({ action, threadId })))}`); assert.equal(batch[0].action, 'read'); await receive({ id: batch[0].id, threadId: batch[0].threadId, data: dataFor(batch[0].threadId) }); return batch[0]; };
    const context = page.locator('[data-nuyoah-project-task-view] > .nuyoah-task-context');
    const outputs = context.locator('.nuyoah-task-outputs');
    const menu = context.getByLabel('摘要选项', { exact: true });
    const switchTask = title => page.locator('[data-fixture-sidebar]').getByRole('button', { name: title, exact: true }).click();
    await page.goto(`http://127.0.0.1:${server.address().port}`); await read();
    assert.equal(await outputs.locator('.nuyoah-reference-item').count(), 3);
    assert.equal(await context.getByText('甲任务的虚构目标', { exact: true }).isVisible(), true);
    assert.equal(await context.locator('.nuyoah-context-records').evaluate(e => e.open), false);
    assert.equal(await page.locator('.nuyoah-project-task-directory').evaluate(e => e.open), false);
    assert.equal(await context.getByRole('button', { name: '编辑摘要', exact: true }).isVisible(), false);
    assert.deepEqual(await take(), [], 'no preview or history request before explicit action');
    const firstOutputBounds = await outputs.boundingBox();
    assert.ok(firstOutputBounds.y + firstOutputBounds.height < 1000, 'three output rows remain on the first viewport');
    if (process.env.NUYOAH_PROJECT_CALM_SCREENSHOT) {
      await mkdir(path.dirname(process.env.NUYOAH_PROJECT_CALM_SCREENSHOT), { recursive: true });
      await page.screenshot({ path: process.env.NUYOAH_PROJECT_CALM_SCREENSHOT, fullPage: true });
    }

    // The file row is the preview action, and Escape returns focus under the real capture handler.
    const trigger = outputs.getByRole('button', { name: '预览 甲产出-1.md', exact: true });
    await trigger.focus(); await page.keyboard.press('Enter');
    const [preview] = await take(); assert.equal(preview.action, 'preview'); assert.equal(preview.path, '/fixture/甲-output-1.md'); assert.equal(preview.threadId, first);
    await receive({ id: preview.id, threadId: first, preview: { label: '甲产出-1.md', text: '只有这份文件的虚构预览' } });
    assert.equal(await page.getByRole('dialog', { name: '预览 甲产出-1.md', exact: true }).getByText('只有这份文件的虚构预览', { exact: true }).isVisible(), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.nuyoah-file-preview'));
    assert.equal(await page.locator('.nuyoah-file-preview').count(), 0); assert.equal(await trigger.evaluate(e => document.activeElement === e), true);
    assert.equal(await page.evaluate(() => window.fixtureClosed), 0); assert.deepEqual(await take(), []);
    await outputs.getByRole('button', { name: '查看更多（5 项）', exact: true }).click(); assert.equal(await outputs.locator('.nuyoah-reference-item').count(), 5);
    await outputs.getByRole('button', { name: '收起', exact: true }).click(); assert.equal(await outputs.locator('.nuyoah-reference-item').count(), 3);

    // Summary editing is explicit; refresh and host Escape preserve unsaved input.
    await menu.click(); await context.getByRole('button', { name: '编辑摘要', exact: true }).click();
    const goal = context.getByRole('textbox', { name: '目标', exact: true });
    await goal.fill('尚未保存的甲任务目标');
    await page.keyboard.press('Escape'); assert.equal(await goal.isVisible(), false); assert.equal(await page.evaluate(() => window.fixtureClosed), 0);
    await menu.click(); await context.getByRole('button', { name: '编辑摘要', exact: true }).click(); assert.equal(await goal.inputValue(), '尚未保存的甲任务目标');
    await menu.click(); await context.getByRole('button', { name: '重新读取', exact: true }).click();
    const [refresh] = await take(); assert.equal(refresh.action, 'read');
    await receive({ id: refresh.id, threadId: first, data: dataFor(first, { revision: 2 }) });
    assert.equal(await goal.inputValue(), '尚未保存的甲任务目标');
    await page.keyboard.press('Escape');

    // Opening records alone does not request history; the inner control owns that request.
    await context.locator('.nuyoah-context-records > summary').click();
    assert.deepEqual(await take(), []);
    await context.locator('.nuyoah-skill-history > summary').click();
    await page.waitForFunction(() => document.querySelector('.nuyoah-skill-history [role=status]').textContent.includes('正在核对'));
    const [history] = await take(); assert.equal(history.action, 'skills:history'); assert.equal(history.scope, 'project'); assert.equal(history.threadId, first);

    // A pending old history result and an old summary response cannot alter the new task.
    await menu.click(); await context.getByRole('button', { name: '重新读取', exact: true }).click();
    const [lateRead] = await take(); assert.equal(lateRead.action, 'read');
    await switchTask('示例任务乙'); await read();
    await receive({ id: history.id, skillHistory: { status: 'ready', checked: 2, total: 2, skills: [{ name: '过期技能结果', count: 1, taskCount: 1, readAt: '2026-09-21T09:00:00Z' }] } });
    await receive({ id: lateRead.id, threadId: first, data: dataFor(first, { summary: { goal: '迟到的甲任务正文' } }) });
    assert.equal(await context.getByText('乙任务的虚构目标', { exact: true }).isVisible(), true);
    assert.equal(await context.getByText('迟到的甲任务正文', { exact: true }).count(), 0);
    assert.equal(await context.getByText('过期技能结果', { exact: true }).count(), 0);
    assert.equal(await outputs.locator('.nuyoah-reference-item').count(), 1);
    assert.deepEqual(await take(), [], 'a previously open history section stays lazy behind collapsed records');

    await context.locator('.nuyoah-context-records > summary').click();
    await page.waitForFunction(() => document.querySelector('.nuyoah-skill-history [role=status]').textContent.includes('正在核对'));
    const [nextHistory] = await take(); assert.equal(nextHistory.threadId, second);
    await receive({ id: nextHistory.id, skillHistory: { status: 'ready', checked: 2, total: 2, skills: [{ name: '示例技能', count: 2, taskCount: 1, readAt: '2026-09-21T09:00:00Z' }] } });
    assert.equal(await context.getByText('示例技能', { exact: true }).isVisible(), true);

    // A preview response arriving after native task navigation is ignored.
    await outputs.getByRole('button', { name: '预览 乙产出-1.md', exact: true }).click();
    const [latePreview] = await take(); assert.equal(latePreview.action, 'preview');
    await page.evaluate(() => document.querySelector('[data-fixture-sidebar] button').click());
    await receive({ id: latePreview.id, threadId: second, preview: { text: '迟到的乙文件正文' } });
    await page.waitForFunction(() => !document.querySelector('.nuyoah-file-preview'));
    assert.equal(await page.locator('.nuyoah-file-preview').count(), 0);
    assert.equal(await context.getByText('迟到的乙文件正文', { exact: true }).count(), 0);
    await menu.click(); await context.getByRole('button', { name: '编辑摘要', exact: true }).click();
    assert.equal(await goal.inputValue(), '尚未保存的甲任务目标', 'a task round trip preserves the original draft');
    await page.keyboard.press('Escape');
    // A remount may refresh the visible history; settle only that fictional request.
    for (const request of await take()) {
      assert.equal(request.action, 'skills:history');
      await receive({ id: request.id, skillHistory: { status: 'ready', checked: 2, total: 2, skills: [] } });
    }
    await context.locator('.nuyoah-context-records > summary').click();

    for (const width of [420, 960]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.locator('#nuyoah-workstation-project-page').evaluate((e, size) => e.style.setProperty('--codex-workspace-panel-width', `${size}px`), width);
      await page.evaluate(value => document.body.dataset.theme = value, theme);
      const geometry = await page.locator('.nuyoah-project-overview-body').evaluate(e => ({ client: e.clientWidth, scroll: e.scrollWidth, text: getComputedStyle(e).color, surface: getComputedStyle(e.closest('#nuyoah-workstation-project-page')).backgroundColor }));
      assert.ok(geometry.scroll <= geometry.client + 1, `${width}px ${theme} has no horizontal overflow`); assert.notEqual(geometry.text, geometry.surface);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await context.locator('.nuyoah-context-records > summary').evaluate(e => getComputedStyle(e, '::after').transitionDuration), '0s');
    assert.deepEqual(errors, []); assert.ok(requests.every(request => ['read', 'preview', 'skills:history'].includes(request.action)), 'this journey makes no mutations');
  } finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); }
});
