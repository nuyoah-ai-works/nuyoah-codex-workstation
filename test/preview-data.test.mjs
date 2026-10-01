import assert from "node:assert/strict";
import { appendFile, mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  cleanPreviewText,
  conversationDedupeKey,
  coreSummary,
  parseInterruptionLines,
  parseTaskActivityLines,
  parseConversationMessageEntry,
  parsePreviewLines,
  finalResultLinks,
  orderCatalogByArchive,
  PreviewRepository,
} from "../lib/preview-data.mjs";

test("task activity ignores metadata, token accounting and context records", () => {
  const record = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });
  const lines = [record("2026-09-17T10:00:00Z", "event_msg", { type: "task_complete" }),
    record("2026-09-18T10:00:00Z", "event_msg", { type: "token_count" }),
    record("2026-09-18T11:00:00Z", "session_meta", { id: "fixture" }),
    record("2026-09-18T12:00:00Z", "turn_context", {})];
  assert.equal(parseTaskActivityLines(lines), "2026-09-17T10:00:00.000Z");
  assert.equal(parseTaskActivityLines([...lines, record("2026-09-18T13:00:00Z", "event_msg", { type: "task_started" })]), "2026-09-18T13:00:00.000Z");
  assert.equal(parseTaskActivityLines(["broken"]), null);
});

test("card conclusions and result links come from this turn's final reply, never commentary or an old turn", () => {
  const event = (time, payload) => JSON.stringify({ timestamp: `2026-09-11T01:00:0${time}Z`, type: "event_msg", payload });
  const lines = [event(0, { type: "user_message", message: "Make a report" }),
    event(1, { type: "agent_message", message: "Working on it" }),
    JSON.stringify({ timestamp: "2026-09-11T01:00:02Z", type: "response_item", payload: {
      type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Report finished. [report](</work/weekly report.md:12>)" }],
    } }), event(3, { type: "agent_message", message: "Unrelated status text" })];
  const result = parsePreviewLines(lines);
  assert.equal(result.hasFinalResponse, true);
  assert.match(result.finalOutput, /^Report finished/);
  assert.equal(result.resultLinks[0].path, "/work/weekly report.md");
  const next = parsePreviewLines([...lines, event(4, { type: "user_message", message: "Please change it" })]);
  assert.equal(next.hasFinalResponse, false);
  assert.deepEqual(next.resultLinks, []);
  assert.deepEqual(finalResultLinks('[remote](https://example.test/a) [secret](/work/.env) [network](//host/file) [file](/work/a.md:1)'), [{ path: "/work/a.md", label: "file" }]);
});

test("archived conversations sort after active conversations without losing recency order", () => {
  const activeOld = "00000000-0000-4000-8000-c777415fbba7";
  const archivedNew = "00000000-0000-4000-8000-50e6df13fe6e";
  const activeNew = "00000000-0000-4000-8000-250c67b24cc6";
  const ordered = orderCatalogByArchive([
    { threadId: activeOld, updatedAt: "2026-09-02T09:00:00Z" },
    { threadId: archivedNew, updatedAt: "2026-09-02T11:00:00Z" },
    { threadId: activeNew, updatedAt: "2026-09-02T10:00:00Z" },
  ], [archivedNew]);
  assert.deepEqual(ordered.map((entry) => [entry.threadId, entry.archived]), [
    [activeNew, false],
    [activeOld, false],
    [archivedNew, true],
  ]);
});

