import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatGptCatalog } from '../nuyoah/taskboard/chatgpt-catalog.mjs';
const id = '11111111-1111-4111-8111-111111111111';
function setup(read) {
  const timers = new Map(); let sequence = 0, changes = 0;
  const catalog = createChatGptCatalog({ read, onChange: () => changes++, now: () => 1790100000000,
    setTimer(fn, ms) { const key = ++sequence; timers.set(key, { fn, ms }); return key; }, clearTimer: key => timers.delete(key) });
  return { catalog, timers, get changes() { return changes; } };
}
test('chat identities and metadata stay separate, activity transitions update attention without claiming a final result', async () => {
  let status = 'active';
  const f = setup(async () => [{ id, title: '虚构生图聊天', status, updatedAt: 1790000000, preview: 'PRIVATE_SENTINEL' }]);
  try {
    await f.catalog.refresh(); assert.deepEqual(f.catalog.snapshot(), []);
    f.catalog.setActive(true); await f.catalog.refresh();
    const running = f.catalog.snapshot()[0];
    assert.equal(running.taskKey, `chatgpt:${id}`); assert.equal(running.hostId, 'chatgpt'); assert.equal(running.runtimeStatus, 'running');
    assert.equal(running.hasFinalResponse, false); assert.doesNotMatch(JSON.stringify(running), /PRIVATE_SENTINEL/);
    await f.catalog.refresh(); assert.equal(f.changes, 1, 'unchanged snapshots do not trigger renders');
    status = 'idle'; await f.catalog.refresh();
    const idle = f.catalog.snapshot()[0]; assert.equal(idle.runtimeStatus, 'completed'); assert.equal(idle.hasFinalResponse, false);
    assert.ok(Date.parse(idle.activityAt) > Date.parse(running.activityAt));
    assert.equal([...f.timers.values()][0].ms, 2000);
    f.catalog.setActive(false); assert.equal(f.timers.size, 0);
  } finally { f.catalog.dispose(); }
});
test('failed or late reads preserve truthful state, single flight and bounded retries', async () => {
  let fail = false, resolve, calls = 0;
  const f = setup(async () => { calls++; if (fail) throw Error('private'); return [{ id, title: '虚构聊天', status: 'active' }]; });
  try {
    f.catalog.setActive(true); await f.catalog.refresh(); fail = true; await f.catalog.refresh();
    assert.equal(f.catalog.snapshot()[0].runtimeStatus, 'unknown'); assert.equal(f.catalog.syncState()[0].hasSnapshot, true);
    assert.equal([...f.timers.values()][0].ms, 15000);
    fail = false; await f.catalog.refresh(); assert.deepEqual(f.catalog.syncState(), []);
  } finally { f.catalog.dispose(); }
  const late = setup(() => new Promise(done => { resolve = done; }));
  late.catalog.setActive(true); const pending = late.catalog.refresh(); assert.equal(late.catalog.refresh(), pending);
  await Promise.resolve(); late.catalog.setActive(false); resolve([{ id, status: 'active' }]); await pending;
  assert.deepEqual(late.catalog.snapshot(), []); assert.equal(late.changes, 0); assert.equal(late.timers.size, 0);
  late.catalog.dispose();
});
