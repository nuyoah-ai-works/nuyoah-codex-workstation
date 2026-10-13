import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatGptCatalog } from '../nuyoah/taskboard/chatgpt-catalog.mjs';
const id = '11111111-1111-4111-8111-111111111111';
function setup(read) {
  const timers = new Map(); let sequence = 0, changes = 0, time = 1790100000000;
  const catalog = createChatGptCatalog({ read, onChange: () => changes++, now: () => time,
    setTimer(fn, ms) { const key = ++sequence; timers.set(key, { fn, ms }); return key; }, clearTimer: key => timers.delete(key) });
  return { catalog, timers, advance(ms) { time += ms; }, get now() { return time; }, get changes() { return changes; } };
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
    fail = false; f.advance(15000); await f.catalog.refresh(); assert.deepEqual(f.catalog.syncState(), []);
  } finally { f.catalog.dispose(); }
  const late = setup(() => new Promise(done => { resolve = done; }));
  late.catalog.setActive(true); const pending = late.catalog.refresh(); assert.equal(late.catalog.refresh(), pending);
  await Promise.resolve(); late.catalog.setActive(false); resolve([{ id, status: 'active' }]); await pending;
  assert.deepEqual(late.catalog.snapshot(), []); assert.equal(late.changes, 0); assert.equal(late.timers.size, 0);
  late.catalog.dispose();
});

test('a timed-out native query keeps its flight lock across close/reopen and late results cannot replace the snapshot', async () => {
  let slow = false, resolve, reads = 0;
  const f = setup(() => { reads++; return slow ? new Promise(done => { resolve = done; }) : [{ id, status: 'active' }]; });
  try {
    f.catalog.setActive(true); await f.catalog.refresh();
    slow = true; const pending = f.catalog.refresh(); await Promise.resolve();
    const [timerId, deadline] = [...f.timers].find(([, t]) => t.ms === 12000);
    f.timers.delete(timerId); f.advance(12000); deadline.fn();
    assert.equal(f.catalog.snapshot()[0].runtimeStatus, 'unknown');
    f.catalog.setActive(false); f.catalog.setActive(true); f.advance(300000);
    assert.equal(f.catalog.refresh(), pending); assert.equal(reads, 2);
    resolve([]); await pending;
    assert.equal(f.catalog.snapshot().length, 1, 'late empty result does not erase the retained card');
    slow = false; await f.catalog.refresh();
    assert.equal(reads, 3); assert.equal(f.catalog.snapshot()[0].runtimeStatus, 'running');
  } finally { f.catalog.dispose(); }
});

test('challenge and server retry deadlines survive repeated refresh and panel reopen', async () => {
  let failure = null, reads = 0;
  const f = setup(async () => { reads++; if (failure) throw failure; return [{ id, status: 'idle' }]; });
  try {
    f.catalog.setActive(true); await f.catalog.refresh();
    failure = Object.assign(new Error('redacted'), { status: 403, errorCode: 'cloudflare_challenge' });
    await f.catalog.refresh();
    assert.equal([...f.timers.values()][0].ms, 300000);
    for (let i = 0; i < 4; i++) { f.catalog.setActive(false); f.catalog.setActive(true); await f.catalog.refresh(); }
    assert.equal(reads, 2); assert.equal(f.catalog.snapshot().length, 1);
    f.advance(300000);
    failure = Object.assign(new Error('redacted'), { status: 429, retryAtMs: f.now + 600000 });
    await f.catalog.refresh(); assert.equal([...f.timers.values()][0].ms, 600000);
    failure = null; f.advance(600000); await f.catalog.refresh();
    assert.deepEqual(f.catalog.syncState(), []); assert.equal([...f.timers.values()][0].ms, 2000);
  } finally { f.catalog.dispose(); }
});

test('ordinary failures back off and account-unavailable probes wait without clearing cards', async () => {
  let failure = null, reads = 0;
  const f = setup(async () => { reads++; if (failure) throw failure; return [{ id, status: 'active' }]; });
  try {
    f.catalog.setActive(true); await f.catalog.refresh(); failure = new Error('redacted');
    for (const delay of [15000, 30000, 60000, 120000, 240000, 300000]) {
      await f.catalog.refresh(); assert.equal([...f.timers.values()][0].ms, delay); f.advance(delay);
    }
    failure = Object.assign(new Error('redacted'), { code: 'settings_unavailable' });
    await f.catalog.refresh(); assert.equal([...f.timers.values()][0].ms, 60000);
    assert.equal(f.catalog.snapshot()[0].runtimeStatus, 'unknown');
    f.catalog.dispose(); f.advance(60000); await f.catalog.refresh(); assert.equal(reads, 8);
  } finally { f.catalog.dispose(); }
});

test('a protected error arriving after the display timeout still applies its full retry deadline', async () => {
  let reject, reads = 0;
  const f = setup(() => { reads++; return new Promise((_, fail) => { reject = fail; }); });
  try {
    f.catalog.setActive(true); const pending = f.catalog.refresh(); await Promise.resolve();
    const [key, deadline] = [...f.timers].find(([, t]) => t.ms === 12000);
    f.timers.delete(key); f.advance(12000); deadline.fn();
    f.advance(30000); reject(Object.assign(new Error('redacted'), { status: 403 })); await pending;
    assert.equal([...f.timers.values()][0].ms, 300000);
    await f.catalog.refresh(); assert.equal(reads, 1);
  } finally { f.catalog.dispose(); }
});
