const PRIORITY_RANK = Object.freeze({ urgent: 0, high: 1, none: 2 });

export const LIVE_TASK_STATUSES = Object.freeze([
  "attention",
  "running",
  "failed",
  "completed",
]);

function time(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function chatgptAttentionExpired(task, now = Date.now()) {
  if (task?.source !== "chatgpt") return false;
  const activityAt = Object.hasOwn(task, "activityAt") ? task.activityAt : task.updatedAt;
  const lastActivity = time(activityAt);
  return lastActivity > 0 && now - lastActivity >= 72 * 60 * 60 * 1000;
}

export function liveTaskStatus(task, meta = {}, now = Date.now()) {
  if (task?.source === "chatgpt" && task.runtimeStatus === "running") return "running";
  const attention = chatgptAttentionExpired(task, now) ? "completed" : "attention";
  if (task?.waitingReason === "input" || task?.waitingReason === "approval") return attention;
  if (task?.runtimeStatus === "running") return "running";
  if (meta.manualPending === true) return attention;
  // A file touch or catalog rename is not another execution. Older providers
  // without activity metadata keep their existing timestamp contract.
  const activityAt = task && Object.hasOwn(task, "activityAt") ? task.activityAt : task?.updatedAt;
  // An old import baseline is not a user's acknowledgement of a chat.
  const importedChat = task?.source === "chatgpt" && meta.initialRemoteHistory
    && !meta.completedAt && !meta.statusChangedAt;
  const changed = importedChat || !meta.seenAt || time(activityAt) > time(meta.seenActivityAt || meta.seenAt);
  if (task?.runtimeStatus === "failed") return changed ? "failed" : "completed";
  return changed ? attention : "completed";
}

export function completionKind(meta = {}, task, now = Date.now()) {
  const confirmed = meta.completedAt || (meta.statusChangedAt && !meta.manualPending
    && !meta.initialHistory && !meta.initialRemoteHistory);
  const activityAt = task && Object.hasOwn(task, "activityAt") ? task.activityAt : task?.updatedAt;
  if (task?.runtimeStatus !== "running" && task?.runtimeStatus !== "failed"
    && chatgptAttentionExpired(task, now) && (!confirmed || meta.manualPending
      || time(activityAt) > time(meta.seenActivityAt || meta.seenAt))) return "automatic";
  return confirmed ? "confirmed" : "history";
}

export function taskAttentionLabel(task, meta = {}) {
  if (task?.waitingReason === "input") return "需要补充信息";
  if (task?.waitingReason === "approval") return "等待授权";
  if (meta.manualPending) return "已移回待处理";
  return task?.hasFinalResponse ? "等待验收" : "等待查看";
}

export const LIVE_VIEW_KEY = "taskboard.codex-live-position.v1";
export function normalizeLiveView(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const groups = [...LIVE_TASK_STATUSES, "history"];
  const keys = [...groups, ...["project", "chatgpt"].flatMap(source => groups.map(group => `${source}:${group}`))];
  const visibleCounts = Object.fromEntries(keys.flatMap(key => {
    const count = value.visibleCounts?.[key];
    return Number.isFinite(count) && count >= 5 ? [[key, Math.min(5000, Math.floor(count))]] : [];
  }));
  return {
    query: typeof value.query === "string" ? value.query.slice(0, 500) : "",
    projectId: typeof value.projectId === "string" ? value.projectId.slice(0, 512) : "",
    visibleCounts,
    historyOpen: value.historyOpen === true,
    historyOpenBySource: Object.fromEntries(["project", "chatgpt"].map(source => [source,
      typeof value.historyOpenBySource?.[source] === "boolean" ? value.historyOpenBySource[source] : value.historyOpen === true,
    ])),
    scrollTop: Number.isFinite(value.scrollTop) ? Math.max(0, value.scrollTop) : 0,
  };
}

export function readLiveView(storage) {
  try { return normalizeLiveView(JSON.parse(storage.getItem(LIVE_VIEW_KEY) || "{}")); }
  catch { return normalizeLiveView(); }
}

export function saveLiveView(storage, value) {
  try { storage.setItem(LIVE_VIEW_KEY, JSON.stringify(normalizeLiveView(value))); } catch {}
}

export function sortLiveTasks(tasks, metaByThread = {}) {
  return [...tasks].sort((left, right) => {
    const leftMeta = metaByThread[left.taskKey || left.threadId] || {};
    const rightMeta = metaByThread[right.taskKey || right.threadId] || {};
    return Number(rightMeta.pinned === true) - Number(leftMeta.pinned === true)
      || (PRIORITY_RANK[leftMeta.priority || "none"] ?? PRIORITY_RANK.none)
        - (PRIORITY_RANK[rightMeta.priority || "none"] ?? PRIORITY_RANK.none)
      || Math.max(time(right.updatedAt), time(rightMeta.statusChangedAt))
        - Math.max(time(left.updatedAt), time(leftMeta.statusChangedAt));
  });
}

export function visibleLiveTasks(tasks, visibleCount) {
  const count = Math.max(0, Number.isFinite(visibleCount) ? Math.floor(visibleCount) : 0);
  return [...tasks].slice(0, count);
}

// First import is an inventory of history, not a queue of new work. The first
// local day's boundary is persisted by the view so later runs still surface.
export function bootstrapRemoteHistory(tasks, meta, cutoff) {
  const next = { ...meta };
  let changed = false;
  for (const task of tasks) {
    if (task.source === "chatgpt" || !task.hostId || task.hostId === "local" || task.runtimeStatus === "running") continue;
    const key = task.taskKey || task.threadId;
    if (next[key]?.seenAt || next[key]?.manualPending || next[key]?.completedAt
      || Math.max(time(task.createdAt), time(task.updatedAt)) >= cutoff) continue;
    next[key] = { ...next[key], seenAt: task.updatedAt, manualPending: false, initialRemoteHistory: true };
    changed = true;
  }
  return changed ? next : meta;
}

// The native project page consumes the exact same functions as the React board.
export function liveStateRuntimeSource() {
  return `(() => { ${time.toString()}; ${chatgptAttentionExpired.toString()}; return { liveTaskStatus: ${liveTaskStatus.toString()}, completionKind: ${completionKind.toString()}, taskAttentionLabel: ${taskAttentionLabel.toString()}, bootstrapRemoteHistory: ${bootstrapRemoteHistory.toString()} }; })()`;
}
