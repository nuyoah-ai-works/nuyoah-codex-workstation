import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { OrchestratorLedger, executeLedgerCommand } from "../nuyoah/taskboard/orchestrator-ledger.mjs";

const cliPath = fileURLToPath(new URL("../scripts/orchestrator-ledger.mjs", import.meta.url));
const v6Schema = readFileSync(new URL("./fixtures/orchestrator-v6.sql", import.meta.url), "utf8");
const legacyPairs = [["gpt-5.6-luna", "low"], ["gpt-5.6-luna", "medium"],
  ["gpt-5.6-terra", "medium"], ["gpt-5.6-terra", "high"],
  ["gpt-5.6-sol", "high"], ["gpt-5.6-sol", "xhigh"], ["gpt-5.6-sol", "max"]];
const currentPairs = [["gpt-6-luna", "medium"], ["gpt-6-luna", "high"],
  ["gpt-6-sol", "high"], ["gpt-6-sol", "xhigh"], ["gpt-6-sol", "max"],
  ["gpt-6-astra", "medium"], ["gpt-6-astra", "high"], ["gpt-6-astra", "xhigh"], ["gpt-6-astra", "max"]];
const timestamp = "2026-09-23T00:00:00.000Z";

function cli(file, command) {
  const result = spawnSync(process.execPath, [cliPath], {
    env: { ...process.env, NUYOAH_ORCHESTRATOR_DB: file },
    input: JSON.stringify(command), encoding: "utf8",
  });
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.trim().split("\n").length, 1);
  return { code: result.status, ...JSON.parse(result.stdout) };
}
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ledger-v7-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "ledger.sqlite3");
  const db = new DatabaseSync(file);
  db.exec(v6Schema);
  function insert(table, row) {
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
      .run(...Object.values(row));
  }
  insert("requests", { id: "req_fixture", idempotency_key: "request:fixture", goal: "Synthetic migration fixture",
    root_session_id: "root-fixture", lineage_status: "known", status: "running", created_at: timestamp, updated_at: timestamp });
  insert("request_sessions", { request_id: "req_fixture", session_id: "root-fixture", relation: "origin", attached_at: timestamp });
  // Historical Luna rows predate the v6 insert guard. Restore its exact DDL after fixture seeding.
  const insertGuard = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'dispatches_current_model_insert'").get().sql;
  db.exec("DROP TRIGGER dispatches_current_model_insert;");
  [...legacyPairs, ...currentPairs.filter(([model]) => model === "gpt-6-astra")].forEach(([model, effort], i) => {
    insert("dispatches", { id: `dsp_${i}`, request_id: "req_fixture", idempotency_key: `dispatch:${i}`,
      role: i === 6 ? "verifier" : "worker", model, effort, client_thread_id: `client-${i}`, status: "done",
      created_at: timestamp, updated_at: timestamp });
    insert("events", { idempotency_key: `dispatch:${i}`, request_id: "req_fixture", dispatch_id: `dsp_${i}`,
      event_type: "dispatch.registered", summary: "Historical synthetic dispatch", created_at: timestamp });
  });
  db.exec(insertGuard);
  insert("dispatch_relations", { dispatch_id: "dsp_2", parent_dispatch_id: "dsp_0", retry_of_dispatch_id: "dsp_1", logical_unit_key: "unit-fixture" });
  insert("dispatch_dependencies", { dispatch_id: "dsp_2", depends_on_dispatch_id: "dsp_1" });
  insert("dispatch_ownership", { dispatch_id: "dsp_2", object_key: "file:fixture", access_mode: "write", phase: "implementation" });
  insert("route_decisions", { id: "route_fixture", request_id: "req_fixture", dispatch_id: "dsp_2", idempotency_key: "route:fixture",
    input_fingerprint: "sha256:fixture", rule_matches_json: "[]", rule_outcome: "selected", skill_matches_json: "[]",
    tool_matches_json: "[]", candidate_refs_json: "[]", eligible_exposure: 0, actual_hit: 0, reason_code: "fixture",
    reason_summary: "Synthetic routing", environment_fingerprint: "sha256:fixture", created_at: timestamp });
  insert("evidence_refs", { id: "evidence_fixture", request_id: "req_fixture", dispatch_id: "dsp_6", idempotency_key: "evidence:fixture",
    evidence_level: "test", verification_status: "PASS", producer_dispatch_id: "dsp_2", verifier_dispatch_id: "dsp_6",
    reference: "test:fixture", created_at: timestamp });
  insert("events", { idempotency_key: "evidence:fixture", request_id: "req_fixture", dispatch_id: "dsp_6",
    event_type: "evidence.recorded", created_at: timestamp });
  insert("outcomes", { id: "outcome_fixture", request_id: "req_fixture", dispatch_id: "dsp_2", idempotency_key: "outcome:fixture",
    attempt: 1, status: "done", verification_status: "PASS", summary: "Synthetic acceptance", environment_fingerprint: "sha256:fixture",
    evidence_ref_id: "evidence_fixture", created_at: timestamp });
  insert("candidate_refs", { id: "candidate_fixture", request_id: "req_fixture", idempotency_key: "candidate:fixture",
    candidate_ref: "governance:fixture", candidate_fingerprint: "sha256:fixture", asset_version: "v1", governance_source_id: "fixture",
    source_status: "connected", candidate_status: "draft", validation_status: "UNVERIFIED", qualification_status: "unknown",
    environment_fingerprint: "sha256:fixture", promotion_destination: "unknown", activation_mode: "separate", local_record_status: "not_recorded",
    enable_status: "not_enabled", publish_status: "not_published", value_gate_stage: "M0", value_gate_decision: "PAUSE",
    capacity_status: "unknown", routing_eligible: 0, budget_locked: 0, sample_plan_locked: 0, pilot_cluster_locked: 0,
    rollback_sla_locked: 0, governance_endpoint_locked: 0, updated_at: timestamp });
  db.exec("PRAGMA foreign_keys = ON;");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  return { file, db };
}
function registration(i, model, effort, extra = {}) {
  return { command: "dispatch.register", idempotencyKey: `dispatch:${i}`, requestId: "req_fixture",
    dispatch: { role: i === 6 ? "verifier" : "worker", model, effort, clientThreadId: `client-${i}`, ...extra } };
}
function inspect(file) {
  const result = cli(file, { command: "database.inspect" });
  assert.equal(result.code, 0);
  return result.inspection;
}

