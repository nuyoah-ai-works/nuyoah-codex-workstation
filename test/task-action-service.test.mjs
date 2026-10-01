import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { TaskActionService } from '../nuyoah/workstation/task-action-service.mjs';
import { TaskActionStore } from '../nuyoah/workstation/task-action-store.mjs';
const a = { hostId: 'local', threadId: '11111111-1111-4111-8111-111111111111' };
const b = { hostId: 'local', threadId: '22222222-2222-4222-8222-222222222222' };
const c = { hostId: 'local', threadId: '33333333-3333-4333-8333-333333333333' };
async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-actions-'));
  const calls = [], rows = [{ id: a.threadId, title: '主任务' }, { id: b.threadId, title: '子任务', source: { subagent: { thread_spawn: { parent_thread_id: a.threadId } } } }];
  const native = { inspect: async target => ({ available: true, target, canSend: true, canCreate: true, resultText: 'FINAL_SENTINEL' }),
    send: async (...args) => { calls.push(['send', ...args]); }, create: async (...args) => { calls.push(['create', ...args]); return { child: c }; } };
  const store = new TaskActionStore(root), service = new TaskActionService({ store, native, metadata: async () => ({ rows }) });
  try { await fn({ service, store, native, rows, calls }); } finally { await rm(root, { recursive: true, force: true }); }
}
const request = (target = a, action = 'send') => ({ id: randomUUID(), target, action, text: 'PRIVATE_REQUEST_SENTINEL' });
test('follow-up targets the selected identity and confirmed replay never dispatches twice', () => fixture(async f => {
  const input = request(b); assert.equal((await f.service.execute(input)).status, 'succeeded');
  await f.service.execute(input); assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0][1], b);
  assert.doesNotMatch((await readFile(f.store.file)).toString(), /PRIVATE_REQUEST_SENTINEL/);
}));
test('delivery resolves the real parent and rejects a stale displayed destination', () => fixture(async f => {
  const info = await f.service.inspect(b); assert.equal(info.parent.threadId, a.threadId); assert.equal(info.resultText, 'FINAL_SENTINEL');
  const input = { ...request(b, 'deliver'), expectedParent: a };
  assert.equal((await f.service.execute({ ...input, expectedParent: c })).status, 'failed'); assert.equal(f.calls.length, 0);
  assert.equal((await f.service.execute(input)).status, 'succeeded'); assert.deepEqual(f.calls[0][1], a);
  assert.match(f.calls[0][2], new RegExp(b.threadId));
}));
test('creation links only the returned child and failed first turn preserves its identity', () => fixture(async f => {
  assert.equal((await f.service.execute(request(a, 'create'))).status, 'succeeded'); assert.deepEqual(f.store.parentOf(c), a);
  const next = request(b, 'create'), d = { ...c, threadId: randomUUID() };
  f.native.create = async () => { throw Object.assign(new Error('Uncertain'), { child: d }); };
  const result = await f.service.execute(next); assert.equal(result.status, 'unknown'); assert.deepEqual(result.child, d); assert.deepEqual(f.store.parentOf(d), b);
  f.native.create = async () => ({ child: { ...c, threadId: randomUUID() } });
  f.store.addChild = () => { throw new Error('Storage unavailable'); };
  const unlinked = await f.service.execute(request(a, 'create')); assert.equal(unlinked.status, 'unknown'); assert.ok(unlinked.child?.threadId);
}));
test('uncertain receipts block blind replay even with a fresh UI request ID', () => fixture(async f => {
  f.native.send = async () => { f.calls.push('sent'); throw new Error('Connection lost'); };
  const input = request(a); assert.equal((await f.service.execute(input)).status, 'unknown');
  await f.service.execute({ ...input, id: randomUUID() }); assert.equal(f.calls.length, 1);
  assert.equal((await f.service.inspect(a)).pendingReceipt.status, 'unknown');
}));
test('concurrent commands cannot duplicate dispatch; invalid and archived tasks never execute', () => fixture(async f => {
  let release; f.native.send = () => new Promise(resolve => { release = resolve; });
  const pending = f.service.execute(request(a)); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.service.execute(request(a))).status, 'failed'); release(); await pending;
  f.rows[0].archived = 1; assert.equal((await f.service.execute(request(a))).status, 'failed');
  assert.equal((await f.service.execute(request({ ...b, hostId: 'remote' }))).status, 'failed');
  assert.equal((await f.service.execute({ ...request(b), text: 'x'.repeat(16001) })).status, 'failed');
}));
