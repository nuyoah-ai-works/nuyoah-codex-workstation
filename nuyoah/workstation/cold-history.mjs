import { copyFile, mkdir, open, readFile, readdir, realpath, rename, rm, stat, statfs } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { TaskContextStore, taskId, workstationDataRoot } from './task-context-store.mjs';
import { registerColdHistory } from '../../scripts/register-cold-history.mjs';

const execute = promisify(execFile);
const query = fileURLToPath(new URL('../../vendor/codex-thread-cold-history/scripts/cold_history.py', import.meta.url));
const idleMs = 5 * 60 * 1000;
const signature = s => [s.size, s.mtimeMs, s.ctimeMs, s.ino, s.dev].join(':');
const day = time => { const d = new Date(time); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Discover local task metadata only; session bodies remain local to snapshot verification.
async function openTaskDatabase(codexHome) {
  const files = (await readdir(codexHome)).filter(x => /^state_\d+\.sqlite$/.test(x))
    .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
  if (!files.length) throw new Error('无法定位本机任务数据库');
  return new DatabaseSync(path.join(codexHome, files[0]), { readOnly: true });
}
const defaultCodexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
export async function listColdHistoryTasks(codexHome = defaultCodexHome()) {
  const db = await openTaskDatabase(codexHome);
  try {
    return db.prepare('SELECT id, rollout_path FROM threads ORDER BY updated_at DESC, id').all()
      .filter(row => row.rollout_path && path.isAbsolute(row.rollout_path))
      .map(row => taskId(row.id));
  } finally { db.close(); }
}
export async function locateColdHistorySource(id, codexHome = defaultCodexHome()) {
  id = taskId(id);
  const db = await openTaskDatabase(codexHome);
  try {
    const row = db.prepare('SELECT rollout_path FROM threads WHERE id = ?').get(id);
    if (!row?.rollout_path || !path.isAbsolute(row.rollout_path)) throw new Error('未找到该任务的本机记录');
    return await realpath(row.rollout_path);
  } finally { db.close(); }
}

export async function inspectColdHistorySource(file, id) {
  const info = await stat(file);
  if (!info.isFile() || !info.size) throw new Error('任务记录不可读取');
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(Math.min(info.size, 1024 * 1024));
    const first = await handle.read(head, 0, head.length, 0);
    const newline = head.subarray(0, first.bytesRead).indexOf(10);
    if (newline < 0) throw new Error('会话头无法验证');
    const meta = JSON.parse(head.subarray(0, newline).toString('utf8'));
    if (meta.type !== 'session_meta' || taskId(meta.payload?.id) !== taskId(id)) throw new Error('任务身份不匹配');
    const offset = Math.max(0, info.size - 2 * 1024 * 1024);
    const tail = Buffer.alloc(info.size - offset);
    const result = await handle.read(tail, 0, tail.length, offset);
    const lines = tail.subarray(0, result.bytesRead).toString('utf8').split('\n');
    if (offset) lines.shift();
    let terminal = false;
    for (const line of lines) {
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); } catch { terminal = false; continue; }
      if (record.type === 'response_item' && record.payload?.type === 'message' && record.payload?.role === 'user') terminal = false;
      if (record.type !== 'event_msg') continue;
      const type = record.payload?.type;
      if (type === 'task_started' || type === 'user_message' || (type === 'item_completed' && record.payload?.item?.type === 'UserMessage')) terminal = false;
      if (type === 'task_complete' || type === 'turn_aborted') terminal = true;
    }
    if (!terminal) throw new Error('任务仍在运行或结束状态未确认，请结束后重试');
    if (signature(await stat(file)) !== signature(info)) throw new Error('任务记录正在变化，请稍后重试');
    return info;
  } finally { await handle.close(); }
}

