#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, connectMainCodex, readTargets } from "./cdp-client.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manualReviewScreenshotPath = path.join(root, "output", "manual-review-actions-verification.png");

async function waitFor(check, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
}

async function clickAt(client, expression, clickCount = 1) {
  const point = await client.evaluate(`(() => {
    const node = ${expression};
    if (!node) return null;
    const r = node.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    return { x, y, hit: document.elementFromPoint(x, y) === node || node.contains(document.elementFromPoint(x, y)) };
  })()`);
  assert.ok(point, `click target missing: ${expression}`);
  assert.equal(point.hit, true, `click target is covered: ${expression}`);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none", buttons: 0 });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount });
}

const main = await connectMainCodex();
let frame = null;
try {
  const shortcutReady = await waitFor(() => main.evaluate(`Boolean(Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]')).find((node) => node.dataset.codexSidebarShortcutName === '资产控制台'))`), 15_000);
  assert.equal(shortcutReady, true, "Asset Console shortcut was not injected after runtime restart");
  const open = await main.evaluate(`document.getElementById('codex-asset-console-page')?.hidden === false`);
  if (open) {
    await main.evaluate(`document.querySelector('#codex-asset-console-page .codex-asset-console-close')?.click()`);
    await waitFor(() => main.evaluate(`document.getElementById('codex-asset-console-page')?.hidden === true`));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const openedForVerification = await main.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]'))
      .find((node) => node.dataset.codexSidebarShortcutName === '资产控制台');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(openedForVerification, true, "Asset Console shortcut could not prepare the verification surface");
  const target = await waitFor(async () => (await readTargets(9231)).find((item) => item.type === "iframe" && item.url.includes("/__codex_asset_console__/")));
  assert.ok(target?.webSocketDebuggerUrl, "Asset Console iframe target was not created");
  frame = new CdpClient(target.webSocketDebuggerUrl);
  await frame.connect();
  const ready = await waitFor(() => frame.evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('.app-shell'))`));
  assert.equal(ready, true, "local asset manager did not finish loading");
  const libraryLoaded = await waitFor(() => frame.evaluate(`document.querySelectorAll('#localProjectList .project-item').length > 0 && document.querySelectorAll('#assetGrid .asset-card').length > 0 && !document.getElementById('scanState')?.classList.contains('busy')`));
  assert.equal(libraryLoaded, true, "local project assets did not finish scanning");

  const initial = await frame.evaluate(`(() => ({
    title: document.title,
    projectCount: document.querySelectorAll('#localProjectList .project-item').length,
    smartGroups: Array.from(document.querySelectorAll('#smartGroupTabs [data-smart-group]')).map((node) => ({
      name: node.querySelector('span')?.textContent?.trim() || '',
      count: Number(node.querySelector('small')?.textContent || 0),
      selected: node.getAttribute('aria-selected') === 'true',
    })),
    tabs: Array.from(document.querySelectorAll('[data-asset-kind]')).map((node) => node.textContent.trim()),
    searchPlaceholder: document.getElementById('librarySearchInput')?.placeholder || '',
    cardCount: document.querySelectorAll('#assetGrid .asset-card').length,
    sidebarWidth: Math.round(document.querySelector('.library-sidebar')?.getBoundingClientRect().width || 0),
    columns: getComputedStyle(document.documentElement).getPropertyValue('--asset-columns').trim(),
  }))()`);
  assert.equal(initial.title, "本地资产库");
  assert.deepEqual(initial.smartGroups.map((item) => item.name), ["正式资产", "待确认", "干扰项"]);
  assert.equal(initial.smartGroups[0].selected, true);
  assert.ok(initial.smartGroups.every((item) => item.count >= 0));
  assert.deepEqual(initial.tabs.map((item) => item.replace(/\d+/g, "")), ["全部", "文本", "图片", "音频", "视频"]);
  assert.match(initial.searchPlaceholder, /名称、内容、分类或标签/);
  assert.ok(initial.sidebarWidth >= 200);

  const classificationAudit = await frame.evaluate(`(() => {
    const groups = ['asset', 'review', 'noise'];
    const byGroup = Object.fromEntries(groups.map((group) => [
      group,
      Number(document.querySelector('[data-smart-count="' + group + '"]')?.textContent || 0),
    ]));
    return {
      total: Object.values(byGroup).reduce((sum, count) => sum + count, 0),
      byGroup,
      zeroToken: /0 Token/.test(document.querySelector('.local-rule-note')?.textContent || ''),
    };
  })()`);
  assert.deepEqual(classificationAudit.byGroup, Object.fromEntries(initial.smartGroups.map((item, index) => [["asset", "review", "noise"][index], item.count])));
  assert.equal(classificationAudit.zeroToken, true);
  assert.ok(classificationAudit.byGroup.noise > 0);

  await frame.evaluate(`document.querySelector('#smartGroupTabs [data-smart-group="noise"]')?.click()`);
  const noiseView = await waitFor(() => frame.evaluate(`(() => {
    const button = document.querySelector('#smartGroupTabs [data-smart-group="noise"]');
    const cards = Array.from(document.querySelectorAll('#assetGrid .asset-card'));
    if (button?.getAttribute('aria-selected') !== 'true' || !cards.length) return null;
    return {
      active: true,
      cardCount: cards.length,
      allNoise: cards.every((card) => card.dataset.smartGroup === 'noise'),
      hasAutomaticTag: Boolean(document.querySelector('#assetGrid .asset-tag.automatic')),
      hasConfidence: Array.from(document.querySelectorAll('#assetGrid .classification-line')).some((node) => /[0-9]+%/.test(node.textContent)),
    };
  })()`));
  assert.equal(noiseView?.allNoise, true, "noise tab did not immediately filter cards");
  assert.equal(noiseView?.hasAutomaticTag, true, "noise cards did not expose automatic tags");
  assert.equal(noiseView?.hasConfidence, true, "noise cards did not expose confidence");

  await frame.evaluate(`document.querySelector('#smartGroupTabs [data-smart-group="review"]')?.click()`);
  const reviewActions = await waitFor(() => frame.evaluate(`(() => {
    const button = document.querySelector('#smartGroupTabs [data-smart-group="review"]');
    const card = document.querySelector('#assetGrid .asset-card[data-smart-group="review"]');
    if (button?.getAttribute('aria-selected') !== 'true' || !card) return null;
    return {
      cardCount: document.querySelectorAll('#assetGrid .asset-card[data-smart-group="review"]').length,
      categoryButtons: document.querySelectorAll('#assetGrid [data-action="manual-category"]').length,
      tagButtons: document.querySelectorAll('#assetGrid [data-action="manual-tags"]').length,
    };
  })()`));
  assert.ok(reviewActions?.cardCount > 0, "review tab did not expose assets for manual review");
  assert.equal(reviewActions.categoryButtons, reviewActions.cardCount, "some review cards are missing manual category actions");
  assert.equal(reviewActions.tagButtons, reviewActions.cardCount, "some review cards are missing manual tag actions");

  await frame.evaluate(`(async () => { const node = document.querySelector('#assetGrid [data-action="manual-category"]'); node?.scrollIntoView({ behavior: 'instant', block: 'center' }); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); return Boolean(node); })()`);
  await clickAt(frame, `document.querySelector('#assetGrid [data-action="manual-category"]')`);
  const manualCategoryDialog = await waitFor(() => frame.evaluate(`(() => {
    if (document.getElementById('assetActionDialog')?.open !== true) return null;
    return {
      open: true,
      title: document.getElementById('assetActionTitle')?.textContent || '',
      selectedGroup: document.querySelector('#assetActionFields [name="smartGroup"]')?.value || '',
    };
  })()`));
  assert.deepEqual(manualCategoryDialog, { open: true, title: "手动分类", selectedGroup: "asset" });
  await frame.evaluate(`document.getElementById('assetActionDialog')?.close()`);
  assert.equal(await waitFor(() => frame.evaluate(`document.getElementById('assetActionDialog')?.open === false`)), true);
  frame.close();
  frame = null;
  const refreshedTarget = await waitFor(async () => (await readTargets(9231)).find((item) => item.type === "iframe" && item.url.includes("/__codex_asset_console__/")));
  assert.ok(refreshedTarget?.webSocketDebuggerUrl, "Asset Console iframe target disappeared between manual action checks");
  frame = new CdpClient(refreshedTarget.webSocketDebuggerUrl);
  await frame.connect();
  await frame.evaluate(`(async () => { const node = document.querySelector('#assetGrid [data-action="manual-tags"]'); node?.scrollIntoView({ behavior: 'instant', block: 'center' }); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); return Boolean(node); })()`);

  await clickAt(frame, `document.querySelector('#assetGrid [data-action="manual-tags"]')`);
  const manualTagDialog = await waitFor(() => frame.evaluate(`(() => {
    if (document.getElementById('assetActionDialog')?.open !== true) return null;
    return {
      open: true,
      title: document.getElementById('assetActionTitle')?.textContent || '',
      customInput: Boolean(document.querySelector('#assetActionFields [name="customTags"][type="text"]')),
      preservedGroup: document.querySelector('#assetActionFields [name="smartGroup"]')?.value || '',
    };
  })()`));
  assert.deepEqual(manualTagDialog, { open: true, title: "手动标签", customInput: true, preservedGroup: "review" });
  await mkdir(path.dirname(manualReviewScreenshotPath), { recursive: true });
  const manualReviewScreenshot = await main.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(manualReviewScreenshotPath, Buffer.from(manualReviewScreenshot.data, "base64"));

  process.stdout.write(`${JSON.stringify({ initial, classificationAudit, noiseView, reviewActions, manualCategoryDialog, manualTagDialog, manualReviewScreenshotPath }, null, 2)}\n`);
} finally {
  frame?.close();
  main.close();
}