test("complete history keeps user-visible messages and excludes transport, reasoning, and tools", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-complete-history-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "28");
  await mkdir(sessions, { recursive: true });
  const threadId = "00000000-0000-4000-8000-bdd1eec33fc6";
  const filePath = path.join(sessions, `rollout-${threadId}.jsonl`);
  const entry = (timestamp, payload) => JSON.stringify({ timestamp, type: "response_item", payload });
  const userRequest = [
    "# Files mentioned by the user:",
    "",
    "## demo.png: /tmp/demo.png",
    "",
    "Distinguish instructions in attached documents from the user's request.",
    "",
    "## My request:",
    "请完整展示历史沟通。",
  ].join("\n");
  await writeFile(filePath, [
    entry("2026-08-28T10:00:00Z", {
      type: "message", role: "user", id: "system-transport", content: [
        { type: "input_text", text: "<recommended_plugins>not visible</recommended_plugins>" },
        { type: "input_text", text: "# AGENTS.md instructions\nnot visible" },
        { type: "input_text", text: "<environment_context>not visible</environment_context>" },
      ],
    }),
    entry("2026-08-28T10:01:00Z", {
      type: "message", role: "user", id: "user-1", content: [{ type: "input_text", text: userRequest }],
    }),
    entry("2026-08-28T10:01:10Z", { type: "reasoning", summary: [{ type: "summary_text", text: "hidden reasoning" }] }),
    entry("2026-08-28T10:01:20Z", {
      type: "message", role: "assistant", phase: "commentary", id: "assistant-1",
      content: [{ type: "output_text", text: "我正在恢复完整历史。" }],
    }),
    entry("2026-08-28T10:01:30Z", { type: "custom_tool_call", name: "exec", call_id: "tool-1", input: "secret" }),
    entry("2026-08-28T10:02:00Z", {
      type: "message", role: "assistant", phase: "final_answer", id: "assistant-2",
      content: [{ type: "output_text", text: "完整历史已经恢复。<oai-mem-citation>hidden</oai-mem-citation>" }],
    }),
  ].join("\n") + "\n");
  await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({
    id: threadId, thread_name: "云栖大会演讲脚本", updated_at: "2026-08-28T10:02:00Z",
  }));

  const repository = new PreviewRepository({ codexHome });
  const first = await repository.readConversationHistory(`local:${threadId}`, "云栖大会演讲脚本");
  assert.equal(first.totalCount, 3);
  assert.equal(first.userCount, 1);
  assert.equal(first.assistantCount, 2);
  assert.equal(first.messages[0].text, "附件：demo.png\n\n请完整展示历史沟通。");
  assert.equal(first.messages[1].phase, "commentary");
  assert.equal(first.messages[2].text, "完整历史已经恢复。");
  assert.doesNotMatch(first.messages.map((message) => message.text).join("\n"), /reasoning|secret|recommended_plugins/);

  await appendFile(filePath, `${entry("2026-08-28T10:03:00Z", {
    type: "message", role: "user", id: "user-2", content: [{ type: "input_text", text: "继续" }],
  })}\n`);
  const second = await repository.readConversationHistory(threadId, "云栖大会演讲脚本");
  assert.equal(second.totalCount, 4);
  assert.equal(second.userCount, 2);
  assert.equal(second.messages.at(-1).text, "继续");
  assert.equal(second.messages[0].id, "user-1");
});

test("complete history parser ignores non-message response items", () => {
  assert.equal(parseConversationMessageEntry({
    type: "response_item",
    payload: { type: "reasoning", role: "assistant", content: [{ type: "output_text", text: "hidden" }] },
  }), null);
});

test("catalog dedupe keys identify repeated installs by their actual Skill target", () => {
  assert.equal(conversationDedupeKey({
    title: "安装 Ark skills",
    recentInput: "安装这个 https://arkdocs.tos-cn-beijing.volces.com/skills/ skills",
    recentOutput: "Skill：sd25-pe（Seedance 2.5 Prompt Optimizer）已安装完成",
  }), "install-skill:sd25-pe");
  assert.equal(conversationDedupeKey({
    title: "安装 sd25-pe 技能",
    recentInput: "npx --yes skills@latest add URL --skill sd25-pe --yes",
  }), "install-skill:sd25-pe");
  assert.equal(conversationDedupeKey({ title: "创建短视频剧本解析Skill" }), "");
});

