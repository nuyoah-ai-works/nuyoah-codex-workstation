import assert from 'node:assert/strict';
import test from 'node:test';
import { AssetConsoleBridge } from '../lib/asset-console-bridge.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const commands = [], publications = [], listeners = new Map();
  const bridge = new AssetConsoleBridge();
  const client = {
    hook: async () => {},
    on(method, handler) {
      const handlers = listeners.get(method) || new Set();
      handlers.add(handler); listeners.set(method, handlers);
      return () => { handlers.delete(handler); if (!handlers.size) listeners.delete(method); };
    },
    async send(method, params = {}, sessionId = null) {
      commands.push({ method, params, sessionId });
      await client.hook(method, params, sessionId);
      return {};
    },
  };
  bridge.client = client;
  bridge.waitForService = async () => {};
  bridge.publish = async state => { publications.push(state); };
  const request = (action, requestId) => bridge.handleBinding(JSON.stringify({ action, requestId }));
  const assertReleased = () => {
    assert.equal(bridge.proxy, null);
    assert.equal(listeners.size, 0);
    const autoAttach = commands.filter(command => command.method === 'Target.setAutoAttach');
    if (autoAttach.length) assert.equal(autoAttach.at(-1).params.autoAttach, false);
  };
  return { bridge, client, commands, publications, listeners, request, assertReleased };
}

test('closing during service startup cancels the open and a stale close cannot kill its retry', async () => {
  const f = fixture(), started = deferred();
  let signal, probes = 0;
  f.bridge.waitForService = AssetConsoleBridge.prototype.waitForService;
  f.bridge.requestLocal = value => new Promise((resolve, reject) => {
    signal = value.signal; probes += 1; started.resolve();
    signal.addEventListener('abort', () => reject(new Error('fixture cancelled')), { once: true });
  });
  const opening = f.request('open', 'first');
  await started.promise;
  await f.request('close', 'first');
  assert.equal(signal.aborted, true);
  await opening; assert.equal(probes, 1, 'cancelled startup must not continue polling');
  assert.equal(f.publications.length, 0); f.assertReleased();
  f.bridge.waitForService = async () => {};
  await f.request('open', 'retry');
  const retryProxy = f.bridge.proxy;
  await f.request('close', 'first');
  assert.equal(f.bridge.proxy, retryProxy);
  assert.equal(retryProxy.cancelled, false);
  assert.deepEqual(f.publications.map(({ requestId, state }) => [requestId, state]), [['retry', 'ready']]);
  await f.request('close', 'retry'); f.assertReleased();
});

test('closing during CDP setup cancels immediately and leaves no transport after setup returns', async () => {
  const f = fixture(), started = deferred(), setup = deferred();
  f.client.hook = async (method, params) => {
    if (method === 'Target.setAutoAttach' && params.autoAttach) { started.resolve(); await setup.promise; }
  };
  const opening = f.request('open', 'pending');
  await started.promise;
  const proxy = f.bridge.proxy;
  const closing = f.request('close', 'pending');
  assert.equal(proxy.cancelled, true);
  assert.equal(proxy.abort.signal.aborted, true);
  setup.resolve(); await Promise.all([opening, closing]);
  assert.equal(f.publications.length, 0);
  assert.ok(!f.commands.some(command => command.method === 'Fetch.enable'));
  f.assertReleased();
});

test('a setup failure concurrent with close still releases the proxy', async () => {
  const f = fixture(), started = deferred(), setup = deferred();
  f.client.hook = async method => {
    if (method === 'Fetch.enable') { started.resolve(); await setup.promise; }
  };
  const opening = f.request('open', 'failed');
  await started.promise;
  const closing = f.request('close', 'failed');
  setup.reject(new Error('fixture setup failure'));
  await Promise.all([opening, closing]);
  assert.equal(f.publications.length, 0); f.assertReleased();
});

test('retry during failed-open cleanup receives only its own state', async () => {
  const f = fixture(), cleaning = deferred(), cleanup = deferred();
  let failSetup = true, delayCleanup = true;
  f.client.hook = async method => {
    if (method === 'Fetch.enable' && failSetup) { failSetup = false; throw new Error('fixture setup failure'); }
    if (method === 'Fetch.disable' && delayCleanup) { delayCleanup = false; cleaning.resolve(); await cleanup.promise; }
  };
  const first = f.request('open', 'failed');
  await cleaning.promise;
  const retry = f.request('open', 'retry');
  cleanup.resolve(); await Promise.all([first, retry]);
  assert.deepEqual(f.publications.map(({ requestId, state }) => [requestId, state]), [['retry', 'ready']]);
  assert.equal(f.bridge.proxy.cancelled, false);
  await f.request('close', 'retry'); f.assertReleased();
});

test('closing aborts active requests, wakes queued requests and blocks late static responses', async () => {
  const f = fixture();
  await f.request('open', 'active');
  const proxy = f.bridge.proxy, active = deferred();
  let started = 0;
  f.bridge.staticResponse = async () => null;
  f.bridge.requestLocal = ({ signal }) => new Promise((resolve, reject) => {
    if (++started === 4) active.resolve();
    signal.addEventListener('abort', () => reject(new Error('fixture cancelled')), { once: true });
  });
  const event = requestId => ({ requestId, frameId: 'assets', request: { url: `${proxy.embedUrl}api/library`, method: 'GET', headers: {} } });
  const pending = Array.from({ length: 6 }, (_, index) => f.bridge.proxyRequest(event(`request-${index}`), null, proxy));
  await active.promise;
  assert.equal(proxy.waiters.length, 2);
  await f.request('close', 'active'); await Promise.all(pending);
  assert.equal(proxy.activeRequests, 0); assert.equal(proxy.waiters.length, 0);
  assert.equal(f.commands.filter(command => command.method === 'Fetch.failRequest').length, 6);
  f.assertReleased();

  await f.request('open', 'static');
  const staticProxy = f.bridge.proxy, reading = deferred(), response = deferred();
  f.bridge.staticResponse = async () => { reading.resolve(); return response.promise; };
  const staticRequest = f.bridge.proxyRequest({ requestId: 'static', frameId: 'static-assets', request: { url: staticProxy.embedUrl, method: 'GET', headers: {} } }, null, staticProxy);
  await reading.promise; await f.request('close', 'static');
  response.resolve({ status: 200, headers: {}, body: Buffer.from('fixture document') });
  await staticRequest;
  assert.ok(!f.commands.some(command => command.method === 'Fetch.fulfillRequest'));
  f.assertReleased();
});
