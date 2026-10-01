#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { connectMainCodex } from "./cdp-client.mjs";
import { PreviewRepository } from "../lib/preview-data.mjs";

async function connectWhenReady(timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await connectMainCodex(9231);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  throw lastError || new Error("Codex renderer did not become available");
}

async function waitFor(client, expression, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (!await client.evaluate(expression)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return true;
}

async function indexedConversationTimes() {
  const content = await readFile(path.join(os.homedir(), ".codex", "session_index.jsonl"), "utf8");
  const byId = new Map();
  const byTitle = new Map();
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const id = String(row.id || "").toLowerCase();
      const title = String(row.thread_name || "").trim();
      const time = Date.parse(row.updated_at || "");
      if (id && Number.isFinite(time) && time > (byId.get(id) || 0)) byId.set(id, time);
      if (title && Number.isFinite(time) && time > (byTitle.get(title) || 0)) byTitle.set(title, time);
    } catch {}
  }
  return { byId, byTitle };
}

async function sessionFileTimes(ids) {
  const wanted = new Set(ids.filter(Boolean));
  const times = new Map();
  async function walk(root) {
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); } catch { return; }
    await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) return walk(entryPath);
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return;
      const id = Array.from(wanted).find((candidate) => entry.name.toLowerCase().includes(candidate));
      if (id) times.set(id, (await stat(entryPath)).mtimeMs);
    }));
  }
  await walk(path.join(os.homedir(), ".codex", "sessions"));
  return times;
}

const client = await connectWhenReady();
const searchCatalog = await new PreviewRepository().readSearchCatalog();

