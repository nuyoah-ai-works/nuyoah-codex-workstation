#!/usr/bin/env node

import assert from "node:assert/strict";

import { orderCatalogByArchive, PreviewRepository } from "../lib/preview-data.mjs";
import { connectMainCodex } from "./cdp-client.mjs";
import { readArchivedThreadIds } from "../lib/thread-archive-state.mjs";

const RECENT_VISIBLE_LIMIT = 30;

async function waitFor(client, expression, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (!await client.evaluate(expression)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

const repository = new PreviewRepository();
const pinnedThreadIds = new Set(await repository.readPinnedThreadIds());
const expectedEntries = orderCatalogByArchive(
  await repository.readRecentCatalog(),
  await readArchivedThreadIds(),
)
  .filter((entry) => !pinnedThreadIds.has(entry.threadId))
  .slice(0, RECENT_VISIBLE_LIMIT);
const expectedIds = expectedEntries.map((entry) => entry.threadId);
assert.ok(expectedIds.length > 1, "Global recent catalog must contain multiple conversations");

const client = await connectMainCodex(9231);
try {
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-section-tab="最近"]'))`), true,
    "Recent tab must be available");
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="最近"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelectorAll('[data-codex-sidebar-recent-row]').length === ${expectedIds.length}`), true,
    "Recent tab must mount the global recent-use catalog instead of the native unassigned subset");
  assert.equal(await waitFor(client, `Array.from(document.querySelectorAll('[data-codex-sidebar-recent-row]'))
    .every((row) => {
      const time = row.querySelector('.codex-conversation-card-time')?.textContent || '';
      return time && time !== '时间未知' && time !== '正在读取时间';
    })`), true,
    "Every global Recent card must display its communication time");

  const actual = await client.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('[data-codex-sidebar-recent-row]'));
    const details = rows.map((row) => ({
      id: (row.getAttribute('data-app-action-sidebar-thread-id') || '').replace(/^(?:local|cloud):/i, ''),
      title: row.getAttribute('data-app-action-sidebar-thread-title') || '',
      time: row.querySelector('.codex-conversation-card-time')?.textContent || '',
      rect: row.getBoundingClientRect(),
    }));
    return {
      ids: details.map((item) => item.id),
      uniqueCount: new Set(details.map((item) => item.id)).size,
      visualIds: [...details].sort((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x)
        .map((item) => item.id),
      labels: details.map(({ title, time }) => ({ title, time })),
    };
  })()`);

  assert.deepEqual(actual.ids, expectedIds, "Recent DOM order must keep active conversations before archived conversations and preserve group recency");
  assert.deepEqual(actual.visualIds, expectedIds,
    "Two-column Recent cards must read left-to-right, then top-to-bottom in global activity order");
  assert.equal(actual.uniqueCount, expectedIds.length, "A conversation must appear only once in Recent");
  process.stdout.write(`${JSON.stringify({ expectedTop: expectedEntries.slice(0, 5), ...actual }, null, 2)}\n`);
} finally {
  client.close();
}