test("interruption parsing distinguishes explicit aborts, unfinished runs, and completed turns", () => {
  const event = (timestamp, type) => JSON.stringify({ timestamp, type: "event_msg", payload: { type } });
  assert.deepEqual(parseInterruptionLines([
    event("2026-08-13T10:00:00Z", "task_started"),
    event("2026-08-13T10:01:00Z", "turn_aborted"),
  ]), { kind: "active", reason: "stopped", interruptedAtMs: Date.parse("2026-08-13T10:01:00Z") });
  assert.deepEqual(parseInterruptionLines([
    event("2026-08-13T10:00:00Z", "task_started"),
    event("2026-08-13T10:01:00Z", "turn_failed"),
  ]), { kind: "active", reason: "error", interruptedAtMs: Date.parse("2026-08-13T10:01:00Z") });
  assert.deepEqual(parseInterruptionLines([
    event("2026-08-13T11:00:00Z", "task_started"),
    JSON.stringify({ timestamp: "2026-08-13T11:02:00Z", type: "event_msg", payload: { type: "agent_message" } }),
  ]), { kind: "passive", interruptedAtMs: Date.parse("2026-08-13T11:02:00Z") });
  assert.equal(parseInterruptionLines([
    event("2026-08-13T12:00:00Z", "task_started"),
    event("2026-08-13T12:03:00Z", "task_complete"),
  ]), null);
});

test("repository interrupted catalog includes active and stale passive interruptions but excludes running and completed threads", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-interrupted-catalog-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "13");
  await mkdir(sessions, { recursive: true });
  const ids = {
    active: "00000000-0000-4000-8000-50e6df13fe6e",
    passive: "00000000-0000-4000-8000-b3fd65489599",
    running: "00000000-0000-4000-8000-42475d5d87dc",
    complete: "00000000-0000-4000-8000-06167e969dd6",
  };
  const event = (timestamp, type) => JSON.stringify({ timestamp, type: "event_msg", payload: { type } });
  await Promise.all([
    writeFile(path.join(sessions, `rollout-${ids.active}.jsonl`), [event("2026-08-13T10:00:00Z", "task_started"), event("2026-08-13T10:05:00Z", "turn_aborted")].join("\n")),
    writeFile(path.join(sessions, `rollout-${ids.passive}.jsonl`), event("2026-08-13T11:00:00Z", "task_started")),
    writeFile(path.join(sessions, `rollout-${ids.running}.jsonl`), event("2026-08-13T11:59:30Z", "task_started")),
    writeFile(path.join(sessions, `rollout-${ids.complete}.jsonl`), [event("2026-08-13T09:00:00Z", "task_started"), event("2026-08-13T09:10:00Z", "task_complete")].join("\n")),
  ]);
  await writeFile(path.join(codexHome, "session_index.jsonl"), Object.entries(ids).map(([title, id]) => JSON.stringify({
    id, thread_name: title, updated_at: "2026-08-13T12:00:00Z",
  })).join("\n"));
  const repository = new PreviewRepository({ codexHome });
  assert.deepEqual((await repository.readInterruptedCatalog({ nowMs: Date.parse("2026-08-13T10:06:00Z") }))
    .map((item) => item.title), ["active"]);
  assert.deepEqual((await repository.readInterruptedCatalog({ nowMs: Date.parse("2026-08-13T12:00:00Z") })).map((item) => ({
    title: item.title, label: item.interruptionLabel,
  })), [
    { title: "passive", label: "失联超时" },
    { title: "active", label: "主动停止" },
  ]);
});

test("preview parsing prefers the latest real user and assistant events", () => {
  const lines = [
    JSON.stringify({
      timestamp: "2026-08-09T10:00:00Z",
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: "旧任务已经完成。旧结果不应覆盖新一轮。" },
    }),
    JSON.stringify({
      timestamp: "2026-08-09T11:00:00Z",
      type: "event_msg",
      payload: { type: "user_message", message: "# My request:\n请增加对话核心总结和最近消息。" },
    }),
    JSON.stringify({
      timestamp: "2026-08-09T11:01:00Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "正在实现新的侧栏摘要和悬浮预览。后续状态。" },
    }),
  ];
  const preview = parsePreviewLines(lines, { title: "侧栏优化" });
  assert.equal(preview.recentInput, "请增加对话核心总结和最近消息。");
  assert.equal(preview.recentOutput, "正在实现新的侧栏摘要和悬浮预览。后续状态。");
  assert.equal(preview.summary, "正在实现新的侧栏摘要和悬浮预览。");
});

