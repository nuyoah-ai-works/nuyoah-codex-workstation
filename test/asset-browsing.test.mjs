import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssetCatalog } from '../nuyoah/assets/catalog.mjs';
import { startAssetServer } from '../nuyoah/assets/server.mjs';
import { restoreView, buildFolderTree, buildEagleFolderTree, renderMarkdown, ThumbnailQueue } from '../nuyoah/assets/public/asset-ui.js';
import { previewFile } from '../nuyoah/assets/preview.mjs';

async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'asset-browsing-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test('remote task identity cannot resolve a same-ID local task through the asset service', async t => {
  const root = await fixture(t), token = 'fixture-remote-asset-boundary-01234567890123456789'; let reads = 0;
  const app = await startAssetServer({ stateRoot: root, token, port: 0,
    taskStore: { view: async () => { reads++; return { excludedReferencePaths: [], references: [] }; } },
    automatic: { view: async () => { reads++; return { status: 'ready', references: [] }; } },
  }); t.after(() => app.close());
  const query = 'threadId=00000000-0000-4000-8000-000000000001&hostId=remote-fixture';
  for (const route of ['/api/assets?scope=task&', '/api/asset?id=fixture&', '/media?id=fixture&']) {
    const response = await fetch('http://127.0.0.1:' + app.server.address().port + route + query, { headers: { 'x-asset-console-token': token } });
    assert.equal(response.status, 400); assert.match((await response.json()).error, /远程/);
  }
  assert.equal(reads, 0);
});

test('imported sources, child folder and layout recover after a full service restart without scanning',async t=>{
  const root=await fixture(t),files=path.join(root,'files'),child=path.join(files,'notes');await mkdir(child,{recursive:true});
  await writeFile(path.join(child,'one.md'),'# Note');await writeFile(path.join(files,'settings.json'),'{"title":"raw JSON"}');
  const options={stateRoot:path.join(root,'state'),token:'test-browsing-token-01234567890123456789',port:0};
  let app=await startAssetServer(options);t.after(()=>app.close());
  const call=(route,options={})=>fetch(`http://127.0.0.1:${app.server.address().port}`+route,{...options,headers:{'x-asset-console-token':'test-browsing-token-01234567890123456789',...options.headers}});
  const added=await (await call('/api/sources',{method:'POST',body:JSON.stringify({root:files})})).json();await app.catalog.jobs.get(added.source.id)?.promise;
  const saved={scope:'folder',sourceId:added.source.id,folder:path.join(added.source.root,'notes'),layout:'list',tileSize:180};
  assert.equal((await call('/api/view?projectId=project-a',{method:'PUT',body:JSON.stringify(saved)})).status,200);
  const scannedAt=app.catalog.source(added.source.id).scannedAt;
  await app.close();app=await startAssetServer(options);
  const sources=(await (await call('/api/sources')).json()).sources,view=(await (await call('/api/view?projectId=project-a')).json()).view;
  assert.equal(sources.length,1);assert.equal(sources[0].count,2);assert.equal(sources[0].scannedAt,scannedAt);assert.equal(app.catalog.jobs.size,0);
  assert.deepEqual(restoreView(view,sources,{projectId:'project-a'}),saved);
  const list=await (await call('/api/assets?'+new URLSearchParams({sourceId:added.source.id,folder:view.folder}))).json();assert.equal(list.total,1);assert.equal(list.assets[0].name,'one.md');
  assert.equal((await (await call('/api/view')).json()).view.sourceId,added.source.id);
  const raw=(await (await call('/api/assets?'+new URLSearchParams({sourceId:added.source.id,kind:'code'}))).json()).assets[0];
  assert.equal((await (await call('/api/preview?id='+raw.id)).json()).text,'{"title":"raw JSON"}');
  await writeFile(raw.sourcePath,'{"html":"<script>inert</script>","value":"'+'x'.repeat(10000)+'"}');
  const thumbnail=await (await call('/api/preview?id='+raw.id+'&thumbnail=1')).json();
  assert.equal(thumbnail.text.length,4096);assert.equal(thumbnail.truncated,true);assert.match(thumbnail.text,/<script>inert<\/script>/);
  await writeFile(raw.sourcePath,'{"title":"raw JSON"}');
  await call('/api/sources/'+added.source.id,{method:'DELETE'});
  assert.equal(restoreView(view,[],{}).sourceId,'');assert.equal(await readFile(raw.sourcePath,'utf8'),'{"title":"raw JSON"}');
  assert.equal((await call('/asset-ui.js')).status,200);
});

test('thumbnail text is bounded independently of the full reader and does not unpack Office files',async t=>{
  const root=await fixture(t),file=path.join(root,'long.md');await writeFile(file,'# A real heading\n'+'x'.repeat(10000));
  const short=await previewFile(file,{thumbnail:true}),full=await previewFile(file);
  assert.equal(short.text.length,4096);assert.equal(short.truncated,true);assert.ok(full.text.length>4096);assert.equal(full.truncated,false);
  const office=path.join(root,'not-a-zip.docx');await writeFile(office,'invalid compressed data');
  assert.equal((await previewFile(office,{thumbnail:true})).available,false);
});

