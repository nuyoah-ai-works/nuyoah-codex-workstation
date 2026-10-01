import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as bridge from "../lib/asset-console-bridge.mjs";

test("library scans receive a longer bridge timeout than ordinary requests", () => {
  assert.equal(typeof bridge.assetConsoleTimeoutForRoute, "function", "route timeout policy is not implemented");
  assert.equal(bridge.assetConsoleTimeoutForRoute("/api/library?project=test"), 35_000);
  assert.equal(bridge.assetConsoleTimeoutForRoute("/api/projects"), 15_000);
  assert.equal(bridge.assetConsoleTimeoutForRoute("/"), 15_000);
});

test("asset bridge forwards task and project context into the private frame URL", async () => {
  const source = await readFile(new URL("../lib/asset-console-bridge.mjs", import.meta.url), "utf8");
  assert.match(source, /url\.searchParams\.set\("threadId", message\.threadId\)/);
  assert.match(source, /url\.searchParams\.set\("projectId", message\.projectId\)/);
  assert.match(source, /url\.searchParams\.set\("projectName", message\.projectName\)/);
});
