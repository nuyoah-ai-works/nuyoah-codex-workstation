#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

const SECTION_STORAGE_KEY = "codex-conversation-preview:section-tab";
const FOLDER_STORAGE_KEY = "codex-conversation-preview:folder-id";
const PINNED_STORAGE_KEY = "codex-conversation-preview:pinned-thread-times";

async function waitFor(client, expression, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (!await client.evaluate(expression)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

function rowWithActionExpression(threadId, action) {
  return `Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]')).find((row) =>
    row.getAttribute('data-app-action-sidebar-thread-id') === ${JSON.stringify(threadId)}
      && Array.from(row.querySelectorAll('button')).some((button) => button.getAttribute('aria-label') === ${JSON.stringify(action)}))`;
}

async function clickThreadAction(client, threadId, action) {
  return client.evaluate(`(() => {
    const row = ${rowWithActionExpression(threadId, action)};
    const button = Array.from(row?.querySelectorAll('button') || [])
      .find((candidate) => candidate.getAttribute('aria-label') === ${JSON.stringify(action)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

async function clickProjectThreadAction(client, folderId, threadId, action) {
  return client.evaluate(`(() => {
    const panel = document.querySelector('[data-codex-sidebar-folder-panel-id="${folderId}"]');
    const row = Array.from(panel?.querySelectorAll('[data-app-action-sidebar-thread-row]') || [])
      .find((candidate) => candidate.getAttribute('data-app-action-sidebar-thread-id') === ${JSON.stringify(threadId)});
    const button = Array.from(row?.querySelectorAll('button') || [])
      .find((candidate) => candidate.getAttribute('aria-label') === ${JSON.stringify(action)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

const client = await connectMainCodex(Number(process.env.CODEX_DEBUG_PORT || 9231));
let savedSection;
let savedFolder;
let savedPinnedTimes;
let targets = [];

try {
  ({ savedSection, savedFolder, savedPinnedTimes } = await client.evaluate(`({
    savedSection: localStorage.getItem(${JSON.stringify(SECTION_STORAGE_KEY)}),
    savedFolder: localStorage.getItem(${JSON.stringify(FOLDER_STORAGE_KEY)}),
    savedPinnedTimes: localStorage.getItem(${JSON.stringify(PINNED_STORAGE_KEY)}),
  })`));

  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  assert.equal(await waitFor(client, `Boolean(document.getElementById('codex-sidebar-folder-switcher'))`), true,
    "Project folder switcher must be available");

  const fixture = await client.evaluate(`(() => {
    for (const projectRow of document.querySelectorAll('[data-app-action-sidebar-project-row]')) {
      const folder = projectRow.closest('[data-sidebar-project-kind]');
      const rows = Array.from(folder?.querySelectorAll('[data-app-action-sidebar-thread-row]') || [])
        .filter((row) => Array.from(row.querySelectorAll('button'))
          .some((button) => button.getAttribute('aria-label') === '置顶聊天'));
      if (rows.length < 2) continue;
      return {
        folderId: projectRow.getAttribute('data-app-action-sidebar-project-id'),
        folderLabel: projectRow.getAttribute('data-app-action-sidebar-project-label'),
        threads: rows.slice(0, 2).map((row) => ({
          id: row.getAttribute('data-app-action-sidebar-thread-id'),
          title: row.getAttribute('data-app-action-sidebar-thread-title'),
        })),
      };
    }
    return null;
  })()`);
  assert.ok(fixture?.folderId && fixture.threads?.length === 2,
    "Live sidebar must provide two unpinned conversations from one project folder");
  targets = fixture.threads;

  await client.evaluate(`document.querySelector('[data-codex-sidebar-folder-tag="${fixture.folderId}"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-folder-tag="${fixture.folderId}"]')
    ?.getAttribute('aria-pressed') === 'true'`), true, "Fixture folder must be selected");

  assert.equal(await clickProjectThreadAction(client, fixture.folderId, targets[0].id, "置顶聊天"), true);
  assert.equal(await waitFor(client, `!Array.from(document.querySelectorAll(
    '[data-codex-sidebar-folder-panel-id="${fixture.folderId}"] [data-app-action-sidebar-thread-row]'
  )).some((row) => row.getAttribute('data-app-action-sidebar-thread-id') === ${JSON.stringify(targets[0].id)})`), true,
    "First native conversation must leave its project DOM after pinning");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(await clickProjectThreadAction(client, fixture.folderId, targets[1].id, "置顶聊天"), true);
  assert.equal(await waitFor(client, `!Array.from(document.querySelectorAll(
    '[data-codex-sidebar-folder-panel-id="${fixture.folderId}"] [data-app-action-sidebar-thread-row]'
  )).some((row) => row.getAttribute('data-app-action-sidebar-thread-id') === ${JSON.stringify(targets[1].id)})`), true,
    "Second native conversation must leave its project DOM after pinning");

  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="置顶"]')?.click()`);
  assert.equal(await waitFor(client, `Boolean(${rowWithActionExpression(targets[0].id, "取消置顶聊天")})
    && Boolean(${rowWithActionExpression(targets[1].id, "取消置顶聊天")})`), true,
    "Both native conversations must remain available in the Pinned tab");

  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-folder-tag="${fixture.folderId}"]'))`);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-folder-tag="${fixture.folderId}"]')?.click()`);
  assert.equal(await waitFor(client, `(() => {
    const ids = ${JSON.stringify(targets.map((target) => target.id))};
    return !Array.from(document.querySelectorAll('[data-codex-sidebar-folder-panel] [data-app-action-sidebar-thread-row]'))
      .some((row) => ids.includes(row.getAttribute('data-app-action-sidebar-thread-id'))
        && row.getClientRects().length > 0);
  })()`), true, "Pinned conversations must not remain visible in Project");

  await client.evaluate(`document.querySelector('[data-codex-sidebar-folder-tag="__all__"]')?.click()`);
  assert.equal(await waitFor(client, `(() => {
    const ids = ${JSON.stringify(targets.map((target) => target.id))};
    return !Array.from(document.querySelectorAll('[data-codex-sidebar-all-project-row]'))
      .some((row) => ids.includes(row.getAttribute('data-app-action-sidebar-thread-id')));
  })()`), true, "Pinned conversations must not appear in All projects");

  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="最近"]')?.click()`);
  assert.equal(await waitFor(client, `(() => {
    const ids = ${JSON.stringify(targets.map((target) => target.id))};
    return !Array.from(document.querySelectorAll('[data-codex-sidebar-recent-row]'))
      .some((row) => ids.includes(row.getAttribute('data-app-action-sidebar-thread-id')));
  })()`), true, "Pinned conversations must not appear in Recent");

  const projectState = await client.evaluate(`({
    storedTimes: JSON.parse(localStorage.getItem(${JSON.stringify(PINNED_STORAGE_KEY)}) || '{}'),
  })`);
  assert.ok(projectState.storedTimes[targets[1].id] > projectState.storedTimes[targets[0].id],
    "Pin action timestamps must preserve newest-first ordering across reloads");

  await client.send("Page.reload", { ignoreCache: true });
  assert.equal(await waitFor(client, `(() => {
    document.querySelector('[data-codex-sidebar-section-tab="置顶"]')?.click();
    return Boolean(${rowWithActionExpression(targets[0].id, "取消置顶聊天")})
      && Boolean(${rowWithActionExpression(targets[1].id, "取消置顶聊天")});
  })()`, 25_000), true, "Pinned-only placement must survive a Codex renderer reload");

  process.stdout.write(`${JSON.stringify({
    folder: fixture.folderLabel,
    pinnedOrder: [targets[1].title, targets[0].title],
    pinnedTabOnlyVerified: true,
    newestFirstVerified: true,
    reloadPersistenceVerified: true,
  }, null, 2)}\n`);
} finally {
  try {
    await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="置顶"]')?.click()`);
    await waitFor(client, `document.querySelector('[data-codex-sidebar-section-tab="置顶"]')
      ?.getAttribute('aria-selected') === 'true'`, 4_000);
    for (const target of targets) {
      await clickThreadAction(client, target.id, "取消置顶聊天");
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await client.evaluate(`(() => {
      const restore = (key, value) => value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      restore(${JSON.stringify(PINNED_STORAGE_KEY)}, ${JSON.stringify(savedPinnedTimes)});
      restore(${JSON.stringify(SECTION_STORAGE_KEY)}, ${JSON.stringify(savedSection)});
      restore(${JSON.stringify(FOLDER_STORAGE_KEY)}, ${JSON.stringify(savedFolder)});
    })()`);
    await client.send("Page.reload", { ignoreCache: true });
  } catch {}
  client.close();
}