try {
  await client.evaluate(`window.__codexConversationPreviewInjection__?.setSearchCatalog?.(${JSON.stringify(searchCatalog)})`);
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  assert.equal(await waitFor(client, `Boolean(document.getElementById("codex-sidebar-folder-switcher"))`), true,
    "folder switcher must be injected above the project list");
  assert.equal(await waitFor(client, `document.querySelector('[data-app-action-sidebar-project-label="7.23考试"]')?.getAttribute('aria-expanded') === 'true'`, 15_000), true,
    "a populated native folder that started collapsed must be mounted for sorting and project search");

  const sourceFolders = await client.evaluate(`(() => Array.from(document.querySelectorAll('[data-app-action-sidebar-project-row]')).map((row, index) => ({
    id: row.getAttribute('data-app-action-sidebar-project-id'),
    label: row.getAttribute('data-app-action-sidebar-project-label'),
    index,
    threads: Array.from(row.closest('[data-sidebar-project-kind]')?.querySelectorAll('[data-app-action-sidebar-thread-title]') || [])
      .map((thread) => ({
        id: (thread.getAttribute('data-app-action-sidebar-thread-id') || '').replace(/^(?:local|cloud):/i, '').toLowerCase(),
        title: thread.getAttribute('data-app-action-sidebar-thread-title'),
      })),
  })))()`);
  const times = await indexedConversationTimes();
  const fileTimes = await sessionFileTimes(sourceFolders.flatMap((folder) => folder.threads.map((thread) => thread.id)));
  const catalogLastUsed = new Map();
  for (const entry of searchCatalog) {
    const time = Date.parse(entry.updatedAt || "");
    if (Number.isFinite(time) && time > (catalogLastUsed.get(entry.projectId) || 0)) {
      catalogLastUsed.set(entry.projectId, time);
    }
  }
  const expectedFolderOrder = sourceFolders
    .map((folder) => ({
      ...folder,
      lastUsed: Math.max(
        catalogLastUsed.get(folder.id) || 0,
        ...folder.threads.map((thread) => Math.max(
          times.byId.get(thread.id) || 0,
          fileTimes.get(thread.id) || 0,
          times.byTitle.get(thread.title) || 0,
        )),
      ),
    }))
    .sort((left, right) => right.lastUsed - left.lastUsed || left.index - right.index)
    .map((folder) => folder.label);
  const expectedOrder = ["全部", ...expectedFolderOrder];
  const expectedOrderJson = JSON.stringify(expectedOrder);
  const folderOrderSettled = await waitFor(client, `JSON.stringify(Array.from(document.querySelectorAll('[data-codex-sidebar-folder-tag]')).map((tag) => tag.dataset.codexSidebarFolderLabel)) === ${JSON.stringify(expectedOrderJson)}`, 15_000);
  const actualFolderOrder = folderOrderSettled ? expectedOrder : await client.evaluate(`Array.from(document.querySelectorAll('[data-codex-sidebar-folder-tag]'))
    .map((tag) => tag.dataset.codexSidebarFolderLabel)`);
  assert.equal(folderOrderSettled, true,
    `folder tags must settle into real recent-use order after preview timestamps arrive: expected ${JSON.stringify(expectedOrder)}, got ${JSON.stringify(actualFolderOrder)}`);

  await client.evaluate(`Array.from(document.querySelectorAll('[data-codex-sidebar-folder-tag]'))
    .find((tag) => tag.dataset.codexSidebarFolderLabel === ${JSON.stringify(expectedFolderOrder[0])})?.click()`);
  assert.equal(await waitFor(client, `Array.from(document.querySelectorAll('[data-codex-sidebar-folder-panel]'))
    .filter((panel) => !panel.hidden).length === 1`), true,
  "A real folder must restore one visible native project panel after the All view");

  const inspect = () => client.evaluate(`(() => {
    const root = document.getElementById('codex-sidebar-folder-switcher');
    if (!root) return null;
    const input = root.querySelector('[data-codex-sidebar-folder-search]');
    const tags = root.querySelector('[data-codex-sidebar-folder-tags]');
    const expand = root.querySelector('[data-codex-sidebar-folder-expand]');
    const tagButtons = Array.from(tags?.querySelectorAll('[data-codex-sidebar-folder-tag]') || []);
    const panels = Array.from(document.querySelectorAll('[data-codex-sidebar-folder-panel]'));
    return {
      input: {
        type: input?.type,
        ariaLabel: input?.getAttribute('aria-label'),
        placeholder: input?.getAttribute('placeholder'),
        value: input?.value,
      },
      tagsRole: tags?.getAttribute('role'),
      labels: tagButtons.map((tag) => tag.dataset.codexSidebarFolderLabel),
      selected: tagButtons.find((tag) => tag.getAttribute('aria-pressed') === 'true')?.dataset.codexSidebarFolderLabel,
      lastUsed: tagButtons.map((tag) => Number(tag.dataset.codexSidebarFolderLastUsed || 0)),
      expanded: expand?.getAttribute('aria-expanded'),
      expandHidden: expand?.hidden,
      tagsHeight: tags?.getBoundingClientRect().height || 0,
      tagsScrollHeight: tags?.scrollHeight || 0,
      visiblePanels: panels.filter((panel) => !panel.hidden).map((panel) => panel.dataset.codexSidebarFolderPanel),
      hiddenHeadings: Array.from(document.querySelectorAll('[data-codex-sidebar-folder-heading-hidden="true"]'))
        .every((heading) => getComputedStyle(heading).display === 'none'),
      resultText: root.querySelector('[data-codex-sidebar-folder-result]')?.textContent.trim(),
      actionLabels: Array.from(root.querySelectorAll('[data-codex-sidebar-folder-actions] button'))
        .map((button) => button.getAttribute('aria-label')),
    };
  })()`);

  let actual = await inspect();
  assert.ok(actual);
  assert.deepEqual(actual.input, {
    type: "search",
    ariaLabel: "搜索文件夹或项目",
    placeholder: "搜索文件夹或项目",
    value: "",
  });
  assert.equal(actual.tagsRole, "group");
  assert.deepEqual(actual.labels, expectedOrder);
  assert.ok(actual.lastUsed.every((time, index, values) => index === 0 || values[index - 1] >= time),
    "folder tags must be sorted by latest real conversation time");
  assert.equal(actual.expanded, "false");
  assert.equal(actual.expandHidden, false);
  assert.ok(actual.tagsHeight <= 62, "collapsed tags must occupy at most two rows");
  assert.ok(actual.tagsScrollHeight > actual.tagsHeight, "more than two rows must be clipped by default");
  assert.equal(actual.visiblePanels.length, 1);
  assert.equal(actual.hiddenHeadings, true);

  await client.evaluate(`document.querySelector('[data-codex-sidebar-folder-expand]')?.click()`);
  actual = await inspect();
  assert.equal(actual.expanded, "true");
  assert.equal(actual.tagsHeight, actual.tagsScrollHeight);

  await client.evaluate(`document.querySelector('[data-codex-sidebar-folder-label="熔神—我要成超创"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-app-action-sidebar-project-label="熔神—我要成超创"]')?.getAttribute('aria-expanded') === 'true'`), true);
  actual = await inspect();
  assert.equal(actual.selected, "熔神—我要成超创");
  assert.deepEqual(actual.visiblePanels, ["熔神—我要成超创"]);
  assert.deepEqual(actual.actionLabels, ["熔神—我要成超创 的项目操作", "在 熔神—我要成超创 中开始新聊天"]);
  await client.evaluate(`(() => {
    const button = document.querySelector('[data-codex-sidebar-folder-actions] button[aria-haspopup="menu"]');
    button?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    button?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    button?.click();
  })()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-folder-actions] button[aria-haspopup="menu"]')?.getAttribute('aria-expanded') === 'true'`), true,
    "selected folder must retain its native project menu");
  await client.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`);

  await client.evaluate(`(() => {
    const input = document.querySelector('[data-codex-sidebar-folder-search]');
    input.value = '人情';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '情' }));
  })()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-folder-tag][aria-pressed="true"]')?.dataset.codexSidebarFolderLabel === '为成长而学习'`), true,
    "subsequence fuzzy search must directly select the matching folder");
  actual = await inspect();
  assert.equal(actual.input.value, "人情");
  assert.equal(actual.selected, "为成长而学习");
  assert.deepEqual(actual.visiblePanels, ["为成长而学习"]);
  assert.deepEqual(actual.labels, ["为成长而学习"]);

  await client.evaluate(`document.querySelector('[data-codex-sidebar-folder-clear]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-folder-tag][aria-pressed="true"]')?.dataset.codexSidebarFolderLabel === '熔神—我要成超创'`), true,
    "clearing search must restore the folder selected before searching");
  actual = await inspect();
  assert.equal(actual.input.value, "");
  assert.deepEqual(actual.labels, expectedOrder);

  await client.evaluate(`(() => {
    const input = document.querySelector('[data-codex-sidebar-folder-search]');
    input.value = '知识卡片';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '片' }));
  })()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-folder-tag][aria-pressed="true"]')?.dataset.codexSidebarFolderLabel === '为创新而生'`), true,
    "full-catalog search must select the folder assigned in Codex global state");
  assert.equal(await waitFor(client, `(() => {
    const row = document.querySelector('[data-app-action-sidebar-thread-title="创建知识卡片技能"][data-codex-sidebar-search-match="true"]');
    return Boolean(row && !row.closest('[data-codex-sidebar-folder-panel]')?.hidden);
  })()`, 15_000), true,
    "full-catalog search must page in and reveal the matching conversation");
  actual = await inspect();
  assert.equal(actual.selected, "为创新而生");
  assert.match(actual.resultText, /1 个对话/);

  await client.evaluate(`document.querySelector('[data-codex-sidebar-folder-clear]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-folder-tag][aria-pressed="true"]')?.dataset.codexSidebarFolderLabel === '熔神—我要成超创'`), true,
    "clearing a full-catalog search must restore the previous folder");

  await client.evaluate(`(() => {
    const input = document.querySelector('[data-codex-sidebar-folder-search]');
    input.value = '广告看板';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '板' }));
  })()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-folder-tag][aria-pressed="true"]')?.dataset.codexSidebarFolderLabel === '7.23考试'`), true,
    "search must find a project that belonged to a natively collapsed folder");
  actual = await inspect();
  assert.equal(actual.selected, "7.23考试");
  assert.deepEqual(actual.visiblePanels, ["7.23考试"]);

  await client.evaluate(`(() => {
    const input = document.querySelector('[data-codex-sidebar-folder-search]');
    input.value = '不存在项目xyz';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'z' }));
  })()`);
  actual = await inspect();
  assert.equal(actual.labels.length, 0);
  assert.equal(actual.visiblePanels.length, 0);
  assert.match(actual.resultText, /没有匹配的项目/);

  process.stdout.write(`${JSON.stringify({ expectedOrder, actual }, null, 2)}\n`);
} finally {
  try {
    await client.evaluate(`(() => {
      document.querySelector('[data-codex-sidebar-folder-clear]')?.click();
      document.querySelector('[data-codex-sidebar-folder-label="管理优化"]')?.click();
      const expand = document.querySelector('[data-codex-sidebar-folder-expand][aria-expanded="true"]');
      expand?.click();
    })()`);
  } catch {}
  client.close();
}
