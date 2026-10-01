import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, appendFile, rename, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { TaskRelationsService, parseTaskRelationRecords, readLocalTaskMetadata } from '../nuyoah/workstation/task-relations.mjs';

const a = '11111111-1111-1111-1111-111111111111', b = '22222222-2222-2222-2222-222222222222';
const c = '33333333-3333-3333-3333-333333333333', d = '44444444-4444-4444-4444-444444444444';
const ref = (threadId, hostId = 'local') => ({ hostId, threadId });
const rec = payload => ({ type: 'response_item', payload });
const call = (name, call_id, args = {}) => rec({ type: 'function_call', name, call_id, arguments: JSON.stringify(args) });
const output = (call_id, value) => rec({ type: 'function_call_output', call_id, output: JSON.stringify(value) });
const spawnSource = parent => JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: parent, depth: 1 } } });
async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-relations-'));
  try {
    const session = async (id, meta = {}, records = []) => {
      const file = path.join(root, `${id}.jsonl`);
      await writeFile(file, [{ type: 'session_meta', payload: { id, ...meta } }, ...records].map(JSON.stringify).join('\n') + '\n');
      return file;
    };
    await run({ root, session });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('actual matched tool results distinguish children, forks and explicit references without guessing', () => {
  const records = [call('mcp__codex_app__create_thread', 'create'), output('create', { threadId: b }),
    call('mcp__codex_app__fork_thread', 'fork', { threadId: b }), output('fork', { content: [{ type: 'text', text: JSON.stringify({ threadId: c }) }] }),
    call('mcp__codex_app__read_thread', 'read', { threadId: d }), output('read', ref(d, 'remote:one')),
    rec({ type: 'message', role: 'user', content: [{ text: `[Task](codex://threads/${c})` }] })];
  const edges = parseTaskRelationRecords(records, ref(a));
  assert.deepEqual(edges.map(e => [e.from.threadId, e.to.threadId, e.kind]), [[a, b, 'parent'], [b, c, 'fork'], [a, d, 'related'], [a, c, 'related']]);
  assert.equal(edges[2].to.hostId, 'remote:one');
  const wrapper = [rec({ type: 'custom_tool_call', name: 'exec', call_id: 'wrapped', input: 'text(await tools.mcp__codex_app__fork_thread({}));' }), output('wrapped', { threadId: b })];
  assert.equal(parseTaskRelationRecords(wrapper, ref(a))[0].kind, 'fork');
});

test('failures, unmatched outputs, quoted calls, arbitrary output text and ambiguous wrappers are excluded', () => {
  const wrapped = input => rec({ type: 'custom_tool_call', name: 'exec', call_id: 'x', input });
  const examples = [
    [output('missing', { threadId: b })],
    [call('mcp__codex_app__create_thread', 'failed'), output('failed', { isError: true, threadId: b })],
    [call('mcp__codex_app__create_thread', 'failed'), output('failed', { success: false, threadId: b })],
    [call('mcp__codex_app__list_threads', 'list'), output('list', { threadId: b })],
    [wrapped('text("await tools.mcp__codex_app__create_thread({})");'), output('x', { threadId: b })],
    [wrapped('text(await tools.mcp__codex_app__create_thread({}));\ntext(await tools.mcp__codex_app__fork_thread({}));'), output('x', { threadId: b })],
    [call('mcp__codex_app__create_thread', 'text'), output('text', { content: [{ text: `Example: {"threadId":"${b}"}` }] })],
  ];
  for (const records of examples) assert.deepEqual(parseTaskRelationRecords(records, ref(a)), []);
});

test('conversation map follows real relationships, excludes unrelated same-project tasks and preserves host identity', async () => fixture(async ({ session }) => {
  const file = await session(a, {}, [call('mcp__codex_app__create_thread', 'cross'), output('cross', ref(c, 'remote:one'))]);
  const rows = [{ id: a, title: 'Parent', project_id: 'p', rollout_path: file },
    { id: b, title: 'Child', source: spawnSource(a), project_id: null },
    { id: c, title: 'Same project unrelated', project_id: 'p' }, { id: d, title: 'Archived child', source: spawnSource(b), archived: 1 }];
  const tasks = [{ ...ref(a), title: 'Live parent', projectId: 'p', runtimeStatus: 'running' },
    { ...ref(c, 'remote:one'), title: 'Remote linked', projectId: 'p', runtimeStatus: 'idle' }];
  const service = new TaskRelationsService({ metadata: async () => ({ rows }) });
  const view = await service.view({ ...ref(a), tasks });
  assert.deepEqual(view.nodes.map(n => [n.hostId, n.threadId]), [['local', a], ['local', b], ['local', d], ['remote:one', c]]);
  assert.equal(view.nodes[0].runtimeStatus, 'running'); assert.equal(view.nodes[1].runtimeStatus, 'unknown');
  assert.equal(view.nodes[1].projectId, 'p'); assert.equal(view.nodes[1].catalogKnown, false);
  assert.equal(view.nodes[0].title, 'Live parent');
  assert.equal(view.edges.length, 3); assert.equal(view.status, 'partial');
  assert.ok(view.nodes.every(n => !('rollout_path' in n) && !('workspacePath' in n) && !('source' in n)));
  const project = await service.view({ scope: 'project', ...ref(a), projectId: 'p', tasks });
  assert.deepEqual(project.nodes.map(n => n.threadId), [a, b, c]);
  assert.equal(project.edges.length, 1); // No project-root to task ownership edges.
  const global = await service.view({ scope: 'global', tasks });
  assert.equal(global.nodes.length, 4); assert.ok(global.nodes.every(n => !n.archived));
}));

test('headers identify forks, prefer spawned parents and never mine copied history for relationships', async () => fixture(async ({ session }) => {
  const fork = await session(b, { forked_from_id: a }, [call('mcp__codex_app__create_thread', 'copied'), output('copied', { threadId: d })]);
  const child = await session(c, { parent_thread_id: a, forked_from_id: b, subagent_history_start_ordinal: 10 }, [
    ...[call('mcp__codex_app__create_thread', 'copied'), output('copied', { threadId: b })].map((x, i) => ({ ...x, ordinal: i + 1 })),
    ...[call('mcp__codex_app__create_thread', 'new'), output('new', { threadId: d })].map((x, i) => ({ ...x, ordinal: i + 10 }))]);
  const rows = [{ id: a, title: 'Root', project_id: 'p' }, { id: b, thread_source: 'agent_forked_thread', rollout_path: fork },
    { id: c, thread_source: 'subagent', rollout_path: child }, { id: d }];
  const service = new TaskRelationsService({ metadata: async () => ({ rows }) });
  const first = await service.view(ref(b));
  assert.deepEqual(first.nodes.map(n => n.threadId), [a, b, c]);
  assert.equal(first.edges.find(e => e.to.threadId === b).kind, 'fork');
  assert.equal(first.edges.find(e => e.to.threadId === c).kind, 'parent');
  assert.equal(first.nodes.find(n => n.threadId === b).projectId, '');
  const second = await service.view(ref(c));
  assert.ok(second.edges.some(e => e.from.threadId === c && e.to.threadId === d && e.kind === 'parent'));
  assert.ok(!second.edges.some(e => e.from.threadId === c && e.to.threadId === b));
}));

test('bounded bodies report partial coverage, preserve source bytes and reject mismatched identity after cache', async () => fixture(async ({ session }) => {
  const file = await session(a, {}, [rec({ type: 'message', role: 'user', content: [{ text: 'pad'.repeat(1000) }] }),
    call('mcp__codex_app__create_thread', 'last'), output('last', { threadId: b })]);
  const original = await readFile(file, 'utf8');
  const rows = [{ id: a, rollout_path: file }, { id: b }];
  const service = new TaskRelationsService({ metadata: async () => ({ rows }), maxBodyBytes: 1024 });
  let view = await service.view(ref(a));
  assert.equal(view.edges.length, 1); assert.equal(view.status, 'partial');
  assert.ok(view.coverage.bodyBytes <= 1024); assert.equal(view.coverage.bodyPartial, true);
  assert.equal(await readFile(file, 'utf8'), original);
  await writeFile(file, original.replace(a, c));
  view = await service.view(ref(a));
  assert.equal(view.edges.length, 0); assert.equal(view.coverage.headerPartial, true);
}));

test('metadata and header budgets stay bounded on large catalogs without directory scans or remote bodies', async () => fixture(async ({ session }) => {
  const file = await session(a), fork = await session(b, { forked_from_id: a });
  const service = new TaskRelationsService({ maxRows: 2, maxHeaders: 1, maxHeaderBytes: 100,
    maxTotalHeaderBytes: 100, metadata: async () => ({ rows: [{ id: a, rollout_path: file },
      { id: b, rollout_path: fork, thread_source: 'agent_forked_thread' }, { id: c }], partial: true }) });
  const view = await service.view({ ...ref(a), tasks: [{ ...ref(d, 'remote:one'), rollout_path: '/never/read/remote' }] });
  assert.equal(view.coverage.metadataCount, 2); assert.equal(view.coverage.headerCount, 1);
  assert.ok(view.coverage.headerBytes <= 100); assert.equal(view.coverage.headerPartial, true);
  assert.equal(view.status, 'partial');
  assert.equal((await service.view({ ...ref(a), scope: 'nonsense' }).catch(e => e)).message, 'Invalid task map scope');
  const missing = await service.view({ threadId: 'not-an-id' }); assert.equal(missing.status, 'unavailable');
}));

test('SQLite metadata query is read only, bounds rows and never selects conversation text', async () => fixture(async ({ root }) => {
  const file = path.join(root, 'state_5.sqlite'), db = new DatabaseSync(file);
  db.exec('CREATE TABLE threads(id TEXT,rollout_path TEXT,source TEXT,thread_source TEXT,project_id TEXT,title TEXT,name TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER,first_user_message TEXT)');
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(a, '/unused/a', 'vscode', 'user', 'p', 'Root', null, '/private/path', 1, 0, 'private body');
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(b, '/unused/b', spawnSource(a), 'subagent', null, 'Child', null, '/private/path', 2, 0, 'private body');
  db.close(); const before = await readFile(file);
  const result = await readLocalTaskMetadata({ codexHome: root, maxRows: 1, currentThreadId: a });
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].id, a); assert.equal(result.partial, true);
  assert.ok(!('first_user_message' in result.rows[0]));
  assert.deepEqual(await readFile(file), before);
}));

