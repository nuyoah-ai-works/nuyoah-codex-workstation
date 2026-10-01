import assert from "node:assert/strict";
import test from "node:test";

import { createAssetScanCoordinator } from "../vendor/codex-workspace-enhancer/asset-browser/asset-scan-coordinator.js";

test("concurrent scans for the same project share one directory traversal", async () => {
  let releaseScan;
  let traversalCount = 0;
  const gate = new Promise((resolve) => { releaseScan = resolve; });
  const coordinator = createAssetScanCoordinator();
  const scan = async () => {
    traversalCount += 1;
    await gate;
    return { assets: ["hero.png"] };
  };

  const first = coordinator.run("project-a", scan);
  const second = coordinator.run("project-a", scan);
  await Promise.resolve();

  assert.equal(traversalCount, 1);
  releaseScan();
  assert.deepEqual(await Promise.all([first, second]), [
    { assets: ["hero.png"] },
    { assets: ["hero.png"] },
  ]);
});

test("a stalled scan times out without starting another traversal for the same project", async () => {
  let traversalCount = 0;
  const coordinator = createAssetScanCoordinator({ timeoutMs: 15 });
  const stalledScan = async () => {
    traversalCount += 1;
    await new Promise(() => {});
  };
  const observe = (promise) => Promise.race([
    promise.then(
      () => ({ status: "resolved" }),
      (error) => ({ status: "rejected", message: error.message }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ status: "pending" }), 50)),
  ]);

  assert.deepEqual(await observe(coordinator.run("project-a", stalledScan)), {
    status: "rejected",
    message: "资产扫描超时，请检查关联文件夹是否可访问后重试",
  });
  assert.deepEqual(await observe(coordinator.run("project-a", stalledScan)), {
    status: "rejected",
    message: "资产扫描超时，请检查关联文件夹是否可访问后重试",
  });
  assert.equal(traversalCount, 1);
});
