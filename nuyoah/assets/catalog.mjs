import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, lstat, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileType } from './preview.mjs';
import { parseMidjourneyFilename } from './midjourney.mjs';

export const PAGE_SIZE = 60;
const skipped = new Set(['node_modules', '__pycache__', 'venv', 'dist', 'build', 'coverage']);
const hash = value => createHash('sha256').update(value).digest('hex');
export const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const clean = value => String(value || '').slice(0, 4096);
export async function regularFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(file) !== file) throw new Error('文件已失效，请刷新来源');
  return info;
}
async function smallJson(file, limit = 2 * 1024 * 1024) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('来源元数据无法读取');
  return JSON.parse(await readFile(file, 'utf8'));
}
export async function isEagle(root) {
  try { return (await stat(path.join(root, 'images'))).isDirectory() && (await stat(path.join(root, 'metadata.json'))).isFile(); }
  catch { return false; }
}
async function canonicalFolder(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || /[\0\r\n]/.test(root)) throw new Error('请输入文件夹绝对路径');
  root = await realpath(root);
  if (!(await stat(root)).isDirectory()) throw new Error('请选择文件夹');
  for (let parent = path.dirname(root); parent !== path.dirname(parent); parent = path.dirname(parent)) {
    if (parent.endsWith('.library') && await isEagle(parent)) throw new Error('请选择 Eagle 资料库本身，不要导入其中的内部文件夹');
  }
  return root;
}
function folderIndex(metadata) {
  const folders = [], byId = new Map();
  const stack = (Array.isArray(metadata.folders) ? metadata.folders : []).map(folder => ({ folder, parentId: '', parentPath: '' })).reverse();
  while (stack.length) {
    const { folder, parentId, parentPath } = stack.pop();
    if (!folder || typeof folder.id !== 'string' || !folder.id || typeof folder.name !== 'string' || byId.has(folder.id)) {
      throw new Error('Eagle 文件夹信息无法读取');
    }
    const item = { id: folder.id, name: clean(folder.name), path: [parentPath, clean(folder.name)].filter(Boolean).join('/'), parentId };
    byId.set(item.id, item); folders.push(item);
    const children = Array.isArray(folder.children) ? folder.children : [];
    for (let i = children.length - 1; i >= 0; i--) stack.push({ folder: children[i], parentId: item.id, parentPath: item.path });
  }
  return { folders, byId };
}
async function eagleFolderIndex(root) { return folderIndex(await smallJson(path.join(root, 'metadata.json'))); }
export async function listEagleFolders(root) {
  root = await canonicalFolder(root);
  if (!await isEagle(root)) throw new Error('请选择 Eagle 资料库');
  const { folders } = await eagleFolderIndex(root);
  return { root, folders: folders.map(({ id, path: folderPath }) => ({ id, path: folderPath })) };
}
function selectedFolderIds(index, id) {
  if (!id) return null;
  if (!index.byId.has(id)) throw new Error('所选 Eagle 文件夹已不存在，请重新选择');
  const children = new Map();
  for (const folder of index.folders) {
    if (!folder.parentId) continue;
    if (!children.has(folder.parentId)) children.set(folder.parentId, []);
    children.get(folder.parentId).push(folder.id);
  }
  const selected = new Set(), pending = [id];
  while (pending.length) {
    const folderId = pending.pop();
    selected.add(folderId);
    for (const childId of children.get(folderId) || []) pending.push(childId);
  }
  return selected;
}
export async function describeFile(file, { id, origin = 'folder', name, tags = [], folder, directories, eagleFolderIds = [], thumbnail = '', annotation = '', relation = '' } = {}) {
  const info = await regularFile(file);
  const type = fileType(file);
  return { id: id || hash(`file:${file}`), sourcePath: file, name: clean(name || path.basename(file)),
    kind: ['image', 'video', 'audio'].includes(type) ? type : 'text', previewType: type,
    extension: path.extname(file).slice(1).toUpperCase(), size: info.size, mtimeMs: info.mtimeMs,
    origin, directory: clean(folder ?? path.dirname(file)), directories: (directories || [folder ?? path.dirname(file)]).map(clean),
    ...(origin === 'eagle' ? { eagleFolderIds: eagleFolderIds.filter(value => typeof value === 'string') } : {}),
    tags: tags.filter(t => typeof t === 'string').slice(0, 100).map(t => t.slice(0, 200)),
    thumbnail, annotation: clean(annotation), relation,
    mjProfiles: parseMidjourneyFilename(path.basename(file))?.profiles || [] };
}

