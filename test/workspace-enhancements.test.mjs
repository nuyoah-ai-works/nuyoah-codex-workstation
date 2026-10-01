import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BUILT_IN_WORKSPACE_ENHANCEMENTS,
  createAssetConsoleRuntime,
  provisionAssetConsoleState,
} from "../lib/workspace-enhancements.mjs";
import { createRuntimePlan } from "../lib/runtime-plan.mjs";
import { AssetConsoleBridge } from "../lib/asset-console-bridge.mjs";

test("the workstation is the single first-class enhancement shortcut", () => {
  assert.deepEqual(
    BUILT_IN_WORKSPACE_ENHANCEMENTS.map(({ id, label, defaultVisible }) => ({ id, label, defaultVisible })),
    [{ id: "workstation", label: "工作站", defaultVisible: true }],
  );
});

test("Asset Console uses product-owned cross-platform state paths", () => {
  const mac = createAssetConsoleRuntime({
    root: "/opt/enhancer",
    platform: "darwin",
    home: "/Users/demo",
  });
  assert.equal(mac.serviceRoot, "/opt/enhancer/nuyoah/assets");
  assert.equal(mac.serverPath, "/opt/enhancer/nuyoah/assets/server.mjs");
  assert.equal(mac.staticRoot, "/opt/enhancer/nuyoah/assets/public");
  assert.equal(mac.stateRoot, "/Users/demo/Library/Application Support/Codex Sidebar Enhancer Data/Asset Console");
  assert.equal(mac.tokenPath, `${mac.stateRoot}/.api-token`);
  assert.equal(mac.configPath, `${mac.stateRoot}/asset-browser.config.json`);
  assert.equal(mac.assetLibraryIndexPath, `${mac.stateRoot}/.asset-library-index.json`);

  const windows = createAssetConsoleRuntime({
    root: "C:\\Enhancer",
    platform: "win32",
    home: "C:\\Users\\demo",
    localAppData: "C:\\Users\\demo\\AppData\\Local",
  });
  assert.equal(windows.stateRoot, "C:\\Users\\demo\\AppData\\Local\\CodexSidebarEnhancer\\Data\\AssetConsole");
});

test("the managed runtime starts the Asset Console alongside the sidebar and project manager", () => {
  const plan = createRuntimePlan({
    root: "/opt/enhancer",
    nodePath: "/opt/node",
    platform: "darwin",
    home: "/Users/demo",
    environment: {},
  });
  assert.deepEqual(plan.children.map((child) => child.name), ["sidebar", "taskboard", "asset-console"]);
  const assetConsole = plan.children.find((child) => child.name === "asset-console");
  assert.equal(assetConsole.env.ASSET_BROWSER_CONFIG, plan.assetConsole.configPath);
  assert.equal(assetConsole.env.ASSET_BROWSER_TOKEN_FILE, plan.assetConsole.tokenPath);
  assert.equal(assetConsole.env.ASSET_LIBRARY_INDEX, plan.assetConsole.assetLibraryIndexPath);
  assert.equal(assetConsole.env.PORT, String(plan.assetConsole.port));
});

test("Asset Console state is provisioned once without replacing an existing token", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-asset-console-"));
  try {
    const runtime = createAssetConsoleRuntime({ root: tempRoot, home: tempRoot, platform: "darwin" });
    await provisionAssetConsoleState(runtime);
    const firstToken = (await readFile(runtime.tokenPath, "utf8")).trim();
    const config = JSON.parse(await readFile(runtime.configPath, "utf8"));
    assert.match(firstToken, /^[a-f0-9]{64}$/);
    assert.deepEqual(config, { enabled: true, projects: [] });
    await provisionAssetConsoleState(runtime);
    assert.equal((await readFile(runtime.tokenPath, "utf8")).trim(), firstToken);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("Asset Console bridge publishes availability and panel state to different renderer methods", async () => {
  const expressions = [];
  const bridge = new AssetConsoleBridge();
  bridge.client = { evaluate: async (expression) => expressions.push(expression) };
  await bridge.publish({ state: "ready", url: "https://example.invalid" });
  await bridge.publish({ available: true }, "setAssetConsole");
  assert.match(expressions[0], /setAssetConsolePanel/);
  assert.match(expressions[1], /setAssetConsole/);
});
