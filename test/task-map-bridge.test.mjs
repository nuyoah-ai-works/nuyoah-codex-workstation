import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createInjectorScheduler } from '../lib/injector-scheduler.mjs';
import { createCapsuleSidebar } from '../nuyoah/workstation/sidebar-capsules.mjs';

const source = await readFile(new URL('../scripts/injector.mjs', import.meta.url), 'utf8');
const bridge = source.slice(source.indexOf('async function processTaskMapRequest('), source.indexOf('async function currentArchivedThreadIds()'));
const pump = source.slice(source.indexOf('async function pumpRequests()'), source.indexOf('async function stop()'));
function setup(request, tasks, read = async () => ({ status: 'ready', nodes: [], edges: [] })) {
  const received = [], calls = [];
  const window = { __nuyoahTaskMapUI__: { takeRequest: () => { const next = request; request = null; return next; }, receive: data => received.push(data) },
    __codexConversationPreviewInjection__: { getTaskboardSnapshot: () => ({ tasks }) } };
  const scheduler = createInjectorScheduler({ onError: (name, error) => { throw error; } });
  const context = { scheduler, rendererRevision: 1, isCurrentRenderer: (owner, revision) => revision === context.rendererRevision && owner === context.client, processSkillLabelRequest() {}, processTaskContextRequest() {}, processWorkItemsRequest() {}, processMagpieRequest() {}, processAppShortcutRequest() {}, client: { evaluate: script => vm.runInNewContext(script, { window, document: { visibilityState: 'visible' } }) }, attachedTargetId: 'fictional-target',
    taskRelations: { view: async params => { calls.push(params); return read(params); } } };
  const run = vm.runInNewContext(`${bridge}\n${pump}\npumpRequests;`, context);
  return { run: async () => { await run(); await scheduler.settle(); }, pump: run, scheduler, context, calls, received };
}
test('production map bridge projects only task metadata into the read-only relationship service', async () => {
  const request = { id: 'fictional-request', consumer: 'task-map', scope: 'conversation', hostId: 'local', threadId: '11111111-1111-4111-8111-111111111111' };
  const tasks = [{ hostId: 'local', threadId: request.threadId, title: '虚构主任务', projectId: 'fictional-project', runtimeStatus: 'running', parentThreadId: '22222222-2222-4222-8222-222222222222',
    preview: 'PRIVATE_SENTINEL', progress: 'PRIVATE_SENTINEL', turns: ['PRIVATE_SENTINEL'], workspacePath: '/fictional/private-source' }];
  const f = setup(request, tasks); await f.run();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].scope, 'conversation');
  assert.equal(f.calls[0].tasks[0].parentThreadId, tasks[0].parentThreadId);
  assert.doesNotMatch(JSON.stringify(f.calls), /PRIVATE_SENTINEL|private-source|workspacePath|preview|turns|progress/);
  assert.equal(f.received[0].id, request.id); assert.equal(f.received[0].data.status, 'ready');
});
test('map read errors return a scoped safe failure instead of dropping the injector connection', async () => {
  const f = setup({ id: 'failed-map', scope: 'global' }, [], async () => { throw new Error('/fictional/private-file: access denied'); });
  await f.run(); assert.equal(f.received[0].id, 'failed-map');
  assert.equal(f.received[0].error, '任务关联暂时无法读取。'); assert.doesNotMatch(JSON.stringify(f.received), /private-file/);
  const idle = setup(null, []); await idle.run(); assert.equal(idle.calls.length, 0); assert.equal(idle.received.length, 0);
});

test('production injection retains task action memory before the outer UI teardown', () => {
  const from = source.indexOf('const rendererSource = '), to = source.indexOf(';\n', from) + 1;
  const generated = vm.runInNewContext(`${source.slice(from, to)}\nrendererSource;`, {
    workstationConfig: {}, projectSource: '', taskContextSource: '', workCanvasSource: '', workItemsSource: '', taskActionTransportSource: '', remoteSource: '', multiChatSource: '', autoMetadataSource: '', magpieSource: '', appShortcutsSource: '',
    userSource: 'window.__codexConversationPreviewInjection__.destroy();', taskMapSource: '',
    createNativeTaskMapAdapter: function () { return {}; }, createSkillTimeline: function () { return {}; },
    createSkillClassification: function () { return { labels: [], categoryFor: () => '未分类' }; },
    createCapsuleSidebar,
  });
  let retained = false, destroyed = false;
  const window = { __nuyoahTaskMapUI__: { retainActions() { retained = true; } },
    __codexConversationPreviewInjection__: { destroy() { assert.equal(retained, true); destroyed = true; } } };
  window.top = window; vm.runInNewContext(generated, { window, document: {} }); assert.equal(destroyed, true);
});


test('map requests finish while background scanning is blocked; detached renderers receive no stale data', async () => {
  let releaseScan;
  const f = setup({ id: 'fast-map', scope: 'global' }, []);
  f.scheduler.run('previews', () => new Promise(resolve => { releaseScan = resolve; }));
  await f.pump(); await f.scheduler.run('map', () => assert.fail('duplicate map read'));
  assert.equal(f.received.length, 1); assert.equal(f.scheduler.busy('previews'), true);
  releaseScan(); await f.scheduler.settle();
  let releaseMap;
  const stale = setup({ id: 'old-renderer', scope: 'global' }, [], () => new Promise(resolve => { releaseMap = resolve; }));
  await stale.pump(); stale.context.rendererRevision++;
  releaseMap({ status: 'ready', nodes: [], edges: [] }); await stale.scheduler.settle();
  assert.equal(stale.received.length, 0);
});
