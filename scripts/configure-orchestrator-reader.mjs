#!/usr/bin/env node

import {
  clearOrchestratorReaderConfig,
  resolveOrchestratorReader,
  saveOrchestratorReaderConfig,
} from "../lib/orchestrator-reader-config.mjs";

async function main() {
  const [command, databasePath, ...extra] = process.argv.slice(2);
  if (extra.length > 0) throw Object.assign(new Error("Use set, status, or clear."), { code: "INVALID_COMMAND" });
  if (command === "set" && databasePath) {
    await saveOrchestratorReaderConfig(databasePath);
    return { ok: true, saved: "configured" };
  }
  if (command === "clear" && databasePath === undefined) {
    return { ok: true, saved: (await clearOrchestratorReaderConfig()) ? "removed" : "absent" };
  }
  if (command === "status" && databasePath === undefined) {
    const resolution = await resolveOrchestratorReader();
    return {
      ok: true,
      status: resolution.databasePath ? "configured" : "unconfigured",
      source: resolution.source,
    };
  }
  throw Object.assign(new Error("Use set <absolute SQLite path>, status, or clear."), { code: "INVALID_COMMAND" });
}

try {
  process.stdout.write(`${JSON.stringify(await main())}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error?.code === "INVALID_DATABASE_PATH" ? error.code : "CONFIGURATION_FAILED",
  })}\n`);
  process.exitCode = 1;
}
