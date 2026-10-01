import assert from "node:assert/strict";
import { mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { OrchestratorLedger, executeLedgerCommand, ORCHESTRATOR_SCHEMA_VERSION } from "../../../nuyoah/taskboard/orchestrator-ledger.mjs";
import { createTaskboardServer, resolveHost } from "../server/index.mjs";

const fixtures = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    await fixture.app?.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

async function fixture({ configured = true, seed } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orchestrator-api-test-"));
  const databasePath = path.join(directory, ".state", "orchestrator.sqlite3");
  if (configured) {
    const ledger = new OrchestratorLedger(databasePath, { migrate: true });
    try { await seed?.(ledger); } finally { ledger.close(); }
  }
  const app = createTaskboardServer({
    dataDirectory: path.join(directory, "taskboard"),
    orchestratorDatabasePath: configured ? databasePath : "",
  });
  const address = await app.listen({ port: 0 });
  const value = { app, directory, databasePath, baseUrl: `http://127.0.0.1:${address.port}` };
  fixtures.push(value);
  return value;
}

async function request(baseUrl, pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json() };
}

test("unconfigured ledger is actionable and never masquerades as an empty request list", async () => {
  const { baseUrl } = await fixture({ configured: false });
  const result = await request(baseUrl, "/api/local/orchestrator/requests");
  assert.equal(result.response.status, 503);
  assert.equal(result.body.status, "unconfigured");
  assert.equal(result.body.schemaStatus, "unconfigured");
  assert.equal(result.body.reconnect, false);
  assert.equal(result.body.requests, null);
  assert.match(result.body.message, /尚未连接总管账本/);

  const rejectedMethod = await request(baseUrl, "/api/local/orchestrator/requests", { method: "POST" });
  assert.equal(rejectedMethod.response.status, 405);
  assert.equal(rejectedMethod.body.error.code, "METHOD_NOT_ALLOWED");
});

test("configured empty ledger returns a truthful connected empty result", async () => {
  const { baseUrl } = await fixture();
  const result = await request(baseUrl, "/api/local/orchestrator/requests");
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, "connected");
  assert.equal(result.body.schemaVersion, ORCHESTRATOR_SCHEMA_VERSION);
  assert.equal(result.body.schemaStatus, "current");
  assert.equal(result.body.reconnect, false);
  assert.deepEqual(result.body.requests, []);
  assert.ok(Date.parse(result.body.snapshotAt));
});

test("prompt, output, transcript, and multiline text never reach the read-only API", async () => {
  const hiddenText = "assistant: hidden response\nstdout: hidden output";
  const { baseUrl } = await fixture({
    seed(ledger) {
      const attempts = [
        {
          ...{
            command: "request.create",
            idempotencyKey: "api-private-prompt",
            request: { rootSessionId: "api-private-prompt-root", goal: "Safe summary" },
          },
          prompt: hiddenText,
        },
        {
          command: "request.create",
          idempotencyKey: "api-private-transcript",
          request: { rootSessionId: "api-private-transcript-root", goal: hiddenText },
        },
        {
          command: "request.create",
          idempotencyKey: "api-private-output",
          request: {
            rootSessionId: "api-private-output-root",
            goal: "Safe summary",
            summary: "output: hidden complete output",
          },
        },
      ];
      for (const command of attempts) {
        assert.throws(
          () => executeLedgerCommand(ledger, command),
          (error) => error.code === "SENSITIVE_FIELD" || error.code === "LONG_FORM_TEXT_NOT_ALLOWED",
        );
      }
      assert.equal(ledger.count("requests"), 0);
      assert.equal(ledger.count("events"), 0);
    },
  });
  const result = await request(baseUrl, "/api/local/orchestrator/requests");
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.requests, []);
  assert.equal(JSON.stringify(result.body).includes(hiddenText), false);
});