test('project selection works without an open conversation and only proven missing endpoints become placeholders', async () => fixture(async ({ session }) => {
  const file = await session(a, {}, [call('mcp__codex_app__create_thread', 'missing'), output('missing', ref(c, 'remote:one')),
    call('mcp__codex_app__read_thread', 'read'), output('read', ref(d))]);
  const service = new TaskRelationsService({ metadata: async () => ({ rows: [
    { id: a, project_id: 'p', rollout_path: file }, { id: b, project_id: 'q', source: spawnSource(a) },
  ] }) });
  const project = await service.view({ scope: 'project', hostId: 'local', projectId: 'p' });
  assert.deepEqual(project.nodes.map(n => n.threadId), [a]);
  const conversation = await service.view(ref(a));
  assert.equal(conversation.nodes.length, 4);
  const remote = conversation.nodes.find(n => n.hostId === 'remote:one');
  assert.equal(remote.resolved, false); assert.equal(remote.runtimeStatus, 'unknown');
  assert.equal(remote.title, '待同步任务'); assert.equal(conversation.status, 'partial');
  assert.equal(conversation.edges.find(e => e.to.threadId === c).kind, 'parent');
  assert.equal(conversation.edges.find(e => e.to.threadId === d).kind, 'related');
  assert.equal((await service.view({ scope: 'conversation', projectId: 'p' })).status, 'unavailable');
}));

