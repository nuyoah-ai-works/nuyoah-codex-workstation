import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../vendor/codex-taskboard/", import.meta.url);

test("result action follows an admitted native file reference and rejects arbitrary or remote paths", async () => {
  const source = await readFile(new URL("inject/codex-taskboard.user.js", root), "utf8");
  const start = source.indexOf("  async function openTaskResult(payload)");
  const end = source.indexOf("  function projectRowByLabel", start);
  let clicked = 0, opened = 0;
  const link = { path: "/work/result.md", exists: true, label: "Report" };
  const context = { threadId: "task", hostId: "local", taskboard: { tasks: [{ threadId: "task", hostId: "local", resultLinks: [link] }] } };
  const nativeLink = { getClientRects: () => [1], closest: () => null,
    getAttribute: key => key === "data-prompt-link-href" ? "/work/result.md:2" : null, click: () => { clicked++; } };
  const open = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
    document: { querySelectorAll: () => [nativeLink] }, readHostContext: () => context,
    normalizeThreadId: value => value, openThread: async () => { opened++; },
  });
  assert.equal(await open({ threadId: "task", hostId: "local", path: link.path }), true);
  assert.equal(clicked, 1);
  assert.equal(opened, 1);
  await assert.rejects(open({ threadId: "task", hostId: "local", path: "/unrelated/private.md" }), /结果文件已失效/);
  assert.equal(await open({ threadId: "task", hostId: "remote", path: link.path }), false);
  assert.equal(opened, 1);
});

test("vendored Taskboard is the pinned custom project-management snapshot", async () => {
  const manifest = JSON.parse(await readFile(new URL("VERSION.json", root), "utf8"));
  assert.deepEqual(
    {
      version: manifest.version,
      ref: manifest.ref,
      baseCommit: manifest.baseCommit,
      license: manifest.license,
      snapshotSource: manifest.snapshotSource,
    },
    {
      version: "0.2.0-codexoptimiz.20260831",
      ref: "custom-working-tree-2026-08-31",
      baseCommit: "677b544",
      license: "Apache-2.0",
      snapshotSource: "custom-working-tree-2026-08-31",
    },
  );
  await access(new URL("LICENSE", root));
  await access(new URL("dist/web/index.html", root));
  await access(new URL("web/src/components/ProjectSwimlaneBoard.tsx", root));
});

