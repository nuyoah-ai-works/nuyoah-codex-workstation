import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  clearOrchestratorReaderConfig,
  orchestratorReaderConfigPath,
  readOrchestratorReaderConfig,
  resolveOrchestratorReader,
  saveOrchestratorReaderConfig,
  validOrchestratorDatabasePath,
} from "../lib/orchestrator-reader-config.mjs";
import { createRuntimePlan } from "../lib/runtime-plan.mjs";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orchestrator-reader-config-"));
  const databasePath = path.join(directory, "ledger.sqlite3");
  const otherDatabasePath = path.join(directory, "other.sqlite3");
  for (const file of [databasePath, otherDatabasePath]) {
    const database = new DatabaseSync(file);
    database.exec("PRAGMA user_version = 7");
    database.exec("CREATE TABLE requests (id TEXT PRIMARY KEY); CREATE TABLE dispatches (id TEXT PRIMARY KEY)");
    database.close();
  }
  return {
    directory,
    databasePath,
    otherDatabasePath,
    configPath: path.join(directory, "app-support", "orchestrator-reader.json"),
  };
}

test("reader config uses a stable user data location, not an installation directory", () => {
  assert.equal(orchestratorReaderConfigPath({ platform: "darwin", home: "/Users/tester" }),
    "/Users/tester/Library/Application Support/Codex Sidebar Enhancer Data/Taskboard/orchestrator-reader.json");
  assert.equal(orchestratorReaderConfigPath({
    platform: "win32", home: "C:\\Users\\tester", localAppData: "C:\\Users\\tester\\AppData\\Local",
  }), "C:\\Users\\tester\\AppData\\Local\\CodexSidebarEnhancer\\Data\\Taskboard\\orchestrator-reader.json");
});

test("saved read-only ledger path survives reads and clears without touching the database", async (context) => {
  const item = await fixture();
  context.after(() => rm(item.directory, { recursive: true, force: true }));
  const before = await readFile(item.databasePath);
  const configured = await saveOrchestratorReaderConfig(item.databasePath, item.configPath);
  assert.deepEqual(configured, { status: "configured", databasePath: item.databasePath });
  assert.equal((await stat(item.configPath)).mode & 0o077, 0);
  assert.deepEqual(await resolveOrchestratorReader({ environment: {}, configPath: item.configPath }), {
    source: "saved", databasePath: item.databasePath,
  });
  assert.equal(await clearOrchestratorReaderConfig(item.configPath), true);
  assert.equal(await clearOrchestratorReaderConfig(item.configPath), false);
  assert.deepEqual(await readOrchestratorReaderConfig(item.configPath), {
    status: "missing", databasePath: null,
  });
  assert.deepEqual(await readFile(item.databasePath), before);
});

test("explicit environment wins and invalid values do not fall back to saved data", async (context) => {
  const item = await fixture();
  context.after(() => rm(item.directory, { recursive: true, force: true }));
  await saveOrchestratorReaderConfig(item.databasePath, item.configPath);
  assert.deepEqual(await resolveOrchestratorReader({
    environment: { NUYOAH_ORCHESTRATOR_DB: item.otherDatabasePath }, configPath: item.configPath,
  }), { source: "environment", databasePath: item.otherDatabasePath });
  assert.deepEqual(await resolveOrchestratorReader({
    environment: { NUYOAH_ORCHESTRATOR_DB: "relative.sqlite3" }, configPath: item.configPath,
  }), { source: "invalid_environment", databasePath: null });
  assert.deepEqual(await resolveOrchestratorReader({
    environment: { NUYOAH_ORCHESTRATOR_DB: "" }, configPath: item.configPath,
  }), { source: "invalid_environment", databasePath: null });
});

test("invalid source and malformed configuration fail closed; failed set preserves prior config", async (context) => {
  const item = await fixture();
  context.after(() => rm(item.directory, { recursive: true, force: true }));
  await saveOrchestratorReaderConfig(item.databasePath, item.configPath);
  const saved = await readFile(item.configPath);
  await assert.rejects(saveOrchestratorReaderConfig("relative.sqlite3", item.configPath), {
    code: "INVALID_DATABASE_PATH",
  });
  await assert.rejects(saveOrchestratorReaderConfig(path.join(item.directory, "missing.sqlite3"), item.configPath), {
    code: "INVALID_DATABASE_PATH",
  });
  assert.deepEqual(await readFile(item.configPath), saved);

  const invalidDatabasePath = path.join(item.directory, "not-sqlite.sqlite3");
  await writeFile(invalidDatabasePath, "not a SQLite database");
  assert.equal(await validOrchestratorDatabasePath(invalidDatabasePath), false);
  const unrelatedDatabasePath = path.join(item.directory, "unrelated.sqlite3");
  const unrelated = new DatabaseSync(unrelatedDatabasePath);
  unrelated.exec("PRAGMA user_version = 7; CREATE TABLE notes (id TEXT PRIMARY KEY)");
  unrelated.close();
  assert.equal(await validOrchestratorDatabasePath(unrelatedDatabasePath), false);
  await writeFile(item.configPath, JSON.stringify({ version: 1, databasePath: invalidDatabasePath }), { mode: 0o600 });
  assert.equal((await readOrchestratorReaderConfig(item.configPath)).status, "invalid");
  await writeFile(item.configPath, "{bad json", { mode: 0o600 });
  assert.equal((await readOrchestratorReaderConfig(item.configPath)).status, "invalid");

  const linkedPath = path.join(item.directory, "linked-config.json");
  await symlink(item.configPath, linkedPath);
  assert.equal((await readOrchestratorReaderConfig(linkedPath)).status, "invalid");
});

test("runtime passes a validated path only to the Taskboard child", () => {
  const explicitPath = "/private/test/ledger.sqlite3";
  const plan = createRuntimePlan({
    root: "/tmp/codex-sidebar",
    environment: { NUYOAH_ORCHESTRATOR_DB: "/unvalidated/ledger.sqlite3" },
    orchestratorDatabasePath: explicitPath,
  });
  assert.equal(plan.children[1].env.NUYOAH_ORCHESTRATOR_DB, explicitPath);
  assert.equal(plan.children[0].env.NUYOAH_ORCHESTRATOR_DB, undefined);
  assert.equal(plan.children[2].env.NUYOAH_ORCHESTRATOR_DB, undefined);
  const disconnected = createRuntimePlan({
    root: "/tmp/codex-sidebar",
    environment: { NUYOAH_ORCHESTRATOR_DB: "/unvalidated/ledger.sqlite3" },
  });
  assert.equal(disconnected.children[1].env.NUYOAH_ORCHESTRATOR_DB, undefined);
});