test("completed threads use their final result as the core summary", () => {
  const lines = [
    JSON.stringify({
      timestamp: "2026-08-09T10:00:00Z",
      type: "event_msg",
      payload: { type: "user_message", message: "修复播放器。" },
    }),
    JSON.stringify({
      timestamp: "2026-08-09T10:02:00Z",
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: "定位完成：文件未损坏，问题是 HEVC 封装兼容性。\n更多细节。" },
    }),
  ];
  assert.equal(
    parsePreviewLines(lines).summary,
    "定位完成：文件未损坏，问题是 HEVC 封装兼容性。",
  );
});

test("text cleanup removes transport wrappers and clamps summaries", () => {
  assert.equal(
    cleanPreviewText("# My request:\n**更新侧栏**", { user: true }),
    "更新侧栏",
  );
  assert.ok(coreSummary("甲".repeat(200)).length <= 96);
});

test("repository resolves a client-new thread by the newest matching title", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-preview-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "09");
  await mkdir(sessions, { recursive: true });
  const oldId = "00000000-0000-4000-8000-c777415fbba7";
  const newId = "00000000-0000-4000-8000-50e6df13fe6e";
  await writeFile(path.join(sessions, `rollout-old-${oldId}.jsonl`), `${JSON.stringify({
    timestamp: "2026-08-09T09:00:00Z",
    type: "event_msg",
    payload: { type: "user_message", message: "旧输入" },
  })}\n`);
  await writeFile(path.join(sessions, `rollout-new-${newId}.jsonl`), [
    JSON.stringify({
      timestamp: "2026-08-09T10:00:00Z",
      type: "event_msg",
      payload: { type: "user_message", message: "新的输入" },
    }),
    JSON.stringify({
      timestamp: "2026-08-09T10:01:00Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "新的输出已经产生。" },
    }),
  ].join("\n"));
  await writeFile(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({ id: oldId, thread_name: "同名对话", updated_at: "2026-08-09T09:00:00Z" }),
    JSON.stringify({ id: newId, thread_name: "同名对话", updated_at: "2026-08-09T10:00:00Z" }),
  ].join("\n"));

  const repository = new PreviewRepository({ codexHome, maxTailBytes: 1024 * 1024 });
  const preview = await repository.readPreview("local:client-new-thread:temporary", "同名对话");
  assert.equal(preview.threadId, newId);
  assert.equal(preview.recentInput, "新的输入");
  assert.equal(preview.recentOutput, "新的输出已经产生。");
  assert.equal(preview.updatedAt, "2026-08-09T10:01:00.000Z");
  assert.equal(preview.tags.length, 3);
});

test("repository reads the latest real rate limit from the newest session", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-usage-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "09");
  await mkdir(sessions, { recursive: true });
  const threadId = "00000000-0000-4000-8000-50e6df13fe6e";
  await writeFile(path.join(sessions, `rollout-${threadId}.jsonl`), `${JSON.stringify({
    timestamp: "2026-08-09T12:22:49Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        limit_id: "codex",
        primary: { used_percent: 48, window_minutes: 10080, resets_at: 1786825820 },
        secondary: null,
        plan_type: "prolite",
      },
    },
  })}\n`);
  await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({
    id: threadId,
    thread_name: "侧栏优化",
    updated_at: "2026-08-09T12:22:49Z",
  }));

  const repository = new PreviewRepository({ codexHome, maxTailBytes: 1024 * 1024 });
  assert.deepEqual(await repository.readUsage?.(), {
    limitId: "codex",
    planType: "prolite",
    usedPercent: 48,
    remainingPercent: 52,
    windowMinutes: 10080,
    resetsAt: "2026-08-15T20:30:20.000Z",
  });
});

