import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  OrchestratorLedger,
  executeLedgerCommand,
} from "../nuyoah/taskboard/orchestrator-ledger.mjs";

const CLI_PATH = fileURLToPath(new URL("../scripts/orchestrator-ledger.mjs", import.meta.url));
const temporaryDirectories = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    await rm(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

async function fixturePath() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orchestrator-ledger-test-"));
  temporaryDirectories.push(directory);
  return path.join(directory, ".state", "orchestrator.sqlite3");
}

function createVersionTwoDatabase(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE requests (
      id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, goal TEXT NOT NULL,
      project_id TEXT, workspace_path TEXT, status TEXT NOT NULL,
      progress_completed INTEGER NOT NULL DEFAULT 0, progress_total INTEGER NOT NULL DEFAULT 0,
      verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED', needs_user INTEGER NOT NULL DEFAULT 0,
      attempt_count INTEGER NOT NULL DEFAULT 0, summary TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE dispatches (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL UNIQUE, role TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL,
      thread_id TEXT, client_thread_id TEXT, workspace_path TEXT, status TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED', needs_attention INTEGER NOT NULL DEFAULT 0,
      attempt_count INTEGER NOT NULL DEFAULT 1, summary TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      CHECK (thread_id IS NOT NULL OR client_thread_id IS NOT NULL)
    );
    CREATE UNIQUE INDEX dispatches_thread_id_unique ON dispatches(thread_id) WHERE thread_id IS NOT NULL;
    CREATE UNIQUE INDEX dispatches_client_thread_id_unique ON dispatches(client_thread_id) WHERE client_thread_id IS NOT NULL;
    CREATE INDEX dispatches_request_updated ON dispatches(request_id, updated_at DESC);
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, idempotency_key TEXT NOT NULL UNIQUE,
      request_id TEXT REFERENCES requests(id) ON DELETE CASCADE,
      dispatch_id TEXT REFERENCES dispatches(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE INDEX events_request_created ON events(request_id, created_at DESC, id DESC);
    CREATE TRIGGER dispatches_identity_insert BEFORE INSERT ON dispatches BEGIN
      SELECT CASE WHEN NEW.thread_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM dispatches WHERE thread_id = NEW.thread_id OR client_thread_id = NEW.thread_id
      ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
      SELECT CASE WHEN NEW.client_thread_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM dispatches WHERE thread_id = NEW.client_thread_id OR client_thread_id = NEW.client_thread_id
      ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
    END;
    CREATE TRIGGER dispatches_identity_update BEFORE UPDATE OF thread_id, client_thread_id ON dispatches BEGIN
      SELECT CASE WHEN NEW.thread_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM dispatches WHERE id <> OLD.id AND (thread_id = NEW.thread_id OR client_thread_id = NEW.thread_id)
      ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
      SELECT CASE WHEN NEW.client_thread_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM dispatches WHERE id <> OLD.id AND (thread_id = NEW.client_thread_id OR client_thread_id = NEW.client_thread_id)
      ) THEN RAISE(ABORT, 'dispatch identifier already linked') END;
    END;
    PRAGMA user_version = 2;
  `);
  return database;
}

function fileHash(filename) {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

function schemaSnapshot(database) {
  return database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
}

function immutableDatabase(databasePath) {
  return new DatabaseSync(`file:${databasePath}?immutable=1`, { readOnly: true });
}

function requestCreate(idempotencyKey, goal = "Deliver a verified request") {
  return {
    command: "request.create",
    idempotencyKey,
    request: {
      rootSessionId: `root:${idempotencyKey}`,
      goal,
      projectId: "project-1",
      workspacePath: "/tmp/project-1",
      status: "running",
      progressTotal: 2,
      summary: "Request registered",
    },
  };
}

function candidateReference(idempotencyKey, requestId, overrides = {}) {
  return {
    command: "candidate.ref.record",
    idempotencyKey,
    requestId,
    candidate: {
      candidateRef: "governance:candidate/candidate-1",
      candidateFingerprint: "sha256:candidate-fingerprint-1",
      assetVersion: "asset-v1",
      governanceSourceId: "nanyuan-skill-governance",
      sourceStatus: "connected",
      candidateStatus: "accepted",
      validationStatus: "PASS",
      qualificationStatus: "eligible",
      environmentFingerprint: "sha256:environment-1",
      promotionDestination: "project_memory",
      canonicalRef: "governance:asset/asset-v1",
      activationMode: "separate",
      localRecordStatus: "recorded",
      enableStatus: "enabled",
      publishStatus: "not_published",
      valueGateStage: "M0",
      valueGateDecision: "GO",
      capacityStatus: "available",
      routingEligible: true,
      budgetLocked: true,
      samplePlanLocked: true,
      pilotClusterLocked: true,
      rollbackSlaLocked: true,
      governanceEndpointLocked: true,
      summary: "External governance reference only",
      ...overrides,
    },
  };
}

function runCli(databasePath, command, { includeDatabasePath = true } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.NUYOAH_ORCHESTRATOR_DB;
    if (includeDatabasePath) env.NUYOAH_ORCHESTRATOR_DB = databasePath;
    const child = spawn(process.execPath, [CLI_PATH], { env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8");
      resolve({
        code,
        stdout: output,
        stderr: Buffer.concat(stderr).toString("utf8"),
        body: output ? JSON.parse(output) : null,
      });
    });
    child.stdin.end(`${JSON.stringify(command)}\n`);
  });
}

test("schema migration enables versioning, constraints, WAL, transactions, and independent tables", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    assert.equal(ledger.database.prepare("PRAGMA user_version").get().user_version, 7);
    assert.equal(ledger.database.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    assert.equal(ledger.database.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    assert.equal(ledger.database.prepare("PRAGMA busy_timeout").get().timeout, 5000);
    const tables = ledger.database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
        'requests', 'dispatches', 'events', 'request_sessions', 'dispatch_relations',
        'dispatch_dependencies', 'dispatch_ownership', 'route_decisions', 'outcomes',
        'evidence_refs', 'candidate_refs'
      )
      ORDER BY name
    `).all().map((row) => row.name);
    assert.deepEqual(tables, [
      "candidate_refs", "dispatch_dependencies", "dispatch_ownership", "dispatch_relations",
      "dispatches", "events", "evidence_refs", "outcomes", "request_sessions", "requests", "route_decisions",
    ]);
    const triggers = ledger.database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE 'dispatches_identity_%'
      ORDER BY name
    `).all().map((row) => row.name);
    assert.deepEqual(triggers, ["dispatches_identity_insert", "dispatches_identity_update"]);
  } finally {
    ledger.close();
  }
});

test("schema version 2 migrates additively and marks existing lineage unknown", async () => {
  const databasePath = await fixturePath();
  const database = createVersionTwoDatabase(databasePath);
  database.prepare(`
    INSERT INTO requests (
      id, idempotency_key, goal, status, progress_completed, progress_total,
      verification_status, needs_user, attempt_count, summary, evidence, created_at, updated_at
    ) VALUES ('req_legacy', 'legacy-key', 'Legacy request', 'running', 0, 0,
      'UNVERIFIED', 0, 0, '', '', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')
  `).run();
  database.close();

  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    assert.equal(ledger.schemaVersion, 7);
    const request = ledger.getRequest("req_legacy");
    assert.equal(request.rootSessionId, null);
    assert.equal(request.lineageStatus, "legacy_unknown");
    assert.deepEqual(request.sessions, []);
    assert.deepEqual(request.routeDecisions, []);
    assert.deepEqual(request.candidateRefs, []);
    assert.equal(ledger.count("requests"), 1);
  } finally {
    ledger.close();
  }
});

test("read commands preserve clean WAL v2 business state and create only SQLite WAL sidecars", async () => {
  const databasePath = await fixturePath();
  const database = createVersionTwoDatabase(databasePath);
  database.prepare(`
    INSERT INTO requests (
      id, idempotency_key, goal, status, created_at, updated_at
    ) VALUES ('req_read_only_v2', 'read-only-v2', 'Read without migration', 'running', ?, ?)
  `).run("2026-09-04T00:00:00.000Z", "2026-09-04T00:00:00.000Z");
  database.prepare("PRAGMA journal_mode = WAL").get();
  const schemaBefore = schemaSnapshot(database);
  database.close();

  const directory = path.dirname(databasePath);
  const databaseName = path.basename(databasePath);
  const filesBefore = readdirSync(directory).sort();
  const hashBefore = fileHash(databasePath);
  const mtimeBefore = statSync(databasePath, { bigint: true }).mtimeNs;
  assert.deepEqual(filesBefore, [databaseName]);

  const list = await runCli(databasePath, { command: "open.list" });
  assert.equal(list.code, 0);
  assert.equal(list.body.schemaVersion, 2);
  assert.equal(list.body.compatibility, "read_only_degraded");
  assert.equal(list.body.readOnly, true);
  assert.equal(list.body.requests.length, 1);
  const detail = await runCli(databasePath, { command: "request.get", requestId: "req_read_only_v2" });
  assert.equal(detail.code, 0);
  assert.equal(detail.body.request.lineageStatus, "legacy_unknown");

  assert.equal(fileHash(databasePath), hashBefore);
  assert.equal(statSync(databasePath, { bigint: true }).mtimeNs, mtimeBefore);
  const addedFiles = readdirSync(directory).filter((entry) => !filesBefore.includes(entry)).sort();
  assert.deepEqual(addedFiles, [`${databaseName}-shm`, `${databaseName}-wal`]);
  const inspected = immutableDatabase(databasePath);
  try {
    assert.equal(inspected.prepare("PRAGMA user_version").get().user_version, 2);
    assert.deepEqual(schemaSnapshot(inspected), schemaBefore);
    assert.equal(inspected.prepare("SELECT COUNT(*) AS count FROM requests").get().count, 1);
    assert.equal(inspected.prepare("SELECT COUNT(*) AS count FROM events").get().count, 0);
  } finally {
    inspected.close();
  }

  const rejectedWrite = await runCli(databasePath, requestCreate("v2-write-must-not-migrate"));
  assert.equal(rejectedWrite.code, 1);
  assert.equal(rejectedWrite.body.error.code, "MIGRATION_REQUIRED");
  const unchanged = new DatabaseSync(databasePath);
  try {
    assert.equal(unchanged.prepare("PRAGMA user_version").get().user_version, 2);
    assert.equal(unchanged.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'request_sessions'
    `).get().count, 0);
    assert.equal(unchanged.prepare("SELECT COUNT(*) AS count FROM requests").get().count, 1);
  } finally {
    unchanged.close();
  }

  const migrated = await runCli(databasePath, { command: "migrate" });
  assert.equal(migrated.code, 0);
  assert.equal(migrated.body.schemaVersion, 7);
  const current = new DatabaseSync(databasePath);
  try {
    assert.equal(current.prepare("PRAGMA user_version").get().user_version, 7);
    assert.equal(current.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'request_sessions'
    `).get().count, 1);
  } finally {
    current.close();
  }
});

test("read commands see uncheckpointed active WAL rows without business or migration writes", async () => {
  const databasePath = await fixturePath();
  const database = createVersionTwoDatabase(databasePath);
  const timestamp = "2026-09-04T00:00:00.000Z";
  const insert = database.prepare(`
    INSERT INTO requests (
      id, idempotency_key, goal, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'running', ?, ?)
  `);
  insert.run("req_checkpointed", "checkpointed", "Checkpointed request", timestamp, timestamp);
  database.prepare("PRAGMA journal_mode = WAL").get();
  database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  const schemaBefore = schemaSnapshot(database);
  insert.run("req_live_wal", "live-wal", "Live WAL request", timestamp, timestamp);
  const mainHashBefore = fileHash(databasePath);
  const mainMtimeBefore = statSync(databasePath, { bigint: true }).mtimeNs;
  const filesBefore = readdirSync(path.dirname(databasePath)).sort();

  try {
    const list = await runCli(databasePath, { command: "open.list" });
    assert.equal(list.code, 0);
    assert.equal(list.body.schemaVersion, 2);
    assert.deepEqual(list.body.requests.map((request) => request.id).sort(), [
      "req_checkpointed",
      "req_live_wal",
    ]);
    assert.equal(fileHash(databasePath), mainHashBefore);
    assert.equal(statSync(databasePath, { bigint: true }).mtimeNs, mainMtimeBefore);
    assert.deepEqual(readdirSync(path.dirname(databasePath)).sort(), filesBefore);
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 2);
    assert.deepEqual(schemaSnapshot(database), schemaBefore);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM requests").get().count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM events").get().count, 0);
  } finally {
    database.close();
  }
});

test("online backup captures active WAL, refuses overwrite, and can produce a verified recovery copy", async () => {
  const databasePath = await fixturePath();
  const backupPath = path.join(path.dirname(databasePath), "private-backups", "ledger-v5.backup.sqlite3");
  const recoveryPath = path.join(path.dirname(databasePath), "private-backups", "ledger-v5.recovery.sqlite3");
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  executeLedgerCommand(ledger, requestCreate("backup-checkpointed-request"));
  ledger.database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  executeLedgerCommand(ledger, requestCreate("backup-active-wal-request"));
  const mainHashBefore = fileHash(databasePath);
  const mainMtimeBefore = statSync(databasePath, { bigint: true }).mtimeNs;
  try {
    const created = await runCli(databasePath, { command: "backup.create", destinationPath: backupPath });
    assert.equal(created.code, 0, created.stdout);
    assert.equal(created.body.backupCreated, true);
    assert.equal(created.body.inspection.schemaVersion, 7);
    assert.equal(created.body.inspection.integrity, "ok");
    assert.equal(created.body.inspection.foreignKeyViolationCount, 0);
    assert.equal(created.body.inspection.tables.requests.rowCount, 2);
    assert.equal(created.body.sourceDataDigest, created.body.inspection.dataDigest);
    assert.equal(statSync(backupPath).mode & 0o777, 0o600);
    assert.equal(fileHash(databasePath), mainHashBefore);
    assert.equal(statSync(databasePath, { bigint: true }).mtimeNs, mainMtimeBefore);

    const sourceInspection = await runCli(databasePath, { command: "database.inspect" });
    const backupInspection = await runCli(backupPath, { command: "database.inspect" });
    assert.equal(sourceInspection.code, 0);
    assert.equal(backupInspection.code, 0);
    assert.equal(backupInspection.body.inspection.dataDigest, sourceInspection.body.inspection.dataDigest);
    assert.deepEqual(backupInspection.body.inspection.tables, sourceInspection.body.inspection.tables);

    const backupHash = fileHash(backupPath);
    const overwrite = await runCli(databasePath, { command: "backup.create", destinationPath: backupPath });
    assert.equal(overwrite.code, 1);
    assert.equal(overwrite.body.error.code, "BACKUP_EXISTS");
    assert.equal(fileHash(backupPath), backupHash);

    const recovered = await runCli(backupPath, { command: "backup.create", destinationPath: recoveryPath });
    assert.equal(recovered.code, 0, recovered.stdout);
    const recoveryInspection = await runCli(recoveryPath, { command: "database.inspect" });
    assert.equal(recoveryInspection.code, 0);
    assert.equal(recoveryInspection.body.inspection.schemaDigest, backupInspection.body.inspection.schemaDigest);
    assert.equal(recoveryInspection.body.inspection.dataDigest, backupInspection.body.inspection.dataDigest);
    assert.deepEqual(recoveryInspection.body.inspection.tables, backupInspection.body.inspection.tables);
  } finally {
    ledger.close();
  }
});

test("new requests require explicit immutable root lineage in both API and database gates", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    assert.throws(() => executeLedgerCommand(ledger, {
      command: "request.create",
      idempotencyKey: "missing-root-request",
      request: { goal: "Must not be created" },
    }), (error) => error.code === "INVALID_FIELD");
    assert.throws(() => ledger.database.prepare(`
      INSERT INTO requests (
        id, idempotency_key, root_session_id, lineage_status, goal, status,
        created_at, updated_at
      ) VALUES ('req_direct_null_root', 'direct-null-root', NULL, 'legacy_unknown',
        'Direct null root', 'planning', ?, ?)
    `).run("2026-09-04T00:00:00.000Z", "2026-09-04T00:00:00.000Z"), /explicit root session/);
    assert.equal(ledger.count("requests"), 0);
  } finally {
    ledger.close();
  }
});

test("schema version 3 migrates additively without losing existing requests or dispatches", async () => {
  const databasePath = await fixturePath();
  let ledger = new OrchestratorLedger(databasePath, { migrate: true });
  const request = executeLedgerCommand(
    ledger,
    requestCreate("schema-v1-preserved-request", "Preserve version one data"),
  ).request;
  const dispatch = executeLedgerCommand(ledger, {
    command: "dispatch.register",
    idempotencyKey: "schema-v1-preserved-dispatch",
    requestId: request.id,
    dispatch: {
      role: "worker",
      model: "gpt-6-astra",
      effort: "medium",
      clientThreadId: "schema-v1-client-1",
    },
  }).dispatch;
  ledger.database.exec(`
    DROP TRIGGER dispatches_running_dependency_gate;
    DROP TRIGGER dispatch_dependencies_running_insert_gate;
    DROP TRIGGER dispatches_running_ownership_gate;
    DROP TRIGGER dispatch_ownership_running_insert_gate;
    DROP TRIGGER dispatch_ownership_running_update_gate;
    DROP TRIGGER outcomes_immutable_update;
    DROP TRIGGER outcomes_immutable_delete;
    DROP TRIGGER evidence_refs_immutable_update;
    DROP TRIGGER evidence_refs_immutable_delete;
    DROP TRIGGER evidence_refs_pass_gate;
    DROP TRIGGER outcomes_pass_evidence_gate;
    DROP TRIGGER requests_lineage_insert_gate;
    DROP TRIGGER requests_pass_insert_gate;
    DROP TRIGGER requests_pass_update_gate;
    DROP TRIGGER candidate_refs_routing_insert_gate;
    DROP TRIGGER candidate_refs_routing_update_gate;
    PRAGMA user_version = 3;
  `);
  ledger.close();

  ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    assert.equal(ledger.database.prepare("PRAGMA user_version").get().user_version, 7);
    assert.equal(ledger.database.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE 'dispatches_identity_%'
    `).get().count, 2);
    const restored = ledger.getRequest(request.id, { includeEvents: true });
    assert.equal(restored.goal, "Preserve version one data");
    assert.equal(restored.dispatches.length, 1);
    assert.equal(restored.dispatches[0].id, dispatch.id);
    assert.equal(restored.events.length, 2);
    assert.equal(ledger.count("requests"), 1);
    assert.equal(ledger.count("dispatches"), 1);
    assert.equal(ledger.count("events"), 2);
  } finally {
    ledger.close();
  }
});

