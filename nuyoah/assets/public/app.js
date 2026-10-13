import { restoreView, buildFolderTree, buildEagleFolderTree, renderMarkdown, ThumbnailQueue } from './asset-ui.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = { ...restoreView(), sources:[], assets:[], offset:0, total:0, loading:false,
  context:{hostId:params.get('hostId')||'local',...Object.fromEntries(['threadId','threadTitle','projectId','projectName'].map(key=>[key,params.get(key)||'']))},
  request:0, selection:0, mediaRevision:0, controller:null, previewController:null, preview:null, previewData:null,
  blob:null, poll:null, facetsKey:'', facets:{folders:[],tags:[]}, eagleFolders:[], folderIssue:false,
  collapsed:new Set(), collapsedSources:new Set() };
const base = new URL('./',location.href);
const endpoint = route => new URL(route.replace(/^\//,''),base).href;
function notice(text,error=false) { $('notice').textContent=text;$('notice').hidden=!text;$('notice').classList.toggle('error',error); }
function el(tag,text,className) { const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node; }
async function api(route,options={}) {
  const response=await fetch(endpoint(route),{...options,headers:{'content-type':'application/json',...options.headers}});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'读取失败，请重试');return data;
}
const run = work => Promise.resolve().then(work).catch(error=>{if(error.name!=='AbortError')notice(error.message,true);});
function query(extra={}) { return new URLSearchParams({...extra,...(state.scope==='task'?{threadId:state.context.threadId,hostId:state.context.hostId}:{})}); }
function media(asset,detail=false) { return endpoint('/media?'+query({id:asset.id,v:String(Math.round(asset.mtimeMs)),...(state.mediaRevision?{refresh:String(state.mediaRevision)}:{}),...(detail?{detail:'1'}:asset.kind==='video'?{thumbnail:'1'}:{})})); }
const source = () => state.sources.find(s=>s.id===state.sourceId);
const bytes = n => n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(0)} KB`:`${(n/1048576).toFixed(1)} MB`;
const formatNames = {image:'图片',video:'视频',audio:'音频',markdown:'Markdown',code:'代码',document:'文本',html:'HTML 原文',office:'文档正文',archive:'压缩包目录',pdf:'PDF'};
function locationLabel(directory) {
  if(source()?.kind==='eagle')return state.eagleFolders.find(folder=>folder.id===directory)?.path||directory;
  const root=source()?.root?.replace(/\\/g,'/'),value=String(directory).replace(/\\/g,'/');
  return root&&value===root?'全部文件':root&&value.startsWith(root+'/')?value.slice(root.length+1):value;
}
let saves=Promise.resolve();
function saveView() {
  if(state.context.hostId!=='local')return Promise.resolve();
  const projectId=state.context.projectId;
  const view={scope:state.scope,sourceId:state.sourceId,folder:state.folder,layout:state.layout,tileSize:state.tileSize};
  saves=saves.catch(()=>{}).then(()=>api('/api/view?'+new URLSearchParams({projectId}),{method:'PUT',body:JSON.stringify(view),keepalive:true}));
  return saves.catch(()=>notice('浏览位置未保存，请稍后重试。',true));
}
function navButton(label,selected,onClick,{count,icon='▱'}={}) {
  const button=el('button',undefined,'nav-item');button.type='button';button.title=label;
  button.setAttribute('aria-current',String(selected));button.append(el('span',icon,'nav-icon'),el('span',label,'nav-name'));
  if(count!==undefined)button.append(el('span',String(count),'nav-count'));
  button.onclick=()=>run(onClick);return button;
}
function paintTree(nodes,host) {
  for(const node of nodes) {
    const group=el('div'),row=el('div',undefined,'folder-row'),children=el('div',undefined,'folder-children');
    const collapsed=state.collapsed.has(node.value),toggle=el('button',node.children.length?(collapsed?'›':'⌄'):'','folder-toggle');
    toggle.type='button';toggle.disabled=!node.children.length;toggle.dataset.folderValue=node.value;toggle.dataset.folderAction='toggle';
    toggle.setAttribute('aria-label',`${collapsed?'展开':'折叠'} ${node.label}`);
    if(node.children.length)toggle.setAttribute('aria-expanded',String(!collapsed));
    toggle.onclick=()=>{if(collapsed)state.collapsed.delete(node.value);else state.collapsed.add(node.value);paintSources();};
    const button=navButton(node.label,state.folder===node.value,()=>selectSource(state.sourceId,node.value));
    button.dataset.folderValue=node.value;button.dataset.folderAction='name';row.append(toggle,button);
    group.append(row);if(node.children.length&&!collapsed){paintTree(node.children,children);group.append(children);}host.append(group);
  }
}
function activateSource(s,action) {
  const selected=state.sourceId===s.id;
  if(!selected||(action==='name'&&state.folder)) {
    state.collapsedSources.delete(s.id);
    return selectSource(s.id);
  } else {
    if(state.collapsedSources.has(s.id))state.collapsedSources.delete(s.id);
    else state.collapsedSources.add(s.id);
    paintSources();
  }
}
function paintSources() {
  const focused=document.activeElement,nav=$('sourceTree');
  const sourceFocus=nav.contains(focused)&&focused.dataset.sourceAction?[focused.dataset.sourceId,focused.dataset.sourceAction]:null;
  const folderFocus=nav.contains(focused)&&focused.dataset.folderAction?[focused.dataset.folderValue,focused.dataset.folderAction]:null;
  $('sourceTree').replaceChildren();
  for(const s of state.sources) {
    const group=el('div',undefined,'source-group'),row=el('div',undefined,'source-row');
    const expanded=state.sourceId===s.id&&!state.collapsedSources.has(s.id);
    const toggle=el('button',expanded?'⌄':'›','folder-toggle');
    toggle.type='button';toggle.dataset.sourceId=s.id;toggle.dataset.sourceAction='toggle';
    toggle.setAttribute('aria-label',`${expanded?'收起':'展开'} ${s.name}`);
    toggle.setAttribute('aria-expanded',String(expanded));toggle.onclick=()=>run(()=>activateSource(s,'toggle'));
    const button=navButton(s.name,state.sourceId===s.id&&!state.folder,()=>activateSource(s,'name'),
      {count:s.count,icon:s.kind==='eagle'?'◈':'▱'});
    button.dataset.sourceId=s.id;button.dataset.sourceAction='name';
    row.append(toggle,button);group.append(row);
    if(expanded){
      const nodes=s.kind==='eagle'?buildEagleFolderTree(state.eagleFolders,s.eagleFolderId):buildFolderTree(state.facets.folders,s);
      if(nodes.length){const tree=el('div',undefined,'folder-tree');paintTree(nodes,tree);group.append(tree);}
    }
    $('sourceTree').append(group);
  }
  if(sourceFocus)[...nav.querySelectorAll('[data-source-action]')]
    .find(node=>node.dataset.sourceId===sourceFocus[0]&&node.dataset.sourceAction===sourceFocus[1])?.focus();
  else if(folderFocus)[...nav.querySelectorAll('[data-folder-action]')]
    .find(node=>node.dataset.folderValue===folderFocus[0]&&node.dataset.folderAction===folderFocus[1])?.focus();
  $('sourceCount').textContent=state.sources.length?`${state.sources.length} 个来源`:'';
  $('noSources').hidden=state.sources.length>0;$('taskButton').setAttribute('aria-pressed',String(state.scope==='task'));
  const s=source(),busy=s?.status==='scanning';
  $('scanButton').disabled=state.scope==='task'?state.context.hostId!=='local':!s||busy;$('scanButton').textContent=state.scope==='task'?'刷新引用':'刷新';
  $('removeButton').disabled=!s;$('removeButton').hidden=state.scope==='task';$('cancelScan').hidden=!busy;
  $('tagSelect').hidden=state.scope==='task'||!state.facets.tags.length;
  const statuses={unscanned:'尚未扫描',scanning:`正在扫描 · 已收录 ${s?.progress?.count||0} 个文件`,ready:`${s?.count||0} 个资产 · ${s?.scannedAt?new Date(s.scannedAt).toLocaleString('zh-CN'):''}`};
  $('sourceStatus').textContent=state.scope==='task'?(state.context.threadTitle||'当前任务'):s?(state.folderIssue?'Eagle 文件夹层级暂时无法读取；已收录资产仍可浏览':statuses[s.status]||s.message):'选择文件夹开始浏览';
  $('contextLabel').textContent=state.context.hostId==='local'?(state.context.projectName||'本地素材'):'本机素材库';
  $('libraryTitle').textContent=state.scope==='task'?'当前任务':state.folder?locationLabel(state.folder):s?.name||'资料库';
  $('libraryTitle').title=$('libraryTitle').textContent;
}
async function refreshFacets() {
  const s=source(),key=s?`${s.id}:${s.scannedAt}:${s.status}`:'';
  if(!s){state.facets={folders:[],tags:[]};state.facetsKey='';}
  else if(key!==state.facetsKey) {
    const id=s.id,[facets,eagle]=await Promise.all([
      api(`/api/sources/${id}/facets`),
      s.kind==='eagle'?api(`/api/sources/${id}/folders`).catch(()=>null):Promise.resolve(null)
    ]);
    if(state.sourceId!==id)return;
    state.facets=facets;state.eagleFolders=eagle?.folders||[];state.folderIssue=s.kind==='eagle'&&!eagle;state.facetsKey=key;
    if(state.folder){
      if(s.kind==='eagle')state.folder=state.eagleFolders.find(f=>f.id===state.folder||f.path===state.folder)?.id||'';
      else if(!facets.folders.some(f=>f===state.folder||f.startsWith(state.folder+'/')))state.folder='';
    }
  }
  const tag=$('tagSelect').value;$('tagSelect').replaceChildren(new Option('全部标签',''));
  for(const value of state.facets.tags)$('tagSelect').add(new Option(value,value));
  $('tagSelect').value=state.facets.tags.includes(tag)?tag:'';paintSources();
}
async function refreshSources() {
  const data=await api('/api/sources');state.sources=data.sources;
  if(state.sourceId&&!source())Object.assign(state,restoreView({...state,projectId:state.context.projectId},state.sources,state.context));
  await refreshFacets();paintSources();
  if(!state.poll&&state.sources.some(s=>s.status==='scanning'))state.poll=setTimeout(poll,1000);
}
async function poll() {
  state.poll=null;if(document.hidden)return;
  try {const old=source()?.status;await refreshSources();if(old==='scanning'&&source()?.status!=='scanning')await load();}
  catch(error){notice(error.message,true);}
}
function empty(title,text,allowImport=false) {
  $('emptyState').hidden=false;$('emptyTitle').textContent=title;$('emptyText').textContent=text;$('emptyImport').hidden=!allowImport;
}
const thumbnailQueue=new ThumbnailQueue(),thumbnailCache=new Map();
function permissionDenied(response){return /(?:EPERM|EACCES|PERMISSION)$/.test(response.headers.get('x-preview-error')||'');}
async function imageThumbnail(url,signal){
  const response=await fetch(url,{signal});if(!response.ok)throw new Error('图片暂时无法读取');
  if(response.headers.get('x-preview-unavailable')==='1')return {available:false,permission:permissionDenied(response)};
  return {poster:await response.blob()};
}
let thumbnailObserver;
function stopThumbnails(){thumbnailObserver?.disconnect();thumbnailQueue.clear();}
function videoPoster(url,signal) {
  return new Promise((resolve,reject)=>{
    const video=el('video');video.muted=true;video.playsInline=true;video.preload='metadata';
    let done=false;
    const finish=(error,result)=>{
      if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
      video.onloadedmetadata=video.onloadeddata=video.onseeked=video.onerror=null;video.pause();video.removeAttribute('src');video.load();
      error?reject(error):resolve(result);
    };
    const abort=()=>finish(new Error('cancelled')),timer=setTimeout(()=>finish(new Error('预览超时')),6000);
    const capture=()=>{
      if(done||video.readyState<2)return;
      if(!video.videoWidth||video.videoWidth*video.videoHeight>8_500_000){finish(new Error('视频尺寸过大'));return;}
      try {
        const canvas=el('canvas'),scale=Math.min(1,480/Math.max(video.videoWidth,video.videoHeight));
        canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
        canvas.toBlob(blob=>blob?finish(null,{poster:blob}):finish(new Error('无法读取画面')),'image/jpeg',0.65);
      }catch(error){finish(error);}
    };
    video.onloadedmetadata=()=>{
      if(video.videoWidth*video.videoHeight>8_500_000){finish(new Error('视频尺寸过大'));return;}
      video.currentTime=Math.min(0.5,Number.isFinite(video.duration)&&video.duration>0?video.duration/2:0.5);
    };
    video.onseeked=capture;video.onerror=()=>finish(new Error('无法读取画面'));
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}video.src=url;
  });
}
function showThumbnail(thumb,asset,data) {
  thumb.querySelector('.thumbnail-status')?.remove();
  if(data.poster){const img=el('img');img.alt=asset.name;const url=URL.createObjectURL(data.poster);img.onload=img.onerror=()=>URL.revokeObjectURL(url);img.src=url;thumb.replaceChildren(img);if(asset.kind==='video')thumb.append(el('span','▷','thumbnail-play'));return;}
  if(data.available===false){thumb.append(el('span',data.permission?'需要文件夹访问权限':'点击查看','thumbnail-status'));return;}
  const page=el('span',undefined,'thumbnail-page');page.setAttribute('aria-hidden','true');
  if(data.type==='markdown') {
    page.classList.add('markdown-body');page.innerHTML=renderMarkdown(data.text);
    for(const link of page.querySelectorAll('a'))link.replaceWith(...link.childNodes);
  }else page.append(el('pre',data.text));
  if(!data.text.trim())page.append(el('span','空文件'));
  thumb.classList.add('document-thumb');thumb.replaceChildren(page,el('span',asset.extension||'TXT','thumbnail-format'));
}
function observeThumbnail(thumb,asset) {
  const context=state.scope==='task'?state.context.threadId:'',key=[context,asset.id,asset.mtimeMs,asset.size,state.mediaRevision].join(':');
  const image=asset.kind==='image'||asset.kind==='video'&&asset.thumbnail;
  const route='/api/preview?'+query({id:asset.id,thumbnail:'1'}),url=media(asset,!image);
  const work=async signal=>{
    try {
      let data=thumbnailCache.get(key);
      if(!data){data=image?await imageThumbnail(url,signal):asset.kind==='video'?await videoPoster(url,signal):await api(route,{signal});signal.throwIfAborted();if(data.available!==false){thumbnailCache.set(key,data);if(thumbnailCache.size>80)thumbnailCache.delete(thumbnailCache.keys().next().value);}}
      if(!signal.aborted&&thumb.isConnected)showThumbnail(thumb,asset,data);
    }catch(error){if(!signal.aborted&&thumb.isConnected){thumb.querySelector('.thumbnail-status')?.remove();thumb.append(el('span','点击查看','thumbnail-status'));}}
  };
  thumb.loadThumbnail=()=>thumbnailQueue.add(work);thumbnailObserver.observe(thumb);
}
function paint() {
  stopThumbnails();thumbnailObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){thumbnailObserver.unobserve(entry.target);entry.target.loadThumbnail();delete entry.target.loadThumbnail;}},{root:document.querySelector('.asset-scroll'),rootMargin:'80px'});
  $('assetGrid').replaceChildren();
  for(const a of state.assets) {
    const card=el('article',undefined,'asset-card');card.dataset.assetId=a.id;
    const thumb=el('button',undefined,'asset-thumb');thumb.type='button';thumb.setAttribute('aria-label',`打开 ${a.name}`);
    const cover=el('span',undefined,'file-cover '+a.previewType);cover.append(el('span',({image:'▧',markdown:'M↓',video:'▷',audio:'♫',code:'{ }',pdf:'PDF',office:'▤'})[a.previewType]||'≡','cover-symbol'),el('span',a.extension||'FILE','cover-type'));thumb.append(cover);
    thumb.onclick=()=>openPreview(a);
    const body=el('div',undefined,'card-body'),title=el('span',a.name,'card-title');title.title=a.name;body.append(title,el('span',`${a.extension} · ${bytes(a.size)}`,'card-meta'));
    const insert=el('button','插入','card-insert');insert.setAttribute('aria-label',`插入 ${a.name} 到任务`);insert.onclick=()=>insertAsset(a);
    card.append(thumb,body,insert);$('assetGrid').append(card);
    if(a.kind==='image'||['markdown','code','document','html'].includes(a.previewType)||a.kind==='video'&&(a.thumbnail||a.size<=128*1024*1024))observeThumbnail(thumb,a);
  }
  $('emptyState').hidden=state.assets.length>0;
  if(!state.assets.length) {
    if(state.scope==='task'&&state.context.hostId!=='local')empty('远程任务资产暂不可用','可在原生远程对话中使用附件。');
    else if(state.scope==='task')empty('当前任务暂无可用资产','任务产出与引用会显示在这里。');
    else if(!source())empty('导入一个文件夹','选择本地文件夹或 Eagle 文件夹。',true);
    else if(source().status==='scanning')empty('正在扫描文件夹','可以取消扫描，稍后再继续。');
    else if(['error','partial','cancelled','interrupted','unscanned'].includes(source().status))empty('资产尚未完整读取',source().message||'点击刷新重新扫描。');
    else if(state.folder&&!$('searchInput').value&&!$('typeSelect').value&&!$('tagSelect').value)empty('这个文件夹还没有资产','选择其他文件夹继续浏览。');
    else empty('没有符合条件的资产','调整筛选条件，或刷新文件夹。');
  }
  $('resultCount').textContent=`${state.total} 个资产`;$('pageLabel').textContent=state.total?`${Math.floor(state.offset/60)+1} / ${Math.ceil(state.total/60)}`:'';
  $('previousButton').disabled=state.offset===0||state.loading;$('nextButton').disabled=state.offset+60>=state.total||state.loading;
}
async function load({ quiet = false } = {}) {
  const request=++state.request;state.controller?.abort();state.controller=new AbortController();state.loading=true;$('assetGrid').setAttribute('aria-busy','true');
  try {
    if((state.scope!=='task'&&!state.sourceId)||(state.scope==='task'&&(!state.context.threadId||state.context.hostId!=='local'))){state.assets=[];state.total=0;paint();return;}
    const q=query({scope:state.scope,sourceId:state.sourceId,offset:String(state.offset),query:$('searchInput').value,kind:$('typeSelect').value,
      ...(state.scope==='eagle'?{folderId:state.folder}:{folder:state.folder}),tag:$('tagSelect').value});
    const data=await api('/api/assets?'+q,{signal:state.controller.signal});if(request!==state.request)return;
    if(data.total&&state.offset>=data.total){state.offset=Math.floor((data.total-1)/60)*60;return load();}
    const changed=state.total!==data.total||JSON.stringify(state.assets)!==JSON.stringify(data.assets);
    state.assets=data.assets;state.total=data.total;if(!quiet||changed)paint();notice(data.partial?'当前任务记录仅核对了部分内容':'');
  }catch(error){if(error.name!=='AbortError'&&request===state.request){notice(error.message+(state.assets.length?'；已保留上次结果':''),true);if(!state.assets.length)empty('读取失败','点击刷新重试。');}}
  finally{if(request===state.request){state.loading=false;$('assetGrid').setAttribute('aria-busy','false');$('previousButton').disabled=state.offset===0;$('nextButton').disabled=state.offset+60>=state.total;}}
}
function resetFilters() {state.offset=0;for(const id of ['searchInput','typeSelect','tagSelect'])$(id).value='';}
function layout() {
  $('assetGrid').classList.toggle('list',state.layout==='list');$('layoutButton').textContent=state.layout==='list'?'网格':'列表';$('layoutButton').setAttribute('aria-pressed',String(state.layout==='list'));
  document.documentElement.style.setProperty('--tile-size',state.tileSize+'px');$('tileSize').value=String(state.tileSize);$('tileSize').disabled=state.layout==='list';
}
async function selectSource(id,folder='') {
  const selection=++state.selection,sameSource=state.sourceId===id;closePreview();state.controller?.abort();state.sourceId=id;state.scope=source()?.kind||'folder';state.folder=folder;
  state.assets=[];state.total=0;
  if(!sameSource){state.facetsKey='';state.facets={folders:[],tags:[]};state.eagleFolders=[];state.folderIssue=false;}
  resetFilters();paintSources();paint();
  await saveView();if(selection!==state.selection)return;await refreshFacets();if(selection!==state.selection)return;await load();
}
async function restoreBrowsing({ followTask = false } = {}) {
  const selection=++state.selection;state.controller?.abort();closePreview();await saves.catch(()=>{});
  const [sources,saved]=await Promise.all([api('/api/sources'),state.context.hostId==='local'?api('/api/view?'+new URLSearchParams({projectId:state.context.projectId})):Promise.resolve({view:{}})]);
  if(selection!==state.selection)return;state.sources=sources.sources;Object.assign(state,restoreView(followTask ? { ...saved.view, scope: 'task', projectId: state.context.projectId } : saved.view,state.sources,state.context));
  if(followTask)await saveView();if(selection!==state.selection)return;
  state.facetsKey='';state.facets={folders:[],tags:[]};state.eagleFolders=[];state.folderIssue=false;state.assets=[];state.total=0;resetFilters();layout();await refreshFacets();
  if(selection!==state.selection)return;paintSources();await load();
  if(!state.poll&&state.sources.some(s=>s.status==='scanning'))state.poll=setTimeout(poll,1000);
}
let importLookup=0,loadedEagleRoot='';
function clearEagleFolders() {
  ++importLookup;loadedEagleRoot='';$('eagleFolderSelect').replaceChildren();$('eagleFolderLabel').hidden=true;
  $('loadEagleFolders').disabled=false;$('importSubmit').disabled=$('importKind').value==='eagle';
}
function syncImportKind() {
  const eagle=$('importKind').value==='eagle';
  if(eagle&&!$('rootInput').value.trim())$('rootInput').value=(source()?.kind==='eagle'?source():state.sources.find(s=>s.kind==='eagle'))?.root||'';
  $('rootLabel').textContent=eagle?'Eagle 资料库路径':'文件夹路径';
  $('rootInput').placeholder=eagle?'粘贴 .library 资料库的完整路径':'粘贴文件夹的完整路径';
  $('importHelp').hidden=!eagle;$('loadEagleFolders').hidden=!eagle;
  $('importError').textContent='';clearEagleFolders();
}
function openImport() {$('bindLabel').hidden=!state.context.projectId;syncImportKind();$('importDialog').showModal();$('rootInput').focus();}
$('importButton').onclick=$('emptyImport').onclick=openImport;
$('importKind').onchange=syncImportKind;
$('rootInput').oninput=()=>{if($('importKind').value==='eagle')clearEagleFolders();$('importError').textContent='';};
$('eagleFolderSelect').onchange=()=>$('importSubmit').disabled=!$('eagleFolderSelect').value;
$('loadEagleFolders').onclick=()=>run(async()=>{
  const root=$('rootInput').value.trim();
  if(!root){$('importError').textContent='请先输入 Eagle 资料库路径';$('rootInput').focus();return;}
  const request=++importLookup;$('loadEagleFolders').disabled=true;$('importError').textContent='';
  try {
    const data=await api('/api/eagle-folders',{method:'POST',body:JSON.stringify({root})});
    if(request!==importLookup||!$('importDialog').open||$('importKind').value!=='eagle')return;
    loadedEagleRoot=data.root;$('rootInput').value=data.root;
    const select=$('eagleFolderSelect');select.replaceChildren(new Option('选择 Eagle 文件夹',''),new Option('整个资料库','__all__'));
    for(const folder of data.folders)select.add(new Option(folder.path,folder.id));
    select.value='';$('eagleFolderLabel').hidden=false;select.focus();
  }catch(error){if(request===importLookup)$('importError').textContent=error.message;}
  finally{if(request===importLookup)$('loadEagleFolders').disabled=false;}
});
$('importForm').onsubmit=async event=>{
  event.preventDefault();
  const eagle=$('importKind').value==='eagle',root=$('rootInput').value.trim();
  if(eagle&&(!loadedEagleRoot||root!==loadedEagleRoot||!$('eagleFolderSelect').value)){$('importError').textContent='请先读取并选择 Eagle 文件夹';return;}
  $('importSubmit').disabled=true;
  try {
    const result=await api('/api/sources',{method:'POST',body:JSON.stringify({root,name:$('nameInput').value.trim(),projectId:$('bindProject').checked?state.context.projectId:'',...(eagle?{eagleFolderId:$('eagleFolderSelect').value==='__all__'?'':$('eagleFolderSelect').value}:{})})});
    $('importDialog').close();await refreshSources();await selectSource(result.source.id);$('importForm').reset();syncImportKind();
  }catch(error){$('importError').textContent=error.message;}finally{$('importSubmit').disabled=$('importKind').value==='eagle'?!$('eagleFolderSelect').value:false;}
};
$('taskButton').onclick=()=>run(async()=>{++state.selection;closePreview();state.controller?.abort();state.scope='task';state.sourceId='';state.folder='';state.assets=[];state.total=0;resetFilters();await saveView();await refreshFacets();paint();await load();});
$('scanButton').onclick=()=>run(async()=>{state.mediaRevision=Date.now();if(state.scope==='task')await load();else{await api(`/api/sources/${state.sourceId}/scan`,{method:'POST'});await refreshSources();if(source()?.status!=='scanning')await load();}});
$('cancelScan').onclick=()=>run(async()=>{await api(`/api/sources/${state.sourceId}/cancel`,{method:'POST'});await refreshSources();});
$('removeButton').onclick=()=>$('removeDialog').showModal();
$('confirmRemove').onclick=()=>run(async()=>{const id=state.sourceId;await api(`/api/sources/${id}`,{method:'DELETE'});$('removeDialog').close();state.sources=state.sources.filter(s=>s.id!==id);await selectSource(state.sources[0]?.id||'');});
let searchTimer;$('searchInput').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.offset=0;load();},220);};
for(const id of ['typeSelect','tagSelect'])$(id).onchange=()=>{state.offset=0;load();};
$('previousButton').onclick=()=>{state.offset=Math.max(0,state.offset-60);load();};$('nextButton').onclick=()=>{state.offset+=60;load();};
$('layoutButton').onclick=()=>{state.layout=state.layout==='list'?'grid':'list';layout();void saveView();};
$('tileSize').oninput=()=>{state.tileSize=Number($('tileSize').value);layout();};$('tileSize').onchange=()=>void saveView();

function clearPreview() {
  state.previewController?.abort();state.previewController=null;
  for(const node of $('previewStage').querySelectorAll('video,audio')){node.pause();node.removeAttribute('src');node.load();}
  $('previewStage').replaceChildren();$('previewStage').className='';$('readingMode').hidden=true;
  if(state.blob)URL.revokeObjectURL(state.blob);state.blob=null;state.preview=null;state.previewData=null;
}
function closePreview(){if($('previewDialog').open)$('previewDialog').close();clearPreview();}
$('previewDialog').addEventListener('close',()=>{if(!$('previewDialog').open)clearPreview();});
function showReading(raw=false) {
  if(!state.previewData)return;const data=state.previewData;
  $('renderedButton').setAttribute('aria-pressed',String(!raw));$('rawButton').setAttribute('aria-pressed',String(raw));
  if(data.type==='markdown'&&!raw){const article=el('article',undefined,'markdown-body');article.innerHTML=renderMarkdown(data.text);$('previewStage').replaceChildren(article);}
  else $('previewStage').replaceChildren(el('pre',data.text,'source-text'));
  $('previewStage').scrollTop=0;
}
$('renderedButton').onclick=()=>showReading(false);$('rawButton').onclick=()=>showReading(true);
async function openPreview(asset) {
  clearPreview();state.preview=asset;const controller=new AbortController();state.previewController=controller;
  $('previewTitle').textContent=asset.name;$('previewFormat').textContent=asset.extension==='JSON'?'JSON 原文':formatNames[asset.previewType]||asset.extension;
  $('previewLocation').textContent=asset.sourcePath;$('previewStage').textContent='正在读取…';$('previewNote').textContent='';
  $('annotationGroup').hidden=!asset.annotation;$('annotation').textContent=asset.annotation||'';$('copyProfiles').hidden=!asset.mjProfiles?.length;
  if(!$('previewDialog').open)$('previewDialog').showModal();
  try {
    await api('/api/asset?'+query({id:asset.id}),{signal:controller.signal});if(controller.signal.aborted)return;
    if(asset.kind==='image') {
      const response=await fetch(media(asset,true),{signal:controller.signal});if(!response.ok)throw new Error('图片暂时无法读取');
      if(response.headers.get('x-preview-unavailable')==='1')throw new Error(permissionDenied(response)?'需要允许文件夹访问，授权后点击刷新。':'此格式暂时无法预览，可复制路径在本机打开');
      const blob=await response.blob();if(controller.signal.aborted)return;state.blob=URL.createObjectURL(blob);
      const img=el('img');img.alt=asset.name;img.src=state.blob;$('previewStage').className='media-stage';$('previewStage').replaceChildren(img);$('previewNote').textContent='缩放预览';
    }else if(['video','audio'].includes(asset.kind)) {
      const node=el(asset.kind);node.controls=true;node.preload='metadata';node.src=media(asset,true);node.onerror=()=>{$('previewNote').textContent='此格式暂时无法播放，可复制路径在本机打开';};
      $('previewStage').className='media-stage';$('previewStage').replaceChildren(node);
    }else {
      const data=await api('/api/preview?'+query({id:asset.id}),{signal:controller.signal});if(controller.signal.aborted)return;
      state.previewData=data;$('readingMode').hidden=data.type!=='markdown';showReading(false);$('previewNote').textContent=data.truncated?'内容较长，仅显示部分':'';
    }
  }catch(error){if(!controller.signal.aborted)$('previewStage').textContent=error.message;}
}
async function insertAsset(asset) {
  const threadId=state.context.threadId,hostId=state.context.hostId;
  if(hostId!=='local'){notice('本机素材暂不能直接插入远程任务',true);return;}
  try {const {asset:current}=await api('/api/asset?'+query({id:asset.id}));if(threadId!==state.context.threadId||hostId!==state.context.hostId)throw new Error('当前任务已切换，请重新选择资产');if(window.parent===window){notice('请在工作站内插入到任务');return;}
    window.parent.postMessage({source:'asset-console',action:'use-in-codex',hostId,threadId,path:current.sourcePath,kind:current.kind,name:current.name},'*');notice('正在插入…');
  }catch(error){notice(error.message,true);}
}
$('insertPreview').onclick=()=>state.preview&&insertAsset(state.preview);
$('copyPath').onclick=async()=>{try{await navigator.clipboard.writeText(state.preview.sourcePath);$('previewNote').textContent='已复制文件路径';}catch{$('previewNote').textContent='复制失败，可选择上方路径手动复制';}};
$('copyProfiles').onclick=async()=>{const value=`--p ${state.preview.mjProfiles.join(' ')}`;try{await navigator.clipboard.writeText(value);$('previewNote').textContent='已复制 '+value;}catch{$('previewNote').textContent=value;}};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();
window.addEventListener('message',event=>run(async()=>{
  if(event.source!==window.parent||event.data?.source!=='codex-sidebar-enhancer')return;const m=event.data;
  if(m.action==='context') {
    if(!m.threadId) {
      if(m.clearTask!==true)return;
      state.context={hostId:'local',threadId:'',threadTitle:'',projectId:m.projectId||'',projectName:m.projectName||''};
      ++state.selection;++state.request;state.controller?.abort();state.loading=false;closePreview();
      $('assetGrid').setAttribute('aria-busy','false');
      if(state.scope==='task'){state.assets=[];state.total=0;state.offset=0;}
      paint();
      paintSources();return;
    }
    const followTask=state.scope==='task';
    const projectChanged=state.context.projectId!==(m.projectId||''),threadChanged=state.context.threadId!==(m.threadId||''),hostChanged=state.context.hostId!==(m.hostId||'local');
    state.context={hostId:m.hostId||'local',...Object.fromEntries(['threadId','threadTitle','projectId','projectName'].map(key=>[key,m[key]||'']))};
    if(hostChanged||projectChanged||threadChanged){
      ++state.selection;++state.request;state.controller?.abort();state.loading=false;closePreview();
      if(followTask){state.assets=[];state.total=0;state.offset=0;paint();notice('');}
      paintSources();
    }
    if(hostChanged||projectChanged)await restoreBrowsing({followTask});else if(threadChanged){closePreview();state.controller?.abort();if(state.scope==='task'){state.offset=0;await load();}}paintSources();
  }else if(m.action==='search'){$('searchInput').value=m.query||'';state.offset=0;await load();}
  else if(['asset-added','assets-added'].includes(m.action))notice('已插入到任务');
  else if(m.action==='asset-add-failed')notice('插入失败，请确认输入框可用',true);
}));
function suspend(){state.controller?.abort();stopThumbnails();closePreview();clearTimeout(state.poll);clearTimeout(searchTimer);state.poll=null;}
const taskRefresh=setInterval(()=>{
  if(!document.hidden&&state.scope==='task'&&state.context.hostId==='local'&&state.context.threadId&&!state.loading&&!state.preview)run(()=>load({quiet:true}));
},10000);
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else run(async()=>{await refreshSources();await load();});});
window.addEventListener('pagehide',()=>{clearInterval(taskRefresh);suspend();});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='k'){event.preventDefault();$('searchInput').focus();}});
try {
  if(getComputedStyle(document.documentElement).getPropertyValue('--asset-console-ui').trim()!=='ready')throw new Error('资产页面样式未加载');
  await restoreBrowsing();if(window.parent!==window)window.parent.postMessage({source:'asset-console',action:'ready'},'*');
}catch(error){notice(error.message,true);empty('资产服务暂时无法读取','请稍后重新打开资产。');if(window.parent!==window)window.parent.postMessage({source:'asset-console',action:'load-error'},'*');}
