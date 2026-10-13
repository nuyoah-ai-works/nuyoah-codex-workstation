import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

export const REQUEST_STATUSES = Object.freeze([
  "planning",
  "running",
  "verifying",
  "waiting_user",
  "done",
  "failed",
  "cancelled",
]);
export const DISPATCH_STATUSES = Object.freeze([
  "registered",
  "running",
  "waiting_user",
  "done",
  "failed",
  "cancelled",
  "unknown",
]);
export const VERIFICATION_STATUSES = Object.freeze(["PASS", "FAIL", "PARTIAL", "UNVERIFIED"]);
export const LINEAGE_STATUSES = Object.freeze(["known", "legacy_unknown"]);
export const ROUTE_OUTCOMES = Object.freeze(["selected", "blocked", "conflict"]);
export const GOVERNANCE_SOURCE_STATUSES = Object.freeze(["connected", "stale", "unavailable"]);
export const CANDIDATE_STATUSES = Object.freeze([
  "draft", "queued", "evaluating", "accepted", "revalidation_required", "rejected", "held", "expired",
]);
export const QUALIFICATION_STATUSES = Object.freeze(["eligible", "ineligible", "unknown"]);
export const LOCAL_RECORD_STATUSES = Object.freeze(["not_recorded", "approved", "recorded", "rolled_back"]);
export const ENABLE_STATUSES = Object.freeze(["not_enabled", "enabled", "suspended", "rolled_back"]);
export const PUBLISH_STATUSES = Object.freeze(["not_published", "published", "rolled_back"]);
export const VALUE_GATE_STAGES = Object.freeze(["M0", "M3", "M6", "M12"]);
export const VALUE_GATE_DECISIONS = Object.freeze(["GO", "PAUSE", "ROLLBACK", "RETIRE"]);

const OPEN_REQUEST_STATUSES = new Set(["planning", "running", "verifying", "waiting_user"]);
export const ORCHESTRATOR_SCHEMA_VERSION = 7;
const SCHEMA_VERSION = ORCHESTRATOR_SCHEMA_VERSION;
const READABLE_SCHEMA_VERSIONS = new Set([2, 3, 4, 5, 6, SCHEMA_VERSION]);
const CURRENT_MODEL_EFFORTS = new Map([
  ["gpt-6-luna", new Set(["medium", "high"])],
  ["gpt-6-sol", new Set(["high", "xhigh", "max"])],
  ["gpt-6-astra", new Set(["medium", "high", "xhigh", "max"])],
]);
const LEGACY_MODEL_EFFORTS = new Map([
  ["gpt-5.6-luna", new Set(["low", "medium"])],
  ["gpt-5.6-terra", new Set(["medium", "high"])],
  ["gpt-5.6-sol", new Set(["high", "xhigh", "max"])],
]);
const PERSISTED_MODEL_EFFORTS = new Map([...LEGACY_MODEL_EFFORTS, ...CURRENT_MODEL_EFFORTS]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SENSITIVE_KEY_PATTERN = /(?:^|_)(?:prompt|output|secret|password|cookie|token|authorization|api_?key)(?:$|_)/i;
const SENSITIVE_VALUE_PATTERN = /(?:\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[A-Z0-9]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:token|cookie|password|api[_-]?key)\s*[:=]\s*\S+)/i;
const LONG_FORM_TEXT_PATTERN = /(?:[\u0000-\u001f\u007f\u2028\u2029]|```|~~~|<\|(?:system|user|assistant)\|>|"(?:role|content)"\s*:)/i;
const TRANSCRIPT_PREFIX_PATTERN = /^(?:prompt|output|stdout|stderr|transcript|system|user|assistant)\s*[:：]/i;
const SQLITE_RETRY_BUFFER = new Int32Array(new SharedArrayBuffer(4));

export class LedgerError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
    this.details = details;
  }
}

function now() {
  return new Date().toISOString();
}

function isBusySqliteError(error) {
  return error?.errcode === 5
    || error?.errcode === 6
    || /(?:busy|locked)/i.test(error?.message ?? "");
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LedgerError("INVALID_FIELD", `${label} must be a JSON object`);
  }
  return value;
}

function assertAllowedKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new LedgerError("UNKNOWN_FIELD", `${label} does not accept: ${unknown.join(", ")}`);
  }
}

function scanSensitive(value, trail = "command") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanSensitive(entry, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        throw new LedgerError(
          "SENSITIVE_FIELD",
          `${trail}.${key} is not accepted; store only a short summary or evidence reference`,
        );
      }
      scanSensitive(entry, `${trail}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && SENSITIVE_VALUE_PATTERN.test(value)) {
    throw new LedgerError(
      "SENSITIVE_VALUE",
      `${trail} appears to contain a credential; credentials are never stored in the orchestrator ledger`,
    );
  }
}

function stringValue(value, label, {
  required = false,
  nullable = false,
  maxLength,
  shortSummary = false,
}) {
  if (value === undefined) {
    if (required) throw new LedgerError("INVALID_FIELD", `${label} is required`);
    return undefined;
  }
  if (value === null && nullable && !required) return null;
  if (typeof value !== "string") {
    throw new LedgerError("INVALID_FIELD", `${label} must be a string${nullable ? " or null" : ""}`);
  }
  const result = value.trim();
  if (required && !result) throw new LedgerError("INVALID_FIELD", `${label} cannot be empty`);
  if (result.length > maxLength) {
    throw new LedgerError("INVALID_FIELD", `${label} cannot exceed ${maxLength} characters`);
  }
  if (shortSummary && (LONG_FORM_TEXT_PATTERN.test(result) || TRANSCRIPT_PREFIX_PATTERN.test(result))) {
    throw new LedgerError(
      "LONG_FORM_TEXT_NOT_ALLOWED",
      `${label} accepts only a short single-line summary; prompts, outputs, transcripts, and code fences are not accepted`,
    );
  }
  return result;
}

function optionalId(value, label, { required = false, maxLength = 256 } = {}) {
  const result = stringValue(value, label, { required, nullable: true, maxLength });
  if (result === undefined || result === null) return result;
  if (!ID_PATTERN.test(result)) {
    throw new LedgerError("INVALID_FIELD", `${label} contains unsupported characters`);
  }
  return result;
}

function absolutePath(value, label) {
  const result = stringValue(value, label, { nullable: true, maxLength: 4096 });
  if (result === undefined || result === null) return result;
  if (!result || result.includes("\0") || (!path.isAbsolute(result) && !path.win32.isAbsolute(result))) {
    throw new LedgerError("INVALID_FIELD", `${label} must be an absolute path without null bytes`);
  }
  return result;
}

function enumValue(value, label, allowed, { fallback, nullable = false } = {}) {
  const result = value === undefined ? fallback : value;
  if (result === null && nullable) return null;
  if (!allowed.includes(result)) {
    throw new LedgerError("INVALID_FIELD", `${label} must be one of: ${allowed.join(", ")}`);
  }
  return result;
}

function booleanValue(value, label, fallback) {
  const result = value === undefined ? fallback : value;
  if (typeof result !== "boolean") throw new LedgerError("INVALID_FIELD", `${label} must be a boolean`);
  return result;
}

function integerValue(value, label, { fallback, max = 1_000_000 } = {}) {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < 0 || result > max) {
    throw new LedgerError("INVALID_FIELD", `${label} must be an integer from 0 to ${max}`);
  }
  return result;
}

function timestampValue(value, label, { nullable = true } = {}) {
  const result = stringValue(value, label, { nullable, maxLength: 64 });
  if (result === undefined || result === null) return result;
  if (!Number.isFinite(Date.parse(result))) {
    throw new LedgerError("INVALID_FIELD", `${label} must be an ISO-8601 timestamp`);
  }
  return new Date(result).toISOString();
}

function shortReference(value, label, { required = false, nullable = false, maxLength = 1000 } = {}) {
  return stringValue(value, label, { required, nullable, maxLength, shortSummary: true });
}

function stableObjectKey(value, label) {
  const result = shortReference(value, label, { required: true, maxLength: 500 });
  if (path.isAbsolute(result) || path.win32.isAbsolute(result)) {
    throw new LedgerError("PRIVATE_PATH_NOT_ALLOWED", `${label} must use a stable object alias, not an absolute path`);
  }
  return result;
}

function objectArray(value, label, { allowedKeys, maxEntries = 64 } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxEntries) {
    throw new LedgerError("INVALID_FIELD", `${label} must be an array with at most ${maxEntries} entries`);
  }
  return value.map((entry, index) => {
    const item = assertPlainObject(entry, `${label}[${index}]`);
    assertAllowedKeys(item, allowedKeys, `${label}[${index}]`);
    return item;
  });
}

function validateModel(model, effort, { allowLegacy = false } = {}) {
  const modelEfforts = allowLegacy ? PERSISTED_MODEL_EFFORTS : CURRENT_MODEL_EFFORTS;
  const supportedEfforts = modelEfforts.get(model);
  if (!supportedEfforts) {
    throw new LedgerError(
      "UNSUPPORTED_MODEL",
      `model must be one of: ${[...modelEfforts.keys()].join(", ")}`,
    );
  }
  if (effort === "ultra") {
    throw new LedgerError("ULTRA_NOT_ALLOWED", "worker and verifier dispatches cannot use ultra effort");
  }
  if (!supportedEfforts.has(effort)) {
    throw new LedgerError(
      "UNSUPPORTED_MODEL_EFFORT",
      `${model} supports only: ${[...supportedEfforts].join(", ")}`,
    );
  }
}

function validateProgress(completed, total) {
  if (completed > total) {
    throw new LedgerError("INVALID_PROGRESS", "progressCompleted cannot exceed progressTotal");
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function digestJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalSqlValue(value) {
  if (typeof value === "bigint") return { type: "bigint", value: value.toString() };
  if (value instanceof Uint8Array) return { type: "blob", value: Buffer.from(value).toString("base64") };
  return value;
}

function inspectDatabase(database, { schemaVersion, compatibility }) {
  const integrityRows = database.prepare("PRAGMA integrity_check").all();
  const integrityOk = integrityRows.length === 1 && integrityRows[0].integrity_check === "ok";
  const foreignKeyViolationCount = database.prepare("PRAGMA foreign_key_check").all().length;
  const schemaRows = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
  const tableNames = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
  const tables = {};
  for (const tableName of tableNames) {
    const columns = database.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all()
      .map((column) => column.name);
    const columnSql = columns.map(quoteIdentifier).join(", ");
    const statement = database.prepare(`
      SELECT ${columnSql}
      FROM ${quoteIdentifier(tableName)}
      ORDER BY ${columnSql}
    `);
    const hash = createHash("sha256");
    let rowCount = 0;
    for (const row of statement.iterate()) {
      hash.update(JSON.stringify(columns.map((column) => canonicalSqlValue(row[column]))));
      hash.update("\n");
      rowCount += 1;
    }
    tables[tableName] = { rowCount, digest: hash.digest("hex") };
  }
  return {
    schemaVersion,
    compatibility,
    integrity: integrityOk ? "ok" : "failed",
    foreignKeyViolationCount,
    schemaDigest: digestJson(schemaRows),
    dataDigest: digestJson(tables),
    tables,
  };
}

function requestFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    rootSessionId: row.root_session_id ?? null,
    lineageStatus: row.lineage_status ?? "legacy_unknown",
    goal: row.goal,
    projectId: row.project_id,
    workspacePath: row.workspace_path,
    status: row.status,
    progress: { completed: row.progress_completed, total: row.progress_total },
    verification: row.verification_status,
    needsUser: Boolean(row.needs_user),
    attemptCount: row.attempt_count,
    summary: row.summary,
    evidence: row.evidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dispatchFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id,
    role: row.role,
    model: row.model,
    effort: row.effort,
    threadId: row.thread_id,
    clientThreadId: row.client_thread_id,
    workspacePath: row.workspace_path,
    status: row.status,
    verification: row.verification_status,
    needsAttention: Boolean(row.needs_attention),
    attemptCount: row.attempt_count,
    summary: row.summary,
    evidence: row.evidence,
    relation: null,
    ownership: [],
    dependencies: [],
    runGate: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function routeDecisionFromRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    dispatchId: row.dispatch_id,
    inputFingerprint: row.input_fingerprint,
    targetProjectId: row.target_project_id,
    ruleMatches: JSON.parse(row.rule_matches_json),
    ruleOutcome: row.rule_outcome,
    skillMatches: JSON.parse(row.skill_matches_json),
    toolMatches: JSON.parse(row.tool_matches_json),
    candidateRefs: JSON.parse(row.candidate_refs_json),
    eligibleExposure: Boolean(row.eligible_exposure),
    actualHit: Boolean(row.actual_hit),
    reasonCode: row.reason_code,
    reasonSummary: row.reason_summary,
    environmentFingerprint: row.environment_fingerprint,
    createdAt: row.created_at,
  };
}

function candidateRefFromRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    candidateRef: row.candidate_ref,
    candidateFingerprint: row.candidate_fingerprint,
    assetVersion: row.asset_version,
    governanceSourceId: row.governance_source_id,
    sourceStatus: row.source_status,
    candidateStatus: row.candidate_status,
    validationStatus: row.validation_status,
    qualificationStatus: row.qualification_status,
    environmentFingerprint: row.environment_fingerprint,
    promotionDestination: row.promotion_destination,
    canonicalRef: row.canonical_ref,
    activationMode: row.activation_mode,
    localRecordStatus: row.local_record_status,
    enableStatus: row.enable_status,
    publishStatus: row.publish_status,
    valueGateStage: row.value_gate_stage,
    valueGateDecision: row.value_gate_decision,
    capacityStatus: row.capacity_status,
    routingEligible: Boolean(row.routing_eligible),
    gateLocks: {
      budget: Boolean(row.budget_locked),
      samplePlan: Boolean(row.sample_plan_locked),
      pilotCluster: Boolean(row.pilot_cluster_locked),
      rollbackSla: Boolean(row.rollback_sla_locked),
      governanceEndpoint: Boolean(row.governance_endpoint_locked),
    },
    rollback: {
      orchestratorRouteBlockedAt: row.orchestrator_route_blocked_at,
      canonicalSourceRolledBackAt: row.canonical_source_rolled_back_at,
      freshSessionNoLoadVerifiedAt: row.fresh_session_no_load_verified_at,
    },
    lastTrustedAt: row.last_trusted_at,
    readErrorCode: row.read_error_code,
    summary: row.summary,
    updatedAt: row.updated_at,
  };
}

function evidenceRefFromRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    dispatchId: row.dispatch_id,
    level: row.evidence_level,
    verification: row.verification_status,
    producerDispatchId: row.producer_dispatch_id,
    verifierDispatchId: row.verifier_dispatch_id,
    reference: row.reference,
    contentHash: row.content_hash,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function outcomeFromRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    dispatchId: row.dispatch_id,
    attempt: row.attempt,
    status: row.status,
    verification: row.verification_status,
    summary: row.summary,
    environmentFingerprint: row.environment_fingerprint,
    evidenceRef: row.evidence_ref,
    evidenceRefId: row.evidence_ref_id ?? null,
    createdAt: row.created_at,
  };
}

function eventFromRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    dispatchId: row.dispatch_id,
    type: row.event_type,
    summary: row.summary,
    evidence: row.evidence,
    createdAt: row.created_at,
  };
}

export function parseRequestCreate(value) {
  assertPlainObject(value, "request");
  assertAllowedKeys(value, new Set([
    "goal", "projectId", "workspacePath", "status", "progressCompleted", "progressTotal",
    "rootSessionId", "lineageStatus", "verification", "needsUser", "attemptCount", "summary", "evidence",
  ]), "request");
  const progressCompleted = integerValue(value.progressCompleted, "request.progressCompleted", { fallback: 0 });
  const progressTotal = integerValue(value.progressTotal, "request.progressTotal", { fallback: 0 });
  validateProgress(progressCompleted, progressTotal);
  const rootSessionId = optionalId(value.rootSessionId, "request.rootSessionId", { required: true });
  if (value.lineageStatus !== undefined && value.lineageStatus !== "known") {
    throw new LedgerError("INVALID_FIELD", "new requests always have known lineage");
  }
  const verification = enumValue(value.verification, "request.verification", VERIFICATION_STATUSES, {
    fallback: "UNVERIFIED",
  });
  if (verification === "PASS") {
    throw new LedgerError(
      "INDEPENDENT_EVIDENCE_REQUIRED",
      "a new request cannot start with PASS verification",
    );
  }
  return {
    rootSessionId,
    lineageStatus: "known",
    goal: stringValue(value.goal, "request.goal", { required: true, maxLength: 500, shortSummary: true }),
    projectId: optionalId(value.projectId, "request.projectId", { maxLength: 256 }) ?? null,
    workspacePath: absolutePath(value.workspacePath, "request.workspacePath") ?? null,
    status: enumValue(value.status, "request.status", REQUEST_STATUSES, { fallback: "planning" }),
    progressCompleted,
    progressTotal,
    verification,
    needsUser: booleanValue(value.needsUser, "request.needsUser", false),
    attemptCount: integerValue(value.attemptCount, "request.attemptCount", { fallback: 0 }),
    summary: stringValue(value.summary ?? "", "request.summary", { maxLength: 600, shortSummary: true }),
    evidence: stringValue(value.evidence ?? "", "request.evidence", { maxLength: 1000, shortSummary: true }),
  };
}

