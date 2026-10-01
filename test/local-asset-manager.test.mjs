import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const browserRoot = new URL("../vendor/codex-workspace-enhancer/asset-browser/", import.meta.url);
const consoleRoot = new URL("../vendor/codex-workspace-enhancer/asset-console/public/", import.meta.url);

test("local asset manager exposes project navigation and four asset workspaces", async () => {
  const html = await readFile(new URL("index.html", consoleRoot), "utf8");
  assert.match(html, /id="localProjectList"/);
  assert.match(html, /data-asset-kind="text"/);
  assert.match(html, /data-asset-kind="image"/);
  assert.match(html, /data-asset-kind="audio"/);
  assert.match(html, /data-asset-kind="video"/);
  assert.match(html, /id="assetColumnRange"/);
  assert.match(html, /id="tagManager"/);
});

test("local asset cards implement media-specific interactions", async () => {
  const source = await readFile(new URL("app.js", consoleRoot), "utf8");
  assert.match(source, /renderTextCard/);
  assert.match(source, /renderImageCard/);
  assert.match(source, /renderAudioCard/);
  assert.match(source, /renderVideoCard/);
  assert.match(source, /mouseenter/);
  assert.match(source, /requestFullscreen/);
  assert.match(source, /dblclick/);
  const doubleClickHandlers = source.match(/card\.addEventListener\("dblclick",[\s\S]*?\n  \}\);/g) || [];
  assert.equal(doubleClickHandlers.length, 4);
  doubleClickHandlers.forEach((handler) => assert.match(handler, /useAssetInCodex\(asset\)/));
  assert.match(source, /data-action="preview"/);
  assert.match(source, /function previewAsset/);
  assert.match(source, /saveTextAsset/);
  assert.match(source, /data-action="use-in-codex"/);
  assert.match(source, /function useAssetInCodex/);
  assert.match(source, /action: "use-in-codex"/);
  assert.match(source, /action === "asset-added" \|\| message\.action === "assets-added"/);
  assert.match(source, /action === "asset-add-failed"/);
  assert.match(source, /正在插入到当前任务/);
  assert.match(source, /message\.action === "search"/);
  assert.doesNotMatch(source, /data-action="delete"/);
  assert.doesNotMatch(source, /永久删除/);
});

test("local asset manager reads a persistent index and reserves full scans for the repair button", async () => {
  const source = await readFile(new URL("app.js", consoleRoot), "utf8");
  const server = await readFile(new URL("server.js", browserRoot), "utf8");
  assert.match(source, /正在读取索引/);
  assert.match(source, /loadLibrary\(\{ force: true \}\)/);
  assert.match(source, /query\.set\("rescan", "1"\)/);
  assert.match(server, /PersistentAssetIndex/);
  assert.match(server, /scheduleAssetIndexUpdate/);
  assert.match(server, /cachedLibraryResponse/);
  assert.match(server, /MAX_LIBRARY_RESPONSE_CACHE_ENTRIES = 4/);
  assert.match(server, /url\.searchParams\.get\("rescan"\) === "1"/);
});

test("local asset manager exposes zero-token smart groups and manual overrides", async () => {
  const html = await readFile(new URL("index.html", consoleRoot), "utf8");
  const source = await readFile(new URL("app.js", consoleRoot), "utf8");
  assert.match(html, /id="smartGroupTabs"/);
  assert.match(html, /data-smart-group="asset"/);
  assert.match(html, /data-smart-group="review"/);
  assert.match(html, /data-smart-group="noise"/);
  assert.match(source, /classificationReason/);
  assert.match(source, /classificationSource/);
  assert.match(source, /form\.get\("smartGroup"\)/);
});

test("review cards expose direct manual category and tag actions", async () => {
  const html = await readFile(new URL("index.html", consoleRoot), "utf8");
  const source = await readFile(new URL("app.js", consoleRoot), "utf8");
  assert.match(html, /<script type="module" src="\/app\.js"><\/script>/);
  assert.match(source, /asset\.smartGroup === "review"/);
  assert.match(source, /data-action="manual-category"/);
  assert.match(source, /data-action="manual-tags"/);
  assert.match(source, /addEventListener\("pointerdown"/);
  assert.match(source, /openManualReviewAction/);
  assert.match(source, /mergeManualTags/);
  assert.match(source, /defaultManualSmartGroup/);
});

test("linked media opens a split asset and prompt preview", async () => {
  const html = await readFile(new URL("index.html", consoleRoot), "utf8");
  const source = await readFile(new URL("app.js", consoleRoot), "utf8");
  const styles = await readFile(new URL("ui-v3.css", consoleRoot), "utf8");
  assert.match(html, /id="mediaPreviewDialog"/);
  assert.match(html, /id="mediaPreviewStage"/);
  assert.match(html, /id="mediaPromptPanel"/);
  assert.match(source, /promptAssociation\?\.available/);
  assert.match(source, /\/api\/assets\/prompt/);
  assert.match(source, /openMediaAsset/);
  assert.match(styles, /\.media-preview-layout\.has-prompt/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0,\s*1\.2fr\)\s+minmax\(320px,\s*0\.8fr\)/);
});

test("asset service supports multi-folder projects, reassignment, and disables permanent deletion", async () => {
  const server = await readFile(new URL("server.js", browserRoot), "utf8");
  assert.match(server, /textExts/);
  assert.match(server, /listLibraryAssets/);
  assert.match(server, /project\.folders/);
  assert.match(server, /assignAssetToProject/);
  assert.match(server, /renameLibraryAsset/);
  assert.doesNotMatch(server, /function deleteLibraryAsset/);
  assert.match(server, /readTextAsset/);
  assert.match(server, /saveTextAsset/);
  assert.match(server, /\/api\/library/);
  assert.match(server, /\/api\/assets\/assign/);
  assert.match(server, /\/api\/assets\/rename/);
  assert.match(server, /\/api\/assets\/delete/);
  assert.match(server, /V1 不提供永久删除/);
  assert.match(server, /\/api\/text/);
  assert.match(server, /\/api\/assets\/prompt/);
  assert.match(server, /syncCodexProductionProjects/);
  assert.match(server, /\/api\/codex-project-sync/);
});

test("Codex-synchronized production projects are visibly identified", async () => {
  const source = await readFile(new URL("app.js", consoleRoot), "utf8");
  const styles = await readFile(new URL("ui-v3.css", consoleRoot), "utf8");
  assert.match(source, /project\.codexSync\?\.projectId/);
  assert.match(source, /Codex 同步/);
  assert.match(styles, /\.project-sync-badge/);
});

test("embedded and service-served asset manager builds stay synchronized", async () => {
  for (const file of ["index.html", "app.js", "asset-metadata-ui.js", "ui-v3.css"]) {
    const embedded = await readFile(new URL(file, consoleRoot), "utf8");
    const served = await readFile(new URL(`public/${file}`, browserRoot), "utf8");
    assert.equal(embedded, served, `${file} differs between the embedded and service builds`);
  }
});