test('thumbnail queue caps concurrent reads and cancels old pages before loading a new page',async()=>{
  const queue=new ThumbnailQueue(),started=[],aborted=[],release=[];let active=0,peak=0;
  const hold=id=>signal=>new Promise(resolve=>{
    active++;peak=Math.max(peak,active);started.push(id);
    signal.addEventListener('abort',()=>aborted.push(id),{once:true});release.push(()=>{active--;resolve();});
  });
  queue.add(hold('old-1'));queue.add(hold('old-2'));queue.add(hold('old-3'));
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(started,['old-1','old-2']);
  queue.clear();queue.add(hold('new'));await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(aborted,['old-1','old-2']);assert.deepEqual(started,['old-1','old-2']);
  release[0]();release[1]();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(started,['old-1','old-2','new']);assert.equal(peak,2);release[2]();queue.clear();
});

test('first opening chooses an existing source and project restoration cannot retain a removed one',()=>{
  const sources=[{id:'one',kind:'folder',projectId:''},{id:'two',kind:'eagle',projectId:'p'}];
  assert.equal(restoreView({},sources,{}).sourceId,'one');
  assert.equal(restoreView({},sources,{projectId:'p'}).sourceId,'two');
  assert.equal(restoreView({sourceId:'removed',folder:'old'},sources,{}).folder,'');
  assert.equal(restoreView({sourceId:'two',scope:'eagle',folder:'角色'},sources,{}).folder,'角色');
  assert.equal(restoreView({scope:'task',projectId:'p'},sources,{projectId:'p',threadId:'task'}).scope,'task');
  assert.equal(restoreView({scope:'task',projectId:'p'},sources,{projectId:'p'}).sourceId,'two');
});

test('folder navigation includes descendants without prefix collisions or repeated assets',async t=>{
  const root=await fixture(t);for(const name of ['角色','角色/衣服','角色设计']){await mkdir(path.join(root,name),{recursive:true});await writeFile(path.join(root,name,'note.md'),name);}
  const catalog=await AssetCatalog.open(path.join(root,'.state'));t.after(()=>catalog.close());const s=await catalog.add({root});await catalog.scan(s.id).promise;
  const paths=catalog.facets(s.id).folders,tree=buildFolderTree(paths,s);
  assert.equal(tree.length,2);assert.equal(tree[0].label,'角色');assert.equal(tree[0].children[0].label,'衣服');
  assert.equal(catalog.list({sourceId:s.id,folder:path.join(s.root,'角色')}).total,2);
  assert.equal(catalog.list({sourceId:s.id,folder:path.join(s.root,'角色设计')}).total,1);
  const a=catalog.list().assets[0];a.directories=['人物/角色','人物/衣服'];a.directory=a.directories.join(' · ');catalog.db.prepare('UPDATE assets SET data=? WHERE id=?').run(JSON.stringify(a),a.id);
  assert.equal(catalog.list({sourceId:s.id,folder:'人物'}).total,1);assert.equal(catalog.list({sourceId:s.id,folder:'人物/衣服'}).total,1);
});

test('Eagle navigation keeps virtual folder IDs, empty children and the imported root',()=>{
  const folders=[
    {id:'ROOT',name:'图片资产',parentId:'',path:'图片资产'},
    {id:'A',name:'角色',parentId:'ROOT',path:'图片资产/角色'},
    {id:'EMPTY',name:'空目录',parentId:'A',path:'图片资产/角色/空目录'},
    {id:'B',name:'角色',parentId:'ROOT',path:'图片资产/角色'}
  ];
  const tree=buildEagleFolderTree(folders,'ROOT');
  assert.deepEqual(tree.map(node=>[node.label,node.value]),[['角色','A'],['角色','B']]);
  assert.deepEqual(tree[0].children.map(node=>[node.label,node.value]),[['空目录','EMPTY']]);
  assert.deepEqual(buildEagleFolderTree(folders).map(node=>node.value),['ROOT']);
});

test('Markdown has readable structure while code, raw HTML and active URLs remain inert',()=>{
  const html=renderMarkdown('# 标题\n\n正文 **强调** 与 `x < y`。\n\n- 一\n- 二\n\n> 引用\n\n```json\n{"tag":"<script>bad()</script>"}\n```\n\n| 名称 | 值 |\n| --- | --- |\n| 样例 | 2 |\n\n<img src=x onerror=bad()>\n\n[外链](https://example.com/a) [危险](javascript:bad) ![远程图片](https://example.com/track.png)');
  for(const tag of ['h1','strong','code','ul','li','blockquote','pre','table','th','td'])assert.ok(html.includes('<'+tag+'>'),tag);
  assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.ok(html.includes('href="https://example.com/a"'));assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(!/<(?:img|script|iframe)\b/i.test(html));assert.ok(!/href="javascript:/i.test(html));
  assert.ok(html.includes('图片：远程图片'));assert.ok(!html.includes('track.png'));
  assert.match(renderMarkdown('```\n# not a heading\n```'),/<pre><code># not a heading<\/code><\/pre>/);
});
