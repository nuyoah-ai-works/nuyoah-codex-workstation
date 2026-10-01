import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, rename, symlink, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { AssetCatalog, listEagleFolders, scanFolder } from '../nuyoah/assets/catalog.mjs';
import { startAssetServer } from '../nuyoah/assets/server.mjs';
import { byteRange, MEDIA_CHUNK } from '../nuyoah/assets/previews.mjs';
import { AssetConsoleBridge } from '../lib/asset-console-bridge.mjs';
import { createServer } from 'node:http';

async function fixture(t) { const root=await mkdtemp(path.join(os.tmpdir(),'asset-v2-'));t.after(()=>rm(root,{recursive:true,force:true}));return root; }
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=','base64');

test('explicit sources paginate, overlap by path, preserve same-content files and survive restart',async t=>{
  const root=await fixture(t),files=path.join(root,'files'),child=path.join(files,'child');await mkdir(child,{recursive:true});
  await Promise.all(Array.from({length:135},(_,i)=>writeFile(path.join(child,`asset-${i}.txt`),'same content')));
  await writeFile(path.join(child,'.private.json'),'hidden');await mkdir(path.join(child,'node_modules'));await writeFile(path.join(child,'node_modules','x.js'),'dependency');
  let catalog=await AssetCatalog.open(path.join(root,'state'));assert.deepEqual(catalog.sources(),[]);
  const a=await catalog.add({root:files}),b=await catalog.add({root:child});
  await catalog.scan(a.id).promise;await catalog.scan(b.id).promise;
  assert.equal(catalog.list().total,135);assert.equal(catalog.list({limit:999}).assets.length,60);
  assert.equal(catalog.list({sourceId:a.id,offset:120}).assets.length,15);
  assert.equal(catalog.list({sourceId:a.id}).assets[0].directory,catalog.list({sourceId:b.id}).assets[0].directory,'overlapping sources cannot overwrite location semantics');
  assert.equal(catalog.list({query:'same content'}).total,0,'index does not read file bodies');
  assert.equal(catalog.list({query:'asset-1'}).total,46);
  const existing=catalog.list().assets[0];await catalog.close();catalog=await AssetCatalog.open(path.join(root,'state'));
  try {assert.equal(catalog.list().total,135);catalog.remove(a.id);assert.equal(catalog.list().total,135);catalog.remove(b.id);assert.equal(catalog.list().total,0);assert.equal(await readFile(existing.sourcePath,'utf8'),'same content');}
  finally{await catalog.close();}
});

test('Eagle honors item identities and deletion markers, and excludes internal files',async t=>{
  const root=await fixture(t),library=path.join(root,'fixture.library');await mkdir(path.join(library,'images'),{recursive:true});
  await writeFile(path.join(library,'metadata.json'),JSON.stringify({folders:[{id:'characters',name:'角色'}]}));
  for(const [id,deleted] of [['ONE',false],['TWO',false],['DELETED',true]]){
    const dir=path.join(library,'images',`${id}.info`);await mkdir(dir);
    await writeFile(path.join(dir,'metadata.json'),JSON.stringify({id,name:'same-name',ext:'png',isDeleted:deleted,tags:['角色'],folders:['characters'],annotation:'fixture annotation'}));
    await writeFile(path.join(dir,'same-name.png'),png);await writeFile(path.join(dir,'same-name_thumbnail.png'),png);
  }
  const catalog=await AssetCatalog.open(path.join(root,'state'));
  try{const source=await catalog.add({root:library});assert.equal(source.kind,'eagle');await catalog.scan(source.id).promise;
    const list=catalog.list({sourceId:source.id});assert.equal(list.total,2);assert.equal(new Set(list.assets.map(a=>a.id)).size,2);
    assert.ok(list.assets.every(a=>a.name==='same-name.png'&&a.origin==='eagle'&&a.directory==='角色'));
    assert.deepEqual(catalog.facets(source.id),{folders:['角色'],tags:['角色']});assert.equal(catalog.list({tag:'角色'}).total,2);
    await assert.rejects(catalog.add({root:path.join(library,'images')}),/资料库本身/);
    const metadata=path.join(library,'images','ONE.info','metadata.json');const data=JSON.parse(await readFile(metadata));data.isDeleted=true;await writeFile(metadata,JSON.stringify(data));await catalog.scan(source.id).promise;assert.equal(catalog.list().total,1);
  }finally{await catalog.close();}
});