export function parseRequestPatch(value) {
  assertPlainObject(value, "patch");
  assertAllowedKeys(value, new Set([
    "goal", "projectId", "workspacePath", "status", "progressCompleted", "progressTotal",
    "rootSessionId", "lineageStatus", "verification", "needsUser", "attemptCount", "summary", "evidence",
  ]), "patch");
  if (Object.keys(value).length === 0) throw new LedgerError("INVALID_FIELD", "patch cannot be empty");
  const patch = {};
  if (value.rootSessionId !== undefined) {
    patch.rootSessionId = optionalId(value.rootSessionId, "patch.rootSessionId");
    if (patch.rootSessionId) patch.lineageStatus = "known";
  }
  if (value.lineageStatus !== undefined && value.rootSessionId === undefined) {
    patch.lineageStatus = enumValue(value.lineageStatus, "patch.lineageStatus", LINEAGE_STATUSES);
  }
  if (value.goal !== undefined) {
    patch.goal = stringValue(value.goal, "patch.goal", { required: true, maxLength: 500, shortSummary: true });
  }
  if (value.projectId !== undefined) patch.projectId = optionalId(value.projectId, "patch.projectId", { maxLength: 256 });
  if (value.workspacePath !== undefined) patch.workspacePath = absolutePath(value.workspacePath, "patch.workspacePath");
  if (value.status !== undefined) patch.status = enumValue(value.status, "patch.status", REQUEST_STATUSES);
  if (value.progressCompleted !== undefined) {
    patch.progressCompleted = integerValue(value.progressCompleted, "patch.progressCompleted");
  }
  if (value.progressTotal !== undefined) patch.progressTotal = integerValue(value.progressTotal, "patch.progressTotal");
  if (value.verification !== undefined) {
    patch.verification = enumValue(value.verification, "patch.verification", VERIFICATION_STATUSES);
  }
  if (value.needsUser !== undefined) patch.needsUser = booleanValue(value.needsUser, "patch.needsUser");
  if (value.attemptCount !== undefined) patch.attemptCount = integerValue(value.attemptCount, "patch.attemptCount");
  if (value.summary !== undefined) {
    patch.summary = stringValue(value.summary, "patch.summary", { maxLength: 600, shortSummary: true });
  }
  if (value.evidence !== undefined) {
    patch.evidence = stringValue(value.evidence, "patch.evidence", { maxLength: 1000, shortSummary: true });
  }
  return patch;
}

export function parseDispatchCreate(value, { allowLegacy = false } = {}) {
  assertPlainObject(value, "dispatch");
  assertAllowedKeys(value, new Set([
    "role", "model", "effort", "threadId", "clientThreadId", "workspacePath", "status",
    "verification", "needsAttention", "attemptCount", "summary", "evidence",
    "logicalUnitKey", "parentDispatchId", "retryOfDispatchId", "dependencies", "ownership",
  ]), "dispatch");
  const model = stringValue(value.model, "dispatch.model", { required: true, maxLength: 64 });
  const effort = stringValue(value.effort, "dispatch.effort", { required: true, maxLength: 16 });
  validateModel(model, effort, { allowLegacy });
  const threadId = optionalId(value.threadId, "dispatch.threadId") ?? null;
  const clientThreadId = optionalId(value.clientThreadId, "dispatch.clientThreadId") ?? null;
  if (!threadId && !clientThreadId) {
    throw new LedgerError(
      "REAL_ID_REQUIRED",
      "dispatch.register requires the real threadId or clientThreadId returned when the worker was created",
    );
  }
  if (value.dependencies !== undefined && (!Array.isArray(value.dependencies) || value.dependencies.length > 64)) {
    throw new LedgerError("INVALID_FIELD", "dispatch.dependencies must be an array with at most 64 entries");
  }
  return {
    role: enumValue(value.role, "dispatch.role", ["worker", "verifier"]),
    model,
    effort,
    threadId,
    clientThreadId,
    workspacePath: absolutePath(value.workspacePath, "dispatch.workspacePath") ?? null,
    status: enumValue(value.status, "dispatch.status", DISPATCH_STATUSES, { fallback: "registered" }),
    verification: enumValue(value.verification, "dispatch.verification", VERIFICATION_STATUSES, {
      fallback: "UNVERIFIED",
    }),
    needsAttention: booleanValue(value.needsAttention, "dispatch.needsAttention", false),
    attemptCount: integerValue(value.attemptCount, "dispatch.attemptCount", { fallback: 1 }),
    summary: stringValue(value.summary ?? "", "dispatch.summary", { maxLength: 600, shortSummary: true }),
    evidence: stringValue(value.evidence ?? "", "dispatch.evidence", { maxLength: 1000, shortSummary: true }),
    logicalUnitKey: optionalId(value.logicalUnitKey, "dispatch.logicalUnitKey", { maxLength: 160 }) ?? null,
    parentDispatchId: optionalId(value.parentDispatchId, "dispatch.parentDispatchId") ?? null,
    retryOfDispatchId: optionalId(value.retryOfDispatchId, "dispatch.retryOfDispatchId") ?? null,
    dependencies: (value.dependencies ?? []).map((entry, index) => optionalId(
      entry,
      `dispatch.dependencies[${index}]`,
      { required: true },
    )),
    ownership: objectArray(value.ownership, "dispatch.ownership", {
      allowedKeys: new Set(["objectKey", "accessMode", "phase"]),
      maxEntries: 64,
    }).map((entry, index) => ({
      objectKey: stableObjectKey(entry.objectKey, `dispatch.ownership[${index}].objectKey`),
      accessMode: enumValue(entry.accessMode, `dispatch.ownership[${index}].accessMode`, ["read", "write"]),
      phase: optionalId(entry.phase, `dispatch.ownership[${index}].phase`, { required: true, maxLength: 80 }),
    })),
  };
}

export function parseDispatchPatch(value, existing) {
  assertPlainObject(value, "patch");
  assertAllowedKeys(value, new Set([
    "model", "effort", "threadId", "clientThreadId", "workspacePath", "status", "verification",
    "needsAttention", "attemptCount", "summary", "evidence",
  ]), "patch");
  if (Object.keys(value).length === 0) throw new LedgerError("INVALID_FIELD", "patch cannot be empty");
  const patch = {};
  if (value.model !== undefined) patch.model = stringValue(value.model, "patch.model", { required: true, maxLength: 64 });
  if (value.effort !== undefined) patch.effort = stringValue(value.effort, "patch.effort", { required: true, maxLength: 16 });
  const nextModel = patch.model ?? existing.model;
  const nextEffort = patch.effort ?? existing.effort;
  if (LEGACY_MODEL_EFFORTS.has(existing.model)) {
    if (nextModel !== existing.model || nextEffort !== existing.effort) {
      throw new LedgerError(
        "LEGACY_MODEL_IMMUTABLE",
        "legacy dispatch model and effort are immutable; only status and evidence fields may be updated",
      );
    }
    validateModel(nextModel, nextEffort, { allowLegacy: true });
  } else {
    validateModel(nextModel, nextEffort);
  }
  if (value.threadId !== undefined) patch.threadId = optionalId(value.threadId, "patch.threadId");
  if (value.clientThreadId !== undefined) patch.clientThreadId = optionalId(value.clientThreadId, "patch.clientThreadId");
  if (value.workspacePath !== undefined) patch.workspacePath = absolutePath(value.workspacePath, "patch.workspacePath");
  if (value.status !== undefined) patch.status = enumValue(value.status, "patch.status", DISPATCH_STATUSES);
  if (value.verification !== undefined) {
    patch.verification = enumValue(value.verification, "patch.verification", VERIFICATION_STATUSES);
  }
  if (value.needsAttention !== undefined) {
    patch.needsAttention = booleanValue(value.needsAttention, "patch.needsAttention");
  }
  if (value.attemptCount !== undefined) patch.attemptCount = integerValue(value.attemptCount, "patch.attemptCount");
  if (value.summary !== undefined) {
    patch.summary = stringValue(value.summary, "patch.summary", { maxLength: 600, shortSummary: true });
  }
  if (value.evidence !== undefined) {
    patch.evidence = stringValue(value.evidence, "patch.evidence", { maxLength: 1000, shortSummary: true });
  }
  return patch;
}

export function parseDispatchResume(value) {
  assertPlainObject(value, "resume");
  assertAllowedKeys(value, new Set(["summary", "evidence"]), "resume");
  return {
    summary: stringValue(value.summary ?? "Dispatch resumed", "resume.summary", {
      maxLength: 550,
      shortSummary: true,
    }),
    evidence: stringValue(value.evidence ?? "", "resume.evidence", {
      maxLength: 900,
      shortSummary: true,
    }),
  };
}

function parseIdempotencyKey(value) {
  return optionalId(value, "idempotencyKey", { required: true, maxLength: 160 });
}

function parseSessionAttach(value) {
  assertPlainObject(value, "session");
  assertAllowedKeys(value, new Set(["sessionId", "relation"]), "session");
  return {
    sessionId: optionalId(value.sessionId, "session.sessionId", { required: true }),
    relation: enumValue(value.relation, "session.relation", ["origin", "resume"]),
  };
}

function parseRouteDecision(value) {
  assertPlainObject(value, "route");
  assertAllowedKeys(value, new Set([
    "dispatchId", "inputFingerprint", "targetProjectId", "ruleMatches", "ruleOutcome",
    "skillMatches", "toolMatches", "candidateRefs", "eligibleExposure", "actualHit",
    "reasonCode", "reasonSummary", "environmentFingerprint",
  ]), "route");
  const matchKeys = new Set(["id", "scope", "version", "contentHash", "priority", "reasonCode", "selected"]);
  const capabilityKeys = new Set(["id", "source", "version", "reasonCode", "selected"]);
  const candidateKeys = new Set([
    "candidateRef", "candidateFingerprint", "assetVersion", "qualificationStatus",
    "boundaryStatus", "relationshipStatus", "routingEligible",
  ]);
  const normalizeMatch = (entry, index, label, capability = false) => ({
    id: optionalId(entry.id, `${label}[${index}].id`, { required: true }),
    ...(capability
      ? { source: shortReference(entry.source ?? "", `${label}[${index}].source`, { maxLength: 300 }) }
      : {
          scope: shortReference(entry.scope ?? "", `${label}[${index}].scope`, { maxLength: 300 }),
          priority: integerValue(entry.priority, `${label}[${index}].priority`, { fallback: 0, max: 10_000 }),
        }),
    version: shortReference(entry.version ?? "", `${label}[${index}].version`, { maxLength: 160 }),
    ...(capability ? {} : {
      contentHash: optionalId(entry.contentHash, `${label}[${index}].contentHash`, { maxLength: 160 }) ?? null,
    }),
    reasonCode: optionalId(entry.reasonCode, `${label}[${index}].reasonCode`, { required: true, maxLength: 80 }),
    selected: booleanValue(entry.selected, `${label}[${index}].selected`, false),
  });
  const ruleMatches = objectArray(value.ruleMatches, "route.ruleMatches", {
    allowedKeys: matchKeys,
  }).map((entry, index) => normalizeMatch(entry, index, "route.ruleMatches"));
  const skillMatches = objectArray(value.skillMatches, "route.skillMatches", {
    allowedKeys: capabilityKeys,
  }).map((entry, index) => normalizeMatch(entry, index, "route.skillMatches", true));
  const toolMatches = objectArray(value.toolMatches, "route.toolMatches", {
    allowedKeys: capabilityKeys,
  }).map((entry, index) => normalizeMatch(entry, index, "route.toolMatches", true));
  const candidateRefs = objectArray(value.candidateRefs, "route.candidateRefs", {
    allowedKeys: candidateKeys,
  }).map((entry, index) => ({
    candidateRef: shortReference(entry.candidateRef, `route.candidateRefs[${index}].candidateRef`, {
      required: true,
      maxLength: 1000,
    }),
    candidateFingerprint: optionalId(
      entry.candidateFingerprint,
      `route.candidateRefs[${index}].candidateFingerprint`,
      { required: true, maxLength: 160 },
    ),
    assetVersion: shortReference(entry.assetVersion, `route.candidateRefs[${index}].assetVersion`, {
      required: true,
      maxLength: 160,
    }),
    qualificationStatus: enumValue(
      entry.qualificationStatus,
      `route.candidateRefs[${index}].qualificationStatus`,
      QUALIFICATION_STATUSES,
    ),
    boundaryStatus: enumValue(
      entry.boundaryStatus,
      `route.candidateRefs[${index}].boundaryStatus`,
      ["applies", "blocked", "unknown"],
    ),
    relationshipStatus: enumValue(
      entry.relationshipStatus,
      `route.candidateRefs[${index}].relationshipStatus`,
      ["clear", "conflict", "unknown"],
    ),
    routingEligible: booleanValue(entry.routingEligible, `route.candidateRefs[${index}].routingEligible`, false),
  }));
  return {
    dispatchId: optionalId(value.dispatchId, "route.dispatchId") ?? null,
    inputFingerprint: optionalId(value.inputFingerprint, "route.inputFingerprint", {
      required: true,
      maxLength: 160,
    }),
    targetProjectId: optionalId(value.targetProjectId, "route.targetProjectId", { maxLength: 256 }) ?? null,
    ruleMatches,
    ruleOutcome: enumValue(value.ruleOutcome, "route.ruleOutcome", ROUTE_OUTCOMES),
    skillMatches,
    toolMatches,
    candidateRefs,
    eligibleExposure: booleanValue(value.eligibleExposure, "route.eligibleExposure", false),
    actualHit: booleanValue(value.actualHit, "route.actualHit", false),
    reasonCode: optionalId(value.reasonCode, "route.reasonCode", { required: true, maxLength: 80 }),
    reasonSummary: shortReference(value.reasonSummary, "route.reasonSummary", { required: true, maxLength: 400 }),
    environmentFingerprint: optionalId(value.environmentFingerprint, "route.environmentFingerprint", {
      required: true,
      maxLength: 160,
    }),
  };
}

