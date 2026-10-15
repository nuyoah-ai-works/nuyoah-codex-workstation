import assert from 'node:assert/strict';
import test from 'node:test';
import { openGrokBot, createAppShortcuts } from '../nuyoah/workstation/app-shortcuts.mjs';

test('Grok shortcut opens only the verified bundle and returns safe errors', async () => {
  let call;
  assert.deepEqual(await openGrokBot(async (...args) => { call = args; }), { ok: true });
  assert.deepEqual(call.slice(0, 2), ['/usr/bin/open', ['-b', 'com.anysphere.sand']]);
  assert.deepEqual(await openGrokBot(async () => { throw new Error('private path'); }), { ok: false });
});
test('Grok shares the Orbit row without replacing native controls and restores layout', { skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE }, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, ...(process.env.NUYOAH_PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.NUYOAH_PLAYWRIGHT_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 500, height: 500 } });
    await page.setContent('<style>aside{width:440px}#nav{display:flex;flex-direction:column}button{height:34px}#orbit{width:100%}</style><aside><div id="nav"><div id="new">新聊天</div><button id="orbit" data-sidebar-destination="builtin:orbit" onclick="window.nativeClicks=(window.nativeClicks||0)+1">桃弥 <span id="badge">2</span></button></div></aside>');
    await page.evaluate(`window.original=document.getElementById('orbit');window.shortcuts=(${createAppShortcuts.toString()})({window})`);
    const native=page.locator('#orbit'), shortcut=page.locator('#nuyoah-grok-shortcut');
    const a=await native.boundingBox(), b=await shortcut.boundingBox();
    assert.equal(a.y,b.y); assert.ok(Math.abs(a.width-b.width)<1); assert.ok(b.x>=a.x+a.width);
    await native.click(); assert.equal(await page.evaluate(()=>window.nativeClicks),1);
    assert.equal(await page.locator('#badge').innerText(),'2');
    await shortcut.click(); const request=await page.evaluate(()=>window.shortcuts.takeRequest()); assert.ok(request.id);
    assert.equal(await page.evaluate(()=>window.shortcuts.takeRequest()),null);
    await page.evaluate(id=>window.shortcuts.receive({id,ok:false}),request.id); assert.match(await shortcut.innerText(),/打开失败/);
    await shortcut.click(); await page.evaluate(()=>{const r=window.shortcuts.takeRequest();window.shortcuts.receive({id:r.id,ok:true});});
    assert.match(await shortcut.innerText(),/Grok Bot/);
    await page.evaluate(()=>{document.querySelector('aside').style.width='220px';});
    const c=await shortcut.boundingBox();assert.ok(c.width>50&&c.x+c.width<240);
    await page.evaluate(()=>window.shortcuts.destroy());assert.equal(await shortcut.count(),0);
    assert.equal(await page.evaluate(()=>document.getElementById('orbit')===window.original),true);
    assert.equal(await page.locator('[data-nuyoah-app-shortcuts]').count(),0);
  } finally { await browser.close(); }
});