test('Eagle virtual folder sources use IDs, include descendants, and retain scoped results on failure',async t=>{
  const root=await fixture(t),library=path.join(root,'fixture.library'),images=path.join(library,'images');
  await mkdir(images,{recursive:true});
  const folders=[
    {id:'PARENT',name:'角色',children:[{id:'CHILD',name:'主角'}]},
    {id:'OTHER',name:'其他',children:[{id:'TWIN',name:'主角'}]}
  ];
  const metadataPath=path.join(library,'metadata.json');
  await writeFile(metadataPath,JSON.stringify({folders}));
  const writeItem=async(id,folderIds,deleted=false)=>{
    const dir=path.join(images,`${id}.info`);await mkdir(dir,{recursive:true});
    await writeFile(path.join(dir,'metadata.json'),JSON.stringify({id,name:id,ext:'png',isDeleted:deleted,folders:folderIds,tags:[]}));
    await writeFile(path.join(dir,`${id}.png`),png);
  };
  await writeItem('DIRECT',['PARENT']);
  await writeItem('DESCENDANT',['CHILD']);
  await writeItem('MULTI',['CHILD','OTHER']);
  await writeItem('TWIN_ITEM',['TWIN']);
  await writeItem('DELETED',['CHILD'],true);
  assert.deepEqual((await listEagleFolders(library)).folders,[
    {id:'PARENT',path:'角色'},{id:'CHILD',path:'角色/主角'},
    {id:'OTHER',path:'其他'},{id:'TWIN',path:'其他/主角'}
  ]);
  const catalog=await AssetCatalog.open(path.join(root,'state'));
  try {
    const whole=await catalog.add({root:library}),parent=await catalog.add({root:library,eagleFolderId:'PARENT'}),
      child=await catalog.add({root:library,eagleFolderId:'CHILD'}),twin=await catalog.add({root:library,eagleFolderId:'TWIN'});
    assert.equal(parent.kind,'eagle');assert.equal(parent.name,'角色');assert.equal(child.name,'角色/主角');
    assert.equal(child.eagleFolderId,'CHILD');assert.equal((await catalog.add({root:library,eagleFolderId:'CHILD'})).id,child.id);
    assert.equal(new Set([whole.id,parent.id,child.id,twin.id]).size,4);
    for(const source of [whole,parent,child,twin])await catalog.scan(source.id).promise;
    const names=id=>catalog.list({sourceId:id,limit:60}).assets.map(item=>item.name).sort();
    assert.deepEqual(names(whole.id),['DESCENDANT.png','DIRECT.png','MULTI.png','TWIN_ITEM.png']);
    assert.deepEqual(names(parent.id),['DESCENDANT.png','DIRECT.png','MULTI.png']);
    assert.deepEqual(names(child.id),['DESCENDANT.png','MULTI.png']);
    assert.deepEqual(names(twin.id),['TWIN_ITEM.png'],'same visible name cannot merge folder IDs');
    await assert.rejects(catalog.add({root:library,eagleFolderId:'MISSING'}),/不存在/);
    await assert.rejects(catalog.add({root:images,eagleFolderId:'CHILD'}),/资料库本身/);
    await writeItem('DESCENDANT',['OTHER']);
    await catalog.scan(child.id).promise;
    assert.deepEqual(names(child.id),['MULTI.png']);
    assert.deepEqual(names(parent.id),['DESCENDANT.png','DIRECT.png','MULTI.png'],'other sources keep their previous snapshots');
    await catalog.scan(child.id,{maxFiles:1}).promise;
    assert.equal(catalog.source(child.id).status,'partial');
    assert.deepEqual(names(child.id),['MULTI.png'],'partial scans cannot erase prior membership');
    const job=catalog.scan(child.id);catalog.cancel(child.id);await job.promise;
    assert.equal(catalog.source(child.id).status,'cancelled');
    assert.deepEqual(names(child.id),['MULTI.png']);
    await writeFile(metadataPath,JSON.stringify({folders:[{id:'OTHER',name:'其他',children:[{id:'TWIN',name:'主角'}]}]}));
    await catalog.scan(child.id).promise;
    assert.equal(catalog.source(child.id).status,'error');
    assert.match(catalog.source(child.id).message,/不存在/);
    assert.deepEqual(names(child.id),['MULTI.png'],'missing selected ID must not fall back to the full library');
    await rm(metadataPath);
    await catalog.scan(whole.id).promise;
    assert.equal(catalog.source(whole.id).status,'error');
    assert.deepEqual(names(whole.id),['DESCENDANT.png','DIRECT.png','MULTI.png','TWIN_ITEM.png'],
      'an unavailable Eagle library must not be traversed as an ordinary folder');
  } finally { await catalog.close(); }
});