function parseCandidateReference(value) {
  assertPlainObject(value, "candidate");
  assertAllowedKeys(value, new Set([
    "candidateRef", "candidateFingerprint", "assetVersion", "governanceSourceId", "sourceStatus", "candidateStatus",
    "validationStatus", "qualificationStatus", "environmentFingerprint", "promotionDestination",
    "canonicalRef", "activationMode", "localRecordStatus", "enableStatus", "publishStatus",
    "valueGateStage", "valueGateDecision", "routingEligible", "budgetLocked", "samplePlanLocked",
    "pilotClusterLocked", "rollbackSlaLocked", "governanceEndpointLocked", "capacityStatus", "orchestratorRouteBlockedAt",
    "canonicalSourceRolledBackAt", "freshSessionNoLoadVerifiedAt", "lastTrustedAt", "readErrorCode", "summary",
  ]), "candidate");
  const gateLocks = {
    budgetLocked: booleanValue(value.budgetLocked, "candidate.budgetLocked", false),
    samplePlanLocked: booleanValue(value.samplePlanLocked, "candidate.samplePlanLocked", false),
    pilotClusterLocked: booleanValue(value.pilotClusterLocked, "candidate.pilotClusterLocked", false),
    rollbackSlaLocked: booleanValue(value.rollbackSlaLocked, "candidate.rollbackSlaLocked", false),
    governanceEndpointLocked: booleanValue(value.governanceEndpointLocked, "candidate.governanceEndpointLocked", false),
  };
  const sourceStatus = enumValue(value.sourceStatus, "candidate.sourceStatus", GOVERNANCE_SOURCE_STATUSES);
  const candidateStatus = enumValue(value.candidateStatus, "candidate.candidateStatus", CANDIDATE_STATUSES);
  const validationStatus = enumValue(
    value.validationStatus,
    "candidate.validationStatus",
    VERIFICATION_STATUSES,
    { fallback: "UNVERIFIED" },
  );
  const qualificationStatus = enumValue(
    value.qualificationStatus,
    "candidate.qualificationStatus",
    QUALIFICATION_STATUSES,
    { fallback: "unknown" },
  );
  const requestedDecision = enumValue(
    value.valueGateDecision,
    "candidate.valueGateDecision",
    VALUE_GATE_DECISIONS,
    { fallback: "PAUSE" },
  );
  const capacityStatus = enumValue(
    value.capacityStatus,
    "candidate.capacityStatus",
    ["available", "full", "unknown"],
    { fallback: "unknown" },
  );
  const m0Ready = Object.values(gateLocks).every(Boolean);
  const valueGateDecision = requestedDecision === "GO" && (!m0Ready || capacityStatus !== "available")
    ? "PAUSE"
    : requestedDecision;
  const localRecordStatus = enumValue(
    value.localRecordStatus,
    "candidate.localRecordStatus",
    LOCAL_RECORD_STATUSES,
    { fallback: "not_recorded" },
  );
  const enableStatus = enumValue(value.enableStatus, "candidate.enableStatus", ENABLE_STATUSES, {
    fallback: "not_enabled",
  });
  const publishStatus = enumValue(value.publishStatus, "candidate.publishStatus", PUBLISH_STATUSES, {
    fallback: "not_published",
  });
  const orchestratorRouteBlockedAt = timestampValue(
    value.orchestratorRouteBlockedAt,
    "candidate.orchestratorRouteBlockedAt",
  ) ?? null;
  const canonicalSourceRolledBackAt = timestampValue(
    value.canonicalSourceRolledBackAt,
    "candidate.canonicalSourceRolledBackAt",
  ) ?? null;
  const freshSessionNoLoadVerifiedAt = timestampValue(
    value.freshSessionNoLoadVerifiedAt,
    "candidate.freshSessionNoLoadVerifiedAt",
  ) ?? null;
  if (canonicalSourceRolledBackAt && !orchestratorRouteBlockedAt) {
    throw new LedgerError(
      "ROLLBACK_SEQUENCE_INVALID",
      "canonical source rollback cannot be recorded before orchestrator route blocking",
    );
  }
  if (freshSessionNoLoadVerifiedAt && !canonicalSourceRolledBackAt) {
    throw new LedgerError(
      "ROLLBACK_SEQUENCE_INVALID",
      "fresh-session no-load verification requires a recorded canonical source rollback",
    );
  }
  const activationMode = enumValue(
    value.activationMode,
    "candidate.activationMode",
    ["separate", "write_is_activation"],
    { fallback: "separate" },
  );
  if (value.routingEligible !== undefined) {
    booleanValue(value.routingEligible, "candidate.routingEligible", false);
  }
  const canonicalRef = shortReference(value.canonicalRef, "candidate.canonicalRef", {
    nullable: true,
    maxLength: 1000,
  }) ?? null;
  const computedEligible = sourceStatus === "connected"
    && candidateStatus === "accepted"
    && validationStatus === "PASS"
    && qualificationStatus === "eligible"
    && Boolean(canonicalRef)
    && localRecordStatus === "recorded"
    && valueGateDecision === "GO"
    && capacityStatus === "available"
    && m0Ready
    && enableStatus === "enabled"
    && !orchestratorRouteBlockedAt;
  const readErrorCode = optionalId(value.readErrorCode, "candidate.readErrorCode", { maxLength: 80 }) ?? null;
  if (sourceStatus === "unavailable" && !readErrorCode) {
    throw new LedgerError("GOVERNANCE_READ_STATE_INVALID", "unavailable governance source requires readErrorCode");
  }
  return {
    candidateRef: shortReference(value.candidateRef, "candidate.candidateRef", { required: true, maxLength: 1000 }),
    candidateFingerprint: optionalId(value.candidateFingerprint, "candidate.candidateFingerprint", {
      required: true,
      maxLength: 160,
    }),
    assetVersion: shortReference(value.assetVersion, "candidate.assetVersion", { required: true, maxLength: 160 }),
    governanceSourceId: optionalId(value.governanceSourceId, "candidate.governanceSourceId", {
      required: true,
      maxLength: 160,
    }),
    sourceStatus,
    candidateStatus,
    validationStatus,
    qualificationStatus,
    environmentFingerprint: optionalId(value.environmentFingerprint, "candidate.environmentFingerprint", {
      required: true,
      maxLength: 160,
    }),
    promotionDestination: enumValue(
      value.promotionDestination,
      "candidate.promotionDestination",
      ["single_case", "project_memory", "project_rule", "domain_rule_or_skill", "personal_global_skill", "unknown"],
      { fallback: "unknown" },
    ),
    canonicalRef,
    activationMode,
    localRecordStatus,
    enableStatus,
    publishStatus,
    valueGateStage: enumValue(value.valueGateStage, "candidate.valueGateStage", VALUE_GATE_STAGES, {
      fallback: "M0",
    }),
    valueGateDecision,
    capacityStatus,
    routingEligible: computedEligible,
    ...gateLocks,
    orchestratorRouteBlockedAt,
    canonicalSourceRolledBackAt,
    freshSessionNoLoadVerifiedAt,
    lastTrustedAt: timestampValue(value.lastTrustedAt, "candidate.lastTrustedAt") ?? null,
    readErrorCode,
    summary: shortReference(value.summary ?? "", "candidate.summary", { maxLength: 400 }),
  };
}

function parseEvidenceReference(value) {
  assertPlainObject(value, "evidenceRef");
  assertAllowedKeys(value, new Set([
    "dispatchId", "level", "verification", "producerDispatchId", "verifierDispatchId",
    "reference", "contentHash", "summary",
  ]), "evidenceRef");
  const producerDispatchId = optionalId(value.producerDispatchId, "evidenceRef.producerDispatchId") ?? null;
  const verifierDispatchId = optionalId(value.verifierDispatchId, "evidenceRef.verifierDispatchId") ?? null;
  const verification = enumValue(value.verification, "evidenceRef.verification", VERIFICATION_STATUSES, {
    fallback: "UNVERIFIED",
  });
  const dispatchId = optionalId(value.dispatchId, "evidenceRef.dispatchId") ?? null;
  if (verification === "PASS" && (
    !producerDispatchId
    || !verifierDispatchId
    || verifierDispatchId === producerDispatchId
    || dispatchId !== verifierDispatchId
  )) {
    throw new LedgerError(
      "INDEPENDENT_VERIFIER_REQUIRED",
      "PASS evidence must be attached to a verifier dispatch different from the producing dispatch",
    );
  }
  return {
    dispatchId,
    level: enumValue(value.level, "evidenceRef.level", [
      "static", "test", "runtime", "gui", "external", "publish",
    ]),
    verification,
    producerDispatchId,
    verifierDispatchId,
    reference: shortReference(value.reference, "evidenceRef.reference", { required: true, maxLength: 1000 }),
    contentHash: optionalId(value.contentHash, "evidenceRef.contentHash", { maxLength: 160 }) ?? null,
    summary: shortReference(value.summary ?? "", "evidenceRef.summary", { maxLength: 400 }),
  };
}

function parseOutcome(value) {
  assertPlainObject(value, "outcome");
  assertAllowedKeys(value, new Set([
    "dispatchId", "attempt", "status", "verification", "summary", "environmentFingerprint", "evidenceRef",
    "evidenceRefId",
  ]), "outcome");
  return {
    dispatchId: optionalId(value.dispatchId, "outcome.dispatchId", { required: true }),
    attempt: integerValue(value.attempt, "outcome.attempt", { fallback: 1, max: 1000 }),
    status: enumValue(value.status, "outcome.status", DISPATCH_STATUSES),
    verification: enumValue(value.verification, "outcome.verification", VERIFICATION_STATUSES, {
      fallback: "UNVERIFIED",
    }),
    summary: shortReference(value.summary, "outcome.summary", { required: true, maxLength: 600 }),
    environmentFingerprint: optionalId(value.environmentFingerprint, "outcome.environmentFingerprint", {
      required: true,
      maxLength: 160,
    }),
    evidenceRef: shortReference(value.evidenceRef, "outcome.evidenceRef", { nullable: true, maxLength: 1000 }) ?? null,
    evidenceRefId: optionalId(value.evidenceRefId, "outcome.evidenceRefId") ?? null,
  };
}

function parseOwnershipCheck(value) {
  assertPlainObject(value, "ownershipCheck");
  assertAllowedKeys(value, new Set(["dependencies", "ownership"]), "ownershipCheck");
  if (value.dependencies !== undefined && (!Array.isArray(value.dependencies) || value.dependencies.length > 64)) {
    throw new LedgerError("INVALID_FIELD", "ownershipCheck.dependencies must be an array with at most 64 entries");
  }
  return {
    dependencies: (value.dependencies ?? []).map((entry, index) => optionalId(
      entry,
      `ownershipCheck.dependencies[${index}]`,
      { required: true },
    )),
    ownership: objectArray(value.ownership, "ownershipCheck.ownership", {
      allowedKeys: new Set(["objectKey", "accessMode", "phase"]),
      maxEntries: 64,
    }).map((entry, index) => ({
      objectKey: stableObjectKey(entry.objectKey, `ownershipCheck.ownership[${index}].objectKey`),
      accessMode: enumValue(
        entry.accessMode,
        `ownershipCheck.ownership[${index}].accessMode`,
        ["read", "write"],
      ),
      phase: optionalId(entry.phase, `ownershipCheck.ownership[${index}].phase`, {
        required: true,
        maxLength: 80,
      }),
    })),
  };
}

export class OrchestratorLedger {
  constructor(filename, { readOnly = false, migrate = false, allowUnsupportedSchema = false } = {}) {
    if (typeof filename !== "string" || !filename.trim()) {
      throw new LedgerError("DB_PATH_REQUIRED", "NUYOAH_ORCHESTRATOR_DB must name the ledger database");
    }
    const resolved = path.resolve(filename);
    if (!readOnly && !migrate && !existsSync(resolved)) {
      throw new LedgerError(
        "MIGRATION_REQUIRED",
        "the orchestrator ledger is not initialized; run the explicit migrate command first",
      );
    }
    if (!readOnly && migrate) mkdirSync(path.dirname(resolved), { recursive: true });
    this.filename = resolved;
    this.readOnly = readOnly;
    try {
      // SQLite read-only protects the main database and business state, but a live WAL reader may
      // maintain the sibling -wal/-shm files to see uncheckpointed commits. Do not use immutable=1
      // here: it would make the live ledger look stale whenever the WAL has pending frames.
      this.database = new DatabaseSync(resolved, { readOnly });
      this.database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      if (readOnly) this.#assertSchema({ allowUnsupportedSchema });
      else if (migrate) this.#migrate();
      else this.#assertWritableSchema();
    } catch (error) {
      try { this.database?.close(); } catch {}
      if (error instanceof LedgerError) throw error;
      throw new LedgerError(
        readOnly ? "DB_READ_FAILED" : migrate ? "MIGRATION_FAILED" : "DB_OPEN_FAILED",
        readOnly
          ? "The orchestrator ledger could not be opened read-only"
          : migrate
            ? "The orchestrator ledger migration failed and was rolled back; inspect the backup copy before retrying"
            : "The orchestrator ledger could not be opened; check that NUYOAH_ORCHESTRATOR_DB names a writable SQLite file",
      );
    }
  }