test('created tasks without discoverable incoming evidence expose incomplete relationship coverage', async () => fixture(async ({ session }) => {
  const file = await session(a);
  const service = new TaskRelationsService({ metadata: async () => ({ rows: [{ id: a, thread_source: 'agent_created_thread', rollout_path: file }] }) });
  const view = await service.view(ref(a));
  assert.equal(view.status, 'partial'); assert.equal(view.coverage.unresolvedCreatedThreads, 1);
  assert.equal(view.edges.length, 0);
}));

test('hostless links prefer the successful tool target host even when the same UUID exists locally', async () => fixture(async ({ session }) => {
  const file = await session(a, {}, [call('mcp__codex_app__create_thread', 'remote'), output('remote', ref(b, 'remote:one')),
    rec({ type: 'message', role: 'assistant', content: [{ text: `::created-thread{threadId="${b}"}\n[Task](codex://threads/${b})` }] })]);
  const service = new TaskRelationsService({ metadata: async () => ({ rows: [{ id: a, rollout_path: file }, { id: b, title: 'Unrelated local task' }] }) });
  const view = await service.view({ ...ref(a), tasks: [{ ...ref(b, 'remote:one'), title: 'Actual child' }] });
  assert.deepEqual(view.nodes.map(n => [n.hostId, n.threadId]), [['local', a], ['remote:one', b]]);
  assert.equal(view.edges.length, 1); assert.equal(view.edges[0].kind, 'parent');
  assert.equal(view.edges[0].to.hostId, 'remote:one'); assert.equal(view.coverage.unresolvedLinks, 0);
}));

