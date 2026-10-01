import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatGptCatalog } from '../nuyoah/taskboard/chatgpt-catalog.mjs';
const root = fileURLToPath(new URL('../vendor/codex-taskboard/dist/web/', import.meta.url));
const injection = await readFile(new URL('../vendor/codex-taskboard/inject/codex-taskboard.user.js', import.meta.url), 'utf8');
const openFunction = injection.slice(injection.indexOf('  async function openThread('), injection.indexOf('  async function ', injection.indexOf('  async function openThread(') + 10));
const id = '11111111-1111-4111-8111-111111111111';

test('project and ChatGPT columns stay side by side with independent expansion and native chat actions', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 60000 }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  let browser;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/host') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><iframe style="border:0;width:100%;height:900px" src="/?host=codex"></iframe>'); return; }
      if (url.pathname.startsWith('/api/')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ connected: false, requests: [] })); return; }
      const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (filename.includes('..')) throw Error('invalid');
      const content = await readFile(path.join(root, filename));
      res.setHeader('content-type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html'); res.end(content);
    } catch { res.writeHead(404); res.end(); }
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 860, height: 940 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('taskboard.codex-live-view.v1', 'all');
      if (!localStorage.getItem('taskboard.codex-live-meta.v2')) localStorage.setItem('taskboard.codex-live-meta.v2', JSON.stringify({ 'project-history': { seenAt: '2020-01-01T00:00:00Z', initialHistory: true } }));
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/host`);
    await page.evaluate(({ factory, openFunction, id }) => {
      window.routes = []; window.chatStatus = 'active';
      const updatedAt = Date.now()/1000;
      const baseProject = { projectId: 'fixture-project', projectName: '虚构项目', hostId: 'local', workspacePath: '', projectWorkspacePath: '', progress: '虚构测试进展', updatedAt: new Date(updatedAt*1000).toISOString(), runtimeStatus: 'completed' };
      window.projectTasks = [
        ...Array.from({ length: 6 }, (_, i) => ({ ...baseProject, threadId: `project-${i}`, taskKey: `project-${i}`, title: `虚构项目任务 ${i}` })),
        { ...baseProject, threadId: id, taskKey: id, title: '虚构执行任务', runtimeStatus: 'running' },
        { ...baseProject, threadId: 'project-history', taskKey: 'project-history', title: '虚构项目历史', updatedAt: '2020-01-01T00:00:00Z' },
      ];
      const create = (0, eval)(`(${factory})`);
      window.chatCatalog = create({ read: async () => [{ id, title: '虚构生图聊天', status: window.chatStatus, updatedAt },
        ...Array.from({ length: 6 }, (_, i) => ({ id: `22222222-2222-4222-8222-22222222222${i}`, title: `虚构聊天 ${i}`, status: 'idle', updatedAt })),
        { id: '33333333-3333-4333-8333-333333333333', title: '虚构聊天历史', status: 'idle', updatedAt: 1577836800 },
      ], onChange: () => window.publish?.() });
      window.publish = () => document.querySelector('iframe').contentWindow.postMessage({ type: 'taskboard:host-context', payload: {
        theme: window.testTheme || 'light', threadId: id, hostId: 'chatgpt', projects: [], taskboard: { version: 1, tasks: [...window.projectTasks, ...window.chatCatalog.snapshot()], remoteSync: window.chatCatalog.syncState() },
      } }, '*');
      window.__codexConversationPreviewInjection__ = { getTaskboardSnapshot: () => ({ tasks: window.chatCatalog.snapshot() }) };
      const open = new Function('normalizeThreadId', 'dispatchHostMessage', 'postHostContext', 'REATTACH_DELAY_MS', `${openFunction}; return openThread;`)(value => value, message => window.routes.push(message.path), window.publish, 0);
      window.addEventListener('message', event => {
        if (event.source !== document.querySelector('iframe').contentWindow) return;
        if (event.data?.type === 'taskboard:ready') window.publish();
        if (event.data?.type === 'taskboard:open-thread') void open(event.data.payload.threadId, event.data.payload.hostId);
      });
      window.chatCatalog.setActive(true);
    }, { factory: createChatGptCatalog.toString(), openFunction, id });
    const frame = page.frameLocator('iframe');
    await frame.getByRole('tab', { name: '全部任务', exact: true }).waitFor();
    await page.evaluate(() => window.publish());
    const project = frame.locator('[data-task-source="project"]');
    const chat = frame.locator('[data-task-source="chatgpt"]');
    const card = chat.locator(`article[data-thread-id="${id}"]`);
    async function assertParallel() {
      const left = await project.boundingBox(), right = await chat.boundingBox();
      assert.ok(left.x + left.width <= right.x && Math.abs(left.y - right.y) < 1, 'sources must remain side by side');
    }
    await project.waitFor(); await assertParallel();
    assert.equal(await project.getByRole('heading', { name: '项目任务', exact: true }).count(), 1);
    assert.equal(await chat.getByRole('heading', { name: 'ChatGPT 聊天', exact: true }).count(), 1);
    assert.equal(await project.locator('.is-attention article').count(), 5);
    assert.equal(await chat.locator('.is-attention article').count(), 5);
    await project.getByRole('button', { name: '再显示 1 个', exact: true }).click();
    assert.equal(await project.locator('.is-attention article').count(), 6);
    assert.equal(await chat.locator('.is-attention article').count(), 5);
    await project.locator('.codex-live-history > summary').click();
    await project.getByText('虚构项目历史', { exact: true }).waitFor();
    assert.equal(await chat.locator('details[open]').count(), 0);
    await frame.locator('html').evaluate(() => window.location.reload());
    await project.getByText('虚构项目历史', { exact: true }).waitFor();
    assert.equal(await project.locator('.is-attention article').count(), 6);
    assert.equal(await chat.locator('.is-attention article').count(), 5);
    assert.equal(await chat.locator('details[open]').count(), 0);
    assert.equal(await project.locator(`article[data-thread-id="${id}"]`).getAttribute('aria-current'), null);
    await card.waitFor(); assert.match(await card.innerText(), /虚构生图聊天/);
    assert.match(await card.innerText(), /正在生成回复/); assert.match(await card.innerText(), /正在查看/);
    assert.equal(await card.getByRole('button', { name: '归档', exact: true }).count(), 0);
    assert.equal(await card.getByText('执行目录待同步').count(), 0);
    await card.getByRole('button').first().click();
    await page.waitForFunction(id => window.routes.includes(`/c/${id}`), id);
    await page.evaluate(async () => { window.chatStatus = 'idle'; window.testTheme = 'dark'; await window.chatCatalog.refresh(); window.publish(); });
    await card.getByText('打开聊天查看结果', { exact: true }).waitFor();
    if (process.env.NUYOAH_UI_SCREENSHOT_DIR) {
      await frame.locator('.codex-live-board').evaluate(node => { node.scrollTop = 0; });
      await page.screenshot({ path: `${process.env.NUYOAH_UI_SCREENSHOT_DIR}/columns-wide.png` });
    }
    await page.setViewportSize({ width: 440, height: 940 });
    await assertParallel();
    await page.evaluate(() => window.publish());
    if (process.env.NUYOAH_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.NUYOAH_UI_SCREENSHOT_DIR}/columns-narrow.png` });
    assert.equal(await frame.locator('body').evaluate(node => node.scrollWidth <= window.innerWidth + 1), true);
    await card.getByRole('button', { name: '确认完成', exact: true }).focus(); await page.keyboard.press('Enter');
    await card.getByText(/已确认完成/).waitFor();
    assert.equal(await project.locator(`.is-running article[data-thread-id="${id}"]`).count(), 1);
    await frame.locator('.codex-live-toolbar select').selectOption('__chatgpt__');
    assert.equal(await frame.getByRole('button', { name: '新建任务', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.chatCatalog.dispose());
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