  #assertSchema({ allowUnsupportedSchema = false } = {}) {
    const version = this.database.prepare("PRAGMA user_version").get().user_version;
    this.schemaVersion = version;
    this.schemaCompatibility = version === SCHEMA_VERSION
      ? "current"
      : version > SCHEMA_VERSION
        ? "unsupported_newer_schema"
        : READABLE_SCHEMA_VERSIONS.has(version)
          ? "read_only_degraded"
          : "unsupported_older_schema";
    if (!READABLE_SCHEMA_VERSIONS.has(version) && !allowUnsupportedSchema) {
      throw new LedgerError(
        version > SCHEMA_VERSION ? "SCHEMA_TOO_NEW" : "SCHEMA_NOT_READY",
        `orchestrator ledger schema version ${version} is not supported`,
      );
    }
  }

  #assertWritableSchema() {
    this.#assertSchema({ allowUnsupportedSchema: true });
    if (this.schemaVersion !== SCHEMA_VERSION) {
      throw new LedgerError(
        this.schemaVersion > SCHEMA_VERSION ? "SCHEMA_TOO_NEW" : "MIGRATION_REQUIRED",
        this.schemaVersion > SCHEMA_VERSION
          ? `orchestrator ledger schema version ${this.schemaVersion} is newer than supported version ${SCHEMA_VERSION}`
          : `orchestrator ledger schema version ${this.schemaVersion} requires the explicit migrate command`,
      );
    }
  }

  #migrate() {
    const version = this.database.prepare("PRAGMA user_version").get().user_version;
    if (version > SCHEMA_VERSION) {
      throw new LedgerError(
        "SCHEMA_TOO_NEW",
        `orchestrator ledger schema version ${version} is newer than supported version ${SCHEMA_VERSION}`,
      );
    }
    const foreignKeysEnabled = Boolean(this.database.prepare("PRAGMA foreign_keys").get().foreign_keys);
    if (foreignKeysEnabled) this.database.exec("PRAGMA foreign_keys = OFF;");
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      if (version === 0) {
        this.database.exec(`
        CREATE TABLE requests (
          id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          goal TEXT NOT NULL CHECK (length(goal) BETWEEN 1 AND 500),
          project_id TEXT,
          workspace_path TEXT,
          status TEXT NOT NULL CHECK (status IN (
            'planning', 'running', 'verifying', 'waiting_user', 'done', 'failed', 'cancelled'
          )),
          progress_completed INTEGER NOT NULL DEFAULT 0 CHECK (progress_completed >= 0),
          progress_total INTEGER NOT NULL DEFAULT 0 CHECK (progress_total >= 0),
          verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN (
            'PASS', 'FAIL', 'PARTIAL', 'UNVERIFIED'
          )),
          needs_user INTEGER NOT NULL DEFAULT 0 CHECK (needs_user IN (0, 1)),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 600),
          evidence TEXT NOT NULL DEFAULT '' CHECK (length(evidence) <= 1000),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE dispatches (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
          idempotency_key TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL CHECK (role IN ('worker', 'verifier')),
          model TEXT NOT NULL CHECK (model IN ('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol')),
          effort TEXT NOT NULL CHECK (effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
          thread_id TEXT,
          client_thread_id TEXT,
          workspace_path TEXT,
          status TEXT NOT NULL CHECK (status IN (
            'registered', 'running', 'waiting_user', 'done', 'failed', 'cancelled', 'unknown'
          )),
          verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN (
            'PASS', 'FAIL', 'PARTIAL', 'UNVERIFIED'
          )),
          needs_attention INTEGER NOT NULL DEFAULT 0 CHECK (needs_attention IN (0, 1)),
          attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 0),
          summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 600),
          evidence TEXT NOT NULL DEFAULT '' CHECK (length(evidence) <= 1000),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (thread_id IS NOT NULL OR client_thread_id IS NOT NULL)
        );

        CREATE UNIQUE INDEX dispatches_thread_id_unique
          ON dispatches(thread_id) WHERE thread_id IS NOT NULL;
        CREATE UNIQUE INDEX dispatches_client_thread_id_unique
          ON dispatches(client_thread_id) WHERE client_thread_id IS NOT NULL;
        CREATE INDEX dispatches_request_updated ON dispatches(request_id, updated_at DESC);

        CREATE TABLE events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          idempotency_key TEXT NOT NULL UNIQUE,
          request_id TEXT REFERENCES requests(id) ON DELETE CASCADE,
          dispatch_id TEXT REFERENCES dispatches(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 600),
          evidence TEXT NOT NULL DEFAULT '' CHECK (length(evidence) <= 1000),
          created_at TEXT NOT NULL
        );
        CREATE INDEX events_request_created ON events(request_id, created_at DESC, id DESC);
        `);
      }
      if (version < 2) {
        const collision = this.database.prepare(`
          SELECT 1
          FROM dispatches AS left_dispatch
          JOIN dispatches AS right_dispatch ON left_dispatch.id <> right_dispatch.id
          WHERE (left_dispatch.thread_id IS NOT NULL AND (
              left_dispatch.thread_id = right_dispatch.thread_id
              OR left_dispatch.thread_id = right_dispatch.client_thread_id
            ))
            OR (left_dispatch.client_thread_id IS NOT NULL AND (
              left_dispatch.client_thread_id = right_dispatch.thread_id
              OR left_dispatch.client_thread_id = right_dispatch.client_thread_id
            ))
          LIMIT 1
        `).get();
        if (collision) {
          throw new LedgerError(
            "IDENTIFIER_COLLISION",
            "The existing ledger has a child identifier linked to more than one dispatch; repair it before retrying",
          );
        }
        this.database.exec(`
          CREATE TRIGGER dispatches_identity_insert
          BEFORE INSERT ON dispatches
          BEGIN
            SELECT CASE WHEN NEW.thread_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM dispatches
              WHERE thread_id = NEW.thread_id OR client_thread_id = NEW.thread_id
            ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
            SELECT CASE WHEN NEW.client_thread_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM dispatches
              WHERE thread_id = NEW.client_thread_id OR client_thread_id = NEW.client_thread_id
            ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
          END;

          CREATE TRIGGER dispatches_identity_update
          BEFORE UPDATE OF thread_id, client_thread_id ON dispatches
          BEGIN
            SELECT CASE WHEN NEW.thread_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM dispatches
              WHERE id <> OLD.id
                AND (thread_id = NEW.thread_id OR client_thread_id = NEW.thread_id)
            ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
            SELECT CASE WHEN NEW.client_thread_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM dispatches
              WHERE id <> OLD.id
                AND (thread_id = NEW.client_thread_id OR client_thread_id = NEW.client_thread_id)
            ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
          END;

          PRAGMA user_version = 2;
        `);
      }
      if (version < 3) {
        const hasV3Columns = this.database.prepare("PRAGMA table_info(requests)").all()
          .some((column) => column.name === "root_session_id");
        if (!hasV3Columns) this.database.exec(`
          ALTER TABLE requests ADD COLUMN root_session_id TEXT;
          ALTER TABLE requests ADD COLUMN lineage_status TEXT NOT NULL DEFAULT 'legacy_unknown'
            CHECK (lineage_status IN ('known', 'legacy_unknown'));

          CREATE TABLE request_sessions (
            request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            session_id TEXT NOT NULL,
            relation TEXT NOT NULL CHECK (relation IN ('origin', 'resume')),
            attached_at TEXT NOT NULL,
            PRIMARY KEY (request_id, session_id)
          );
          CREATE UNIQUE INDEX request_sessions_origin_unique
            ON request_sessions(request_id) WHERE relation = 'origin';

          CREATE TABLE dispatch_relations (
            dispatch_id TEXT PRIMARY KEY REFERENCES dispatches(id) ON DELETE CASCADE,
            parent_dispatch_id TEXT REFERENCES dispatches(id),
            logical_unit_key TEXT,
            retry_of_dispatch_id TEXT REFERENCES dispatches(id),
            CHECK (dispatch_id <> parent_dispatch_id),
            CHECK (dispatch_id <> retry_of_dispatch_id)
          );

          CREATE TABLE dispatch_dependencies (
            dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
            depends_on_dispatch_id TEXT NOT NULL REFERENCES dispatches(id),
            PRIMARY KEY (dispatch_id, depends_on_dispatch_id),
            CHECK (dispatch_id <> depends_on_dispatch_id)
          );

          CREATE TABLE dispatch_ownership (
            dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
            object_key TEXT NOT NULL CHECK (length(object_key) BETWEEN 1 AND 500),
            access_mode TEXT NOT NULL CHECK (access_mode IN ('read', 'write')),
            phase TEXT NOT NULL,
            PRIMARY KEY (dispatch_id, object_key, phase)
          );
          CREATE INDEX dispatch_ownership_object ON dispatch_ownership(object_key, phase, access_mode);

          CREATE TABLE route_decisions (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            dispatch_id TEXT REFERENCES dispatches(id) ON DELETE SET NULL,
            idempotency_key TEXT NOT NULL UNIQUE,
            input_fingerprint TEXT NOT NULL,
            target_project_id TEXT,
            rule_matches_json TEXT NOT NULL,
            rule_outcome TEXT NOT NULL CHECK (rule_outcome IN ('selected', 'blocked', 'conflict')),
            skill_matches_json TEXT NOT NULL,
            tool_matches_json TEXT NOT NULL,
            candidate_refs_json TEXT NOT NULL,
            eligible_exposure INTEGER NOT NULL DEFAULT 0 CHECK (eligible_exposure IN (0, 1)),
            actual_hit INTEGER NOT NULL DEFAULT 0 CHECK (actual_hit IN (0, 1)),
            reason_code TEXT NOT NULL,
            reason_summary TEXT NOT NULL CHECK (length(reason_summary) BETWEEN 1 AND 400),
            environment_fingerprint TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX route_decisions_request_created ON route_decisions(request_id, created_at DESC);

          CREATE TABLE outcomes (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL UNIQUE,
            attempt INTEGER NOT NULL CHECK (attempt >= 0),
            status TEXT NOT NULL CHECK (status IN (
              'registered', 'running', 'waiting_user', 'done', 'failed', 'cancelled', 'unknown'
            )),
            verification_status TEXT NOT NULL CHECK (verification_status IN (
              'PASS', 'FAIL', 'PARTIAL', 'UNVERIFIED'
            )),
            summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 600),
            environment_fingerprint TEXT NOT NULL,
            evidence_ref TEXT,
            created_at TEXT NOT NULL,
            UNIQUE (dispatch_id, attempt)
          );

          CREATE TABLE evidence_refs (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            dispatch_id TEXT REFERENCES dispatches(id) ON DELETE SET NULL,
            idempotency_key TEXT NOT NULL UNIQUE,
            evidence_level TEXT NOT NULL CHECK (evidence_level IN (
              'static', 'test', 'runtime', 'gui', 'external', 'publish'
            )),
            verification_status TEXT NOT NULL CHECK (verification_status IN (
              'PASS', 'FAIL', 'PARTIAL', 'UNVERIFIED'
            )),
            producer_dispatch_id TEXT REFERENCES dispatches(id),
            verifier_dispatch_id TEXT REFERENCES dispatches(id),
            reference TEXT NOT NULL CHECK (length(reference) BETWEEN 1 AND 1000),
            content_hash TEXT,
            summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 400),
            created_at TEXT NOT NULL
          );
          CREATE INDEX evidence_refs_request_created ON evidence_refs(request_id, created_at DESC);

          CREATE TABLE candidate_refs (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL UNIQUE,
            candidate_ref TEXT NOT NULL CHECK (length(candidate_ref) BETWEEN 1 AND 1000),
            candidate_fingerprint TEXT NOT NULL,
            asset_version TEXT NOT NULL,
            governance_source_id TEXT NOT NULL,
            source_status TEXT NOT NULL CHECK (source_status IN ('connected', 'stale', 'unavailable')),
            candidate_status TEXT NOT NULL CHECK (candidate_status IN (
              'draft', 'queued', 'evaluating', 'accepted', 'revalidation_required', 'rejected', 'held', 'expired'
            )),
            validation_status TEXT NOT NULL CHECK (validation_status IN ('PASS', 'FAIL', 'PARTIAL', 'UNVERIFIED')),
            qualification_status TEXT NOT NULL CHECK (qualification_status IN ('eligible', 'ineligible', 'unknown')),
            environment_fingerprint TEXT NOT NULL,
            promotion_destination TEXT NOT NULL CHECK (promotion_destination IN (
              'single_case', 'project_memory', 'project_rule', 'domain_rule_or_skill', 'personal_global_skill', 'unknown'
            )),
            canonical_ref TEXT,
            activation_mode TEXT NOT NULL CHECK (activation_mode IN ('separate', 'write_is_activation')),
            local_record_status TEXT NOT NULL CHECK (local_record_status IN (
              'not_recorded', 'approved', 'recorded', 'rolled_back'
            )),
            enable_status TEXT NOT NULL CHECK (enable_status IN ('not_enabled', 'enabled', 'suspended', 'rolled_back')),
            publish_status TEXT NOT NULL CHECK (publish_status IN ('not_published', 'published', 'rolled_back')),
            value_gate_stage TEXT NOT NULL CHECK (value_gate_stage IN ('M0', 'M3', 'M6', 'M12')),
            value_gate_decision TEXT NOT NULL CHECK (value_gate_decision IN ('GO', 'PAUSE', 'ROLLBACK', 'RETIRE')),
            capacity_status TEXT NOT NULL CHECK (capacity_status IN ('available', 'full', 'unknown')),
            routing_eligible INTEGER NOT NULL CHECK (routing_eligible IN (0, 1)),
            budget_locked INTEGER NOT NULL CHECK (budget_locked IN (0, 1)),
            sample_plan_locked INTEGER NOT NULL CHECK (sample_plan_locked IN (0, 1)),
            pilot_cluster_locked INTEGER NOT NULL CHECK (pilot_cluster_locked IN (0, 1)),
            rollback_sla_locked INTEGER NOT NULL CHECK (rollback_sla_locked IN (0, 1)),
            governance_endpoint_locked INTEGER NOT NULL CHECK (governance_endpoint_locked IN (0, 1)),
            orchestrator_route_blocked_at TEXT,
            canonical_source_rolled_back_at TEXT,
            fresh_session_no_load_verified_at TEXT,
            last_trusted_at TEXT,
            read_error_code TEXT,
            summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 400),
            updated_at TEXT NOT NULL,
            UNIQUE (request_id, candidate_ref)
          );
          CREATE INDEX candidate_refs_request_updated ON candidate_refs(request_id, updated_at DESC);

          PRAGMA user_version = 3;
        `);
        else this.database.exec("PRAGMA user_version = 3;");
      }
      if (version < 4) {
        const hasEvidenceRefId = this.database.prepare("PRAGMA table_info(outcomes)").all()
          .some((column) => column.name === "evidence_ref_id");
        if (!hasEvidenceRefId) {
          this.database.exec("ALTER TABLE outcomes ADD COLUMN evidence_ref_id TEXT REFERENCES evidence_refs(id);");
        }
        this.database.exec(`
          CREATE TRIGGER IF NOT EXISTS dispatches_running_dependency_gate
          BEFORE UPDATE OF status ON dispatches
          WHEN NEW.status = 'running' AND EXISTS (
            SELECT 1
            FROM dispatch_dependencies AS dependency
            JOIN dispatches AS required_dispatch ON required_dispatch.id = dependency.depends_on_dispatch_id
            WHERE dependency.dispatch_id = NEW.id AND required_dispatch.status <> 'done'
          )
          BEGIN
            SELECT RAISE(ABORT, 'dispatch dependencies are not done');
          END;

          CREATE TRIGGER IF NOT EXISTS dispatch_dependencies_running_insert_gate
          BEFORE INSERT ON dispatch_dependencies
          WHEN (SELECT status FROM dispatches WHERE id = NEW.dispatch_id) = 'running'
            AND (SELECT status FROM dispatches WHERE id = NEW.depends_on_dispatch_id) <> 'done'
          BEGIN
            SELECT RAISE(ABORT, 'running dispatch cannot depend on unfinished work');
          END;

          CREATE TRIGGER IF NOT EXISTS dispatches_running_ownership_gate
          BEFORE UPDATE OF status ON dispatches
          WHEN NEW.status = 'running' AND EXISTS (
            SELECT 1
            FROM dispatch_ownership AS requested
            JOIN dispatch_ownership AS existing
              ON existing.object_key = requested.object_key
             AND existing.phase = requested.phase
             AND existing.dispatch_id <> requested.dispatch_id
            JOIN dispatches AS active_dispatch ON active_dispatch.id = existing.dispatch_id
            WHERE requested.dispatch_id = NEW.id
              AND active_dispatch.status = 'running'
              AND (requested.access_mode = 'write' OR existing.access_mode = 'write')
          )
          BEGIN
            SELECT RAISE(ABORT, 'dispatch ownership conflicts with a running dispatch');
          END;

          CREATE TRIGGER IF NOT EXISTS dispatch_ownership_running_insert_gate
          BEFORE INSERT ON dispatch_ownership
          WHEN (SELECT status FROM dispatches WHERE id = NEW.dispatch_id) = 'running' AND EXISTS (
            SELECT 1
            FROM dispatch_ownership AS existing
            JOIN dispatches AS active_dispatch ON active_dispatch.id = existing.dispatch_id
            WHERE existing.object_key = NEW.object_key
              AND existing.phase = NEW.phase
              AND existing.dispatch_id <> NEW.dispatch_id
              AND active_dispatch.status = 'running'
              AND (NEW.access_mode = 'write' OR existing.access_mode = 'write')
          )
          BEGIN
            SELECT RAISE(ABORT, 'dispatch ownership conflicts with a running dispatch');
          END;

          CREATE TRIGGER IF NOT EXISTS dispatch_ownership_running_update_gate
          BEFORE UPDATE OF object_key, access_mode, phase, dispatch_id ON dispatch_ownership
          WHEN (SELECT status FROM dispatches WHERE id = NEW.dispatch_id) = 'running' AND EXISTS (
            SELECT 1
            FROM dispatch_ownership AS existing
            JOIN dispatches AS active_dispatch ON active_dispatch.id = existing.dispatch_id
            WHERE existing.object_key = NEW.object_key
              AND existing.phase = NEW.phase
              AND existing.dispatch_id <> NEW.dispatch_id
              AND active_dispatch.status = 'running'
              AND (NEW.access_mode = 'write' OR existing.access_mode = 'write')
          )
          BEGIN
            SELECT RAISE(ABORT, 'dispatch ownership conflicts with a running dispatch');
          END;

          CREATE TRIGGER IF NOT EXISTS outcomes_immutable_update BEFORE UPDATE ON outcomes
          BEGIN SELECT RAISE(ABORT, 'outcomes are immutable'); END;
          CREATE TRIGGER IF NOT EXISTS outcomes_immutable_delete BEFORE DELETE ON outcomes
          BEGIN SELECT RAISE(ABORT, 'outcomes are immutable'); END;
          CREATE TRIGGER IF NOT EXISTS evidence_refs_immutable_update BEFORE UPDATE ON evidence_refs
          BEGIN SELECT RAISE(ABORT, 'evidence references are immutable'); END;
          CREATE TRIGGER IF NOT EXISTS evidence_refs_immutable_delete BEFORE DELETE ON evidence_refs
          BEGIN SELECT RAISE(ABORT, 'evidence references are immutable'); END;

          CREATE TRIGGER IF NOT EXISTS evidence_refs_pass_gate
          BEFORE INSERT ON evidence_refs
          WHEN NEW.verification_status = 'PASS' AND NOT (
            NEW.dispatch_id = NEW.verifier_dispatch_id
            AND NEW.producer_dispatch_id IS NOT NULL
            AND NEW.verifier_dispatch_id IS NOT NULL
            AND NEW.verifier_dispatch_id <> NEW.producer_dispatch_id
            AND (SELECT role FROM dispatches WHERE id = NEW.verifier_dispatch_id) = 'verifier'
          )
          BEGIN
            SELECT RAISE(ABORT, 'PASS evidence must be recorded by an independent verifier');
          END;

          CREATE TRIGGER IF NOT EXISTS outcomes_pass_evidence_gate
          BEFORE INSERT ON outcomes
          WHEN NEW.verification_status = 'PASS' AND NOT EXISTS (
            SELECT 1
            FROM evidence_refs AS evidence
            JOIN dispatches AS verifier ON verifier.id = evidence.verifier_dispatch_id
            WHERE evidence.id = NEW.evidence_ref_id
              AND evidence.request_id = NEW.request_id
              AND evidence.verification_status = 'PASS'
              AND evidence.producer_dispatch_id = NEW.dispatch_id
              AND evidence.verifier_dispatch_id IS NOT NULL
              AND evidence.verifier_dispatch_id <> evidence.producer_dispatch_id
              AND verifier.role = 'verifier'
          )
          BEGIN
            SELECT RAISE(ABORT, 'PASS outcome requires immutable independent evidence');
          END;

          CREATE TRIGGER IF NOT EXISTS requests_lineage_insert_gate
          BEFORE INSERT ON requests
          WHEN NEW.root_session_id IS NULL OR NEW.lineage_status <> 'known'
          BEGIN
            SELECT RAISE(ABORT, 'new requests require an explicit root session');
          END;

          CREATE TRIGGER IF NOT EXISTS requests_pass_insert_gate
          BEFORE INSERT ON requests
          WHEN NEW.verification_status = 'PASS'
          BEGIN
            SELECT RAISE(ABORT, 'new requests cannot start with PASS verification');
          END;

          CREATE TRIGGER IF NOT EXISTS requests_pass_update_gate
          BEFORE UPDATE OF verification_status ON requests
          WHEN NEW.verification_status = 'PASS' AND NOT EXISTS (
            SELECT 1
            FROM evidence_refs AS evidence
            JOIN dispatches AS verifier ON verifier.id = evidence.verifier_dispatch_id
            WHERE evidence.request_id = NEW.id
              AND evidence.verification_status = 'PASS'
              AND evidence.verifier_dispatch_id IS NOT NULL
              AND evidence.verifier_dispatch_id <> evidence.producer_dispatch_id
              AND verifier.role = 'verifier'
          )
          BEGIN
            SELECT RAISE(ABORT, 'PASS request requires immutable independent evidence');
          END;

          CREATE TRIGGER IF NOT EXISTS candidate_refs_routing_insert_gate
          BEFORE INSERT ON candidate_refs
          WHEN NEW.routing_eligible = 1 AND NOT (
            NEW.source_status = 'connected'
            AND NEW.candidate_status = 'accepted'
            AND NEW.validation_status = 'PASS'
            AND NEW.qualification_status = 'eligible'
            AND NEW.canonical_ref IS NOT NULL AND length(NEW.canonical_ref) > 0
            AND NEW.local_record_status = 'recorded'
            AND NEW.enable_status = 'enabled'
            AND NEW.value_gate_decision = 'GO'
            AND NEW.capacity_status = 'available'
            AND NEW.budget_locked = 1
            AND NEW.sample_plan_locked = 1
            AND NEW.pilot_cluster_locked = 1
            AND NEW.rollback_sla_locked = 1
            AND NEW.governance_endpoint_locked = 1
            AND NEW.orchestrator_route_blocked_at IS NULL
          )
          BEGIN
            SELECT RAISE(ABORT, 'candidate routing gates are incomplete');
          END;

          CREATE TRIGGER IF NOT EXISTS candidate_refs_routing_update_gate
          BEFORE UPDATE OF routing_eligible, source_status, candidate_status, validation_status,
            qualification_status, canonical_ref, local_record_status, enable_status,
            value_gate_decision, capacity_status, budget_locked, sample_plan_locked,
            pilot_cluster_locked, rollback_sla_locked, governance_endpoint_locked,
            orchestrator_route_blocked_at ON candidate_refs
          WHEN NEW.routing_eligible = 1 AND NOT (
            NEW.source_status = 'connected'
            AND NEW.candidate_status = 'accepted'
            AND NEW.validation_status = 'PASS'
            AND NEW.qualification_status = 'eligible'
            AND NEW.canonical_ref IS NOT NULL AND length(NEW.canonical_ref) > 0
            AND NEW.local_record_status = 'recorded'
            AND NEW.enable_status = 'enabled'
            AND NEW.value_gate_decision = 'GO'
            AND NEW.capacity_status = 'available'
            AND NEW.budget_locked = 1
            AND NEW.sample_plan_locked = 1
            AND NEW.pilot_cluster_locked = 1
            AND NEW.rollback_sla_locked = 1
            AND NEW.governance_endpoint_locked = 1
            AND NEW.orchestrator_route_blocked_at IS NULL
          )
          BEGIN
            SELECT RAISE(ABORT, 'candidate routing gates are incomplete');
          END;

          PRAGMA user_version = 4;
        `);
      }
      if (version < 6) {
        const dependentDispatchTriggers = this.database.prepare(`
          SELECT name, sql FROM sqlite_master
          WHERE type = 'trigger'
            AND tbl_name <> 'dispatches'
            AND instr(lower(sql), 'dispatches') > 0
          ORDER BY name
        `).all();
        for (const trigger of dependentDispatchTriggers) {
          this.database.exec(`DROP TRIGGER ${quoteIdentifier(trigger.name)};`);
        }
        this.database.exec(`
          DROP TRIGGER IF EXISTS dispatches_identity_insert;
          DROP TRIGGER IF EXISTS dispatches_identity_update;
          DROP TRIGGER IF EXISTS dispatches_running_dependency_gate;
          DROP TRIGGER IF EXISTS dispatches_running_ownership_gate;

          CREATE TABLE dispatches_v6 (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL CHECK (role IN ('worker', 'verifier')),
            model TEXT NOT NULL CHECK (model IN (
              'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra'
            )),
            effort TEXT NOT NULL CHECK (
              (model = 'gpt-5.6-luna' AND effort IN ('low', 'medium'))
              OR (model = 'gpt-5.6-terra' AND effort IN ('medium', 'high'))
              OR (model = 'gpt-5.6-sol' AND effort IN ('high', 'xhigh', 'max'))
              OR (model = 'gpt-6-astra' AND effort IN ('medium', 'high', 'xhigh', 'max'))
            ),
            thread_id TEXT,
            client_thread_id TEXT,
            workspace_path TEXT,
            status TEXT NOT NULL CHECK (status IN (
              'registered', 'running', 'waiting_user', 'done', 'failed', 'cancelled', 'unknown'
            )),
            verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN (
              'PASS', 'FAIL', 'PARTIAL', 'UNVERIFIED'
            )),
            needs_attention INTEGER NOT NULL DEFAULT 0 CHECK (needs_attention IN (0, 1)),
            attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 0),
            summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 600),
            evidence TEXT NOT NULL DEFAULT '' CHECK (length(evidence) <= 1000),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (thread_id IS NOT NULL OR client_thread_id IS NOT NULL)
          );

          INSERT INTO dispatches_v6 (
            id, request_id, idempotency_key, role, model, effort, thread_id, client_thread_id,
            workspace_path, status, verification_status, needs_attention, attempt_count,
            summary, evidence, created_at, updated_at
          )
          SELECT
            id, request_id, idempotency_key, role, model, effort, thread_id, client_thread_id,
            workspace_path, status, verification_status, needs_attention, attempt_count,
            summary, evidence, created_at, updated_at
          FROM dispatches;

          DROP TABLE dispatches;
          ALTER TABLE dispatches_v6 RENAME TO dispatches;

          CREATE UNIQUE INDEX dispatches_thread_id_unique
            ON dispatches(thread_id) WHERE thread_id IS NOT NULL;
          CREATE UNIQUE INDEX dispatches_client_thread_id_unique
            ON dispatches(client_thread_id) WHERE client_thread_id IS NOT NULL;
          CREATE INDEX dispatches_request_updated ON dispatches(request_id, updated_at DESC);

          CREATE TRIGGER dispatches_identity_insert
          BEFORE INSERT ON dispatches
          BEGIN
            SELECT CASE WHEN NEW.thread_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM dispatches
              WHERE thread_id = NEW.thread_id OR client_thread_id = NEW.thread_id
            ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
            SELECT CASE WHEN NEW.client_thread_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM dispatches
              WHERE thread_id = NEW.client_thread_id OR client_thread_id = NEW.client_thread_id
            ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
          END;

          CREATE TRIGGER dispatches_identity_update
          BEFORE UPDATE OF thread_id, client_thread_id ON dispatches
          BEGIN
            SELECT CASE WHEN NEW.thread_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM dispatches
              WHERE id <> OLD.id
                AND (thread_id = NEW.thread_id OR client_thread_id = NEW.thread_id)
            ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
            SELECT CASE WHEN NEW.client_thread_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM dispatches
              WHERE id <> OLD.id
                AND (thread_id = NEW.client_thread_id OR client_thread_id = NEW.client_thread_id)
            ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
          END;

          CREATE TRIGGER dispatches_current_model_insert
          BEFORE INSERT ON dispatches
          WHEN NEW.model = 'gpt-5.6-luna'
          BEGIN
            SELECT RAISE(ABORT, 'legacy model cannot be used for a new dispatch');
          END;

          CREATE TRIGGER dispatches_legacy_model_update
          BEFORE UPDATE OF model, effort ON dispatches
          WHEN (OLD.model = 'gpt-5.6-luna' AND (
              NEW.model <> OLD.model OR NEW.effort <> OLD.effort
            )) OR (OLD.model <> 'gpt-5.6-luna' AND NEW.model = 'gpt-5.6-luna')
          BEGIN
            SELECT RAISE(ABORT, 'legacy dispatch model and effort are immutable');
          END;

          CREATE TRIGGER dispatches_running_dependency_gate
          BEFORE UPDATE OF status ON dispatches
          WHEN NEW.status = 'running' AND EXISTS (
            SELECT 1
            FROM dispatch_dependencies AS dependency
            JOIN dispatches AS required_dispatch ON required_dispatch.id = dependency.depends_on_dispatch_id
            WHERE dependency.dispatch_id = NEW.id AND required_dispatch.status <> 'done'
          )
          BEGIN
            SELECT RAISE(ABORT, 'dispatch dependencies are not done');
          END;

          CREATE TRIGGER dispatches_running_ownership_gate
          BEFORE UPDATE OF status ON dispatches
          WHEN NEW.status = 'running' AND EXISTS (
            SELECT 1
            FROM dispatch_ownership AS requested
            JOIN dispatch_ownership AS existing
              ON existing.object_key = requested.object_key
             AND existing.phase = requested.phase
             AND existing.dispatch_id <> requested.dispatch_id
            JOIN dispatches AS active_dispatch ON active_dispatch.id = existing.dispatch_id
            WHERE requested.dispatch_id = NEW.id
              AND active_dispatch.status = 'running'
              AND (requested.access_mode = 'write' OR existing.access_mode = 'write')
          )
          BEGIN
            SELECT RAISE(ABORT, 'dispatch ownership conflicts with a running dispatch');
          END;

          PRAGMA user_version = 6;
        `);
        for (const trigger of dependentDispatchTriggers) this.database.exec(trigger.sql);
      }
      if (version < 7) {
        // Rebuild only dispatches. Keep other tables and all non-model schema objects intact.
        const dispatchObjects = this.database.prepare(`
          SELECT type, name, sql FROM sqlite_master
          WHERE sql IS NOT NULL AND (
            (type = 'index' AND tbl_name = 'dispatches')
            OR (type = 'trigger' AND (tbl_name = 'dispatches' OR instr(lower(sql), 'dispatches') > 0))
          )
          ORDER BY type, name
        `).all();
        for (const object of dispatchObjects.filter((entry) => entry.type === "trigger")) {
          this.database.exec(`DROP TRIGGER ${quoteIdentifier(object.name)};`);
        }
        this.database.exec(`
          CREATE TABLE dispatches_v7 (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL CHECK (role IN ('worker', 'verifier')),
            model TEXT NOT NULL CHECK (model IN (
              'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'
            )),
            effort TEXT NOT NULL CHECK (
              (model = 'gpt-5.6-luna' AND effort IN ('low', 'medium'))
              OR (model = 'gpt-5.6-terra' AND effort IN ('medium', 'high'))
              OR (model = 'gpt-5.6-sol' AND effort IN ('high', 'xhigh', 'max'))
              OR (model = 'gpt-6-luna' AND effort IN ('medium', 'high'))
              OR (model = 'gpt-6-sol' AND effort IN ('high', 'xhigh', 'max'))
              OR (model = 'gpt-6-astra' AND effort IN ('medium', 'high', 'xhigh', 'max'))
            ),
            thread_id TEXT,
            client_thread_id TEXT,
            workspace_path TEXT,
            status TEXT NOT NULL CHECK (status IN (
              'registered', 'running', 'waiting_user', 'done', 'failed', 'cancelled', 'unknown'
            )),
            verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN (
              'PASS', 'FAIL', 'PARTIAL', 'UNVERIFIED'
            )),
            needs_attention INTEGER NOT NULL DEFAULT 0 CHECK (needs_attention IN (0, 1)),
            attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 0),
            summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 600),
            evidence TEXT NOT NULL DEFAULT '' CHECK (length(evidence) <= 1000),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (thread_id IS NOT NULL OR client_thread_id IS NOT NULL)
          );

          INSERT INTO dispatches_v7 (
            id, request_id, idempotency_key, role, model, effort, thread_id, client_thread_id,
            workspace_path, status, verification_status, needs_attention, attempt_count,
            summary, evidence, created_at, updated_at
          )
          SELECT
            id, request_id, idempotency_key, role, model, effort, thread_id, client_thread_id,
            workspace_path, status, verification_status, needs_attention, attempt_count,
            summary, evidence, created_at, updated_at
          FROM dispatches;

          DROP TABLE dispatches;
          ALTER TABLE dispatches_v7 RENAME TO dispatches;

          CREATE TRIGGER dispatches_current_model_insert
          BEFORE INSERT ON dispatches
          WHEN NEW.model NOT IN ('gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra')
            OR EXISTS (
              SELECT 1 FROM dispatches
              WHERE model IN ('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol')
                AND (id = NEW.id OR idempotency_key = NEW.idempotency_key)
            )
          BEGIN
            SELECT RAISE(ABORT, 'legacy model cannot be used for a new dispatch');
          END;

          CREATE TRIGGER dispatches_legacy_model_update
          BEFORE UPDATE OF model, effort ON dispatches
          WHEN (OLD.model IN ('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol') AND (
              NEW.model <> OLD.model OR NEW.effort <> OLD.effort
            )) OR (OLD.model NOT IN ('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol')
              AND NEW.model IN ('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'))
          BEGIN
            SELECT RAISE(ABORT, 'legacy dispatch model and effort are immutable');
          END;

          PRAGMA user_version = 7;
        `);
        for (const object of dispatchObjects) {
          if (!["dispatches_current_model_insert", "dispatches_legacy_model_update"].includes(object.name)) {
            this.database.exec(object.sql);
          }
        }
      }
      const foreignKeyViolation = this.database.prepare("PRAGMA foreign_key_check").get();
      if (foreignKeyViolation) {
        throw new LedgerError(
          "FOREIGN_KEY_CHECK_FAILED",
          "ledger migration would leave an invalid relationship; the migration was rolled back",
        );
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      try { this.database.exec("ROLLBACK;"); } catch {}
      throw error;
    } finally {
      if (foreignKeysEnabled) this.database.exec("PRAGMA foreign_keys = ON;");
    }
    this.#enableWal();
    this.database.exec("PRAGMA synchronous = NORMAL;");
    this.schemaVersion = SCHEMA_VERSION;
    this.schemaCompatibility = "current";
  }

  #enableWal() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const mode = this.database.prepare("PRAGMA journal_mode = WAL").get().journal_mode;
        if (mode !== "wal") {
          throw new LedgerError("WAL_NOT_ENABLED", "The orchestrator ledger could not enable WAL mode");
        }
        return;
      } catch (error) {
        if (!isBusySqliteError(error) || attempt === 99) throw error;
        Atomics.wait(SQLITE_RETRY_BUFFER, 0, 0, 10);
      }
    }
  }

  #transaction(callback) {
    if (this.readOnly) throw new LedgerError("READ_ONLY", "The ledger was opened read-only");
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const value = callback();
      this.database.exec("COMMIT;");
      return value;
    } catch (error) {
      try { this.database.exec("ROLLBACK;"); } catch {}
      throw error;
    }
  }

  #eventByKey(idempotencyKey) {
    return this.database.prepare("SELECT * FROM events WHERE idempotency_key = ?").get(idempotencyKey) ?? null;
  }

  #assertIdempotency(event, expectedType) {
    if (event && event.event_type !== expectedType) {
      throw new LedgerError(
        "IDEMPOTENCY_CONFLICT",
        `idempotencyKey was already used for ${event.event_type}`,
      );
    }
  }

  #insertEvent({ idempotencyKey, requestId = null, dispatchId = null, type, summary = "", evidence = "" }) {
    this.database.prepare(`
      INSERT INTO events (idempotency_key, request_id, dispatch_id, event_type, summary, evidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(idempotencyKey, requestId, dispatchId, type, summary, evidence, now());
  }

  #independentPassEvidence(requestId, { producerDispatchId = null, evidenceRefId = null } = {}) {
    return this.database.prepare(`
      SELECT evidence.id
      FROM evidence_refs AS evidence
      JOIN dispatches AS verifier ON verifier.id = evidence.verifier_dispatch_id
      JOIN events AS evidence_event
        ON evidence_event.idempotency_key = evidence.idempotency_key
       AND evidence_event.event_type = 'evidence.recorded'
      WHERE evidence.request_id = ?
        AND evidence.verification_status = 'PASS'
        AND evidence.verifier_dispatch_id IS NOT NULL
        AND evidence.verifier_dispatch_id <> evidence.producer_dispatch_id
        AND verifier.role = 'verifier'
        AND NOT EXISTS (
          SELECT 1
          FROM events AS resume_event
          WHERE resume_event.request_id = evidence.request_id
            AND resume_event.event_type = 'dispatch.resumed'
            AND resume_event.id > evidence_event.id
        )
        AND (? IS NULL OR evidence.producer_dispatch_id = ?)
        AND (? IS NULL OR evidence.id = ?)
      LIMIT 1
    `).get(
      requestId,
      producerDispatchId,
      producerDispatchId,
      evidenceRefId,
      evidenceRefId,
    ) ?? null;
  }

  createRequest(idempotencyKey, input) {
    return this.#transaction(() => {
      const duplicateEvent = this.#eventByKey(idempotencyKey);
      this.#assertIdempotency(duplicateEvent, "request.created");
      if (duplicateEvent) return { duplicate: true, request: this.getRequest(duplicateEvent.request_id) };
      const id = `req_${randomUUID()}`;
      const timestamp = now();
      this.database.prepare(`
        INSERT INTO requests (
          id, idempotency_key, root_session_id, lineage_status, goal, project_id, workspace_path, status,
          progress_completed, progress_total, verification_status, needs_user, attempt_count,
          summary, evidence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        idempotencyKey,
        input.rootSessionId,
        input.lineageStatus,
        input.goal,
        input.projectId,
        input.workspacePath,
        input.status,
        input.progressCompleted,
        input.progressTotal,
        input.verification,
        Number(input.needsUser),
        input.attemptCount,
        input.summary,
        input.evidence,
        timestamp,
        timestamp,
      );
      if (input.rootSessionId) {
        this.database.prepare(`
          INSERT INTO request_sessions (request_id, session_id, relation, attached_at)
          VALUES (?, ?, 'origin', ?)
        `).run(id, input.rootSessionId, timestamp);
      }
      this.#insertEvent({
        idempotencyKey,
        requestId: id,
        type: "request.created",
        summary: input.summary || "Request recorded",
        evidence: input.evidence,
      });
      return { duplicate: false, request: this.getRequest(id) };
    });
  }

  updateRequest(idempotencyKey, requestId, patch) {
    return this.#transaction(() => {
      const duplicateEvent = this.#eventByKey(idempotencyKey);
      this.#assertIdempotency(duplicateEvent, "request.updated");
      if (duplicateEvent && duplicateEvent.request_id !== requestId) {
        throw new LedgerError("IDEMPOTENCY_CONFLICT", "idempotencyKey belongs to another request");
      }
      if (duplicateEvent) return { duplicate: true, request: this.getRequest(duplicateEvent.request_id) };
      const current = this.getRequest(requestId);
      if (!current) throw new LedgerError("REQUEST_NOT_FOUND", `request '${requestId}' does not exist`);
      if (patch.verification === "PASS" && !this.#independentPassEvidence(requestId)) {
        throw new LedgerError(
          "INDEPENDENT_EVIDENCE_REQUIRED",
          "request PASS requires immutable evidence from an independent verifier",
        );
      }
      if (Object.hasOwn(patch, "rootSessionId")) {
        if (current.rootSessionId && patch.rootSessionId !== current.rootSessionId) {
          throw new LedgerError("ROOT_SESSION_IMMUTABLE", "rootSessionId is immutable once recorded");
        }
        if (!patch.rootSessionId) {
          throw new LedgerError("ROOT_SESSION_IMMUTABLE", "rootSessionId cannot be cleared");
        }
      }
      if (current.lineageStatus === "known" && patch.lineageStatus === "legacy_unknown") {
        throw new LedgerError("ROOT_SESSION_IMMUTABLE", "known lineage cannot be downgraded");
      }
      if (!current.rootSessionId && !patch.rootSessionId && patch.lineageStatus === "known") {
        throw new LedgerError("ROOT_SESSION_REQUIRED", "known lineage requires rootSessionId");
      }
      const completed = patch.progressCompleted ?? current.progress.completed;
      const total = patch.progressTotal ?? current.progress.total;
      validateProgress(completed, total);
      const columns = {
        rootSessionId: "root_session_id",
        lineageStatus: "lineage_status",
        goal: "goal",
        projectId: "project_id",
        workspacePath: "workspace_path",
        status: "status",
        progressCompleted: "progress_completed",
        progressTotal: "progress_total",
        verification: "verification_status",
        needsUser: "needs_user",
        attemptCount: "attempt_count",
        summary: "summary",
        evidence: "evidence",
      };
      const entries = Object.entries(patch);
      const assignments = entries.map(([key]) => `${columns[key]} = ?`);
      const values = entries.map(([key, value]) => key === "needsUser" ? Number(value) : value);
      const timestamp = now();
      this.database.prepare(`UPDATE requests SET ${assignments.join(", ")}, updated_at = ? WHERE id = ?`)
        .run(...values, timestamp, requestId);
      if (patch.rootSessionId && !current.rootSessionId) {
        this.database.prepare(`
          INSERT OR IGNORE INTO request_sessions (request_id, session_id, relation, attached_at)
          VALUES (?, ?, 'origin', ?)
        `).run(requestId, patch.rootSessionId, timestamp);
      }
      this.#insertEvent({
        idempotencyKey,
        requestId,
        type: "request.updated",
        summary: patch.summary ?? `Request status is ${patch.status ?? current.status}`,
        evidence: patch.evidence ?? "",
      });
      return { duplicate: false, request: this.getRequest(requestId) };
    });
  }

  attachSession(idempotencyKey, requestId, input) {
    return this.#transaction(() => {
      const duplicateEvent = this.#eventByKey(idempotencyKey);
      this.#assertIdempotency(duplicateEvent, "request.session.attached");
      if (duplicateEvent && duplicateEvent.request_id !== requestId) {
        throw new LedgerError("IDEMPOTENCY_CONFLICT", "idempotencyKey belongs to another request");
      }
      if (duplicateEvent) return { duplicate: true, request: this.getRequest(requestId) };
      const request = this.getRequest(requestId);
      if (!request) throw new LedgerError("REQUEST_NOT_FOUND", `request '${requestId}' does not exist`);
      if (input.relation === "origin" && request.rootSessionId && request.rootSessionId !== input.sessionId) {
        throw new LedgerError("ROOT_SESSION_IMMUTABLE", "rootSessionId is immutable once recorded");
      }
      if (input.relation === "resume" && !request.rootSessionId) {
        throw new LedgerError("ROOT_SESSION_REQUIRED", "legacy request lineage must be anchored before adding resume sessions");
      }
      const existing = this.database.prepare(`
        SELECT relation FROM request_sessions WHERE request_id = ? AND session_id = ?
      `).get(requestId, input.sessionId);
      if (existing && existing.relation !== input.relation) {
        throw new LedgerError("SESSION_RELATION_CONFLICT", "the session already has a different lineage relation");
      }
      const timestamp = now();
      if (!existing) {
        this.database.prepare(`
          INSERT INTO request_sessions (request_id, session_id, relation, attached_at)
          VALUES (?, ?, ?, ?)
        `).run(requestId, input.sessionId, input.relation, timestamp);
      }
      if (input.relation === "origin" && !request.rootSessionId) {
        this.database.prepare(`
          UPDATE requests SET root_session_id = ?, lineage_status = 'known', updated_at = ? WHERE id = ?
        `).run(input.sessionId, timestamp, requestId);
      }
      this.#insertEvent({
        idempotencyKey,
        requestId,
        type: "request.session.attached",
        summary: input.relation === "origin" ? "Origin session recorded" : "Recovery session attached",
      });
      return { duplicate: Boolean(existing), reused: Boolean(existing), request: this.getRequest(requestId) };
    });
  }

  checkOwnership(requestId, claims, dependencies = []) {
    if (!this.getRequest(requestId)) {
      throw new LedgerError("REQUEST_NOT_FOUND", `request '${requestId}' does not exist`);
    }
    const directDependencies = new Set(dependencies);
    const conflicts = [];
    for (const claim of claims) {
      const rows = this.database.prepare(`
        SELECT ownership.dispatch_id, ownership.access_mode
        FROM dispatch_ownership AS ownership
        JOIN dispatches AS active_dispatch ON active_dispatch.id = ownership.dispatch_id
        WHERE ownership.object_key = ?
          AND ownership.phase = ?
          AND active_dispatch.status NOT IN ('done', 'failed', 'cancelled')
          AND (? = 'write' OR ownership.access_mode = 'write')
        ORDER BY ownership.dispatch_id
      `).all(claim.objectKey, claim.phase, claim.accessMode);
      for (const row of rows) {
        if (!directDependencies.has(row.dispatch_id)) {
          conflicts.push({
            dispatchId: row.dispatch_id,
            phase: claim.phase,
            requestedAccessMode: claim.accessMode,
            existingAccessMode: row.access_mode,
          });
        }
      }
    }
    return { allowed: conflicts.length === 0, conflicts };
  }

  #dispatchRunGate(dispatchId) {
    const dependencies = this.database.prepare(`
      SELECT dependency.depends_on_dispatch_id AS dispatch_id, required_dispatch.status
      FROM dispatch_dependencies AS dependency
      JOIN dispatches AS required_dispatch ON required_dispatch.id = dependency.depends_on_dispatch_id
      WHERE dependency.dispatch_id = ? AND required_dispatch.status <> 'done'
      ORDER BY dependency.depends_on_dispatch_id
    `).all(dispatchId).map((row) => ({ dispatchId: row.dispatch_id, status: row.status }));
    const ownershipConflicts = this.database.prepare(`
      SELECT DISTINCT existing.dispatch_id
      FROM dispatch_ownership AS requested
      JOIN dispatch_ownership AS existing
        ON existing.object_key = requested.object_key
       AND existing.phase = requested.phase
       AND existing.dispatch_id <> requested.dispatch_id
      JOIN dispatches AS active_dispatch ON active_dispatch.id = existing.dispatch_id
      WHERE requested.dispatch_id = ?
        AND active_dispatch.status = 'running'
        AND (requested.access_mode = 'write' OR existing.access_mode = 'write')
      ORDER BY existing.dispatch_id
    `).all(dispatchId).map((row) => row.dispatch_id);
    return {
      ready: dependencies.length === 0 && ownershipConflicts.length === 0,
      blockedByDependencies: dependencies,
      blockedByOwnership: ownershipConflicts,
    };
  }

  #assertDispatchCanRun(dispatchId) {
    const gate = this.#dispatchRunGate(dispatchId);
    if (gate.blockedByDependencies.length > 0) {
      throw new LedgerError(
        "DEPENDENCY_NOT_READY",
        "dispatch must remain registered until every dependency is done",
        { blockedBy: gate.blockedByDependencies },
      );
    }
    if (gate.blockedByOwnership.length > 0) {
      throw new LedgerError(
        "OWNERSHIP_CONFLICT",
        "dispatch must remain registered while an overlapping writer is running",
        { blockedByDispatchIds: gate.blockedByOwnership },
      );
    }
    return gate;
  }

  replayDispatchRegistration(idempotencyKey, requestId, input) {
    const duplicateEvent = this.#eventByKey(idempotencyKey);
    this.#assertIdempotency(duplicateEvent, "dispatch.registered");
    if (duplicateEvent && duplicateEvent.request_id !== requestId) {
      throw new LedgerError("IDEMPOTENCY_CONFLICT", "idempotencyKey belongs to another request");
    }
    if (!duplicateEvent) return null;
    const dispatch = this.getDispatch(duplicateEvent.dispatch_id);
    if (input && (LEGACY_MODEL_EFFORTS.has(dispatch.model) || LEGACY_MODEL_EFFORTS.has(input.model))
      && (input.model !== dispatch.model || input.effort !== dispatch.effort)) {
      throw new LedgerError("IDEMPOTENCY_CONFLICT", "idempotencyKey belongs to a different historical model or effort");
    }
    return { duplicate: true, dispatch };
  }

  registerDispatch(idempotencyKey, requestId, input) {
    return this.#transaction(() => {
      const replay = this.replayDispatchRegistration(idempotencyKey, requestId, input);
      if (replay) return replay;
      if (!this.getRequest(requestId)) {
        throw new LedgerError("REQUEST_NOT_FOUND", `request '${requestId}' does not exist`);
      }
      for (const relatedId of [input.parentDispatchId, input.retryOfDispatchId].filter(Boolean)) {
        const related = this.getDispatch(relatedId);
        if (!related || related.requestId !== requestId) {
          throw new LedgerError(
            "DISPATCH_RELATION_INVALID",
            "parent and retry dispatches must already exist in the same request",
          );
        }
      }
      for (const dependencyId of input.dependencies) {
        if (!this.getDispatch(dependencyId)) {
          throw new LedgerError("DISPATCH_RELATION_INVALID", "dependency dispatches must already exist");
        }
      }
      const ownershipCheck = this.checkOwnership(requestId, input.ownership, input.dependencies);
      if (!ownershipCheck.allowed) {
        throw new LedgerError(
          "OWNERSHIP_CONFLICT",
          "an active dispatch already owns the requested object and phase; serialize it with a dependency",
          { conflicts: ownershipCheck.conflicts },
        );
      }
      const linked = this.database.prepare(`
        SELECT * FROM dispatches
        WHERE (? IS NOT NULL AND (thread_id = ? OR client_thread_id = ?))
           OR (? IS NOT NULL AND (thread_id = ? OR client_thread_id = ?))
        LIMIT 1
      `).get(
        input.threadId,
        input.threadId,
        input.threadId,
        input.clientThreadId,
        input.clientThreadId,
        input.clientThreadId,
      );
      if (linked) {
        if (linked.request_id === requestId) {
          this.#insertEvent({
            idempotencyKey,
            requestId,
            dispatchId: linked.id,
            type: "dispatch.registered",
            summary: "Existing real task linkage reused; no task was created",
          });
          return { duplicate: true, reused: true, dispatch: this.getDispatch(linked.id) };
        }
        throw new LedgerError(
          "ID_ALREADY_LINKED",
          "The supplied threadId or clientThreadId is already linked to another request",
        );
      }
      const id = `dsp_${randomUUID()}`;
      const timestamp = now();
      this.database.prepare(`
        INSERT INTO dispatches (
          id, request_id, idempotency_key, role, model, effort, thread_id, client_thread_id,
          workspace_path, status, verification_status, needs_attention, attempt_count,
          summary, evidence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        requestId,
        idempotencyKey,
        input.role,
        input.model,
        input.effort,
        input.threadId,
        input.clientThreadId,
        input.workspacePath,
        input.status === "running" ? "registered" : input.status,
        input.verification,
        Number(input.needsAttention),
        input.attemptCount,
        input.summary,
        input.evidence,
        timestamp,
        timestamp,
      );
      if (input.logicalUnitKey || input.parentDispatchId || input.retryOfDispatchId) {
        this.database.prepare(`
          INSERT INTO dispatch_relations (
            dispatch_id, parent_dispatch_id, logical_unit_key, retry_of_dispatch_id
          ) VALUES (?, ?, ?, ?)
        `).run(id, input.parentDispatchId, input.logicalUnitKey, input.retryOfDispatchId);
      }
      const insertDependency = this.database.prepare(`
        INSERT INTO dispatch_dependencies (dispatch_id, depends_on_dispatch_id) VALUES (?, ?)
      `);
      for (const dependencyId of new Set(input.dependencies)) insertDependency.run(id, dependencyId);
      const insertOwnership = this.database.prepare(`
        INSERT INTO dispatch_ownership (dispatch_id, object_key, access_mode, phase) VALUES (?, ?, ?, ?)
      `);
      for (const claim of input.ownership) {
        insertOwnership.run(id, claim.objectKey, claim.accessMode, claim.phase);
      }
      if (input.status === "running") {
        this.#assertDispatchCanRun(id);
        this.database.prepare("UPDATE dispatches SET status = 'running', updated_at = ? WHERE id = ?")
          .run(now(), id);
      }
      this.#insertEvent({
        idempotencyKey,
        requestId,
        dispatchId: id,
        type: "dispatch.registered",
        summary: input.summary || `${input.role} registered`,
        evidence: input.evidence,
      });
      return { duplicate: false, dispatch: this.getDispatch(id) };
    });
  }

  resumeDispatch(idempotencyKey, requestId, dispatchId, input) {
    return this.#transaction(() => {
      const duplicateEvent = this.#eventByKey(idempotencyKey);
      this.#assertIdempotency(duplicateEvent, "dispatch.resumed");
      const inputFingerprint = digestJson(input);
      const fingerprintPrefix = `resume-input-sha256:${inputFingerprint}`;
      if (duplicateEvent) {
        if (duplicateEvent.request_id !== requestId || duplicateEvent.dispatch_id !== dispatchId
          || !duplicateEvent.evidence.startsWith(fingerprintPrefix)) {
          throw new LedgerError(
            "IDEMPOTENCY_CONFLICT",
            "idempotencyKey belongs to another dispatch resume operation",
          );
        }
        return { duplicate: true, resumed: false, dispatch: this.getDispatch(dispatchId) };
      }
      const current = this.getDispatch(dispatchId);
      if (!current) throw new LedgerError("DISPATCH_NOT_FOUND", `dispatch '${dispatchId}' does not exist`);
      if (current.requestId !== requestId) {
        throw new LedgerError(
          "DISPATCH_RELATION_INVALID",
          "dispatch.resume requires a dispatch from the specified request",
        );
      }
      if (!["done", "failed", "cancelled"].includes(current.status)) {
        throw new LedgerError(
          "DISPATCH_NOT_TERMINAL",
          "dispatch.resume requires a done, failed, or cancelled dispatch",
        );
      }
      this.#assertDispatchCanRun(dispatchId);
      const attemptCount = current.attemptCount + 1;
      const timestamp = now();
      this.database.prepare(`
        UPDATE dispatches
        SET status = 'running', verification_status = 'UNVERIFIED', needs_attention = 0,
            attempt_count = ?, summary = ?, evidence = ?, updated_at = ?
        WHERE id = ?
      `).run(attemptCount, input.summary, input.evidence, timestamp, dispatchId);
      this.database.prepare(`
        UPDATE requests
        SET status = 'running', verification_status = 'UNVERIFIED', needs_user = 0, updated_at = ?
        WHERE id = ?
      `).run(timestamp, requestId);
      this.#insertEvent({
        idempotencyKey,
        requestId,
        dispatchId,
        type: "dispatch.resumed",
        summary: `Attempt ${attemptCount} resumed: ${input.summary}`,
        evidence: `${fingerprintPrefix}${input.evidence ? ` ${input.evidence}` : ""}`,
      });
      return { duplicate: false, resumed: true, dispatch: this.getDispatch(dispatchId) };
    });
  }

  recordRouteDecision(idempotencyKey, requestId, input) {
    return this.#transaction(() => {
      const duplicateEvent = this.#eventByKey(idempotencyKey);
      this.#assertIdempotency(duplicateEvent, "route.recorded");
      if (duplicateEvent && duplicateEvent.request_id !== requestId) {
        throw new LedgerError("IDEMPOTENCY_CONFLICT", "idempotencyKey belongs to another request");
      }
      if (duplicateEvent) {
        const existing = this.database.prepare(
          "SELECT * FROM route_decisions WHERE idempotency_key = ?",
        ).get(idempotencyKey);
        return { duplicate: true, routeDecision: routeDecisionFromRow(existing) };
      }
      if (!this.getRequest(requestId)) {
        throw new LedgerError("REQUEST_NOT_FOUND", `request '${requestId}' does not exist`);
      }
      if (input.dispatchId) {
        const dispatch = this.getDispatch(input.dispatchId);
        if (!dispatch || dispatch.requestId !== requestId) {
          throw new LedgerError("DISPATCH_RELATION_INVALID", "route dispatch must belong to the request");
        }
      }
      if (input.actualHit && !input.eligibleExposure) {
        throw new LedgerError("EXPOSURE_INVALID", "actualHit requires eligibleExposure");
      }
      if (input.ruleOutcome !== "selected" && (input.skillMatches.some((entry) => entry.selected)
        || input.toolMatches.some((entry) => entry.selected))) {
        throw new LedgerError(
          "ROUTE_BLOCKED",
          "blocked or conflicting rules cannot select a Skill or tool",
        );
      }
      if (input.candidateRefs.some((entry) => entry.routingEligible === false) && input.actualHit) {
        throw new LedgerError("CANDIDATE_NOT_ELIGIBLE", "an ineligible candidate cannot be recorded as an actual route hit");
      }
      if (input.actualHit && input.candidateRefs.length === 0) {
        throw new LedgerError("CANDIDATE_REF_REQUIRED", "actualHit requires an exact candidate reference");
      }
      if (input.actualHit) {
        for (const candidate of input.candidateRefs) {
          const recorded = this.database.prepare(`
            SELECT * FROM candidate_refs WHERE request_id = ? AND candidate_ref = ?
          `).get(requestId, candidate.candidateRef);
          if (!recorded
            || recorded.candidate_fingerprint !== candidate.candidateFingerprint
            || recorded.asset_version !== candidate.assetVersion
            || recorded.routing_eligible !== 1) {
            throw new LedgerError(
              "CANDIDATE_NOT_ELIGIBLE",
              "actualHit requires a current, exact, routing-eligible candidate reference",
            );
          }
        }
      }
      const id = `rte_${randomUUID()}`;
      this.database.prepare(`
        INSERT INTO route_decisions (
          id, request_id, dispatch_id, idempotency_key, input_fingerprint, target_project_id,
          rule_matches_json, rule_outcome, skill_matches_json, tool_matches_json, candidate_refs_json,
          eligible_exposure, actual_hit, reason_code, reason_summary, environment_fingerprint, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        requestId,
        input.dispatchId,
        idempotencyKey,
        input.inputFingerprint,
        input.targetProjectId,
        JSON.stringify(input.ruleMatches),
        input.ruleOutcome,
        JSON.stringify(input.skillMatches),
        JSON.stringify(input.toolMatches),
        JSON.stringify(input.candidateRefs),
        Number(input.eligibleExposure),
        Number(input.actualHit),
        input.reasonCode,
        input.reasonSummary,
        input.environmentFingerprint,
        now(),
      );
      const row = this.database.prepare("SELECT * FROM route_decisions WHERE id = ?").get(id);
      this.#insertEvent({
        idempotencyKey,
        requestId,
        dispatchId: input.dispatchId,
        type: "route.recorded",
        summary: `Route ${input.ruleOutcome}: ${input.reasonCode}`,
      });
      return { duplicate: false, routeDecision: routeDecisionFromRow(row) };
    });
  }

  recordOutcome(idempotencyKey, requestId, input) {
    return this.#transaction(() => {
      const duplicateEvent = this.#eventByKey(idempotencyKey);
      this.#assertIdempotency(duplicateEvent, "outcome.recorded");
      if (duplicateEvent) {
        const row = this.database.prepare("SELECT * FROM outcomes WHERE idempotency_key = ?").get(idempotencyKey);
        return { duplicate: true, outcome: outcomeFromRow(row) };
      }
      const dispatch = this.getDispatch(input.dispatchId);
      if (!dispatch || dispatch.requestId !== requestId) {
        throw new LedgerError("DISPATCH_RELATION_INVALID", "outcome dispatch must belong to the request");
      }
      if (input.evidenceRefId) {
        const evidence = this.database.prepare("SELECT request_id FROM evidence_refs WHERE id = ?")
          .get(input.evidenceRefId);
        if (!evidence || evidence.request_id !== requestId) {
          throw new LedgerError("EVIDENCE_REF_INVALID", "outcome evidenceRefId must belong to the request");
        }
      }
      if (input.verification === "PASS" && (!input.evidenceRefId || !this.#independentPassEvidence(requestId, {
        producerDispatchId: input.dispatchId,
        evidenceRefId: input.evidenceRefId,
      }))) {
        throw new LedgerError(
          "INDEPENDENT_EVIDENCE_REQUIRED",
          "PASS outcome requires an immutable evidence reference from an independent verifier",
        );
      }
      const id = `out_${randomUUID()}`;
      try {
        this.database.prepare(`
          INSERT INTO outcomes (
            id, request_id, dispatch_id, idempotency_key, attempt, status, verification_status,
            summary, environment_fingerprint, evidence_ref, created_at, evidence_ref_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          requestId,
          input.dispatchId,
          idempotencyKey,
          input.attempt,
          input.status,
          input.verification,
          input.summary,
          input.environmentFingerprint,
          input.evidenceRef,
          now(),
          input.evidenceRefId,
        );
      } catch (error) {
        if (/UNIQUE constraint failed: outcomes\.dispatch_id, outcomes\.attempt/.test(error?.message ?? "")) {
          throw new LedgerError("OUTCOME_ATTEMPT_EXISTS", "this dispatch attempt already has an immutable outcome");
        }
        throw error;
      }
      this.#insertEvent({
        idempotencyKey,
        requestId,
        dispatchId: input.dispatchId,
        type: "outcome.recorded",
        summary: input.summary,
        evidence: input.evidenceRef ?? "",
      });
      const row = this.database.prepare("SELECT * FROM outcomes WHERE id = ?").get(id);
      return { duplicate: false, outcome: outcomeFromRow(row) };
    });
  }

  recordEvidenceReference(idempotencyKey, requestId, input) {
    return this.#transaction(() => {
      const duplicateEvent = this.#eventByKey(idempotencyKey);
      this.#assertIdempotency(duplicateEvent, "evidence.recorded");
      if (duplicateEvent) {
        const row = this.database.prepare("SELECT * FROM evidence_refs WHERE idempotency_key = ?").get(idempotencyKey);
        return { duplicate: true, evidenceRef: evidenceRefFromRow(row) };
      }
      if (!this.getRequest(requestId)) {
        throw new LedgerError("REQUEST_NOT_FOUND", `request '${requestId}' does not exist`);
      }
      const dispatchIds = [input.dispatchId, input.producerDispatchId, input.verifierDispatchId].filter(Boolean);
      for (const dispatchId of dispatchIds) {
        const dispatch = this.getDispatch(dispatchId);
        if (!dispatch || dispatch.requestId !== requestId) {
          throw new LedgerError("DISPATCH_RELATION_INVALID", "evidence dispatches must belong to the request");
        }
      }
      const verifier = input.verifierDispatchId ? this.getDispatch(input.verifierDispatchId) : null;
      if (verifier && verifier.role !== "verifier") {
        throw new LedgerError("INDEPENDENT_VERIFIER_REQUIRED", "verifierDispatchId must name a verifier dispatch");
      }
      const id = `evr_${randomUUID()}`;
      this.database.prepare(`
        INSERT INTO evidence_refs (
          id, request_id, dispatch_id, idempotency_key, evidence_level, verification_status,
          producer_dispatch_id, verifier_dispatch_id, reference, content_hash, summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        requestId,
        input.dispatchId,
        idempotencyKey,
        input.level,
        input.verification,
        input.producerDispatchId,
        input.verifierDispatchId,
        input.reference,
        input.contentHash,
        input.summary,
        now(),
      );
      this.#insertEvent({
        idempotencyKey,
        requestId,
        dispatchId: input.dispatchId,
        type: "evidence.recorded",
        summary: `${input.level} evidence is ${input.verification}`,
        evidence: input.reference,
      });
      const row = this.database.prepare("SELECT * FROM evidence_refs WHERE id = ?").get(id);
      return { duplicate: false, evidenceRef: evidenceRefFromRow(row) };
    });
  }

  recordCandidateReference(idempotencyKey, requestId, input) {
    return this.#transaction(() => {
      const duplicateEvent = this.#eventByKey(idempotencyKey);
      this.#assertIdempotency(duplicateEvent, "candidate.ref.recorded");
      if (duplicateEvent) {
        const row = this.database.prepare(`
          SELECT * FROM candidate_refs WHERE request_id = ? AND candidate_ref = ?
        `).get(requestId, input.candidateRef);
        if (!row) throw new LedgerError("IDEMPOTENCY_CONFLICT", "idempotencyKey belongs to another candidate reference");
        return { duplicate: true, candidateRef: candidateRefFromRow(row) };
      }
      if (!this.getRequest(requestId)) {
        throw new LedgerError("REQUEST_NOT_FOUND", `request '${requestId}' does not exist`);
      }
      const current = this.database.prepare(`
        SELECT * FROM candidate_refs WHERE request_id = ? AND candidate_ref = ?
      `).get(requestId, input.candidateRef);
      if (current && current.candidate_fingerprint !== input.candidateFingerprint) {
        throw new LedgerError(
          "CANDIDATE_REF_CONFLICT",
          "candidateRef cannot be reassigned to a different fingerprint",
        );
      }
      const rollbackFields = [
        ["orchestratorRouteBlockedAt", "orchestrator_route_blocked_at"],
        ["canonicalSourceRolledBackAt", "canonical_source_rolled_back_at"],
        ["freshSessionNoLoadVerifiedAt", "fresh_session_no_load_verified_at"],
      ];
      for (const [inputKey, rowKey] of rollbackFields) {
        if (current?.[rowKey] && input[inputKey] && current[rowKey] !== input[inputKey]) {
          throw new LedgerError("ROLLBACK_MILESTONE_IMMUTABLE", "rollback milestone timestamps cannot be rewritten");
        }
        if (current?.[rowKey] && !input[inputKey]) input[inputKey] = current[rowKey];
      }
      if (input.orchestratorRouteBlockedAt) input.routingEligible = false;
      if (input.sourceStatus === "connected" && !input.lastTrustedAt) input.lastTrustedAt = now();
      if (input.sourceStatus !== "connected" && !input.lastTrustedAt && current?.last_trusted_at) {
        input.lastTrustedAt = current.last_trusted_at;
      }
      const id = current?.id ?? `crf_${randomUUID()}`;
      const originalKey = current?.idempotency_key ?? idempotencyKey;
      this.database.prepare(`
        INSERT INTO candidate_refs (
          id, request_id, idempotency_key, candidate_ref, candidate_fingerprint, asset_version, governance_source_id,
          source_status, candidate_status, validation_status, qualification_status, environment_fingerprint,
          promotion_destination, canonical_ref, activation_mode, local_record_status, enable_status,
          publish_status, value_gate_stage, value_gate_decision, capacity_status, routing_eligible, budget_locked,
          sample_plan_locked, pilot_cluster_locked, rollback_sla_locked, governance_endpoint_locked,
          orchestrator_route_blocked_at, canonical_source_rolled_back_at,
          fresh_session_no_load_verified_at, last_trusted_at, read_error_code, summary, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_id, candidate_ref) DO UPDATE SET
          asset_version = excluded.asset_version,
          governance_source_id = excluded.governance_source_id,
          source_status = excluded.source_status,
          candidate_status = excluded.candidate_status,
          validation_status = excluded.validation_status,
          qualification_status = excluded.qualification_status,
          environment_fingerprint = excluded.environment_fingerprint,
          promotion_destination = excluded.promotion_destination,
          canonical_ref = excluded.canonical_ref,
          activation_mode = excluded.activation_mode,
          local_record_status = excluded.local_record_status,
          enable_status = excluded.enable_status,
          publish_status = excluded.publish_status,
          value_gate_stage = excluded.value_gate_stage,
          value_gate_decision = excluded.value_gate_decision,
          capacity_status = excluded.capacity_status,
          routing_eligible = excluded.routing_eligible,
          budget_locked = excluded.budget_locked,
          sample_plan_locked = excluded.sample_plan_locked,
          pilot_cluster_locked = excluded.pilot_cluster_locked,
          rollback_sla_locked = excluded.rollback_sla_locked,
          governance_endpoint_locked = excluded.governance_endpoint_locked,
          orchestrator_route_blocked_at = excluded.orchestrator_route_blocked_at,
          canonical_source_rolled_back_at = excluded.canonical_source_rolled_back_at,
          fresh_session_no_load_verified_at = excluded.fresh_session_no_load_verified_at,
          last_trusted_at = excluded.last_trusted_at,
          read_error_code = excluded.read_error_code,
          summary = excluded.summary,
          updated_at = excluded.updated_at
      `).run(
        id,
        requestId,
        originalKey,
        input.candidateRef,
        input.candidateFingerprint,
        input.assetVersion,
        input.governanceSourceId,
        input.sourceStatus,
        input.candidateStatus,
        input.validationStatus,
        input.qualificationStatus,
        input.environmentFingerprint,
        input.promotionDestination,
        input.canonicalRef,
        input.activationMode,
        input.localRecordStatus,
        input.enableStatus,
        input.publishStatus,
        input.valueGateStage,
        input.valueGateDecision,
        input.capacityStatus,
        Number(input.routingEligible),
        Number(input.budgetLocked),
        Number(input.samplePlanLocked),
        Number(input.pilotClusterLocked),
        Number(input.rollbackSlaLocked),
        Number(input.governanceEndpointLocked),
        input.orchestratorRouteBlockedAt,
        input.canonicalSourceRolledBackAt,
        input.freshSessionNoLoadVerifiedAt,
        input.lastTrustedAt,
        input.readErrorCode,
        input.summary,
        now(),
      );
      this.#insertEvent({
        idempotencyKey,
        requestId,
        type: "candidate.ref.recorded",
        summary: `Candidate reference is ${input.candidateStatus}; ${input.valueGateStage} ${input.valueGateDecision}`,
      });
      const row = this.database.prepare("SELECT * FROM candidate_refs WHERE id = ?").get(id);
      return { duplicate: false, candidateRef: candidateRefFromRow(row) };
    });
  }

  updateDispatch(idempotencyKey, dispatchId, patch) {
    return this.#transaction(() => {
      const duplicateEvent = this.#eventByKey(idempotencyKey);
      this.#assertIdempotency(duplicateEvent, "dispatch.updated");
      if (duplicateEvent && duplicateEvent.dispatch_id !== dispatchId) {
        throw new LedgerError("IDEMPOTENCY_CONFLICT", "idempotencyKey belongs to another dispatch");
      }
      if (duplicateEvent) return { duplicate: true, dispatch: this.getDispatch(duplicateEvent.dispatch_id) };
      const current = this.getDispatch(dispatchId);
      if (!current) throw new LedgerError("DISPATCH_NOT_FOUND", `dispatch '${dispatchId}' does not exist`);
      if (["done", "failed", "cancelled"].includes(current.status) && patch.status === "running") {
        throw new LedgerError("TERMINAL_DISPATCH", "terminal dispatches cannot return to running; create a retry dispatch");
      }
      if (patch.status === "running") this.#assertDispatchCanRun(dispatchId);
      if (patch.verification === "PASS" && current.role === "worker"
        && !this.#independentPassEvidence(current.requestId, { producerDispatchId: dispatchId })) {
        throw new LedgerError(
          "INDEPENDENT_EVIDENCE_REQUIRED",
          "worker PASS requires immutable evidence from an independent verifier",
        );
      }
      const nextThreadId = Object.hasOwn(patch, "threadId") ? patch.threadId : current.threadId;
      const nextClientThreadId = Object.hasOwn(patch, "clientThreadId")
        ? patch.clientThreadId
        : current.clientThreadId;
      if (!nextThreadId && !nextClientThreadId) {
        throw new LedgerError("REAL_ID_REQUIRED", "a dispatch must keep a real threadId or clientThreadId");
      }
      const linked = this.database.prepare(`
        SELECT id FROM dispatches
        WHERE id <> ? AND (
          (? IS NOT NULL AND (thread_id = ? OR client_thread_id = ?))
          OR (? IS NOT NULL AND (thread_id = ? OR client_thread_id = ?))
        )
        LIMIT 1
      `).get(
        dispatchId,
        nextThreadId,
        nextThreadId,
        nextThreadId,
        nextClientThreadId,
        nextClientThreadId,
        nextClientThreadId,
      );
      if (linked) {
        throw new LedgerError(
          "ID_ALREADY_LINKED",
          "The supplied threadId or clientThreadId is already linked to another dispatch",
        );
      }
      const columns = {
        model: "model",
        effort: "effort",
        threadId: "thread_id",
        clientThreadId: "client_thread_id",
        workspacePath: "workspace_path",
        status: "status",
        verification: "verification_status",
        needsAttention: "needs_attention",
        attemptCount: "attempt_count",
        summary: "summary",
        evidence: "evidence",
      };
      const entries = Object.entries(patch);
      const assignments = entries.map(([key]) => `${columns[key]} = ?`);
      const values = entries.map(([key, value]) => key === "needsAttention" ? Number(value) : value);
      const timestamp = now();
      this.database.prepare(`UPDATE dispatches SET ${assignments.join(", ")}, updated_at = ? WHERE id = ?`)
        .run(...values, timestamp, dispatchId);
      this.#insertEvent({
        idempotencyKey,
        requestId: current.requestId,
        dispatchId,
        type: "dispatch.updated",
        summary: patch.summary ?? `Dispatch status is ${patch.status ?? current.status}`,
        evidence: patch.evidence ?? "",
      });
      return { duplicate: false, dispatch: this.getDispatch(dispatchId) };
    });
  }

  reconcile(idempotencyKey, observations) {
    return this.#transaction(() => {
      const duplicateEvent = this.#eventByKey(idempotencyKey);
      this.#assertIdempotency(duplicateEvent, "ledger.reconciled");
      if (duplicateEvent) return { duplicate: true, reconciled: 0, dispatches: [] };
      const results = [];
      for (const observation of observations) {
        const current = this.getDispatch(observation.dispatchId);
        if (!current) {
          results.push({ dispatchId: observation.dispatchId, status: "unknown", needsAttention: true });
          continue;
        }
        if (observation.threadId && observation.threadId !== current.threadId) {
          throw new LedgerError("ID_MISMATCH", `threadId does not match dispatch '${current.id}'`);
        }
        if (observation.clientThreadId && observation.clientThreadId !== current.clientThreadId) {
          throw new LedgerError("ID_MISMATCH", `clientThreadId does not match dispatch '${current.id}'`);
        }
        const uncertain = observation.observedStatus === "not_found" || observation.observedStatus === "unknown";
        const status = uncertain ? "unknown" : observation.observedStatus;
        const summary = observation.summary || (uncertain
          ? "Worker state could not be confirmed; manual handling is required"
          : `Observed dispatch status is ${status}`);
        this.database.prepare(`
          UPDATE dispatches
          SET status = ?, needs_attention = ?, summary = ?, evidence = ?, updated_at = ?
          WHERE id = ?
        `).run(status, Number(uncertain), summary, observation.evidence, now(), current.id);
        results.push(this.getDispatch(current.id));
      }
      this.#insertEvent({
        idempotencyKey,
        type: "ledger.reconciled",
        summary: `Reconciled ${observations.length} explicit dispatch observation(s); no work was dispatched`,
      });
      return { duplicate: false, reconciled: observations.length, dispatches: results };
    });
  }

  getDispatch(id) {
    const row = this.database.prepare("SELECT * FROM dispatches WHERE id = ?").get(id);
    const dispatch = dispatchFromRow(row);
    if (!dispatch || this.schemaVersion < 3) return dispatch;
    const relation = this.database.prepare(`
      SELECT parent_dispatch_id, logical_unit_key, retry_of_dispatch_id
      FROM dispatch_relations WHERE dispatch_id = ?
    `).get(id);
    dispatch.relation = relation ? {
      parentDispatchId: relation.parent_dispatch_id,
      logicalUnitKey: relation.logical_unit_key,
      retryOfDispatchId: relation.retry_of_dispatch_id,
    } : null;
    dispatch.dependencies = this.database.prepare(`
      SELECT depends_on_dispatch_id FROM dispatch_dependencies WHERE dispatch_id = ?
      ORDER BY depends_on_dispatch_id
    `).all(id).map((entry) => entry.depends_on_dispatch_id);
    dispatch.ownership = this.database.prepare(`
      SELECT object_key, access_mode, phase FROM dispatch_ownership WHERE dispatch_id = ?
      ORDER BY phase, object_key
    `).all(id).map((entry) => ({
      objectKey: entry.object_key,
      accessMode: entry.access_mode,
      phase: entry.phase,
    }));
    dispatch.runGate = this.#dispatchRunGate(id);
    return dispatch;
  }

  getRequest(id, { includeEvents = false } = {}) {
    const row = this.database.prepare("SELECT * FROM requests WHERE id = ?").get(id);
    const request = requestFromRow(row);
    if (!request) return null;
    if (this.schemaVersion < 3) {
      request.rootSessionId = null;
      request.lineageStatus = "legacy_unknown";
    }
    request.dispatches = this.database.prepare(
      "SELECT * FROM dispatches WHERE request_id = ? ORDER BY created_at, id",
    ).all(id).map((entry) => this.getDispatch(entry.id));
    request.sessions = [];
    request.routeDecisions = [];
    request.outcomes = [];
    request.evidenceRefs = [];
    request.candidateRefs = [];
    if (this.schemaVersion >= 3) {
      request.sessions = this.database.prepare(`
        SELECT session_id, relation, attached_at FROM request_sessions
        WHERE request_id = ? ORDER BY attached_at, session_id
      `).all(id).map((entry) => ({
        sessionId: entry.session_id,
        relation: entry.relation,
        attachedAt: entry.attached_at,
      }));
      request.routeDecisions = this.database.prepare(`
        SELECT * FROM route_decisions WHERE request_id = ? ORDER BY created_at, id
      `).all(id).map(routeDecisionFromRow);
      request.outcomes = this.database.prepare(`
        SELECT * FROM outcomes WHERE request_id = ? ORDER BY created_at, id
      `).all(id).map(outcomeFromRow);
      request.evidenceRefs = this.database.prepare(`
        SELECT * FROM evidence_refs WHERE request_id = ? ORDER BY created_at, id
      `).all(id).map(evidenceRefFromRow);
      request.candidateRefs = this.database.prepare(`
        SELECT * FROM candidate_refs WHERE request_id = ? ORDER BY updated_at DESC, id
      `).all(id).map(candidateRefFromRow);
    }
    if (includeEvents) {
      request.events = this.database.prepare(
        "SELECT * FROM events WHERE request_id = ? ORDER BY created_at, id",
      ).all(id).map(eventFromRow);
    }
    return request;
  }

  listRequests({ openOnly = false, limit = 500 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new LedgerError("INVALID_LIMIT", "limit must be an integer from 1 to 500");
    }
    const rows = this.database.prepare(`
      SELECT * FROM requests
      ${openOnly ? "WHERE status IN ('planning', 'running', 'verifying', 'waiting_user')" : ""}
      ORDER BY needs_user DESC, updated_at DESC, id
      LIMIT ?
    `).all(limit);
    return rows.map((row) => this.getRequest(row.id));
  }

  count(table) {
    if (!new Set([
      "requests", "dispatches", "events", "request_sessions", "dispatch_relations",
      "dispatch_dependencies", "dispatch_ownership", "route_decisions", "outcomes",
      "evidence_refs", "candidate_refs",
    ]).has(table)) {
      throw new LedgerError("INVALID_TABLE", "table is not countable");
    }
    return Number(this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  }

  inspect() {
    if (!READABLE_SCHEMA_VERSIONS.has(this.schemaVersion)) {
      throw new LedgerError(
        this.schemaVersion > SCHEMA_VERSION ? "SCHEMA_TOO_NEW" : "SCHEMA_NOT_READY",
        `orchestrator ledger schema version ${this.schemaVersion} is not supported`,
      );
    }
    return inspectDatabase(this.database, {
      schemaVersion: this.schemaVersion,
      compatibility: this.schemaCompatibility,
    });
  }

  close() {
    this.database.close();
  }
}