test("v6 to v7 preserves all populated business tables, IDs, custom schema objects and repeat migration", (t) => {
  const { file, db } = fixture(t);
  db.exec(`CREATE INDEX fixture_dispatch_summary ON dispatches(summary);
    CREATE TRIGGER fixture_dispatch_update AFTER UPDATE OF summary ON dispatches BEGIN SELECT 1; END;
    CREATE TRIGGER fixture_request_update AFTER UPDATE OF summary ON requests BEGIN SELECT COUNT(*) FROM dispatches; END;`);
  const objects = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name").all();
  db.close();
  const before = inspect(file);
  assert.equal(before.schemaVersion, 6);
  assert.equal(before.compatibility, "read_only_degraded");
  assert.equal(before.integrity, "ok");
  assert.equal(Object.keys(before.tables).length, 11);
  for (const table of Object.values(before.tables)) assert.ok(table.rowCount > 0);
  const read = cli(file, { command: "request.get", requestId: "req_fixture" });
  assert.equal(read.code, 0);
  assert.equal(read.schemaVersion, 6);
  assert.equal(cli(file, registration("new", "gpt-6-luna", "medium")).error.code, "MIGRATION_REQUIRED");
  assert.deepEqual(inspect(file), before);
  assert.equal(cli(file, { command: "migrate" }).schemaVersion, 7);
  const after = inspect(file);
  assert.equal(after.integrity, "ok");
  assert.equal(after.foreignKeyViolationCount, 0);
  assert.equal(after.dataDigest, before.dataDigest);
  assert.deepEqual(after.tables, before.tables);
  assert.notEqual(after.schemaDigest, before.schemaDigest);
  const upgraded = new DatabaseSync(file);
  for (const object of objects) {
    const saved = upgraded.prepare("SELECT sql FROM sqlite_master WHERE type = ? AND name = ?").get(object.type, object.name);
    assert.ok(saved, object.name);
    if (!["dispatches_current_model_insert", "dispatches_legacy_model_update"].includes(object.name)) assert.equal(saved.sql, object.sql);
  }
  assert.equal(upgraded.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'events'").get().seq, 12);
  upgraded.close();
  assert.equal(cli(file, { command: "migrate" }).code, 0);
  assert.deepEqual(inspect(file), after);
});

test("every legacy pair replays without writes and permits non-model updates but rejects model confusion", (t) => {
  const { file, db } = fixture(t); db.close();
  const ledger = new OrchestratorLedger(file, { migrate: true }); t.after(() => ledger.close());
  legacyPairs.forEach(([model, effort], i) => {
    const before = ledger.inspect().dataDigest;
    const replay = executeLedgerCommand(ledger, registration(i, model, effort));
    assert.equal(replay.duplicate, true);
    assert.equal(replay.dispatch.id, `dsp_${i}`);
    assert.equal(ledger.inspect().dataDigest, before);
    for (const replacement of [["gpt-6-luna", "medium"], ["gpt-5.6-terra", "high"]]) {
      if (model === replacement[0] && effort === replacement[1]) continue;
      assert.throws(() => executeLedgerCommand(ledger, registration(i, ...replacement)), { code: "IDEMPOTENCY_CONFLICT" });
    }
    assert.throws(() => executeLedgerCommand(ledger, registration(`new-${i}`, model, effort)), { code: "UNSUPPORTED_MODEL" });
    assert.throws(() => executeLedgerCommand(ledger, { command: "dispatch.update", idempotencyKey: `change:${i}`,
      dispatchId: `dsp_${i}`, patch: { model: "gpt-6-sol", effort: "high" } }), { code: "LEGACY_MODEL_IMMUTABLE" });
    assert.equal(ledger.inspect().dataDigest, before);
    const updated = executeLedgerCommand(ledger, { command: "dispatch.update", idempotencyKey: `update:${i}`, dispatchId: `dsp_${i}`,
      patch: { threadId: `thread-${i}`, status: "failed", verification: "PARTIAL", summary: "Updated historical state", evidence: "test:updated" } }).dispatch;
    assert.equal(updated.threadId, `thread-${i}`);
    assert.equal(updated.status, "failed");
    assert.equal(updated.verification, "PARTIAL");
    assert.equal(updated.model, model);
    assert.equal(updated.effort, effort);
    const afterUpdate = ledger.inspect().dataDigest;
    assert.equal(executeLedgerCommand(ledger, registration(i, model, effort)).dispatch.id, `dsp_${i}`);
    assert.equal(ledger.inspect().dataDigest, afterUpdate);
  });
  const retry = executeLedgerCommand(ledger, registration("retry", "gpt-6-sol", "high", { retryOfDispatchId: "dsp_4" })).dispatch;
  assert.equal(retry.relation.retryOfDispatchId, "dsp_4");
  assert.notEqual(retry.id, "dsp_4");
  assert.equal(ledger.getDispatch("dsp_4").model, "gpt-5.6-sol");
  const before = ledger.inspect().dataDigest;
  assert.throws(() => executeLedgerCommand(ledger, registration("retry", "gpt-5.6-sol", "high")), { code: "IDEMPOTENCY_CONFLICT" });
  assert.equal(ledger.inspect().dataDigest, before);
});

test("v7 API and SQL enforce the exact current model effort matrix and immutable legacy pairs", (t) => {
  const { file, db } = fixture(t); db.close();
  const ledger = new OrchestratorLedger(file, { migrate: true }); t.after(() => ledger.close());
  const sql = ledger.database.prepare(`INSERT INTO dispatches
    (id, request_id, idempotency_key, role, model, effort, thread_id, status, created_at, updated_at)
    VALUES (?, 'req_fixture', ?, 'worker', ?, ?, ?, 'registered', ?, ?)`);
  let n = 0;
  const insert = (model, effort, verb = "INSERT") => {
    const key = `sql-${n++}`;
    if (verb === "INSERT") return sql.run(key, key, model, effort, key, timestamp, timestamp);
    return ledger.database.prepare(`INSERT OR REPLACE INTO dispatches
      (id, request_id, idempotency_key, role, model, effort, thread_id, status, created_at, updated_at)
      VALUES ('dsp_0', 'req_fixture', 'dispatch:0', 'worker', ?, ?, 'replacement', 'registered', ?, ?)`)
      .run(model, effort, timestamp, timestamp);
  };
  for (const model of ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-terra"]) {
    for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "Ultra"]) {
      const valid = currentPairs.some(([m, e]) => m === model && e === effort);
      const command = registration(`matrix-${n}`, model, effort);
      if (valid) {
        assert.equal(executeLedgerCommand(ledger, command).dispatch.model, model);
        insert(model, effort);
      } else {
        assert.throws(() => executeLedgerCommand(ledger, command));
        assert.throws(() => insert(model, effort));
      }
    }
  }
  legacyPairs.forEach(([model, effort], i) => {
    assert.throws(() => insert(model, effort, "REPLACE"), /legacy model/);
    assert.throws(() => ledger.database.prepare("UPDATE dispatches SET model = 'gpt-6-luna', effort = 'medium' WHERE id = ?").run(`dsp_${i}`), /immutable/);
    assert.throws(() => ledger.database.prepare("UPDATE dispatches SET effort = 'ultra' WHERE id = ?").run(`dsp_${i}`), /immutable/);
    ledger.database.prepare("UPDATE dispatches SET summary = 'SQL status compatible', model = ?, effort = ? WHERE id = ?").run(model, effort, `dsp_${i}`);
  });
  assert.throws(() => insert("gpt-6-luna", "medium", "REPLACE"), /legacy model/);
  const modern = ledger.database.prepare("SELECT id FROM dispatches WHERE model = 'gpt-6-luna' LIMIT 1").get().id;
  for (const [model, effort] of legacyPairs) {
    assert.throws(() => ledger.database.prepare("UPDATE dispatches SET model = ?, effort = ? WHERE id = ?").run(model, effort, modern), /immutable/);
  }
  assert.throws(() => ledger.database.prepare("UPDATE dispatches SET effort = 'low' WHERE id = ?").run(modern), /CHECK/);
});

test("v6 migration failure restores all schema, rows, triggers and version atomically", (t) => {
  for (const failure of ["invalid-pair", "dependent-view", "foreign-key"]) {
    const { file, db } = fixture(t);
    if (failure === "invalid-pair") {
      const guard = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'dispatches_legacy_model_update'").get().sql;
      db.exec("DROP TRIGGER dispatches_legacy_model_update; PRAGMA ignore_check_constraints = ON; UPDATE dispatches SET effort = 'ultra' WHERE id = 'dsp_2';");
      db.exec(guard);
    }
    if (failure === "dependent-view") db.exec("CREATE VIEW fixture_dependency AS SELECT summary FROM dispatches;");
    if (failure === "foreign-key") db.exec("PRAGMA foreign_keys = OFF; UPDATE dispatch_relations SET parent_dispatch_id = 'dsp_missing';");
    db.close();
    const before = inspect(file);
    const result = cli(file, { command: "migrate" });
    assert.equal(result.code, 1);
    assert.equal(result.ok, false);
    assert.ok(["MIGRATION_FAILED", "FOREIGN_KEY_CHECK_FAILED"].includes(result.error.code));
    assert.deepEqual(inspect(file), before);
  }
});
