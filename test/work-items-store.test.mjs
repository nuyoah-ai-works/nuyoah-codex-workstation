import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { WorkItemsStore, handleWorkItemsRequest } from '../nuyoah/workstation/work-items-store.mjs';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../scripts/work-items.mjs', import.meta.url));
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const node = (patch = {}) => ({ id: 'goal', parentId: '', title: 'Deliver an explicit result', kind: 'goal', status: 'todo', source: 'task-summary', updatedAt: null, manualStatus: null, ...patch });
const item = (patch = {}) => ({ id: '', title: 'An explicit work item', direction: 'Writing', nextStep: 'Check the draft', note: '', status: 'idea', focus: false, archived: false, threadLinks: [], nodes: [], ...patch });
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'work-items-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new WorkItemsStore(path.join(root, 'data'));
  const env = { ...process.env, NUYOAH_WORKSTATION_DATA_DIR: store.root, CODEX_HOME: path.join(root, 'unused-codex-home') };
  const command = (...args) => run(process.execPath, ['--disable-warning=ExperimentalWarning', cli, ...args], { env });
  return { root, store, env, command };
}

test('empty read is side-effect free; complete saves retain explicit identity and deduplicate only same-host links', async t => {
  const { root, store } = await fixture(t);
  assert.deepEqual(await store.read(), { schemaVersion: 1, revision: 0, updatedAt: null, items: [] });
  assert.deepEqual(await readdir(root), []);
  const input = item({ threadLinks: [{ hostId: 'local', threadId: firstId }, { hostId: 'local', threadId: firstId }, { hostId: 'remote:example', threadId: firstId }] });
  const saved = await store.save(input, 0);
  assert.match(saved.items[0].id, /^[a-f\d-]{36}$/);
  assert.equal(input.id, '');
  assert.equal(saved.revision, 1);
  assert.equal(saved.items[0].threadLinks.length, 2);
  assert.deepEqual(await store.read(), saved);
  assert.deepEqual((await readdir(root)).sort(), ['data']);
});

test('recorded progress, reversible manual status and structural edits share one persistent plan', async t => {
  const { store } = await fixture(t);
  let current = await store.save(item({ nodes: [node({ manualStatus: 'done' })] }), 0);
  const editable = current.items[0];
  editable.nodes[0].status = 'waiting';
  editable.nodes[0].source = 'test-results';
  editable.nodes[0].updatedAt = '2026-09-21T08:00:00.000Z';
  editable.nodes.push(node({ id: 'review', parentId: 'goal', title: 'Review the outcome', kind: 'next' }));
  current = await store.save(editable, current.revision);
  assert.equal(current.items[0].nodes[0].status, 'waiting');
  assert.equal(current.items[0].nodes[0].manualStatus, 'done');
  editable.nodes[0].manualStatus = null;
  editable.nodes[0].title = 'Revised explicit goal';
  editable.nodes[1].parentId = '';
  current = await store.save(editable, current.revision);
  assert.equal(current.items[0].nodes[0].manualStatus, null);
  assert.equal(current.items[0].nodes[0].status, 'waiting');
  assert.equal((await store.read()).items[0].nodes[1].parentId, '');
});

test('archive and restore retain content and never derive status from task identities', async t => {
  const { store } = await fixture(t);
  const first = await store.save(item({ id: firstId, status: 'doing', note: 'Keep this note' }), 0);
  await store.save(item({ id: secondId, title: 'Another item' }), first.revision);
  const archived = await store.archive(firstId, true, 2);
  assert.equal(archived.items[0].archived, true);
  assert.equal(archived.items[0].status, 'doing');
  const restored = await store.archive(firstId, false, 3);
  assert.equal(restored.items[0].note, 'Keep this note');
  assert.equal(restored.items[1].title, 'Another item');
  assert.equal(restored.items[0].archived, false);
  await assert.rejects(store.archive('33333333-3333-4333-8333-333333333333', true, 4), /没有找到/);
  assert.equal((await store.read()).revision, 4);
});

