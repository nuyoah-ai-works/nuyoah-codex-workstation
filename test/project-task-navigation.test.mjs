import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
const start = source.indexOf('  function openProjectTask(');
const code = source.slice(start, source.indexOf('\n  function renderProjectOverview()', start));
const id = '11111111-1111-4111-8111-111111111111';
function fixture(rows = [], hostInfo) {
  const routes = [], revealed = [], feedback = { textContent: '' };
  const open = vm.runInNewContext(`(${code.trim()})`, {
    document: { querySelectorAll: () => rows },
    normalizedThreadId: value => String(value || '').replace(/^local:/, '').toLowerCase(),
    revealThread: value => revealed.push(value),
    URLSearchParams,
    window: { postMessage: value => routes.push(JSON.parse(JSON.stringify(value))), __nuyoahMultiChatNative__: hostInfo ? { hostInfo } : undefined },
  });
  return { open: (entry, options) => open(entry, { querySelector: () => feedback }, options), routes, revealed, feedback };
}
test('returning to a local source explicitly routes even when its native sidebar row remains selected', () => {
  let clicked = 0;
  const f = fixture([{ getAttribute: key => key.endsWith('host-id') ? 'local' : `local:${id}`, hasAttribute: () => false, click: () => clicked++ }]);
  assert.equal(f.open({ hostId: 'local', threadId: id }, { returning: true }), true);
  assert.equal(clicked, 0);
  assert.deepEqual(f.routes, [{ type: 'navigate-to-route', path: `/local/${id}` }]);
});
test('remote grid navigation carries the configured device and refuses unavailable devices', () => {
  const hostId = 'remote-control:fixture-host';
  const f = fixture([], () => ({ available: true }));
  assert.equal(f.open({ hostId, threadId: id }, { returning: true }), true);
  const route = new URL(f.routes[0].path, 'http://127.0.0.1'); assert.equal(route.pathname, '/local/' + id); assert.equal(route.searchParams.get('hostId'), hostId);
  const offline = fixture([], () => ({ available: false }));
  assert.equal(offline.open({ hostId, threadId: id }, { returning: true }), false); assert.equal(offline.routes.length, 0); assert.match(offline.feedback.textContent, /未连接/);
});
test('DB-only local child uses an explicit route while an unavailable remote task fails without navigating', () => {
  const f = fixture();
  assert.equal(f.open({ hostId: 'local', threadId: id }), true);
  assert.deepEqual(f.revealed, [id]);
  assert.deepEqual(f.routes, [{ type: 'navigate-to-route', path: `/local/${id}` }]);
  assert.equal(f.open({ hostId: 'remote:fixture', threadId: id }, { returning: true }), false);
  assert.equal(f.routes.length, 1); assert.match(f.feedback.textContent, /远程项目/);
});
test('invalid identities cannot emit navigation and rows are matched by host as well as thread', () => {
  let clicked = 0;
  const f = fixture([{ getAttribute: key => key.endsWith('host-id') ? 'remote:fixture' : id, hasAttribute: () => false, click: () => clicked++ }]);
  assert.equal(f.open({ hostId: 'remote:fixture', threadId: id }), true); assert.equal(clicked, 1);
  assert.equal(f.open({ hostId: 'local', threadId: '../../invalid' }), false);
  assert.equal(f.open({ threadId: id }), false);
  assert.equal(f.routes.length, 0);
});
