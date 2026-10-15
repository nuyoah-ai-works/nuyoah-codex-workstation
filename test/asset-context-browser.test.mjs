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
    assert.equal(await page.locator('body').evaluate(n=>n.classList.contains('nw-frame')),true);
    assert.notEqual(await page.locator('#taskButton').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
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

test('task switches clear stale cards on failure and visible tasks refresh without redrawing unchanged assets', {
  skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 60000,
}, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const root = await mkdtemp(path.join(os.tmpdir(), 'asset-refresh-'));
  const token = 'fixture-asset-refresh-token-01234567890123456789';
  const ids = ['00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012'];
  let app, browser, failSecond = false, added = false;
  try {
    await writeFile(path.join(root, 'first.md'), '# First task');
    await writeFile(path.join(root, 'second.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=', 'base64'));
    await writeFile(path.join(root, 'added.md'), '# Newly delivered');
    app = await startAssetServer({ stateRoot: path.join(root, 'state'), token, port: 0,
      taskStore: { view: async () => ({ excludedReferencePaths: [], references: [] }) },
      automatic: { view: async id => {
        if (id === ids[1] && failSecond) throw new Error('fixture lookup failed');
        const names = id === ids[0] ? ['first.md'] : added ? ['second.png', 'added.md'] : ['second.png'];
        return { status: 'ready', references: names.map(name => ({ path: path.join(root, name), relation: 'output' })) };
      } },
    });
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, extraHTTPHeaders: { 'x-asset-console-token': token } });
    page.setDefaultTimeout(5000); await page.clock.install();
    let permissionBlocked = true;
    await page.route('**/media?*', async route => {
      if (permissionBlocked) return route.fulfill({ status: 200, contentType: 'image/svg+xml',
        headers: { 'x-preview-unavailable': '1', 'x-preview-error': 'source_EPERM', 'cache-control': 'no-store' }, body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
      return route.fulfill({ status: 200, contentType: 'image/png', body: await (await import('node:fs/promises')).readFile(path.join(root, 'second.png')) });
    });
    await page.goto(`http://127.0.0.1:${app.server.address().port}/?threadId=${ids[0]}&projectId=fixture-project&threadTitle=First`);
    await page.locator('#taskButton').click(); await page.getByText('first.md', { exact: true }).waitFor();
    failSecond = true;
    await page.evaluate(threadId => window.postMessage({ source: 'codex-sidebar-enhancer', action: 'context', hostId: 'local',
      threadId, threadTitle: 'Second', projectId: 'fixture-project' }, '*'), ids[1]);
    await page.locator('#notice').filter({ hasText: 'fixture lookup failed' }).waitFor();
    assert.equal(await page.locator('#sourceStatus').textContent(), 'Second');
    assert.equal(await page.locator('.asset-card').count(), 0);
    assert.doesNotMatch(await page.locator('#notice').textContent(), /已保留/);
    failSecond = false; await page.locator('#scanButton').click(); await page.getByText('second.png', { exact: true }).waitFor();
    await page.getByText('需要文件夹访问权限', { exact: true }).waitFor();
    await page.locator('.asset-thumb').click();
    await page.locator('#previewStage').filter({ hasText: '需要允许文件夹访问' }).waitFor();
    await page.keyboard.press('Escape');
    permissionBlocked = false; await page.locator('#scanButton').click();
    await page.waitForFunction(() => document.querySelector('.asset-thumb img')?.naturalWidth > 0);
    assert.equal(await page.locator('.thumbnail-status').count(), 0);
    const oldImageUrl = await page.locator('.asset-thumb img').getAttribute('src');
    await page.clock.fastForward(1); await page.locator('#scanButton').click();
    await page.waitForFunction(old => {const img=document.querySelector('.asset-thumb img');return img?.naturalWidth>0 && img.getAttribute('src')!==old;}, oldImageUrl);
    added = true; await page.clock.fastForward(10000); await page.getByText('added.md', { exact: true }).waitFor();
    await page.evaluate(() => { window.fixtureCard = document.querySelector('.asset-card'); });
    const refreshed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/assets');
    await page.clock.fastForward(10000); await refreshed;
    await page.waitForFunction(() => document.querySelector('#assetGrid').getAttribute('aria-busy') === 'false');
    assert.equal(await page.evaluate(() => window.fixtureCard === document.querySelector('.asset-card')), true);
  } finally { await browser?.close(); await app?.close(); await rm(root, { recursive: true, force: true }); }
});