test('hostless links resolve only unique catalog identities and cached links are rechecked when hosts change', async () => fixture(async ({ session }) => {
  const message = rec({ type: 'message', role: 'user', content: [{ text: `[Task](codex://threads/${b})` }] });
  const file = await session(a, {}, [message]);
  const service = new TaskRelationsService({ metadata: async () => ({ rows: [{ id: a, rollout_path: file }] }) });
  let view = await service.view({ ...ref(a), tasks: [ref(b, 'remote:one')] });
  assert.equal(view.edges[0].to.hostId, 'remote:one');
  view = await service.view({ ...ref(a), tasks: [ref(b), ref(b, 'remote:one')] });
  assert.equal(view.edges.length, 0); assert.equal(view.nodes.length, 1);
  assert.equal(view.coverage.unresolvedLinks, 1); assert.equal(view.status, 'partial');
  assert.equal(view.coverage.bodyBytes, 0); // Cached evidence is resolved against today's catalog.
  view = await service.view(ref(a));
  assert.equal(view.edges.length, 0); assert.equal(view.coverage.unresolvedLinks, 1);
  const ambiguousTools = [call('mcp__codex_app__create_thread', 'one'), output('one', ref(b)),
    call('mcp__codex_app__create_thread', 'two'), output('two', ref(b, 'remote:one')), message];
  let unresolved = 0;
  const edges = parseTaskRelationRecords(ambiguousTools, ref(a), { catalog: [ref(b)], onUnresolved: () => { unresolved++; } });
  assert.equal(edges.length, 2); assert.equal(unresolved, 1);
}));

test('exec comments, templates and unexecuted functions cannot manufacture tool-backed parent relationships', () => {
  const invoke = 'text(await tools.mcp__codex_app__create_thread({}));';
  const pretend = `text({"threadId":"${b}"});`;
  const inputs = [`/*\n${invoke}\n*/\n${pretend}`, `const example = \`\n${invoke}\n\`;\n${pretend}`,
    `function example() {\n${invoke}\n}\n${pretend}`, `if (false)\n${invoke}\n${pretend}`,
    `const text = () => ({threadId: "${b}"});\n${invoke}`,
    `const result = await tools.mcp__codex_app__create_thread({});\n${pretend}`];
  for (const input of inputs) {
    const records = [rec({ type: 'custom_tool_call', name: 'exec', call_id: 'x', input }), output('x', ref(b))];
    assert.deepEqual(parseTaskRelationRecords(records, ref(a)), [], input);
  }
  for (const input of [invoke, '/* explanation */\nconst result = await tools.mcp__codex_app__create_thread({});\n// print actual result\ntext(result);',
    'let result = await tools.mcp__codex_app__create_thread(args)\ntext(result)']) {
    const edges = parseTaskRelationRecords([rec({ type: 'custom_tool_call', name: 'exec', call_id: 'x', input }), output('x', ref(b))], ref(a));
    assert.equal(edges.length, 1); assert.equal(edges[0].kind, 'parent');
  }
});

test('unnamed child cards use actual agent identity metadata without deriving a task title from conversation text', async () => {
  const rows = [{ id: a, title: '', name: '', source: JSON.stringify({ subagent: { thread_spawn: {
    agent_path: '/root/task_relationships', agent_nickname: 'Worker A', parent_thread_id: b,
  } } }) }, { id: b, title: '', name: '', agent_nickname: 'Worker B' },
  { id: c, title: '', name: 'User supplied title', source: spawnSource(b), agent_path: '/root/ignored_path' },
  { id: d, title: '', name: '', source: JSON.stringify({ subAgent: { thread_spawn: { agent_nickname: 'Worker D', parent_thread_id: b } } }) }];
  const service = new TaskRelationsService({ metadata: async () => ({ rows }) });
  const view = await service.view({ scope: 'global' });
  assert.deepEqual(view.nodes.map(node => node.title), ['task_relationships', 'Worker B', 'User supplied title', 'Worker D']);
  assert.ok(view.nodes.every(node => !('agent_path' in node) && !('source' in node)));
});

const completedAt = Date.parse('2026-09-22T02:00:00.000Z');
const stamped = (record, at = completedAt) => ({ ...record, timestamp: new Date(at).toISOString() });
const agentRow = (id = b, parent = a, name = '/root/worker') => ({ id, source: spawnSource(parent), agent_path: name,
  thread_source: 'subagent', rollout_path: '/never/read/child-body', updated_at: completedAt / 1000 - 1 });
