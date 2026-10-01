import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
const source = await readFile(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
const vendor = await readFile(new URL('../vendor/codex-taskboard/inject/codex-taskboard.user.js', import.meta.url), 'utf8');

test('workstation and the modern native pane resize together and restore their separate preferences', {
  skip: !process.env.NUYOAH_PLAYWRIGHT_MODULE, timeout: 60000,
}, async () => {
  const { chromium } = await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const html = `<!doctype html><style>
    *{box-sizing:border-box}body{margin:0;height:900px;display:flex;font:14px system-ui}
    [hidden]{display:none!important}body>aside{width:260px;flex:none}main{flex:1;min-width:0;display:flex;flex-direction:column;padding-top:48px}
    header[data-app-shell-titlebar]{position:fixed;top:0;left:260px;right:0;height:48px;display:flex;justify-content:flex-end;align-items:center}
    #workspace{position:relative;display:flex;flex:1;min-height:0;overflow:hidden}
    [data-app-shell-main-content-layout]{flex:1;min-width:0;display:flex;flex-direction:column}.native-frame{height:100%;width:100%;flex:1;min-width:0}
    #native-pane{position:relative;flex:none;height:100%;min-width:0;overflow:visible}
    #native-pane>div{position:absolute;inset:0}#native-content{position:absolute;inset-block:0;left:0;overflow:auto}
  </style><body><aside>虚构原生侧栏</aside><main>
    <header data-app-shell-titlebar><button id="native-toggle">原生面板</button><div data-app-shell-header-slot="end"><div data-app-shell-header-slot-content><button>新建标签页</button></div></div></header>
    <div id="workspace"><div data-app-shell-main-content-layout data-app-shell-workspace-layout="split" data-app-shell-right-panel-full-width="false"><div class="native-frame" style="width:1600px;min-width:100%;align-self:flex-end">虚构验收对话</div></div>
    <aside id="native-pane" hidden style="width:1122px"><div><div id="native-content" style="width:1122px;min-width:1122px"><button id="native-action">虚构原生操作</button></div></div></aside></div>
  </main><script>document.getElementById('native-toggle').onclick=()=>{const p=document.getElementById('native-pane');p.hidden=!p.hidden};window.nativeActions=0;document.getElementById('native-action').onclick=()=>window.nativeActions++;</script>`;
  const server = createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(html)});
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({executablePath:process.env.NUYOAH_TEST_BROWSER,headless:true});
    const page=await browser.newPage({viewport:{width:2200,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.stack));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(()=>{
      localStorage.setItem('codex-workspace-enhancer:side-panel-width-v1','1044');
      window.__CODEX_TASKBOARD_SOURCE_HASH__="coexistence-fixture";window.__NUYOAH_WORKSTATION_CONFIG__={};window.__CODEX_TASKBOARD_URL__=location.origin+'/?host=codex';
      window.electronBridge={getSharedObjectSnapshotValue:()=>[],getInitialSidebarBootstrap:()=>({catalogEntries:[]}),sendMessageFromView:()=>{}};
    });
    await page.addScriptTag({content:vendor});await page.addScriptTag({content:source});
    const panel=()=>page.locator('[data-nuyoah-panel-layout="docked"]:visible');
    const native=page.locator('#native-pane');
    const measure=()=>page.evaluate(()=>{
      const work=document.querySelector('[data-nuyoah-panel-layout="docked"]:not([hidden])');
      const rect=n=>({x:n.getBoundingClientRect().x,width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right});
      const viewport=document.querySelector('[data-app-shell-main-content-layout]');
      return {work:work&&rect(work),native:rect(document.getElementById('native-pane')),content:rect(document.getElementById('native-content')),chatFrame:rect(viewport.querySelector('.native-frame')),chat:rect(viewport),scale:document.getElementById('workspace').getBoundingClientRect().width/document.getElementById('workspace').offsetWidth,
        nativePreference:document.getElementById('native-pane').style.width,workPreference:localStorage.getItem('codex-workspace-enhancer:side-panel-width-v1')};
    });
    await page.evaluate(()=>window.__codexConversationPreviewInjection__.openWorkstationPanel('project'));
    await panel().waitFor();await page.waitForFunction(()=>document.querySelector('[data-nuyoah-panel-layout="docked"]').getBoundingClientRect().width===1044);
    await page.locator('#native-toggle').click();
    await page.waitForFunction(()=>document.getElementById('native-pane').hasAttribute('data-nuyoah-native-panel-adaptive'));
    async function assertFit() {
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const m=await measure();assert.ok(m.chat.width/m.scale>=559,JSON.stringify(m));assert.ok(m.work.width/m.scale>=419);assert.ok(m.native.width/m.scale>=419);
      assert.ok(m.chat.right<=m.work.x+1&&m.work.right<=m.native.x+1);
      assert.ok(m.content.right<=m.native.right+1,'native explicit-width content must also fit');
      assert.ok(m.chatFrame.x>=m.chat.x-1&&m.chatFrame.right<=m.chat.right+1,'cached native chat width must not crop the conversation');
      assert.equal(m.nativePreference,'1122px');return m;
    }
    await assertFit();await page.locator('#native-action').click();assert.equal(await page.evaluate(()=>window.nativeActions),1);
    for (const module of ['taskboard','skills','asset','project']) {
      await page.evaluate(module=>window.__codexConversationPreviewInjection__.openWorkstationPanel(module),module);
      await panel().waitFor();await page.waitForFunction(()=>document.getElementById('native-pane').hasAttribute('data-nuyoah-native-panel-adaptive'));
      await assertFit();
    }
    // Dragging uses a guide; native and conversation content move only on release.
    let box=await panel().boundingBox();const baseline=await measure();
    await page.mouse.move(box.x+1,box.y+100);await page.mouse.down();await page.mouse.move(box.x+101,box.y+100);
    assert.equal((await measure()).work.width,baseline.work.width);
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    const guide=await page.locator('#workspace > [aria-hidden="true"]').boundingBox();
    assert.ok(Math.abs(guide.x-(box.x+98))<2,'guide must follow the workstation boundary beside the native pane');
    await page.mouse.up();await page.waitForFunction(()=>localStorage.getItem('codex-workspace-enhancer:side-panel-width-v1')!=='1044');
    await assertFit();assert.equal((await measure()).native.width,baseline.native.width);const saved=(await measure()).workPreference;
    await page.locator('#native-toggle').click();
    await page.waitForFunction(()=>!document.getElementById('native-pane').hasAttribute('data-nuyoah-native-panel-adaptive'));
    await page.waitForFunction(saved=>Math.abs(document.querySelector('[data-nuyoah-panel-layout="docked"]:not([hidden])').getBoundingClientRect().width-Number(saved))<1,saved);
    await page.locator('#native-toggle').click();await assertFit();
    // The native host reports deltas from its raw preference, not its capped box.
    const beforeNativeDrag=await measure();
    await page.evaluate(()=>{
      const pane=document.getElementById('native-pane'),content=document.getElementById('native-content');
      pane.style.width='1152px';content.style.width='1152px';content.style.minWidth='1152px';
    });
    await page.waitForFunction(expected=>Math.abs(document.getElementById('native-pane').getBoundingClientRect().width-expected)<1,beforeNativeDrag.native.width+30);
    const largerNative=await measure();assert.ok(largerNative.work.width<beforeNativeDrag.work.width);
    await page.evaluate(()=>{
      const pane=document.getElementById('native-pane'),content=document.getElementById('native-content');
      pane.style.width='1122px';content.style.width='1122px';content.style.minWidth='1122px';
    });
    await page.waitForFunction(expected=>Math.abs(document.getElementById('native-pane').getBoundingClientRect().width-expected)<1,beforeNativeDrag.native.width);
    // Native preference changes while capped must recompute even when its actual size is unchanged.
    await page.evaluate(()=>{const p=document.getElementById('native-pane'),content=document.getElementById('native-content');p.style.width='900px';content.style.width='900px';content.style.minWidth='900px'});
    await page.waitForFunction(()=>document.getElementById('native-content').hasAttribute('data-nuyoah-native-panel-content-adaptive'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!window.__codexConversationPreviewInjection__.isWorkstationVisible());
    await page.waitForFunction(()=>document.getElementById('native-pane').getBoundingClientRect().width===900);
    assert.equal(await page.locator('#native-content').evaluate(n=>n.style.minWidth),'900px');
    assert.equal(await page.locator('.native-frame').evaluate(n=>n.style.width),'1600px');
    await page.waitForFunction(()=>!document.querySelector('[data-nuyoah-chat-frame-adaptive]'));
    assert.equal(await page.locator('[data-nuyoah-chat-frame-adaptive]').count(),0);
    await page.evaluate(()=>window.__codexConversationPreviewInjection__.openWorkstationPanel('project'));
    await panel().waitFor();
    await page.evaluate(()=>document.querySelector('[data-app-shell-main-content-layout]').setAttribute('data-app-shell-right-panel-full-width','true'));
    await page.waitForFunction(()=>!window.__codexConversationPreviewInjection__.isWorkstationVisible());
    await page.waitForFunction(()=>!document.getElementById('native-pane').hasAttribute('data-nuyoah-native-panel-adaptive'));
    await page.evaluate(()=>document.querySelector('[data-app-shell-main-content-layout]').setAttribute('data-app-shell-right-panel-full-width','false'));
    await page.setViewportSize({width:1950,height:900});
    await page.evaluate(()=>document.body.style.zoom='1.1');
    await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
    await page.locator('#nuyoah-workstation-entry').click();await panel().waitFor();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const scaled=await measure();assert.ok(scaled.chat.width/scaled.scale>=559,JSON.stringify(scaled));assert.ok(scaled.work.width/scaled.scale>=419);
    box=await panel().boundingBox();await page.mouse.move(box.x+1,box.y+100);await page.mouse.down();await page.mouse.move(box.x+40,box.y+100);await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal((await measure()).workPreference,saved);
    await page.evaluate(()=>window.__codexConversationPreviewInjection__.destroy());
    assert.equal(await page.locator('[data-nuyoah-native-panel-adaptive],[data-nuyoah-native-panel-content-adaptive],[data-nuyoah-chat-frame-adaptive]').count(),0);
    assert.equal(await page.locator('#native-pane').evaluate(n=>n.style.width),'900px');
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
