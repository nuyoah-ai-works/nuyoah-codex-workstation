import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir, utimes } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ColdHistoryService, inspectColdHistorySource } from '../nuyoah/workstation/cold-history.mjs';
import { TaskContextStore, handleTaskContextRequest } from '../nuyoah/workstation/task-context-store.mjs';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const python = process.env.NUYOAH_PYTHON || 'python3';
const query = fileURLToPath(new URL('../vendor/codex-thread-cold-history/scripts/cold_history.py', import.meta.url));
const fixture = (text, end = 'task_complete') => [
  { type: 'session_meta', payload: { id } },
  { type: 'event_msg', payload: { type: 'task_started' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'synthetic answer' }] } },
  { type: 'event_msg', payload: { type: end } },
].map(x => JSON.stringify({ timestamp: '2026-09-09T00:00:00Z', ...x }) + '\n').join('');

test('manual snapshot copies modern messages, registers metadata, and leaves live source intact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cold-service-'));
  try {
    const source = path.join(root, 'source.jsonl');
    const raw = fixture('synthetic first decision'); await writeFile(source, raw);
    const store = new TaskContextStore(path.join(root, 'context'));
    await store.update(id, { section: 'notes', value: 'keep', revision: 0 });
    const service = new ColdHistoryService({ root: path.join(root, 'archives'), store, source: async () => source, python });
    const response = await handleTaskContextRequest(store, { id: 'request', action: 'cold:archive', threadId: id }, service);
    assert.equal(response.data.coldHistory.busy, true);
    await service.jobs.get(id);
    const view = await service.view(id);
    assert.equal(view.error, ''); assert.equal(view.archives.length, 1);
    assert.equal(view.archives[0].exists, true);
    const archive = path.dirname(view.archives[0].entry);
    assert.equal(await readFile(path.join(archive, 'original.jsonl'), 'utf8'), raw);
    assert.equal(await readFile(source, 'utf8'), raw);
    assert.equal((await store.read(id)).notes, 'keep');
    const degraded = await handleTaskContextRequest(store, { id: 'degraded', action: 'save', threadId: id,
      section: 'notes', revision: (await store.read(id)).revision, value: 'still editable' }, { view: async () => { throw new Error('offline'); } });
    assert.equal(degraded.data.notes, 'still editable');
    assert.equal(degraded.data.coldHistory.unavailable, true);
    const results = execFileSync(python, [query, '--archive', archive, 'search', 'first decision'], { encoding: 'utf8' });
    assert.match(results, /synthetic first decision/);
    service.start(id); await service.jobs.get(id);
    assert.equal((await service.view(id)).archives.length, 1);
    await service.associate(other, view.archives[0].entry);
    assert.equal((await service.view(other)).archives.length, 1);
    assert.equal((await store.read(other)).references[0].sourceThreadId, id);
    const release = await service.lock(id);
    await assert.rejects(service.setAuto(id, true), /另一个归档/);
    await release();
    await writeFile(source, fixture('still running', 'task_started'));
    await assert.rejects(inspectColdHistorySource(source, id), /仍在运行/);
    service.start(id); await service.jobs.get(id);
    assert.match((await service.view(id)).error, /仍在运行/);
    assert.equal((await service.view(id)).archives.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('automatic snapshots require opt-in, idle completion and one success per day', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cold-auto-'));
  try {
    const source = path.join(root, 'source.jsonl'); await writeFile(source, fixture('first'));
    let now = Date.now(); let sourceReads = 0;
    const service = new ColdHistoryService({ root: path.join(root, 'archives'),
      store: new TaskContextStore(path.join(root, 'context')), python, now: () => now,
      source: async () => { sourceReads++; return source; } });
    await service.tick(); assert.equal(sourceReads, 0);
    await service.setAuto(id, true);
    now += 31_000; await service.tick(); assert.equal(service.jobs.size, 0);
    const old = new Date(now - 6 * 60_000); await utimes(source, old, old);
    now += 31_000; await service.tick(); await service.jobs.get(id);
    assert.equal((await service.view(id)).archives.length, 1);
    await writeFile(source, fixture('second')); await utimes(source, old, old);
    now += 31_000; await service.tick(); assert.equal(service.jobs.size, 0);
    assert.equal((await service.view(id)).archives.length, 1);
    now += 24 * 60 * 60_000; await service.tick(); await service.jobs.get(id);
    assert.equal((await service.view(id)).archives.length, 2);
    assert.equal((await service.store.read(id)).references.length, 1, 'latest managed reference replaces prior entry while snapshots remain');
    assert.equal((await service.view(id)).autoEnabled, true);
    await service.setAuto(id, false);
    const reads = sourceReads; now += 24 * 60 * 60_000; await service.tick(); assert.equal(sourceReads, reads);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a source change during indexing prevents publishing a snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cold-race-'));
  try {
    const source = path.join(root, 'source.jsonl'); await writeFile(source, fixture('before'));
    const service = new ColdHistoryService({ root: path.join(root, 'archives'),
      store: new TaskContextStore(path.join(root, 'context')), python, source: async () => source });
    const run = service.runQuery.bind(service);
    service.runQuery = async (archive, command) => {
      const result = await run(archive, command);
      if (command === 'index') await writeFile(source, fixture('after'));
      return result;
    };
    service.start(id); await service.jobs.get(id);
    const view = await service.view(id);
    assert.match(view.error, /发生变化/); assert.equal(view.archives.length, 0);
    assert.equal((await readdir(service.directory(id))).filter(name => name.startsWith('.pending')).length, 0);
    assert.equal((await service.store.read(id)).revision, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('global opt-in discovers existing and future tasks without opening their panels, retaining overrides', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cold-default-'));
  try {
    const source = path.join(root, 'source.jsonl');
    const secondSource = path.join(root, 'second.jsonl');
    await writeFile(source, fixture('first'));
    await writeFile(secondSource, fixture('second').replaceAll(id, other));
    let now = Date.now(); let catalog = [id]; let discoveryCount = 0;
    const old = new Date(now - 6 * 60_000);
    await utimes(source, old, old); await utimes(secondSource, old, old);
    const options = { root: path.join(root, 'archives'), store: new TaskContextStore(path.join(root, 'context')),
      python, now: () => now, source: async task => task === id ? source : secondSource,
      listTasks: async () => { discoveryCount++; return catalog; } };
    const service = new ColdHistoryService(options);
    await service.tick(); assert.equal(discoveryCount, 0);
    await service.setDefaultAuto(true);
    assert.equal((await service.view(id)).autoEnabled, true);
    assert.equal(await readFile(service.stateFile(id), 'utf8').catch(e => e.code), 'ENOENT');
    await service.tick(); await service.jobs.get(id);
    assert.equal((await service.view(id)).archives.length, 1);
    catalog = [id, other];
    now += 24 * 60 * 60_000;
    // The unchanged first task must not starve a newly discovered task on the following day.
    const restarted = new ColdHistoryService(options);
    await restarted.tick(); await restarted.jobs.get(other);
    assert.equal((await restarted.view(other)).archives.length, 1);
    assert.equal((await restarted.view(id)).archives.length, 1);
    await restarted.setAuto(other, false);
    assert.equal((await new ColdHistoryService(options).view(other)).autoEnabled, false);
    await restarted.setDefaultAuto(false);
    assert.equal((await restarted.view(id)).autoEnabled, false, 'snapshots retain inheritance');
    await restarted.setAuto(id, true);
    assert.equal((await restarted.view(id)).autoEnabled, true, 'explicit opt-in still works without global opt-in');
    await writeFile(path.join(options.root, 'settings.json'), '{broken');
    await assert.rejects(restarted.tick(), /默认设置读取失败/);
    assert.equal(restarted.jobs.size, 0);
    assert.equal(await readFile(source, 'utf8'), fixture('first'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
