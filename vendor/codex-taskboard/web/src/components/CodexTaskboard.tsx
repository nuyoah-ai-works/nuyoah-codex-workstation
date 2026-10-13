import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HostContext } from "../types";
// @ts-expect-error Shared ESM logic is covered by a focused node:test.
import { LIVE_TASK_STATUSES, bootstrapRemoteHistory, completionKind, taskReadStatus, taskAttentionLabel, readLiveView, saveLiveView, liveTaskStatus, sortLiveTasks, visibleLiveTasks } from "../../../../../nuyoah/taskboard/live-state.mjs";
import {
  OrchestratorRequestView,
  readSavedTaskboardView,
  requestNeedsAttention,
  saveTaskboardView,
  useOrchestratorRequests,
} from "./OrchestratorRequests";
import type { CodexTaskboardView } from "./OrchestratorRequests";

// @ts-expect-error Shared renderer preferences are validated by focused node tests.
import { AUTO_THREAD_METADATA_KEY, readAutoThreadMetadata } from "../../../../../nuyoah/workstation/auto-thread-metadata.mjs";

type RuntimeStatus = "running" | "failed" | "completed" | "unknown";
type DisplayStatus = "attention" | "failed" | "running" | "completed";
type TaskGroup = DisplayStatus | "history";
type TaskSource = "project" | "chatgpt";
type TaskGroupKey = TaskGroup | `${TaskSource}:${TaskGroup}` | `project:attention:${string}`;
type Priority = "none" | "high" | "urgent";
type WorkspacePathStatus = "available" | "missing" | "unknown";

interface LiveTask {
  threadId: string;
  taskKey: string;
  hostId?: string;
  hostName?: string;
  source?: "chatgpt";
  title: string;
  projectId: string;
  projectName: string;
  workspacePath: string;
  workspacePathStatus: WorkspacePathStatus;
  projectWorkspacePath: string;
  projectWorkspacePathStatus: WorkspacePathStatus;
  runtimeStatus: RuntimeStatus;
  progress: string;
  waitingReason?: "input" | "approval" | null;
  hasFinalResponse?: boolean;
  resultLinks?: Array<{ path: string; label: string; exists: boolean }>;
  updatedAt: string;
  activityAt?: string | null;
  createdAt?: string;
  pinned?: boolean;
}

interface LiveSnapshot {
  version: 1;
  updatedAt: string;
  tasks: LiveTask[];
  remoteSync?: Array<{ hostId?: string; hostName: string; loading: boolean; hasSnapshot?: boolean;
    phase?: "connecting" | "disconnected" | "offline" | "paused" | "retrying" | "loading" }>;
}

interface LiveHostContext extends HostContext {
  taskboard?: LiveSnapshot;
  hostId?: string;
}

interface TaskMeta {
  viewedAt?: string;
  viewedActivityAt?: string | null;
  seenAt?: string;
  seenActivityAt?: string | null;
  manualPending?: boolean;
  pinned?: boolean;
  priority?: Priority;
  statusChangedAt?: string;
  completedAt?: string | null;
  initialHistory?: boolean;
  initialRemoteHistory?: boolean;
}

type TaskMetaByThread = Record<string, TaskMeta>;

const META_KEY = "taskboard.codex-live-meta.v2";
const LEGACY_META_KEY = "taskboard.codex-live-meta.v1";
const REMOTE_HISTORY_CUTOFF_KEY = "taskboard.remote-history-cutoff.v1";

function remoteHistoryCutoff() {
  const saved = Number(window.localStorage.getItem(REMOTE_HISTORY_CUTOFF_KEY));
  if (Number.isFinite(saved) && saved > 0) return saved;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  window.localStorage.setItem(REMOTE_HISTORY_CUTOFF_KEY, String(today.getTime()));
  return today.getTime();
}
const STATUS_LABELS: Record<DisplayStatus, string> = {
  attention: "待处理",
  failed: "失败",
  running: "执行中",
  completed: "已完成",
};
const DEFAULT_VISIBLE_TASKS = 5;
const VISIBLE_TASK_STEP = 10;