function parseReconcileObservations(value) {
  if (!Array.isArray(value) || value.length > 500) {
    throw new LedgerError("INVALID_FIELD", "observations must be an array with at most 500 entries");
  }
  return value.map((entry, index) => {
    assertPlainObject(entry, `observations[${index}]`);
    assertAllowedKeys(entry, new Set([
      "dispatchId", "threadId", "clientThreadId", "observedStatus", "summary", "evidence",
    ]), `observations[${index}]`);
    return {
      dispatchId: optionalId(entry.dispatchId, `observations[${index}].dispatchId`, { required: true }),
      threadId: optionalId(entry.threadId, `observations[${index}].threadId`) ?? null,
      clientThreadId: optionalId(entry.clientThreadId, `observations[${index}].clientThreadId`) ?? null,
      observedStatus: enumValue(
        entry.observedStatus,
        `observations[${index}].observedStatus`,
        ["running", "waiting_user", "done", "failed", "cancelled", "not_found", "unknown"],
      ),
      summary: stringValue(entry.summary ?? "", `observations[${index}].summary`, {
        maxLength: 600,
        shortSummary: true,
      }),
      evidence: stringValue(entry.evidence ?? "", `observations[${index}].evidence`, {
        maxLength: 1000,
        shortSummary: true,
      }),
    };
  });
}

