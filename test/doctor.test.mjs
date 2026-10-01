import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("doctor confirms the pinned package without requiring Codex to be running", () => {
  const result = spawnSync(process.execPath, ["scripts/doctor.mjs", "--json", "--port", "65534"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_TASKBOARD_PORT: "65533",
      CODEX_ASSET_CONSOLE_PORT: "65532",
      CODEX_SIDEBAR_TASKBOARD_RUNTIME_FILE: "/missing/codex-sidebar-runtime.json",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.package.ready, true);
  assert.equal(report.package.taskboardVersion, "0.2.0-codexoptimiz.20260831");
  assert.equal(report.node.supported, true);
  assert.equal(report.codex.reachable, false);
  assert.equal(report.taskboard.reachable, false);
  assert.equal(report.assetConsole.packaged, true);
  assert.equal(report.assetConsole.reachable, false);
});
