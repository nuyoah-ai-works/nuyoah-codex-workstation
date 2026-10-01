#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

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

try {
  await client.evaluate(`(() => {
    document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click();
    document.querySelector('[data-codex-sidebar-folder-clear]')?.click();
    document.querySelector('[data-codex-sidebar-folder-label="管理优化"]')?.click();
    document.querySelector('[data-codex-sidebar-folder-expand][aria-expanded="true"]')?.click();
    if (document.documentElement.dataset.codexConversationView !== 'card') {
      document.getElementById('codex-conversation-view-toggle')?.click();
    }
  })()`);
  await client.send("Page.reload", { ignoreCache: true });

  assert.equal(await waitFor(client, `(() => {
    const root = document.getElementById('codex-sidebar-folder-switcher');
    const tags = Array.from(document.querySelectorAll('[data-codex-sidebar-folder-tag]'));
    const allPopulatedFoldersTimed = tags.every((tag) => {
      const id = tag.dataset.codexSidebarFolderTag;
      const row = document.querySelector('[data-app-action-sidebar-project-id="' + CSS.escape(id) + '"]');
      const folder = row?.closest('[data-sidebar-project-kind]');
      return !folder?.querySelector('[data-app-action-sidebar-thread-row]')
        || Number(tag.dataset.codexSidebarFolderLastUsed) > 0;
    });
    return Boolean(root)
      && document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.getAttribute('aria-selected') === 'true'
      && document.documentElement.dataset.codexConversationView === 'card'
      && tags.length === 12
      && tags.find((tag) => tag.getAttribute('aria-pressed') === 'true')?.dataset.codexSidebarFolderLabel === '管理优化'
      && document.querySelector('[data-codex-sidebar-folder-expand]')?.getAttribute('aria-expanded') === 'false'
      && document.querySelectorAll('[data-codex-sidebar-folder-panel]:not([hidden])').length === 1
      && document.querySelector('[data-codex-sidebar-folder-panel]:not([hidden])')?.dataset.codexSidebarFolderPanel === '管理优化'
      && document.querySelectorAll('[data-codex-sidebar-folder-actions] button').length === 2
      && allPopulatedFoldersTimed
      && tags.every((tag, index) => index === 0 || Number(tags[index - 1].dataset.codexSidebarFolderLastUsed) >= Number(tag.dataset.codexSidebarFolderLastUsed));
  })()`, 25_000), true, "sidebar enhancement must restore its complete persisted state after renderer reload");

  const actual = await client.evaluate(`(() => {
    const tags = Array.from(document.querySelectorAll('[data-codex-sidebar-folder-tag]'));
    return {
      section: document.querySelector('[data-codex-sidebar-section-tab][aria-selected="true"]')?.dataset.codexSidebarSectionTab,
      folder: tags.find((tag) => tag.getAttribute('aria-pressed') === 'true')?.dataset.codexSidebarFolderLabel,
      labels: tags.map((tag) => tag.dataset.codexSidebarFolderLabel),
      expanded: document.querySelector('[data-codex-sidebar-folder-expand]')?.getAttribute('aria-expanded'),
      view: document.documentElement.dataset.codexConversationView,
      visiblePanels: Array.from(document.querySelectorAll('[data-codex-sidebar-folder-panel]:not([hidden])')).map((panel) => panel.dataset.codexSidebarFolderPanel),
      actionCount: document.querySelectorAll('[data-codex-sidebar-folder-actions] button').length,
    };
  })()`);
  process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
} finally {
  client.close();
}
