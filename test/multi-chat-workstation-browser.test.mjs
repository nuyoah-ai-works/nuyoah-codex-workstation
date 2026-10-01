import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createMultiChatUI } from '../nuyoah/workstation/multi-chat-ui.mjs';

const root=new URL('../',import.meta.url);
test('production grid and workstation open in either order and keep all four modules interactive',{
  skip:!process.env.NUYOAH_PLAYWRIGHT_MODULE,timeout:90000,
},async()=>{
  const {chromium}=await import(process.env.NUYOAH_PLAYWRIGHT_MODULE);
  const sources=await Promise.all(['inject/conversation-preview.user.js','vendor/codex-taskboard/inject/codex-taskboard.user.js'].map(p=>readFile(new URL(p,root),'utf8')));
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;height:950px;display:flex;font:14px system-ui}[hidden]{display:none!important}
    body>aside{width:260px;flex:none}main{flex:1;min-width:0;display:flex;flex-direction:column;padding-top:48px}
    header[data-app-shell-titlebar]{position:fixed;top:0;left:260px;right:0;height:48px;display:flex;justify-content:flex-end;align-items:center}
    #workspace{position:relative;display:flex;flex:1;min-height:0;overflow:hidden}
    [data-app-shell-main-content-layout]{flex:1;min-width:0;display:flex;flex-direction:column}.native-frame{height:100%;width:100%;flex:1;min-width:0}
  </style></head><body><aside>虚构原生导航</aside><main>
    <header data-app-shell-titlebar><div data-app-shell-header-slot="end"><div data-app-shell-header-slot-content><button>新建标签页</button></div></div></header>
    <div id="workspace"><div data-app-shell-main-content-layout><div class="native-frame"><div contenteditable="true" role="textbox">虚构原生草稿</div></div></div></div>
  </main></body></html>`;
  const server=createServer((request,response)=>{response.setHeader('content-type','text/html;charset=utf-8');response.end(html)});let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({executablePath:process.env.NUYOAH_TEST_BROWSER,headless:true});
    const page=await browser.newPage({viewport:{width:2000,height:950}}),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.evaluate(()=>{
      window.__NUYOAH_WORKSTATION_CONFIG__={};window.__CODEX_TASKBOARD_SOURCE_HASH__='grid-workstation-fixture';window.__CODEX_TASKBOARD_URL__=location.origin+'/?host=codex';
      window.electronBridge={getSharedObjectSnapshotValue:()=>[],getInitialSidebarBootstrap:()=>({catalogEntries:[]}),sendMessageFromView:()=>{}};
    });
    await page.addScriptTag({content:sources[1]});await page.addScriptTag({content:sources[0]});
    await page.evaluate(factory=>{
      const target={hostId:'local',threadId:'00000000-0000-4000-8000-000000000001',title:'虚构验收对话'};
      const adapter={current:()=>target,prepare:async()=>{},mount:async(container,target,{onReady})=>{
        const input=document.createElement('textarea');input.setAttribute('aria-label','虚构独立草稿');container.append(input);onReady();return{dispose(){container.replaceChildren()}};
      }};
      window.__nuyoahMultiChat__=(0,eval)('('+factory+')')({window,adapter});
    },createMultiChatUI.toString());
    const opened=()=>page.waitForFunction(()=>window.__nuyoahMultiChat__.isOpen()&&window.__codexConversationPreviewInjection__.isWorkstationVisible()
      &&[...document.querySelectorAll('[data-nuyoah-panel-layout="docked"]')].some(p=>!p.hidden&&p.getBoundingClientRect().width>0));
    const fit=async()=>{
      await page.waitForFunction(()=>{
        const g=document.getElementById('nuyoah-chat-grid'),p=[...document.querySelectorAll('[data-nuyoah-panel-layout="docked"]')].find(p=>!p.hidden&&p.getBoundingClientRect().width>0);
        return g&&p&&g.getBoundingClientRect().right<=p.getBoundingClientRect().left+1;
      });
      const metrics=await page.evaluate(()=>{
        const g=document.getElementById('nuyoah-chat-grid'),p=[...document.querySelectorAll('[data-nuyoah-panel-layout]')].find(p=>!p.hidden&&p.getBoundingClientRect().width>0),r=e=>e.getBoundingClientRect();
        const b=p.querySelector('button'),back=[...g.querySelectorAll('button')].find(b=>b.textContent==='返回单聊');return{gridRight:r(g).right,panelLeft:r(p).left,panelWidth:r(p).width,insideCorrectHost:p.parentElement.id==='workspace',accessible:!p.closest('[inert],[aria-hidden="true"]'),buttonHit:!b||b.contains(document.elementFromPoint(r(b).x+r(b).width/2,r(b).y+r(b).height/2)),gridHit:back.contains(document.elementFromPoint(r(back).x+r(back).width/2,r(back).y+r(back).height/2))};
      });
      assert.ok(metrics.gridRight<=metrics.panelLeft+1);assert.ok(metrics.panelWidth>=419);assert.equal(metrics.insideCorrectHost,true);assert.equal(metrics.accessible,true);assert.equal(metrics.buttonHit,true);assert.equal(metrics.gridHit,true);
    };
    await page.getByRole('button',{name:'四宫格',exact:true}).click();
    await page.getByRole('button',{name:'工作站',exact:true}).click();await opened();await fit();
    for(const module of ['project','taskboard','skills','asset']){await page.evaluate(module=>window.__codexConversationPreviewInjection__.openWorkstationPanel(module),module);await opened();await fit()}
    await page.evaluate(()=>{const p=document.createElement('div');p.dataset.appShellRightPanelFullWidth='true';p.id='cloud-surface';document.getElementById('workspace').append(p)});
    await page.waitForFunction(()=>!window.__codexConversationPreviewInjection__.isWorkstationVisible());
    await page.evaluate(()=>document.getElementById('cloud-surface').remove());await opened();await fit();
    assert.equal(await page.locator('#codex-asset-console-page').isVisible(),true);
    await page.evaluate(()=>{
      const host=document.getElementById('workspace'),source=host.querySelector('[data-app-shell-main-content-layout]');
      const replacement=source.cloneNode(true);replacement.inert=false;replacement.style.opacity='';replacement.removeAttribute('data-nuyoah-chat-source-hidden');
      host.replaceChildren(replacement);
    });
    await opened();await fit();assert.equal(await page.locator('#codex-asset-console-page').isVisible(),true);
    await page.getByRole('button',{name:'工作站',exact:true}).click();await page.waitForFunction(()=>!window.__codexConversationPreviewInjection__.isWorkstationVisible());
    assert.equal(await page.evaluate(()=>window.__nuyoahMultiChat__.isOpen()),true);
    await page.getByRole('button',{name:'工作站',exact:true}).click();await opened();await fit();
    await page.getByRole('button',{name:'返回单聊',exact:true}).click();assert.equal(await page.evaluate(()=>window.__codexConversationPreviewInjection__.isWorkstationVisible()),true);
    await page.getByRole('button',{name:'四宫格',exact:true}).click();await opened();await fit();
    await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await fit();
    await page.evaluate(()=>window.__nuyoahMultiChat__.destroy());assert.equal(await page.evaluate(()=>window.__codexConversationPreviewInjection__.isWorkstationVisible()),true);
    assert.equal(await page.locator('[data-app-shell-main-content-layout]').evaluate(e=>e.inert),false);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
});
