import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createCapsuleSidebar } from '../nuyoah/workstation/sidebar-capsules.mjs';

const browserOptions = {
  skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE,
  timeout: 60_000,
};

test('capsule sidebar keeps real groups, native identity, scrolling and fallback intact', browserOptions, async (t) => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><style>
      :root{--color-text-primary:#202020;--color-text-secondary:#626262;--color-background-primary-soft:#fff;--color-token-main-surface-primary:#fff;--color-token-bg-primary:#f4f4f4;--color-background-primary-solid:#222;--color-text-primary-solid:#fff}
      @media(prefers-color-scheme:dark){:root{--color-text-primary:#eee;--color-text-secondary:#aaa;--color-background-primary-soft:#292929;--color-token-main-surface-primary:#222;--color-token-bg-primary:#181818;--color-background-primary-solid:#eee;--color-text-primary-solid:#222}}
      *{box-sizing:border-box}body{margin:0;font:14px system-ui;zoom:1.1}aside{width:420px;height:680px;display:flex;flex-direction:column;background:var(--color-token-bg-primary)}
      [data-app-action-sidebar-scroll]{overflow:auto;flex:1;min-height:0}main{position:absolute;left:450px;top:20px}button{font:inherit}
    </style></head><body><aside><div>新聊天</div><div data-app-action-sidebar-scroll><div id="native-root">
      <section data-app-action-sidebar-section data-app-action-sidebar-section-heading="Projects">
        <div data-app-action-sidebar-project-row data-app-action-sidebar-project-id="alpha" data-app-action-sidebar-project-label="项目甲"><button aria-label="在 项目甲 中开始新聊天" onclick="window.created=(window.created||0)+1">新建</button></div>
        <div data-app-action-sidebar-project-row data-app-action-sidebar-project-id="beta" data-app-action-sidebar-project-label="项目乙"></div>
        <button id="native-task">原生对话</button>
      </section></div></div></aside><main><input id="native-draft" value="保留草稿"></main></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.NUYOAH_PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.NUYOAH_PLAYWRIGHT_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => {
      const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      const time = days => { const value = new Date(); value.setHours(12, 0, 0, 0); value.setDate(value.getDate() - days); return value.toISOString(); };
      window.fixture = {
        current: { hostId: 'local', threadId: id(1), projectId: 'alpha' },
        snapshot: { tasks: Array.from({ length: 80 }, (_, index) => ({
          hostId: 'local', threadId: id(index + 1), projectId: 'alpha', projectName: '项目甲',
          title: index === 0 ? '<img src=x onerror=alert(1)>' : `长标题对话 ${index + 1} 用于检查双列和溢出`,
          progress: `摘要 ${index + 1} 保留一行完整信息，不是任务完成凭据`,
          updatedAt: time(index < 5 ? 0 : index < 8 ? 1 : 2), runtimeStatus: index === 2 ? 'running' : 'completed', pinned: index === 3,
        })) }, opens: [], archives: [], archiveAllowed: false,
      };
      window.fixture.snapshot.tasks.push(
        { hostId: 'local', threadId: id(81), projectId: 'beta', projectName: '项目乙', title: '其他项目', progress: '乙摘要', updatedAt: time(0) },
        { hostId: 'remote-fixture', threadId: id(1), projectId: 'alpha', projectName: '远程甲', title: '远程同 ID', updatedAt: time(0), runtimeStatus: 'unknown', statusAvailable: false },
        { hostId: 'local', threadId: id(82), projectId: 'alpha', title: '已归档', archived: true },
        { hostId: 'chatgpt', threadId: id(83), source: 'chatgpt', title: '普通聊天' },
      );
      window.electronBridge = { getInitialSidebarBootstrap: () => ({ globalStateEntries: [
        { key: 'local-projects', value: { alpha: { name: '项目甲' }, beta: { name: '项目乙' } } },
        { key: 'remote-projects', value: [{ id: 'alpha', hostId: 'remote-fixture', label: '远程甲' }] },
      ] }) };
      window.__nuyoahMultiChatNative__ = { hostInfo: hostId => ({ available: hostId === 'local', name: '测试设备' }) };
      window.nativeNode = document.getElementById('native-root');
    });
    await page.evaluate(`window.sidebar = (${createCapsuleSidebar.toString()})({ window,
      readSnapshot: () => window.fixture.snapshot, readCurrent: () => window.fixture.current,
      openTask: task => { window.fixture.opens.push({hostId:task.hostId,threadId:task.threadId}); return true; },
      archiveTask: task => { window.fixture.archives.push({hostId:task.hostId,threadId:task.threadId}); return window.fixture.archiveAllowed; },
    }); window.sidebar.sync();`);
    const root = page.locator('#nuyoah-capsule-sidebar');

    await t.test('all date groups are complete; two columns and one summary line', async () => {
      assert.equal(await root.locator('.nc-card').count(), 80);
      assert.deepEqual(await root.locator('.nc-group-toggle').allTextContents(), ['今天5⌄', '昨天3⌄', '更早72⌄']);
      assert.equal(await root.locator('img').count(), 0);
      const geometry = await root.locator('.nc-grid').first().evaluate(node => ({ columns: getComputedStyle(node).gridTemplateColumns.split(' ').length,
        wrap: getComputedStyle(node.querySelector('.nc-summary')).whiteSpace }));
      assert.deepEqual(geometry, { columns: 2, wrap: 'nowrap' });
      assert.equal(await root.locator('.nc-status').filter({ hasText: '已完成' }).count(), 0);
      assert.equal(await page.locator('#native-root').evaluate(node => node === window.nativeNode), true);
      assert.equal(await page.locator('#native-root').isVisible(), false);
      assert.equal(await page.locator('#native-draft').inputValue(), '保留草稿');
    });

    await t.test('refresh preserves focus, node identity and anchor during inserts', async () => {
      await root.locator('input[aria-label="搜索当前项目的对话"]').focus();
      await page.evaluate(() => {
        const scroller = document.querySelector('[data-app-action-sidebar-scroll]'); scroller.scrollTop = 900;
        const top = scroller.getBoundingClientRect().top + document.querySelector('.nc-toolbar').getBoundingClientRect().height;
        const card = [...document.querySelectorAll('.nc-card')].find(n => n.getBoundingClientRect().bottom > top);
        window.anchorNode = card; window.anchorY = card.getBoundingClientRect().top;
        window.fixture.snapshot.tasks.unshift({ hostId: 'local', threadId: '99999999-0000-4000-8000-000000000099', projectId: 'alpha', projectName: '项目甲', title: '刚加入', updatedAt: new Date().toISOString() });
        window.sidebar.sync();
      });
      assert.equal(await page.evaluate(() => window.anchorNode.isConnected), true);
      assert.ok(await page.evaluate(() => Math.abs(window.anchorNode.getBoundingClientRect().top - window.anchorY) < 2));
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '搜索当前项目的对话');
      await page.evaluate(() => { window.fixture.snapshot.tasks[4].progress = '只改变一条摘要'; window.sidebar.sync(); });
      assert.ok(await page.evaluate(() => Math.abs(window.anchorNode.getBoundingClientRect().top - window.anchorY) < 2));
      assert.ok(await page.evaluate(() => window.sidebar.previewRequests().length <= 32));
    });

    await t.test('project switch restores each scroll position without navigating', async () => {
      const saved = await page.locator('[data-app-action-sidebar-scroll]').evaluate(node => node.scrollTop);
      await root.locator('.nc-more').click();
      assert.ok(Math.abs(await page.locator('[data-app-action-sidebar-scroll]').evaluate(node => node.scrollTop) - saved) < 2);
      await root.locator('.nc-project-option', { hasText: '项目乙' }).click();
      await page.waitForTimeout(40);
      assert.equal(await root.locator('.nc-card').count(), 1);
      assert.equal(await page.evaluate(() => window.fixture.opens.length), 0);
      await root.locator('.nc-tab', { hasText: '项目甲' }).click();
      await page.waitForTimeout(40);
      assert.ok(Math.abs(await page.locator('[data-app-action-sidebar-scroll]').evaluate(node => node.scrollTop) - saved) < 2);
    });

    await t.test('remote identity remains scoped, search and details are keyboard usable', async () => {
      await root.locator('.nc-tab', { hasText: '远程甲' }).click();
      assert.equal(await root.locator('.nc-card').count(), 1);
      await root.locator('.nc-detail-button').click();
      assert.equal(await root.locator('.nc-detail-archive').count(), 0);
      await page.keyboard.press('Escape');
      await root.locator('.nc-open').click();
      assert.deepEqual(await page.evaluate(() => window.fixture.opens.at(-1)), { hostId: 'remote-fixture', threadId: '00000000-0000-4000-8000-000000000001' });
      assert.equal(await page.evaluate(() => window.sidebar.previewRequests().length), 0);
      await root.locator('.nc-tab', { hasText: '项目甲' }).click();
      await root.locator('input[aria-label="搜索当前项目的对话"]').fill('长标题对话 17 ');
      assert.equal(await root.locator('.nc-card').count(), 1);
      await root.locator('.nc-detail-button').click(); assert.equal(await root.locator('.nc-detail').isVisible(), true);
      assert.equal(await root.locator('.nc-detail-archive').count(), 1);
      await page.keyboard.press('Escape'); assert.equal(await root.locator('.nc-detail').isHidden(), true);
      await root.locator('input[aria-label="搜索当前项目的对话"]').fill('');
      await root.locator('.nc-more').click(); await root.locator('input[aria-label="查找项目"]').fill('远程');
      assert.equal(await root.locator('.nc-project-option').count(), 1);
      await page.keyboard.press('Escape'); assert.equal(await root.locator('.nc-picker').isHidden(), true);
      await root.locator('.nc-new').click(); assert.equal(await page.evaluate(() => window.created), 1);
    });

    await t.test('hidden native sidebar still has an archive action with confirmed and failed states', async () => {
      await root.locator('input[aria-label="搜索当前项目的对话"]').fill('长标题对话 17 ');
      await root.locator('.nc-detail-button').click();
      assert.equal(await page.locator('#native-root').isVisible(), false);
      await root.locator('.nc-detail-archive').click();
      assert.equal(await root.locator('.nc-feedback').textContent(), '归档未确认，请刷新后重试');
      assert.equal(await root.locator('.nc-detail-archive').isEnabled(), true);
      await page.evaluate(() => window.fixture.archiveAllowed = true);
      await root.locator('.nc-detail-archive').click();
      assert.equal(await root.locator('.nc-detail').isHidden(), true);
      assert.equal(await root.locator('.nc-feedback').textContent(), '对话已归档');
      assert.deepEqual(await page.evaluate(() => window.fixture.archives), [
        { hostId: 'local', threadId: '00000000-0000-4000-8000-000000000017' },
        { hostId: 'local', threadId: '00000000-0000-4000-8000-000000000017' },
      ]);
      await root.locator('input[aria-label="搜索当前项目的对话"]').fill('');
    });

    await t.test('project and task drags persist order without navigation or date changes', async () => {
      await page.locator('[data-app-action-sidebar-scroll]').evaluate(n => n.scrollTop = 0);
      const initialProjects = await root.locator('.nc-tab[data-project-key]').evaluateAll(nodes => nodes.map(n => n.dataset.projectKey));
      const opens = await page.evaluate(() => window.fixture.opens.length);
      await root.locator('.nc-tab[data-project-key]').nth(0).dragTo(root.locator('.nc-tab[data-project-key]').nth(1), { targetPosition: { x: 55, y: 15 } });
      const nextProjects = await root.locator('.nc-tab[data-project-key]').evaluateAll(nodes => nodes.map(n => n.dataset.projectKey));
      assert.notDeepEqual(initialProjects, nextProjects);
      assert.equal(await page.evaluate(() => window.fixture.opens.length), opens);
      await page.waitForTimeout(400);
      const grid = root.locator('.nc-grid').first();
      const before = await grid.locator('.nc-card').evaluateAll(nodes => nodes.map(n => n.dataset.capsuleTaskKey));
      await grid.locator('.nc-card').nth(0).dragTo(grid.locator('.nc-card').nth(1), { targetPosition: { x: 140, y: 40 } });
      const after = await grid.locator('.nc-card').evaluateAll(nodes => nodes.map(n => n.dataset.capsuleTaskKey));
      assert.equal(after[1], before[0]); assert.equal(after[0], before[1]);
      assert.equal(await page.evaluate(() => window.fixture.opens.length), opens);
      await page.evaluate(() => window.sidebar.sync());
      assert.deepEqual(await grid.locator('.nc-card').evaluateAll(nodes => nodes.map(n => n.dataset.capsuleTaskKey)), after);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nuyoah-workstation:capsule-sidebar-v1')));
      assert.deepEqual(saved.projectOrder, nextProjects);
      assert.deepEqual(saved.projects[JSON.stringify(['local', 'alpha'])].taskOrder.filter(id => after.includes(id)), after);
      await grid.locator('.nc-card').first().dragTo(root.locator('.nc-grid').nth(1).locator('.nc-card').first());
      assert.deepEqual(await grid.locator('.nc-card').evaluateAll(nodes => nodes.map(n => n.dataset.capsuleTaskKey)), after);
      await page.waitForTimeout(400);
      await grid.locator('.nc-open').first().focus(); await page.keyboard.press('Alt+ArrowRight');
      assert.equal(await grid.locator('.nc-card').nth(1).getAttribute('data-capsule-task-key'), after[0]);
      const restoredOrder = await grid.locator('.nc-card').evaluateAll(nodes => nodes.map(n => n.dataset.capsuleTaskKey));
      await page.evaluate(`window.sidebar.destroy(); window.sidebar = (${createCapsuleSidebar.toString()})({window,
        readSnapshot:()=>window.fixture.snapshot,readCurrent:()=>window.fixture.current,
        openTask:task=>{window.fixture.opens.push({hostId:task.hostId,threadId:task.threadId});return true;}
      });window.sidebar.sync();`);
      assert.deepEqual(await root.locator('.nc-grid').first().locator('.nc-card').evaluateAll(nodes => nodes.map(n => n.dataset.capsuleTaskKey)), restoredOrder);
      await root.locator('input[aria-label="搜索当前项目的对话"]').fill('长标题对话');
      const filtered = await root.locator('.nc-grid').first().locator('.nc-card').evaluateAll(nodes => nodes.map(n => n.dataset.capsuleTaskKey));
      await root.locator('.nc-grid').first().locator('.nc-open').first().focus(); await page.keyboard.press('Alt+ArrowRight');
      await root.locator('input[aria-label="搜索当前项目的对话"]').fill('');
      const reordered = await root.locator('.nc-grid').first().locator('.nc-card').evaluateAll(nodes => nodes.map(n => n.dataset.capsuleTaskKey));
      for (const id of restoredOrder.filter(id => !filtered.includes(id))) assert.equal(reordered.indexOf(id), restoredOrder.indexOf(id));
    });

    await t.test('background no-op refresh does not churn DOM; themes and narrow columns follow host', async () => {
      await page.evaluate(() => {
        window.mutations = 0;
        window.observer = new MutationObserver(records => window.mutations += records.filter(r => r.type === 'childList').length);
        window.observer.observe(document.getElementById('nuyoah-capsule-sidebar'), { subtree: true, childList: true });
        for (let i = 0; i < 10; i++) window.sidebar.sync();
      });
      await page.waitForTimeout(30);
      assert.equal(await page.evaluate(() => window.mutations), 0);
      const light = await root.locator('.nc-card').first().evaluate(n => getComputedStyle(n).backgroundColor);
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      const dark = await root.locator('.nc-card').first().evaluate(n => getComputedStyle(n).backgroundColor);
      assert.notEqual(light, dark);
      assert.equal(await root.locator('.nc-card').first().evaluate(n => getComputedStyle(n).transitionDuration), '0s');
      await page.locator('aside').evaluate(n => n.style.width = '280px');
      const size = await root.evaluate(n => ({ width: n.clientWidth, scroll: n.scrollWidth,
        columns: getComputedStyle(n.querySelector('.nc-grid')).gridTemplateColumns.split(' ').length }));
      assert.equal(size.columns, 2); assert.ok(size.scroll <= size.width + 1);
      await page.evaluate(() => {
        document.querySelector('[data-app-action-sidebar-project-id="alpha"]').setAttribute('data-app-action-sidebar-project-label', '非常长的项目名称 nuyoah-codex-workstation');
        window.sidebar.sync();
      });
      const tab = root.locator('.nc-tab[data-project-key]').filter({ hasText: '非常长的项目名称' });
      const label = await tab.evaluate(n => ({ width: n.clientWidth, scroll: n.scrollWidth, wrap: getComputedStyle(n).whiteSpace, ellipsis: getComputedStyle(n).textOverflow }));
      assert.equal(label.wrap, 'nowrap'); assert.notEqual(label.ellipsis, 'ellipsis'); assert.ok(label.scroll <= label.width + 1);
      for (const width of [280, 420, 520]) {
        await page.locator('aside').evaluate((n, w) => n.style.width = `${w}px`, width);
        const layout = await root.evaluate(n => {
          const tabs = n.querySelector('.nc-tabs'), bar = n.querySelector('.nc-countbar');
          const rects = [...tabs.children].map(n => n.getBoundingClientRect());
          const controls = [...bar.children].map(n => n.getBoundingClientRect());
          return { rows: new Set(rects.map(r => Math.round(r.top))).size,
            aligned: Math.max(...controls.map(r => r.top + r.height / 2)) - Math.min(...controls.map(r => r.top + r.height / 2)),
            overflow: n.scrollWidth > n.clientWidth + 1, repeated: !!n.querySelector('.nc-scope'),
            scrollable: tabs.scrollWidth > tabs.clientWidth };
        });
        assert.equal(layout.rows, 1); assert.ok(layout.aligned < 2); assert.equal(layout.overflow, false);
        assert.equal(layout.repeated, false); assert.equal(layout.scrollable, true);
      }
      const scroll = await root.locator('.nc-tabs').evaluate(n => { n.scrollLeft = 100; return n.scrollLeft; });
      await page.evaluate(() => window.sidebar.sync());
      assert.equal(await root.locator('.nc-tabs').evaluate(n => n.scrollLeft), scroll);
    });

    await t.test('native rerender remount and destroy restore exact native nodes', async () => {
      await page.evaluate(() => {
        window.originalScroll = document.querySelector('[data-app-action-sidebar-scroll]');
        window.originalScroll.remove(); window.sidebar.sync();
      });
      assert.equal(await root.count(), 0);
      await page.evaluate(() => { document.querySelector('aside').append(window.originalScroll); window.sidebar.sync(); });
      assert.equal(await root.count(), 1);
      assert.equal(await page.locator('#nuyoah-capsule-sidebar-style').count(), 1);
      await page.evaluate(() => window.sidebar.destroy());
      assert.equal(await root.count(), 0);
      assert.equal(await page.locator('#native-root').isVisible(), true);
      assert.equal(await page.locator('#native-root').evaluate(node => node === window.nativeNode), true);
      assert.equal(await page.locator('[data-nuyoah-capsule-source]').count(), 0);
      assert.equal(await page.locator('#native-draft').inputValue(), '保留草稿');
      await page.evaluate(() => localStorage.setItem('nuyoah-workstation:capsule-sidebar-v1', JSON.stringify({ version: 1, selected: 'restored-after-destroy', projects: {} })));
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nuyoah-workstation:capsule-sidebar-v1')).selected), 'restored-after-destroy');
    });
    await t.test('a failed adapter restores native UI instead of a partial overlay', async () => {
      await page.evaluate(`window.broken = (${createCapsuleSidebar.toString()})({ window,
        readSnapshot: () => { throw new Error('unavailable fixture'); }, readCurrent: () => null, openTask: () => false,
      }); window.broken.sync();`);
      assert.equal(await root.count(), 0);
      assert.equal(await page.locator('#native-root').isVisible(), true);
      assert.equal(await page.locator('#nuyoah-capsule-sidebar-style').count(), 0);
      await page.evaluate(() => window.broken.destroy());
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
});
