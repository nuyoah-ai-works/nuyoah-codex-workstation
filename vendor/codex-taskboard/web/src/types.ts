export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "canceled",
] as const;
export const TASK_PRIORITIES = ["none", "urgent", "high", "medium", "low"] as const;
export const ISSUE_TYPES = ["standard", "automation_organization"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type IssueType = (typeof ISSUE_TYPES)[number];
export type ActorType = "user" | "agent";
export type AssigneeTarget = "current-user" | "codex-agent";
export type IssueRelationType = "parent" | "blocks" | "blocked_by" | "related";

export interface ActorIdentity {
  type: ActorType;
  id: string;
  name: string;
  avatarUrl: string | null;
}

export type DevelopmentContext =
  | { type: "branch"; branch: string }
  | { type: "worktree"; path: string; branch: string | null };

export type Recurrence = {
  interval: number;
  unit: "day" | "week" | "month" | "year";
};

export interface DevelopmentScan {
  workspacePath: string | null;
  contexts: DevelopmentContext[];
}

export interface TaskboardMetadata {
  manageTaskboardSkillPath?: string;
  capabilities?: TaskboardCapabilities;
  mode?: "local" | "cloud";
  realtime?: {
    transport: "poll";
    intervalMs: number;
  };
  localCapabilities?: {
    available: boolean;
  };
}

export interface TaskboardCapabilities {
  localAiChat: boolean;
}

export type AiChatSandbox = "read-only" | "workspace-write" | "danger-full-access";
export type AiChatThreadStatus = "idle" | "running" | "failed";
export type AiChatRunStatus = "running" | "completed" | "failed" | "interrupted";

export interface AiChatModel {
  slug: string;
  displayName: string;
  description: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
  serviceTiers: Array<{ id: string; name: string }>;
}

export interface AiChatSkill {
  id: string;
  label: string;
  description: string;
  path: string;
  scope: "user" | "repo" | "system" | "admin";
}

export interface AiChatAttachmentInput {
  filename: string;
  contentType: string;
  dataBase64: string;
}

export interface AiChatCatalog {
  models: AiChatModel[];
  skills: AiChatSkill[];
  sandboxes: string[];
}

export interface AiChatOrigin {
  projectId: string;
  projectName: string;
  workspacePath: string;
  issueId?: string;
  issueIdentifier?: string;
}

export interface AiChatRun {
  id: string;
  threadId: string;
  status: AiChatRunStatus;
  exitCode?: number | null;
  error?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
}

export interface AiChatThread {
  id: string;
  title: string;
  status: AiChatThreadStatus;
  origin: AiChatOrigin;
  codexThreadId: string | null;
  model: string;
  reasoningEffort: string;
  sandbox: AiChatSandbox;
  createdAt: string;
  updatedAt: string;
  currentRun?: AiChatRun | null;
}

export interface AiChatEvent {
  id: string;
  threadId?: string;
  runId?: string | null;
  type: string;
  role: "user" | "assistant" | "activity" | "error";
  content: string;
  data?: Record<string, unknown> | null;
  createdAt?: string;
}

export interface AiChatThreadSnapshot {
  thread: AiChatThread;
  events: AiChatEvent[];
  runs: AiChatRun[];
}

export interface WorkflowCapabilityOption {
  id: string;
  label: string;
  scope: "user" | "repo" | "system" | "admin";
}

export interface WorkflowMcpServerOption {
  id: string;
  label: string;
  transport: string;
}

export interface WorkflowCapabilities {
  skills: WorkflowCapabilityOption[];
  mcpServers: WorkflowMcpServerOption[];
}

export interface WorkflowOption {
  id: string;
  name: string;
}

export interface WorkflowWorkspaceRecord<T = unknown> {
  projectId: string;
  workspace: T | null;
  version: number;
  updatedAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  workspacePath: string | null;
  issueCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceProject {
  id: string;
  name: string;
  workspacePath: string | null;
}

export interface ProjectProfile {
  projectId: string;
  displayName: string | null;
  codexProjectId: string | null;
  workspacePath: string | null;
  description: string;
  nextPlan: string;
  urgencyOverride: TaskPriority | null;
  updatedAt: string;
}

export interface TaskRelationSummary {
  id: string;
  identifier: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: ActorIdentity;
  archivedAt: string | null;
}

export interface TaskRelations {
  parent: TaskRelationSummary | null;
  subIssues: TaskRelationSummary[];
  blockedBy: TaskRelationSummary[];
  blocks: TaskRelationSummary[];
  related: TaskRelationSummary[];
}

export interface Task {
  id: string;
  identifier: string;
  projectId: string;
  title: string;
  description: string;
  issueType: IssueType;
  status: TaskStatus;
  priority: TaskPriority;
  labels: string[];
  sortOrder: number;
  threadId: string | null;
  creatorType: ActorType;
  creatorId: string;
  creatorName: string;
  creatorAvatarUrl: string | null;
  assignee: ActorIdentity;
  workflowId: string | null;
  sourceProjectId: string | null;
  sourceProjectName: string | null;
  sourceWorkspacePath: string | null;
  projectCategory: string | null;
  classificationBasis: string[];
  developmentContext: DevelopmentContext | null;
  dueDate: string | null;
  recurrence: Recurrence | null;
  archivedAt: string | null;
  relations: TaskRelations;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  authorType: ActorType;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  threadId: string | null;
  attachments: Attachment[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  taskId: string;
  commentId: string | null;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export type OrchestratorVerification = "PASS" | "FAIL" | "PARTIAL" | "UNVERIFIED";

export interface OrchestratorDispatch {
  id: string;
  requestId: string;
  role: "worker" | "verifier";
  model: "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol" | "gpt-6-luna" | "gpt-6-sol" | "gpt-6-astra";
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  threadId: string | null;
  clientThreadId: string | null;
  workspacePath: string | null;
  status: "registered" | "running" | "waiting_user" | "done" | "failed" | "cancelled" | "unknown";
  verification: OrchestratorVerification;
  needsAttention: boolean;
  attemptCount: number;
  summary: string;
  evidence: string;
  relation: {
    parentDispatchId: string | null;
    logicalUnitKey: string | null;
    retryOfDispatchId: string | null;
  } | null;
  ownership: Array<{ objectKey: string; accessMode: "read" | "write"; phase: string }>;
  dependencies: string[];
  runGate: {
    ready: boolean;
    blockedByDependencies: Array<{ dispatchId: string; status: OrchestratorDispatch["status"] }>;
    blockedByOwnership: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestratorRouteDecision {
  id: string;
  requestId: string;
  dispatchId: string | null;
  inputFingerprint: string;
  targetProjectId: string | null;
  ruleMatches: Array<{ id: string; scope: string; version: string; reasonCode: string; selected: boolean }>;
  ruleOutcome: "selected" | "blocked" | "conflict";
  skillMatches: Array<{ id: string; source: string; version: string; reasonCode: string; selected: boolean }>;
  toolMatches: Array<{ id: string; source: string; version: string; reasonCode: string; selected: boolean }>;
  candidateRefs: Array<{
    candidateRef: string;
    candidateFingerprint: string;
    assetVersion: string;
    qualificationStatus: "eligible" | "ineligible" | "unknown";
    boundaryStatus: "applies" | "blocked" | "unknown";
    relationshipStatus: "clear" | "conflict" | "unknown";
    routingEligible: boolean;
  }>;
  eligibleExposure: boolean;
  actualHit: boolean;
  reasonCode: string;
  reasonSummary: string;
  environmentFingerprint: string;
  createdAt: string;
}

export interface OrchestratorCandidateRef {
  id: string;
  requestId: string;
  candidateRef: string;
  candidateFingerprint: string;
  assetVersion: string;
  governanceSourceId: string;
  sourceStatus: "connected" | "stale" | "unavailable";
  candidateStatus: "draft" | "queued" | "evaluating" | "accepted" | "revalidation_required" | "rejected" | "held" | "expired";
  validationStatus: OrchestratorVerification;
  qualificationStatus: "eligible" | "ineligible" | "unknown";
  environmentFingerprint: string;
  promotionDestination: "single_case" | "project_memory" | "project_rule" | "domain_rule_or_skill" | "personal_global_skill" | "unknown";
  canonicalRef: string | null;
  activationMode: "separate" | "write_is_activation";
  localRecordStatus: "not_recorded" | "approved" | "recorded" | "rolled_back";
  enableStatus: "not_enabled" | "enabled" | "suspended" | "rolled_back";
  publishStatus: "not_published" | "published" | "rolled_back";
  valueGateStage: "M0" | "M3" | "M6" | "M12";
  valueGateDecision: "GO" | "PAUSE" | "ROLLBACK" | "RETIRE";
  capacityStatus: "available" | "full" | "unknown";
  routingEligible: boolean;
  gateLocks: { budget: boolean; samplePlan: boolean; pilotCluster: boolean; rollbackSla: boolean; governanceEndpoint: boolean };
  rollback: {
    orchestratorRouteBlockedAt: string | null;
    canonicalSourceRolledBackAt: string | null;
    freshSessionNoLoadVerifiedAt: string | null;
  };
  lastTrustedAt: string | null;
  readErrorCode: string | null;
  summary: string;
  updatedAt: string;
}

export interface OrchestratorEvidenceRef {
  id: string;
  level: "static" | "test" | "runtime" | "gui" | "external" | "publish";
  verification: OrchestratorVerification;
  reference: string;
  summary: string;
  createdAt: string;
}

export interface OrchestratorEvent {
  id: number;
  requestId: string | null;
  dispatchId: string | null;
  type: string;
  summary: string;
  evidence: string;
  createdAt: string;
}

export interface OrchestratorRequest {
  id: string;
  rootSessionId: string | null;
  lineageStatus: "known" | "legacy_unknown";
  goal: string;
  projectId: string | null;
  workspacePath: string | null;
  status: "planning" | "running" | "verifying" | "waiting_user" | "done" | "failed" | "cancelled";
  progress: { completed: number; total: number };
  verification: OrchestratorVerification;
  needsUser: boolean;
  attemptCount: number;
  summary: string;
  evidence: string;
  dispatches: OrchestratorDispatch[];
  sessions: Array<{ sessionId: string; relation: "origin" | "resume"; attachedAt: string }>;
  routeDecisions: OrchestratorRouteDecision[];
  candidateRefs: OrchestratorCandidateRef[];
  evidenceRefs: OrchestratorEvidenceRef[];
  outcomes: Array<{
    id: string;
    dispatchId: string;
    attempt: number;
    status: OrchestratorDispatch["status"];
    verification: OrchestratorVerification;
    summary: string;
    evidenceRefId: string | null;
    createdAt: string;
  }>;
  events?: OrchestratorEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface OrchestratorRequestListResponse {
  status: "connected" | "unconfigured" | "reconnecting" | "unsupported_newer_schema" | "unsupported_older_schema";
  reconnect: boolean;
  snapshotAt: string | null;
  schemaVersion: number | null;
  schemaStatus: "current" | "read_only_degraded" | "unsupported_newer_schema" | "unsupported_older_schema" | "unavailable" | "unconfigured";
  requests: OrchestratorRequest[] | null;
  message?: string;
}

export interface OrchestratorRequestDetailResponse {
  status: "connected" | "unconfigured" | "reconnecting" | "unsupported_newer_schema" | "unsupported_older_schema";
  reconnect: boolean;
  snapshotAt: string | null;
  schemaVersion: number | null;
  schemaStatus: "current" | "read_only_degraded" | "unsupported_newer_schema" | "unsupported_older_schema" | "unavailable" | "unconfigured";
  request: OrchestratorRequest | null;
  message?: string;
}

export interface HostContext {
  user?: ActorIdentity;
  workspacePath?: string;
  threadId?: string;
  theme?: "light" | "dark";
  projectId?: string;
  projects?: Array<{ id: string; name: string; workspacePath?: string }>;
  titlebarLeftInset?: number;
  sidebarCollapsed?: boolean;
}

export interface TaskDraft {
  title: string;
  description: string;
  issueType: IssueType;
  status: TaskStatus;
  priority: TaskPriority;
  labels: string[];
  assigneeTarget?: AssigneeTarget;
  workflowId: string | null;
  developmentContext: DevelopmentContext | null;
  dueDate: string | null;
  recurrence: Recurrence | null;
}

export interface ProjectOrganizationSource {
  id: string;
  name: string;
  workspacePath: string | null;
}

export interface ProjectOrganizationResult {
  sourceCount: number;
  createdCount: number;
  skippedCount: number;
  tasks: Task[];
}

export interface TaskEvent {
  type: string;
  projectId?: string;
  taskId?: string;
  task?: Task;
  comment?: Comment;
  attachment?: Attachment;
  project?: Project;
  at: string;
}
