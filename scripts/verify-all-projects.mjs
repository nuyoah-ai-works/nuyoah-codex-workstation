#!/usr/bin/env node

import assert from "node:assert/strict";

import { PreviewRepository } from "../lib/preview-data.mjs";
import { connectMainCodex } from "./cdp-client.mjs";

const ALL_FOLDER_ID = "__all__";
const STORAGE_KEY = "codex-conversation-preview:folder-id";
const VIEW_STORAGE_KEY = "codex-conversation-preview:view-mode";

async function waitFor(client, expression, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (!await client.evaluate(expression)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return true;
}

const repository = new PreviewRepository();
const pinnedThreadIds = new Set(await repository.readPinnedThreadIds());
const catalog = await repository.readSearchCatalog();
const expected = catalog
  .filter((entry) => !pinnedThreadIds.has(entry.threadId))
  .map((entry, sourceIndex) => ({ ...entry, sourceIndex, time: Date.parse(entry.updatedAt || "") }))
  .sort((left, right) => right.time - left.time || left.sourceIndex - right.sourceIndex);
assert.ok(expected.length > 10, "The live catalog must contain projects from multiple folders");

const client = await connectMainCodex(9231);
let savedFolderId;
let savedViewMode;

try {
  savedFolderId = await client.evaluate(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`);
  savedViewMode = await client.evaluate(`localStorage.getItem(${JSON.stringify(VIEW_STORAGE_KEY)})`);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  assert.equal(await waitFor(client, `Boolean(document.getElementById('codex-sidebar-folder-switcher'))`), true,
    "Project folder switcher must be available");
  await client.evaluate(`(() => {
    const input = document.querySelector('[data-codex-sidebar-folder-search]');
    if (!input || !input.value) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-folder-tag="${ALL_FOLDER_ID}"]'))`, 3_000), true,
    "An All tag must be injected before every real folder tag");
  await client.evaluate(`(() => {
    const toggle = document.getElementById('codex-conversation-view-toggle');
    if (toggle?.getAttribute('aria-checked') !== 'true') toggle?.click();
  })()`);
  assert.equal(await waitFor(client, `document.documentElement.dataset.codexConversationView === 'card'`, 3_000), true,
    "The live verifier must exercise the All view in card mode");
  const tagState = await client.evaluate(`(() => {
    const tags = Array.from(document.querySelectorAll('[data-codex-sidebar-folder-tag]'));
    const all = tags.find((tag) => tag.dataset.codexSidebarFolderTag === '${ALL_FOLDER_ID}');
    return {
      first: tags[0]?.dataset.codexSidebarFolderTag,
      label: all?.textContent?.trim(),
      ariaLabel: all?.getAttribute('aria-label'),
      controls: all?.getAttribute('aria-controls'),
    };
  })()`);
  assert.deepEqual(tagState, {
    first: ALL_FOLDER_ID,
    label: "全部",
    ariaLabel: "显示全部项目",
    controls: "codex-sidebar-all-projects",
  });

  await client.evaluate(`document.querySelector('[data-codex-sidebar-folder-tag="${ALL_FOLDER_ID}"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelectorAll('#codex-sidebar-all-projects [data-codex-sidebar-all-project-row]').length === ${expected.length}`, 15_000), true,
    "All view must render every indexed project conversation");
  assert.equal(await waitFor(client, `document.querySelector('#codex-sidebar-all-projects [role="list"]')
    ?.getAttribute('data-codex-conversation-card-grid') === 'true'`, 5_000), true,
  "All rows must be enhanced before their card grid is inspected");

  const expectedIds = expected.map((entry) => `local:${entry.threadId}`);
  const actual = await client.evaluate(`(() => {
    const panel = document.getElementById('codex-sidebar-all-projects');
    const rows = Array.from(panel?.querySelectorAll('[data-codex-sidebar-all-project-row]') || []);
    const visualOrder = rows.map((row) => ({
      id: row.getAttribute('data-app-action-sidebar-thread-id'),
      rect: row.getBoundingClientRect(),
    })).sort((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x)
      .map((item) => item.id);
    return {
      selected: document.querySelector('[data-codex-sidebar-folder-tag][aria-pressed="true"]')
        ?.dataset.codexSidebarFolderTag,
      stored: localStorage.getItem('${STORAGE_KEY}'),
      panelRole: panel?.getAttribute('role'),
      panelLabelledBy: panel?.getAttribute('aria-labelledby'),
      rowIds: rows.map((row) => row.getAttribute('data-app-action-sidebar-thread-id')),
      visualOrder,
      resultText: document.querySelector('[data-codex-sidebar-folder-result]')?.textContent?.trim(),
      nativeVisibleCount: Array.from(document.querySelectorAll('[data-codex-sidebar-folder-panel]'))
        .filter((item) => !item.hidden).length,
      viewMode: document.documentElement.dataset.codexConversationView,
      gridMarked: panel?.querySelector('[role="list"]')?.dataset.codexConversationCardGrid,
      gridColumns: panel ? getComputedStyle(panel.querySelector('[role="list"]')).gridTemplateColumns : '',
    };
  })()`);
  assert.equal(actual.selected, ALL_FOLDER_ID);
  assert.equal(actual.stored, ALL_FOLDER_ID);
  assert.equal(actual.panelRole, "region");
  assert.equal(actual.panelLabelledBy, `codex-sidebar-folder-tag-${ALL_FOLDER_ID}`);
  assert.deepEqual(actual.rowIds, expectedIds, "All cards must follow updatedAt descending across folders");
  assert.deepEqual(actual.visualOrder, expectedIds,
    "All cards must read left-to-right, then top-to-bottom in updatedAt order");
  assert.match(actual.resultText, new RegExp(`全部 ${expected.length} 个对话`));
  assert.equal(actual.nativeVisibleCount, 0, "Native single-folder panels must stay hidden in All view");
  assert.ok(actual.gridColumns.split(" ").length >= 2, "All card list must keep the two-column grid");

  const route = await client.evaluate(`(() => {
    const row = document.querySelector('#codex-sidebar-all-projects [data-codex-sidebar-all-project-row]');
    let message = null;
    const original = window.postMessage;
    window.postMessage = (value) => { message = value; };
    try { row?.click(); } finally { window.postMessage = original; }
    return message;
  })()`);
  assert.deepEqual(route, { type: "navigate-to-route", path: `/local/${expected[0].threadId}` },
    "An All card must retain direct Codex navigation");

  await client.send("Page.reload", { ignoreCache: true });
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-folder-tag="${ALL_FOLDER_ID}"]')
    ?.getAttribute('aria-pressed') === 'true'
    && document.querySelectorAll('#codex-sidebar-all-projects [data-codex-sidebar-all-project-row]').length === ${expected.length}`, 25_000), true,
  "All selection and its complete sorted catalog must survive a renderer reload");

  const firstRealFolder = await client.evaluate(`Array.from(document.querySelectorAll('[data-codex-sidebar-folder-tag]'))
    .find((tag) => tag.dataset.codexSidebarFolderTag !== '${ALL_FOLDER_ID}')?.dataset.codexSidebarFolderTag`);
  assert.ok(firstRealFolder);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-folder-tag="${firstRealFolder}"]')?.click()`);
  assert.equal(await waitFor(client, `!document.getElementById('codex-sidebar-all-projects')
    && Array.from(document.querySelectorAll('[data-codex-sidebar-folder-panel]')).filter((item) => !item.hidden).length === 1`), true,
  "Switching to a real folder must restore the native single-folder view");

  process.stdout.write(`${JSON.stringify({
    count: expected.length,
    first: expected.slice(0, 5),
    selected: actual.selected,
    stored: actual.stored,
    resultText: actual.resultText,
    nativeVisibleCount: actual.nativeVisibleCount,
    viewMode: actual.viewMode,
    gridColumns: actual.gridColumns,
    exactOrderVerified: true,
    reloadPersistenceVerified: true,
    navigationVerified: true,
  }, null, 2)}\n`);
} finally {
  try {
    await client.evaluate(`(() => {
      const saved = ${JSON.stringify(savedFolderId)};
      const savedView = ${JSON.stringify(savedViewMode)};
      if (saved) localStorage.setItem('${STORAGE_KEY}', saved);
      else localStorage.removeItem('${STORAGE_KEY}');
      if (savedView) localStorage.setItem('${VIEW_STORAGE_KEY}', savedView);
      else localStorage.removeItem('${VIEW_STORAGE_KEY}');
      const toggle = document.getElementById('codex-conversation-view-toggle');
      if (toggle && toggle.dataset.mode !== (savedView === 'card' ? 'card' : 'list')) toggle.click();
      const target = saved || Array.from(document.querySelectorAll('[data-codex-sidebar-folder-tag]'))
        .find((tag) => tag.dataset.codexSidebarFolderTag !== '${ALL_FOLDER_ID}')?.dataset.codexSidebarFolderTag;
      document.querySelector('[data-codex-sidebar-folder-tag="' + CSS.escape(target || '') + '"]')?.click();
    })()`);
  } catch {}
  client.close();
}