function readMeta(): TaskMetaByThread {
  try {
    const saved = window.localStorage.getItem(META_KEY);
    if (saved) {
      const value = JSON.parse(saved);
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }
    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_META_KEY) ?? "{}");
    return Object.fromEntries(Object.entries(legacy && typeof legacy === "object" && !Array.isArray(legacy) ? legacy : {})
      .map(([threadId, value]) => {
        const old = value && typeof value === "object" ? value as TaskMeta : {};
        return [threadId, { pinned: old.pinned, priority: old.priority }];
      }));
  } catch {
    return {};
  }
}

function persistMeta(value: TaskMetaByThread) {
  window.localStorage.setItem(META_KEY, JSON.stringify(value));
}

function hasCurrentMetaStore() {
  try {
    return window.localStorage.getItem(META_KEY) !== null;
  } catch {
    return false;
  }
}

function updatedLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间待同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function workspaceLabel(value: string) {
  const normalized = String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "执行目录待同步";
  const home = normalized.match(/^\/Users\/[^/]+(?=\/|$)/)?.[0];
  return home ? `~${normalized.slice(home.length)}` : normalized;
}

function sameWorkspace(left: string, right: string) {
  const normalized = (value: string) => String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
  return Boolean(normalized(left) && normalized(left) === normalized(right));
}

function normalizeThreadId(value?: string) {
  return String(value || "").trim().replace(/^(?:local|cloud):/i, "");
}

