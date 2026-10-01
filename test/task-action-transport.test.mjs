import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../nuyoah/workstation/task-action-transport.js', import.meta.url), 'utf8');
function fixture(adapter = {}) {
  let id = 0; const timers = new Map(), window = { __nuyoahNativeTaskAdapter__: adapter };
  const context = vm.createContext({ window, crypto: { randomUUID: () => `request-${++id}` }, setTimeout(fn, ms) { const key = ++id; timers.set(key, { fn, ms }); return key; }, clearTimeout(key) { timers.delete(key); } });
  vm.runInContext(source, context); return { window, timers, reload: () => vm.runInContext(source, context) };
}
test('UI reinjection retains pending requests without duplicating a write', async () => {
  const f = fixture(), api = f.window.__nuyoahTaskActionTransport__;
  const pending = f.window.__nuyoahTaskActions__.execute({ action: 'send', text: 'fictional' });
  f.reload(); assert.equal(f.window.__nuyoahTaskActionTransport__, api);
  const request = api.takeRequest(); assert.equal(api.takeRequest(), null);
  api.receive({ id: request.id, result: { status: 'succeeded' } }); assert.equal((await pending).status, 'succeeded');
});
test('expired undispatched requests never execute after the injector reconnects', async () => {
  const f = fixture(), api = f.window.__nuyoahTaskActionTransport__;
  const pending = f.window.__nuyoahTaskActions__.execute({ action: 'send' });
  [...f.timers.values()].find(value => value.ms === 75000).fn();
  assert.equal((await pending).status, 'unknown'); assert.equal(api.takeRequest(), null);
});
test('partial creation identities survive the native error boundary', async () => {
  const child = { hostId: 'local', threadId: '11111111-1111-4111-8111-111111111111' };
  const f = fixture({ create: async () => { throw Object.assign(new Error('PRIVATE_ERROR'), { child, definite: true }); } });
  const api = f.window.__nuyoahTaskActionTransport__;
  assert.equal(api.startNative({ id: 'one', method: 'create', args: [] }), true);
  await new Promise(resolve => setImmediate(resolve));
  const response = api.takeNative('one'); assert.equal(response.child.threadId, child.threadId); assert.equal(response.definite, true);
  assert.doesNotMatch(JSON.stringify(response), /PRIVATE_ERROR/); assert.equal(api.takeNative('one'), null);
});