test("repository search catalog includes every indexed thread assigned to a saved project", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-search-catalog-test-"));
  const projectWorkspace = path.join(codexHome, "project-innovation");
  const targetId = "00000000-0000-4000-8000-593293ca32b1";
  const unassignedId = "00000000-0000-4000-8000-81b8246d1c40";
  await mkdir(projectWorkspace);
  await writeFile(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({ id: targetId, thread_name: "旧知识卡名称", updated_at: "2026-06-27T09:00:00Z" }),
    JSON.stringify({ id: targetId, thread_name: "创建知识卡片技能", updated_at: "2026-06-28T09:29:06Z" }),
    JSON.stringify({ id: unassignedId, thread_name: "未分配项目的对话", updated_at: "2026-06-29T09:00:00Z" }),
  ].join("\n"));
  await writeFile(path.join(codexHome, ".codex-global-state.json"), JSON.stringify({
    "local-projects": {
      "project-innovation": {
        id: "project-innovation",
        name: "为创新而生",
        rootPaths: [projectWorkspace],
      },
    },
    "thread-project-assignments": {
      [targetId]: {
        projectKind: "local",
        projectId: "project-innovation",
        cwd: "/Users/test/Documents/为创新而生",
      },
    },
  }));

  const repository = new PreviewRepository({ codexHome });
  assert.equal(typeof repository.readSearchCatalog, "function");
  assert.deepEqual(await repository.readSearchCatalog(), [{
    threadId: targetId,
    title: "创建知识卡片技能",
    updatedAt: "2026-06-28T09:29:06.000Z",
    projectId: "project-innovation",
    projectName: "为创新而生",
    workspacePath: "",
    projectWorkspacePath: projectWorkspace,
    workspacePathStatus: "unknown",
    projectWorkspacePathStatus: "available",
  }]);
});

test("repository infers current Codex project membership from the session workspace and keeps real activity order", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-workspace-project-catalog-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "24");
  const recentId = "00000000-0000-4000-8000-577887fbd103";
  const olderId = "00000000-0000-4000-8000-593293ca32b1";
  await mkdir(sessions, { recursive: true });
  const session = (id, timestamp, message) => [
    JSON.stringify({
      timestamp: "2026-08-06T13:10:00Z",
      type: "session_meta",
      payload: { id, cwd: "/Users/test/Documents/为创新而生" },
    }),
    JSON.stringify({
      timestamp,
      type: "event_msg",
      payload: { type: "user_message", message },
    }),
  ].join("\n");
  await writeFile(path.join(sessions, `rollout-${recentId}.jsonl`), session(recentId, "2026-08-24T13:47:39Z", "继续创建全流程剧本 Skill"));
  await writeFile(path.join(sessions, `rollout-${olderId}.jsonl`), session(olderId, "2026-08-20T04:56:16Z", "继续整理知识卡片"));
  await writeFile(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({ id: olderId, thread_name: "创建知识卡片技能", updated_at: "2026-08-20T04:56:16Z" }),
    JSON.stringify({ id: recentId, thread_name: "创建全流程剧本生成Skill", updated_at: "2026-08-06T13:10:12Z" }),
  ].join("\n"));
  await writeFile(path.join(codexHome, ".codex-global-state.json"), JSON.stringify({
    "local-projects": {
      innovation: {
        id: "innovation",
        name: "为创新而生",
        rootPaths: ["/Users/test/Documents/为创新而生"],
      },
      home: {
        id: "home",
        name: "个人目录",
        rootPaths: ["/Users/test"],
      },
    },
    "thread-project-assignments": {},
  }));

  const catalog = await new PreviewRepository({ codexHome }).readSearchCatalog();
  assert.deepEqual(catalog.map(({ title, projectId, projectName }) => ({ title, projectId, projectName })), [
    { title: "创建全流程剧本生成Skill", projectId: "innovation", projectName: "为创新而生" },
    { title: "创建知识卡片技能", projectId: "innovation", projectName: "为创新而生" },
  ]);
  assert.equal(catalog[0].updatedAt, "2026-08-24T13:47:39.000Z");
});