const finalMessage = (extra = {}) => stamped(rec({ type: 'agent_message', author: '/root/worker', recipient: '/root',
  content: [{ type: 'input_text', text: 'Message Type: FINAL_ANSWER\nTask name: /root\nSender: /root/worker\nPayload:\nPRIVATE_FINAL_BODY' },
    { type: 'encrypted_content', encrypted_content: 'PRIVATE_ENCRYPTED_BODY' }], ...extra }));

test('successful native delegation adds only a short Chinese explanation to the exact native child', async () => fixture(async ({ session }) => {
  const file = await session(a, {}, [call('spawn_agent', 'spawn', { task_name: 'worker',
    message: '在 /Users/private-owner/workspace 只读检查任务地图的完成状态，禁止读取子任务正文。后续实现约束 PRIVATE_PROMPT_REMAINDER' }),
  stamped(output('spawn', { task_name: '/root/worker' }))]);
  const rows = [{ id: a, rollout_path: file }, agentRow(), agentRow(c, d)];
  const service = new TaskRelationsService({ metadata: async () => ({ rows }) });
  const before = await readFile(file), view = await service.view(ref(a));
  const child = view.nodes.find(node => node.threadId === b);
  assert.equal(child.description, '只读检查任务地图的完成状态');
  assert.equal(child.hasFinalResponse, false); assert.equal(child.finalAt, null);
  assert.equal(view.coverage.headerCount, 1);
  assert.deepEqual(await readFile(file), before);
  assert.doesNotMatch(JSON.stringify([...service.bodyCache.values()]), /private-owner|PRIVATE_PROMPT_REMAINDER|禁止读取/);
  const global = await service.view({ scope: 'global' });
  assert.equal(global.nodes.find(node => node.threadId === c).description, undefined);
}));

test('successful native agent inventory proves completion without retaining final bodies and expires against fresh row timestamps', async () => fixture(async ({ session }) => {
  const file = await session(a, {}, [call('list_agents', 'list'), stamped(output('list', { agents: [
    { agent_name: '/root/worker', agent_status: { completed: 'PRIVATE_INVENTORY_FINAL_BODY' } },
  ] }))]);
  const row = agentRow(), rows = [{ id: a, rollout_path: file }, row];
  const service = new TaskRelationsService({ metadata: async () => ({ rows }) });
  let view = await service.view(ref(a));
  assert.equal(view.nodes.find(node => node.threadId === b).hasFinalResponse, true);
  assert.equal(view.nodes.find(node => node.threadId === b).finalAt, completedAt);
  assert.equal(view.nodes.find(node => node.threadId === b).agentCompletion, true);
  assert.doesNotMatch(JSON.stringify([...service.bodyCache.values()]), /PRIVATE_INVENTORY_FINAL_BODY/);
  for (const updatedAt of [(completedAt + 1000) / 1000, completedAt + 1000, new Date(completedAt + 1000).toISOString()]) {
    row.updated_at = updatedAt; view = await service.view(ref(a));
    assert.notEqual(view.nodes.find(node => node.threadId === b).hasFinalResponse, true);
    assert.notEqual(view.nodes.find(node => node.threadId === b).agentCompletion, true);
    assert.equal(view.coverage.bodyBytes, 0);
  }
  row.updated_at = completedAt / 1000 - 1; row.updated_at_ms = completedAt + 1;
  view = await service.view(ref(a)); assert.notEqual(view.nodes.find(node => node.threadId === b).hasFinalResponse, true);
  delete row.updated_at; delete row.updated_at_ms;
  view = await service.view(ref(a)); assert.notEqual(view.nodes.find(node => node.threadId === b).hasFinalResponse, true);
}));

test('agent-message completion requires native author, recipient and exact anchored header agreement', async () => fixture(async ({ session }) => {
  const rows = [{ id: a }, agentRow()];
  const cases = [
    { record: finalMessage(), completed: true },
    { record: finalMessage({ type: 'message', role: 'user' }), completed: false },
    { record: finalMessage({ author: '/root/impostor' }), completed: false },
    { record: finalMessage({ recipient: '/root/elsewhere' }), completed: false },
    { record: finalMessage({ content: [{ type: 'input_text', text: 'Example:\nMessage Type: FINAL_ANSWER\nTask name: /root\nSender: /root/worker\nPayload:' }] }), completed: false },
    { record: finalMessage({ content: [{ type: 'input_text', text: 'Message Type: MESSAGE\nTask name: /root\nSender: /root/worker\nPayload: FINAL_ANSWER' }] }), completed: false },
    { record: { ...finalMessage(), timestamp: 'invalid' }, completed: false },
  ];
  for (const entry of cases) {
    rows[0].rollout_path = await session(a, {}, [entry.record]);
    const service = new TaskRelationsService({ metadata: async () => ({ rows }) });
    const child = (await service.view(ref(a))).nodes.find(node => node.threadId === b);
    assert.equal(child.hasFinalResponse === true, entry.completed);
    assert.doesNotMatch(JSON.stringify([...service.bodyCache.values()]), /PRIVATE_FINAL_BODY|PRIVATE_ENCRYPTED_BODY/);
  }
}));

