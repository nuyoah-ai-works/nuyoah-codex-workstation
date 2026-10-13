import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createMultiChatUI } from '../nuyoah/workstation/multi-chat-ui.mjs';

// Fictional native adapter: checks layout and lifecycle, not host compatibility.
const ids = Array.from({ length: 4 }, (_, i) => '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
function html({ remote = false } = {}) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    body{margin:0;font:14px system-ui}header{height:40px;display:flex;gap:10px}main{position:absolute;left:180px;right:0;top:40px;bottom:0;background:Canvas;color:CanvasText}aside{position:absolute;left:0;top:40px;width:180px}textarea{width:100%;height:44px}.sample-scroll{overflow:auto;flex:1;min-height:0}.sample-native{height:100%;display:flex;flex-direction:column;overflow:hidden}html[data-theme=dark]{color-scheme:dark}
  </style></head><body><header><button id="nuyoah-workstation-entry">工作站</button></header><aside>隔离验收 · 虚构任务</aside><main data-app-shell-main-content-layout><div id="original"><textarea aria-label="原生草稿">保留的原生草稿</textarea></div></main><script>
    window.tasks=${JSON.stringify(ids.map((threadId, i) => ({ hostId: 'local', threadId, title: '示例对话 ' + (i + 1) })))};
    if(${remote})tasks.push({hostId:'remote-fixture',threadId:tasks[0].threadId,title:'远程同ID示例',hostName:'验证 Mac'},{hostId:'remote-fixture',threadId:tasks[1].threadId,title:'远程离线示例',hostName:'验证 Mac'});
    window.remoteAvailable=true;
    window.current=tasks[0];window.mounts=[];window.disposals=[];window.sent=[];window.pending=[];window.shouldDelay=false;window.captures=0;window.paneCallbacks=new Map();
    window.__nuyoahRemoteTaskCatalog__={snapshot:()=>tasks};
    window.__codexConversationPreviewInjection__={openMultiChatTask:t=>{window.current=t;return true}};
    window.adapter={readTaskMetadata:async target=>({hostId:target.hostId,threadId:target.threadId,cwd:'/synthetic/created-folder'}),newTarget:()=>({hostId:'local',clientThreadId:'client-new-thread:'+crypto.randomUUID(),title:'新会话'}),current:()=>{window.captures++;return window.current},prepare:async()=>{},mount:async(container,target,callbacks)=>{
      paneCallbacks.set(target.clientThreadId||target.threadId,callbacks);
      if(target.hostId!=='local'&&(!remoteAvailable||!tasks.some(t=>t.hostId===target.hostId)))throw Object.assign(new Error('Fixture device unavailable'),{code:'remote_unavailable'});
      const mount=()=>{const el=document.createElement('div');el.className='sample-native';const scroll=document.createElement('div');scroll.className='sample-scroll';for(let i=0;i<50;i++){const p=document.createElement('p');p.textContent='示例消息 '+i;scroll.append(p)}const input=document.createElement('textarea');input.setAttribute('aria-label','草稿 '+target.threadId);input.addEventListener('pointerdown',()=>input.focus(),true);const send=document.createElement('button');send.textContent='发送';send.onclick=()=>sent.push({target,text:input.value});el.append(scroll,input,send);container.append(el);mounts.push(target.threadId);callbacks.onReady();return{dispose(){disposals.push(target.threadId);container.replaceChildren()}}};
      if(window.shouldDelay)return new Promise(resolve=>pending.push(()=>resolve(mount())));return mount();
    },hostInfo:id=>({known:id==='local'||tasks.some(t=>t.hostId===id),available:id==='local'||remoteAvailable,name:id==='local'?'本机':'验证 Mac'})};
    window.ui=(${createMultiChatUI.toString()})({window,adapter});
  </script></body></html>`;
}
test('each pane opens its own native draft, workstation selection targets the active pane and creation retains its editor', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 60000 }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html()); }); let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }); page.setDefaultTimeout(5000);
    await page.goto('http://127.0.0.1:' + server.address().port); await page.evaluate(() => ui.open());
    await page.waitForFunction(() => ui.snapshot().slots[0].loaded);
    await page.locator('[data-slot="0"] textarea').fill('原任务草稿');
    for (const index of [1, 2, 3]) {
      await page.getByRole('button', { name: '区域 ' + (index + 1) + ' 新建会话', exact: true }).click();
      await page.waitForFunction(index => ui.snapshot().slots[index].loaded, index);
      await page.locator('[data-slot="' + index + '"] textarea').fill('新会话草稿 ' + index);
    }
    const drafts = await page.evaluate(() => ui.snapshot().slots.slice(1).map(s => s.target.clientThreadId));
    assert.equal(new Set(drafts).size, 3); assert.equal(await page.evaluate(() => sent.length), 0);
    await page.evaluate(() => paneCallbacks.get(ui.snapshot().slots[1].target.clientThreadId).onModel({ model: 'fixture-model', reasoningEffort: 'high' }));
    assert.equal(await page.evaluate(() => ui.snapshot().slots[1].target.model), 'fixture-model');
    assert.equal(await page.evaluate(() => ui.snapshot().slots[2].target.model), undefined);
    assert.equal(await page.locator('[data-slot="0"] textarea').inputValue(), '原任务草稿');
    await page.evaluate(() => { ui.swap(1, 3); ui.activate(3); });
    assert.equal(await page.locator('[data-slot="3"] textarea').inputValue(), '新会话草稿 1');
    const mounts = await page.evaluate(() => window.mounts.length);
    await page.evaluate(() => paneCallbacks.get(ui.currentTarget().clientThreadId).onFolder({hostId:'local',projectId:'created',cwd:'/synthetic/created-folder'}));
    await page.evaluate(() => { paneCallbacks.get(ui.currentTarget().clientThreadId).onSubmitting(true); window.current=tasks[1]; ui.sync(); });
    assert.equal(await page.evaluate(() => ui.snapshot().slots[3].target.clientThreadId), drafts[0]);
    await page.evaluate(id => { const cb=paneCallbacks.get(ui.currentTarget().clientThreadId); cb.onFolder(null);
      cb.onTarget({ hostId: 'local', threadId: id, selectedCwd: '/synthetic/created-folder' }); }, ids[1]);
    await page.locator('[data-slot="3"] .nuyoah-chat-grid-slot-status').filter({ hasText: '工作目录已核实' }).waitFor();
    assert.equal(await page.evaluate(() => window.mounts.length), mounts);
    assert.equal(await page.evaluate(() => ui.currentTarget().threadId), ids[1]);
    assert.equal(await page.locator('[data-slot="3"] textarea').inputValue(), '新会话草稿 1');
    await page.evaluate(() => { ui.activate(2); ui.selectTask(tasks[2]); });
    await page.waitForFunction(id => ui.snapshot().slots[2].target.threadId === id && ui.snapshot().slots[2].loaded, ids[2]);
    assert.equal(await page.locator('[data-slot="3"] textarea').inputValue(), '新会话草稿 1');
    await page.evaluate(id => paneCallbacks.get(id).onTarget({ hostId: 'local', threadId: tasks[3].threadId }), drafts[1]);
    assert.equal(await page.evaluate(() => ui.snapshot().slots[2].target.threadId), ids[2]);
    await page.evaluate(ids => { paneCallbacks.get(ids[1]).onFolder({hostId:'local',projectId:'stale',cwd:'/synthetic/stale-folder'}); paneCallbacks.get(ids[2]).onFolder({hostId:'local',projectId:'selected',cwd:'/synthetic/selected-folder'}); }, drafts);
    assert.equal(await page.evaluate(() => ui.snapshot().slots[2].target.cwd), undefined);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nuyoah:chat-grid-layout-v1')));
    assert.equal(saved.targets[1].clientThreadId, drafts[2]); assert.equal(JSON.stringify(saved).includes('草稿'), false);
    assert.equal(saved.targets[1].cwd, '/synthetic/selected-folder');
    assert.equal(saved.targets[1].projectId, 'selected');
    await page.reload(); await page.waitForFunction(() => ui.snapshot().slots.every(s => s.loaded));
    assert.equal(await page.evaluate(() => ui.snapshot().slots[1].target.clientThreadId), drafts[2]);
    assert.equal(await page.evaluate(() => ui.snapshot().slots[1].target.cwd), '/synthetic/selected-folder');
    assert.equal(await page.evaluate(() => ui.snapshot().slots[1].target.projectId), 'selected');
    await page.evaluate(() => paneCallbacks.get(ui.snapshot().slots[1].target.clientThreadId).onModel({ model: 'fixture-model-2', reasoningEffort: 'medium' }));
    await page.reload(); await page.waitForFunction(() => ui.snapshot().slots.every(s => s.loaded));
    assert.equal(await page.evaluate(() => ui.snapshot().slots[1].target.model), 'fixture-model-2');
    assert.equal(await page.evaluate(() => ui.snapshot().slots[1].target.reasoningEffort), 'medium');
    await page.evaluate(() => { adapter.readTaskMetadata=async target=>({hostId:target.hostId,threadId:target.threadId,cwd:'/synthetic/wrong-folder'});
      paneCallbacks.get(ui.snapshot().slots[1].target.clientThreadId).onTarget({hostId:'local',threadId:tasks[3].threadId}); });
    await page.locator('[data-slot="1"] .nuyoah-chat-grid-slot-status').filter({ hasText: '实际工作目录与所选文件夹不一致' }).waitFor();
    await page.evaluate(() => ui.bind(1,null));
    assert.equal(await page.locator('[data-slot="1"]').getAttribute('data-cwd-verified'), null);
    await page.evaluate(async () => {
      await ui.newChat(1); const callback=paneCallbacks.get(ui.currentTarget().clientThreadId);
      callback.onFolder({hostId:'local',projectId:'created',cwd:'/synthetic/created-folder'});
      adapter.readTaskMetadata=async target=>({...target,threadId:tasks[0].threadId,cwd:'/synthetic/created-folder'});
      callback.onTarget({hostId:'local',threadId:tasks[3].threadId});
    });
    await page.locator('[data-slot="1"] .nuyoah-chat-grid-slot-status').filter({ hasText: '工作目录暂未核实' }).waitFor();
    await page.evaluate(() => adapter.readTaskMetadata=async target=>({...target,cwd:'/synthetic/created-folder'}));
    await page.locator('[data-slot="1"]').getByRole('button', { name: '重试', exact: true }).click();
    await page.locator('[data-slot="1"] .nuyoah-chat-grid-slot-status').filter({ hasText: '工作目录已核实' }).waitFor();
    await page.evaluate(async () => {
      await ui.newChat(1); const callback=paneCallbacks.get(ui.currentTarget().clientThreadId);
      callback.onFolder({hostId:'local',projectId:'created',cwd:'/synthetic/created-folder'});
      adapter.readTaskMetadata=target=>new Promise(resolve=>window.finishDirectoryCheck=()=>resolve({...target,cwd:'/synthetic/created-folder'}));
      callback.onTarget({hostId:'local',threadId:tasks[3].threadId});
      await ui.newChat(1); finishDirectoryCheck();
    });
    assert.equal(await page.locator('[data-slot="1"]').getAttribute('data-cwd-verified'), null);
    assert.equal(await page.locator('[data-slot="1"] .nuyoah-chat-grid-slot-status').textContent(), '');
    assert.equal(await page.evaluate(() => sent.length), 0);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
test('four-chat layout preserves independent content, focus, targets and roots through resizing and restoration', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html()); });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(5000);
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.getByRole('button', { name: '四宫格', exact: true }).click();
    await page.waitForFunction(() => ui.snapshot().slots[0].loaded);
    for (let i = 1; i < 4; i++) await page.getByRole('combobox', { name: '区域 ' + (i + 1) + ' 的对话', exact: true }).selectOption(ids[i]);
    await page.waitForFunction(() => ui.snapshot().slots.every(s => s.loaded));
    const slots = page.locator('.nuyoah-chat-grid-slot');
    for (let i = 0; i < 4; i++) { await slots.nth(i).getByRole('textbox').click(); await slots.nth(i).getByRole('textbox').fill('独立草稿 ' + i); }
    await slots.nth(1).getByRole('textbox').evaluate(el => el.focus());
    assert.equal(await page.evaluate(() => ui.snapshot().active), 3);
    await slots.nth(1).getByRole('textbox').click();
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForFunction(() => document.activeElement.closest('[data-slot]')?.dataset.slot === '1');
    await slots.nth(1).locator('.sample-scroll').evaluate(el => el.scrollTop = 220);
    const before = await slots.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()));
    const center = page.getByRole('separator', { name: '调整四格比例', exact: true }), rect = await center.boundingBox();
    await page.mouse.move(rect.x + 5, rect.y + 5); await page.mouse.down(); await page.mouse.move(rect.x + 160, rect.y + 100); await page.mouse.up();
    const after = await slots.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()));
    assert.ok(after[0].width > before[0].width + 100); assert.ok(after[0].height > before[0].height + 60);
    assert.ok(after[3].width < before[3].width); assert.ok(after[3].height < before[3].height);
    assert.equal(await page.evaluate(() => mounts.length), 4);
    assert.equal(await slots.nth(1).locator('.sample-scroll').evaluate(el => el.scrollTop), 220);
    for (let i = 0; i < 4; i++) { assert.equal(await slots.nth(i).getByRole('textbox').inputValue(), '独立草稿 ' + i); await slots.nth(i).getByRole('button', { name: '发送', exact: true }).click(); }
    assert.deepEqual(await page.evaluate(() => sent.map(s => [s.target.threadId, s.text])), ids.map((id, i) => [id, '独立草稿 ' + i]));
    await slots.nth(2).getByRole('button', { name: '放大', exact: true }).click(); assert.ok((await slots.nth(2).boundingBox()).height > (await slots.nth(0).boundingBox()).height);
    await slots.nth(2).getByRole('button', { name: '恢复', exact: true }).click();
    const x = await page.getByRole('separator', { name: '调整左右对话宽度', exact: true }).getAttribute('aria-valuenow');
    await page.getByRole('separator', { name: '调整左右对话宽度', exact: true }).focus(); await page.keyboard.press('ArrowLeft');
    assert.ok(Number(await page.getByRole('separator', { name: '调整左右对话宽度', exact: true }).getAttribute('aria-valuenow')) < Number(x));
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await page.getByRole('button', { name: '恢复等分', exact: true }).click();
    await page.getByRole('button', { name: '返回单聊', exact: true }).click();
    assert.equal(await page.locator('#nuyoah-chat-grid').count(), 0);
    assert.equal(await page.getByRole('textbox', { name: '原生草稿' }).inputValue(), '保留的原生草稿');
    assert.equal(await page.locator('#original').evaluate(el => el.inert), false);
    assert.equal(await page.evaluate(() => disposals.length), 4);
    await page.evaluate(() => ui.destroy()); assert.equal(await page.locator('#nuyoah-chat-layout-entry').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});

test('mixed local and remote slots preserve host identity, drafts, swapping, persistence and offline retry', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 90000 }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html({ remote: true })); }); let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }); page.setDefaultTimeout(5000);
    await page.goto('http://127.0.0.1:' + server.address().port); await page.evaluate(() => ui.open());
    await page.waitForFunction(() => ui.snapshot().slots[0].loaded);
    await page.getByRole('combobox', { name: '区域 2 的对话', exact: true }).selectOption(JSON.stringify(['remote-fixture', ids[0]]));
    await page.waitForFunction(() => ui.snapshot().slots[1].loaded);
    assert.deepEqual(await page.evaluate(() => ui.snapshot().slots.slice(0, 2).map(s => s.target.hostId)), ['local', 'remote-fixture']);
    await page.locator('[data-slot="0"] textarea').fill('本机草稿'); await page.locator('[data-slot="1"] textarea').fill('远程草稿');
    await page.evaluate(() => ui.swap(0, 1));
    assert.equal(await page.locator('[data-slot="0"] textarea').inputValue(), '远程草稿'); assert.equal(await page.locator('[data-slot="1"] textarea').inputValue(), '本机草稿');
    for (const index of [0, 1]) await page.locator('[data-slot="' + index + '"]').getByRole('button', { name: '发送', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => sent.map(s => [s.target.hostId, s.text])), [['remote-fixture', '远程草稿'], ['local', '本机草稿']]);
    assert.equal(await page.evaluate(() => mounts.length), 2);
    await page.reload(); await page.waitForFunction(() => ui.snapshot().slots.length === 4 && ui.snapshot().slots[0].loaded && ui.snapshot().slots[1].loaded);
    assert.deepEqual(await page.evaluate(() => ui.snapshot().slots.slice(0, 2).map(s => s.target.hostId)), ['remote-fixture', 'local']);
    await page.evaluate(() => { remoteAvailable = false; void ui.bind(2, tasks.at(-1), { select: false }); });
    await page.locator('[data-slot="2"]').getByRole('button', { name: '重试', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => ui.isOpen()), true); assert.equal(await page.evaluate(() => ui.snapshot().slots[1].loaded), true);
    await page.evaluate(() => remoteAvailable = true); await page.locator('[data-slot="2"]').getByRole('button', { name: '重试', exact: true }).click();
    await page.waitForFunction(() => ui.snapshot().slots[2].loaded); assert.equal(await page.evaluate(() => ui.snapshot().slots[2].target.hostId), 'remote-fixture');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nuyoah:chat-grid-layout-v1')));
    assert.equal(saved.targets[0].hostId, 'remote-fixture'); assert.equal(JSON.stringify(saved).includes('草稿'), false);
    await page.evaluate(id => {
      const row = document.createElement('div'); row.setAttribute('data-app-action-sidebar-thread-id', 'local:' + id);
      row.setAttribute('data-app-action-sidebar-thread-host-id', 'remote-fixture'); row.setAttribute('data-app-action-sidebar-thread-title', '原生远程行'); document.querySelector('aside').append(row); ui.sync();
    }, ids[2]);
    await page.getByRole('combobox', { name: '区域 4 的对话', exact: true }).selectOption(JSON.stringify(['remote-fixture', ids[2]]));
    await page.waitForFunction(() => ui.snapshot().slots[3].loaded); assert.equal(await page.evaluate(() => ui.snapshot().slots[3].target.threadId), ids[2]);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});

test('resize bursts avoid native capture per event and unchanged geometry performs no repeated DOM writes', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 60000 }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html()); }); let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }); page.setDefaultTimeout(5000);
    await page.goto('http://127.0.0.1:' + server.address().port); await page.evaluate(() => ui.open());
    await page.waitForFunction(() => ui.snapshot().slots[0].loaded); await page.waitForTimeout(250);
    const immediate = await page.evaluate(() => { captures = 0; for (let i = 0; i < 500; i++) window.dispatchEvent(new Event('resize')); return captures; });
    assert.equal(immediate, 0); await page.waitForTimeout(200); assert.ok(await page.evaluate(() => captures < 10));
    await page.evaluate(() => {
      window.gridWrites = 0; window.qaObserver = new MutationObserver(records => gridWrites += records.length);
      qaObserver.observe(document.getElementById('nuyoah-chat-grid'), { attributes: true, subtree: true });
      for (let i = 0; i < 50; i++) ui.sync();
    });
    await page.waitForTimeout(60); assert.equal(await page.evaluate(() => gridWrites), 0);
    for (const width of [1200, 1500, 1300, 1600]) await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    const fit = await page.evaluate(() => { const g = document.getElementById('nuyoah-chat-grid').getBoundingClientRect(), s = document.querySelector('main').getBoundingClientRect(); return { left: g.left, width: g.width, expectedLeft: s.left, expectedWidth: s.width, mounts: mounts.length, disposals: disposals.length }; });
    assert.equal(fit.left, fit.expectedLeft); assert.equal(fit.width, fit.expectedWidth); assert.equal(fit.mounts, 1); assert.equal(fit.disposals, 0);
    await page.evaluate(() => { qaObserver.disconnect(); window.dispatchEvent(new Event('resize')); ui.destroy(); });
    await page.waitForTimeout(180); assert.equal(await page.locator('#nuyoah-chat-grid').count(), 0);
    assert.equal(await page.locator('main').evaluate(e => e.inert), false);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
test('stale mounts, native errors and small windows restore the original conversation', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 120000 }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html()); }); let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }); page.setDefaultTimeout(5000);
    await page.goto('http://127.0.0.1:' + server.address().port); await page.evaluate(() => ui.open());
    await page.waitForFunction(() => ui.snapshot().slots[0].loaded);
    await page.evaluate(id => { shouldDelay = true; void ui.bind(1, tasks.find(t => t.threadId === id), { select: false }); }, ids[1]);
    await page.evaluate(id => { shouldDelay = false; void ui.bind(1, tasks.find(t => t.threadId === id), { select: false }); }, ids[2]);
    await page.waitForFunction(() => ui.snapshot().slots[1].loaded); await page.evaluate(() => pending.shift()());
    await page.waitForFunction(() => disposals.length === 1);
    assert.equal(await page.locator('[data-slot="1"] textarea').getAttribute('aria-label'), '草稿 ' + ids[2]);
    await page.setViewportSize({ width: 700, height: 700 }); await page.waitForFunction(() => !ui.snapshot().open);
    assert.equal(await page.locator('#original').evaluate(el => el.inert), false);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.waitForFunction(() => ui.snapshot().open);
    await page.evaluate(() => ui.close());
    await page.evaluate(() => { adapter.mount = async () => { throw Error('example incompatibility'); }; void ui.open(); });
    await page.waitForFunction(() => !ui.snapshot().open && document.querySelector('.nuyoah-chat-grid-notice')?.textContent.includes('已恢复单聊'));
    assert.equal(await page.locator('#original').evaluate(el => el.inert), false);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});

test('cloud navigation, reopening and reload retain positions; pointer and keyboard swaps retain live conversations', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 90000 }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html()); }); let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }); page.setDefaultTimeout(5000);
    await page.goto('http://127.0.0.1:' + server.address().port); await page.evaluate(() => ui.open());
    await page.waitForFunction(() => ui.snapshot().slots[0].loaded);
    for (let i = 1; i < 4; i++) await page.getByRole('combobox', { name: '区域 ' + (i + 1) + ' 的对话', exact: true }).selectOption(ids[i]);
    await page.waitForFunction(() => ui.snapshot().slots.every(s => s.loaded));
    const slot = index => page.locator('[data-slot="' + index + '"]');
    for (let i = 0; i < 4; i++) await slot(i).getByRole('textbox').fill('保留草稿 ' + i);
    await slot(2).getByRole('textbox').click(); await slot(2).locator('.sample-scroll').evaluate(el => el.scrollTop = 175);
    const from = await page.getByRole('button', { name: '交换区域 3 的位置', exact: true }).boundingBox(), to = await slot(1).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 }); await page.mouse.up();
    const order = [ids[0], ids[2], ids[1], ids[3]];
    assert.deepEqual(await page.evaluate(() => ui.snapshot().slots.map(s => s.target.threadId)), order);
    assert.equal(await page.evaluate(() => ui.snapshot().active), 1);
    assert.equal(await slot(1).getByRole('textbox').inputValue(), '保留草稿 2');
    assert.equal(await slot(1).locator('.sample-scroll').evaluate(el => el.scrollTop), 175);
    assert.equal(await page.evaluate(() => mounts.length), 4);
    await page.evaluate(() => { current = null; document.querySelector('main').hidden = true; ui.sync(); });
    assert.equal(await page.evaluate(() => ui.snapshot().suspended), true);
    assert.equal(await page.locator('#nuyoah-chat-grid').isVisible(), false);
    await page.evaluate(() => { current = tasks[0]; document.querySelector('main').hidden = false; ui.sync(); });
    await page.waitForFunction(() => ui.isOpen());
    assert.deepEqual(await page.evaluate(() => ui.snapshot().slots.map(s => s.target.threadId)), order);
    assert.equal(await slot(1).getByRole('textbox').inputValue(), '保留草稿 2');
    assert.equal(await page.evaluate(() => mounts.length), 4);
    await page.getByRole('button', { name: '交换区域 2 的位置', exact: true }).click(); await page.keyboard.press('ArrowDown');
    assert.deepEqual(await page.evaluate(() => ui.snapshot().slots.map(s => s.target.threadId)), [ids[0], ids[3], ids[1], ids[2]]);
    assert.equal(await slot(3).getByRole('textbox').inputValue(), '保留草稿 2');
    assert.equal(await page.evaluate(() => mounts.length), 4);
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('nuyoah:chat-grid-layout-v1')));
    assert.equal(JSON.stringify(persisted).includes('草稿'), false); assert.equal(JSON.stringify(persisted).includes('示例对话'), false);
    await page.reload(); await page.waitForFunction(() => ui.snapshot().slots.length === 4 && ui.snapshot().slots.every(s => s.loaded));
    assert.deepEqual(await page.evaluate(() => ui.snapshot().slots.map(s => s.target.threadId)), [ids[0], ids[3], ids[1], ids[2]]);
    assert.equal(await page.evaluate(() => ui.snapshot().active), 3);
    await page.evaluate(() => ui.close()); await page.reload(); assert.equal(await page.evaluate(() => ui.isOpen()), false);
    await page.getByRole('button', { name: '四宫格', exact: true }).click(); await page.waitForFunction(() => ui.snapshot().slots.every(s => s.loaded));
    assert.deepEqual(await page.evaluate(() => ui.snapshot().slots.map(s => s.target.threadId)), [ids[0], ids[3], ids[1], ids[2]]);
    assert.deepEqual(await page.evaluate(() => sent), []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});

test('cleanup failure in one pane does not prevent the other roots or native surface from being released', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 60000 }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const server = createServer((request, response) => { response.setHeader('content-type', 'text/html'); response.end(html()); }); let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.NUYOAH_TEST_BROWSER, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.evaluate(() => {
      const mount = adapter.mount;
      adapter.mount = async (...args) => {
        const session = await mount(...args);
        return { ...session, dispose() { session.dispose(); if (args[1].threadId === tasks[0].threadId) throw Error('Synthetic cleanup failure'); } };
      };
      return ui.open();
    });
    await page.waitForFunction(() => ui.snapshot().slots[0]?.loaded);
    for (let i = 1; i < 4; i++) await page.evaluate(i => ui.bind(i, tasks[i], { select: false }), i);
    await page.waitForFunction(() => ui.snapshot().slots.every(s => s.loaded));
    await page.evaluate(() => ui.close());
    assert.equal(await page.evaluate(() => disposals.length), 4);
    assert.equal(await page.locator('#nuyoah-chat-grid').count(), 0);
    assert.equal(await page.locator('#original').evaluate(e => e.inert), false);
    assert.match(await page.locator('.nuyoah-chat-grid-notice').innerText(), /清理失败/);
    await page.evaluate(() => ui.destroy());
    assert.equal(await page.locator('#nuyoah-chat-layout-entry').count(), 0);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
