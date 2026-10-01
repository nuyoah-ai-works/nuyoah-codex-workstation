const PRIORITY_RANK = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

const FINISHED_STATUSES = new Set(["done", "canceled"]);

export const PROJECT_URGENCY_OPTIONS = ["none", "urgent", "high", "medium", "low"];

export function projectUrgency(tasks, override = null) {
  if (override && PROJECT_URGENCY_OPTIONS.includes(override)) {
    return { value: override, source: "manual" };
  }
  let value = "none";
  for (const task of tasks) {
    if (FINISHED_STATUSES.has(task.status)) continue;
    if ((PRIORITY_RANK[task.priority] ?? 0) > PRIORITY_RANK[value]) value = task.priority;
  }
  return { value, source: value === "none" ? "none" : "issues" };
}

export function projectProgress(tasks) {
  const tracked = tasks.filter((task) => task.status !== "canceled");
  const count = (status) => tracked.filter((task) => task.status === status).length;
  const done = count("done");
  const total = tracked.length;
  return {
    total,
    done,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    inProgress: count("in_progress"),
    inReview: count("in_review"),
    blocked: count("blocked"),
  };
}

export function normalizedWorkspacePath(value) {
  if (typeof value !== "string") return "";
  return value.trim().replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase("zh-CN");
}

export function workspaceMatchesFilter(workspacePath, filterPath) {
  const workspace = normalizedWorkspacePath(workspacePath);
  const filter = normalizedWorkspacePath(filterPath);
  return !filter || workspace === filter || workspace.startsWith(`${filter}/`);
}
