#!/usr/bin/env node

import assert from "node:assert/strict";

import { PreviewRepository } from "../lib/preview-data.mjs";
import { readActiveTaskThreads } from "../lib/taskboard-status.mjs";
import { connectMainCodex } from "./cdp-client.mjs";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitFor(client, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await client.evaluate(expression)) return true; } catch {}
    await wait(80);
  }
  return false;
}

const repository = new PreviewRepository();
const taskboard = await readActiveTaskThreads();
const expected = (await repository.readInterruptedCatalog({ activeThreadIds: taskboard.activeThreadIds })).slice(0, 30);
const client = await connectMainCodex(9231);

try {
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-section-tab="中断"]'))`), true);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="中断"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-section-tab="中断"]')?.getAttribute('aria-selected') === 'true'`), true);
  assert.equal(await waitFor(client, `document.querySelectorAll('[data-codex-sidebar-interrupted-row]').length === ${expected.length}`), true);
  assert.equal(await waitFor(client, `Array.from(document.querySelectorAll('[data-codex-sidebar-interrupted-row]')).every((row) => {
    const label = row.dataset.codexSidebarInterruptedKind === 'active' ? '主动中断' : '被动中断';
    return Array.from(row.querySelectorAll('.codex-conversation-card-tags > *'))
      .some((tag) => tag.textContent.trim() === label);
  })`), true, "Interrupted rows must finish card enhancement before inspection");
  const actual = await client.evaluate(`Array.from(document.querySelectorAll('[data-codex-sidebar-interrupted-row]')).map((row) => ({
    id: row.getAttribute('data-app-action-sidebar-thread-id')?.replace(/^(?:local|cloud):/i, ''),
    kind: row.dataset.codexSidebarInterruptedKind,
    title: row.getAttribute('data-app-action-sidebar-thread-title'),
    visible: row.getClientRects().length > 0,
    tags: Array.from(row.querySelectorAll('.codex-conversation-card-tags > *')).map((tag) => tag.textContent.trim()),
  }))`);
  assert.deepEqual(actual.map((item) => item.id), expected.map((item) => item.threadId));
  assert.equal(new Set(actual.map((item) => item.id)).size, actual.length);
  assert.ok(actual.every((item) => item.visible));
  assert.ok(actual.every((item) => item.kind === "active" || item.kind === "passive"));
  assert.ok(actual.every((item) => item.tags.includes(item.kind === "active" ? "主动中断" : "被动中断")));

  // Force the same enhancement rebuild that occurs when Codex remounts its
  // native sidebar anchors. A stale virtual panel must not survive the rebuild
  // and leak interrupted cards into Project.
  await client.evaluate(`document.getElementById('codex-sidebar-section-tabs')?.remove()`);
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-section-tab="项目"]'))`), true);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-section-tab="项目"]')
    ?.getAttribute('aria-selected') === 'true'`), true);
  const projectIsolation = await client.evaluate(`({
    interruptedPanels: document.querySelectorAll('[data-codex-sidebar-section-panel="中断"]').length,
    visibleInterruptedRows: Array.from(document.querySelectorAll('[data-codex-sidebar-interrupted-row]'))
      .filter((row) => row.getClientRects().length > 0).length,
  })`);
  assert.equal(projectIsolation.interruptedPanels, 1,
    "Sidebar rebuild must retain exactly one interrupted virtual panel");
  assert.equal(projectIsolation.visibleInterruptedRows, 0,
    "Interrupted cards must not leak into Project after a sidebar rebuild");
  process.stdout.write(`${JSON.stringify({ count: actual.length, top: actual.slice(0, 8) }, null, 2)}\n`);
} finally {
  try { await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`); } catch {}
  client.close();
}
