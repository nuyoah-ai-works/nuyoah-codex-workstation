import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { TASKBOARD_VERSION, createRuntimePlan } from "../lib/runtime-plan.mjs";

test("runtime starts the sidebar, pinned Taskboard, and Asset Console together", () => {
  const root = "/tmp/codex-sidebar";
  const plan = createRuntimePlan({
    root,
    nodePath: "/usr/local/bin/node",
    port: 9231,
    platform: "darwin",
    home: "/Users/tester",
    environment: {},
  });

  assert.equal(TASKBOARD_VERSION, "0.2.0-codexoptimiz.20260831");
  assert.equal(plan.children.length, 3);
  assert.deepEqual(plan.children[0].args, [path.posix.join(root, "scripts", "injector.mjs"), "--port", "9231", "--watch"]);
  assert.deepEqual(plan.children[1].args, [
    path.posix.join(root, "vendor", "codex-taskboard", "scripts", "codex-injector.mjs"),
    "--port", "9231", "--watch",
  ]);
  assert.equal(plan.children[1].env.CODEX_TASKBOARD_HOST, "127.0.0.1");
  assert.equal(plan.children[1].env.CODEX_TASKBOARD_PORT, "47823");
  assert.equal(plan.children[1].env.CODEX_TASKBOARD_VERSION, TASKBOARD_VERSION);
  assert.equal(
    plan.children[1].env.CODEX_TASKBOARD_DATA_DIR,
    "/Users/tester/Library/Application Support/Codex Sidebar Enhancer Data/Taskboard",
  );
  assert.deepEqual(plan.children[2].args, [
    path.posix.join(root, "nuyoah", "assets", "server.mjs"),
  ]);
  assert.equal(plan.children[2].env.PORT, "5177");
});

test("Windows Taskboard data remains outside the replaceable installation directory", () => {
  const root = "C:\\Users\\tester\\AppData\\Local\\Codex Sidebar Enhancer";
  const plan = createRuntimePlan({
    root,
    nodePath: "C:\\runtime\\node.exe",
    port: 9231,
    platform: "win32",
    home: "C:\\Users\\tester",
    localAppData: "C:\\Users\\tester\\AppData\\Local",
    environment: {},
  });

  const dataDir = plan.children[1].env.CODEX_TASKBOARD_DATA_DIR;
  assert.equal(dataDir, "C:\\Users\\tester\\AppData\\Local\\CodexSidebarEnhancer\\Data\\Taskboard");
  assert.equal(dataDir.startsWith(root), false);
});