// Source reads never write to the source. Incomplete scans only upsert and cannot
// erase the last complete snapshot. Cancellation commits no asset changes.
export async function scanFolder(source, { signal, maxFiles = 30000, maxMs = 120000, onProgress = () => {} } = {}) {
  const assets = new Map(), removedIds = []; const started = Date.now(); let visited = 0, partial = false, eagleFolders = null;
  const checkpoint = () => {
    signal?.throwIfAborted();
    if (visited >= maxFiles || Date.now() - started > maxMs) { partial = true; return false; }
    return true;
  };
  const add = asset => { assets.set(asset.id, asset); onProgress({ visited, count: assets.size }); };
  async function eagle(root) {
    const index = await eagleFolderIndex(root);
    const selected = selectedFolderIds(index, source.eagleFolderId || '');
    eagleFolders = index.folders.filter(folder => !selected || selected.has(folder.id));
    for (const entry of await readdir(path.join(root, 'images'), { withFileTypes: true })) {
      if (!checkpoint()) break;
      if (!entry.isDirectory() || !entry.name.endsWith('.info')) continue;
      visited++;
      const base = path.join(root, 'images', entry.name);
      try {
        const m = await smallJson(path.join(base, 'metadata.json'));
        if (m.isDeleted) { removedIds.push(hash(`eagle:${root}:${entry.name.slice(0,-5)}`)); continue; }
        if (m.id !== entry.name.slice(0, -5) || typeof m.name !== 'string' || typeof m.ext !== 'string'
            || /[\/\\\0]/.test(m.name + m.ext) || !m.ext) throw new Error('无效 Eagle 条目');
        if (m.folders && !Array.isArray(m.folders)) throw new Error('无效 Eagle 文件夹归属');
        const folderIds = m.folders || [];
        const file = path.join(base, `${m.name}.${m.ext}`);
        const thumb = path.join(base, `${m.name}_thumbnail.png`);
        if (selected && !folderIds.some(id => selected.has(id))) continue;
        const directories = folderIds.map(id => index.byId.get(id)?.path).filter(Boolean);
        if (!directories.length) directories.push('未分类');
        add(await describeFile(file, { id: hash(`eagle:${root}:${m.id}`), origin: 'eagle', tags: m.tags || [],
          folder: directories.join(' · '), directories, eagleFolderIds: folderIds,
          annotation: m.annotation, thumbnail: await regularFile(thumb).then(() => thumb).catch(() => '') }));
      } catch { partial = true; }
    }
  }
  async function walk(root) {
    if (!checkpoint()) return;
    if (await isEagle(root)) { await eagle(root); return; }
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!checkpoint()) break;
      if (entry.name.startsWith('.') || skipped.has(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) {
        try { await walk(file); } catch (error) { if (signal?.aborted) throw error; partial = true; }
      } else if (entry.isFile()) {
        visited++;
        if (fileType(file) === 'other') continue;
        try { add(await describeFile(file)); }
        catch { partial = true; }
      }
    }
  }
  if (source.kind === 'eagle' || source.eagleFolderId) {
    if (!await isEagle(source.root)) throw new Error('Eagle 资料库暂时无法读取');
    await eagle(source.root);
  } else await walk(source.root);
  signal?.throwIfAborted();
  return { assets: [...assets.values()], removedIds, partial, visited, eagleFolders };
}

