import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startAssetServer } from '../nuyoah/assets/server.mjs';

test('current-task assets follow project changes, retain the filter and recover after reopening', {
  skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 60000,
}, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const root = await mkdtemp(path.join(os.tmpdir(), 'asset-context-'));
  const token = 'fixture-asset-context-token-01234567890123456789';
  const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
  let app, browser;
  try {
    for (let i = 0; i < 2; i++) await writeFile(path.join(root, `fixture-${i}.md`), `# Fictional task ${i}`);
    app = await startAssetServer({ stateRoot: path.join(root, 'state'), token, port: 0,
      taskStore: { view: async () => ({ excludedReferencePaths: [], references: [] }) },
      automatic: { view: async id => ({ status: 'ready', references: [{ path: path.join(root, `fixture-${ids.indexOf(id)}.md`), relation: 'output' }] }) },
    });
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, extraHTTPHeaders: { 'x-asset-console-token': token } });
    page.setDefaultTimeout(5000); const errors = []; page.on('pageerror', e => errors.push(e.message));
    const base = 'http://127.0.0.1:' + app.server.address().port;
    await page.goto(`${base}/?threadId=${ids[0]}&projectId=fixture-project-a&threadTitle=Fixture-A`);
    await page.locator('#taskButton').click(); await page.locator('.card-title').filter({ hasText: 'fixture-0.md' }).waitFor();
    const context = async (index, projectId = '', hostId = 'local') => {
      await page.evaluate(data => window.postMessage({ source: 'codex-sidebar-enhancer', action: 'context', ...data }, '*'),
        { threadId: index == null ? '' : ids[index], projectId, hostId, threadTitle: `Fixture-${index}` });
    };
    await context(1, 'fixture-project-b'); await page.locator('.card-title').filter({ hasText: 'fixture-1.md' }).waitFor();
    assert.equal(await page.locator('#taskButton').getAttribute('aria-pressed'), 'true');
    await context(null); await page.waitForTimeout(100);
    assert.equal(await page.locator('#sourceStatus').textContent(), 'Fixture-1');
    await page.evaluate(() => window.postMessage({source:'codex-sidebar-enhancer',action:'context',clearTask:true},'*'));
    await page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 0);
    assert.equal(await page.locator('#taskButton').getAttribute('aria-pressed'), 'true');
    assert.notEqual(await page.locator('#sourceStatus').textContent(), 'Fixture-1');
    await context(0, 'fixture-project-a'); await page.locator('.card-title').filter({ hasText: 'fixture-0.md' }).waitFor();
    const taskRequests = []; page.on('request', r => { const u = new URL(r.url()); if (u.pathname === '/api/assets' && u.searchParams.get('scope') === 'task') taskRequests.push(u.searchParams.get('hostId')); });
    await context(0, 'fixture-project-a', 'remote-fixture'); await page.getByText('远程任务资产暂不可用', { exact: true }).waitFor();
    assert.equal(await page.locator('.asset-card').count(), 0); assert.equal(await page.locator('#scanButton').isDisabled(), true);
    assert.deepEqual(taskRequests, []);
    await context(0, 'fixture-project-a'); await page.locator('.card-title').filter({ hasText: 'fixture-0.md' }).waitFor();
    await page.goto(`${base}/?threadId=${ids[1]}&projectId=fixture-project-b&threadTitle=Fixture-B`);
    await page.locator('.card-title').filter({ hasText: 'fixture-1.md' }).waitFor();
    assert.equal(await page.locator('#taskButton').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await app?.close(); await rm(root, { recursive: true, force: true }); }
});