export function CodexTaskboard() {
  const [autoMetadata, setAutoMetadata] = useState(() => readAutoThreadMetadata(window.localStorage));
  const [context, setContext] = useState<LiveHostContext | null>(null);
  const [meta, setMeta] = useState<TaskMetaByThread>(readMeta);
  const [remoteCutoff] = useState(remoteHistoryCutoff);
  const [savedPosition] = useState(() => readLiveView(window.localStorage));
  const [projectAutoCompleteHours, setProjectAutoCompleteHours] = useState<number>(savedPosition.projectAutoCompleteHours);
  const [query, setQuery] = useState<string>(savedPosition.query);
  const [projectId, setProjectId] = useState<string>(savedPosition.projectId);
  const [visibleCounts, setVisibleCounts] = useState<Partial<Record<TaskGroupKey, number>>>(savedPosition.visibleCounts);
  const [historyOpenBySource, setHistoryOpenBySource] = useState<Record<TaskSource, boolean>>(savedPosition.historyOpenBySource);
  const boardRef = useRef<HTMLElement>(null);
  const scrollTop = useRef<number>(savedPosition.scrollTop);
  const restoringScroll = useRef(savedPosition.scrollTop > 0);
  const [undo, setUndo] = useState<{ threadId: string; previous?: TaskMeta; message: string } | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [actionError, setActionError] = useState("");
  const [savedView, setSavedView] = useState<CodexTaskboardView | null>(readSavedTaskboardView);
  const bootstrapped = useRef(false);
  const bootstrapExistingHistory = useRef(!hasCurrentMetaStore());
  const snapshot = context?.taskboard;
  const currentThreadId = normalizeThreadId(context?.threadId);
  const currentHostId = context?.hostId || "local";
  const orchestratorSnapshot = useOrchestratorRequests();
  const orchestratorAttentionCount = orchestratorSnapshot?.requests?.filter(requestNeedsAttention).length ?? 0;
  const view: CodexTaskboardView = savedView
    ?? (orchestratorSnapshot === null
      || (orchestratorSnapshot.requests && orchestratorSnapshot.requests.length > 0)
      ? "orchestrator"
      : "all");

  useEffect(() => {
    const refresh = (event: StorageEvent) => { if (event.key === AUTO_THREAD_METADATA_KEY) setAutoMetadata(readAutoThreadMetadata(window.localStorage)); };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  function autoTitleAction(action: "enabled" | "locked" | "undo", value?: boolean, task?: LiveTask) {
    setActionError("");
    window.parent.postMessage({ type: "taskboard:auto-title", action, value, threadId: task?.threadId, hostId: task?.hostId || "local" }, "*");
  }

  useEffect(() => {
    function receiveHostMessage(event: MessageEvent) {
      if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "taskboard:host-context" && event.data.payload) {
        const next = event.data.payload as LiveHostContext;
        setMeta(current => {
          const updated = bootstrapRemoteHistory(next.taskboard?.tasks || [], current, remoteCutoff) as TaskMetaByThread;
          if (updated === current) return current;
          persistMeta(updated);
          return updated;
        });
        setContext(next);
        setLastSyncAt(Date.now());
        if (next.theme === "light" || next.theme === "dark") {
          document.documentElement.dataset.theme = next.theme;
        }
      }
      if (event.data.type === "taskboard:auto-title-result") {
        setAutoMetadata(readAutoThreadMetadata(window.localStorage));
        if (!event.data.ok) setActionError(String(event.data.error || "操作未完成。"));
      }
      if (event.data.type === "taskboard:action-result" && event.data.payload?.ok === false) {
        setActionError(String(event.data.payload.error || "操作失败，请重试。"));
      }
    }
    window.addEventListener("message", receiveHostMessage);
    window.parent.postMessage({ type: "taskboard:ready" }, "*");
    return () => window.removeEventListener("message", receiveHostMessage);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  function savePosition() {
    saveLiveView(window.localStorage, { query, projectId, projectAutoCompleteHours, visibleCounts, historyOpenBySource, scrollTop: scrollTop.current });
  }
  useEffect(savePosition, [query, projectId, projectAutoCompleteHours, visibleCounts, historyOpenBySource]);
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!snapshot || !board || !restoringScroll.current || view !== "all") return;
    const max = Math.max(0, board.scrollHeight - board.clientHeight);
    board.scrollTop = Math.min(scrollTop.current, max);
    if (max >= scrollTop.current) restoringScroll.current = false;
  }, [snapshot, view, visibleCounts, historyOpenBySource]);
  function changeFilter(nextQuery: string, nextProject: string) {
    restoringScroll.current = false;
    scrollTop.current = 0;
    if (boardRef.current) boardRef.current.scrollTop = 0;
    setQuery(nextQuery); setProjectId(nextProject); setVisibleCounts({});
  }

  useEffect(() => {
    if (!snapshot || bootstrapped.current) return;
    bootstrapped.current = true;
    if (!bootstrapExistingHistory.current) return;
    setMeta((current) => {
      const next = { ...current };
      let changed = false;
      for (const task of snapshot.tasks) {
        if (task.source === "chatgpt" || current[task.taskKey]?.seenAt) continue;
        next[task.taskKey] = { ...current[task.taskKey], seenAt: task.updatedAt, manualPending: false, initialHistory: true };
        changed = true;
      }
      if (changed) persistMeta(next);
      return changed ? next : current;
    });
  }, [snapshot]);

  const tasks = useMemo(() => (snapshot?.tasks ?? []).filter((task) => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return (!projectId || task.projectId === projectId)
      && (!needle || `${task.title} ${task.projectName} ${task.hostName || ""} ${task.workspacePath} ${task.projectWorkspacePath} ${task.progress}`.toLocaleLowerCase("zh-CN").includes(needle));
  }), [projectId, query, snapshot]);

  const presented = useMemo(() => sortLiveTasks(tasks.map((task) => ({
    ...task,
    displayStatus: liveTaskStatus(task, meta[task.taskKey], clock, projectAutoCompleteHours) as DisplayStatus,
  })), meta), [clock, meta, tasks, projectAutoCompleteHours]);

  const grouped = useMemo(() => Object.fromEntries(LIVE_TASK_STATUSES.map((status: DisplayStatus) => [
    status,
    presented.filter((task: LiveTask & { displayStatus: DisplayStatus }) => task.displayStatus === status),
  ])) as Record<DisplayStatus, Array<LiveTask & { displayStatus: DisplayStatus }>>, [presented]);

  const attentionCount = grouped.attention.length + grouped.failed.length;
  const projects = useMemo(() => {
    const values = new Map((context?.projects ?? []).map((project) => [project.id, project.name]));
    for (const task of snapshot?.tasks ?? []) values.set(task.projectId, task.projectName);
    return [...values].sort((left, right) => left[1].localeCompare(right[1], "zh-CN"));
  }, [context?.projects, snapshot]);
  const connected = lastSyncAt > 0 && clock - lastSyncAt < 5_000;
  const canCreateInProject = Boolean(projectId && projectId !== "__unassigned__" && projectId !== "__chatgpt__");

  useEffect(() => {
    window.parent.postMessage({ type: "taskboard:summary", payload: { attentionCount } }, "*");
  }, [attentionCount]);

  function changeMeta(threadId: string, changes: Partial<TaskMeta>) {
    setMeta((current) => {
      const next = { ...current, [threadId]: { ...current[threadId], ...changes } };
      persistMeta(next);
      return next;
    });
  }

  function setTaskStatus(task: LiveTask, pending: boolean) {
    const previous = meta[task.taskKey];
    changeMeta(task.taskKey, {
      seenAt: task.updatedAt,
      seenActivityAt: task.activityAt || task.updatedAt,
      manualPending: pending,
      statusChangedAt: new Date().toISOString(),
      completedAt: pending ? null : new Date().toISOString(),
    });
    setUndo({
      threadId: task.taskKey,
      previous,
      message: pending ? "已移回待处理" : "已确认完成",
    });
  }

  function undoStatusChange() {
    if (!undo) return;
    setMeta((current) => {
      const next = { ...current };
      if (undo.previous) next[undo.threadId] = undo.previous;
      else delete next[undo.threadId];
      persistMeta(next);
      return next;
    });
    setUndo(null);
  }

  function openTask(task: LiveTask & { displayStatus: DisplayStatus }) {
    changeMeta(task.taskKey, { viewedAt: new Date().toISOString(), viewedActivityAt: task.activityAt || task.updatedAt });
    openThread(task.threadId, task.hostId);
  }

  function openThread(threadId: string, hostId = "local") {
    setActionError("");
    window.parent.postMessage({ type: "taskboard:open-thread", payload: { threadId, hostId } }, "*");
  }

  function resolveThreadHost(threadId: string): string | null {
    const normalizedId = normalizeThreadId(threadId);
    const hosts = new Set((snapshot?.tasks ?? [])
      .filter((task) => normalizeThreadId(task.threadId) === normalizedId)
      .map((task) => task.hostId || "local"));
    if (normalizedId === currentThreadId) hosts.add(currentHostId);
    return hosts.size === 1 ? [...hosts][0] : null;
  }

  function chooseView(next: CodexTaskboardView) {
    saveTaskboardView(next);
    setSavedView(next);
  }

  function requestAction(action: "archive" | "new-thread", payload: Record<string, string>) {
    if (!connected) return;
    setActionError("");
    window.parent.postMessage({ type: `taskboard:${action}`, payload }, "*");
  }

  type PresentedTask = LiveTask & { displayStatus: DisplayStatus };
  function resultButton(task: LiveTask, link: { path: string; label: string; exists: boolean }) {
    return <button type="button" key={link.path} disabled={!connected || !link.exists} title={link.path}
      onClick={() => {
        setActionError("");
        window.parent.postMessage({ type: "taskboard:open-result", payload: { threadId: task.threadId, hostId: task.hostId || "local", path: link.path } }, "*");
      }}>{link.exists ? `打开结果 · ${link.label}` : `文件已失效 · ${link.label}`}</button>;
  }
  function renderCard(task: PresentedTask) {
    const isCurrent = normalizeThreadId(task.threadId) === currentThreadId
      && (task.hostId || "local") === currentHostId;
    return (
    <article
      aria-current={isCurrent ? "page" : undefined}
      className={`codex-live-card is-${task.displayStatus} is-${taskReadStatus(task, meta[task.taskKey])}${isCurrent ? " is-current" : ""}`}
      data-current-task={isCurrent ? "true" : undefined}
      data-thread-id={task.threadId}
      data-host-id={task.hostId || "local"}
      key={task.taskKey}
    >
      <button className="codex-live-card-main" type="button" onClick={() => openTask(task)}>
        <span className="codex-live-card-context">
          <span className="codex-live-project" title={task.projectName}>{task.projectName}</span>
          {task.hostName && <span className="codex-live-host" title={task.hostName}>{task.hostName}</span>}
          {isCurrent && <span className="codex-live-current-marker">正在查看</span>}
        </span>
        <strong>{task.title}</strong>
        <span className="codex-live-card-meta">
          <span className={`codex-live-read-marker is-${taskReadStatus(task, meta[task.taskKey])}`}>{taskReadStatus(task, meta[task.taskKey]) === "read" ? "已查看" : "未查看"}</span>
          {task.displayStatus === "attention" && <span className="codex-live-reason">{taskAttentionLabel(task, meta[task.taskKey])}</span>}
          <span className="codex-live-time">{task.runtimeStatus === "unknown" ? "状态待同步" : task.displayStatus === "completed" ? completionKind(meta[task.taskKey], task, clock, projectAutoCompleteHours) === "history" ? "历史记录" : completionKind(meta[task.taskKey], task, clock, projectAutoCompleteHours) === "automatic" ? "已完成" : "已确认完成" : STATUS_LABELS[task.displayStatus]} · {updatedLabel(task.updatedAt)}</span>
        </span>
        <span className="codex-live-progress">{task.waitingReason === "input" ? "有问题等你回答，点击打开对话" : task.progress}</span>
      </button>
      {(task.resultLinks?.length || 0) > 0 && <div className="codex-live-results">
        {task.resultLinks!.length === 1 ? resultButton(task, task.resultLinks![0]) : <details>
          <summary>打开结果 · {task.resultLinks!.length} 个文件</summary>
          {task.resultLinks!.map(link => resultButton(task, link))}
        </details>}
      </div>}
      {task.source !== "chatgpt" && <details className="codex-live-details"><summary>详情</summary>
        <span
          className={`codex-live-workspace${task.workspacePathStatus === "missing" ? " is-missing" : ""}`}
          title={task.workspacePath || undefined}
        >
          {task.workspacePathStatus === "missing"
            ? `执行目录已失效 · ${workspaceLabel(task.workspacePath)}`
            : task.workspacePath
              ? `执行目录 · ${workspaceLabel(task.workspacePath)}`
              : "执行目录待同步"}
        </span>
        {task.projectWorkspacePath && !sameWorkspace(task.workspacePath, task.projectWorkspacePath) && (
          <span
            className={`codex-live-workspace is-project${task.projectWorkspacePathStatus === "missing" ? " is-missing" : ""}`}
            title={task.projectWorkspacePath}
          >
            {task.projectWorkspacePathStatus === "missing"
              ? `当前项目目录已失效 · ${workspaceLabel(task.projectWorkspacePath)}`
              : `当前项目目录 · ${workspaceLabel(task.projectWorkspacePath)}`}
          </span>
        )}
        {(task.hostId || "local") === "local" && <div className="codex-live-title-actions">
          <label><input type="checkbox" checked={autoMetadata.entries[task.threadId]?.locked === true}
            onChange={event => autoTitleAction("locked", event.target.checked, task)} />锁定标题</label>
          {autoMetadata.entries[task.threadId]?.previousTitle && <button type="button" onClick={() => autoTitleAction("undo", undefined, task)}>恢复上个标题</button>}
          {["generation-failed", "unavailable"].includes(autoMetadata.entries[task.threadId]?.status) && <span>自动命名暂未成功，保留原名</span>}
          {autoMetadata.entries[task.threadId]?.status === "write-unknown" && <span>标题更新结果待确认</span>}
        </div>}
      </details>}
      <div className="codex-live-card-actions">
        <button
          type="button"
          aria-label={meta[task.taskKey]?.pinned ? "取消置顶" : "置顶任务"}
          aria-pressed={meta[task.taskKey]?.pinned === true}
          onClick={() => changeMeta(task.taskKey, { pinned: meta[task.taskKey]?.pinned !== true })}
        >★</button>
        <label title="任务优先级">
          <span className="sr-only">任务优先级</span>
          <select
            value={meta[task.taskKey]?.priority ?? "none"}
            onChange={(event) => changeMeta(task.taskKey, { priority: event.target.value as Priority })}
          >
            <option value="none">普通</option>
            <option value="high">高</option>
            <option value="urgent">紧急</option>
          </select>
        </label>
        {task.runtimeStatus !== "running" && !task.waitingReason && (
          <button type="button" onClick={() => setTaskStatus(task, task.displayStatus === "completed")}>
            {task.displayStatus === "completed" ? "移回待处理" : "确认完成"}
          </button>
        )}
        {task.source !== "chatgpt" && <button
          type="button"
          disabled={!connected}
          onClick={() => requestAction("archive", { threadId: task.threadId, hostId: task.hostId || "local" })}
        >归档</button>}
      </div>
    </article>
    );
  }
  function renderGroup(all: PresentedTask[], group: TaskGroup, source: TaskSource, device?: { id: string; label: string }) {
    const key: TaskGroupKey = device ? `project:attention:${encodeURIComponent(device.id)}` : `${source}:${group}`;
    const visibleCount = visibleCounts[key] ?? (device ? DEFAULT_VISIBLE_TASKS : visibleCounts[group]) ?? DEFAULT_VISIBLE_TASKS;
    const visible = visibleLiveTasks(all, visibleCount) as PresentedTask[];
    const remaining = Math.max(0, all.length - visible.length);
    return <div className="codex-live-list" tabIndex={0} role="region" aria-label={`${source === "project" ? "项目任务" : "ChatGPT 聊天"} · ${group === "history" ? "历史记录" : STATUS_LABELS[group]}${device ? ` · ${device.label}` : ""}`}>
      {visible.length ? visible.map(renderCard) : <p className="codex-live-column-empty">{group === "completed" ? "暂无已完成的任务" : "暂无任务"}</p>}
      {remaining > 0 && <button className="codex-live-more" type="button" onClick={() => setVisibleCounts(current => ({ ...current,
        [key]: visibleCount + VISIBLE_TASK_STEP,
      }))}>再显示 {Math.min(VISIBLE_TASK_STEP, remaining)} 个</button>}
      {visibleCount > DEFAULT_VISIBLE_TASKS && <button className="codex-live-more" type="button" onClick={() => setVisibleCounts(current => ({ ...current,
        [key]: DEFAULT_VISIBLE_TASKS,
      }))}>收起</button>}
    </div>;
  }

  function renderAttentionRows(tasks: PresentedTask[]) {
    const devices = new Map<string, string>([["local", "本机"]]);
    for (const task of tasks) {
      const hostId = task.hostId || "local";
      if (hostId !== "local") devices.set(hostId, task.hostName || "远程设备");
    }
    return [...devices].map(([id, label]) => {
      const entries = tasks.filter(task => (task.hostId || "local") === id);
      return <section className="codex-live-device-row" data-device-id={id} key={id} aria-label={label}>
        <header><h4>{label}</h4><span>{entries.length}</span></header>
        {renderGroup(entries, "attention", "project", { id, label })}
      </section>;
    });
  }

  if (!snapshot) {
    return (
      <main ref={boardRef} className="codex-live-board is-loading" aria-busy="true">
        <div className="codex-live-empty"><strong>正在读取任务…</strong><span>请稍候</span></div>
      </main>
    );
  }

  return (
    <main ref={boardRef} className="codex-live-board"
      onWheel={() => { restoringScroll.current = false; }}
      onTouchMove={() => { restoringScroll.current = false; }}
      onKeyDown={(event) => { if (["PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp"].includes(event.key)) restoringScroll.current = false; }}
      onScroll={() => {
        if (restoringScroll.current || view !== "all") return;
        scrollTop.current = boardRef.current?.scrollTop || 0; savePosition();
      }}>
      <header className="codex-live-header">
        <div>
          <span>任务面板</span>
          <h1>{view === "orchestrator"
            ? orchestratorSnapshot === null
              ? "正在读取委托"
              : orchestratorSnapshot.requests === null
                ? "委托未连接"
                : `${orchestratorSnapshot.requests.length} 个委托${orchestratorSnapshot.status === "connected" ? "" : " · 待同步"}`
            : attentionCount > 0 ? `需要处理 ${attentionCount}` : "暂无待处理"}</h1>
        </div>
        <div className="codex-live-header-controls">
          <div className="codex-live-view-tabs" role="tablist" aria-label="任务视图">
            <button type="button" role="tab" aria-selected={view === "orchestrator"} onClick={() => chooseView("orchestrator")}>
              {orchestratorSnapshot && !orchestratorSnapshot.requests
                ? "委托 · 未连接"
                : orchestratorSnapshot?.status !== "connected" && orchestratorSnapshot?.requests
                  ? "委托 · 待同步"
                : orchestratorAttentionCount > 0
                  ? `委托 · ${orchestratorAttentionCount} 待关注`
                  : "委托"}
            </button>
            <button type="button" role="tab" aria-selected={view === "all"} onClick={() => chooseView("all")}>全部任务</button>
          </div>
          {view === "all" && <div className="codex-live-toolbar">
            <label>
              <span className="sr-only">搜索任务</span>
              <input type="search" value={query} onChange={(event) => changeFilter(event.target.value, projectId)} placeholder="搜索任务…" />
            </label>
            <label>
              <span className="sr-only">筛选项目</span>
              <select value={projectId} onChange={(event) => changeFilter(query, event.target.value)}>
                <option value="">全部项目</option>
                {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <button
              type="button"
              disabled={!connected || !canCreateInProject}
              title={canCreateInProject ? "在当前项目中新建任务" : "先选择一个已绑定项目"}
              onClick={() => requestAction("new-thread", { projectId })}
            >
              新建任务
            </button>
          </div>}
        </div>
      </header>

      {view === "all" && !connected && <div className="codex-live-connection" role="status">正在重新连接，当前显示上次同步结果。</div>}
      {view === "all" && snapshot.remoteSync?.map(host => <div className="codex-live-connection" role="status" key={host.hostId || host.hostName}>
        {host.hostName} · {host.phase === "connecting" ? "正在连接远程设备…"
          : host.phase === "disconnected" ? "远程连接已中断，等待连接恢复。"
            : host.phase === "offline" ? "远程设备离线，等待设备上线。"
              : host.phase === "paused" ? "远程设备未开启自动连接。"
                : host.phase === "retrying" || (!host.phase && !host.loading) ? "任务同步未完成，稍后自动重试。"
                  : "正在获取远程任务…"}
        {host.hasSnapshot && " 当前显示上次同步结果。"}
      </div>)}
      {actionError && <div className="codex-live-error" role="alert">{actionError}</div>}
      {view === "all" && undo && <div className="codex-live-undo" role="status"><span>{undo.message}</span><button type="button" onClick={undoStatusChange}>撤销</button></div>}

      {view === "orchestrator" ? (
        <OrchestratorRequestView snapshot={orchestratorSnapshot} resolveThreadHost={resolveThreadHost} onOpenThread={openThread} />
      ) : <div className="codex-live-columns">
        {(["project", "chatgpt"] as const).map(source => {
          const sourceTasks = presented.filter((task: PresentedTask) => (task.source === "chatgpt") === (source === "chatgpt"));
          const historyOpen = historyOpenBySource[source];
          return <section className="codex-live-source" key={source} data-task-source={source} aria-labelledby={`live-source-${source}`}>
            <header><h2 id={`live-source-${source}`}>{source === "chatgpt" ? "ChatGPT 聊天" : "项目任务"}</h2><span>{sourceTasks.length}</span></header>
            {source === "project" && <label className="codex-live-auto-naming">
              <input type="checkbox" checked={autoMetadata.enabled} onChange={event => autoTitleAction("enabled", event.target.checked)} />
              本机对话自动命名
            </label>}
            {source === "project" && <label className="codex-live-auto-complete">
              <span>待处理自动完成</span>
              <select aria-label="项目任务待处理自动完成时长" value={projectAutoCompleteHours}
                onChange={event => setProjectAutoCompleteHours(Number(event.target.value))}>
                <option value={0}>关闭</option>
                <option value={24}>24 小时无新回复</option>
                <option value={48}>48 小时无新回复</option>
                <option value={72}>72 小时无新回复</option>
                <option value={168}>7 天无新回复</option>
              </select>
            </label>}
            <div className="codex-live-source-groups">
              {LIVE_TASK_STATUSES.map((status: DisplayStatus) => {
                const all = sourceTasks.filter((task: PresentedTask) => task.displayStatus === status);
                const confirmed = status === "completed" ? all.filter((task: PresentedTask) => completionKind(meta[task.taskKey], task, clock, projectAutoCompleteHours) !== "history") : all;
                const history = status === "completed" ? all.filter((task: PresentedTask) => completionKind(meta[task.taskKey], task, clock, projectAutoCompleteHours) === "history") : [];
                return <section className={`codex-live-column is-${status}`} key={status} aria-labelledby={`live-column-${source}-${status}`}>
                  <header><span className="codex-live-status-dot" aria-hidden="true" /><h3 id={`live-column-${source}-${status}`}>{STATUS_LABELS[status]}</h3><span>{confirmed.length}</span></header>
                  {source === "project" && status === "attention" ? renderAttentionRows(confirmed) : renderGroup(confirmed, status, source)}
                  {status === "completed" && history.length > 0 && <details className="codex-live-history" open={historyOpen}
                    onToggle={event => { const open = event.currentTarget.open; if (open !== historyOpen) setHistoryOpenBySource(current => ({ ...current, [source]: open })); }}>
                    <summary>历史记录 <span>{history.length}</span></summary>
                    {historyOpen && renderGroup(history, "history", source)}
                  </details>}
                </section>;
              })}
            </div>
          </section>;
        })}
      </div>}
    </main>
  );
}
