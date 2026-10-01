#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

const STORAGE_KEY = "codex-conversation-preview:thread-statuses";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(client, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await client.evaluate(expression)) return true;
    } catch {}
    await wait(80);
  }
  return false;
}

const client = await connectMainCodex(9231);
let originalStorage = null;
const activeThreadId = process.env.CODEX_THREAD_ID || await client.evaluate(`document.querySelector('[data-app-action-sidebar-thread-active="true"]')
  ?.getAttribute('data-app-action-sidebar-thread-id')
  ?.replace(/^(?:local|cloud):/i, '')`);

try {
  originalStorage = await client.evaluate(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-folder-tag="__all__"]'))`), true);
  await client.evaluate(`(() => {
    document.querySelector('[data-codex-sidebar-folder-clear]')?.click();
    document.querySelector('[data-codex-sidebar-folder-tag="__all__"]')?.click();
  })()`);
  assert.equal(await waitFor(client, `Boolean(document.getElementById('codex-sidebar-all-projects'))`), true);
  await client.evaluate(`(() => {
    const toggle = document.getElementById('codex-conversation-view-toggle');
    if (toggle?.getAttribute('aria-checked') !== 'true') toggle.click();
  })()`);
  assert.equal(await waitFor(client, `document.documentElement.dataset.codexConversationView === 'card'`), true);

  const target = await client.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('#codex-sidebar-all-projects [data-app-action-sidebar-thread-row]'))
      .find((candidate) => candidate.getClientRects().length > 0);
    return row ? {
      id: row.getAttribute('data-app-action-sidebar-thread-id'),
      title: row.getAttribute('data-app-action-sidebar-thread-title'),
    } : null;
  })()`);
  assert.ok(target?.id, "a visible conversation card is required");
  const rowSelector = `#codex-sidebar-all-projects [data-app-action-sidebar-thread-id=${JSON.stringify(target.id)}]`;

  await client.evaluate(`(() => {
    const key = ${JSON.stringify(STORAGE_KEY)};
    const statuses = JSON.parse(localStorage.getItem(key) || "{}");
    delete statuses[${JSON.stringify(target.id)}];
    localStorage.setItem(key, JSON.stringify(statuses));
  })()`);
  await client.send("Page.reload", { ignoreCache: true });
  assert.equal(await waitFor(client, `Boolean(window.__codexConversationPreviewInjection__)`), true);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-folder-tag="__all__"]')?.click()`);

  assert.equal(await waitFor(client, `Boolean(document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)}))`), true,
    "every visible conversation card must expose a status button");
  let actual = await client.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)});
    return {
      status: button?.dataset.status,
      label: button?.getAttribute('aria-label'),
      hasPopup: button?.getAttribute('aria-haspopup'),
    };
  })()`);
  assert.deepEqual(actual, {
    status: "unmarked",
    label: "状态：未标记",
    hasPopup: "menu",
  });

  const layout = await client.evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(rowSelector)});
    const button = row?.querySelector('[data-codex-conversation-status-button]');
    if (!row || !button) return null;
    const rowRect = row.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const centerX = buttonRect.left + buttonRect.width / 2;
    const centerY = buttonRect.top + buttonRect.height / 2;
    return {
      inAllView: Boolean(row.closest('#codex-sidebar-all-projects')),
      width: buttonRect.width,
      height: buttonRect.height,
      top: buttonRect.top - rowRect.top,
      right: rowRect.right - buttonRect.right,
      hitTarget: document.elementFromPoint(centerX, centerY) === button,
    };
  })()`);
  assert.equal(layout?.inAllView, true, "the status layout regression must be exercised in the All view");
  assert.ok(Math.abs(layout.width - 28) <= 1, `status button must stay 28px wide, got ${layout.width}px`);
  assert.ok(Math.abs(layout.height - 28) <= 1, `status button must stay 28px high, got ${layout.height}px`);
  assert.ok(Math.abs(layout.top - 9) <= 1, `status button must stay 9px from the card top, got ${layout.top}px`);
  assert.ok(Math.abs(layout.right - 9) <= 1, `status button must stay 9px from the card right, got ${layout.right}px`);
  assert.equal(layout.hitTarget, true, "the compact top-right status button must receive real pointer hits");

  const buttonCenter = await client.evaluate(`(() => {
    const rect = document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)})?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  assert.ok(buttonCenter);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...buttonCenter, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...buttonCenter, button: "left", clickCount: 1 });
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-conversation-status-menu]'))`), true);
  actual = await client.evaluate(`(() => {
    const menu = document.querySelector('[data-codex-conversation-status-menu]');
    return Array.from(menu?.querySelectorAll('[data-codex-conversation-status-option]') || []).map((item) => ({
      value: item.dataset.codexConversationStatusOption,
      text: item.textContent.trim(),
      checked: item.getAttribute('aria-checked'),
    }));
  })()`);
  assert.deepEqual(actual, [
    { value: "urgent-important", text: "紧急且重要", checked: "false" },
    { value: "urgent-or-important", text: "紧急或重要", checked: "false" },
    { value: "not-urgent", text: "不紧急", checked: "false" },
    { value: "clear", text: "清除标注", checked: null },
  ]);

  await client.evaluate(`document.querySelector('[data-codex-conversation-status-option="urgent-or-important"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)})?.dataset.status === 'urgent-or-important'`), true);
  assert.equal(await client.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}))[${JSON.stringify(target.id)}]`), "urgent-or-important");

  await client.evaluate(`document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)})?.click()`);
  await client.evaluate(`document.querySelector('[data-codex-conversation-status-option="clear"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)})?.dataset.status === 'unmarked'`), true);
  assert.equal(await client.evaluate(`Object.hasOwn(JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || '{}'), ${JSON.stringify(target.id)})`), false,
    "clearing a marker must delete its persisted state");

  await client.evaluate(`document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)})?.click()`);
  await client.evaluate(`document.querySelector('[data-codex-conversation-status-option="not-urgent"]')?.click()`);
  await client.send("Page.reload", { ignoreCache: true });
  assert.equal(await waitFor(client, `Boolean(window.__codexConversationPreviewInjection__)`), true);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector(${JSON.stringify(`${rowSelector} [data-codex-conversation-status-button]`)})?.dataset.status === 'not-urgent'`), true,
    "the selected status must survive a renderer reload");

  process.stdout.write(`${JSON.stringify({ target, layout, statuses: ["unmarked", "urgent-important", "urgent-or-important", "not-urgent", "clear"] }, null, 2)}\n`);
} finally {
  try {
    await client.evaluate(`(() => {
      const original = ${JSON.stringify(originalStorage)};
      if (original == null) localStorage.removeItem(${JSON.stringify(STORAGE_KEY)});
      else localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, original);
    })()`);
    await client.send("Page.reload", { ignoreCache: true });
    await waitFor(client, `Boolean(window.__codexConversationPreviewInjection__)`, 20_000);
    if (activeThreadId) {
      await client.evaluate(`window.postMessage({ type: 'navigate-to-route', path: ${JSON.stringify(`/local/${activeThreadId}`)} }, '*')`);
    }
  } catch {}
  client.close();
}