test('unmatched, failed, quoted or inconsistent collaboration results cannot manufacture descriptions or completion', async () => fixture(async ({ session }) => {
  const agents = { agents: [{ agent_name: '/root/worker', agent_status: { completed: 'private' } }] };
  const cases = [
    [stamped(output('unmatched', agents))],
    [call('list_agents', 'list'), stamped(output('list', { ...agents, isError: true }))],
    [call('list_agents', 'list'), stamped(output('list', { ...agents, success: false }))],
    [call('read_thread', 'list'), stamped(output('list', agents))],
    [rec({ type: 'message', role: 'user', content: [{ text: JSON.stringify(agents) }] })],
    [call('spawn_agent', 'spawn', { task_name: 'different', message: '伪造说明' }), output('spawn', { task_name: '/root/worker' })],
    [call('spawn_agent', 'spawn', { task_name: 'worker', message: '失败说明' }), output('spawn', { task_name: '/root/worker', isError: true })],
    [rec({ type: 'custom_tool_call', name: 'exec', call_id: 'list', input: 'text(await tools.list_agents({}));' }), stamped(output('list', agents))],
  ];
  for (const records of cases) {
    const file = await session(a, {}, records), rows = [{ id: a, rollout_path: file }, agentRow()];
    const service = new TaskRelationsService({ metadata: async () => ({ rows }) });
    const child = (await service.view(ref(a))).nodes.find(node => node.threadId === b);
    assert.equal(child.description, undefined); assert.notEqual(child.hasFinalResponse, true);
  }
  for (const rows of [[{ id: a }, agentRow(b, d)], [{ id: a }, agentRow(), agentRow(c)]]) {
    rows[0].rollout_path = await session(a, {}, [finalMessage()]);
    const service = new TaskRelationsService({ metadata: async () => ({ rows }) });
    await service.view(ref(a));
    assert.ok((await service.view({ scope: 'global' })).nodes.every(node => node.hasFinalResponse !== true));
  }
}));

test('successful followup clears completion while failures do not and a later final can complete again', async () => fixture(async ({ session }) => {
  const cases = [
    { result: '', completed: false },
    { result: JSON.stringify({ success: true }), completed: false },
    { result: JSON.stringify({ task_name: '/root/worker' }), completed: false },
    { result: JSON.stringify({ isError: true, task_name: '/root/worker' }), completed: true },
    { result: JSON.stringify({ task_name: '/root/different' }), completed: true },
    { result: 'Error: agent not found', completed: true },
  ];
  for (const item of cases) {
    const records = [finalMessage(), call('followup_task', 'follow', { target: 'worker', message: '下一项工作' }),
      stamped(rec({ type: 'function_call_output', call_id: 'follow', output: item.result }), completedAt + 1000)];
    const file = await session(a, {}, records), rows = [{ id: a, rollout_path: file }, agentRow()];
    const service = new TaskRelationsService({ metadata: async () => ({ rows }) });
    let child = (await service.view(ref(a))).nodes.find(node => node.threadId === b);
    assert.equal(child.hasFinalResponse === true, item.completed);
    await session(a, {}, [...records, stamped(finalMessage(), completedAt + 2000)]);
    child = (await service.view(ref(a))).nodes.find(node => node.threadId === b);
    assert.equal(child.hasFinalResponse, true); assert.equal(child.finalAt, completedAt + 2000);
  }
}));

test('agent evidence follows existing body budgets and never revives a truncated unmatched output', async () => fixture(async ({ session }) => {
  const result = stamped(output('list', { agents: [{ agent_name: '/root/worker', agent_status: { completed: 'done' } }] }));
  for (const paired of [false, true]) {
    const padding = rec({ type: 'message', role: 'user', content: [{ text: 'private padding '.repeat(1000) }] });
    const file = await session(a, {}, paired ? [padding, call('list_agents', 'list'), result] : [call('list_agents', 'list'), padding, result]);
    const service = new TaskRelationsService({ maxBodyBytes: 900, metadata: async () => ({ rows: [{ id: a, rollout_path: file }, agentRow()] }) });
    const view = await service.view(ref(a));
    assert.equal(view.coverage.bodyPartial, true); assert.ok(view.coverage.bodyBytes <= 900);
    assert.equal(view.nodes.find(node => node.threadId === b).hasFinalResponse === true, paired);
    assert.doesNotMatch(JSON.stringify([...service.bodyCache.values()]), /private padding/);
  }
}));

