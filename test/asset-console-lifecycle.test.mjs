import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { AssetConsoleBridge } from '../lib/asset-console-bridge.mjs';

// Protocol fixture: model an OOPIF starting subresources as soon as it runs.
function clientFixture() {
  const listeners=new Map(),commands=[],escaped=[];let autoAttach={},onResume=null;
  const client={
    on(method,fn){listeners.set(method,fn);return()=>listeners.delete(method);},
    async send(method,params={},sessionId=null){
      commands.push({method,params,sessionId});
      if(method==='Target.setAutoAttach')autoAttach=params;
      if(method==='Runtime.runIfWaitingForDebugger'&&onResume)await onResume(sessionId);
      return {};
    },
  };
  return {client,commands,escaped,listeners,async attach(info,resources=[]){
    const configured=()=>commands.some(c=>c.method==='Fetch.enable'&&c.sessionId===info.sessionId);
    const start=()=>{if(!configured())escaped.push(...resources);};
    onResume=start;if(!autoAttach.waitForDebuggerOnStart)start();
    await listeners.get('Target.attachedToTarget')?.(info);onResume=null;
  }};
}

test('new iframe cannot run stylesheet/module requests until its local transport is ready',async()=>{
  const f=clientFixture(),bridge=new AssetConsoleBridge({staticRoot:new URL('../nuyoah/assets/public',import.meta.url).pathname});bridge.client=f.client;
  const proxy=await bridge.setupProxy(0);
  try{
    const attach=f.commands.find(c=>c.method==='Target.setAutoAttach').params;
    assert.deepEqual(attach.filter,[{type:'iframe',exclude:false},{exclude:true}],'host pages and workers must not be paused');
    await bridge.proxyRequest({requestId:'document',frameId:'asset-frame',request:{url:proxy.embedUrl,method:'GET',headers:{}}},null,proxy);
    const doc=f.commands.find(c=>c.params.requestId==='document'&&c.method==='Fetch.fulfillRequest');
    assert.match(Buffer.from(doc.params.body,'base64').toString(),new RegExp(proxy.token+'/ui-v3.css'));
    await f.attach({sessionId:'asset-session',targetInfo:{type:'iframe',targetId:'asset-frame',url:proxy.embedUrl}},['ui-v3.css','app.js']);
    assert.deepEqual(f.escaped,[],'subresources escaped to the remote origin before Fetch.enable');
    for(const [name,mime] of [['ui-v3.css','text/css'],['app.js','text/javascript'],['asset-ui.js','text/javascript']]){
      await bridge.proxyRequest({requestId:name,frameId:'asset-frame',request:{url:proxy.embedUrl+name,method:'GET',headers:{}}},'asset-session',proxy);
      const response=f.commands.find(c=>c.params.requestId===name&&c.method==='Fetch.fulfillRequest');
      assert.ok(response);assert.equal(response.params.responseCode,200);
      assert.ok(response.params.responseHeaders.some(h=>h.name==='content-type'&&h.value.startsWith(mime)));
      assert.ok(Buffer.from(response.params.body,'base64').length>1000);
    }
  }finally{await bridge.dispose();}
});

test('unrelated, cancelled and failed iframe setup always resumes the child',async()=>{
  const f=clientFixture(),bridge=new AssetConsoleBridge();bridge.client=f.client;const proxy=await bridge.setupProxy(0);
  const handler=f.listeners.get('Target.attachedToTarget');
  await handler({sessionId:'unrelated',targetInfo:{type:'iframe',url:'https://example.invalid/'}});
  assert.ok(!f.commands.some(c=>c.method==='Fetch.enable'&&c.sessionId==='unrelated'));
  const send=f.client.send;f.client.send=async(method,params,session)=>{if(method==='Fetch.enable'&&session==='failed')throw new Error('fixture setup failure');return send(method,params,session);};
  await handler({sessionId:'failed',targetInfo:{type:'iframe',url:proxy.embedUrl,targetId:'asset'}});
  await bridge.dispose();await handler({sessionId:'cancelled',targetInfo:{type:'iframe',url:proxy.embedUrl}});
  for(const id of ['unrelated','failed','cancelled'])assert.ok(f.commands.some(c=>c.method==='Runtime.runIfWaitingForDebugger'&&c.sessionId===id),id);
});

