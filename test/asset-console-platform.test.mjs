import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const browserRoot = new URL("../vendor/codex-workspace-enhancer/asset-browser/", import.meta.url);
const consoleRoot = new URL("../vendor/codex-workspace-enhancer/asset-console/public/", import.meta.url);

test("Asset Console validates project paths for macOS and Windows", async () => {
  const source = await readFile(new URL("app.js", consoleRoot), "utf8");
  assert.match(source, /function isAbsoluteProjectPath\(value, platform/);
  assert.match(source, /platform === "win32"/);
  assert.match(source, /normalized\.startsWith\("\/"\)/);
  assert.doesNotMatch(source, /if \(!isAbsoluteWindowsProjectPath\(projectPath\)\)/);
});
test("Asset Console exposes multiple scan folders and platform-specific guidance", async () => {
  const html = await readFile(new URL("index.html", consoleRoot), "utf8");
  const source = await readFile(new URL("app.js", consoleRoot), "utf8");
  assert.match(html, /textarea id="codexNewProjectScanRoots"/);
  assert.match(html, /每行一个/);
  assert.match(source, /function parseScanRoots/);
  assert.match(source, /data\.system\?\.platform/);
  assert.match(source, /applyPlatformProjectUi/);
});

test("Asset Console follows current task context and exposes a visible insert action", async () => {
  const html = await readFile(new URL("index.html", consoleRoot), "utf8");
  const source = await readFile(new URL("app.js", consoleRoot), "utf8");
  assert.match(html, /id="taskContextBar"/);
  assert.match(html, /只看当前任务/);
  assert.match(source, /project\.codexSync\?\.projectId === state\.context\.projectId/);
  assert.match(source, /state\.contextOnly && assetRelation\(asset\) === '项目其他文件'/);
  assert.match(source, /asset\.promptAssociation\?\.threadId === state\.context\.threadId/);
  assert.match(source, /action === "context"/);
  assert.match(source, /data-action="use-in-codex"[^>]*>插入到任务</);
  assert.match(source, /<img src="\$\{asset\.mediaUrl\}"/);
});

test("Asset service publishes platform data and preserves every configured scan root", async () => {
  const server = await readFile(new URL("server.js", browserRoot), "utf8");
  assert.match(server, /system:\s*systemCapabilities\(\)/);
  assert.match(server, /platform:\s*process\.platform/);
  assert.match(server, /scanRoots:\s*normalizeScanRoots\(scanRoots\)/);
  assert.match(server, /for \(const scanRoot of project\.scanRoots\)/);
  assert.match(server, /\.heic/);
  assert.match(server, /\.avif/);
});