test('catalog completion and Chinese description metadata survive safe node projection without copying unrelated fields', async () => {
  const service = new TaskRelationsService({ metadata: async () => ({ rows: [] }) });
  const view = await service.view({ scope: 'global', tasks: [{ ...ref(a), title: 'Current',
    description: '核查任务完成后的回收行为。不要复制后续说明', hasFinalResponse: true, finalAt: completedAt,
    preview: 'PRIVATE_PREVIEW', arbitrary: 'PRIVATE_OTHER' }] });
  assert.equal(view.nodes[0].description, '核查任务完成后的回收行为');
  assert.equal(view.nodes[0].hasFinalResponse, true); assert.equal(view.nodes[0].finalAt, completedAt);
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE_PREVIEW|PRIVATE_OTHER|后续说明/);
});

test('encrypted delegation messages never become card descriptions while their native child identity remains usable', async () => fixture(async ({ session }) => {
  const file = await session(a, {}, [call('spawn_agent', 'spawn', { task_name: 'worker', message: 'gAAAA_ENCRYPTED_DELEGATION_PAYLOAD' }),
    output('spawn', { task_name: '/root/worker' }), finalMessage()]);
  const service = new TaskRelationsService({ metadata: async () => ({ rows: [{ id: a, rollout_path: file }, agentRow()] }) });
  const child = (await service.view(ref(a))).nodes.find(node => node.threadId === b);
  assert.equal(child.description, undefined); assert.equal(child.hasFinalResponse, true);
  assert.doesNotMatch(JSON.stringify([...service.bodyCache.values()]), /ENCRYPTED_DELEGATION_PAYLOAD/);
}));

test('explicit initial body budget recovers old evidence once while later tails preserve only bounded short metadata', async () => fixture(async ({ session }) => {
  const padding = size => rec({ type: 'message', role: 'user', content: [{ text: 'PRIVATE_PADDING_' + 'x'.repeat(size) }] });
  const file = await session(a, {}, [call('spawn_agent', 'spawn', { task_name: 'worker', message: '检查任务地图完成后的回收行为。不要保留约束全文' }),
    stamped(output('spawn', { task_name: '/root/worker' }), completedAt - 1000), finalMessage(), padding(1800)]);
  const rows = [{ id: a, rollout_path: file }, agentRow()];
  const defaults = new TaskRelationsService({ maxBodyBytes: 512, metadata: async () => ({ rows }) });
  const defaultView = await defaults.view(ref(a));
  assert.ok(defaultView.coverage.bodyBytes <= 512);
  assert.notEqual(defaultView.nodes.find(node => node.threadId === b).hasFinalResponse, true);
  const service = new TaskRelationsService({ maxBodyBytes: 512, maxInitialBodyBytes: 4096, metadata: async () => ({ rows }) });
  let view = await service.view(ref(a));
  assert.ok(view.coverage.bodyBytes > 512 && view.coverage.bodyBytes <= 4096);
  assert.equal(view.nodes.find(node => node.threadId === b).hasFinalResponse, true);
  const append = async records => appendFile(file, records.map(JSON.stringify).join('\n') + '\n');
  await append([padding(900)]);
  view = await service.view(ref(a));
  assert.ok(view.coverage.bodyBytes <= 512); assert.equal(view.coverage.bodyPartial, true);
  let child = view.nodes.find(node => node.threadId === b);
  assert.equal(child.hasFinalResponse, true); assert.equal(child.description, '检查任务地图完成后的回收行为');
  await append([call('followup_task', 'follow', { target: 'worker', message: '继续处理' }),
    stamped(rec({ type: 'function_call_output', call_id: 'follow', output: '' }), completedAt + 1000)]);
  view = await service.view(ref(a)); child = view.nodes.find(node => node.threadId === b);
  assert.ok(view.coverage.bodyBytes <= 512); assert.equal(child.hasFinalResponse, false);
  await append([padding(700), stamped(finalMessage(), completedAt + 2000)]);
  view = await service.view(ref(a)); child = view.nodes.find(node => node.threadId === b);
  assert.ok(view.coverage.bodyBytes <= 512); assert.equal(child.hasFinalResponse, true);
  assert.equal(child.finalAt, completedAt + 2000); assert.equal(child.description, '检查任务地图完成后的回收行为');
  assert.doesNotMatch(JSON.stringify([...service.bodyCache.values()]), /PRIVATE_PADDING_|PRIVATE_FINAL_BODY|PRIVATE_ENCRYPTED_BODY|约束全文/);
}));