test('stale writes and concurrent stores cannot overwrite another save', async t => {
  const { store } = await fixture(t);
  await store.save(item({ id: firstId }), 0);
  const other = new WorkItemsStore(store.root);
  const writes = await Promise.allSettled([
    store.save(item({ id: firstId, title: 'First candidate' }), 1),
    other.save(item({ id: firstId, title: 'Second candidate' }), 1),
  ]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(writes.find(result => result.status === 'rejected').reason.message, /正在保存|重新读取/);
  const current = await store.read();
  assert.equal(current.revision, 2);
  await assert.rejects(store.save(item({ id: firstId, title: 'Stale' }), 1), /重新读取/);
  assert.deepEqual(await store.read(), current);
  assert.ok(!(await readdir(store.root)).some(name => name.endsWith('.tmp')));
});

test('corrupt and invalid persisted records fail closed without exposing paths or replacing bytes', async t => {
  const { store } = await fixture(t);
  await store.save(item({ id: firstId }), 0);
  const good = JSON.parse(await readFile(store.file(), 'utf8'));
  const corruptions = ['{broken', 'null', JSON.stringify({ ...good, schemaVersion: 2 }), JSON.stringify({ ...good, items: [item({ id: firstId, nodes: [node({ parentId: 'missing' })] })] })];
  for (const content of corruptions) {
    await writeFile(store.file(), content);
    await assert.rejects(store.read(), error => /无法读取或已损坏/.test(error.message) && !error.message.includes(store.root));
    await assert.rejects(store.save(item(), 0), /无法读取或已损坏/);
    assert.equal(await readFile(store.file(), 'utf8'), content);
  }
});

test('invalid trees, schema fields, dates and capacity reject entire changes without truncation', async t => {
  const { store } = await fixture(t);
  await store.save(item({ id: firstId }), 0);
  const before = await readFile(store.file(), 'utf8');
  const invalid = [
    item({ nodes: [node(), node()] }),
    item({ nodes: [node({ parentId: 'missing' })] }),
    item({ nodes: [node({ parentId: 'child' }), node({ id: 'child', parentId: 'goal' })] }),
    item({ nodes: [node({ manualStatus: 'unknown' })] }),
    item({ nodes: [node({ updatedAt: 'September 21, 2026' })] }),
    item({ nodes: [node({ updatedAt: '2026-02-30T08:00:00Z' })] }),
    item({ nodes: Array.from({ length: 201 }, (_, i) => node({ id: `node-${i}` })) }),
    item({ nodes: Array.from({ length: 21 }, (_, i) => node({ id: `n${i}`, parentId: i ? `n${i - 1}` : '' })) }),
    item({ title: 'x'.repeat(241) }),
    item({ execute: 'must not run' }),
    item({ threadLinks: [{ hostId: 'local', threadId: firstId, title: 'Do not persist task titles' }] }),
    item({ nodes: [{ ...node(), command: 'must not run' }] }),
    item({ id: '../../escape' }),
  ];
  for (const value of invalid) await assert.rejects(store.save(value, 1));
  await assert.rejects(store.save(item(), -1));
  assert.equal(await readFile(store.file(), 'utf8'), before);
});

test('request bridge returns matching tokens, full snapshots and actionable conflict errors', async t => {
  const { store } = await fixture(t);
  assert.deepEqual(await handleWorkItemsRequest(store, { consumer: 'work-items', id: 'r1', action: 'read' }), { id: 'r1', data: await store.read() });
  const saved = await handleWorkItemsRequest(store, { consumer: 'work-items', id: 'r2', action: 'save', item: item({ id: firstId }), revision: 0 });
  assert.equal(saved.id, 'r2'); assert.equal(saved.data.items[0].id, firstId);
  const conflict = await handleWorkItemsRequest(store, { consumer: 'work-items', id: 'r3', action: 'save', item: item(), revision: 0 });
  assert.equal(conflict.id, 'r3'); assert.match(conflict.error, /重新读取/);
  const archived = await handleWorkItemsRequest(store, { consumer: 'work-items', id: 'r4', action: 'archive', itemId: firstId, archived: true, revision: 1 });
  assert.equal(archived.data.items[0].archived, true);
  assert.ok((await handleWorkItemsRequest(store, { consumer: 'other', id: 'r5', action: 'read' })).error);
  assert.ok((await handleWorkItemsRequest(store, { consumer: 'work-items', id: 'r6', action: 'execute' })).error);
  assert.deepEqual(await handleWorkItemsRequest(store, null), { id: null, error: '工作事项请求无效。' });
});

test('CLI runs empty, save/read, export, archive/restore and failure paths with JSON stdout', async t => {
  const { root, command, store } = await fixture(t);
  const help = await command('--help');
  assert.match(help.stdout, /manualStatus/); assert.match(help.stdout, /threadLinks/);
  assert.equal(JSON.parse((await command('read')).stdout).items.length, 0);
  const input = path.join(root, 'input.json');
  await writeFile(input, JSON.stringify(item({ id: firstId, nodes: [node()] })));
  const saved = JSON.parse((await command('save', input, '0')).stdout);
  assert.equal(saved.revision, 1);
  assert.deepEqual(JSON.parse((await command('read', firstId)).stdout), { revision: 1, item: saved.items[0] });
  assert.deepEqual(JSON.parse((await command('export')).stdout), saved);
  assert.deepEqual(JSON.parse((await command('export', firstId)).stdout), { revision: 1, item: saved.items[0] });
  assert.equal(JSON.parse((await command('archive', firstId, '1')).stdout).items[0].archived, true);
  assert.equal(JSON.parse((await command('restore', firstId, '2')).stdout).items[0].archived, false);
  for (const args of [['save', input, '0'], ['read', secondId], ['save', path.join(root, 'private-missing.json'), '3'], ['save', input, 'no'], ['read', firstId, 'extra']]) {
    await assert.rejects(command(...args), error => error.code === 1 && error.stdout === '' && !!error.stderr.trim() && !error.stderr.includes(root));
  }
  assert.equal((await store.read()).revision, 3);
});

test('independent CLI processes serialize a shared revision and leave a readable store', async t => {
  const { root, command, store } = await fixture(t);
  const a = path.join(root, 'a.json'), b = path.join(root, 'b.json');
  await writeFile(a, JSON.stringify(item({ id: firstId, title: 'A' })));
  await writeFile(b, JSON.stringify(item({ id: secondId, title: 'B' })));
  const results = await Promise.allSettled([command('save', a, '0'), command('save', b, '0')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const current = await store.read();
  assert.equal(current.revision, 1); assert.equal(current.items.length, 1);
  const next = await command('archive', current.items[0].id, '1');
  assert.equal(JSON.parse(next.stdout).revision, 2);
});