test("embedded Taskboard is a four-state Codex task view while standalone keeps the legacy app", async () => {
  const app = await readFile(new URL("web/src/App.tsx", root), "utf8");
  const liveBoard = await readFile(new URL("web/src/components/CodexTaskboard.tsx", root), "utf8");
  const styles = await readFile(new URL("web/src/styles.css", root), "utf8");
  const liveState = await readFile(new URL("../../nuyoah/taskboard/live-state.mjs", root), "utf8");
  const injection = await readFile(new URL("inject/codex-taskboard.user.js", root), "utf8");
  assert.match(app, /embedded \? <CodexTaskboard \/> : <LegacyTaskboardApp \/>/);
  assert.match(app, /<ProjectSwimlaneBoard/);
  assert.match(liveState, /"attention",\s*"running",\s*"failed",\s*"completed"/);
  assert.match(liveBoard, /待处理/);
  assert.match(liveBoard, /失败/);
  assert.match(liveBoard, /执行中/);
  assert.match(liveBoard, /已完成/);
  assert.match(liveBoard, /DEFAULT_VISIBLE_TASKS = 5/);
  assert.match(liveBoard, /VISIBLE_TASK_STEP = 10/);
  assert.match(liveBoard, /const visible = visibleLiveTasks\(all, visibleCount\)/);
  assert.match(liveBoard, /LIVE_TASK_STATUSES\.map\(\(status: DisplayStatus\) =>/);
  assert.match(liveBoard, /移回待处理/);
  assert.match(liveBoard, /已完成/);
  assert.doesNotMatch(liveBoard, /function openTask[\s\S]{0,220}markHandled/);
  assert.match(liveBoard, /function hasCurrentMetaStore\(\)/);
  assert.match(liveBoard, /bootstrapExistingHistory = useRef\(!hasCurrentMetaStore\(\)\)/);
  assert.match(liveBoard, /if \(!bootstrapExistingHistory\.current\) return/);
  assert.match(liveBoard, /taskboard:open-thread/);
  assert.match(liveBoard, /requestAction\("archive"/);
  assert.match(liveBoard, /requestAction\("new-thread"/);
  assert.match(liveBoard, /执行目录已失效/);
  assert.match(liveBoard, /当前项目目录/);
  assert.match(liveBoard, /workspacePathStatus/);
  assert.match(liveBoard, /projectWorkspacePath/);
  assert.match(liveBoard, /__unassigned__/);
  assert.match(liveBoard, /data-current-task=\{isCurrent \? "true" : undefined\}/);
  assert.match(liveBoard, /data-thread-id=\{task\.threadId\}/);
  assert.match(liveBoard, /aria-current=\{isCurrent \? "page" : undefined\}/);
  assert.match(liveBoard, /正在查看/);
  assert.doesNotMatch(liveBoard, /const ordered = currentTask/);
  assert.match(styles, /\.codex-live-card\.is-current/);
  assert.match(styles, /\.codex-live-current-marker/);
  assert.match(liveBoard, /正在重新连接，当前显示上次同步结果/);
  assert.match(styles, /\.codex-live-board\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
  assert.doesNotMatch(styles, /\.codex-live-board\s*\{[^}]*min-height:\s*100vh;/);
  assert.match(injection, /getTaskboardSnapshot/);
});

test("custom Taskboard keeps side-panel embedding and the loopback null-origin fix", async () => {
  const injection = await readFile(new URL("inject/codex-taskboard.user.js", root), "utf8");
  const injector = await readFile(new URL("scripts/codex-injector.mjs", root), "utf8");
  const server = await readFile(new URL("server/app.mjs", root), "utf8");
  assert.match(injection, /codex-taskboard-page/);
  assert.match(injection, /codex-taskboard-frame/);
  assert.match(injection, /--codex-taskboard-panel-width/);
  assert.match(injection, /contextHeartbeatTimer/);
  assert.match(injection, /taskboard:summary/);
  assert.match(injection, /refreshContext: postHostContext/);
  assert.match(injection, /__codexConversationPreviewInjection__\?\.revealThread\?\.\(normalizedThreadId\)/);
  assert.match(injection, /const THREAD_SELECTION_GRACE_MS = 1_600/);
  assert.match(injection, /function rememberThreadSelection\(value\)/);
  assert.match(injection, /pendingThreadId \|\| activeThreadId \|\| lastNativeThreadId/);
  assert.match(injection, /taskboard:archive/);
  assert.match(injection, /taskboard:new-thread/);
  assert.doesNotMatch(injection, /const row = findThreadRow\(normalizedThreadId\);\s+closeTaskboard\(false\)/);
  assert.match(injection, /search: searchTaskboard/);
  assert.match(injection, /addSkillToComposer/);
  assert.match(injector, /Input\.insertText", \{ text: `\$\$\{skillName\}` \}/);
  assert.match(server, /origin === "null" && isLoopbackAddress/);
  assert.match(server, /access-control-allow-private-network/);
});

test("custom Taskboard finds the plugin entry through Codex contents wrappers", async () => {
  const injection = await readFile(new URL("inject/codex-taskboard.user.js", root), "utf8");
  assert.match(injection, /function directShortcutButtons\(group\)/);
  assert.match(injection, /:scope > button, :scope > \* > button/);
  assert.match(injection, /function shortcutSiblingGroup\(button\)/);
  assert.match(injection, /const pluginGroup = shortcutSiblingGroup\(plugin\)/);
});

test("custom Taskboard watch mode avoids macOS process probes on Windows", async () => {
  const source = await readFile(new URL("scripts/codex-injector.mjs", root), "utf8");
  assert.match(source, /function codexPids\(\) \{\s+if \(process\.platform === "win32"\) return \[\]/);
  assert.match(source, /function codexDebuggingPorts\(preferredPort\)[\s\S]*?process\.platform === "win32"/);
  assert.match(source, /function processCwd\(pid\) \{\s+if \(process\.platform === "win32"\) return null/);
  assert.match(source, /function residentInjectorPids\(port\) \{\s+if \(process\.platform === "win32"\) return \[\]/);
});