test('initial body reads never exceed their explicit bound and global catalogs do not scan parent bodies', async () => fixture(async ({ session }) => {
  const file = await session(a, {}, [finalMessage(), rec({ type: 'message', role: 'user', content: [{ text: 'x'.repeat(5000) }] })]);
  const rows = [{ id: a, rollout_path: file }, agentRow()];
  const service = new TaskRelationsService({ maxBodyBytes: 512, maxInitialBodyBytes: 2048, metadata: async () => ({ rows }) });
  const global = await service.view({ scope: 'global' });
  assert.equal(global.coverage.bodyBytes, 0); assert.equal(service.bodyCache.size, 0);
  const view = await service.view(ref(a));
  assert.equal(view.coverage.bodyBytes, 2048); assert.equal(view.coverage.bodyPartial, true);
  assert.notEqual(view.nodes.find(node => node.threadId === b).hasFinalResponse, true);
}));

test('cached agent facts are discarded when the source is replaced, truncated or changes its inherited history boundary', async () => fixture(async ({ session }) => {
  const padding = rec({ type: 'message', role: 'user', content: [{ text: 'x'.repeat(2000) }] });
  for (const change of ['replacement', 'truncation', 'history-boundary', 'identity']) {
    const meta = { forked_from_id: d, subagent_history_start_ordinal: 10 };
    const file = await session(a, meta, [{ ...finalMessage(), ordinal: 11 }, { ...padding, ordinal: 12 }]);
    const rows = [{ id: a, rollout_path: file }, agentRow()];
    const service = new TaskRelationsService({ maxBodyBytes: 512, maxInitialBodyBytes: 4096, metadata: async () => ({ rows }) });
    assert.equal((await service.view(ref(a))).nodes.find(node => node.threadId === b).hasFinalResponse, true);
    if (change === 'replacement') {
      const replacement = await session(c, {}, [padding]);
      await writeFile(replacement, [{ type: 'session_meta', payload: { id: a, ...meta } }, padding].map(JSON.stringify).join('\n') + '\n');
      await rename(replacement, file);
    } else if (change === 'truncation') await session(a, meta, []);
    else if (change === 'history-boundary') await session(a, { ...meta, subagent_history_start_ordinal: 20 },
      [{ ...finalMessage(), ordinal: 11 }, { ...padding, ordinal: 21 }]);
    else await writeFile(file, [{ type: 'session_meta', payload: { id: c, ...meta } }, padding].map(JSON.stringify).join('\n') + '\n');
    const view = await service.view(ref(a));
    assert.notEqual(view.nodes.find(node => node.threadId === b).hasFinalResponse, true, change);
    assert.ok(![...service.bodyCache.values()].some(cache => cache.agentMetadata?.some(item => item.hasFinalResponse === true)), change);
  }
}));

test('merged parent agent evidence retains at most 2048 targets across successive tail windows', async () => fixture(async ({ session }) => {
  const agents = Array.from({ length: 2048 }, (_, index) => ({ agent_name: `/root/worker_${index}`, agent_status: { completed: 'not retained' } }));
  const file = await session(a, {}, [call('list_agents', 'initial'), stamped(output('initial', { agents }))]);
  const service = new TaskRelationsService({ maxBodyBytes: 1024, maxInitialBodyBytes: 256 * 1024,
    metadata: async () => ({ rows: [{ id: a, rollout_path: file }] }) });
  await service.view(ref(a)); assert.equal(service.bodyCache.get(a).agentMetadata.length, 2048);
  await appendFile(file, [call('list_agents', 'new'), stamped(output('new', { agents: [{ agent_name: '/root/new_worker', agent_status: { completed: 'private' } }] }), completedAt + 1000)]
    .map(JSON.stringify).join('\n') + '\n');
  const view = await service.view(ref(a));
  assert.ok(view.coverage.bodyBytes <= 1024);
  assert.equal(service.bodyCache.get(a).agentMetadata.length, 2048);
  assert.ok(service.bodyCache.get(a).agentMetadata.some(item => item.target === '/root/new_worker'));
}));