test("schema version 4 migrates to the current model pool without changing any historical row", async () => {
  const databasePath = await fixturePath();
  let ledger = new OrchestratorLedger(databasePath, { migrate: true });
  const requestId = executeLedgerCommand(ledger, requestCreate("model-pool-v4-request")).request.id;
  const currentDispatch = executeLedgerCommand(ledger, {
    command: "dispatch.register",
    idempotencyKey: "model-pool-v4-current",
    requestId,
    dispatch: {
      role: "worker",
      model: "gpt-6-astra",
      effort: "medium",
      threadId: "model-pool-v4-current-thread",
      status: "done",
      ownership: [{ objectKey: "ledger:model-pool", accessMode: "read", phase: "migration" }],
    },
  }).dispatch;
  ledger.close();

  const versionFour = new DatabaseSync(databasePath);
  const timestamp = "2026-09-05T00:00:00.000Z";
  versionFour.exec(`
    DROP TRIGGER dispatches_current_model_insert;
    DROP TRIGGER dispatches_legacy_model_update;
    PRAGMA user_version = 4;
  `);
  versionFour.prepare(`
    INSERT INTO dispatches (
      id, request_id, idempotency_key, role, model, effort, thread_id, status,
      verification_status, needs_attention, attempt_count, summary, evidence, created_at, updated_at
    ) VALUES (?, ?, ?, 'worker', 'gpt-5.6-luna', 'medium', ?, 'running',
      'UNVERIFIED', 0, 1, '', '', ?, ?)
  `).run(
    "dsp_legacy_luna",
    requestId,
    "model-pool-v4-legacy",
    "model-pool-v4-legacy-thread",
    timestamp,
    timestamp,
  );
  versionFour.prepare(`
    INSERT INTO events (
      idempotency_key, request_id, dispatch_id, event_type, summary, evidence, created_at
    ) VALUES (?, ?, ?, 'dispatch.registered', 'Historical Luna worker registered', '', ?)
  `).run("model-pool-v4-legacy", requestId, "dsp_legacy_luna", timestamp);
  versionFour.close();

  const before = await runCli(databasePath, { command: "database.inspect" });
  assert.equal(before.code, 0);
  assert.equal(before.body.inspection.schemaVersion, 4);
  assert.equal(before.body.inspection.integrity, "ok");
  assert.equal(before.body.inspection.foreignKeyViolationCount, 0);
  const migrated = await runCli(databasePath, { command: "migrate" });
  assert.equal(migrated.code, 0);
  assert.equal(migrated.body.schemaVersion, 7);
  const after = await runCli(databasePath, { command: "database.inspect" });
  assert.equal(after.code, 0);
  assert.equal(after.body.inspection.schemaVersion, 7);
  assert.equal(after.body.inspection.dataDigest, before.body.inspection.dataDigest);
  assert.deepEqual(after.body.inspection.tables, before.body.inspection.tables);
  assert.notEqual(after.body.inspection.schemaDigest, before.body.inspection.schemaDigest);

  ledger = new OrchestratorLedger(databasePath);
  try {
    assert.equal(ledger.getDispatch(currentDispatch.id).model, "gpt-6-astra");
    assert.equal(ledger.getDispatch("dsp_legacy_luna").model, "gpt-5.6-luna");
    const eventCountBeforeReplay = ledger.count("events");
    const replayedLegacy = executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "model-pool-v4-legacy",
      requestId,
      dispatch: {
        role: "worker",
        model: "gpt-5.6-luna",
        effort: "medium",
        threadId: "model-pool-v4-legacy-thread",
      },
    });
    assert.equal(replayedLegacy.duplicate, true);
    assert.equal(replayedLegacy.dispatch.id, "dsp_legacy_luna");
    assert.equal(replayedLegacy.dispatch.model, "gpt-5.6-luna");
    assert.equal(ledger.count("events"), eventCountBeforeReplay);
    const updatedLegacy = executeLedgerCommand(ledger, {
      command: "dispatch.update",
      idempotencyKey: "model-pool-v4-legacy-status",
      dispatchId: "dsp_legacy_luna",
      patch: { status: "done", summary: "Historical worker completed" },
    });
    assert.equal(updatedLegacy.dispatch.status, "done");
    assert.equal(updatedLegacy.dispatch.model, "gpt-5.6-luna");
    assert.throws(() => executeLedgerCommand(ledger, {
      command: "dispatch.update",
      idempotencyKey: "model-pool-v4-legacy-model-change",
      dispatchId: "dsp_legacy_luna",
      patch: { model: "gpt-6-astra", effort: "medium" },
    }), (error) => error.code === "LEGACY_MODEL_IMMUTABLE");
    assert.throws(() => executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "model-pool-new-luna",
      requestId,
      dispatch: {
        role: "worker",
        model: "gpt-5.6-luna",
        effort: "medium",
        threadId: "model-pool-new-luna-thread",
      },
    }), (error) => error.code === "UNSUPPORTED_MODEL");
    const astra = executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "model-pool-new-astra",
      requestId,
      dispatch: {
        role: "verifier",
        model: "gpt-6-astra",
        effort: "xhigh",
        threadId: "model-pool-new-astra-thread",
      },
    }).dispatch;
    assert.equal(astra.model, "gpt-6-astra");
    assert.equal(astra.effort, "xhigh");
    assert.throws(() => ledger.database.prepare(`
      INSERT INTO dispatches (
        id, request_id, idempotency_key, role, model, effort, thread_id, status, created_at, updated_at
      ) VALUES ('dsp_direct_luna', ?, 'direct-luna', 'worker', 'gpt-5.6-luna', 'medium',
        'direct-luna-thread', 'registered', ?, ?)
    `).run(requestId, timestamp, timestamp), /legacy model cannot be used/);
    assert.throws(() => ledger.database.prepare(`
      INSERT INTO dispatches (
        id, request_id, idempotency_key, role, model, effort, thread_id, status, created_at, updated_at
      ) VALUES ('dsp_direct_astra_low', ?, 'direct-astra-low', 'worker', 'gpt-6-astra', 'low',
        'direct-astra-medium-thread', 'registered', ?, ?)
    `).run(requestId, timestamp, timestamp), /CHECK constraint failed/);
  } finally {
    ledger.close();
  }
});

