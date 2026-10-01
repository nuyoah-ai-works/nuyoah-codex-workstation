#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

async function waitFor(client, expression, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (!await client.evaluate(expression)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return true;
}

async function clickAt(client, selector) {
  const point = await client.evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    const rect = target?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return null;
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    return {
      x,
      y,
      hit: document.elementFromPoint(x, y)?.closest("button") === target,
    };
  })()`);
  assert.ok(point, `click target must be visible: ${selector}`);
  assert.equal(point.hit, true, `real pointer hit must reach: ${selector}`);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

const client = await connectMainCodex(9231);
const activeThreadId = await client.evaluate(`document.querySelector('[data-app-action-sidebar-thread-active="true"]')
  ?.getAttribute('data-app-action-sidebar-thread-id')
  ?.replace(/^(?:local|cloud):/i, '')`);
assert.match(activeThreadId || "", /^[0-9a-f-]{36}$/i,
  "verification must start from a routable active task");
const threadRoute = `/local/${activeThreadId}`;

try {
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  assert.equal(await waitFor(client, `Boolean(document.getElementById("codex-sidebar-folder-switcher"))`), true,
    "project folder switcher must be available");
  await client.evaluate(`document.querySelector('[data-codex-sidebar-folder-clear]')?.click()`);

  const verified = [];
  for (const label of ["管理优化", "为创新而生"]) {
    await client.evaluate(`document.querySelector('[data-codex-sidebar-folder-label=${JSON.stringify(label)}]')?.click()`);
    assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-folder-tag][aria-pressed="true"]')?.dataset.codexSidebarFolderLabel === ${JSON.stringify(label)}`), true,
      `folder tag must select ${label}`);

    const target = await client.evaluate(`(() => {
      const tag = document.querySelector('[data-codex-sidebar-folder-tag][aria-pressed="true"]');
      const button = document.querySelector('[data-codex-sidebar-folder-create]');
      return {
        id: tag?.dataset.codexSidebarFolderTag,
        label: tag?.dataset.codexSidebarFolderLabel,
        buttonTarget: button?.dataset.codexSidebarFolderCreate,
        title: button?.title,
        ariaLabel: button?.getAttribute('aria-label'),
      };
    })()`);
    assert.equal(target.buttonTarget, target.id,
      "create control must be explicitly bound to the currently selected folder id");
    assert.equal(target.title, `在“${label}”文件夹下创建项目`);
    assert.equal(target.ariaLabel, `在 ${label} 中开始新聊天`,
      "native per-folder create action must remain the click source");

    await clickAt(client, `[data-codex-sidebar-folder-create="${target.id}"]`);
    assert.equal(await waitFor(client, `document.body.innerText.includes(${JSON.stringify(`要在 ${label} 内开发什么？`)})`), true,
      `real click must open the composer scoped to ${label}`);
    verified.push({ label, id: target.id });

    await client.evaluate(`window.postMessage({ type: "navigate-to-route", path: ${JSON.stringify(threadRoute)} }, "*")`);
    assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-folder-label=${JSON.stringify(label)}]'))`), true,
      "sidebar must recover after returning to the current task");
  }

  await client.evaluate(`document.querySelector('[data-codex-sidebar-folder-label="全部"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-folder-tag][aria-pressed="true"]')?.dataset.codexSidebarFolderLabel === '全部'`), true);
  assert.equal(await client.evaluate(`document.querySelectorAll('[data-codex-sidebar-folder-create]').length`), 0,
    "all-projects aggregation has no single folder target and must not expose the create control");

  process.stdout.write(`${JSON.stringify({ verified, allViewCreateCount: 0 }, null, 2)}\n`);
} finally {
  try {
    await client.evaluate(`(() => {
      window.postMessage({ type: "navigate-to-route", path: ${JSON.stringify(threadRoute)} }, "*");
      document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click();
      document.querySelector('[data-codex-sidebar-folder-clear]')?.click();
      document.querySelector('[data-codex-sidebar-folder-label="管理优化"]')?.click();
    })()`);
  } catch {}
  client.close();
}