export async function createLedgerBackup(databasePath, command) {
  assertPlainObject(command, "command");
  scanSensitive(command);
  assertAllowedKeys(command, new Set(["command", "destinationPath"]), "command");
  if (command.command !== "backup.create") {
    throw new LedgerError("UNKNOWN_COMMAND", "backup helper only accepts backup.create");
  }
  const destinationPath = absolutePath(command.destinationPath, "command.destinationPath");
  if (!destinationPath) {
    throw new LedgerError("INVALID_FIELD", "command.destinationPath is required");
  }
  const sourcePath = path.resolve(databasePath ?? "");
  const resolvedDestination = path.resolve(destinationPath);
  if (sourcePath === resolvedDestination) {
    throw new LedgerError("BACKUP_TARGET_INVALID", "backup destination must differ from the source database");
  }
  if (existsSync(resolvedDestination)) {
    throw new LedgerError("BACKUP_EXISTS", "backup destination already exists and will not be overwritten");
  }
  mkdirSync(path.dirname(resolvedDestination), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(resolvedDestination),
    `.${path.basename(resolvedDestination)}.partial-${randomUUID()}`,
  );
  let sourceLedger;
  let transactionOpen = false;
  try {
    sourceLedger = new OrchestratorLedger(sourcePath, { readOnly: true });
    sourceLedger.database.exec("BEGIN;");
    transactionOpen = true;
    const sourceInspection = sourceLedger.inspect();
    const copiedPages = await backup(sourceLedger.database, temporaryPath);
    sourceLedger.database.exec("COMMIT;");
    transactionOpen = false;
    sourceLedger.close();
    sourceLedger = null;

    chmodSync(temporaryPath, 0o600);
    const backupLedger = new OrchestratorLedger(temporaryPath, { readOnly: true });
    let backupInspection;
    try {
      backupInspection = backupLedger.inspect();
    } finally {
      backupLedger.close();
    }
    if (backupInspection.integrity !== "ok"
      || backupInspection.foreignKeyViolationCount !== 0
      || backupInspection.schemaDigest !== sourceInspection.schemaDigest
      || backupInspection.dataDigest !== sourceInspection.dataDigest) {
      throw new LedgerError(
        "BACKUP_VERIFICATION_FAILED",
        "online backup did not preserve ledger schema and business data fingerprints",
      );
    }
    try {
      linkSync(temporaryPath, resolvedDestination);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new LedgerError("BACKUP_EXISTS", "backup destination already exists and will not be overwritten");
      }
      throw error;
    }
    unlinkSync(temporaryPath);
    return {
      backupCreated: true,
      destinationPath: resolvedDestination,
      copiedPages,
      inspection: backupInspection,
      sourceDataDigest: sourceInspection.dataDigest,
    };
  } catch (error) {
    if (transactionOpen) {
      try { sourceLedger?.database.exec("ROLLBACK;"); } catch {}
    }
    try { sourceLedger?.close(); } catch {}
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(`${temporaryPath}${suffix}`); } catch {}
    }
    if (error instanceof LedgerError) throw error;
    throw new LedgerError(
      "BACKUP_FAILED",
      "the online backup could not be created; the source ledger was not modified",
    );
  }
}