test('Eagle navigation preserves empty folders and filters duplicate names by ID after restart',async t=>{
  const root=await fixture(t),library=path.join(root,'fixture.library'),images=path.join(library,'images');
  await mkdir(images,{recursive:true});
  const metadataPath=path.join(library,'metadata.json');
  await writeFile(metadataPath,JSON.stringify({folders:[
    {id:'ROOT',name:'图片资产',children:[
      {id:'A',name:'角色',children:[{id:'EMPTY',name:'空目录'}]},
      {id:'B',name:'角色'}
    ]},
    {id:'OUTSIDE',name:'其他'}
  ]}));
  for(const [id,folders] of [['ROOT_ITEM',['ROOT']],['A_ITEM',['A']],['B_ITEM',['B']],['MULTI',['A','OUTSIDE']],['OUTSIDE_ITEM',['OUTSIDE']]]){
    const dir=path.join(images,`${id}.info`);await mkdir(dir);
    await writeFile(path.join(dir,'metadata.json'),JSON.stringify({id,name:id,ext:'png',folders,tags:[]}));
    await writeFile(path.join(dir,`${id}.png`),png);
  }
  const token='fixture-local-asset-token-01234567890123456789',options={stateRoot:path.join(root,'state'),token,port:0};
  let app=await startAssetServer(options);
  const call=(route,request={})=>fetch(`http://127.0.0.1:${app.server.address().port}`+route,
    {...request,headers:{'x-asset-console-token':token,...request.headers}});
  try{
    const result=await (await call('/api/sources',{method:'POST',body:JSON.stringify({root:library,eagleFolderId:'ROOT'})})).json();
    const sourceId=result.source.id;await app.catalog.jobs.get(sourceId).promise;
    const folderRoute=`/api/sources/${sourceId}/folders`;
    assert.equal((await fetch(`http://127.0.0.1:${app.server.address().port}`+folderRoute)).status,403);
    const folders=(await (await call(folderRoute)).json()).folders;
    assert.deepEqual(folders.map(folder=>folder.id),['ROOT','A','EMPTY','B']);
    assert.ok(!folders.some(folder=>folder.id==='OUTSIDE'));
    assert.ok(app.catalog.facets(sourceId).folders.includes('其他'),'a multiply assigned asset still carries its other Eagle location');
    const names=async folderId=>{
      const response=await call('/api/assets?'+new URLSearchParams({sourceId,folderId}));
      assert.equal(response.status,200);
      return (await response.json()).assets.map(asset=>asset.name).sort();
    };
    assert.deepEqual(await names('ROOT'),['A_ITEM.png','B_ITEM.png','MULTI.png','ROOT_ITEM.png']);
    assert.deepEqual(await names('A'),['A_ITEM.png','MULTI.png']);
    assert.deepEqual(await names('B'),['B_ITEM.png']);
    assert.deepEqual(await names('EMPTY'),[]);
    assert.equal((await call('/api/assets?'+new URLSearchParams({sourceId,folderId:'OUTSIDE'}))).status,400);
    const view={scope:'eagle',sourceId,folder:'A',layout:'grid',tileSize:140};
    assert.equal((await call('/api/view',{method:'PUT',body:JSON.stringify(view)})).status,200);
    await app.close();await rm(metadataPath);app=await startAssetServer(options);
    assert.deepEqual((await (await call(folderRoute)).json()).folders.map(folder=>folder.id),['ROOT','A','EMPTY','B']);
    assert.equal((await (await call('/api/view')).json()).view.folder,'A');
    assert.deepEqual(await names('A'),['A_ITEM.png','MULTI.png']);
    assert.equal(app.catalog.jobs.size,0,'reopening the saved folder tree must not rescan Eagle files');
  }finally{await app.close();}
});