export class AssetCatalog {
  constructor(database) {
    this.db = new DatabaseSync(database);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL, kind TEXT NOT NULL,
        projectId TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unscanned', message TEXT NOT NULL DEFAULT '', scannedAt TEXT,
        eagleFolderId TEXT NOT NULL DEFAULT '', UNIQUE(root,eagleFolderId));
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, mtime REAL NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS membership(sourceId TEXT REFERENCES sources(id) ON DELETE CASCADE, assetId TEXT REFERENCES assets(id) ON DELETE CASCADE,
        PRIMARY KEY(sourceId,assetId)); CREATE INDEX IF NOT EXISTS membership_asset ON membership(assetId);
      CREATE TABLE IF NOT EXISTS views(key TEXT PRIMARY KEY, data TEXT NOT NULL);`);
    if (!this.db.prepare('PRAGMA table_info(sources)').all().some(column => column.name === 'eagleFolderId')) {
      // The old root UNIQUE constraint requires a table rebuild. Keep membership
      // rows while replacing the parent table, then check every foreign key.
      this.db.exec('PRAGMA foreign_keys=OFF');
      try {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE sources_next(id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL, kind TEXT NOT NULL,
            projectId TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unscanned', message TEXT NOT NULL DEFAULT '', scannedAt TEXT,
            eagleFolderId TEXT NOT NULL DEFAULT '', UNIQUE(root,eagleFolderId));
          INSERT INTO sources_next(id,name,root,kind,projectId,status,message,scannedAt,eagleFolderId)
            SELECT id,name,root,kind,projectId,status,message,scannedAt,'' FROM sources;
          DROP TABLE sources;
          ALTER TABLE sources_next RENAME TO sources;`);
        if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('资产索引迁移校验失败');
        this.db.exec('COMMIT');
      } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
      finally { this.db.exec('PRAGMA foreign_keys=ON'); }
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS eagle_folders(
      sourceId TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      id TEXT NOT NULL, name TEXT NOT NULL, parentId TEXT NOT NULL, path TEXT NOT NULL,
      PRIMARY KEY(sourceId,id));`);
    this.db.prepare("UPDATE sources SET status='interrupted', message='上次扫描未完成，请重新扫描' WHERE status='scanning'").run();
    this.jobs = new Map();
  }
  static async open(directory) { await mkdir(directory, { recursive: true }); return new AssetCatalog(path.join(directory, 'catalog.sqlite')); }
  sources() { return this.db.prepare('SELECT s.*, COUNT(m.assetId) AS count FROM sources s LEFT JOIN membership m ON m.sourceId=s.id GROUP BY s.id ORDER BY s.rowid').all(); }
  source(id) { return this.db.prepare('SELECT * FROM sources WHERE id=?').get(id); }
  async folders(id) {
    const source = this.source(id);
    if (!source || source.kind !== 'eagle') throw new Error('Eagle 来源不存在');
    const rows = () => this.db.prepare('SELECT id,name,parentId,path FROM eagle_folders WHERE sourceId=? ORDER BY rowid').all(id);
    let folders = rows();
    if (!folders.length) {
      // Older indexes have no folder snapshot. Reading library metadata here does
      // not rescan or modify originals; the saved asset memberships remain intact.
      const index = await eagleFolderIndex(source.root);
      const selected = selectedFolderIds(index, source.eagleFolderId);
      if (!rows().length) {
        const insert = this.db.prepare('INSERT INTO eagle_folders VALUES(?,?,?,?,?)');
        this.db.exec('BEGIN');
        try {
          for (const folder of index.folders) if (!selected || selected.has(folder.id))
            insert.run(id, folder.id, folder.name, folder.parentId, folder.path);
          this.db.exec('COMMIT');
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      }
      folders = rows();
    }
    return { rootId: source.eagleFolderId, folders };
  }
  view(projectId = '') {
    const row = this.db.prepare('SELECT data FROM views WHERE key=?').get(clean(projectId))
      || this.db.prepare("SELECT data FROM views WHERE key=''").get();
    return row ? JSON.parse(row.data) : {};
  }
  saveView(projectId, value = {}) {
    const source = this.source(String(value.sourceId || ''));
    const data = { projectId: clean(projectId), scope: value.scope === 'task' ? 'task' : source?.kind || 'folder',
      sourceId: value.scope === 'task' ? '' : source?.id || '', folder: clean(value.folder),
      layout: value.layout === 'list' ? 'list' : 'grid',
      tileSize: Math.min(220, Math.max(100, Math.round(Number(value.tileSize) || 140))) };
    const update = this.db.prepare('INSERT INTO views VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data');
    this.db.exec('BEGIN');
    try {
      update.run(clean(projectId), JSON.stringify(data));
      if (projectId) update.run('', JSON.stringify(data));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return data;
  }
  async add({ root, name = '', projectId = '', eagleFolderId = '' }) {
    root = await canonicalFolder(root);
    if (typeof eagleFolderId !== 'string' || eagleFolderId.length > 256) throw new Error('Eagle 文件夹无效');
    const kind = await isEagle(root) ? 'eagle' : 'folder';
    if (eagleFolderId && kind !== 'eagle') throw new Error('请选择 Eagle 资料库');
    let selectedPath = '';
    if (eagleFolderId) {
      const index = await eagleFolderIndex(root);
      selectedPath = index.byId.get(eagleFolderId)?.path || '';
      if (!selectedPath) throw new Error('所选 Eagle 文件夹已不存在，请重新选择');
    }
    const existing = this.db.prepare('SELECT * FROM sources WHERE root=? AND eagleFolderId=?').get(root,eagleFolderId);
    if (existing) return existing;
    if (this.sources().length >= 100) throw new Error('来源数量已达上限，请先移除不使用的来源');
    const id = randomUUID();
    this.db.prepare('INSERT INTO sources(id,name,root,kind,projectId,eagleFolderId) VALUES(?,?,?,?,?,?)')
      .run(id, clean(name || selectedPath || path.basename(root)), root, kind, clean(projectId), eagleFolderId);
    return this.source(id);
  }
  remove(id) {
    if (!this.source(id)) throw new Error('来源不存在');
    this.jobs.get(id)?.controller.abort();
    this.db.prepare('DELETE FROM sources WHERE id=?').run(id);
    this.db.exec('DELETE FROM assets WHERE id NOT IN (SELECT assetId FROM membership)');
  }
  status(id, status, message = '') { this.db.prepare('UPDATE sources SET status=?,message=? WHERE id=?').run(status, message, id); }
  scan(id, options = {}) {
    if (this.jobs.has(id)) return this.jobs.get(id);
    const source = this.source(id); if (!source) throw new Error('来源不存在');
    if (this.jobs.size >= 1) throw new Error('另一个来源正在扫描，请稍后重试');
    const job = { controller: new AbortController(), visited: 0, count: 0 };
    this.status(id, 'scanning'); this.jobs.set(id, job);
    job.promise = scanFolder(source, { ...options, signal: job.controller.signal, onProgress: value => Object.assign(job, value) })
      .then(result => {
        if (!this.source(id)) return;
        this.db.exec('BEGIN');
        try {
          if (!result.partial) this.db.prepare('DELETE FROM membership WHERE sourceId=?').run(id);
          else for (const assetId of result.removedIds) this.db.prepare('DELETE FROM membership WHERE sourceId=? AND assetId=?').run(id, assetId);
          const upsert = this.db.prepare(`INSERT INTO assets VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            path=excluded.path,name=excluded.name,type=excluded.type,mtime=excluded.mtime,data=excluded.data WHERE assets.data!=excluded.data`);
          const link = this.db.prepare('INSERT OR IGNORE INTO membership VALUES(?,?)');
          for (const a of result.assets) { upsert.run(a.id, a.sourcePath, a.name, a.previewType, a.mtimeMs, JSON.stringify(a)); link.run(id, a.id); }
          if (!result.partial && result.eagleFolders) {
            this.db.prepare('DELETE FROM eagle_folders WHERE sourceId=?').run(id);
            const insert = this.db.prepare('INSERT INTO eagle_folders VALUES(?,?,?,?,?)');
            for (const folder of result.eagleFolders) insert.run(id, folder.id, folder.name, folder.parentId, folder.path);
          }
          this.db.exec('DELETE FROM assets WHERE id NOT IN (SELECT assetId FROM membership)');
          this.db.prepare('UPDATE sources SET status=?,message=?,scannedAt=? WHERE id=?').run(result.partial ? 'partial' : 'ready',
            result.partial ? '部分文件未收录；已保留上次结果，请检查文件夹后重新扫描' : '', new Date().toISOString(), id);
          this.db.exec('COMMIT');
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      }).catch(error => this.status(id, job.controller.signal.aborted ? 'cancelled' : 'error',
        job.controller.signal.aborted ? '已取消；上次结果保留' :
          error.message === '所选 Eagle 文件夹已不存在，请重新选择' ? '所选 Eagle 文件夹已不存在；上次结果保留，请重新选择' :
            '文件夹暂时无法读取；上次结果保留，请检查后重试'))
      .finally(() => this.jobs.delete(id));
    return job;
  }
  cancel(id) { this.jobs.get(id)?.controller.abort(); }
  list({ sourceId = '', kind = '', query = '', folder = '', folderId = '', tag = '', offset = 0, limit = PAGE_SIZE, sourceKind = '' } = {}) {
    const conditions = [], values = [];
    if (sourceId) { conditions.push('m.sourceId=?'); values.push(sourceId); }
    if (sourceKind) { conditions.push('s.kind=?'); values.push(sourceKind); }
    if (kind) { conditions.push('a.type=?'); values.push(kind); }
    if (query) { conditions.push("(a.name LIKE ? ESCAPE '\\' OR json_extract(a.data,'$.directory') LIKE ? ESCAPE '\\' OR json_extract(a.data,'$.tags') LIKE ? ESCAPE '\\')"); const q = `%${clean(query).replace(/[\\%_]/g, '\\$&')}%`; values.push(q,q,q); }
    if (folder) {
      conditions.push("EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(a.data,'$.directories'),json_array(json_extract(a.data,'$.directory')))) WHERE value=? OR value LIKE ? ESCAPE '\\')");
      values.push(folder, String(folder).replace(/[\\%_]/g, '\\$&') + '/%');
    }
    if (folderId) {
      const source = this.source(sourceId);
      if (!source || source.kind !== 'eagle') throw new Error('Eagle 来源不存在');
      const folders = this.db.prepare('SELECT id,parentId,path FROM eagle_folders WHERE sourceId=?').all(sourceId);
      const selected = folders.find(item => item.id === folderId);
      if (!selected) throw new Error('所选 Eagle 文件夹已不存在');
      const descendants = new Set([folderId]);
      for (let changed = true; changed;) {
        changed = false;
        for (const item of folders) if (!descendants.has(item.id) && descendants.has(item.parentId)) {
          descendants.add(item.id); changed = true;
        }
      }
      conditions.push(`(EXISTS(SELECT 1 FROM json_each(a.data,'$.eagleFolderIds') item
        JOIN json_each(?) selected ON item.value=selected.value)
        OR (json_type(a.data,'$.eagleFolderIds') IS NULL AND
          EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(a.data,'$.directories'),json_array(json_extract(a.data,'$.directory'))))
            WHERE value=? OR value LIKE ? ESCAPE '\\')))`);
      values.push(JSON.stringify([...descendants]), selected.path, selected.path.replace(/[\\%_]/g, '\\$&') + '/%');
    }
    if (tag) { conditions.push("EXISTS(SELECT 1 FROM json_each(a.data,'$.tags') WHERE value=?)"); values.push(tag); }
    const from = 'FROM assets a JOIN membership m ON m.assetId=a.id JOIN sources s ON s.id=m.sourceId';
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT COUNT(DISTINCT a.id) AS n ${from}${where}`).get(...values).n;
    offset = Math.max(0, Math.min(1e7, Number(offset) || 0)); limit = Math.max(1, Math.min(PAGE_SIZE, Number(limit) || PAGE_SIZE));
    const assets = this.db.prepare(`SELECT DISTINCT a.id,a.data ${from}${where} ORDER BY a.mtime DESC,a.id LIMIT ? OFFSET ?`).all(...values, limit, offset).map(row => JSON.parse(row.data));
    return { assets, total, offset, limit };
  }
  facets(sourceId) {
    const folders = this.db.prepare("SELECT DISTINCT j.value FROM assets a JOIN membership m ON m.assetId=a.id, json_each(COALESCE(json_extract(a.data,'$.directories'),json_array(json_extract(a.data,'$.directory')))) j WHERE m.sourceId=? ORDER BY j.value LIMIT 1000").all(sourceId);
    const tags = this.db.prepare("SELECT DISTINCT j.value FROM assets a JOIN membership m ON m.assetId=a.id, json_each(a.data,'$.tags') j WHERE m.sourceId=? ORDER BY j.value LIMIT 1000").all(sourceId);
    return { folders: folders.map(r=>r.value), tags: tags.map(r=>r.value) };
  }
  get(id) { const row = this.db.prepare('SELECT data FROM assets WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; }
  async resolve(id) {
    const asset = this.get(id); if (!asset) throw new Error('资产已移除，请刷新来源');
    const roots = this.db.prepare('SELECT s.root FROM sources s JOIN membership m ON m.sourceId=s.id WHERE m.assetId=?').all(id);
    if (!roots.some(s => inside(s.root, asset.sourcePath))) throw new Error('资产不在已导入来源中');
    await regularFile(asset.sourcePath); return asset;
  }
  async close() { for (const job of this.jobs.values()) job.controller.abort(); await Promise.all([...this.jobs.values()].map(j => j.promise)); this.db.close(); }
}
