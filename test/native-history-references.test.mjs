import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AutomaticReferences } from '../nuyoah/workstation/automatic-references.mjs';
import { readNativeHistoryReferences } from '../nuyoah/workstation/native-history-references.mjs';
import { TaskContextStore } from '../nuyoah/workstation/task-context-store.mjs';
import { startAssetServer } from '../nuyoah/assets/server.mjs';

const id = '11111111-1111-1111-1111-111111111111', other = '22222222-2222-2222-2222-222222222222';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=', 'base64');
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-references-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'session.jsonl');
  return { root, file, records: async (items, base) => writeFile(file, [
    { type: 'session_meta', payload: { id, cwd: root, ...(base ? { history_base: base } : {}) } }, ...items,
  ].map(r => JSON.stringify(r)).join('\n') + '\n') };
}
function historyDb(root) {
  const db = new DatabaseSync(path.join(root, 'thread_history_1.sqlite'));
  db.exec(`CREATE TABLE thread_history_projection_state (thread_id TEXT PRIMARY KEY, next_rollout_ordinal INTEGER, next_rollout_byte_offset INTEGER);
    CREATE TABLE thread_items (thread_id TEXT, item_id TEXT, item_type TEXT, rollout_ordinal INTEGER, updated_at_ordinal INTEGER, item_json TEXT);`);
  return { db, add: (ordinal, item, thread = id, updated = ordinal) => db.prepare('INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?)')
    .run(thread, String(ordinal), item.type, ordinal, updated, JSON.stringify(item)) };
}
const completed = (item, thread = id) => ({ type: 'event_msg', payload: { type: 'item_completed', thread_id: thread, item } });

test('native completion evidence recovers variable-based writes and images, rejecting failed and foreign items', async t => {
  const { root, file, records } = await fixture(t);
  const image = path.join(root, '生成 图.png'), report = path.join(root, 'review.json'), moved = path.join(root, 'moved.md');
  await Promise.all([writeFile(image, png), writeFile(report, '{}'), writeFile(moved, '# Moved')]);
  await records([
    completed({ type: 'Extension', kind: 'image_gen.generation', status: 'completed', savedPath: image }),
    completed({ type: 'ImageView', path: pathToFileURL(image).href }),
    completed({ type: 'FileChange', status: 'completed', changes: { [report]: { type: 'add', content: 'PRIVATE_DIFF' }, 'old.md': { type: 'update', move_path: moved } } }),
    ...['failed', 'inProgress', 'declined'].map(status => completed({ type: 'FileChange', status, changes: { 'failed.md': { type: 'add' } } })),
    completed({ type: 'FileChange', status: 'completed', changes: { 'deleted.md': { type: 'delete' } } }),
    completed({ type: 'Extension', kind: 'image_gen.generation', status: 'completed', failure: 'failed', savedPath: path.join(root, 'bad.png') }),
    completed({ type: 'Extension', kind: 'unrelated', status: 'completed', savedPath: path.join(root, 'unrelated.png') }),
    completed({ type: 'ImageView', path: 'file://foreign-host/private.png' }),
    completed({ type: 'ImageView', path: path.join(root, '.env') }),
    completed({ type: 'ImageView', path: path.join(root, 'foreign.png') }, other),
    { type: 'response_item', payload: { type: 'function_call_output', output: JSON.stringify(completed({ type: 'ImageView', path: path.join(root, 'quoted.png') })) } },
  ]);
  const original = await readFile(file);
  const r = await new AutomaticReferences({ source: async () => file }).view(id);
  assert.equal(r.status, 'ready'); assert.equal(r.references.length, 3);
  assert.ok(r.references.every(ref => ref.exists && ref.relation === 'output'));
  assert.equal(r.references.find(ref => ref.path === image).evidence, 'generated');
  assert.deepEqual(await readFile(file), original);
});