test("request detail validates IDs and returns only the explicit child relationship", async () => {
  let requestId;
  const { baseUrl } = await fixture({
    seed(ledger) {
      requestId = executeLedgerCommand(ledger, {
        command: "request.create",
        idempotencyKey: "api-request-1",
        request: {
          goal: "Show one delegated request",
          projectId: "project-1",
          workspacePath: "/tmp/project-1",
          status: "running",
          progressTotal: 1,
          rootSessionId: "session-api-origin",
          summary: "Worker is running",
        },
      }).request.id;
      executeLedgerCommand(ledger, {
        command: "dispatch.register",
        idempotencyKey: "api-dispatch-1",
        requestId,
        dispatch: {
          role: "worker",
          model: "gpt-6-sol",
          effort: "high",
          threadId: "thread-api-1",
          status: "running",
        },
      });
      executeLedgerCommand(ledger, {
        command: "candidate.ref.record",
        idempotencyKey: "api-candidate-ref-1",
        requestId,
        candidate: {
          candidateRef: "governance:candidate/api-1",
          candidateFingerprint: "sha256:api-candidate-1",
          assetVersion: "asset-v1",
          governanceSourceId: "nanyuan-skill-governance",
          sourceStatus: "connected",
          candidateStatus: "accepted",
          validationStatus: "PASS",
          qualificationStatus: "eligible",
          environmentFingerprint: "sha256:api-environment-1",
          canonicalRef: "governance:asset/api-1",
          localRecordStatus: "recorded",
          valueGateDecision: "GO",
          capacityStatus: "available",
          routingEligible: true,
          budgetLocked: true,
          samplePlanLocked: true,
          pilotClusterLocked: true,
          rollbackSlaLocked: true,
          governanceEndpointLocked: true,
          enableStatus: "enabled",
          summary: "Reference-only governance status",
        },
      });
    },
  });

  const list = await request(baseUrl, "/api/local/orchestrator/requests");
  assert.equal(list.response.status, 200);
  assert.equal(list.body.requests.length, 1);
  assert.equal(list.body.requests[0].dispatches[0].threadId, "thread-api-1");
  assert.equal(list.body.requests[0].rootSessionId, "session-api-origin");
  assert.equal(list.body.requests[0].candidateRefs[0].valueGateDecision, "GO");
  assert.equal(list.body.requests[0].candidateRefs[0].routingEligible, true);
  assert.equal(JSON.stringify(list.body).includes("idempotencyKey"), false);
  assert.equal(JSON.stringify(list.body).includes("idempotency_key"), false);

  const detail = await request(baseUrl, `/api/local/orchestrator/requests/${requestId}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.request.id, requestId);
  assert.equal(detail.body.request.dispatches.length, 1);
  assert.equal(detail.body.request.events.length, 3);

  const invalid = await request(baseUrl, "/api/local/orchestrator/requests/not%2Fallowed");
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_REQUEST_ID");

  const missing = await request(baseUrl, "/api/local/orchestrator/requests/req_missing");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, "REQUEST_NOT_FOUND");

  const query = await request(baseUrl, "/api/local/orchestrator/requests?limit=1");
  assert.equal(query.response.status, 400);
  assert.equal(query.body.error.code, "UNKNOWN_QUERY_PARAMETER");
});

test("read failure retains the last trusted snapshot and recovers without an empty flash", async () => {
  const { baseUrl, databasePath } = await fixture({
    seed(ledger) {
      executeLedgerCommand(ledger, {
        command: "request.create",
        idempotencyKey: "snapshot-request-1",
        request: { rootSessionId: "snapshot-request-root", goal: "Keep this trusted snapshot", status: "running" },
      });
    },
  });
  const connected = await request(baseUrl, "/api/local/orchestrator/requests");
  assert.equal(connected.response.status, 200);
  assert.equal(connected.body.requests.length, 1);

  const unavailablePath = `${databasePath}.temporarily-unavailable`;
  await rename(databasePath, unavailablePath);
  const stale = await request(baseUrl, "/api/local/orchestrator/requests");
  assert.equal(stale.response.status, 503);
  assert.equal(stale.body.status, "reconnecting");
  assert.equal(stale.body.reconnect, true);
  assert.equal(stale.body.requests.length, 1);
  assert.equal(stale.body.requests[0].id, connected.body.requests[0].id);
  assert.equal(stale.body.snapshotAt, connected.body.snapshotAt);
  assert.equal(stale.body.schemaVersion, ORCHESTRATOR_SCHEMA_VERSION);
  assert.equal(stale.body.schemaStatus, "current");
  assert.match(stale.body.message, /上次可信结果/);

  await rename(unavailablePath, databasePath);
  const recovered = await request(baseUrl, "/api/local/orchestrator/requests");
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.body.status, "connected");
  assert.equal(recovered.body.requests.length, 1);
});

test("read-only API marks schema v2 as legacy instead of inventing new fields", async () => {
  const { baseUrl } = await fixture({
    seed(ledger) {
      executeLedgerCommand(ledger, {
        command: "request.create",
        idempotencyKey: "legacy-api-request",
        request: { rootSessionId: "legacy-api-root", goal: "Legacy API request", status: "running" },
      });
      ledger.database.exec("PRAGMA user_version = 2");
    },
  });
  const result = await request(baseUrl, "/api/local/orchestrator/requests");
  assert.equal(result.response.status, 200);
  assert.equal(result.body.schemaVersion, 2);
  assert.equal(result.body.schemaStatus, "read_only_degraded");
  assert.match(result.body.message, /旧版委托账本/);
  assert.equal(result.body.requests[0].lineageStatus, "legacy_unknown");
});

test("read-only API reports a newer schema explicitly without reconnect fallback", async () => {
  const { baseUrl } = await fixture({
    seed(ledger) {
      ledger.database.exec("PRAGMA user_version = 99");
    },
  });
  const result = await request(baseUrl, "/api/local/orchestrator/requests");
  assert.equal(result.response.status, 409);
  assert.equal(result.body.status, "unsupported_newer_schema");
  assert.equal(result.body.schemaStatus, "unsupported_newer_schema");
  assert.equal(result.body.schemaVersion, 99);
  assert.equal(result.body.reconnect, false);
  assert.equal(result.body.requests, null);
  assert.match(result.body.message, /未迁移或修改数据/);
});

test("Taskboard server configuration and listen path are loopback-only", async () => {
  assert.equal(resolveHost(undefined), "127.0.0.1");
  assert.throws(() => resolveHost("0.0.0.0"), /must be 127\.0\.0\.1/);
  const directory = await mkdtemp(path.join(os.tmpdir(), "orchestrator-loopback-test-"));
  const app = createTaskboardServer({ dataDirectory: directory });
  fixtures.push({ app, directory });
  await assert.rejects(
    () => app.listen({ host: "0.0.0.0", port: 0 }),
    /must bind to 127\.0\.0\.1/,
  );
});