test('alternating native and index catalogs reuse discovery while new index entries remain discoverable', async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'catalog-cache-test-'));
  const sessions = path.join(codexHome, 'sessions'); await mkdir(sessions);
  const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222';
  const writeSession = id => writeFile(path.join(sessions, `rollout-${id}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { id } }) + '\n');
  const row = id => JSON.stringify({ id, thread_name: id === first ? '虚构任务一' : '虚构任务二', updated_at: '2026-09-28T00:00:00Z' }) + '\n';
  await writeSession(first); await writeFile(path.join(codexHome, 'session_index.jsonl'), row(first));
  const repository = new PreviewRepository({ codexHome }); let discoveries = 0;
  const refresh = repository.refreshIndex.bind(repository);
  repository.refreshIndex = () => { discoveries++; return refresh(); };
  const sourceThreads = [{ threadId: first, title: '宿主标题', updatedAt: '2026-09-28T00:00:00Z' }];
  for (let i = 0; i < 3; i++) {
    assert.equal((await repository.readRecentCatalog())[0].title, '虚构任务一');
    assert.equal((await repository.readRecentCatalog({ sourceThreads }))[0].title, '宿主标题');
  }
  assert.equal(discoveries, 1, 'stable catalogs must not repeatedly walk all session directories');
  sourceThreads[0].title = '新的宿主标题';
  assert.equal((await repository.readRecentCatalog({ sourceThreads }))[0].title, '新的宿主标题');
  assert.equal(discoveries, 1);
  await writeSession(second);
  sourceThreads.push({ threadId: second, title: '新建原生任务' });
  assert.equal((await repository.readRecentCatalog({ sourceThreads })).length, 2);
  assert.ok(repository.filesById.has(second), 'new native task is discoverable before index append');
  assert.equal(discoveries, 2);
  await appendFile(path.join(codexHome, 'session_index.jsonl'), row(second));
  assert.equal((await repository.readRecentCatalog()).length, 2); assert.equal(discoveries, 3);
});

test("repository recent catalog covers assigned and unassigned threads in global activity order", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-recent-catalog-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "12");
  const assignedId = "00000000-0000-4000-8000-50e6df13fe6e";
  const unassignedId = "00000000-0000-4000-8000-b3fd65489599";
  await mkdir(sessions, { recursive: true });
  const assignedSession = path.join(sessions, `rollout-${assignedId}.jsonl`);
  const unassignedSession = path.join(sessions, `rollout-${unassignedId}.jsonl`);
  await writeFile(assignedSession, `${JSON.stringify({
    timestamp: "2026-08-12T11:30:00Z",
    type: "event_msg",
    payload: { type: "user_message", message: "继续优化最近列表" },
  })}\n`);
  await writeFile(unassignedSession, `${JSON.stringify({
    timestamp: "2026-08-12T12:00:00Z",
    type: "event_msg",
    payload: { type: "user_message", message: "刚刚使用的未归类对话" },
  })}\n`);
  // A background reader may touch an old session file. File mtime must not
  // outrank the real latest conversation event shown on the card.
  await utimes(assignedSession, new Date("2026-08-12T13:00:00Z"), new Date("2026-08-12T13:00:00Z"));
  await utimes(unassignedSession, new Date("2026-08-12T12:00:00Z"), new Date("2026-08-12T12:00:00Z"));
  await writeFile(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({ id: assignedId, thread_name: "旧标题", updated_at: "2026-08-10T09:00:00Z" }),
    JSON.stringify({ id: assignedId, thread_name: "项目内最近对话", updated_at: "2026-08-11T10:00:00Z" }),
    JSON.stringify({ id: unassignedId, thread_name: "未归类最近对话", updated_at: "2026-08-11T09:00:00Z" }),
  ].join("\n"));
  await writeFile(path.join(codexHome, ".codex-global-state.json"), JSON.stringify({
    "local-projects": { project: { id: "project", name: "管理优化" } },
    "thread-project-assignments": { [assignedId]: { projectId: "project" } },
  }));

  const repository = new PreviewRepository({ codexHome });
  assert.deepEqual(await repository.readRecentCatalog(), [
    {
      threadId: unassignedId,
      title: "未归类最近对话",
      updatedAt: "2026-08-12T12:00:00.000Z",
      projectId: "",
      projectName: "",
      workspacePath: "",
      projectWorkspacePath: "",
      workspacePathStatus: "unknown",
      projectWorkspacePathStatus: "unknown",
    },
    {
      threadId: assignedId,
      title: "项目内最近对话",
      updatedAt: "2026-08-12T11:30:00.000Z",
      projectId: "project",
      projectName: "管理优化",
      workspacePath: "",
      projectWorkspacePath: "",
      workspacePathStatus: "unknown",
      projectWorkspacePathStatus: "unknown",
    },
  ]);
});

test("authoritative Codex task catalog distinguishes recorded folders from current project folders", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-authoritative-task-catalog-test-"));
  const currentWorkspace = path.join(codexHome, "workstation");
  const currentSubdirectory = path.join(currentWorkspace, "subdir");
  const retiredWorkspace = path.join(codexHome, "retired-workspace");
  const indexedId = "00000000-0000-4000-8000-50e6df13fe6e";
  const missingId = "00000000-0000-4000-8000-b3fd65489599";
  await mkdir(currentSubdirectory, { recursive: true });
  await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({
    id: indexedId, thread_name: "索引已有任务", updated_at: "2026-08-12T10:00:00Z",
  }));
  await writeFile(path.join(codexHome, ".codex-global-state.json"), JSON.stringify({
    "local-projects": {
      project: { id: "project", name: "工作站", rootPaths: [currentWorkspace] },
    },
    "thread-project-assignments": {
      [missingId]: { projectKind: "local", projectId: "project" },
    },
  }));

  const catalog = await new PreviewRepository({ codexHome }).readRecentCatalog({
    sourceThreads: [
      { threadId: missingId, title: "索引缺失任务", updatedAt: "2026-08-12T12:00:00Z", workspacePath: retiredWorkspace },
      { threadId: indexedId, title: "API 最新标题", updatedAt: "2026-08-12T11:00:00Z", workspacePath: currentSubdirectory },
    ],
  });
  assert.deepEqual(catalog.map((item) => ({
    threadId: item.threadId,
    title: item.title,
    projectName: item.projectName,
    workspacePath: item.workspacePath,
    projectWorkspacePath: item.projectWorkspacePath,
    workspacePathStatus: item.workspacePathStatus,
    projectWorkspacePathStatus: item.projectWorkspacePathStatus,
  })), [
    {
      threadId: missingId,
      title: "索引缺失任务",
      projectName: "工作站",
      workspacePath: retiredWorkspace,
      projectWorkspacePath: currentWorkspace,
      workspacePathStatus: "missing",
      projectWorkspacePathStatus: "available",
    },
    {
      threadId: indexedId,
      title: "API 最新标题",
      projectName: "工作站",
      workspacePath: currentSubdirectory,
      projectWorkspacePath: currentWorkspace,
      workspacePathStatus: "available",
      projectWorkspacePathStatus: "available",
    },
  ]);
});

test("repository detects all recent unfinished native runs without relying on rendered sidebar rows", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-running-task-catalog-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "09", "03");
  const runningId = "00000000-0000-4000-8000-50e6df13fe6e";
  const completedId = "00000000-0000-4000-8000-b3fd65489599";
  const event = (timestamp, type) => JSON.stringify({ timestamp, type: "event_msg", payload: { type } });
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, `rollout-${runningId}.jsonl`), event("2026-09-03T12:00:00Z", "task_started"));
  await writeFile(path.join(sessions, `rollout-${completedId}.jsonl`), [
    event("2026-09-03T11:55:00Z", "task_started"),
    event("2026-09-03T11:56:00Z", "task_complete"),
  ].join("\n"));
  await writeFile(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({ id: runningId, thread_name: "后台执行任务", updated_at: "2026-09-03T12:00:00Z" }),
    JSON.stringify({ id: completedId, thread_name: "完成任务", updated_at: "2026-09-03T11:56:00Z" }),
  ].join("\n"));
  const repository = new PreviewRepository({ codexHome });
  const catalog = await repository.readRecentCatalog();
  assert.deepEqual(await repository.readRunningThreadIds({
    catalog,
    nowMs: Date.parse("2026-09-03T12:01:00Z"),
  }), [runningId]);
  assert.deepEqual(await repository.readRunningThreadIds({
    catalog,
    nowMs: Date.parse("2026-09-03T12:10:00Z"),
  }), []);
  assert.deepEqual(await repository.readRunningThreadIds({
    catalog: [
      ...Array.from({ length: 80 }, (_, index) => ({ threadId: `missing-${index}` })),
      catalog.find((item) => item.threadId === runningId),
    ],
    nowMs: Date.parse("2026-09-03T12:01:00Z"),
  }), [runningId]);
});

test("repository reads and normalizes the complete native pinned thread set", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-pinned-threads-test-"));
  const first = "00000000-0000-4000-8000-50e6df13fe6e";
  const second = "00000000-0000-4000-8000-593293ca32b1";
  await writeFile(path.join(codexHome, ".codex-global-state.json"), JSON.stringify({
    "pinned-thread-ids": [first.toUpperCase(), `local:${second}`, first, "invalid"],
  }));

  const repository = new PreviewRepository({ codexHome });
  assert.deepEqual(await repository.readPinnedThreadIds(), [first, second]);
});

test("repository search catalog uses newer conversation activity than the stale title index", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-search-activity-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "10");
  const threadId = "00000000-0000-4000-8000-50e6df13fe6e";
  await mkdir(sessions, { recursive: true });
  const sessionPath = path.join(sessions, `rollout-${threadId}.jsonl`);
  await writeFile(sessionPath, `${JSON.stringify({
    timestamp: "2026-08-10T11:00:00Z",
    type: "event_msg",
    payload: { type: "user_message", message: "继续修改全部视图" },
  })}\n`);
  await utimes(sessionPath, new Date("2026-08-10T11:00:00Z"), new Date("2026-08-10T11:00:00Z"));
  await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({
    id: threadId,
    thread_name: "侧栏优化",
    updated_at: "2026-08-09T10:00:00Z",
  }));
  await writeFile(path.join(codexHome, ".codex-global-state.json"), JSON.stringify({
    "local-projects": { project: { id: "project", name: "管理优化" } },
    "thread-project-assignments": { [threadId]: { projectId: "project" } },
  }));

  const repository = new PreviewRepository({ codexHome });
  assert.equal((await repository.readSearchCatalog())[0].updatedAt, "2026-08-10T11:00:00.000Z");
});

test("repository preview reports the latest conversation event when the title index is stale", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-preview-activity-test-"));
  const sessions = path.join(codexHome, "sessions", "2026", "08", "10");
  const threadId = "00000000-0000-4000-8000-50e6df13fe6e";
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, `rollout-${threadId}.jsonl`), [
    JSON.stringify({
      timestamp: "2026-08-10T11:00:00Z",
      type: "event_msg",
      payload: { type: "user_message", message: "增加全部项目" },
    }),
    JSON.stringify({
      timestamp: "2026-08-10T11:02:00Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "全部项目正在生成。" },
    }),
  ].join("\n"));
  await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({
    id: threadId,
    thread_name: "侧栏优化",
    updated_at: "2026-08-09T10:00:00Z",
  }));

  const repository = new PreviewRepository({ codexHome });
  assert.equal((await repository.readPreview(`local:${threadId}`, "侧栏优化")).updatedAt,
    "2026-08-10T11:02:00.000Z");
});

test("repository keeps indexed recent conversations readable when their session file is unavailable", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-index-only-preview-test-"));
  const threadId = "00000000-0000-4000-8000-289a6f8b0c1d";
  await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({
    id: threadId,
    thread_name: "索引中的最近对话",
    updated_at: "2026-08-12T07:35:46Z",
  }));

  const repository = new PreviewRepository({ codexHome });
  const preview = await repository.readPreview(`local:${threadId}`, "索引中的最近对话");
  assert.equal(preview?.threadId, threadId);
  assert.equal(preview?.summary, "围绕“索引中的最近对话”的对话");
  assert.equal(preview?.updatedAt, "2026-08-12T07:35:46.000Z");
  assert.equal(preview?.tags.length, 3);
});
