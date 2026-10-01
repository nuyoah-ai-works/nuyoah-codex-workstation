import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TaskContextStore, handleTaskContextRequest } from '../nuyoah/workstation/task-context-store.mjs';
import { readSkillConfiguration } from '../nuyoah/skills/configuration.mjs';
import { previewFile } from '../nuyoah/assets/preview.mjs';
import { parseMidjourneyFilename } from '../nuyoah/assets/midjourney.mjs';
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
async function fixture(t) { const root = await mkdtemp(path.join(os.tmpdir(), 'workstation-adapt-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
test('task sections remain isolated across tasks and concurrent stale writes', async t => {
  const store = new TaskContextStore(await fixture(t));
  assert.equal((await store.read(a)).revision, 0);
  await store.update(a, { section: 'notes', value: 'keep my note', revision: 0 });
  await store.update(a, { section: 'summary', value: { goal: 'verified scope', assistantVerification: 'unit pass', userConfirmation: '' }, revision: 1 });
  assert.equal((await store.read(a)).notes, 'keep my note');
  assert.equal((await store.read(b)).notes, '');
  const parallel = await Promise.allSettled([
    store.update(a, { section: 'notes', value: 'first', revision: 2 }),
    store.update(a, { section: 'notes', value: 'second', revision: 2 }),
  ]);
  assert.equal(parallel.filter(result => result.status === 'fulfilled').length, 1);
  await assert.rejects(store.update(a, { section: 'summary', value: { goal: 'stale' }, revision: 2 }));
  assert.equal((await store.read(a)).summary.goal, 'verified scope');
  await assert.rejects(store.read('../../escape'));
  await writeFile(store.file(b), '{broken');
  await assert.rejects(store.update(b, { section: 'notes', value: 'overwrite', revision: 0 }));
  assert.equal(await readFile(store.file(b), 'utf8'), '{broken');
});
test('references retain explicit ownership and report missing files without reading contents', async t => {
  const root = await fixture(t), store = new TaskContextStore(root), file = path.join(root, 'reference.txt');
  await writeFile(file, 'PRIVATE BODY MUST NOT APPEAR');
  await store.update(a, { section: 'references', revision: 0, value: [{ path: file, relation: 'output' }, { path: path.join(root, 'missing'), relation: 'reference' }] });
  const view = await store.view(a);
  assert.equal(view.references[0].sourceThreadId, a); assert.equal(view.references[0].exists, true); assert.equal(view.references[1].exists, false);
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE BODY/);
  assert.equal((await store.view(b)).references.length, 0);
  await assert.rejects(store.update(a, { section: 'references', revision: 1, value: [{ path: file, relation: 'output', sourceThreadId: b }] }));
  const result = await handleTaskContextRequest(store, { id: 'request', threadId: a, action: 'save', section: 'notes', value: 'stale', revision: 0 });
  assert.match(result.error, /重新读取/); assert.equal(result.id, 'request');
});
test('Skill configuration keeps stable favorite names and rejects duplicate reserved categories', async t => {
  const file = path.join(await fixture(t), 'preferences.json');
  assert.deepEqual(await readSkillConfiguration(file), {});
  await writeFile(file, JSON.stringify({ skills: { categories: [{ label: 'Writing', keywords: ['write'] }], defaultFavorites: ['writer'] } }));
  assert.deepEqual((await readSkillConfiguration(file)).defaultFavorites, ['writer']);
  await writeFile(file, JSON.stringify({ skills: { categories: [{ label: '全部', keywords: ['write'] }] } }));
  await assert.rejects(readSkillConfiguration(file));
});
test('read-only previews are bounded and MJ groups preserve complete ordered combinations', async t => {
  const file = path.join(await fixture(t), 'page.html');
  await writeFile(file, '<script>never executed</script>' + 'x'.repeat(300000));
  const preview = await previewFile(file); assert.equal(preview.truncated, true); assert.ok(preview.text.length <= 256 * 1024); assert.match(preview.text, /<script>/);
  const suffix = '_11111111-1111-4111-8111-111111111111_0.png';
  assert.deepEqual(parseMidjourneyFilename('u123__city_--p_alpha_beta' + suffix).profiles, ['alpha', 'beta']);
  assert.deepEqual(parseMidjourneyFilename('u123__city_--p_beta_alpha' + suffix).profiles, ['beta', 'alpha']);
  assert.equal(parseMidjourneyFilename('ordinary-image.png'), null);
});
