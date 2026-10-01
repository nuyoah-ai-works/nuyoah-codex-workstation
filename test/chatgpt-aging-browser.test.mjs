import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../vendor/codex-taskboard/dist/web/', import.meta.url));
test('ChatGPT expires in the visible board without a new host snapshot and reopens on new activity', {
  skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 60000,
}, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/host') {
        res.setHeader('content-type', 'text/html');
        res.end('<!doctype html><script>window.addEventListener("message",event=>{if(event.data?.type==="taskboard:ready")window.boardReady=true})</script><iframe style="border:0;width:100%;height:900px" src="/?host=codex"></iframe>'); return;
      }
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ connected: false, requests: [] })); return;
      }
      const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (filename.includes('..')) throw Error('invalid');
      const content = await readFile(path.join(root, filename));
      res.setHeader('content-type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html'); res.end(content);
    } catch { res.writeHead(404); res.end(); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 860, height: 940 } });
    const now = Date.parse('2026-09-30T04:00:00Z');
    await page.clock.install({ time: new Date(now) });
    await page.addInitScript(() => {
      localStorage.setItem('taskboard.codex-live-view.v1', 'all');
      localStorage.setItem('taskboard.codex-live-meta.v2', JSON.stringify({
        'chatgpt:recent': { seenAt: '2026-09-28T04:00:00Z', initialRemoteHistory: true },
      }));
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/host`);
    const frame = page.frameLocator('iframe');
    await page.waitForFunction(() => window.boardReady === true);
    const hours = 3600000;
    const task = (id, age, runtimeStatus = 'completed', source = 'chatgpt') => ({
      threadId: id, taskKey: `${source}:${id}`, source, hostId: source === 'chatgpt' ? 'chatgpt' : 'local',
      title: `虚构 ${id}`, projectId: source === 'chatgpt' ? '__chatgpt__' : 'fixture', projectName: '虚构',
      workspacePath: '', projectWorkspacePath: '', updatedAt: new Date(now - age).toISOString(), runtimeStatus,
    });
    const tasks = [task('recent', 48 * hours), task('expired', 72 * hours + 1000),
      task('soon', 72 * hours - 60000), task('active', 100 * hours, 'running'),
      task('failure', 100 * hours, 'failed'), task('project', 100 * hours, 'completed', 'project')];
    const publish = async () => page.evaluate(tasks => {
      document.querySelector('iframe').contentWindow.postMessage({ type: 'taskboard:host-context', payload: {
        theme: 'light', hostId: 'local', projects: [], taskboard: { version: 1, tasks },
      } }, '*');
    }, tasks);
    await publish();
    const chat = frame.locator('[data-task-source="chatgpt"]');
    const card = id => chat.locator(`article[data-thread-id="${id}"]`);
    await chat.locator('.is-attention article[data-thread-id="recent"]').waitFor();
    await chat.locator('.is-completed article[data-thread-id="expired"]').waitFor();
    assert.match(await card('expired').innerText(), /已完成/);
    assert.doesNotMatch(await card('expired').innerText(), /已确认完成|历史记录/);
    assert.equal(await chat.locator('.is-attention article').count(), 2);
    assert.equal(await chat.locator('.is-running article[data-thread-id="active"]').count(), 1);
    assert.equal(await chat.locator('.is-failed article[data-thread-id="failure"]').count(), 1);
    assert.equal(await frame.locator('[data-task-source="project"] .is-attention article').count(), 1);
    const metaBefore = await frame.locator('body').evaluate(() => localStorage.getItem('taskboard.codex-live-meta.v2'));
    await page.clock.fastForward(61000);
    await chat.locator('.is-completed article[data-thread-id="soon"]').waitFor();
    assert.equal(await chat.locator('.is-attention article').count(), 1);
    assert.equal(await frame.locator('body').evaluate(() => localStorage.getItem('taskboard.codex-live-meta.v2')), metaBefore,
      'expiry must not forge a user acknowledgement');
    tasks.find(value => value.threadId === 'expired').updatedAt = new Date(now + 61000).toISOString();
    await publish();
    await chat.locator('.is-attention article[data-thread-id="expired"]').waitFor();
    await card('expired').getByRole('button', { name: '确认完成', exact: true }).click();
    await chat.locator('.is-completed article[data-thread-id="expired"]').waitFor();
    assert.match(await card('expired').innerText(), /已确认完成/);
    await page.setViewportSize({ width: 440, height: 940 });
    const left = await frame.locator('[data-task-source="project"]').boundingBox(), right = await chat.boundingBox();
    assert.ok(left.x + left.width <= right.x);
    assert.equal(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