const injection=await readFile(new URL('../inject/conversation-preview.user.js',import.meta.url),'utf8');
function declaredFunction(name,next){return injection.slice(injection.indexOf(`  function ${name}(`),injection.indexOf(`  ${next}`,injection.indexOf(`  function ${name}(`)));}
function panelFixture({ready=true}={}){
  const timers=new Map();let next=0,request=0;const messages=[],bindings=[];const message={textContent:''},body={appendChild(frame){frame.isConnected=true;}};
  const page={hidden:false,dataset:{},querySelector:selector=>selector==='.codex-asset-console-body'?body:message};
  const context={assetConsolePage:page,assetConsoleFrame:null,assetConsoleLoadTimer:null,assetConsoleRequestId:null,assetConsoleReturnFocus:null,ASSET_CONSOLE_FRAME_ID:'asset-frame',pendingAssetConsoleQuery:'',
    document:{documentElement:{removeAttribute(){}},createElement:()=>({contentWindow:{postMessage:value=>messages.push(value)},setAttribute(){},remove(){this.removed=true;this.isConnected=false;}})},
    crypto:{randomUUID:()=>`request-${++request}`},codexSidebarOpenAssetConsole:payload=>bindings.push(JSON.parse(payload)),
    closeCustomShortcutPanel(){},closeProjectOverview(){},closeSkillsGrouping(){},announceWorkspacePanel(){},window:{},
    setAssetConsoleHostLayer(){},restoreCustomShortcutNativeContent(){},scheduleSync(){},
    setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),currentCodexTaskContext:()=>({threadId:'fixture',hostId:'local'})};
  vm.createContext(context);vm.runInContext(declaredFunction('notifyAssetConsole','function setAssetConsoleHostLayer(')+declaredFunction('closeOtherWorkspacePanels','function findCustomShortcutPageMount(')+declaredFunction('closeAssetConsolePanel','function currentComposer(')+declaredFunction('handleAssetConsoleMessage','const DEFAULT_SKILL_FILTERS'),context);
  const emit=(action,source=context.assetConsoleFrame?.contentWindow,origin='https://web-sandbox.oaiusercontent.com')=>context.handleAssetConsoleMessage({origin,source,data:{source:'asset-console',action}});
  const open=(url='https://web-sandbox.oaiusercontent.com/fixture/')=>{
    page.hidden=false;page.dataset.state='loading';context.notifyAssetConsole('open');
    if(url)context.setAssetConsolePanel({requestId:context.assetConsoleRequestId,state:'ready',url});
    return context.assetConsoleRequestId;
  };
  if(ready)open();
  return {context,page,message,timers,messages,bindings,emit,open};
}

test('document load is not readiness; only the current asset frame can reveal the panel',()=>{
  const f=panelFixture();const frame=f.context.assetConsoleFrame;
  assert.equal(f.page.dataset.state,'loading');frame.onload();assert.equal(f.page.dataset.state,'loading');
  f.emit('ready',{},'https://web-sandbox.oaiusercontent.com');f.emit('ready',frame.contentWindow,'https://example.invalid');assert.equal(f.page.dataset.state,'loading');
  f.emit('ready');assert.equal(f.page.dataset.state,'ready');assert.equal(f.timers.size,0);
  f.open('https://web-sandbox.oaiusercontent.com/reopened/');
  f.emit('ready',frame.contentWindow);frame.onload();assert.equal(f.page.dataset.state,'loading');
});