test('same-task paginated history returns bounded reference fields and serves recovered images and documents', async t => {
  const { root, file, records } = await fixture(t), { db, add } = historyDb(root);
  const image = path.join(root, 'original.png'), doc = path.join(root, 'review.json'), input = path.join(root, 'input.png');
  await Promise.all([writeFile(image, png), writeFile(input, png), writeFile(doc, '{"review":"readable"}')]);
  db.prepare('INSERT INTO thread_history_projection_state VALUES (?, ?, ?)').run(id, 100, 1000);
  add(1, { type: 'imageGeneration', status: 'completed', savedPath: image, revisedPrompt: 'PRIVATE_PROMPT', result: 'PRIVATE_IMAGE_BYTES' });
  add(2, { type: 'fileChange', status: 'completed', changes: [{ path: doc, kind: { type: 'add' }, diff: 'PRIVATE_DIFF' }] });
  add(3, { type: 'userMessage', content: [{ type: 'localImage', path: input }, { type: 'image', url: 'PRIVATE_IMAGE_BYTES' }] });
  add(4, { type: 'imageView', path: image });
  add(5, { type: 'agentMessage', phase: 'final_answer', text: `[自查报告](${doc})` });
  add(6, { type: 'reasoning', text: 'PRIVATE_REASONING' });
  add(7, { type: 'commandExecution', aggregatedOutput: 'PRIVATE_COMMAND_OUTPUT' });
  add(8, { type: 'fileChange', status: 'failed', changes: [{ path: path.join(root, 'failed.md'), kind: { type: 'add' } }] });
  add(9, { type: 'imageView', path: path.join(root, 'foreign.png') }, other);
  add(10, { type: 'imageView', path: path.join(root, 'later-update.png') }, id, 150);
  add(101, { type: 'imageView', path: path.join(root, 'after-boundary.png') });
  db.close();
  const history = (task, end) => readNativeHistoryReferences(task, end, { codexHome: root });
  const evidence = await history(id, 100);
  assert.equal(evidence.partial, false); assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_|foreign|after-boundary|later-update/);
  assert.equal((await readNativeHistoryReferences(id, 100, { codexHome: root, maxItems: 1 })).partial, true);
  assert.equal((await readNativeHistoryReferences(id, 100, { codexHome: root, maxBytes: 1 })).items.length, 0);
  await records([completed({ type: 'ImageView', path: pathToFileURL(image).href })], { thread_id: id, end_ordinal_exclusive: 100 });
  const automatic = new AutomaticReferences({ source: async () => file, history });
  const refs = await automatic.view(id);
  assert.equal(refs.status, 'ready'); assert.equal(refs.references.length, 3);
  assert.equal(refs.references.find(ref => ref.path === image).relation, 'output');
  assert.equal(refs.references.find(ref => ref.path === doc).label, '自查报告');
  const token = 'fixture-native-asset-token-01234567890123456789';
  const taskStore = new TaskContextStore(path.join(root, 'contexts'));
  const app = await startAssetServer({ stateRoot: path.join(root, 'assets'), token, port: 0, taskStore, automatic });
  t.after(() => app.close());
  const call = route => fetch(`http://127.0.0.1:${app.server.address().port}${route}`, { headers: { 'x-asset-console-token': token } });
  const list = await (await call('/api/assets?scope=task&threadId=' + id)).json();
  assert.equal(list.total, 3);
  const photo = list.assets.find(a => a.name === 'original.png'), report = list.assets.find(a => a.name === '自查报告');
  assert.equal((await call(`/media?id=${photo.id}&threadId=${id}`)).status, 200);
  assert.match(JSON.stringify(await (await call(`/api/preview?id=${report.id}&threadId=${id}`)).json()), /readable/);
  assert.equal((await call(`/media?id=${photo.id}&threadId=${other}`)).status, 400);
  await taskStore.update(id, { section: 'excludedReferencePaths', revision: 0, value: [image] });
  assert.equal((await (await call('/api/assets?scope=task&threadId=' + id)).json()).total, 2);
  assert.equal((await call(`/media?id=${photo.id}&threadId=${id}`)).status, 400);
});

test('missing or incomplete history stays partial, retries projection, and never follows a foreign base', async t => {
  const { root, file, records } = await fixture(t);
  let calls = 0, partial = true;
  const history = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 25)); return { partial, items: [] }; };
  const service = new AutomaticReferences({ source: async () => file, history });
  const current = path.join(root, 'current.png'); await writeFile(current, png);
  await records([completed({ type: 'Extension', kind: 'image_gen.generation', status: 'completed', savedPath: current })], { thread_id: id, end_ordinal_exclusive: 100 });
  const incomplete = await service.view(id);
  assert.equal(incomplete.status, 'partial'); assert.equal(incomplete.references[0].path, current);
  partial = false; assert.equal((await service.view(id)).status, 'ready');
  await service.view(id); assert.equal(calls, 2);
  await records([], { thread_id: other, end_ordinal_exclusive: 100 });
  assert.equal((await service.view(id)).status, 'partial'); assert.equal(calls, 2);
  assert.equal((await readNativeHistoryReferences(id, 100, { codexHome: root })).partial, true);
});

test('long non-resumed tasks recover early outputs across projects without mixing identities or trusting an oversized projection', async t => {
  const { root } = await fixture(t), { db, add } = historyDb(root);
  const files = new Map(), expected = new Map();
  for (const [thread, project] of [[id, 'project-a'], [other, 'project-b']]) {
    const image = path.join(root, project + '.png'), report = path.join(root, project + '.json');
    await writeFile(image, png); await writeFile(report, '{}'); expected.set(thread, [image, report]);
    add(1, { type: 'imageGeneration', status: 'completed', savedPath: image }, thread);
    const file = path.join(root, project + '.jsonl'); files.set(thread, file);
    const lines = [
      { type: 'session_meta', payload: { id: thread, cwd: path.join(root, project) } },
      completed({ type: 'Extension', kind: 'image_gen.generation', status: 'completed', savedPath: image }, thread),
      { type: 'response_item', payload: { type: 'message', role: 'user', content: 'padding'.repeat(2000) } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: `[报告](${report})` } },
    ].map(r => JSON.stringify(r)).join('\n') + '\n';
    await writeFile(file, lines);
    db.prepare('INSERT INTO thread_history_projection_state VALUES (?, ?, ?)').run(thread, 4, Buffer.byteLength(lines));
  }
  const history = (thread, end, options) => readNativeHistoryReferences(thread, end, { ...options, codexHome: root });
  const service = new AutomaticReferences({ source: async thread => files.get(thread), history, maxBytes: 1500 });
  for (const thread of [id, other, id]) {
    const result = await service.view(thread);
    assert.equal(result.status, 'partial', 'unparsed raw history remains explicitly partial');
    assert.deepEqual(result.references.map(r => r.path).sort(), expected.get(thread).sort());
    assert.ok(result.references.every(r => r.sourceThreadId === thread && r.exists));
  }
  db.prepare('UPDATE thread_history_projection_state SET next_rollout_byte_offset = 999999 WHERE thread_id = ?').run(id);
  const fallback = await new AutomaticReferences({ source: async thread => files.get(thread), history, maxBytes: 1500 }).view(id);
  assert.equal(fallback.status, 'partial'); assert.deepEqual(fallback.references.map(r => r.path), expected.get(id).filter(p => p.endsWith('.json')));
  db.close();
});
