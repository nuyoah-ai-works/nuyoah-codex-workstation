#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, connectMainCodex, readTargets } from "./cdp-client.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotPath = path.join(root, "output", "prompt-association-preview-verification.png");

async function waitFor(check, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
}

async function doubleClickAt(client, point) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none", buttons: 0 });
  for (const clickCount of [1, 2]) {
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount });
    await new Promise((resolve) => setTimeout(resolve, 70));
  }
}

const main = await connectMainCodex();
main.requestTimeoutMs = 15_000;
let frame = null;
try {
  const alreadyOpen = await main.evaluate(`document.getElementById('codex-asset-console-page')?.hidden === false`);
  if (alreadyOpen) {
    await main.evaluate(`document.querySelector('#codex-asset-console-page .codex-asset-console-close')?.click()`);
    await waitFor(() => main.evaluate(`document.getElementById('codex-asset-console-page')?.hidden === true`));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const started = await main.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]'))
      .find((node) => node.dataset.codexSidebarShortcutName === '资产控制台');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(started, true, "Asset Console shortcut was not available");
  const target = await waitFor(async () => (await readTargets(9231)).find((item) => item.type === "iframe" && item.url.includes("/__codex_asset_console__/")));
  assert.ok(target?.webSocketDebuggerUrl, "Asset Console iframe target was not created");
  frame = new CdpClient(target.webSocketDebuggerUrl, { requestTimeoutMs: 15_000 });
  await frame.connect();
  assert.equal(await waitFor(() => frame.evaluate(`document.readyState === 'complete' && document.querySelectorAll('#assetGrid .asset-card').length > 0`)), true);

  let group = await waitFor(() => frame.evaluate(`document.querySelector('#assetGrid .prompt-link-badge')?.closest('.asset-card')?.dataset.smartGroup || null`));
  group ||= await waitFor(async () => {
    for (const name of ["asset", "review", "noise"]) {
      const tabPoint = await frame.evaluate(`(() => { const node = document.querySelector('#smartGroupTabs [data-smart-group="${name}"]'); if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!tabPoint) continue;
      await frame.send("Input.dispatchMouseEvent", { type: "mousePressed", x: tabPoint.x, y: tabPoint.y, button: "left", buttons: 1, clickCount: 1 });
      await frame.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: tabPoint.x, y: tabPoint.y, button: "left", buttons: 0, clickCount: 1 });
      const found = await waitFor(() => frame.evaluate(`document.querySelector('#assetGrid .prompt-link-badge')?.closest('.asset-card')?.dataset.smartGroup === ${JSON.stringify(name)}`), 3_000);
      if (found) return name;
    }
    return null;
  });
  assert.ok(group, "No prompt-linked asset card was visible in any smart group");

  const iframeRect = await main.evaluate(`(() => {
    const frame = document.querySelector('#codex-asset-console-page iframe');
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  assert.ok(iframeRect?.width > 0 && iframeRect?.height > 0, "Asset Console iframe was not visible");
  const relativePoint = await frame.evaluate(`(() => {
    const card = document.querySelector('#assetGrid .prompt-link-badge')?.closest('.asset-card');
    const target = card?.querySelector('.media-frame') || card?.querySelector('.audio-visual') || card;
    if (!target) return null;
    const offset = (node) => {
      let x = 0;
      let y = 0;
      for (let current = node; current && current !== document.body; current = current.offsetParent) {
        x += current.offsetLeft;
        y += current.offsetTop;
      }
      return { x, y };
    };
    const position = offset(target);
    const scroller = document.scrollingElement;
    const viewportHeight = ${JSON.stringify(iframeRect.height)};
    scroller.scrollTop = Math.max(0, position.y - viewportHeight / 2 + target.offsetHeight / 2);
    const x = position.x + target.offsetWidth / 2;
    const y = position.y - scroller.scrollTop + target.offsetHeight / 2;
    return {
      x,
      y,
      width: target.offsetWidth,
      height: target.offsetHeight,
      scrollTop: scroller.scrollTop,
    };
  })()`);
  assert.ok(relativePoint?.width > 0 && relativePoint?.height > 0, "Prompt-linked card had no clickable area");
  assert.ok(relativePoint.x > 0 && relativePoint.x < iframeRect.width, "Prompt-linked card was outside the horizontal viewport");
  assert.ok(relativePoint.y > 0 && relativePoint.y < iframeRect.height, "Prompt-linked card was outside the vertical viewport");
  await doubleClickAt(main, {
    x: iframeRect.x + relativePoint.x,
    y: iframeRect.y + relativePoint.y,
  });
  const preview = await waitFor(() => frame.evaluate(`(() => {
    const dialog = document.getElementById('mediaPreviewDialog');
    const layout = document.getElementById('mediaPreviewLayout');
    const stage = document.getElementById('mediaPreviewStage');
    const prompt = document.getElementById('mediaPromptPanel');
    if (!dialog?.open || prompt?.hidden || !layout?.classList.contains('has-prompt')) return null;
    return {
      title: document.getElementById('mediaPreviewTitle')?.textContent?.trim() || '',
      group: ${JSON.stringify(group)},
      promptLength: document.getElementById('mediaPromptText')?.textContent?.trim().length || 0,
      stageMedia: stage.querySelector('img, video, audio')?.tagName || '',
      leftBeforeRight: stage.offsetLeft + stage.offsetWidth <= prompt.offsetLeft + 1,
      columns: getComputedStyle(layout).gridTemplateColumns,
      badge: document.querySelector('#assetGrid .prompt-link-badge')?.textContent?.trim() || '',
    };
  })()`));
  assert.ok(preview?.promptLength > 10, "Linked prompt content was not loaded");
  assert.equal(preview.leftBeforeRight, true, "Asset and prompt were not laid out left-to-right");
  assert.match(preview.badge, /已关联提示词/);
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  const screenshot = await main.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  process.stdout.write(`${JSON.stringify({ preview, screenshotPath }, null, 2)}\n`);
} finally {
  frame?.close();
  main.close();
}