test('missing resources and silent module failure produce a retry instead of bare HTML',()=>{
  for(const mode of ['explicit','timeout']){
    const f=panelFixture(),frame=f.context.assetConsoleFrame;
    if(mode==='explicit')f.emit('load-error');else [...f.timers.values()][0]();
    assert.equal(f.page.dataset.state,'error');assert.equal(frame.removed,true);assert.equal(f.context.assetConsoleFrame,null);
    assert.equal(f.timers.size,0);assert.match(f.message.textContent,/重新连接/);
    assert.deepEqual(f.bindings.map(({action})=>action),['open','close']);
    assert.equal(f.context.assetConsoleRequestId,null);
    f.open();f.emit('ready');assert.equal(f.page.dataset.state,'ready','retry must create a working fresh frame');
  }
  assert.match(injection,/:not\(\[data-state="ready"\]\) #\$\{ASSET_CONSOLE_FRAME_ID\} \{ visibility: hidden/);
});

test('switching panels closes pending, loading and ready asset resources and rejects late replies',()=>{
  for(const phase of ['pending','loading','ready']){
    const f=panelFixture({ready:false});
    const requestId=f.open(phase==='pending'?null:undefined),frame=f.context.assetConsoleFrame;
    if(phase==='ready')f.emit('ready');
    f.context.closeOtherWorkspacePanels('skills');
    assert.equal(f.page.hidden,true);assert.equal(f.context.assetConsoleFrame,null);assert.equal(f.timers.size,0);
    if(frame)assert.equal(frame.removed,true);
    assert.deepEqual(f.bindings.map(({action})=>action),['open','close']);
    f.context.setAssetConsolePanel({requestId,state:'ready',url:'https://web-sandbox.oaiusercontent.com/late/'});
    assert.equal(f.context.assetConsoleFrame,null);
    const retryId=f.open(null);
    f.context.setAssetConsolePanel({requestId,state:'ready',url:'https://web-sandbox.oaiusercontent.com/stale/'});
    f.context.setAssetConsolePanel({requestId,state:'error',message:'stale error'});
    assert.equal(f.context.assetConsoleFrame,null);assert.equal(f.page.dataset.state,'loading');
    f.context.setAssetConsolePanel({requestId:retryId,state:'ready',url:'https://web-sandbox.oaiusercontent.com/retry/'});
    f.emit('ready');assert.equal(f.page.dataset.state,'ready');
  }
});

test('asset binding follows task selection and ignores transient empty identities without reopening',()=>{
  const f=panelFixture();f.emit('ready');
  const frame=f.context.assetConsoleFrame;
  assert.equal(f.messages.at(-1).threadId,'fixture');
  f.context.currentCodexTaskContext=()=>({threadId:'second',hostId:'local',projectId:'other-project'});
  f.context.syncAssetConsoleContext();assert.equal(f.messages.at(-1).threadId,'second');
  const count=f.messages.length;f.context.syncAssetConsoleContext();assert.equal(f.messages.length,count);
  f.context.currentCodexTaskContext=()=>({threadId:'',hostId:''});f.context.syncAssetConsoleContext();assert.equal(f.messages.length,count);
  assert.equal(f.context.assetConsoleFrame,frame);assert.equal(f.page.hidden,false);assert.equal(f.bindings.length,1);
});

test('asset insertion rejects stale task and remote host identities even when IDs match',()=>{
  const f=panelFixture();f.emit('ready');let inserts=0;
  f.context.addAssetReferencesToComposer=()=>{inserts++;return true;};f.context.isAbsoluteAssetPath=()=>true;
  const insert=(hostId,threadId)=>f.context.handleAssetConsoleMessage({origin:'https://web-sandbox.oaiusercontent.com',source:f.context.assetConsoleFrame.contentWindow,
    data:{source:'asset-console',action:'use-in-codex',path:'/fixture/output.png',hostId,threadId}});
  insert('remote-fixture','fixture');insert('local','stale');assert.equal(inserts,0);
  insert('local','fixture');assert.equal(inserts,1);
  f.context.currentCodexTaskContext=()=>({hostId:'remote-fixture',threadId:'fixture'});insert('local','fixture');assert.equal(inserts,1);
});