export function executeLedgerCommand(ledger, command) {
  assertPlainObject(command, "command");
  scanSensitive(command);
  const name = stringValue(command.command, "command.command", { required: true, maxLength: 64 });
  const unsupportedRead = () => ({
    schemaVersion: ledger.schemaVersion,
    compatibility: ledger.schemaCompatibility,
    status: ledger.schemaCompatibility,
    readOnly: true,
    message: ledger.schemaCompatibility === "unsupported_newer_schema"
      ? "The ledger schema is newer than this Workstation; no records were read or changed"
      : "The ledger schema is not supported; no records were read or changed",
  });
  switch (name) {
    case "migrate": {
      assertAllowedKeys(command, new Set(["command"]), "command");
      return {
        migrated: true,
        schemaVersion: ledger.schemaVersion,
        compatibility: ledger.schemaCompatibility,
      };
    }
    case "database.inspect": {
      assertAllowedKeys(command, new Set(["command"]), "command");
      if (!READABLE_SCHEMA_VERSIONS.has(ledger.schemaVersion)) {
        return { ...unsupportedRead(), inspection: null };
      }
      return { readOnly: ledger.readOnly, inspection: ledger.inspect() };
    }
    case "request.create": {
      assertAllowedKeys(command, new Set(["command", "idempotencyKey", "request"]), "command");
      return ledger.createRequest(parseIdempotencyKey(command.idempotencyKey), parseRequestCreate(command.request));
    }
    case "request.update": {
      assertAllowedKeys(command, new Set(["command", "idempotencyKey", "requestId", "patch"]), "command");
      const requestId = optionalId(command.requestId, "requestId", { required: true });
      return ledger.updateRequest(
        parseIdempotencyKey(command.idempotencyKey),
        requestId,
        parseRequestPatch(command.patch),
      );
    }
    case "session.attach": {
      assertAllowedKeys(command, new Set(["command", "idempotencyKey", "requestId", "session"]), "command");
      const requestId = optionalId(command.requestId, "requestId", { required: true });
      return ledger.attachSession(
        parseIdempotencyKey(command.idempotencyKey),
        requestId,
        parseSessionAttach(command.session),
      );
    }
    case "dispatch.register": {
      assertAllowedKeys(command, new Set([
        "command", "idempotencyKey", "requestId", "dispatch",
      ]), "command");
      const requestId = optionalId(command.requestId, "requestId", { required: true });
      const idempotencyKey = parseIdempotencyKey(command.idempotencyKey);
      const persistedInput = parseDispatchCreate(command.dispatch, { allowLegacy: true });
      const replay = ledger.replayDispatchRegistration(idempotencyKey, requestId, persistedInput);
      if (replay) return replay;
      return ledger.registerDispatch(
        idempotencyKey,
        requestId,
        parseDispatchCreate(command.dispatch),
      );
    }
    case "dispatch.update": {
      assertAllowedKeys(command, new Set([
        "command", "idempotencyKey", "dispatchId", "patch",
      ]), "command");
      const dispatchId = optionalId(command.dispatchId, "dispatchId", { required: true });
      const existing = ledger.getDispatch(dispatchId);
      if (!existing) throw new LedgerError("DISPATCH_NOT_FOUND", `dispatch '${dispatchId}' does not exist`);
      return ledger.updateDispatch(
        parseIdempotencyKey(command.idempotencyKey),
        dispatchId,
        parseDispatchPatch(command.patch, existing),
      );
    }
    case "dispatch.resume": {
      assertAllowedKeys(command, new Set([
        "command", "idempotencyKey", "requestId", "dispatchId", "resume",
      ]), "command");
      return ledger.resumeDispatch(
        parseIdempotencyKey(command.idempotencyKey),
        optionalId(command.requestId, "requestId", { required: true }),
        optionalId(command.dispatchId, "dispatchId", { required: true }),
        parseDispatchResume(command.resume),
      );
    }
    case "open.list": {
      assertAllowedKeys(command, new Set(["command"]), "command");
      if (!READABLE_SCHEMA_VERSIONS.has(ledger.schemaVersion)) {
        return { ...unsupportedRead(), requests: null };
      }
      return {
        schemaVersion: ledger.schemaVersion,
        compatibility: ledger.schemaCompatibility,
        status: ledger.schemaCompatibility,
        readOnly: ledger.readOnly,
        requests: ledger.listRequests({ openOnly: true }),
      };
    }
    case "request.get": {
      assertAllowedKeys(command, new Set(["command", "requestId"]), "command");
      if (!READABLE_SCHEMA_VERSIONS.has(ledger.schemaVersion)) {
        return { ...unsupportedRead(), request: null };
      }
      const requestId = optionalId(command.requestId, "requestId", { required: true });
      const request = ledger.getRequest(requestId, { includeEvents: true });
      if (!request) throw new LedgerError("REQUEST_NOT_FOUND", `request '${requestId}' does not exist`);
      return {
        schemaVersion: ledger.schemaVersion,
        compatibility: ledger.schemaCompatibility,
        status: ledger.schemaCompatibility,
        readOnly: ledger.readOnly,
        request,
      };
    }
    case "ownership.check": {
      assertAllowedKeys(command, new Set(["command", "requestId", "ownershipCheck"]), "command");
      if (ledger.schemaVersion < 3 || ledger.schemaVersion > SCHEMA_VERSION) {
        return { ...unsupportedRead(), allowed: false, conflicts: [] };
      }
      const requestId = optionalId(command.requestId, "requestId", { required: true });
      const input = parseOwnershipCheck(command.ownershipCheck);
      return ledger.checkOwnership(requestId, input.ownership, input.dependencies);
    }
    case "reconcile": {
      assertAllowedKeys(command, new Set(["command", "idempotencyKey", "observations"]), "command");
      return ledger.reconcile(
        parseIdempotencyKey(command.idempotencyKey),
        parseReconcileObservations(command.observations),
      );
    }
    case "route.record": {
      assertAllowedKeys(command, new Set(["command", "idempotencyKey", "requestId", "route"]), "command");
      const requestId = optionalId(command.requestId, "requestId", { required: true });
      return ledger.recordRouteDecision(
        parseIdempotencyKey(command.idempotencyKey),
        requestId,
        parseRouteDecision(command.route),
      );
    }
    case "outcome.record": {
      assertAllowedKeys(command, new Set(["command", "idempotencyKey", "requestId", "outcome"]), "command");
      const requestId = optionalId(command.requestId, "requestId", { required: true });
      return ledger.recordOutcome(
        parseIdempotencyKey(command.idempotencyKey),
        requestId,
        parseOutcome(command.outcome),
      );
    }
    case "evidence.record": {
      assertAllowedKeys(command, new Set(["command", "idempotencyKey", "requestId", "evidenceRef"]), "command");
      const requestId = optionalId(command.requestId, "requestId", { required: true });
      return ledger.recordEvidenceReference(
        parseIdempotencyKey(command.idempotencyKey),
        requestId,
        parseEvidenceReference(command.evidenceRef),
      );
    }
    case "candidate.ref.record": {
      assertAllowedKeys(command, new Set(["command", "idempotencyKey", "requestId", "candidate"]), "command");
      const requestId = optionalId(command.requestId, "requestId", { required: true });
      return ledger.recordCandidateReference(
        parseIdempotencyKey(command.idempotencyKey),
        requestId,
        parseCandidateReference(command.candidate),
      );
    }
    default:
      throw new LedgerError(
        "UNKNOWN_COMMAND",
        "unsupported orchestrator command; use the documented machine-readable CLI contract",
      );
  }
}

export function isOpenRequestStatus(status) {
  return OPEN_REQUEST_STATUSES.has(status);
}
