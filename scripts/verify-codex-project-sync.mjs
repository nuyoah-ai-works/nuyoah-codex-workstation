#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, connectMainCodex, readTargets } from "./cdp-client.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotPath = path.join(root, "output", "codex-project-sync-verification.png");

async function waitFor(check, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function clickPoint(client, point) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none", buttons: 0 });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
}

const main = await connectMainCodex();
main.requestTimeoutMs = 15_000;
let frame = null;
try {
  const shortcut = `Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]')).find((node) => node.dataset.codexSidebarShortcutName === '资产控制台')`;
  assert.equal(await waitFor(() => main.evaluate(`Boolean(${shortcut})`)), true, "Asset Console shortcut was not injected");
  if (await main.evaluate(`document.getElementById('codex-asset-console-page')?.hidden === false`)) {
    await main.evaluate(`document.querySelector('#codex-asset-console-page .codex-asset-console-close')?.click()`);
    assert.equal(await waitFor(() => main.evaluate(`document.getElementById('codex-asset-console-page')?.hidden === true`)), true);
  }
  assert.equal(await main.evaluate(`(() => { const node = ${shortcut}; node?.click(); return Boolean(node); })()`), true);
  assert.equal(await waitFor(() => main.evaluate(`document.getElementById('codex-asset-console-page')?.hidden === false`)), true, "real shortcut click did not open Asset Console");

  const target = await waitFor(async () => (await readTargets(9231)).find((item) => item.type === "iframe" && item.url.includes("/__codex_asset_console__/")));
  assert.ok(target?.webSocketDebuggerUrl, "Asset Console iframe target was not created");
  frame = new CdpClient(target.webSocketDebuggerUrl);
  await frame.connect();

  const synchronized = await waitFor(() => frame.evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('#localProjectList .project-item'));
    const synced = items.filter((item) => item.querySelector('.project-sync-badge'));
    const workspaceTitle = document.getElementById('workspaceTitle')?.textContent?.trim() || '';
    if (synced.length < 1 || !workspaceTitle || workspaceTitle === '选择一个项目') return null;
    return synced.map((item) => ({
      id: item.dataset.projectId,
      name: item.querySelector('strong')?.textContent?.trim() || '',
      badge: item.querySelector('.project-sync-badge')?.textContent?.trim() || '',
      folderCount: item.querySelector('small span')?.textContent?.trim() || '',
      active: item.classList.contains('active'),
    }));
  })()`), 25_000);
  assert.ok(synchronized?.length >= 1, "Codex production projects were not synchronized into Asset Console");
  assert.ok(synchronized.every((project) => project.badge === "Codex 同步"));

  const selectedProject = synchronized.find((project) => !project.active) || synchronized[0];
  const selectedId = selectedProject.id;
  const iframeRect = await main.evaluate(`(() => {
    const node = document.querySelector('#codex-asset-console-page iframe');
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  const projectPoint = await frame.evaluate(`(() => {
    const node = document.querySelector('#localProjectList .project-item[data-project-id="${selectedId}"]');
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, hit: hit === node || node.contains(hit) };
  })()`);
  assert.ok(iframeRect && projectPoint?.hit, "synchronized project was not visibly clickable");
  await clickPoint(main, { x: iframeRect.x + projectPoint.x, y: iframeRect.y + projectPoint.y });
  const selection = await waitFor(() => frame.evaluate(`(() => {
    const item = document.querySelector('#localProjectList .project-item[data-project-id="${selectedId}"]');
    const title = document.getElementById('workspaceTitle')?.textContent?.trim() || '';
    return item?.classList.contains('active') && title === ${JSON.stringify(selectedProject.name)} ? { active: true, title } : null;
  })()`));
  assert.equal(selection?.title, selectedProject.name, "real project click did not switch the synchronized workspace");

  await mkdir(path.dirname(screenshotPath), { recursive: true });
  const screenshot = await main.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  process.stdout.write(`${JSON.stringify({ synchronized, selection, screenshotPath }, null, 2)}\n`);
} finally {
  frame?.close();
  main.close();
}