test("model-pool migration failure rolls back the whole schema and keeps the incompatible row", async () => {
  const databasePath = await fixturePath();
  let ledger = new OrchestratorLedger(databasePath, { migrate: true });
  const requestId = executeLedgerCommand(ledger, requestCreate("model-pool-rollback-request")).request.id;
  ledger.close();
  const versionFour = new DatabaseSync(databasePath);
  const timestamp = "2026-09-05T00:00:00.000Z";
  versionFour.exec(`
    DROP TRIGGER dispatches_current_model_insert;
    DROP TRIGGER dispatches_legacy_model_update;
    PRAGMA ignore_check_constraints = ON;
    PRAGMA user_version = 4;
  `);
  versionFour.prepare(`
    INSERT INTO dispatches (
      id, request_id, idempotency_key, role, model, effort, thread_id, status, created_at, updated_at
    ) VALUES ('dsp_invalid_pair', ?, 'invalid-pair', 'worker', 'gpt-5.6-terra', 'low',
      'invalid-pair-thread', 'registered', ?, ?)
  `).run(requestId, timestamp, timestamp);
  versionFour.close();

  const result = await runCli(databasePath, { command: "migrate" });
  assert.equal(result.code, 1);
  assert.equal(result.body.error.code, "MIGRATION_FAILED");
  const unchanged = new DatabaseSync(databasePath);
  try {
    assert.equal(unchanged.prepare("PRAGMA user_version").get().user_version, 4);
    assert.equal(unchanged.prepare("SELECT model FROM dispatches WHERE id = 'dsp_invalid_pair'").get().model, "gpt-5.6-terra");
    assert.equal(unchanged.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('dispatches_v6', 'dispatches_v7')
    `).get().count, 0);
  } finally {
    unchanged.close();
  }
});

test("schema migration diagnoses an existing cross-column collision without exposing its identifier", async () => {
  const databasePath = await fixturePath();
  const database = createVersionTwoDatabase(databasePath);
  database.exec(`
    DROP TRIGGER dispatches_identity_insert;
    DROP TRIGGER dispatches_identity_update;
    PRAGMA user_version = 1;
  `);
  const timestamp = "2026-09-04T00:00:00.000Z";
  database.prepare(`
    INSERT INTO requests (
      id, idempotency_key, goal, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'running', ?, ?)
  `).run("req_collision_a", "collision-request-a", "Collision A", timestamp, timestamp);
  database.prepare(`
    INSERT INTO requests (
      id, idempotency_key, goal, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'running', ?, ?)
  `).run("req_collision_b", "collision-request-b", "Collision B", timestamp, timestamp);
  const insertDispatch = database.prepare(`
    INSERT INTO dispatches (
      id, request_id, idempotency_key, role, model, effort, thread_id, client_thread_id,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, 'worker', 'gpt-5.6-terra', 'medium', ?, ?, 'registered', ?, ?)
  `);
  insertDispatch.run(
    "dsp_collision_a", "req_collision_a", "collision-dispatch-a",
    null, "opaque-migration-collision-1", timestamp, timestamp,
  );
  insertDispatch.run(
    "dsp_collision_b", "req_collision_b", "collision-dispatch-b",
    "opaque-migration-collision-1", null, timestamp, timestamp,
  );
  database.close();

  const read = await runCli(databasePath, { command: "open.list" });
  assert.equal(read.code, 0);
  assert.equal(read.body.status, "unsupported_older_schema");
  assert.equal(read.body.requests, null);
  const result = await runCli(databasePath, { command: "migrate" });
  assert.equal(result.code, 1);
  assert.equal(result.body.error.code, "IDENTIFIER_COLLISION");
  assert.equal(result.stdout.includes("opaque-migration-collision-1"), false);
  assert.equal(result.stderr, "");
  const unchanged = new DatabaseSync(databasePath);
  try {
    assert.equal(unchanged.prepare("PRAGMA user_version").get().user_version, 1);
    assert.equal(unchanged.prepare("SELECT COUNT(*) AS count FROM dispatches").get().count, 2);
  } finally {
    unchanged.close();
  }
});

test("request mutations are globally idempotent and persist across reopen", async () => {
  const databasePath = await fixturePath();
  let ledger = new OrchestratorLedger(databasePath, { migrate: true });
  const command = requestCreate("request-idempotency-1");
  const first = executeLedgerCommand(ledger, command);
  const duplicate = executeLedgerCommand(ledger, command);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.request.id, first.request.id);
  assert.equal(ledger.count("requests"), 1);
  assert.equal(ledger.count("events"), 1);
  ledger.close();

  ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const restored = executeLedgerCommand(ledger, { command: "open.list" });
    assert.equal(restored.requests.length, 1);
    assert.equal(restored.requests[0].id, first.request.id);
  } finally {
    ledger.close();
  }
});

test("two CLI processes serialize the same idempotency key without duplicate requests", async () => {
  const databasePath = await fixturePath();
  assert.equal((await runCli(databasePath, { command: "migrate" })).code, 0);
  const command = requestCreate("concurrent-request-1");
  const results = await Promise.all([runCli(databasePath, command), runCli(databasePath, command)]);
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 0], JSON.stringify(results));
  assert.equal(results.filter((result) => result.body.duplicate === false).length, 1);
  assert.equal(results.filter((result) => result.body.duplicate === true).length, 1);
  assert.equal(new Set(results.map((result) => result.body.request.id)).size, 1);
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    assert.equal(ledger.count("requests"), 1);
    assert.equal(ledger.count("events"), 1);
  } finally {
    ledger.close();
  }
});

test("request updates keep run status and verification separate and are idempotent", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const requestId = executeLedgerCommand(ledger, requestCreate("request-update-parent")).request.id;
    const command = {
      command: "request.update",
      idempotencyKey: "request-update-1",
      requestId,
      patch: {
        status: "verifying",
        progressCompleted: 1,
        progressTotal: 2,
        verification: "PARTIAL",
        needsUser: true,
        summary: "Waiting for one verification result",
      },
    };
    const first = executeLedgerCommand(ledger, command);
    const duplicate = executeLedgerCommand(ledger, command);
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(first.request.status, "verifying");
    assert.equal(first.request.verification, "PARTIAL");
    assert.deepEqual(first.request.progress, { completed: 1, total: 2 });
    assert.equal(first.request.needsUser, true);
    assert.equal(ledger.count("events"), 2);
  } finally {
    ledger.close();
  }
});

test("root session remains immutable while recovery sessions append without duplicating work", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const request = executeLedgerCommand(ledger, {
      ...requestCreate("lineage-request-1", "Recover this request"),
      request: { ...requestCreate("unused").request, rootSessionId: "session-origin-1" },
    }).request;
    assert.equal(request.rootSessionId, "session-origin-1");
    assert.equal(request.lineageStatus, "known");
    assert.equal(request.sessions[0].relation, "origin");

    const resumed = executeLedgerCommand(ledger, {
      command: "session.attach",
      idempotencyKey: "lineage-resume-1",
      requestId: request.id,
      session: { sessionId: "session-resume-1", relation: "resume" },
    });
    assert.equal(resumed.request.rootSessionId, "session-origin-1");
    assert.deepEqual(resumed.request.sessions.map((entry) => entry.relation), ["origin", "resume"]);
    assert.equal(executeLedgerCommand(ledger, {
      command: "session.attach",
      idempotencyKey: "lineage-resume-1",
      requestId: request.id,
      session: { sessionId: "session-resume-1", relation: "resume" },
    }).duplicate, true);
    assert.throws(() => executeLedgerCommand(ledger, {
      command: "request.update",
      idempotencyKey: "lineage-rewrite-1",
      requestId: request.id,
      patch: { rootSessionId: "session-other" },
    }), (error) => error.code === "ROOT_SESSION_IMMUTABLE");
    assert.equal(executeLedgerCommand(ledger, { command: "open.list" }).requests.length, 1);
    const fetched = executeLedgerCommand(ledger, { command: "request.get", requestId: request.id });
    assert.equal(fetched.schemaVersion, 7);
    assert.equal(fetched.request.sessions.length, 2);
  } finally {
    ledger.close();
  }
});

test("dispatch ownership conflicts require explicit serialization and preserve dependency lineage", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const requestId = executeLedgerCommand(ledger, requestCreate("ownership-parent-1")).request.id;
    const first = executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "ownership-dispatch-1",
      requestId,
      dispatch: {
        role: "worker", model: "gpt-6-luna", effort: "medium", threadId: "ownership-thread-1",
        logicalUnitKey: "implementation", ownership: [{ objectKey: "file:nuyoah/taskboard/ledger", accessMode: "write", phase: "implementation" }],
      },
    }).dispatch;
    const preflight = executeLedgerCommand(ledger, {
      command: "ownership.check",
      requestId,
      ownershipCheck: {
        ownership: [{ objectKey: "file:nuyoah/taskboard/ledger", accessMode: "write", phase: "implementation" }],
      },
    });
    assert.equal(preflight.allowed, false);
    assert.equal(preflight.conflicts[0].dispatchId, first.id);
    assert.throws(() => executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "ownership-dispatch-conflict",
      requestId,
      dispatch: {
        role: "worker", model: "gpt-6-luna", effort: "medium", threadId: "ownership-thread-2",
        ownership: [{ objectKey: "file:nuyoah/taskboard/ledger", accessMode: "write", phase: "implementation" }],
      },
    }), (error) => error.code === "OWNERSHIP_CONFLICT");

    const serialized = executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "ownership-dispatch-serialized",
      requestId,
      dispatch: {
        role: "verifier", model: "gpt-6-sol", effort: "high", threadId: "ownership-thread-3",
        dependencies: [first.id], retryOfDispatchId: first.id,
        ownership: [{ objectKey: "file:nuyoah/taskboard/ledger", accessMode: "read", phase: "implementation" }],
      },
    }).dispatch;
    assert.deepEqual(serialized.dependencies, [first.id]);
    assert.equal(serialized.relation.retryOfDispatchId, first.id);
    assert.equal(serialized.ownership[0].accessMode, "read");
  } finally {
    ledger.close();
  }
});

test("registered dispatches cannot run before dependencies finish or while writer ownership overlaps", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const requestId = executeLedgerCommand(ledger, requestCreate("run-gate-parent")).request.id;
    const first = executeLedgerCommand(ledger, {
      command: "dispatch.register", idempotencyKey: "run-gate-first", requestId,
      dispatch: {
        role: "worker", model: "gpt-6-luna", effort: "medium",
        threadId: "run-gate-thread-1", status: "registered",
        ownership: [{ objectKey: "file:shared", accessMode: "write", phase: "implementation" }],
      },
    }).dispatch;
    assert.throws(() => executeLedgerCommand(ledger, {
      command: "dispatch.register", idempotencyKey: "run-gate-direct-running", requestId,
      dispatch: {
        role: "worker", model: "gpt-6-luna", effort: "medium",
        threadId: "run-gate-too-early", status: "running", dependencies: [first.id],
        ownership: [{ objectKey: "file:shared", accessMode: "write", phase: "implementation" }],
      },
    }), (error) => error.code === "DEPENDENCY_NOT_READY");
    assert.equal(ledger.database.prepare(
      "SELECT COUNT(*) AS count FROM dispatches WHERE thread_id = 'run-gate-too-early'",
    ).get().count, 0);
    const second = executeLedgerCommand(ledger, {
      command: "dispatch.register", idempotencyKey: "run-gate-second", requestId,
      dispatch: {
        role: "worker", model: "gpt-6-luna", effort: "medium",
        threadId: "run-gate-thread-2", status: "registered", dependencies: [first.id],
        ownership: [{ objectKey: "file:shared", accessMode: "write", phase: "implementation" }],
      },
    }).dispatch;
    assert.equal(second.runGate.ready, false);
    assert.equal(second.runGate.blockedByDependencies[0].dispatchId, first.id);
    assert.throws(() => executeLedgerCommand(ledger, {
      command: "dispatch.update", idempotencyKey: "run-gate-second-too-early",
      dispatchId: second.id, patch: { status: "running" },
    }), (error) => error.code === "DEPENDENCY_NOT_READY");
    assert.throws(
      () => ledger.database.prepare("UPDATE dispatches SET status = 'running' WHERE id = ?").run(second.id),
      /dependencies are not done/,
    );

    executeLedgerCommand(ledger, {
      command: "dispatch.update", idempotencyKey: "run-gate-first-running",
      dispatchId: first.id, patch: { status: "running" },
    });
    executeLedgerCommand(ledger, {
      command: "dispatch.update", idempotencyKey: "run-gate-first-done",
      dispatchId: first.id, patch: { status: "done" },
    });
    const started = executeLedgerCommand(ledger, {
      command: "dispatch.update", idempotencyKey: "run-gate-second-running",
      dispatchId: second.id, patch: { status: "running" },
    }).dispatch;
    assert.equal(started.status, "running");
    assert.equal(started.runGate.ready, true);

    const reader = executeLedgerCommand(ledger, {
      command: "dispatch.register", idempotencyKey: "run-gate-reader", requestId,
      dispatch: {
        role: "worker", model: "gpt-6-luna", effort: "medium",
        threadId: "run-gate-reader-thread", status: "running",
        ownership: [{ objectKey: "file:other", accessMode: "read", phase: "implementation" }],
      },
    }).dispatch;
    assert.throws(
      () => ledger.database.prepare(`
        UPDATE dispatch_ownership SET object_key = 'file:shared'
        WHERE dispatch_id = ? AND object_key = 'file:other'
      `).run(reader.id),
      /ownership conflicts/,
    );
    assert.throws(
      () => ledger.database.prepare(`
        INSERT INTO dispatch_ownership (dispatch_id, object_key, access_mode, phase)
        VALUES (?, 'file:shared', 'read', 'implementation')
      `).run(reader.id),
      /ownership conflicts/,
    );
  } finally {
    ledger.close();
  }
});

test("ownership conflicts are global across requests and can be serialized explicitly", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const firstRequestId = executeLedgerCommand(ledger, requestCreate("global-owner-parent-1")).request.id;
    const secondRequestId = executeLedgerCommand(ledger, requestCreate("global-owner-parent-2")).request.id;
    const first = executeLedgerCommand(ledger, {
      command: "dispatch.register", idempotencyKey: "global-owner-dispatch-1", requestId: firstRequestId,
      dispatch: {
        role: "worker", model: "gpt-6-luna", effort: "medium", threadId: "global-owner-thread-1",
        ownership: [{ objectKey: "registry:shared-object", accessMode: "write", phase: "promotion" }],
      },
    }).dispatch;
    const blocked = executeLedgerCommand(ledger, {
      command: "ownership.check", requestId: secondRequestId,
      ownershipCheck: { ownership: [{ objectKey: "registry:shared-object", accessMode: "read", phase: "promotion" }] },
    });
    assert.equal(blocked.allowed, false);
    const serialized = executeLedgerCommand(ledger, {
      command: "dispatch.register", idempotencyKey: "global-owner-dispatch-2", requestId: secondRequestId,
      dispatch: {
        role: "worker", model: "gpt-6-luna", effort: "medium", threadId: "global-owner-thread-2",
        dependencies: [first.id],
        ownership: [{ objectKey: "registry:shared-object", accessMode: "read", phase: "promotion" }],
      },
    }).dispatch;
    assert.deepEqual(serialized.dependencies, [first.id]);
  } finally {
    ledger.close();
  }
});

test("explicit parent linkage and ID repair keep one dispatch for one real child", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const request = executeLedgerCommand(ledger, requestCreate("parent-request-1")).request;
    const registered = executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "client-dispatch-1",
      requestId: request.id,
      dispatch: {
        role: "worker",
        model: "gpt-6-luna",
        effort: "medium",
        clientThreadId: "client-123",
        status: "registered",
      },
    }).dispatch;
    const repaired = executeLedgerCommand(ledger, {
      command: "dispatch.update",
      idempotencyKey: "client-dispatch-repair-1",
      dispatchId: registered.id,
      patch: { threadId: "thread-123", status: "running" },
    }).dispatch;
    assert.equal(repaired.id, registered.id);
    assert.equal(repaired.requestId, request.id);
    assert.equal(repaired.clientThreadId, "client-123");
    assert.equal(repaired.threadId, "thread-123");

    const reused = executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "client-dispatch-second-key",
      requestId: request.id,
      dispatch: {
        role: "worker",
        model: "gpt-6-luna",
        effort: "medium",
        threadId: "thread-123",
      },
    });
    assert.equal(reused.duplicate, true);
    assert.equal(reused.reused, true);
    assert.equal(reused.dispatch.id, registered.id);
    assert.equal(ledger.count("dispatches"), 1);
    assert.equal(ledger.getRequest(request.id).dispatches.length, 1);
  } finally {
    ledger.close();
  }
});

test("cross-column identity conflicts are rejected for register and update while same-row repair works", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const firstRequestId = executeLedgerCommand(
      ledger,
      requestCreate("cross-column-parent-a"),
    ).request.id;
    const secondRequestId = executeLedgerCommand(
      ledger,
      requestCreate("cross-column-parent-b"),
    ).request.id;
    const first = executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "cross-column-dispatch-a",
      requestId: firstRequestId,
      dispatch: {
        role: "worker",
        model: "gpt-6-luna",
        effort: "medium",
        clientThreadId: "opaque-cross-sequential-1",
      },
    }).dispatch;

    assert.throws(
      () => executeLedgerCommand(ledger, {
        command: "dispatch.register",
        idempotencyKey: "cross-column-dispatch-b-conflict",
        requestId: secondRequestId,
        dispatch: {
          role: "worker",
          model: "gpt-6-luna",
          effort: "medium",
          threadId: "opaque-cross-sequential-1",
        },
      }),
      (error) => error.code === "ID_ALREADY_LINKED" && !error.message.includes("opaque-cross-sequential-1"),
    );

    const second = executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "cross-column-dispatch-b",
      requestId: secondRequestId,
      dispatch: {
        role: "worker",
        model: "gpt-6-luna",
        effort: "medium",
        clientThreadId: "opaque-cross-sequential-2",
      },
    }).dispatch;
    assert.throws(
      () => executeLedgerCommand(ledger, {
        command: "dispatch.update",
        idempotencyKey: "cross-column-dispatch-b-update-conflict",
        dispatchId: second.id,
        patch: { threadId: "opaque-cross-sequential-1" },
      }),
      (error) => error.code === "ID_ALREADY_LINKED" && !error.message.includes("opaque-cross-sequential-1"),
    );

    const repaired = executeLedgerCommand(ledger, {
      command: "dispatch.update",
      idempotencyKey: "cross-column-dispatch-a-repair",
      dispatchId: first.id,
      patch: { threadId: "opaque-real-thread-1", status: "running" },
    }).dispatch;
    assert.equal(repaired.id, first.id);
    assert.equal(repaired.clientThreadId, "opaque-cross-sequential-1");
    assert.equal(repaired.threadId, "opaque-real-thread-1");
    assert.equal(ledger.count("dispatches"), 2);
  } finally {
    ledger.close();
  }
});

test("SQLite triggers reject cross-column collisions even when application prechecks are bypassed", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const firstRequestId = executeLedgerCommand(ledger, requestCreate("trigger-parent-a")).request.id;
    const secondRequestId = executeLedgerCommand(ledger, requestCreate("trigger-parent-b")).request.id;
    const first = executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "trigger-dispatch-a",
      requestId: firstRequestId,
      dispatch: {
        role: "worker",
        model: "gpt-6-luna",
        effort: "medium",
        clientThreadId: "opaque-trigger-cross-1",
      },
    }).dispatch;
    const second = executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "trigger-dispatch-b",
      requestId: secondRequestId,
      dispatch: {
        role: "worker",
        model: "gpt-6-luna",
        effort: "high",
        threadId: "opaque-trigger-cross-2",
      },
    }).dispatch;

    assert.throws(
      () => ledger.database.prepare(`
        INSERT INTO dispatches (
          id, request_id, idempotency_key, role, model, effort, thread_id, client_thread_id,
          workspace_path, status, verification_status, needs_attention, attempt_count,
          summary, evidence, created_at, updated_at
        )
        SELECT ?, ?, ?, role, model, effort, ?, NULL,
          workspace_path, status, verification_status, needs_attention, attempt_count,
          summary, evidence, created_at, updated_at
        FROM dispatches WHERE id = ?
      `).run(
        "dsp_direct_cross_insert",
        secondRequestId,
        "direct-cross-insert-key",
        "opaque-trigger-cross-1",
        first.id,
      ),
      /dispatch identifier already linked/,
    );
    assert.throws(
      () => ledger.database.prepare("UPDATE dispatches SET thread_id = ? WHERE id = ?")
        .run("opaque-trigger-cross-1", second.id),
      /dispatch identifier already linked/,
    );
    assert.equal(ledger.count("dispatches"), 2);
  } finally {
    ledger.close();
  }
});

test("two CLI processes cannot register one opaque ID across different columns", async () => {
  const databasePath = await fixturePath();
  assert.equal((await runCli(databasePath, { command: "migrate" })).code, 0);
  const firstRequest = await runCli(databasePath, requestCreate("concurrent-cross-parent-a"));
  const secondRequest = await runCli(databasePath, requestCreate("concurrent-cross-parent-b"));
  const opaqueId = "opaque-cross-concurrent-1";
  const results = await Promise.all([
    runCli(databasePath, {
      command: "dispatch.register",
      idempotencyKey: "concurrent-cross-dispatch-a",
      requestId: firstRequest.body.request.id,
      dispatch: {
        role: "worker",
        model: "gpt-6-luna",
        effort: "medium",
        clientThreadId: opaqueId,
      },
    }),
    runCli(databasePath, {
      command: "dispatch.register",
      idempotencyKey: "concurrent-cross-dispatch-b",
      requestId: secondRequest.body.request.id,
      dispatch: {
        role: "worker",
        model: "gpt-6-luna",
        effort: "high",
        threadId: opaqueId,
      },
    }),
  ]);
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 1]);
  const failed = results.find((result) => result.code === 1);
  assert.equal(failed.body.error.code, "ID_ALREADY_LINKED");
  assert.equal(failed.stdout.includes(opaqueId), false);
  assert.equal(failed.stderr, "");
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    assert.equal(ledger.count("dispatches"), 1);
    const identifiers = ledger.database.prepare(`
      SELECT thread_id, client_thread_id FROM dispatches
      WHERE thread_id = ? OR client_thread_id = ?
    `).all(opaqueId, opaqueId);
    assert.equal(identifiers.length, 1);
  } finally {
    ledger.close();
  }
});

test("reconcile validates the registered identifier columns and never repairs a collision", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const firstRequestId = executeLedgerCommand(ledger, requestCreate("reconcile-cross-parent-a")).request.id;
    const secondRequestId = executeLedgerCommand(ledger, requestCreate("reconcile-cross-parent-b")).request.id;
    const first = executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "reconcile-cross-dispatch-a",
      requestId: firstRequestId,
      dispatch: {
        role: "worker",
        model: "gpt-6-luna",
        effort: "medium",
        clientThreadId: "opaque-reconcile-cross-1",
      },
    }).dispatch;
    const second = executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "reconcile-cross-dispatch-b",
      requestId: secondRequestId,
      dispatch: {
        role: "worker",
        model: "gpt-6-sol",
        effort: "high",
        threadId: "opaque-reconcile-cross-2",
      },
    }).dispatch;
    assert.throws(
      () => executeLedgerCommand(ledger, {
        command: "reconcile",
        idempotencyKey: "reconcile-cross-conflict",
        observations: [{
          dispatchId: second.id,
          clientThreadId: first.clientThreadId,
          observedStatus: "running",
        }],
      }),
      (error) => error.code === "ID_MISMATCH" && !error.message.includes(first.clientThreadId),
    );
    const unchanged = ledger.getDispatch(second.id);
    assert.equal(unchanged.threadId, "opaque-reconcile-cross-2");
    assert.equal(unchanged.clientThreadId, null);
    assert.equal(ledger.count("dispatches"), 2);
  } finally {
    ledger.close();
  }
});

test("concurrent registration of the same child ID never silently overwrites or duplicates", async () => {
  const databasePath = await fixturePath();
  assert.equal((await runCli(databasePath, { command: "migrate" })).code, 0);
  const created = await runCli(databasePath, requestCreate("dispatch-parent-concurrency"));
  const requestId = created.body.request.id;
  const dispatch = (idempotencyKey) => ({
    command: "dispatch.register",
    idempotencyKey,
    requestId,
    dispatch: {
      role: "worker",
      model: "gpt-6-luna",
      effort: "high",
      threadId: "thread-concurrent-1",
      status: "running",
    },
  });
  const results = await Promise.all([
    runCli(databasePath, dispatch("dispatch-concurrent-a")),
    runCli(databasePath, dispatch("dispatch-concurrent-b")),
  ]);
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 0]);
  assert.equal(new Set(results.map((result) => result.body.dispatch.id)).size, 1);
  assert.equal(results.filter((result) => result.body.reused === true).length, 1);
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    assert.equal(ledger.count("dispatches"), 1);
    assert.equal(ledger.count("events"), 3);
  } finally {
    ledger.close();
  }
});

test("worker and verifier model guards reject missing, unsupported, and ultra effort", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const requestId = executeLedgerCommand(ledger, requestCreate("model-parent-1")).request.id;
    const base = {
      command: "dispatch.register",
      requestId,
      dispatch: { role: "worker", threadId: "model-thread-1" },
    };
    assert.throws(
      () => executeLedgerCommand(ledger, { ...base, idempotencyKey: "model-missing-1" }),
      (error) => error.code === "INVALID_FIELD" && /dispatch.model/.test(error.message),
    );
    assert.throws(
      () => executeLedgerCommand(ledger, {
        ...base,
        idempotencyKey: "model-high-1",
        dispatch: { ...base.dispatch, model: "gpt-5.6-luna", effort: "medium" },
      }),
      (error) => error.code === "UNSUPPORTED_MODEL",
    );
    assert.throws(
      () => executeLedgerCommand(ledger, {
        ...base,
        idempotencyKey: "model-astra-low-1",
        dispatch: { ...base.dispatch, model: "gpt-6-astra", effort: "low" },
      }),
      (error) => error.code === "UNSUPPORTED_MODEL_EFFORT",
    );
    assert.throws(
      () => executeLedgerCommand(ledger, {
        ...base,
        idempotencyKey: "model-ultra-1",
        dispatch: { ...base.dispatch, role: "verifier", model: "gpt-6-sol", effort: "ultra" },
      }),
      (error) => error.code === "ULTRA_NOT_ALLOWED",
    );
    const supported = [
      ["gpt-6-luna", "medium"],
      ["gpt-6-luna", "high"],
      ["gpt-6-sol", "high"],
      ["gpt-6-sol", "xhigh"],
      ["gpt-6-sol", "max"],
      ["gpt-6-astra", "medium"],
      ["gpt-6-astra", "high"],
      ["gpt-6-astra", "xhigh"],
      ["gpt-6-astra", "max"],
    ];
    supported.forEach(([model, effort], index) => {
      const valid = executeLedgerCommand(ledger, {
        ...base,
        idempotencyKey: `model-valid-${index}`,
        dispatch: { ...base.dispatch, threadId: `model-thread-valid-${index}`, model, effort },
      });
      assert.equal(valid.dispatch.model, model);
      assert.equal(valid.dispatch.effort, effort);
    });
  } finally {
    ledger.close();
  }
});

test("route decisions keep rule, Skill, tool, and candidate evidence separate", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const requestId = executeLedgerCommand(ledger, {
      ...requestCreate("route-request-1"),
      request: { ...requestCreate("unused").request, rootSessionId: "route-root-session" },
    }).request.id;
    executeLedgerCommand(ledger, candidateReference("route-candidate-1", requestId));
    const route = executeLedgerCommand(ledger, {
      command: "route.record",
      idempotencyKey: "route-record-1",
      requestId,
      route: {
        inputFingerprint: "sha256:input-1",
        targetProjectId: "project-1",
        ruleMatches: [{
          id: "user-instruction", scope: "current-request", version: "2026-09-04",
          contentHash: "sha256:rule-1", priority: 1, reasonCode: "explicit-user-scope", selected: true,
        }],
        ruleOutcome: "selected",
        skillMatches: [{ id: "skill-a", source: "runtime-skills-list", version: "v1", reasonCode: "intent-match", selected: true }],
        toolMatches: [{ id: "tool-a", source: "runtime-tool-list", version: "v1", reasonCode: "required-capability", selected: true }],
        candidateRefs: [{
          candidateRef: "governance:candidate/candidate-1",
          candidateFingerprint: "sha256:candidate-fingerprint-1",
          assetVersion: "asset-v1",
          qualificationStatus: "eligible",
          boundaryStatus: "applies",
          relationshipStatus: "clear",
          routingEligible: true,
        }],
        eligibleExposure: true,
        actualHit: true,
        reasonCode: "rules-then-capabilities",
        reasonSummary: "Rules allowed the scoped action before capability selection",
        environmentFingerprint: "sha256:environment-1",
      },
    }).routeDecision;
    assert.equal(route.ruleMatches[0].id, "user-instruction");
    assert.equal(route.skillMatches[0].id, "skill-a");
    assert.equal(route.toolMatches[0].id, "tool-a");
    assert.equal(route.actualHit, true);
    assert.throws(() => executeLedgerCommand(ledger, {
      command: "route.record",
      idempotencyKey: "route-blocked-selects-skill",
      requestId,
      route: {
        inputFingerprint: "sha256:input-2",
        ruleOutcome: "blocked",
        skillMatches: [{ id: "skill-a", reasonCode: "would-write", selected: true }],
        reasonCode: "permission-block",
        reasonSummary: "Rules block write access",
        environmentFingerprint: "sha256:environment-1",
      },
    }), (error) => error.code === "ROUTE_BLOCKED");
  } finally {
    ledger.close();
  }
});

test("candidate routing eligibility is computed from every activation gate and ignores caller booleans", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const requestId = executeLedgerCommand(ledger, requestCreate("candidate-request-1")).request.id;
    const paused = executeLedgerCommand(ledger, candidateReference("candidate-paused-1", requestId, {
      samplePlanLocked: false,
      valueGateDecision: "GO",
      routingEligible: true,
      summary: "Qualification summary without candidate body",
    })).candidateRef;
    assert.equal(paused.valueGateDecision, "PAUSE");
    assert.equal(paused.routingEligible, false);
    assert.equal(paused.gateLocks.samplePlan, false);
    assert.equal(JSON.stringify(paused).includes("mechanism"), false);
    assert.equal(JSON.stringify(paused).includes("appliesWhen"), false);

    const computedReady = executeLedgerCommand(ledger, candidateReference("candidate-computed-ready", requestId, {
      candidateRef: "governance:candidate/computed-ready",
      candidateFingerprint: "sha256:computed-ready",
      activationMode: "write_is_activation",
      routingEligible: false,
    })).candidateRef;
    assert.equal(computedReady.routingEligible, true);

    const missingCanonical = executeLedgerCommand(ledger, candidateReference("candidate-missing-canonical", requestId, {
      candidateRef: "governance:candidate/missing-canonical",
      candidateFingerprint: "sha256:missing-canonical",
      activationMode: "write_is_activation",
      canonicalRef: null,
      routingEligible: true,
    })).candidateRef;
    assert.equal(missingCanonical.routingEligible, false);
    assert.throws(
      () => ledger.database.prepare("UPDATE candidate_refs SET routing_eligible = 1 WHERE id = ?")
        .run(missingCanonical.id),
      /routing gates are incomplete/,
    );
    const missingLocalContract = executeLedgerCommand(ledger, candidateReference("candidate-missing-local", requestId, {
      candidateRef: "governance:candidate/missing-local",
      candidateFingerprint: "sha256:missing-local",
      activationMode: "write_is_activation",
      localRecordStatus: "approved",
      routingEligible: true,
    })).candidateRef;
    assert.equal(missingLocalContract.routingEligible, false);

    const capacityPaused = executeLedgerCommand(ledger, candidateReference("candidate-capacity-1", requestId, {
      candidateRef: "governance:candidate/candidate-capacity",
      candidateFingerprint: "sha256:candidate-capacity",
      capacityStatus: "full",
      valueGateDecision: "GO",
      routingEligible: true,
    })).candidateRef;
    assert.equal(capacityPaused.valueGateDecision, "PAUSE");
    assert.equal(capacityPaused.capacityStatus, "full");
    assert.equal(capacityPaused.routingEligible, false);
    assert.throws(() => executeLedgerCommand(ledger, candidateReference("candidate-body-rejected", requestId, {
      candidateRef: "governance:candidate/body-rejected",
      candidateFingerprint: "sha256:body-rejected",
      mechanism: "copied candidate body",
    })), (error) => error.code === "UNKNOWN_FIELD");

    const stale = executeLedgerCommand(ledger, candidateReference("candidate-stale-1", requestId, {
      sourceStatus: "unavailable",
      readErrorCode: "GOVERNANCE_READ_FAILED",
      routingEligible: true,
      lastTrustedAt: "2026-09-04T00:00:00.000Z",
    })).candidateRef;
    assert.equal(stale.sourceStatus, "unavailable");
    assert.equal(stale.routingEligible, false);
    assert.equal(stale.readErrorCode, "GOVERNANCE_READ_FAILED");
    assert.equal(stale.lastTrustedAt, "2026-09-04T00:00:00.000Z");
  } finally {
    ledger.close();
  }
});

test("concurrent candidate reference recording is idempotent", async () => {
  const databasePath = await fixturePath();
  assert.equal((await runCli(databasePath, { command: "migrate" })).code, 0);
  const created = await runCli(databasePath, {
    ...requestCreate("candidate-concurrent-parent"),
    request: { ...requestCreate("unused").request, rootSessionId: "candidate-concurrent-root" },
  });
  const command = candidateReference("candidate-concurrent-key", created.body.request.id);
  const results = await Promise.all([runCli(databasePath, command), runCli(databasePath, command)]);
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 0]);
  assert.equal(results.filter((result) => result.body.duplicate === false).length, 1);
  assert.equal(results.filter((result) => result.body.duplicate === true).length, 1);
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    assert.equal(ledger.count("candidate_refs"), 1);
  } finally {
    ledger.close();
  }
});

test("write-is-activation rollback milestones remain ordered and cannot masquerade as one another", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const requestId = executeLedgerCommand(ledger, requestCreate("rollback-request-1")).request.id;
    assert.throws(() => executeLedgerCommand(ledger, candidateReference("rollback-invalid-1", requestId, {
      activationMode: "write_is_activation",
      canonicalSourceRolledBackAt: "2026-09-04T01:00:00.000Z",
    })), (error) => error.code === "ROLLBACK_SEQUENCE_INVALID");
    const blocked = executeLedgerCommand(ledger, candidateReference("rollback-blocked-1", requestId, {
      activationMode: "write_is_activation",
      orchestratorRouteBlockedAt: "2026-09-04T00:00:00.000Z",
    })).candidateRef;
    assert.ok(blocked.rollback.orchestratorRouteBlockedAt);
    assert.equal(blocked.rollback.canonicalSourceRolledBackAt, null);
    assert.equal(blocked.rollback.freshSessionNoLoadVerifiedAt, null);
    assert.equal(blocked.routingEligible, false);
  } finally {
    ledger.close();
  }
});

test("immutable outcomes and independently verified evidence preserve worker completion boundaries", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const requestId = executeLedgerCommand(ledger, requestCreate("evidence-request-1")).request.id;
    const worker = executeLedgerCommand(ledger, {
      command: "dispatch.register", idempotencyKey: "evidence-worker", requestId,
      dispatch: { role: "worker", model: "gpt-6-luna", effort: "medium", threadId: "evidence-worker-thread" },
    }).dispatch;
    const verifier = executeLedgerCommand(ledger, {
      command: "dispatch.register", idempotencyKey: "evidence-verifier", requestId,
      dispatch: { role: "verifier", model: "gpt-6-sol", effort: "high", threadId: "evidence-verifier-thread" },
    }).dispatch;
    executeLedgerCommand(ledger, {
      command: "outcome.record", idempotencyKey: "outcome-worker-1", requestId,
      outcome: {
        dispatchId: worker.id, attempt: 1, status: "done", verification: "UNVERIFIED",
        summary: "Worker completed the assigned object", environmentFingerprint: "sha256:evidence-environment",
      },
    });
    assert.throws(() => executeLedgerCommand(ledger, {
      command: "request.update", idempotencyKey: "request-self-pass", requestId,
      patch: { verification: "PASS" },
    }), (error) => error.code === "INDEPENDENT_EVIDENCE_REQUIRED");
    assert.throws(
      () => ledger.database.prepare(
        "UPDATE requests SET verification_status = 'PASS' WHERE id = ?",
      ).run(requestId),
      /independent evidence/,
    );
    assert.throws(() => executeLedgerCommand(ledger, {
      command: "outcome.record", idempotencyKey: "outcome-worker-overwrite", requestId,
      outcome: {
        dispatchId: worker.id, attempt: 1, status: "done", verification: "PASS",
        summary: "Attempt to overwrite outcome", environmentFingerprint: "sha256:evidence-environment",
      },
    }), (error) => error.code === "INDEPENDENT_EVIDENCE_REQUIRED");
    assert.throws(() => executeLedgerCommand(ledger, {
      command: "evidence.record", idempotencyKey: "evidence-self-pass", requestId,
      evidenceRef: {
        dispatchId: worker.id, level: "test", verification: "PASS",
        producerDispatchId: worker.id, verifierDispatchId: worker.id,
        reference: "test:test-id", summary: "Self-attested test result",
      },
    }), (error) => error.code === "INDEPENDENT_VERIFIER_REQUIRED");
    assert.throws(() => executeLedgerCommand(ledger, {
      command: "evidence.record", idempotencyKey: "evidence-named-verifier-but-worker-attached", requestId,
      evidenceRef: {
        dispatchId: worker.id, level: "test", verification: "PASS",
        producerDispatchId: worker.id, verifierDispatchId: verifier.id,
        reference: "test:worker-attached", summary: "Worker cannot attach verifier PASS",
      },
    }), (error) => error.code === "INDEPENDENT_VERIFIER_REQUIRED");
    assert.throws(() => ledger.database.prepare(`
      INSERT INTO evidence_refs (
        id, request_id, dispatch_id, idempotency_key, evidence_level, verification_status,
        producer_dispatch_id, verifier_dispatch_id, reference, summary, created_at
      ) VALUES ('evr_direct_forged', ?, ?, 'direct-forged-pass', 'test', 'PASS',
        ?, ?, 'test:forged', 'Forged PASS', ?)
    `).run(
      requestId, worker.id, worker.id, verifier.id, "2026-09-04T00:00:00.000Z",
    ), /independent verifier/);
    const evidence = executeLedgerCommand(ledger, {
      command: "evidence.record", idempotencyKey: "evidence-independent-pass", requestId,
      evidenceRef: {
        dispatchId: verifier.id, level: "test", verification: "PASS",
        producerDispatchId: worker.id, verifierDispatchId: verifier.id,
        reference: "test:test-id", contentHash: "sha256:evidence-1", summary: "Independent test verification",
      },
    }).evidenceRef;
    assert.equal(evidence.verification, "PASS");
    const passedOutcome = executeLedgerCommand(ledger, {
      command: "outcome.record", idempotencyKey: "outcome-worker-pass-2", requestId,
      outcome: {
        dispatchId: worker.id, attempt: 2, status: "done", verification: "PASS",
        summary: "Independent verifier accepted attempt two",
        environmentFingerprint: "sha256:evidence-environment", evidenceRefId: evidence.id,
      },
    }).outcome;
    assert.equal(passedOutcome.evidenceRefId, evidence.id);
    assert.equal(executeLedgerCommand(ledger, {
      command: "request.update", idempotencyKey: "request-independent-pass", requestId,
      patch: { verification: "PASS" },
    }).request.verification, "PASS");
    assert.throws(
      () => ledger.database.prepare("UPDATE evidence_refs SET summary = 'mutated' WHERE id = ?").run(evidence.id),
      /immutable/,
    );
    assert.equal(ledger.getRequest(requestId).outcomes[0].verification, "UNVERIFIED");
  } finally {
    ledger.close();
  }
});

test("reconcile only records explicit observations and marks uncertain children for handling", async () => {
  const databasePath = await fixturePath();
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    const requestId = executeLedgerCommand(ledger, requestCreate("reconcile-parent-1")).request.id;
    const dispatch = executeLedgerCommand(ledger, {
      command: "dispatch.register",
      idempotencyKey: "reconcile-child-1",
      requestId,
      dispatch: {
        role: "worker",
        model: "gpt-6-luna",
        effort: "medium",
        threadId: "reconcile-thread-1",
        status: "running",
      },
    }).dispatch;
    const result = executeLedgerCommand(ledger, {
      command: "reconcile",
      idempotencyKey: "reconcile-pass-1",
      observations: [{
        dispatchId: dispatch.id,
        threadId: dispatch.threadId,
        observedStatus: "not_found",
      }],
    });
    assert.equal(result.reconciled, 1);
    assert.equal(result.dispatches[0].status, "unknown");
    assert.equal(result.dispatches[0].needsAttention, true);
    assert.equal(ledger.count("dispatches"), 1);
    const duplicate = executeLedgerCommand(ledger, {
      command: "reconcile",
      idempotencyKey: "reconcile-pass-1",
      observations: [],
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(ledger.count("dispatches"), 1);
  } finally {
    ledger.close();
  }
});

test("sensitive fields and credential-shaped values are rejected without storage or echo", async () => {
  const databasePath = await fixturePath();
  assert.equal((await runCli(databasePath, { command: "migrate" })).code, 0);
  const marker = ["Bearer", "private-test-marker"].join(" ");
  const withPrompt = await runCli(databasePath, {
    ...requestCreate("sensitive-request-1"),
    prompt: marker,
  });
  assert.equal(withPrompt.code, 1);
  assert.equal(withPrompt.body.error.code, "SENSITIVE_FIELD");
  assert.equal(withPrompt.stdout.includes(marker), false);
  assert.equal(withPrompt.stderr, "");

  const withValue = await runCli(databasePath, {
    ...requestCreate("sensitive-request-2"),
    request: { ...requestCreate("unused").request, summary: marker },
  });
  assert.equal(withValue.code, 1);
  assert.equal(withValue.body.error.code, "SENSITIVE_VALUE");
  assert.equal(withValue.stdout.includes(marker), false);
  assert.equal(withValue.stderr, "");

  const githubMarker = `ghp_${"A".repeat(24)}`;
  const withGithubToken = await runCli(databasePath, {
    ...requestCreate("sensitive-request-github"),
    request: { ...requestCreate("unused").request, evidence: githubMarker },
  });
  assert.equal(withGithubToken.code, 1);
  assert.equal(withGithubToken.body.error.code, "SENSITIVE_VALUE");
  assert.equal(withGithubToken.stdout.includes(githubMarker), false);

  const longFormInputs = [
    { field: "goal", value: "user: first message\nassistant: complete response" },
    { field: "summary", value: "stdout: complete command output" },
    { field: "evidence", value: "```json\n{\"role\":\"assistant\"}\n```" },
    { field: "summary", value: "transcript: complete conversation history" },
  ];
  for (const [index, attempt] of longFormInputs.entries()) {
    const rejected = await runCli(databasePath, {
      ...requestCreate(`long-form-request-${index}`),
      request: {
        ...requestCreate("unused").request,
        [attempt.field]: attempt.value,
      },
    });
    assert.equal(rejected.code, 1);
    assert.equal(rejected.body.error.code, "LONG_FORM_TEXT_NOT_ALLOWED");
    assert.equal(rejected.stdout.includes(attempt.value), false);
    assert.equal(rejected.stderr, "");
  }
  const privateObjectPath = await runCli(databasePath, {
    command: "ownership.check",
    requestId: "req_missing",
    ownershipCheck: {
      ownership: [{ objectKey: "/Users/example/private/file", accessMode: "read", phase: "review" }],
    },
  });
  assert.equal(privateObjectPath.code, 1);
  assert.equal(privateObjectPath.body.error.code, "PRIVATE_PATH_NOT_ALLOWED");
  assert.equal(privateObjectPath.stdout.includes("/Users/example/private/file"), false);
  const ledger = new OrchestratorLedger(databasePath, { migrate: true });
  try {
    assert.equal(ledger.count("requests"), 0);
    assert.equal(ledger.count("events"), 0);
  } finally {
    ledger.close();
  }
});

test("CLI requires a DB path and reports newer schemas without migrating or reconnecting", async () => {
  const databasePath = await fixturePath();
  const missing = await runCli(databasePath, { command: "open.list" }, { includeDatabasePath: false });
  assert.equal(missing.code, 1);
  assert.equal(missing.body.error.code, "DB_PATH_REQUIRED");
  assert.match(missing.body.error.message, /orchestrator\.sqlite3/);

  await mkdir(path.dirname(databasePath), { recursive: true });
  const incompatible = new DatabaseSync(databasePath);
  incompatible.exec("PRAGMA user_version = 99");
  incompatible.close();
  const tooNew = await runCli(databasePath, { command: "open.list" });
  assert.equal(tooNew.code, 0);
  assert.equal(tooNew.body.status, "unsupported_newer_schema");
  assert.equal(tooNew.body.compatibility, "unsupported_newer_schema");
  assert.equal(tooNew.body.schemaVersion, 99);
  assert.equal(tooNew.body.requests, null);
  assert.equal(tooNew.body.readOnly, true);
  const unsupportedInspection = await runCli(databasePath, { command: "database.inspect" });
  assert.equal(unsupportedInspection.code, 0);
  assert.equal(unsupportedInspection.body.status, "unsupported_newer_schema");
  assert.equal(unsupportedInspection.body.inspection, null);
  const rejectedBackupPath = path.join(path.dirname(databasePath), "future-schema.backup.sqlite3");
  const rejectedBackup = await runCli(databasePath, {
    command: "backup.create",
    destinationPath: rejectedBackupPath,
  });
  assert.equal(rejectedBackup.code, 1);
  assert.equal(rejectedBackup.body.error.code, "SCHEMA_TOO_NEW");
  assert.equal(existsSync(rejectedBackupPath), false);
  const rejectedWrite = await runCli(databasePath, requestCreate("too-new-write"));
  assert.equal(rejectedWrite.code, 1);
  assert.equal(rejectedWrite.body.error.code, "SCHEMA_TOO_NEW");
  const stillNewer = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(stillNewer.prepare("PRAGMA user_version").get().user_version, 99);
  stillNewer.close();

  const directoryPath = await fixturePath();
  await mkdir(path.dirname(directoryPath), { recursive: true });
  await mkdir(directoryPath);
  const unwritable = await runCli(directoryPath, { command: "open.list" });
  assert.equal(unwritable.code, 1);
  assert.equal(unwritable.body.error.code, "DB_READ_FAILED");
  assert.match(unwritable.body.error.message, /opened read-only/);
});
