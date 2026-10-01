import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { registerColdHistory } from '../scripts/register-cold-history.mjs';
import { TaskContextStore } from '../nuyoah/workstation/task-context-store.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const python = process.env.NUYOAH_PYTHON || 'python3';
const query = fileURLToPath(new URL('../vendor/codex-thread-cold-history/scripts/cold_history.py', import.meta.url));
test('cold archive verifies identity, registers once and preserves task content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cold-history-bridge-'));
  try {
    const archive = path.join(root, 'archive');
    await mkdir(archive);
    const original = path.join(archive, 'original.jsonl');
    const raw = [
      { type: 'session_meta', payload: { id } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'synthetic early decision' } },
    ].map(x => JSON.stringify(x) + '\n').join('');
    await writeFile(original, raw);
    const run = (...args) => execFileSync(python, [query, '--archive', archive, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    run('index');
    const store = new TaskContextStore(path.join(root, 'state'));
    await store.update(id, { section: 'notes', value: 'keep notes', revision: 0 });
    await store.update(id, { section: 'summary', value: { goal: 'keep goal' }, revision: 1 });
    await store.update(id, { section: 'references', value: [{ relation: 'reference', label: 'keep reference', path: original }], revision: 2 });
    const options = { store, python };
    await assert.rejects(registerColdHistory(otherId, archive, options), /不属于/);
    assert.equal((await store.read(otherId)).revision, 0);
    const first = await registerColdHistory(id, archive, options);
    const second = await registerColdHistory(id, archive, options);
    assert.equal(second.revision, first.revision);
    assert.equal(second.alreadyRegistered, true);
    const state = await store.view(id);
    assert.equal(state.notes, 'keep notes');
    assert.equal(state.summary.goal, 'keep goal');
    assert.equal(state.references.length, 2);
    assert.equal(state.references[1].relation, 'history');
    assert.equal(state.references[1].exists, true);
    assert.equal(JSON.parse(await readFile(first.entry, 'utf8')).threadId, id);
    assert.match(run('search', 'early'), /synthetic early decision/);
    assert.equal(run('search', 'absent'), '');
    run('export', '2', path.join(root, 'record.jsonl'));
    assert.equal(await readFile(path.join(root, 'record.jsonl'), 'utf8'), raw.split('\n')[1] + '\n');
    assert.equal(await readFile(original, 'utf8'), raw);
    await link(original, path.join(root, 'hardlink'));
    await assert.rejects(registerColdHistory(id, archive, options), /硬链接/);
    await rm(path.join(root, 'hardlink'));
    await writeFile(original, raw.replace('early', 'other')); // Same byte count.
    assert.throws(() => run('verify'), /Archive content changed/);
    assert.throws(() => run('search', 'early'), /Archive content changed/);
    await assert.rejects(registerColdHistory(id, archive, options));
    assert.equal((await store.read(id)).revision, second.revision);
  } finally { await rm(root, { recursive: true, force: true }); }
});
