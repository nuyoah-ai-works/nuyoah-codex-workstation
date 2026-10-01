export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "canceled",
];
export const TASK_PRIORITIES = ["none", "urgent", "high", "medium", "low"];
export const ISSUE_TYPES = ["standard", "automation_organization"];

export const DEFAULT_PROJECT_ID = "local";

export function isTaskStatus(value) {
  return TASK_STATUSES.includes(value);
}

export function isTaskPriority(value) {
  return TASK_PRIORITIES.includes(value);
}

export function isIssueType(value) {
  return ISSUE_TYPES.includes(value);
}
