#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

import { connectMainCodex } from "./cdp-client.mjs";

const STORAGE_KEY = "codex-conversation-preview:shortcut-settings";
const screenshotPath = "/tmp/codex-shortcut-settings-verification.png";
const injectionSource = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");

async function waitFor(client, expression, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

const client = await connectMainCodex(9231);
const original = await client.evaluate(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`);

try {
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-shortcut-settings]'))`), true);
  const baseline = await client.evaluate(`(() => {
    const grid = document.getElementById('codex-sidebar-shortcut-grid');
    const settings = document.querySelector('[data-codex-sidebar-shortcut-settings]');
    const search = document.querySelector('button[aria-label="搜索"], button[aria-label="Search"]');
    const activity = document.querySelector('button[aria-label^="查看活动"], button[aria-label^="View activity"]');
    settings?.click();
    const cards = Array.from(grid?.querySelectorAll('[data-codex-sidebar-shortcut-card]') || []);
    return {
      names: cards.map((card) => card.dataset.codexSidebarShortcutName),
      columns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length,
      settingsAria: settings?.getAttribute('aria-label'),
      toolbarOrder: {
        searchRight: search?.getBoundingClientRect().right || 0,
        settingsLeft: settings?.getBoundingClientRect().left || 0,
        settingsRight: settings?.getBoundingClientRect().right || 0,
        activityLeft: activity?.getBoundingClientRect().left || 0,
      },
      dialogOpen: document.getElementById('codex-sidebar-shortcut-settings-dialog')?.open || false,
      iconChoices: document.querySelectorAll('[data-codex-shortcut-icon]').length,
      openModes: Array.from(document.querySelectorAll('input[name="openMode"]')).map((input) => input.value),
    };
  })()`);
  assert.equal(baseline.columns, 6);
  assert.equal(baseline.names.includes("设置"), false);
  assert.equal(baseline.settingsAria, "管理快捷入口");
  assert.ok(baseline.toolbarOrder.searchRight <= baseline.toolbarOrder.settingsLeft);
  assert.ok(baseline.toolbarOrder.settingsRight <= baseline.toolbarOrder.activityLeft);
  assert.equal(baseline.dialogOpen, true);
  assert.equal(baseline.iconChoices, 6);
  assert.deepEqual(baseline.openModes, ["internal", "browser"]);

  const privateEntriesExcluded = await client.evaluate(`(() => {
    const names = ['站点', '插件', '项目管理'];
    return names.every((name) =>
      !document.querySelector('[data-codex-shortcut-visible="native:' + name + '"]')
      && !document.querySelector('[data-codex-sidebar-shortcut-name="' + name + '"]'));
  })()`);
  assert.equal(privateEntriesExcluded, true);

  async function createShortcut({ name, mode }) {
    await client.evaluate(`(() => {
      const settings = document.querySelector('[data-codex-sidebar-shortcut-settings]');
      if (!document.getElementById('codex-sidebar-shortcut-settings-dialog')?.open) settings?.click();
      const form = document.querySelector('[data-codex-shortcut-custom-form]');
      form.elements.name.value = ${JSON.stringify(name)};
      form.elements.url.value = 'https://example.com/';
      form.querySelector('[data-codex-shortcut-icon="book"]').click();
      form.elements.openMode.value = ${JSON.stringify(mode)};
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    })()`);
    assert.equal(await waitFor(client, `Boolean(Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]')).find((card) => card.dataset.codexSidebarShortcutName === ${JSON.stringify(name)}))`), true);
  }

  await createShortcut({ name: "验收入口", mode: "internal" });
  await client.evaluate(`Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]')).find((card) => card.dataset.codexSidebarShortcutName === '验收入口')?.click()`);
  const internal = await client.evaluate(`(() => ({
    open: document.documentElement.getAttribute('data-codex-custom-shortcut-open'),
    title: document.querySelector('[data-codex-custom-shortcut-title]')?.textContent,
    src: document.getElementById('codex-custom-shortcut-frame')?.src,
  }))()`);
  assert.deepEqual(internal, { open: "true", title: "验收入口", src: "https://example.com/" });
  await client.evaluate(`document.querySelector('[data-codex-custom-shortcut-close]')?.click()`);
  assert.equal(await client.evaluate(`document.getElementById('codex-custom-shortcut-page')?.hidden`), true);

  await createShortcut({ name: "浏览器入口", mode: "browser" });
  const browser = await client.evaluate(`(() => {
    const originalClick = HTMLAnchorElement.prototype.click;
    let captured = null;
    HTMLAnchorElement.prototype.click = function () {
      captured = { href: this.href, target: this.target, rel: this.rel };
    };
    try {
      Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]'))
        .find((card) => card.dataset.codexSidebarShortcutName === '浏览器入口')?.click();
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
    return captured;
  })()`);
  assert.deepEqual(browser, { href: "https://example.com/", target: "_blank", rel: "noopener noreferrer" });

  await client.evaluate(`document.querySelector('[data-codex-sidebar-shortcut-settings]')?.click()`);
  const capture = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(screenshotPath, Buffer.from(capture.data, "base64"));
  await client.evaluate(`document.getElementById('codex-sidebar-shortcut-settings-dialog')?.close()`);

  await client.evaluate(`window.__codexConversationPreviewInjection__?.destroy?.()`);
  await client.evaluate(injectionSource);
  assert.equal(await waitFor(client, `['验收入口','浏览器入口'].every((name) => Array.from(document.querySelectorAll('[data-codex-sidebar-shortcut-card]')).some((card) => card.dataset.codexSidebarShortcutName === name))`), true);

  const saved = JSON.parse(await client.evaluate(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`));
  assert.deepEqual(saved.custom.slice(-2).map(({ name, icon, openMode }) => ({ name, icon, openMode })), [
    { name: "验收入口", icon: "book", openMode: "internal" },
    { name: "浏览器入口", icon: "book", openMode: "browser" },
  ]);

  process.stdout.write(`${JSON.stringify({ ...baseline, privateEntriesExcluded, internal, browser, reloadVerified: true, screenshotPath }, null, 2)}\n`);
} finally {
  await client.evaluate(original == null
    ? `localStorage.removeItem(${JSON.stringify(STORAGE_KEY)})`
    : `localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(original)})`);
  await client.evaluate(`window.__codexConversationPreviewInjection__?.destroy?.()`).catch(() => {});
  await client.evaluate(injectionSource).catch(() => {});
  client.close();
}