export class ColdHistoryService {
  constructor({ root = path.join(path.dirname(workstationDataRoot()), 'ColdHistory'), store = new TaskContextStore(),
    source = locateColdHistorySource, python = process.env.NUYOAH_PYTHON || (process.platform === 'darwin' ? '/usr/bin/python3' : 'python3'),
    now = () => Date.now(), listTasks = listColdHistoryTasks } = {}) {
    this.root = root; this.store = store; this.source = source; this.python = python; this.now = now;
    this.listTasks = listTasks;
    this.jobs = new Map(); this.errors = new Map(); this.retryAfter = new Map(); this.nextTick = 0; this.ticking = false;
  }
  directory(id) { return path.join(this.root, taskId(id)); }
  stateFile(id) { return path.join(this.directory(id), 'state.json'); }
  async defaultAutoEnabled() {
    try {
      const value = JSON.parse(await readFile(path.join(this.root, 'settings.json'), 'utf8'));
      if (value.schemaVersion !== 1 || typeof value.autoEnabled !== 'boolean') throw new Error();
      return value.autoEnabled;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw new Error('自动冷存默认设置读取失败，请检查设置后重试');
    }
  }
  async setDefaultAuto(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('自动冷存设置无效');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const target = path.join(this.root, 'settings.json');
    const temp = `${target}.${randomUUID()}.tmp`;
    const h = await open(temp, 'wx', 0o600);
    try {
      await h.writeFile(JSON.stringify({ schemaVersion: 1, autoEnabled: enabled }) + '\n');
      await h.sync();
    } finally { await h.close(); }
    try { await rename(temp, target); } finally { await rm(temp, { force: true }); }
    this.nextTick = 0;
  }
  async readState(id) {
    try {
      const value = JSON.parse(await readFile(this.stateFile(id), 'utf8'));
      if (value.threadId !== taskId(id) || typeof value.autoEnabled !== 'boolean' || !Array.isArray(value.archives)) throw new Error();
      return value.autoInherited === true ? { ...value, autoEnabled: await this.defaultAutoEnabled() } : value;
    } catch (error) {
      if (error.code === 'ENOENT') return { threadId: taskId(id), autoEnabled: await this.defaultAutoEnabled(),
        autoInherited: true, archives: [], lastSavedAt: null };
      throw new Error('冷历史记录读取失败，已有记录未覆盖');
    }
  }
  async writeState(id, value) {
    await mkdir(this.directory(id), { recursive: true, mode: 0o700 });
    const temp = `${this.stateFile(id)}.${randomUUID()}.tmp`;
    const h = await open(temp, 'wx', 0o600);
    try { await h.writeFile(JSON.stringify(value, null, 2) + '\n'); await h.sync(); }
    finally { await h.close(); }
    try { await rename(temp, this.stateFile(id)); } finally { await rm(temp, { force: true }); }
  }
  async view(id) {
    const wasBusy = this.jobs.has(taskId(id));
    const state = await this.readState(id);
    const archives = [...state.archives];
    const context = await this.store.read(id);
    for (const ref of context.references) {
      if (ref.relation !== 'history' || path.basename(ref.path) !== 'cold-history-entry.json' || archives.some(a => a.entry === ref.path)) continue;
      try {
        const info = await stat(ref.path);
        if (info.size > 64 * 1024) continue;
        const entry = JSON.parse(await readFile(ref.path, 'utf8'));
        if (entry.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(entry.sha256)) continue;
        archives.push({ id: `reference-${createHash('sha256').update(ref.path).digest('hex')}`, entry: ref.path,
          createdAt: info.mtime.toISOString(), bytes: entry.bytes, label: ref.label || '关联冷档案' });
      } catch { /* Keep missing references in the existing reference list. */ }
    }
    return { autoEnabled: state.autoEnabled, busy: wasBusy || this.jobs.has(taskId(id)), error: this.errors.get(taskId(id)) || '',
      archives: await Promise.all(archives.map(async a => ({ id: a.id, entry: a.entry, createdAt: a.createdAt,
        bytes: a.bytes, label: a.label, exists: await stat(a.entry).then(s => s.isFile()).catch(() => false) }))),
      lastSavedAt: state.lastSavedAt, directory: this.directory(id) };
  }
  async lock(id) {
    await mkdir(this.directory(id), { recursive: true, mode: 0o700 });
    // SQLite leases are released by the OS after a crash; no stale PID locks.
    const lease = new DatabaseSync(path.join(this.directory(id), '.maintenance.sqlite'));
    try { lease.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE'); }
    catch { lease.close(); throw new Error('另一个归档操作尚未结束，请稍后重试'); }
    return async () => { try { lease.exec('ROLLBACK'); } finally { lease.close(); } };
  }

  async setAuto(id, enabled) {
    id = taskId(id);
    if (typeof enabled !== 'boolean') throw new Error('自动冷存设置无效');
    if (this.jobs.has(id)) throw new Error('正在归档，请完成后修改开关');
    const release = await this.lock(id);
    try { const state = await this.readState(id); await this.writeState(id, { ...state, autoEnabled: enabled, autoInherited: false }); this.retryAfter.delete(id); }
    finally { await release(); }
  }
  start(id, automatic = false) {
    id = taskId(id);
    if (this.jobs.has(id)) return;
    this.errors.delete(id);
    const promise = this.capture(id, automatic).then(() => this.retryAfter.delete(id)).catch(error => {
      if (automatic) this.retryAfter.set(id, this.now() + 15 * 60_000);
      this.errors.set(id, error.publicMessage || (/任务|会话|归档|档案|空间|冷历史/.test(error.message) && !error.message.includes('\n')
        ? error.message : '冷存失败，原任务未改变；请重试或请助手检查。'));
    }).finally(() => this.jobs.delete(id));
    this.jobs.set(id, promise);
  }
  async runQuery(archive, command) {
    const { stdout } = await execute(this.python, [query, '--archive', archive, command], { timeout: 120_000, maxBuffer: 64 * 1024 });
    return JSON.parse(stdout);
  }
  async capture(id, automatic) {
    const release = await this.lock(id);
    let temporary;
    try {
      let state = await this.readState(id);
      if (automatic && (!state.autoEnabled || (state.lastSavedAt && day(state.lastSavedAt) === day(this.now())))) return;
      const source = await this.source(id);
      const before = await inspectColdHistorySource(source, id);
      if (automatic && this.now() - before.mtimeMs < idleMs) return;
      if (state.lastSourceSignature === signature(before)) {
        const latest = state.archives[0];
        if (latest) await registerColdHistory(id, path.dirname(latest.entry), { store: this.store, python: this.python, managedRoot: this.directory(id) });
        return;
      }
      const space = await statfs(this.directory(id));
      if (space.bavail * space.bsize < before.size * 3 + 64 * 1024 * 1024) throw new Error('可用空间不足，未开始归档');
      const snapshotId = `${this.now()}-${randomUUID()}`;
      temporary = path.join(this.directory(id), `.pending-${snapshotId}`);
      await mkdir(temporary, { mode: 0o700 });
      const copy = path.join(temporary, 'original.jsonl');
      await copyFile(source, copy, constants.COPYFILE_EXCL);
      const copyHandle = await open(copy, 'r+');
      try { await copyHandle.chmod(0o600); await copyHandle.sync(); } finally { await copyHandle.close(); }
      const [sourceHash, copyHash] = await Promise.all([digest(source), digest(copy)]);
      if (sourceHash !== copyHash || signature(before) !== signature(await stat(source))) throw new Error('任务记录发生变化，未发布档案；请稍后重试');
      await this.runQuery(temporary, 'index');
      const verified = await this.runQuery(temporary, 'verify');
      if (verified.sha256 !== copyHash) throw new Error('档案校验失败，原任务未改变');
      await inspectColdHistorySource(source, id);
      if (signature(before) !== signature(await stat(source))) throw new Error('任务记录发生变化，未发布档案；请稍后重试');
      const destination = path.join(this.directory(id), snapshotId);
      await rename(temporary, destination); temporary = null;
      const archive = await realpath(destination);
      const entry = path.join(archive, 'cold-history-entry.json');
      const createdAt = new Date(this.now()).toISOString();
      const descriptor = { id: snapshotId, entry, createdAt, bytes: verified.bytes, label: '本任务冷档案' };
      state = { ...state, lastSourceSignature: signature(before), lastSavedAt: createdAt, archives: [descriptor, ...state.archives] };
      await this.writeState(id, state);
      try { await registerColdHistory(id, archive, { store: this.store, python: this.python, managedRoot: this.directory(id) }); }
      catch { throw new Error('档案已保存，工作台引用登记失败；点击立即冷存可重新登记'); }
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true });
      await release();
    }
  }
  async associate(id, entryPath) {
    id = taskId(id);
    if (this.jobs.has(id)) throw new Error('正在归档，请完成后关联档案');
    let entry;
    try { entry = await realpath(String(entryPath || '')); }
    catch { throw new Error('未找到档案入口，请检查路径。'); }
    if (path.basename(entry) !== 'cold-history-entry.json') throw new Error('请选择冷历史档案入口文件');
    if ((await stat(entry)).size > 64 * 1024) throw new Error('档案入口过大');
    const meta = JSON.parse(await readFile(entry, 'utf8'));
    const sourceId = taskId(meta.threadId);
    const archive = path.dirname(entry);
    const verified = await this.runQuery(archive, 'verify');
    if (verified.sha256 !== meta.sha256) throw new Error('档案入口与原文不匹配');
    await inspectColdHistorySource(path.join(archive, 'original.jsonl'), sourceId);
    const release = await this.lock(id);
    try {
      const state = await this.readState(id);
      if (state.archives.some(a => a.entry === entry)) return;
      const current = await this.store.read(id);
      if (!current.references.some(ref => ref.relation === 'history' && ref.path === entry)) {
        await this.store.update(id, { section: 'references', revision: current.revision,
          value: [...current.references, { relation: 'history', label: '关联冷档案', path: entry, sourceThreadId: sourceId }] });
      }
      await this.writeState(id, { ...state, archives: [...state.archives, { id: randomUUID(), entry,
        createdAt: (await stat(entry)).mtime.toISOString(), bytes: verified.bytes, label: sourceId === id ? '本任务冷档案' : '关联任务冷档案' }] });
    } finally { await release(); }
  }
  async handle(request) {
    const id = taskId(request.threadId);
    if (request.action === 'cold:archive') this.start(id);
    else if (request.action === 'cold:auto') await this.setAuto(id, request.enabled);
    else if (request.action === 'cold:link') await this.associate(id, request.entry);
    else throw new Error('未知冷历史操作');
  }
  async tick() {
    if (this.ticking || this.now() < this.nextTick) return;
    this.nextTick = this.now() + 30_000; this.ticking = true;
    try {
      const directories = await readdir(this.root, { withFileTypes: true }).catch(error => {
        if (error.code === 'ENOENT') return []; throw error;
      });
      const ids = new Set(directories.filter(dir => dir.isDirectory()
        && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(dir.name)).map(dir => dir.name));
      if (await this.defaultAutoEnabled()) for (const id of await this.listTasks()) ids.add(taskId(id));
      for (const id of ids) {
        if (this.jobs.size) break;
        let state;
        try { state = await this.readState(id); }
        catch { this.errors.set(id, '冷历史记录读取失败，自动冷存已暂停。'); continue; }
        if (!state.autoEnabled || (this.retryAfter.get(id) || 0) > this.now()
          || (state.lastSavedAt && day(state.lastSavedAt) === day(this.now()))) continue;
        try {
          const source = await this.source(id);
          const info = await inspectColdHistorySource(source, id);
          if (this.now() - info.mtimeMs < idleMs || state.lastSourceSignature === signature(info)) continue;
          this.start(id, true);
        } catch { /* Running or unavailable tasks remain untouched until a later tick. */ }
      }
    } finally { this.ticking = false; }
  }
}
