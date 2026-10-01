#!/usr/bin/env node

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { CdpClient, readTargets, selectMainCodexTarget } from "./cdp-client.mjs";

const outputPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const target = selectMainCodexTarget(await readTargets(9231));
assert.ok(target, "main Codex renderer target must exist");
const client = new CdpClient(target.webSocketDebuggerUrl, { requestTimeoutMs: 10_000 });
await client.connect();
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function clickViewToggle() {
  const target = await client.evaluate(`(() => {
    const button = document.getElementById('codex-conversation-view-toggle');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return {
      x,
      y,
      hit: document.elementFromPoint(x, y)?.closest?.('button')?.id || null,
      appRegion: getComputedStyle(button.parentElement).webkitAppRegion,
    };
  })()`);
  assert.ok(target, "view toggle must remain mounted for a real pointer click");
  assert.equal(target.hit, "codex-conversation-view-toggle");
  assert.equal(target.appRegion, "no-drag");
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: target.x, y: target.y, button: "left", buttons: 1, clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: target.x, y: target.y, button: "left", buttons: 0, clickCount: 1,
  });
}

try {
  await client.evaluate(`(() => {
    document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click();
    document.querySelector('[data-codex-sidebar-folder-clear]')?.click();
    document.querySelector('[data-codex-sidebar-folder-label="管理优化"]')?.click();
  })()`);
  await wait(350);
  let initial = null;
  for (let attempt = 0; attempt < 20 && !initial; attempt += 1) {
    initial = await client.evaluate(`(() => {
    const button = document.getElementById('codex-conversation-view-toggle');
    const search = document.querySelector('button[aria-label="搜索"], button[aria-label="Search"]');
    if (!button || !search) return null;
    const buttonRect = button.getBoundingClientRect();
    const searchRect = search.getBoundingClientRect();
    return {
      mode: document.documentElement.dataset.codexConversationView,
      label: button.getAttribute('aria-label'),
      beforeSearch: buttonRect.right <= searchRect.left + 1,
      sameHost: button.parentElement === search.parentElement.parentElement,
    };
    })()`);
    if (!initial) await wait(100);
  }
  assert.ok(initial, "view toggle must exist");
  assert.equal(initial.beforeSearch, true);
  assert.equal(initial.sameHost, true);

  if (initial.mode !== "list") {
    await clickViewToggle();
    await wait(250);
  }
  await clickViewToggle();
  await wait(350);
  await client.evaluate(`(() => {
    const grid = Array.from(document.querySelectorAll('[data-codex-conversation-card-grid="true"]'))
      .find((candidate) => candidate.querySelectorAll(':scope > [data-codex-conversation-card-item="true"]').length >= 2);
    const row = grid?.querySelector('[data-app-action-sidebar-thread-row]');
    row?.scrollIntoView({ block: 'center' });
  })()`);
  await wait(350);

  let card = null;
  for (let attempt = 0; attempt < 20 && !card; attempt += 1) {
    card = await client.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row][data-codex-conversation-preview-enhanced="true"]'))
        .find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.top > 190 && rect.bottom < innerHeight - 60
            && candidate.closest('[data-codex-conversation-card-grid="true"]')?.querySelectorAll(':scope > [data-codex-conversation-card-item="true"]').length >= 2;
        });
      if (!row) return null;
      const rect = row.getBoundingClientRect();
      const grid = row.closest('[data-codex-conversation-card-grid="true"]');
      const gridRows = grid
        ? Array.from(grid.querySelectorAll(':scope > [data-codex-conversation-card-item="true"] [data-app-action-sidebar-thread-row]')).slice(0, 2)
        : [];
      const slotMetrics = gridRows.map((candidate) => {
        const cardRect = candidate.getBoundingClientRect();
        const metrics = (selector) => {
          const slot = candidate.querySelector(selector)?.getBoundingClientRect();
          return slot ? {
            top: slot.top - cardRect.top,
            bottom: slot.bottom - cardRect.top,
            left: slot.left - cardRect.left,
            height: slot.height,
          } : null;
        };
        return {
          x: cardRect.x,
          y: cardRect.y,
          width: cardRect.width,
          height: cardRect.height,
          title: metrics('.codex-conversation-card-title'),
          time: metrics('.codex-conversation-card-time'),
          summary: metrics('.codex-conversation-card-summary'),
          tags: metrics('.codex-conversation-card-tags'),
        };
      });
      const summary = row.querySelector('.codex-conversation-card-summary');
      const time = row.querySelector('.codex-conversation-card-time');
      const tags = Array.from(row.querySelectorAll('.codex-conversation-card-tags > span'));
      const style = getComputedStyle(row);
      return {
        mode: document.documentElement.dataset.codexConversationView,
        title: row.getAttribute('data-app-action-sidebar-thread-title'),
        height: rect.height,
        center: { x: rect.left + Math.min(rect.width / 2, 180), y: rect.top + rect.height / 2 },
        background: style.backgroundColor,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
        gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : '',
        firstRowPair: slotMetrics,
        summary: summary?.textContent || '',
        summaryClamp: getComputedStyle(summary).webkitLineClamp,
        lastCommunication: time?.textContent || '',
        timeDisplay: getComputedStyle(time).display,
        tags: tags.map((tag) => tag.textContent),
      };
    })()`);
    if (!card) await wait(150);
  }
  assert.ok(card, "a visible card must exist");
  assert.equal(card.mode, "card");
  assert.equal(card.height, 168);
  assert.equal(card.gridColumns.trim().split(/\s+/).length, 2);
  assert.equal(card.firstRowPair.length, 2);
  assert.equal(card.firstRowPair[0].y, card.firstRowPair[1].y);
  assert.ok(card.firstRowPair[1].x > card.firstRowPair[0].x);
  for (const slot of ["title", "time", "summary", "tags"]) {
    assert.equal(card.firstRowPair[0][slot].top, card.firstRowPair[1][slot].top);
    assert.equal(card.firstRowPair[0][slot].left, card.firstRowPair[1][slot].left);
  }
  for (const item of card.firstRowPair) {
    assert.equal(item.height, 168);
    assert.ok(item.title.bottom <= item.time.top);
    assert.ok(item.time.bottom <= item.summary.top);
    assert.ok(item.summary.bottom <= item.tags.top);
  }
  assert.ok(card.summary);
  assert.equal(card.summaryClamp, "2");
  assert.ok(card.lastCommunication);
  assert.equal(card.timeDisplay, "block");
  assert.equal(card.tags.length, 3);
  assert.equal(new Set(card.tags).size, 3);
  for (const lowValue of ["V16", "V2", "SUCCESS", "ZIP", "API", "Codex"]) {
    assert.equal(card.tags.includes(lowValue), false);
  }

  if (outputPath) {
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 100 });
    await wait(400);
    const { data } = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: 760, height: 1200, scale: 1 },
    });
    await writeFile(outputPath, Buffer.from(data, "base64"));
  }

  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 110 });
  await wait(300);
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const currentCenter = await client.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]'))
        .find((candidate) => candidate.getAttribute('data-app-action-sidebar-thread-title') === ${JSON.stringify(card.title)});
      const rect = row?.getBoundingClientRect();
      return rect ? { x: rect.left + Math.min(rect.width / 2, 180), y: rect.top + rect.height / 2 } : null;
    })()`);
    assert.ok(currentCenter, "hover target must remain mounted");
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: currentCenter.x + (attempt % 2),
      y: currentCenter.y,
    });
    await wait(300);
    const ready = await client.evaluate(`Boolean(document.querySelector('[role="tooltip"] .codex-conversation-hover-details'))`);
    if (ready) break;
  }
  const hover = await client.evaluate(`(() => {
    const details = document.querySelector('[role="tooltip"] .codex-conversation-hover-details');
    if (!details) return null;
    const texts = Array.from(details.querySelectorAll('.codex-conversation-preview-text'));
    return {
      labels: Array.from(details.querySelectorAll('.codex-conversation-preview-label')).map((node) => node.textContent),
      clamps: texts.map((node) => getComputedStyle(node).webkitLineClamp),
    };
  })()`);
  assert.deepEqual(hover?.labels, ["核心总结", "最近输入", "最近输出"]);
  assert.deepEqual(hover?.clamps, ["3", "3", "3"]);

  await clickViewToggle();
  await wait(350);
  const restored = await client.evaluate(`(() => {
    const row = document.querySelector('[data-app-action-sidebar-thread-row][data-codex-conversation-preview-enhanced="true"]');
    const card = row?.querySelector('.codex-conversation-card-content');
    return {
      mode: document.documentElement.dataset.codexConversationView,
      height: row?.getBoundingClientRect().height,
      cardDisplay: card ? getComputedStyle(card).display : null,
      label: document.getElementById('codex-conversation-view-toggle')?.getAttribute('aria-label'),
    };
  })()`);
  assert.equal(restored.mode, "list");
  assert.ok(restored.height <= 70);
  assert.equal(restored.cardDisplay, "none");
  assert.equal(restored.label, "卡片视图已关闭，切换为卡片视图");

  process.stdout.write(`${JSON.stringify({ initial, card, hover, restored, screenshot: outputPath }, null, 2)}\n`);
} finally {
  try {
    const mode = await client.evaluate(`document.documentElement.dataset.codexConversationView`);
    if (mode === "card") await clickViewToggle();
  } catch {}
  client.close();
}
