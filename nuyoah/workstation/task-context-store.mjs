import { mkdir, open, readFile, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { previewFile } from '../assets/preview.mjs';

export const workstationDataRoot = () => process.env.NUYOAH_WORKSTATION_DATA_DIR || path.join(os.homedir(),
  ...(process.platform === 'darwin' ? ['Library', 'Application Support', 'Codex Sidebar Enhancer Data'] : ['.local', 'share', 'Codex Sidebar Enhancer Data']), 'Workstation');
export function taskId(value) {
  const id = String(value || '').replace(/^local:/, '').toLowerCase();
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(id)) throw new Error('需要有效的本机任务 ID');
  return id;
}
const summaryFields = ['goal', 'progress', 'nextStep', 'agreements', 'assistantVerification', 'userConfirmation'];
function text(value, limit = 8000) {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw new Error('内容类型或长度无效');
  return value;
}
function summary(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).some(k => !summaryFields.includes(k))) throw new Error('摘要字段无效');
  return Object.fromEntries(summaryFields.map(k => [k, text(value[k] ?? '')]));
}
function references(values, id) {
  if (!Array.isArray(values) || values.length > 60) throw new Error('引用最多保存 60 项');
  return values.map(value => {
    if (!['output', 'reference', 'history'].includes(value?.relation)) throw new Error('引用关系无效');
    const file = text(value.path, 4096);
    if (!path.isAbsolute(file) || /[\r\n]/.test(file)) throw new Error('引用需要本机绝对路径');
    const sourceThreadId = value.sourceThreadId ? taskId(value.sourceThreadId) : '';
    if (value.relation === 'output' && sourceThreadId && sourceThreadId !== id) throw new Error('其他任务的产出应登记为参考');
    return { relation: value.relation, label: text(value.label || path.basename(file), 240), path: file,
      sourceThreadId: value.relation === 'output' ? id : sourceThreadId };
  });
}
function excludedPaths(values = []) {
  if (!Array.isArray(values) || values.length > 2000) throw new Error('隐藏记录过多');
  return [...new Set(values.map(value => {
    const file = text(value, 4096);
    if (!path.isAbsolute(file) || /[\r\n]/.test(file)) throw new Error('隐藏记录路径无效');
    return file;
  }))];
}
export class TaskContextStore {
  constructor(root = workstationDataRoot()) { this.root = root; }
  file(id) { return path.join(this.root, 'tasks', `${taskId(id)}.json`); }
  async read(id) {
    id = taskId(id);
    let data;
    try { data = JSON.parse(await readFile(this.file(id), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('任务记录读取失败，未覆盖已有内容');
      return { threadId: id, revision: 0, updatedAt: null, summary: summary({}), notes: '', references: [], excludedReferencePaths: [] };
    }
    if (data.threadId !== id || !Number.isSafeInteger(data.revision) || data.revision < 1) throw new Error('任务记录无效');
    return { threadId: id, revision: data.revision, updatedAt: data.updatedAt,
      summary: summary(data.summary), notes: text(data.notes, 32000), references: references(data.references, id), excludedReferencePaths: excludedPaths(data.excludedReferencePaths) };
  }
  async view(id) {
    const data = await this.read(id);
    return { ...data, references: await Promise.all(data.references.map(async ref => {
      const info = await stat(ref.path).catch(() => null);
      return { ...ref, exists: info?.isFile() === true, modifiedAt: info?.mtimeMs || 0 };
    })) };
  }
  async update(id, { section, value, revision } = {}) {
    id = taskId(id);
    if (!['summary', 'notes', 'references', 'excludedReferencePaths'].includes(section)) throw new Error('未知保存区域');
    const next = section === 'summary' ? summary(value) : section === 'notes' ? text(value, 32000) : section === 'excludedReferencePaths' ? excludedPaths(value) : references(value, id);
    const file = this.file(id);
    await mkdir(path.dirname(file), { recursive: true });
    let lock;
    try { lock = await open(`${file}.lock`, 'wx', 0o600); }
    catch { throw new Error('另一处正在保存，请稍后重试'); }
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const current = await this.read(id);
      if (revision !== current.revision) throw new Error('内容已在其他位置更新，请重新读取后合并');
      const result = { ...current, [section]: next, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(result, null, 2) + '\n'); } finally { await handle.close(); }
      await rename(temporary, file);
      return result;
    } finally {
      await unlink(temporary).catch(() => {});
      await lock.close(); await unlink(`${file}.lock`);
    }
  }
}
export async function handleTaskContextRequest(store, request, coldHistory, tokenSmart, automaticReferences) {
  try {
    const view = async () => {
      const data = await store.view(request.threadId);
      if (automaticReferences) {
        const auto = await automaticReferences.view(request.threadId);
        const manual = new Set(data.references.map(ref => ref.path));
        const excluded = new Set(data.excludedReferencePaths);
        data.automaticReferences = { ...auto, references: auto.references.filter(ref => !manual.has(ref.path) && !excluded.has(ref.path)) };
      }
      if (tokenSmart) data.tokenSmart = await tokenSmart.view(request.threadId);
      if (coldHistory) {
        try { data.coldHistory = await coldHistory.view(request.threadId); }
        catch { data.coldHistory = { unavailable: true, autoEnabled: false, busy: false, archives: [],
          error: '冷历史记录暂时无法读取，摘要和笔记仍可使用。' }; }
      }
      return data;
    };
    if (request.action === 'preview') {
      const data = await store.view(request.threadId);
      const auto = automaticReferences ? await automaticReferences.view(request.threadId) : { references: [] };
      const excluded = new Set(data.excludedReferencePaths);
      const ref = [...data.references, ...auto.references.filter(ref => !excluded.has(ref.path))]
        .find(ref => ref.path === request.path && ref.exists === true);
      if (!ref) throw new Error('文件已失效或不属于本任务的可见资料，请重新读取。');
      let preview;
      try {
        const extension = path.extname(ref.path).toLowerCase();
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' }[extension];
        if (mime) {
          const handle = await open(ref.path, 'r');
          try {
            const info = await handle.stat();
            if (!info.isFile() || info.size > 12 * 1024 * 1024) throw new Error('size');
            const buffer = Buffer.alloc(info.size), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            preview = { type: 'image', image: `data:${mime};base64,${buffer.subarray(0, bytesRead).toString('base64')}` };
          } finally { await handle.close(); }
        } else {
          preview = await previewFile(ref.path);
          if (!['markdown', 'code', 'document', 'html', 'office', 'archive'].includes(preview.type)) {
            preview = { type: preview.type, text: '此格式暂不支持预览，可在本机应用中打开。', truncated: false };
          }
        }
      } catch { throw new Error('此文件暂时无法预览；图片需小于 12 MB。'); }
      return { id: request.id, threadId: taskId(request.threadId), preview: { ...preview, label: ref.label } };
    }
    if (request.action === 'read') return { id: request.id, threadId: taskId(request.threadId), data: await view() };
    if (request.action?.startsWith('cold:')) {
      if (!coldHistory) throw new Error('冷历史服务尚未连接');
      await coldHistory.handle(request);
      return { id: request.id, threadId: taskId(request.threadId), data: await view() };
    }
    if (request.action !== 'save') throw new Error('未知任务操作');
    await store.update(request.threadId, request);
    return { id: request.id, threadId: taskId(request.threadId), data: await view() };
  } catch (error) { return { id: request.id, threadId: request.threadId, error: error.message }; }
}