test('legacy catalog migrates to multiple Eagle sources without losing memberships or saved view',async t=>{
  const root=await fixture(t),library=path.join(root,'fixture.library'),state=path.join(root,'state');
  await mkdir(path.join(library,'images'),{recursive:true});await mkdir(state);
  await writeFile(path.join(library,'metadata.json'),JSON.stringify({folders:[{id:'CHILD',name:'主角'}]}));
  const db=new DatabaseSync(path.join(state,'catalog.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE sources(id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
      projectId TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unscanned', message TEXT NOT NULL DEFAULT '', scannedAt TEXT);
    CREATE TABLE assets(id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, mtime REAL NOT NULL, data TEXT NOT NULL);
    CREATE TABLE membership(sourceId TEXT REFERENCES sources(id) ON DELETE CASCADE, assetId TEXT REFERENCES assets(id) ON DELETE CASCADE,
      PRIMARY KEY(sourceId,assetId));
    CREATE TABLE views(key TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  db.prepare('INSERT INTO sources VALUES(?,?,?,?,?,?,?,?)').run('original','Existing Eagle',library,'eagle','project-a','ready','', '2026-09-24T00:00:00.000Z');
  db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?)').run('asset-a',path.join(library,'images','A.info','A.png'),'A.png','image',1,JSON.stringify({id:'asset-a',name:'A.png'}));
  db.prepare('INSERT INTO membership VALUES(?,?)').run('original','asset-a');
  db.prepare('INSERT INTO views VALUES(?,?)').run('project-a',JSON.stringify({sourceId:'original',folder:'主角'}));
  db.close();
  const catalog=await AssetCatalog.open(state);
  try {
    assert.equal(catalog.source('original').eagleFolderId,'');
    assert.equal(catalog.source('original').status,'ready');
    assert.equal(catalog.list({sourceId:'original'}).total,1);
    assert.equal(catalog.view('project-a').sourceId,'original');
    const child=await catalog.add({root:library,eagleFolderId:'CHILD'});
    assert.notEqual(child.id,'original');
    assert.equal(catalog.list({sourceId:'original'}).total,1);
    assert.deepEqual(catalog.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { await catalog.close(); }
});

test('Eagle folder discovery API is authenticated and creates a scoped source',async t=>{
  const root=await fixture(t),library=path.join(root,'fixture.library'),stateRoot=path.join(root,'state');
  await mkdir(path.join(library,'images'),{recursive:true});await mkdir(stateRoot);
  await writeFile(path.join(library,'metadata.json'),JSON.stringify({folders:[{id:'F',name:'角色'}]}));
  const token='fixture-local-asset-token-01234567890123456789';
  const app=await startAssetServer({stateRoot,token,port:0});t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=(route,options={})=>fetch(base+route,{...options,headers:{'x-asset-console-token':token,...options.headers}});
  const body=JSON.stringify({root:library});
  assert.equal((await fetch(base+'/api/eagle-folders',{method:'POST',body})).status,403);
  const folders=await (await call('/api/eagle-folders',{method:'POST',body})).json();
  assert.deepEqual(folders,{root:await realpath(library),folders:[{id:'F',path:'角色'}]});
  const result=await (await call('/api/sources',{method:'POST',body:JSON.stringify({root:library,eagleFolderId:'F'})})).json();
  assert.equal(result.source.eagleFolderId,'F');assert.equal(result.source.name,'角色');
  await app.catalog.jobs.get(result.source.id)?.promise;
  assert.equal((await (await call(`/api/assets?sourceId=${result.source.id}`)).json()).total,0);
});

test('partial, unavailable and cancelled scans keep prior results; symlink swaps cannot serve files',async t=>{
  const root=await fixture(t),files=path.join(root,'files');await mkdir(files);await writeFile(path.join(files,'one.txt'),'one');await writeFile(path.join(files,'two.txt'),'two');
  const catalog=await AssetCatalog.open(path.join(root,'state'));
  try{const s=await catalog.add({root:files});await catalog.scan(s.id).promise;const old=catalog.list().assets.find(a=>a.name==='one.txt');
    await catalog.scan(s.id,{maxFiles:1}).promise;assert.equal(catalog.source(s.id).status,'partial');assert.equal(catalog.list().total,2);
    const job=catalog.scan(s.id);catalog.cancel(s.id);await job.promise;assert.equal(catalog.source(s.id).status,'cancelled');assert.equal(catalog.list().total,2);
    await rename(files,files+'-offline');await catalog.scan(s.id).promise;assert.equal(catalog.source(s.id).status,'error');assert.equal(catalog.list().total,2);
    await rename(files+'-offline',files);await rm(old.sourcePath);const outside=path.join(root,'outside.txt');await writeFile(outside,'private');await symlink(outside,old.sourcePath);await assert.rejects(catalog.resolve(old.id),/失效/);
  }finally{await catalog.close();}
});

test('service does not read legacy imports; source writes are absent, media is bounded, and task references stay scoped',async t=>{
  const root=await fixture(t),files=path.join(root,'files'),stateRoot=path.join(root,'state');await mkdir(files);await mkdir(stateRoot);
  const textFile=path.join(files,'notes.md'),image=path.join(files,'image.png'),video=path.join(files,'clip.mp4');await writeFile(textFile,'# Test');await writeFile(image,png);await writeFile(video,Buffer.alloc(3*MEDIA_CHUNK,1));
  await writeFile(path.join(stateRoot,'asset-browser.config.json'),JSON.stringify({projects:[{id:'legacy',path:files}],deduplication:{enabled:true}}));
  const token='fixture-local-asset-token-01234567890123456789';const id='00000000-0000-0000-0000-000000000001';
  const app=await startAssetServer({stateRoot,token,port:0,taskStore:{view:async()=>({references:[{path:textFile,label:'Note',relation:'reference'}],excludedReferencePaths:[]})},automatic:{view:async()=>({status:'ready',references:[]})}});
  t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=(route,options={})=>fetch(base+route,{...options,headers:{'x-asset-console-token':token,...options.headers}});
  assert.equal((await fetch(base+'/api/sources')).status,403);assert.equal((await call('/api/sources',{headers:{origin:'https://untrusted.invalid'}})).status,403);
  assert.deepEqual((await (await call('/api/sources')).json()).sources,[]);
  const added=await (await call('/api/sources',{method:'POST',body:JSON.stringify({root:files})})).json();await app.catalog.jobs.get(added.source.id)?.promise;
  const list=await (await call('/api/assets?sourceId='+added.source.id)).json();assert.equal(list.total,3);
  const photo=list.assets.find(a=>a.kind==='image'),movie=list.assets.find(a=>a.kind==='video');
  const thumb=await call('/media?id='+photo.id);assert.equal(thumb.status,200);assert.ok((await thumb.arrayBuffer()).byteLength<512*1024);
  const media=await call('/media?id='+movie.id,{headers:{range:'bytes=0-'}});assert.equal(media.status,206);assert.equal((await media.arrayBuffer()).byteLength,MEDIA_CHUNK);
  assert.equal((await call('/media?id='+movie.id,{headers:{range:'bytes=999999999-'}})).status,416);
  for(const [method,route] of [['PUT','/api/text'],['POST','/api/assets/rename'],['DELETE','/api/assets/delete'],['POST','/api/deduplication'],['POST','/api/assets/move']]) assert.equal((await call(route,{method,body:'{}'})).status,405);
  assert.equal(await readFile(textFile,'utf8'),'# Test');
  const refs=await (await call('/api/assets?scope=task&threadId='+id)).json();assert.equal(refs.total,1);assert.equal(refs.assets[0].name,'Note');
  assert.equal((await call('/api/asset?id='+movie.id+'&threadId='+id)).status,400);
  assert.equal((await call('/api/asset?id='+refs.assets[0].id+'&threadId='+id)).status,200);
  await rm(textFile);assert.equal((await call('/api/asset?id='+refs.assets[0].id+'&threadId='+id)).status,400);
  await call('/api/sources/'+added.source.id,{method:'DELETE'});assert.equal((await stat(image)).size,png.length);assert.equal((await call('/api/asset?id='+photo.id)).status,400);
});

test('range limits support suffix and resumed reads and reject malformed requests',()=>{
  assert.deepEqual(byteRange('bytes=-10',100),{start:90,end:99,length:10});
  assert.deepEqual(byteRange('bytes=10-19',100),{start:10,end:19,length:10});
  assert.equal(byteRange('',10*MEDIA_CHUNK).length,MEDIA_CHUNK);
  for(const range of ['bytes=100-','bytes=3-2','bytes=-0','bytes=0-2,4-6','bad'])assert.throws(()=>byteRange(range,100));
});

test('CDP bridge caps oversized responses and aborts outstanding local requests',async t=>{
  const server=createServer((req,res)=>{if(req.url==='/large'){res.writeHead(200);res.end(Buffer.alloc(5*1024*1024));}else res.writeHead(200);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const bridge=new AssetConsoleBridge({port:server.address().port});bridge.token='fixture-local-asset-token-01234567890123456789';
  await assert.rejects(bridge.requestLocal({route:'/large'}),/限制|中断|aborted/);
  const controller=new AbortController();const request=bridge.requestLocal({route:'/pending',signal:controller.signal});controller.abort();await assert.rejects(request,/取消|abort/i);
});
