import { mkdir, open, readFile, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { workstationDataRoot } from './task-context-store.mjs';

export const WORK_ITEMS_LIMITS = Object.freeze({ items: 5000, nodes: 200, threadLinks: 100, depth: 20, bytes: 32 * 1024 * 1024 });
const itemKeys = ['id', 'title', 'direction', 'nextStep', 'note', 'status', 'focus', 'archived', 'threadLinks', 'nodes'];
const nodeKeys = ['id', 'parentId', 'title', 'kind', 'status', 'source', 'updatedAt', 'manualStatus'];
const nodeStates = ['todo', 'doing', 'waiting', 'done'];
const itemStates = ['idea', ...nodeStates, 'paused'];
const uuidPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
class WorkItemsError extends Error {}
const fail = message => { throw new WorkItemsError(message); };
const safeError = error => error instanceof WorkItemsError ? error.message : '工作事项暂时无法读写，未覆盖已有内容；请稍后重试。';

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(`${label}字段无效，请按示例填写。`);
}
function text(value, limit, label, required = false, singleLine = false) {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) ||
      (required && !value.trim()) || (singleLine && /[\r\n]/u.test(value))) fail(`${label}不能为空或格式无效（最多 ${limit} 字符）。`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label}需要 true 或 false。`);
  return value;
}
function enumValue(value, options, label) {
  if (!options.includes(value)) fail(`${label}无效，请使用 ${options.join(' / ')}。`);
  return value;
}
function timestamp(value, nullable = true) {
  if (value === null && nullable) return null;
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/u);
  if (!match) fail('更新时间需要有效的 ISO 时间或 null。');
  const [, y, m, d, h, min, s, , zoneH, zoneM] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!days || day < 1 || day > days || Number(h) > 23 || Number(min) > 59 || Number(s) > 59 || Number(zoneH || 0) > 23 || Number(zoneM || 0) > 59 || !Number.isFinite(Date.parse(value))) fail('更新时间需要有效的 ISO 时间或 null。');
  return value;
}
function itemId(value) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) fail('需要有效的事项 ID。');
  return value.toLowerCase();
}
function revisionValue(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('需要先读取事项版本，再用该 revision 保存。');
  return value;
}
function shortId(value, empty = false) {
  if (empty && value === '') return '';
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(value)) fail('节点 ID 需要 1–80 位字母、数字、下划线或连字符。');
  return value;
}
function nodes(values) {
  if (!Array.isArray(values) || values.length > WORK_ITEMS_LIMITS.nodes) fail(`每个事项最多保存 ${WORK_ITEMS_LIMITS.nodes} 个计划节点。`);
  const result = values.map(value => {
    object(value, nodeKeys, '计划节点');
    return { id: shortId(value.id), parentId: shortId(value.parentId, true), title: text(value.title, 500, '节点标题', true, true),
      kind: enumValue(value.kind, ['goal', 'milestone', 'next', 'blocker', 'note'], '节点类型'),
      status: enumValue(value.status, nodeStates, '记录状态'), source: text(value.source, 240, '状态来源', false, true),
      updatedAt: timestamp(value.updatedAt), manualStatus: value.manualStatus === null ? null : enumValue(value.manualStatus, nodeStates, '手动状态') };
  });
  const byId = new Map(result.map(node => [node.id, node]));
  if (byId.size !== result.length) fail('计划节点 ID 重复，请使用不同的稳定 ID。');
  for (const node of result) {
    let current = node, depth = 0;
    const seen = new Set();
    while (current) {
      if (seen.has(current.id)) fail('计划的父节点关系形成循环，请调整父节点。');
      seen.add(current.id);
      if (++depth > WORK_ITEMS_LIMITS.depth) fail(`计划最多支持 ${WORK_ITEMS_LIMITS.depth} 层。`);
      if (!current.parentId) break;
      current = byId.get(current.parentId);
      if (!current) fail('计划引用了不存在的父节点，请先补齐或改为根节点。');
    }
  }
  return result;
}
function threadLinks(values) {
  if (!Array.isArray(values) || values.length > WORK_ITEMS_LIMITS.threadLinks) fail(`每个事项最多关联 ${WORK_ITEMS_LIMITS.threadLinks} 个任务。`);
  const seen = new Set(), result = [];
  for (const value of values) {
    object(value, ['hostId', 'threadId'], '关联任务');
    const hostId = text(value.hostId, 256, '设备 ID', true, true), threadId = text(value.threadId, 256, '任务 ID', true, true);
    if (/\s/u.test(hostId + threadId)) fail('设备和任务 ID 不能包含空白字符。');
    const key = JSON.stringify([hostId, threadId]);
    if (!seen.has(key)) { seen.add(key); result.push({ hostId, threadId }); }
  }
  return result;
}
function item(value, newItem = false) {
  object(value, itemKeys, '工作事项');
  return { id: newItem && (value.id === undefined || value.id === null || value.id === '') ? randomUUID() : itemId(value.id),
    title: text(value.title, 240, '事项标题', true, true), direction: text(value.direction, 120, '工作方向', false, true),
    nextStep: text(value.nextStep, 2000, '下一步'), note: text(value.note, 16000, '事项笔记'),
    status: enumValue(value.status, itemStates, '事项状态'), focus: boolean(value.focus, '重点标记'), archived: boolean(value.archived, '归档标记'),
    threadLinks: threadLinks(value.threadLinks), nodes: nodes(value.nodes) };
}
function snapshot(value) {
  object(value, ['schemaVersion', 'revision', 'updatedAt', 'items'], '事项记录');
  if (value.schemaVersion !== 1 || !Array.isArray(value.items) || value.items.length > WORK_ITEMS_LIMITS.items) fail('事项记录格式或数量无效。');
  revisionValue(value.revision);
  timestamp(value.updatedAt, value.revision === 0);
  const items = value.items.map(value => item(value));
  if (new Set(items.map(item => item.id)).size !== items.length) fail('事项记录包含重复 ID。');
  return { schemaVersion: 1, revision: value.revision, updatedAt: value.updatedAt, items };
}

export class WorkItemsStore {
  constructor(root = workstationDataRoot()) { this.root = root; }
  file() { return path.join(this.root, 'work-items.json'); }
  async read() {
    try {
      let content;
      try {
        const info = await stat(this.file());
        if (!info.isFile() || info.size > WORK_ITEMS_LIMITS.bytes) fail('事项记录过大或不是有效文件，请保留原文件后检查。');
        content = await readFile(this.file(), 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return { schemaVersion: 1, revision: 0, updatedAt: null, items: [] };
        throw error;
      }
      if (Buffer.byteLength(content) > WORK_ITEMS_LIMITS.bytes) fail('事项记录过大，请保留原文件后检查。');
      return snapshot(JSON.parse(content));
    } catch { fail('工作事项记录无法读取或已损坏，未覆盖已有内容；请保留原文件并检查。'); }
  }
  async save(value, revision) {
    const next = item(value, true);
    return this.update(revision, current => {
      const index = current.items.findIndex(value => value.id === next.id);
      if (index < 0) {
        if (current.items.length >= WORK_ITEMS_LIMITS.items) fail(`最多保存 ${WORK_ITEMS_LIMITS.items} 个事项；请先导出整理，旧事项不会自动淘汰。`);
        current.items.push(next);
      } else current.items[index] = next;
      return current;
    });
  }
  async archive(id, archived, revision) {
    id = itemId(id); boolean(archived, '归档标记');
    return this.update(revision, current => {
      const target = current.items.find(value => value.id === id);
      if (!target) fail('没有找到该事项，请重新读取列表。');
      target.archived = archived;
      return current;
    });
  }
  async update(revision, change) {
    revisionValue(revision);
    let lease, temporary;
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      lease = new DatabaseSync(path.join(this.root, '.work-items-lock.sqlite'));
      try { lease.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE'); }
      catch { fail('另一处正在保存工作事项，请稍后重新读取并重试。'); }
      const current = await this.read();
      if (revision !== current.revision) fail('工作事项已在其他位置更新，请重新读取后合并；本次输入未保存。');
      if (current.revision === Number.MAX_SAFE_INTEGER) fail('事项版本已达到上限，请导出记录后检查。');
      const result = snapshot({ ...change(current), revision: current.revision + 1, updatedAt: new Date().toISOString() });
      const encoded = JSON.stringify(result, null, 2) + '\n';
      if (Buffer.byteLength(encoded) > WORK_ITEMS_LIMITS.bytes) fail('事项记录超过 32 MiB，本次输入未保存；请先导出整理。');
      temporary = `${this.file()}.${randomUUID()}.tmp`;
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(encoded); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, this.file());
      temporary = null;
      return result;
    } catch (error) { fail(safeError(error)); }
    finally {
      if (temporary) await unlink(temporary).catch(() => {});
      if (lease) { try { lease.exec('ROLLBACK'); } catch {} lease.close(); }
    }
  }
}

export async function handleWorkItemsRequest(store, request) {
  const id = typeof request?.id === 'string' || typeof request?.id === 'number' ? request.id : null;
  try {
    if (!request || request.consumer !== 'work-items') fail('工作事项请求无效。');
    let data;
    if (request.action === 'read') data = await store.read();
    else if (request.action === 'save') data = await store.save(request.item, request.revision);
    else if (request.action === 'archive') data = await store.archive(request.itemId, request.archived, request.revision);
    else fail('未知工作事项操作。');
    return { id, data };
  } catch (error) { return { id, error: safeError(error) }; }
}
