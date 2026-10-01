import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createProjectView } from '../nuyoah/workstation/project-view.mjs';
import * as live from '../nuyoah/taskboard/live-state.mjs';
function setup(values = {}) {
  const data = new Map(Object.entries(values)), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const states = vm.runInNewContext(live.liveStateRuntimeSource());
  const model = vm.runInNewContext(`(${createProjectView.toString()})`)({ storage, states });
  return { model, data, storage };
}
const date = '2026-09-11T01:00:00Z';
test('project and Taskboard share wait, runtime, confirmation and history semantics', () => {
  const meta = { seen: { seenAt: date, initialHistory: true }, confirmed: { seenAt: date, completedAt: date }, pending: { seenAt: date, manualPending: true } };
  const { model } = setup({ 'taskboard.codex-live-meta.v2': JSON.stringify(meta) });
  const tasks = [
    { threadId: 'seen', runtimeStatus: 'completed' }, { threadId: 'confirmed', runtimeStatus: 'completed' },
    { threadId: 'pending', runtimeStatus: 'completed' }, { threadId: 'input', runtimeStatus: 'running', waitingReason: 'input' },
    { threadId: 'approval', runtimeStatus: 'running', waitingReason: 'approval' }, { threadId: 'active', runtimeStatus: 'running' },
    { threadId: 'failure', runtimeStatus: 'failed' },
  ].map(task => ({ ...task, hostId: 'local', updatedAt: date }));
  for (const task of tasks) {
    const actual = model.present([task])[0], expected = live.liveTaskStatus(task, meta[task.threadId]);
    assert.equal(actual.displayStatus === 'history' ? 'completed' : actual.displayStatus, expected);
  }
  assert.equal(model.present(tasks).find(t => t.threadId === 'seen').displayStatus, 'history');
  assert.equal(model.present(tasks).find(t => t.threadId === 'confirmed').displayStatus, 'completed');
  assert.equal(model.present(tasks).find(t => t.threadId === 'input').statusLabel, '需要补充信息');
});
test('all matching project tasks are reachable and preferences remain scoped after recreation', () => {
  const { model, data } = setup();
  const tasks = model.present(Array.from({ length: 19 }, (_, i) => ({ threadId: String(i), title: `任务 ${i}`, hostId: 'local', updatedAt: date })));
  const a = model.scope('local', 'project'), b = model.scope('remote', 'project');
  const state = model.read(a); assert.equal(model.select(tasks, state).visible.length, 12);
  state.count += 12; state.scrollTop = 650; state.query = '任务'; state.filter = 'history'; model.save(a, state);
  const restored = setup(Object.fromEntries(data)).model;
  assert.equal(restored.select(tasks, restored.read(a)).visible.length, 19);
  assert.equal(restored.read(a).scrollTop, 650); assert.equal(restored.read(b).query, '');
  assert.equal(restored.select(tasks, { query: '不存在' }).filtered.length, 0);
  assert.notEqual(model.identity({ threadId: 'same', hostId: 'local' }), model.identity({ threadId: 'same', hostId: 'remote' }));
});
test('opening a project does not bootstrap remote history into attention or mutate acknowledgements', () => {
  const before = JSON.stringify({}), { model, data } = setup({ 'taskboard.codex-live-meta.v2': before, 'taskboard.remote-history-cutoff.v1': String(Date.parse(date)) });
  const task = { threadId: 'old', taskKey: 'remote/old', hostId: 'remote', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', runtimeStatus: 'completed' };
  assert.equal(model.present([task])[0].displayStatus, 'history');
  assert.equal(data.get('taskboard.codex-live-meta.v2'), before);
});
test('native project selection does not mix same IDs from different devices or unrelated projects', async () => {
  const source = await readFile(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function currentProjectSnapshot() {'), end = source.indexOf('\n  function saveProjectPosition()', start);
  const snapshot = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
    currentCodexTaskContext: () => ({ threadId: 'same', hostId: 'remote' }),
    getTaskboardSnapshot: () => ({ tasks: [
      { threadId: 'same', hostId: 'local', projectId: 'p', projectName: 'Local' },
      { threadId: 'same', hostId: 'remote', projectId: 'p', projectName: 'Remote' },
      { threadId: 'second', hostId: 'remote', projectId: 'p' },
      { threadId: 'third', hostId: 'remote', projectId: 'q' },
    ] }),
  })();
  assert.equal(snapshot.projectName, 'Remote'); assert.equal(snapshot.entries.length, 2);
  assert.ok(snapshot.entries.every(task => task.hostId === 'remote' && task.projectId === 'p'));
});
test('project history remains reachable without changing the default Taskboard inventory', async () => {
  const source = await readFile(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function getTaskboardSnapshot('), end = source.indexOf('\n  function createProjectTask(', start);
  const snapshot = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
    taskCatalog: [{ threadId: 'active', updatedAt: date }],
    searchCatalog: [{ threadId: 'active', updatedAt: date }, { threadId: 'old', updatedAt: date }, { threadId: 'archive', updatedAt: date, archived: true }],
    normalizedThreadId: id => id, activeProjectThreadIds: new Set(), interruptedCatalogByThread: new Map(), taskboardPreview: () => ({}), pinnedThreadIds: new Set(), window: {},
  });
  assert.equal(snapshot().tasks.length, 1);
  const all = snapshot({ includeProjectHistory: true }).tasks;
  assert.equal(all.length, 3); assert.equal(all.find(task => task.threadId === 'old').catalogHistory, true);
  const { model } = setup({ 'taskboard.codex-live-meta.v2': '{}' });
  assert.equal(model.present(all).find(task => task.threadId === 'old').statusLabel, '历史记录');
  assert.equal(model.present(all).find(task => task.threadId === 'archive').statusLabel, '已归档');
});

test('new-task project view follows the selected folder, while an existing task keeps its actual project', async () => {
 const source = await readFile(new URL('../inject/conversation-preview.user.js', import.meta.url), 'utf8');
 const code = source.slice(source.indexOf('  function currentProjectSnapshot()'), source.indexOf('\n  function saveProjectPosition()'));
 const tasks = [{threadId:'one',hostId:'local',projectId:'p',projectName:'Selected'}, {threadId:'two',hostId:'local',projectId:'q',projectName:'Actual'}];
 const sandbox = {currentCodexTaskContext:()=>({threadId:'',hostId:'local'}),getTaskboardSnapshot:()=>({tasks}),activeFolderId:'p',ALL_FOLDER_ID:'all',folderSources:new Map([['p',{id:'p',label:'Selected'}]])};
 vm.createContext(sandbox);vm.runInContext(code,sandbox);
 let snapshot = vm.runInContext('currentProjectSnapshot()',sandbox);
 assert.equal(snapshot.projectName,'Selected');assert.equal(snapshot.entries.length,1);
 sandbox.currentCodexTaskContext=()=>({threadId:'two',hostId:'local'});
 snapshot=vm.runInContext('currentProjectSnapshot()',sandbox);
 assert.equal(snapshot.projectId,'q');assert.equal(snapshot.entries[0].threadId,'two');
 sandbox.currentCodexTaskContext=()=>({threadId:'',hostId:'local'});sandbox.activeFolderId='all';
 assert.equal(vm.runInContext('currentProjectSnapshot()',sandbox).entries.length,0);
});
