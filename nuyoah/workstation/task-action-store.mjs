import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { workstationDataRoot } from './task-context-store.mjs';

const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export function actionTarget(value) {
  if (value?.hostId !== 'local' || !uuid(value?.threadId)) throw new Error('请选择已同步的本机任务。');
  return { hostId: 'local', threadId: value.threadId.toLowerCase() };
}
const safeMessage = value => typeof value === 'string' && value.length <= 300 && !/[\x00-\x1f]/.test(value) ? value : '';
const record = row => row ? { id: row.id, action: row.action, target: JSON.parse(row.target), status: row.status,
  message: row.message, ...(row.child ? { child: JSON.parse(row.child) } : {}) } : null;

// Only identities, one-way digests and short fixed receipts belong here. Text is
// held by the caller in memory; a crashed pending operation remains unknown.
export class TaskActionStore {
  constructor(root = workstationDataRoot(), { limit = 100000 } = {}) { this.file = path.join(root, 'task-actions.sqlite'); this.limit = limit; }
  withDB(write, fn) {
    if (!write && !existsSync(this.file)) return fn(null);
    if (write) mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(this.file, { readOnly: !write });
    try {
      db.exec('PRAGMA busy_timeout=3000');
      if (write) db.exec(`CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY, action TEXT NOT NULL, target TEXT NOT NULL, fingerprint TEXT NOT NULL,
        status TEXT NOT NULL, message TEXT NOT NULL, child TEXT, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS children (child TEXT PRIMARY KEY, parent TEXT NOT NULL);`);
      return fn(db);
    } finally { db.close(); }
  }
  begin({ id, action, target, fingerprint }) {
    if (!uuid(id) || !['send', 'create', 'deliver'].includes(action) || !/^[a-f\d]{64}$/.test(fingerprint || '')) throw new Error('任务指令无效，请重新选择任务。');
    const selected = actionTarget(target);
    return this.withDB(true, db => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const prior = db.prepare('SELECT * FROM commands WHERE id=?').get(id);
        if (prior) {
          if (prior.fingerprint !== fingerprint || prior.action !== action || prior.target !== JSON.stringify(selected)) throw new Error('同一发送记录不能用于不同指令。');
          db.exec('COMMIT'); return { fresh: false, record: record(prior) };
        }
        const uncertain = db.prepare("SELECT * FROM commands WHERE fingerprint=? AND target=? AND status='unknown' ORDER BY created_at DESC LIMIT 1").get(fingerprint, JSON.stringify(selected));
        if (uncertain) { db.exec('COMMIT'); return { fresh: false, record: record(uncertain) }; }
        if (db.prepare('SELECT COUNT(*) AS n FROM commands').get().n >= this.limit) throw new Error('任务操作记录已满，请保留记录并检查后再发送。');
        db.prepare('INSERT INTO commands VALUES (?, ?, ?, ?, ?, ?, NULL, ?)').run(id, action, JSON.stringify(selected), fingerprint, 'unknown', '尚未确认执行结果，请打开对话核对。', Date.now());
        const result = record(db.prepare('SELECT * FROM commands WHERE id=?').get(id));
        db.exec('COMMIT'); return { fresh: true, record: result };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    });
  }
  finish(id, result) {
    if (!uuid(id) || !['succeeded', 'failed', 'unknown'].includes(result?.status)) throw new Error('任务回执无效。');
    const child = result.child ? actionTarget(result.child) : null;
    return this.withDB(true, db => {
      const prior = db.prepare('SELECT * FROM commands WHERE id=?').get(id);
      if (!prior) throw new Error('找不到任务发送记录。');
      if (prior.status !== 'unknown') return record(prior);
      db.prepare('UPDATE commands SET status=?,message=?,child=? WHERE id=?').run(result.status, safeMessage(result.message), child ? JSON.stringify(child) : null, id);
      return record(db.prepare('SELECT * FROM commands WHERE id=?').get(id));
    });
  }
  get(id) { return this.withDB(false, db => db ? record(db.prepare('SELECT * FROM commands WHERE id=?').get(id)) : null); }
  pendingFor(target) { const selected = JSON.stringify(actionTarget(target)); return this.withDB(false, db => db
    ? record(db.prepare("SELECT * FROM commands WHERE target=? AND status='unknown' ORDER BY created_at DESC LIMIT 1").get(selected)) : null); }
  addChild({ parent, child }) {
    const from = JSON.stringify(actionTarget(parent)), to = JSON.stringify(actionTarget(child));
    if (from === to) throw new Error('任务不能委派给自己。');
    return this.withDB(true, db => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = db.prepare('SELECT parent FROM children WHERE child=?').get(to);
        if (existing && existing.parent !== from) throw new Error('该子任务已有其他父任务。');
        const seen = new Set([to]); let next = from;
        while (next) {
          if (seen.has(next)) throw new Error('任务关系不能形成循环。');
          seen.add(next); next = db.prepare('SELECT parent FROM children WHERE child=?').get(next)?.parent;
        }
        db.prepare('INSERT OR IGNORE INTO children VALUES (?,?)').run(to, from); db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    });
  }
  parentOf(target) {
    const child = JSON.stringify(actionTarget(target));
    return this.withDB(false, db => { const row = db?.prepare('SELECT parent FROM children WHERE child=?').get(child); return row ? JSON.parse(row.parent) : null; });
  }
  relations() { return this.withDB(false, db => db ? db.prepare('SELECT parent,child FROM children').all().map(row => ({
    from: JSON.parse(row.parent), to: JSON.parse(row.child), kind: 'parent', source: 'canvas-command',
  })) : []); }
}
