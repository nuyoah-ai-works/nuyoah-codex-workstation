import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat, lstat, realpath } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetCatalog, describeFile, listEagleFolders, regularFile, PAGE_SIZE } from './catalog.mjs';
import { PreviewCache, byteRange } from './previews.mjs';
import { previewFile } from './preview.mjs';
import { TaskContextStore, taskId } from '../workstation/task-context-store.mjs';
import { AutomaticReferences } from '../workstation/automatic-references.mjs';

const publicRoot = fileURLToPath(new URL('./public/', import.meta.url));
const staticFiles = new Map([['/', ['index.html','text/html']], ['/index.html',['index.html','text/html']], ['/app.js',['app.js','text/javascript']], ['/asset-ui.js',['asset-ui.js','text/javascript']], ['/ui-v3.css',['ui-v3.css','text/css']]]);
const mime = { mp4:'video/mp4',mov:'video/mp4',webm:'video/webm',m4v:'video/mp4',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg',flac:'audio/flac',opus:'audio/ogg' };

export async function startAssetServer({ stateRoot, token, port = 5177, taskStore = new TaskContextStore(), automatic = new AutomaticReferences() }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('资产服务令牌无效');
  const catalog = await AssetCatalog.open(stateRoot), previews = new PreviewCache(path.join(stateRoot, 'thumbnails'));
  const taskAssets = new Map();
  function authenticated(req) {
    const a = Buffer.from(String(req.headers['x-asset-console-token'] || '')), b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a,b)) return false;
    if (req.headers.origin) {
      try { const o = new URL(req.headers.origin); if (o.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(o.hostname) || Number(o.port) !== server.address().port) return false; }
      catch { return false; }
    }
    return true;
  }
  const json = (res,data,status=200) => { if (res.destroyed) return; res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(data)); };
  async function body(req) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new Error('请求过大'); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  async function references(id, hostId = 'local') {
    if (hostId !== 'local') throw new Error('远程任务资产暂不可在本机读取');
    id = taskId(id);
    const [manual, auto] = await Promise.all([taskStore.view(id), automatic.view(id)]);
    const excluded = new Set(manual.excludedReferencePaths), byPath = new Map();
    for (const ref of [...(auto.references || []).filter(r => !excluded.has(r.path)), ...manual.references]) byPath.set(ref.path, ref);
    const assets = [];
    for (const ref of [...byPath.values()].slice(0,2000)) {
      try {
        if ((await lstat(ref.path)).isSymbolicLink()) continue;
        assets.push(await describeFile(await realpath(ref.path), { relation: ref.relation, name: ref.label, origin: 'task' }));
      } catch {}
    }
    if (taskAssets.size >= 4 && !taskAssets.has(id)) taskAssets.delete(taskAssets.keys().next().value);
    taskAssets.set(id, new Map(assets.map(a => [a.id,a])));
    return { assets, partial: auto.status !== 'ready' || byPath.size > 2000 };
  }
  async function resolve(url) {
    const id = url.searchParams.get('id'), thread = url.searchParams.get('threadId');
    if (thread) {
      const { assets } = await references(thread, url.searchParams.get('hostId') || 'local');
      const asset = assets.find(a => a.id === id);
      if (!asset) throw new Error('文件已失效或不再属于当前任务');
      await regularFile(asset.sourcePath); return asset;
    }
    return catalog.resolve(id);
  }
  const server = createServer(async(req,res) => {
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && staticFiles.has(url.pathname)) {
        const [file,type] = staticFiles.get(url.pathname);
        res.writeHead(200, {'content-type':`${type}; charset=utf-8`, 'cache-control':'no-store', 'x-content-type-options':'nosniff',
          'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'"});
        res.end(await readFile(path.join(publicRoot,file))); return;
      }
      if (!authenticated(req)) { json(res,{ error:'资产服务身份验证失败' },403); return; }
      if (url.pathname === '/api/view') {
        const projectId = (url.searchParams.get('projectId') || '').slice(0,160);
        if (req.method === 'GET') { json(res,{view:catalog.view(projectId)}); return; }
        if (req.method === 'PUT') { json(res,{view:catalog.saveView(projectId,await body(req))}); return; }
      }
      if (req.method === 'GET' && url.pathname === '/api/sources') {
        json(res,{ sources:catalog.sources().map(s => ({ ...s, progress:catalog.jobs.has(s.id) ? { count:catalog.jobs.get(s.id).count,visited:catalog.jobs.get(s.id).visited } : null })), version:2, readOnly:true }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/eagle-folders') {
        const data = await body(req);
        json(res,await listEagleFolders(data.root)); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/sources') {
        if (catalog.jobs.size) throw new Error('另一个来源正在扫描，请稍后导入');
        const data = await body(req); const source = await catalog.add(data);
        catalog.scan(source.id); json(res,{ source },201); return;
      }
      const sourceRoute = /^\/api\/sources\/([a-f\d-]+)(?:\/(scan|cancel|facets|folders))?$/.exec(url.pathname);
      if (sourceRoute) {
        const [,id,action] = sourceRoute;
        if (req.method === 'DELETE' && !action) { catalog.remove(id); json(res,{ removed:true }); return; }
        if (req.method === 'POST' && action === 'scan') { catalog.scan(id); json(res,{ started:true }); return; }
        if (req.method === 'POST' && action === 'cancel') { catalog.cancel(id); json(res,{ cancelled:true }); return; }
        if (req.method === 'GET' && action === 'facets') { json(res,catalog.facets(id)); return; }
        if (req.method === 'GET' && action === 'folders') { json(res,await catalog.folders(id)); return; }
      }
      if (req.method === 'GET' && url.pathname === '/api/assets') {
        const params = Object.fromEntries(url.searchParams);
        if (params.scope === 'task') {
          const result = await references(params.threadId, params.hostId || 'local');
          const q = String(params.query || '').toLocaleLowerCase();
          const all = result.assets.filter(a => (!params.kind || a.previewType === params.kind) && (!q || [a.name,a.directory,...a.tags].join(' ').toLocaleLowerCase().includes(q))).sort((a,b)=>b.mtimeMs-a.mtimeMs);
          const offset = Math.max(0,Number(params.offset)||0);
          json(res,{ assets:all.slice(offset,offset+PAGE_SIZE),total:all.length,limit:PAGE_SIZE,offset,partial:result.partial });
        } else {
          if (params.folderId) await catalog.folders(params.sourceId);
          json(res,catalog.list(params));
        }
        return;
      }
      if (req.method === 'GET' && ['/api/preview','/api/asset','/media'].includes(url.pathname)) {
        const asset = await resolve(url);
        if (url.pathname === '/api/asset') { json(res,{ asset }); return; }
        if (url.pathname === '/api/preview') { json(res,await previewFile(asset.sourcePath,{thumbnail:url.searchParams.get('thumbnail')==='1'})); return; }
        if (asset.kind === 'image' || asset.kind === 'video' && asset.thumbnail && url.searchParams.get('thumbnail') === '1') {
          const image = await previews.image(asset,{ detail:url.searchParams.get('detail') === '1',signal:controller.signal });
          if (res.destroyed) return;
          res.writeHead(200,{'content-type':image.type,'content-length':image.body.length,
            'cache-control':image.unavailable ? 'no-store' : 'private, max-age=300',
            'x-preview-unavailable':image.unavailable ? '1' : '0',
            ...(image.reason ? { 'x-preview-error':image.reason } : {}) }); res.end(image.body);
          void previews.prune().catch(()=>{}); return;
        }
        if (!['audio','video'].includes(asset.kind)) { json(res,{error:'此文件不支持媒体预览'},415); return; }
        const info = await stat(asset.sourcePath); let range;
        try { range = byteRange(req.headers.range,info.size); }
        catch { res.writeHead(416,{'content-range':`bytes */${info.size}`}); res.end(); return; }
        if (!range.length) { res.writeHead(200,{'content-length':0}); res.end(); return; }
        res.writeHead(206,{'content-type':mime[asset.extension.toLowerCase()] || 'application/octet-stream','accept-ranges':'bytes',
          'content-range':`bytes ${range.start}-${range.end}/${info.size}`,'content-length':range.length,'cache-control':'no-store'});
        const stream = createReadStream(asset.sourcePath,{start:range.start,end:range.end});
        controller.signal.addEventListener('abort',()=>stream.destroy(),{once:true});
        stream.on('error',()=>res.destroy()); stream.pipe(res); return;
      }
      json(res,{error:'此操作不可用；资产原文件为只读'},405);
    } catch (error) { if (!res.headersSent) json(res,{error:/ENOENT|EACCES|EPERM|SQLITE/.test(error.message) ? '文件夹或文件暂时无法读取，请检查后重试' : error.message},400); else res.destroy(); }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return { server,catalog,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await catalog.close();} };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stateRoot = path.dirname(process.env.ASSET_BROWSER_CONFIG || '');
  const token = (await readFile(process.env.ASSET_BROWSER_TOKEN_FILE,'utf8')).trim();
  const app = await startAssetServer({ stateRoot,token,port:Number(process.env.PORT || 5177) });
  console.log('Read-only asset catalog listening on loopback');
  for (const signal of ['SIGTERM','SIGINT']) process.once(signal,async()=>{await app.close();process.exit(0);});
}
