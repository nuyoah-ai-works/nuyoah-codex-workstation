import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { mergeOrchestratorRequestSnapshot } from "../../../nuyoah/taskboard/orchestrator-view.mjs";

const root = new URL("../", import.meta.url);

async function source(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

test("embedded Taskboard exposes remembered 委托 and 全部任务 views", async () => {
  const board = await source("web/src/components/CodexTaskboard.tsx");
  const orchestrator = await source("web/src/components/OrchestratorRequests.tsx");
  assert.match(board, /role="tablist" aria-label="任务视图"/);
  assert.match(board, /"委托 · 未连接"/);
  assert.match(board, /"委托"/);
  assert.match(board, />全部任务<\/button>/);
  assert.match(board, /savedView\s*\?\?\s*\(orchestratorSnapshot === null/);
  assert.match(board, /orchestratorSnapshot\.requests\.length > 0/);
  assert.match(orchestrator, /taskboard\.codex-live-view\.v1/);
  assert.match(orchestrator, /window\.localStorage\.setItem\(ORCHESTRATOR_VIEW_KEY, value\)/);
});

test("delegated cards show progress, verification, user attention, and child model state", async () => {
  const sourceText = await source("web/src/components/OrchestratorRequests.tsx");
  const types = await source("web/src/types.ts");
  assert.match(sourceText, /进度 \{progress\.completed\}\/\{progress\.total\}/);
  assert.match(sourceText, /request\.verification/);
  assert.match(sourceText, /需要南鸢/);
  assert.match(sourceText, /dispatch\.model/);
  assert.match(sourceText, /dispatch\.effort/);
  assert.match(sourceText, /DISPATCH_STATUS_LABELS\[dispatch\.status\]/);
  assert.match(sourceText, /工人完成 \{workerDone\}\/\{workerTotal\}/);
  assert.match(sourceText, /独立验证 \{candidate\.validationStatus\}/);
  assert.match(sourceText, /LOCAL_RECORD_LABELS\[candidate\.localRecordStatus\]/);
  assert.match(sourceText, /ENABLE_LABELS\[candidate\.enableStatus\]/);
  assert.match(sourceText, /PUBLISH_LABELS\[candidate\.publishStatus\]/);
  assert.match(sourceText, /entry\.valueGateStage/);
  assert.match(sourceText, /entry\.valueGateDecision/);
  assert.match(types, /"PASS" \| "FAIL" \| "PARTIAL" \| "UNVERIFIED"/);
});

test("delegated details expose lineage, route evidence, governance freshness, and three rollback milestones", async () => {
  const sourceText = await source("web/src/components/OrchestratorRequests.tsx");
  assert.match(sourceText, /来源会话/);
  assert.match(sourceText, /会话血缘/);
  assert.match(sourceText, /为什么这样派/);
  assert.match(sourceText, /route\.ruleMatches/);
  assert.match(sourceText, /route\.skillMatches/);
  assert.match(sourceText, /route\.toolMatches/);
  assert.match(sourceText, /治理真源读取失败/);
  assert.match(sourceText, /上次可信/);
  assert.match(sourceText, /总管路由/);
  assert.match(sourceText, /正式真源/);
  assert.match(sourceText, /新会话/);
  assert.doesNotMatch(sourceText, /综合分|候选总分|成功分数/);
});

test("expanded details keep events but never override newer list status or child state", () => {
  const current = {
    id: "request-1",
    status: "verifying",
    verification: "PARTIAL",
    dispatches: [{ id: "dispatch-1", status: "done", threadId: "thread-real-1" }],
  };
  const staleDetail = {
    request: {
      id: "request-1",
      status: "running",
      verification: "UNVERIFIED",
      dispatches: [{ id: "dispatch-1", status: "running", threadId: "thread-real-1" }],
      events: [{ id: 1, type: "dispatch.registered" }],
    },
  };
  const merged = mergeOrchestratorRequestSnapshot(current, staleDetail);
  assert.equal(merged.status, "verifying");
  assert.equal(merged.verification, "PARTIAL");
  assert.equal(merged.dispatches[0].status, "done");
  assert.deepEqual(merged.events, staleDetail.request.events);
});

test("delegated view only opens a real thread ID and leaves client-only children unavailable", async () => {
  const sourceText = await source("web/src/components/OrchestratorRequests.tsx");
  assert.match(sourceText, /THREAD_ID_PATTERN = \/\^\[0-9a-f\]\{8\}/);
  assert.match(sourceText, /shown\.lineageStatus === "known" && realThreadId\(shown\.rootSessionId\)/);
  assert.match(sourceText, /realThreadId\(dispatch\.threadId\) && resolveThreadHost\(dispatch\.threadId\)/);
  assert.match(sourceText, /onOpenThread\(dispatch\.threadId!, resolveThreadHost\(dispatch\.threadId!\)!\)/);
  assert.match(sourceText, /任务正在建立/);
  assert.doesNotMatch(sourceText, /onOpenThread\(dispatch\.clientThreadId/);
  assert.doesNotMatch(sourceText, /归档|停止任务|重试任务|重新派发/);
  assert.match(sourceText, /查看详情/);
  assert.match(sourceText, /打开任务/);
});

test("delegated view prioritizes attention and current work while keeping completed history and evidence on demand", async () => {
  const sourceText = await source("web/src/components/OrchestratorRequests.tsx");
  assert.match(sourceText, /request\.needsUser \|\| request\.status === "failed"/);
  assert.match(sourceText, /request\.status === "waiting_user" && !request\.needsUser[\s\S]*"等待中"/);
  assert.match(sourceText, /dispatch\.needsAttention \|\| dispatch\.status === "unknown"/);
  assert.match(sourceText, /子任务待核对/);
  assert.match(sourceText, /\{ key: "attention", label: "需要关注"/);
  assert.match(sourceText, /\{ key: "active", label: "进行中"/);
  assert.match(sourceText, /\{ key: "finished", label: "最近结束"/);
  assert.match(sourceText, /section\.requests\.slice\(0, RECENT_FINISHED_COUNT\)/);
  assert.match(sourceText, /aria-expanded=\{showFinishedHistory\}/);
  assert.match(sourceText, /打开来源会话/);
  assert.match(sourceText, /打开执行任务/);
  assert.match(sourceText, /\{expanded && \(/);
  assert.match(sourceText, /\{shown\.dispatches\.length > 0 && <div className="codex-orchestrator-dispatches">/);
  assert.match(sourceText, /detailLoadSequence\.current\[requestId\] !== sequence/);
});

test("delegated navigation uses only a resolved host and never routes an unavailable remote row as local", async () => {
  const board = await source("web/src/components/CodexTaskboard.tsx");
  const bridge = await source("inject/codex-taskboard.user.js");
  assert.match(board, /function resolveThreadHost\(threadId: string\): string \| null/);
  assert.match(board, /hosts\.size === 1 \? \[\.\.\.hosts\]\[0\] : null/);
  assert.match(board, /resolveThreadHost=\{resolveThreadHost\}/);
  assert.match(bridge, /if \(hostId !== "local"\) \{[\s\S]*if \(nativeRow\) \{[\s\S]*return true;[\s\S]*return false;/);
  assert.match(bridge, /if \(nativeRow\) \{\s*rememberThreadSelection\(threadId\);/);
  assert.match(bridge, /return false;\s*\}\s*rememberThreadSelection\(threadId\);\s*window\.__codexConversationPreviewInjection__/);
});

test("orchestrator API client preserves actionable unconfigured and reconnecting states", async () => {
  const api = await source("web/src/api.ts");
  const sourceText = await source("web/src/components/OrchestratorRequests.tsx");
  assert.match(api, /\/api\/local\/orchestrator\/requests/);
  assert.match(api, /response\.status !== 503 && response\.status !== 409/);
  assert.match(sourceText, /委托账本尚未连接/);
  assert.match(sourceText, /委托账本正在重连/);
  assert.match(sourceText, /上次可信结果/);
  assert.match(sourceText, /schemaStatus === "read_only_degraded"/);
  assert.match(sourceText, /unsupported_newer_schema/);
  assert.match(sourceText, /当前工作站不支持这个账本版本/);
  assert.match(sourceText, /if \(!snapshot\.requests\)/);
});

test("the four task status groups and manual controls remain intact", async () => {
  const board = await source("web/src/components/CodexTaskboard.tsx");
  assert.match(board, /LIVE_TASK_STATUSES\.map/);
  assert.match(board, /DEFAULT_VISIBLE_TASKS = 5/);
  assert.match(board, /VISIBLE_TASK_STEP = 10/);
  assert.match(board, /visibleLiveTasks\(all, visibleCount\)/);
  assert.match(board, /data-thread-id=\{task\.threadId\}/);
  assert.match(board, /grouped\.attention\.length \+ grouped\.failed\.length/);
  assert.match(board, /requestAction\("archive"/);
  assert.match(board, /requestAction\("new-thread"/);
  assert.match(board, /移回待处理/);
  assert.match(board, /置顶任务/);
  assert.match(board, /任务优先级/);
});

test("dual-view styles preserve two live task columns at narrow breakpoints", async () => {
  const styles = await source("web/src/styles.css");
  assert.match(styles, /\.codex-live-view-tabs/);
  assert.match(styles, /\.codex-orchestrator-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(2/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.codex-live-columns \{ grid-template-columns: repeat\(2/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.codex-live-columns \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(styles, /\.codex-live-columns\s*\{[^}]*grid-template-columns:\s*(?:repeat\(4|minmax\(0,\s*1fr\)\s*[;}])/);
});
