import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

// Production map and canvas in an isolated browser. Transport and all task data
// are explicitly fictional; no real conversation is read or changed.
const root = new URL('../', import.meta.url);
const identity = (threadId, hostId = 'local') => JSON.stringify([hostId, threadId]);
async function fixtureHTML() {
  const sources = await Promise.all(['nuyoah/workstation/work-canvas.js', 'nuyoah/workstation/task-map-ui.js'].map(file => readFile(new URL(file, root), 'utf8')));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>任务画布操作隔离验收</title><style>
    *{box-sizing:border-box}body{margin:0;padding:16px;font:16px/1.5 system-ui,sans-serif;color:#252b28;background:#f5f5f2;--color-token-bg-primary:#fff}body[data-theme=dark]{color:#ededed;background:#191d1b;--color-token-bg-primary:#262c28;color-scheme:dark}.fixture-notice{font-size:13px;margin-bottom:14px}.fixture-panel{height:900px;width:420px;max-width:100%;margin:auto;padding:12px;border:1px solid #8885;background:var(--color-token-bg-primary)}
  </style></head><body><div class="fixture-notice">虚构任务 · 隔离浏览器验收 · 所有操作回执来自测试替身</div><main class="fixture-panel"></main><script>
    window.fixtureTasks=[{hostId:'local',threadId:'main',title:'示例：改进任务画布',runtimeStatus:'running',projectId:'sample'},{hostId:'local',threadId:'child',title:'示例：检查操作回执',runtimeStatus:'running',projectId:'sample'},{hostId:'local',threadId:'other',title:'示例：补充界面检查',runtimeStatus:'completed',projectId:'sample'},{hostId:'remote',threadId:'child',title:'示例：远程只读任务',runtimeStatus:'unknown',projectId:'sample'}];
    window.fixtureInspected=[];window.fixtureExecuted=[];window.fixtureOpened=[];window.fixturePending=new Map();
    window.__nuyoahTaskActions__={inspect:async target=>{window.fixtureInspected.push(target);return {available:target.hostId==='local',target:{...target,title:window.fixtureTasks.find(task=>task.hostId===target.hostId&&task.threadId===target.threadId).title},running:true,canSend:true,canCreate:true,parent:target.threadId==='child'?{hostId:'local',threadId:'main',title:'示例：改进任务画布'}:null,resultText:target.threadId==='child'?'示例检查结果：已检查三种回执。':null};},execute:request=>{window.fixtureExecuted.push(request);return new Promise(resolve=>window.fixturePending.set(request.id,resolve));}};
    ${sources.join('\n').replaceAll('</script', '<\\/script')}
    window.fixtureOptions={context:{hostId:'local',threadId:'main',projectId:'sample',threadTitle:'示例：改进任务画布'},tasks:window.fixtureTasks,openTask:target=>{window.fixtureOpened.push(target);return true;}};
    window.fixtureData={status:'ready',nodes:[{hostId:'local',threadId:'unknown',title:'示例：待同步任务',resolved:false,runtimeStatus:'unknown'}],edges:[...['child','other','unknown'].map(threadId=>({from:{hostId:'local',threadId:'main'},to:{hostId:'local',threadId},kind:'parent'})),{from:{hostId:'local',threadId:'main'},to:{hostId:'remote',threadId:'child'},kind:'related'}]};
    window.fixtureDrain=()=>{const request=window.__nuyoahTaskMapUI__.takeRequest();if(request)window.__nuyoahTaskMapUI__.receive({id:request.id,data:window.fixtureData});};
    window.fixtureRender=()=>{window.__nuyoahTaskMapUI__.mount(document.querySelector('main'),window.fixtureOptions);window.fixtureDrain();};
    window.fixtureResolve=result=>{const request=window.fixtureExecuted.at(-1);window.fixturePending.get(request.id)(result);};window.fixtureRender();
  </script></body></html>`;
}

test('task actions browser journey preserves focus, targets and truthful receipts across real interactions', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const html = await fixtureHTML(), server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html); });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 1150 } }), errors = []; page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const map = page.locator('.nuyoah-task-map'), canvas = map.locator('.nuyoah-work-canvas'), panel = map.getByRole('region', { name: '选中任务操作' });
    const node = (id, host = 'local') => canvas.locator(`button[data-node-id='${identity(id, host)}']`);
    const select = async (id, host) => { const close = map.getByRole('button', { name: '收起操作', exact: true }); if (await close.isVisible()) await close.click(); await canvas.getByRole('button', { name: '适应全部节点', exact: true }).click(); await node(id, host).click(); };
    const text = map.getByRole('textbox', { name: '任务操作内容' });
    const action = async label => { const back = map.getByRole('button', { name: '返回任务详情', exact: true }); if (await back.isVisible()) await back.click(); await map.getByRole('button', { name: label, exact: true }).click(); };
    const sendDraft = async value => { if (!await text.isVisible()) await action('补充要求'); await text.fill(value); };
    const receipt = map.locator('.nuyoah-task-map-action-status');
    const resolve = async result => { await page.evaluate(result => window.fixtureResolve(result), result); };
    assert.equal(await panel.isVisible(), false); assert.equal(await page.evaluate(() => window.fixtureInspected.length), 0);
    await select('child'); await sendDraft('把边界情况一起检查');
    assert.equal(await page.evaluate(() => window.fixtureOpened.length), 0); assert.equal(await page.evaluate(() => window.fixtureExecuted.length), 0);
    assert.match(await panel.textContent(), /示例：检查操作回执/); assert.equal(await node('child').getAttribute('data-selected'), 'true');
    await text.evaluate(node => { node.focus(); node.setSelectionRange(3, 6); window.fixtureInput = node; });
    await page.evaluate(() => { window.fixtureRender(); window.__nuyoahTaskMapUI__.refreshLive(); });
    assert.deepEqual(await text.evaluate(node => [node === window.fixtureInput, document.activeElement === node, node.selectionStart, node.selectionEnd]), [true, true, 3, 6]);
    assert.equal(await text.inputValue(), '把边界情况一起检查'); assert.equal(await page.evaluate(() => window.fixtureInspected.length), 1);
    await select('other'); await sendDraft('其他任务独立草稿'); await select('child'); await action('补充要求'); assert.equal(await text.inputValue(), '把边界情况一起检查');
    await map.getByRole('button', { name: '发送补充要求', exact: true }).click();
    assert.equal(await receipt.getAttribute('data-status'), 'pending'); assert.equal(await map.getByRole('button', { name: '正在处理…', exact: true }).isDisabled(), true);
    assert.equal(await map.locator('.nuyoah-task-map-action-choices button').filter({ hasText: '拆出子任务' }).isDisabled(), true);
    await page.addScriptTag({ content: await readFile(new URL('nuyoah/workstation/task-map-ui.js', root), 'utf8') }); await page.evaluate(() => window.fixtureRender()); await select('child');
    assert.equal(await receipt.getAttribute('data-status'), 'pending'); assert.equal(await text.inputValue(), '把边界情况一起检查');
    await select('other'); await action('补充要求'); assert.equal(await text.inputValue(), '其他任务独立草稿');
    await resolve({ status: 'succeeded', message: '补充要求已送达。' }); assert.equal(await text.inputValue(), '其他任务独立草稿'); assert.notEqual(await receipt.textContent(), '补充要求已送达。');
    assert.deepEqual(await page.evaluate(() => window.fixtureExecuted[0].target), { hostId: 'local', threadId: 'child' });
    await select('child'); await action('补充要求'); assert.equal(await text.inputValue(), ''); assert.equal(await receipt.textContent(), '补充要求已送达。');
    await action('交给主任务继续'); assert.match(await text.inputValue(), /示例检查结果/);
    await sendDraft('检查结果已整理，请主任务继续整合。'); await map.getByRole('button', { name: '发送给主任务', exact: true }).click(); await resolve({ status: 'unknown' });
    assert.deepEqual(await page.evaluate(() => window.fixtureExecuted.at(-1).expectedParent), { hostId: 'local', threadId: 'main' });
    assert.equal(await receipt.getAttribute('data-status'), 'unknown'); assert.equal(await map.getByRole('button', { name: '发送给主任务', exact: true }).isDisabled(), true);
    await map.getByRole('button', { name: '打开对话核对', exact: true }).click(); assert.equal(await page.evaluate(() => window.fixtureOpened.at(-1).threadId), 'main');
    await page.addScriptTag({ content: await readFile(new URL('nuyoah/workstation/task-map-ui.js', root), 'utf8') }); await page.evaluate(() => window.fixtureRender());
    await select('other'); await select('child'); assert.equal(await map.getByRole('button', { name: '发送给主任务', exact: true }).isDisabled(), true); assert.equal(await text.inputValue(), '检查结果已整理，请主任务继续整合。');
    await select('main'); await action('拆出子任务'); await sendDraft('独立检查窄面板下的键盘操作'); await map.getByRole('textbox', { name: '子任务名称（可选）', exact: true }).fill('键盘操作检查');
    await map.getByRole('button', { name: '创建子任务', exact: true }).click(); await resolve({ status: 'failed', message: '子任务未创建，请重试。' }); assert.equal(await text.inputValue(), '独立检查窄面板下的键盘操作');
    await map.getByRole('button', { name: '创建子任务', exact: true }).focus(); await page.keyboard.press('Enter'); await resolve({ status: 'succeeded', message: '子任务已创建。', child: { hostId: 'local', threadId: 'new', title: '示例：键盘操作检查' } });
    await map.getByRole('button', { name: '打开子任务', exact: true }).click(); assert.equal(await page.evaluate(() => window.fixtureOpened.at(-1).threadId), 'new');
    await select('child', 'remote'); assert.match(await receipt.textContent(), /暂时无法操作/); await sendDraft('不可发送的草稿'); assert.equal(await map.getByRole('button', { name: '发送补充要求', exact: true }).isDisabled(), true);
    await select('unknown'); await action('补充要求'); assert.equal(await map.getByRole('button', { name: '打开完整对话', exact: true }).isDisabled(), true); assert.equal(await map.getByRole('button', { name: '发送补充要求', exact: true }).isDisabled(), true);
    // Dragging and arranging are layout-only actions, even with an operation panel open.
    const before = await page.evaluate(() => [window.fixtureExecuted.length, window.fixtureInspected.length]);
    await map.getByRole('button', { name: '收起操作', exact: true }).click();
    await canvas.getByRole('button', { name: '适应全部节点', exact: true }).click(); const box = await node('main').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 12, { steps: 4 }); await page.mouse.up();
    await canvas.getByRole('button', { name: '整理节点布局', exact: true }).click(); assert.deepEqual(await page.evaluate(() => [window.fixtureExecuted.length, window.fixtureInspected.length]), before);
    await select('other'); await sendDraft('主题和缩放后继续编辑');
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width: 450, height: 980 }); await page.evaluate(theme => document.body.dataset.theme = theme, theme);
      const geometry = await map.evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth })); assert.ok(geometry.width >= 380 && geometry.scroll <= geometry.width + 1);
      await text.focus(); await page.keyboard.press('End'); await page.keyboard.type('。'); await page.evaluate(() => window.fixtureRender()); assert.equal(await text.evaluate(node => document.activeElement === node), true);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await node('main').evaluate(node => getComputedStyle(node).animationName), 'none');
    assert.equal(await page.evaluate(() => [...Object.values(sessionStorage), ...Object.values(localStorage)].some(value => /主题和缩放|边界情况|不可发送/.test(value))), false);
    assert.deepEqual(errors, []);
    if (process.env.NUYOAH_TASK_ACTIONS_SCREENSHOT) { await mkdir(path.dirname(process.env.NUYOAH_TASK_ACTIONS_SCREENSHOT), { recursive: true }); await page.screenshot({ path: process.env.NUYOAH_TASK_ACTIONS_SCREENSHOT, fullPage: true }); }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});

test('calm map keeps its canvas in view and uses responsive inspectors with keyboard returns', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const html = await fixtureHTML(), server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html); });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    for (const width of [320, 420, 760, 1024]) {
      const page = await browser.newPage({ viewport: { width: width + 40, height: 940 } }); page.setDefaultTimeout(5000);
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator('.fixture-panel').evaluate((node, width) => { Object.assign(node.style, { width: `${width}px`, padding: '0', height: '760px', boxSizing: 'content-box' }); }, width);
      const map = page.locator('.nuyoah-task-map'), canvas = map.locator('.nuyoah-work-canvas');
      const inspector = map.getByRole('region', { name: '选中任务操作' }), text = map.getByRole('textbox', { name: '任务操作内容' });
      const geometry = () => map.evaluate(root => { const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }; return { width: root.clientWidth, scroll: root.scrollWidth, canvas: rect(root.querySelector('.nuyoah-work-canvas-viewport')), inspector: rect(root.querySelector('.nuyoah-task-map-actions')), toolbar: rect(root.querySelector('.nuyoah-work-canvas-toolbar')) }; });
      assert.equal(await text.isVisible(), false); assert.equal(await map.getByRole('searchbox').isVisible(), false);
      const before = await geometry(); assert.ok(before.scroll <= before.width + 1);
      assert.ok(before.toolbar.bottom < before.canvas.bottom && before.toolbar.top > before.canvas.top + 400);
      assert.equal(await canvas.locator('.nuyoah-work-canvas-viewport').evaluate(node => getComputedStyle(node).backgroundImage), 'none');
      await canvas.getByRole('button', { name: '适应全部节点', exact: true }).click();
      const card = canvas.locator(`button[data-node-id='${identity('child')}']`); await card.click();
      assert.equal(await inspector.isVisible(), true); assert.equal(await text.isVisible(), false);
      const selected = await geometry(); assert.equal(selected.canvas.top, before.canvas.top); assert.equal(selected.canvas.bottom, before.canvas.bottom);
      if (width >= 700) assert.ok(selected.inspector.left >= selected.canvas.right);
      else assert.ok(selected.inspector.top > selected.canvas.top && selected.inspector.bottom < selected.canvas.bottom);
      await map.getByRole('button', { name: '补充要求', exact: true }).click(); await text.fill(`宽度 ${width} 的独立草稿`);
      assert.equal(await text.evaluate(node => document.activeElement === node), true);
      assert.ok((await geometry()).scroll <= before.width + 1);
      if (width < 700) { const cardBox = await card.boundingBox(), formBox = await inspector.boundingBox(); assert.ok(cardBox.y + cardBox.height < formBox.y, 'the selected card stays above the bottom inspector'); }
      await page.keyboard.press('Escape'); assert.equal(await text.isVisible(), false); assert.equal(await inspector.isVisible(), true);
      assert.equal(await map.getByRole('button', { name: '补充要求', exact: true }).evaluate(node => document.activeElement === node), true);
      await page.keyboard.press('Escape'); assert.equal(await inspector.isVisible(), false); assert.equal(await card.evaluate(node => document.activeElement === node), true);
      await card.click(); await map.getByRole('button', { name: '补充要求', exact: true }).click(); assert.equal(await text.inputValue(), `宽度 ${width} 的独立草稿`);
      await map.getByRole('button', { name: '收起操作', exact: true }).click();
      for (const label of ['查找任务', '地图选项']) {
        const trigger = map.getByRole('button', { name: label, exact: true }); await trigger.click(); assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Escape'); assert.equal(await trigger.getAttribute('aria-expanded'), 'false'); assert.equal(await trigger.evaluate(node => document.activeElement === node), true);
      }
      await page.evaluate(() => document.body.dataset.theme = 'dark'); await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await card.evaluate(node => getComputedStyle(node).animationName), 'none');
      assert.equal(await page.evaluate(() => window.fixtureExecuted.length), 0); await page.close();
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
