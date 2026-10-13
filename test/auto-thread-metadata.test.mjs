import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoThreadMetadata, readAutoThreadMetadata, AUTO_THREAD_METADATA_KEY } from '../nuyoah/workstation/auto-thread-metadata.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const event = { hostId: 'local', threadId: id, turnId: 'turn-one', status: 'completed' };
const tick = () => new Promise(resolve => setTimeout(resolve, 8));
function fixture(overrides = {}) {
  const data = new Map(), calls = [], messages = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const input = { title: '启动工作站', description: '启动项目工作站', turnId: 'turn-one', user: '把任务状态分组改为纵向，卡片横向', assistant: '任务面板排版已更新。' };
  let receive;
  const native = {
    subscribe(callback) { receive = callback; return () => { receive = null; }; },
    async read(_id, turnId) { calls.push('read'); return input.turnId === turnId ? { ...input } : null; },
    async generate(prompt) { calls.push(['generate', prompt]); return { title: '工作站任务面板排版', description: '任务面板的纵向状态分组与横向卡片排版。' }; },
    async rename(_id, title, expected) { calls.push('rename'); if (input.title !== expected) return false; input.title = title; return true; },
    setDescription(_id, description) { calls.push('description'); input.description = description; },
    ...overrides,
  };
  const window = { localStorage: storage, setTimeout, clearTimeout,
    addEventListener: (key, callback) => messages.set(key, callback), removeEventListener: key => messages.delete(key),
    document: { getElementById: () => ({ contentWindow: null }) } };
  const build = () => createAutoThreadMetadata({ window, adapter: { metadataSession: async () => native }, delayMs: 0 });
  return { data, storage, calls, input, native, build, emit: value => receive?.(value), messages };
}
test('opt-in only, no remote, failed or continuing turns, one generation per successful turn', async () => {
  const f = fixture(), service = f.build(); await service.start();
  f.emit(event); await tick(); assert.equal(f.calls.length, 0);
  service.setEnabled(true);
  for (const value of [{ ...event, hostId: 'remote' }, { ...event, status: 'failed' }, { ...event, hasPendingContinuation: true }]) f.emit(value);
  await tick(); assert.equal(f.calls.length, 0);
  f.emit(event); f.emit(event); await tick();
  assert.equal(f.calls.filter(x => Array.isArray(x)).length, 1);
  assert.equal(f.input.title, '工作站任务面板排版');
  assert.equal(readAutoThreadMetadata(f.storage).entries[id].status, 'updated');
  const saved = f.data.get(AUTO_THREAD_METADATA_KEY);
  assert.ok(!saved.includes(f.input.user)); assert.ok(!saved.includes(f.input.assistant));
  service.destroy();
  const again = f.build(); await again.start(); f.emit(event); await tick();
  assert.equal(f.calls.filter(x => Array.isArray(x)).length, 1); again.destroy();
});
test('manual title changes lock further writes and undo preserves the original title', async () => {
  const f = fixture(), service = f.build(); await service.start(); service.setEnabled(true);
  f.emit(event); await tick(); await service.undo(id);
  assert.equal(f.input.title, '启动工作站');
  assert.equal(readAutoThreadMetadata(f.storage).entries[id].locked, true);
  service.setLocked(id, false); f.input.turnId = 'turn-two'; f.emit({ ...event, turnId: 'turn-two' }); await tick();
  f.input.title = '用户指定的固定名称'; f.input.turnId = 'turn-three'; f.emit({ ...event, turnId: 'turn-three' }); await tick();
  assert.equal(f.input.title, '用户指定的固定名称');
  assert.equal(readAutoThreadMetadata(f.storage).entries[id].status, 'manual-title'); service.destroy();
});
test('newer turns and concurrent manual edits reject stale model results', async () => {
  for (const mutation of ['turn', 'title']) {
    let finish;
    const f = fixture({ generate: () => new Promise(resolve => { finish = resolve; }) });
    const service = f.build(); await service.start(); service.setEnabled(true); f.emit(event); await tick();
    if (mutation === 'turn') f.input.turnId = 'new-turn'; else f.input.title = '手动指定';
    finish({ title: '迟到标题', description: '迟到摘要' }); await tick();
    assert.equal(f.calls.includes('rename'), false); assert.equal(f.calls.includes('description'), false); service.destroy();
  }
});
test('disable and disposal cancel inference and never apply late output', async () => {
  for (const action of ['disable', 'destroy']) {
    let finish, signal;
    const f = fixture({ generate: (_, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); } });
    const service = f.build(); await service.start(); service.setEnabled(true); f.emit(event); await tick();
    if (action === 'disable') service.setEnabled(false); else service.destroy();
    assert.equal(signal.aborted, true);
    finish({ title: '迟到标题', description: '迟到摘要' }); await tick();
    assert.equal(f.calls.includes('rename'), false); service.destroy();
  }
});
test('generation failures are not retried and uncertain writes retain recovery evidence', async () => {
  const f = fixture({ generate: async () => { throw new Error('offline'); } });
  const service = f.build(); await service.start(); service.setEnabled(true); f.emit(event); await tick();
  assert.equal(readAutoThreadMetadata(f.storage).entries[id].status, 'generation-failed');
  assert.equal(f.input.title, '启动工作站'); service.destroy();
  const g = fixture({ rename: async () => { throw new Error('unknown receipt'); } });
  const other = g.build(); await other.start(); other.setEnabled(true); g.emit(event); await tick();
  const record = readAutoThreadMetadata(g.storage).entries[id];
  assert.equal(record.status, 'write-unknown'); assert.equal(record.previousTitle, '启动工作站');
  assert.equal(g.calls.includes('description'), false); other.destroy();
});
test('locked tasks do not generate and unrelated windows cannot change preferences', async () => {
  const f = fixture(), service = f.build(); await service.start(); service.setEnabled(true); service.setLocked(id, true);
  f.emit(event); await tick(); assert.equal(f.calls.length, 0);
  await f.messages.get('message')({ source: {}, data: { type: 'taskboard:auto-title', action: 'enabled', value: false } });
  assert.equal(readAutoThreadMetadata(f.storage).enabled, true); service.destroy();
});
