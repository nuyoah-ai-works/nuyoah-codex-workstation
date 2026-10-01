import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TaskActionStore } from '../nuyoah/workstation/task-action-store.mjs';
const parent = { hostId: 'local', threadId: '11111111-1111-4111-8111-111111111111' };
const child = { hostId: 'local', threadId: '22222222-2222-4222-8222-222222222222' };
const id = '33333333-3333-4333-8333-333333333333';
async function fixture(fn) { const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-journal-')); try { await fn(new TaskActionStore(root), root); } finally { await rm(root, { recursive: true, force: true }); } }
test('command journal survives restart without retrying unknown or successful dispatch', () => fixture(async (store, root) => {
  assert.deepEqual(store.relations(), []);
  const input = { id, action: 'send', target: parent, fingerprint: 'a'.repeat(64), text: 'PRIVATE_PROMPT_SENTINEL' };
  assert.equal(store.begin(input).fresh, true);
  assert.equal(new TaskActionStore(root).begin(input).record.status, 'unknown');
  assert.equal(store.begin(input).fresh, false);
  assert.throws(() => store.begin({ ...input, fingerprint: 'b'.repeat(64) }), /不同指令/);
  store.finish(id, { status: 'succeeded', message: '已发送。', resultText: 'PRIVATE_RESULT_SENTINEL' });
  assert.equal(store.begin(input).record.status, 'succeeded');
  assert.doesNotMatch((await readFile(store.file)).toString(), /PRIVATE_/);
}));
test('explicit creation receipts survive restart and cannot reparent or cycle', () => fixture(async (store, root) => {
  store.addChild({ parent, child }); store.addChild({ parent, child });
  assert.deepEqual(new TaskActionStore(root).parentOf(child), parent);
  assert.equal(store.relations()[0].source, 'canvas-command');
  assert.throws(() => store.addChild({ parent: child, child: parent }), /循环/);
  assert.throws(() => store.addChild({ parent: { ...parent, threadId: id }, child }), /其他父任务/);
  assert.throws(() => store.addChild({ parent, child: { ...child, hostId: 'remote' } }), /本机任务/);
}));
test('corrupt journals fail closed and full journals preserve replay', () => fixture(async (store, root) => {
  const full = new TaskActionStore(root, { limit: 0 });
  assert.throws(() => full.begin({ id, action: 'send', target: parent, fingerprint: 'a'.repeat(64) }), /已满/);
  await writeFile(store.file, 'broken'); assert.throws(() => store.relations());
}));
