#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

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

const client = await connectWhenReady();

try {
  assert.equal(await waitFor(client, `Boolean(document.getElementById("codex-sidebar-section-tabs"))`), true,
    "section tablist must be injected");

  const inspect = () => client.evaluate(`(() => {
    const bar = document.getElementById("codex-sidebar-section-tabs");
    if (!bar) return null;
    const tabs = Array.from(bar.querySelectorAll('[role="tab"]'));
    const panels = Array.from(document.querySelectorAll('[data-codex-sidebar-section-panel]'));
    const actions = bar.querySelector('[data-codex-sidebar-project-actions]');
    return {
      role: bar.querySelector('[role="tablist"]')?.getAttribute("role"),
      ariaLabel: bar.querySelector('[role="tablist"]')?.getAttribute("aria-label"),
      tabs: tabs.map((tab) => ({
        name: tab.dataset.codexSidebarSectionTab,
        selected: tab.getAttribute("aria-selected"),
        tabIndex: tab.tabIndex,
        controls: tab.getAttribute("aria-controls"),
        top: Math.round(tab.getBoundingClientRect().top),
      })),
      panels: panels.map((panel) => ({
        name: panel.dataset.codexSidebarSectionPanel,
        hidden: panel.hidden,
        role: panel.getAttribute("role"),
        labelledBy: panel.getAttribute("aria-labelledby"),
      })),
      actionsHidden: actions?.hidden,
      actionLabels: Array.from(actions?.querySelectorAll("button") || []).map((button) => button.getAttribute("aria-label")),
      nativeExpanded: Object.fromEntries(["置顶", "项目", "最近"].map((name) => {
        const source = Array.from(document.querySelectorAll('button[data-app-action-sidebar-section-toggle]'))
          .find((button) => button.textContent.trim() === name);
        return [name, source?.getAttribute("aria-expanded")];
      })),
      nativeHeadingsHidden: Array.from(document.querySelectorAll('[data-codex-sidebar-section-heading-hidden="true"]'))
        .every((heading) => getComputedStyle(heading).display === "none"),
    };
  })()`);

  let actual = await inspect();
  assert.ok(actual, "section tabs must exist");
  assert.equal(actual.role, "tablist");
  assert.equal(actual.ariaLabel, "对话分组");
  assert.deepEqual(actual.tabs.map((tab) => tab.name), ["置顶", "项目", "最近", "中断"]);
  assert.equal(new Set(actual.tabs.map((tab) => tab.top)).size, 1, "all four section tabs must stay on one row");
  assert.equal(actual.tabs.filter((tab) => tab.selected === "true").length, 1);
  assert.equal(actual.tabs.filter((tab) => tab.tabIndex === 0).length, 1);
  assert.deepEqual(actual.panels.map((panel) => panel.name), ["中断", "置顶", "项目", "最近"]);
  assert.ok(actual.panels.every((panel) => panel.role === "tabpanel" && panel.labelledBy));
  assert.equal(actual.panels.filter((panel) => !panel.hidden).length, 1);
  assert.equal(actual.nativeHeadingsHidden, true);

  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.getAttribute("aria-selected") === "true"`), true);
  assert.equal(await waitFor(client, `Array.from(document.querySelectorAll('button[data-app-action-sidebar-section-toggle]')).find((button) => button.textContent.trim() === "项目")?.getAttribute("aria-expanded") === "true"`), true);
  actual = await inspect();
  assert.equal(actual.actionsHidden, false);
  assert.deepEqual(actual.actionLabels, ["项目侧边栏选项", "添加新项目"]);
  assert.deepEqual(actual.panels.filter((panel) => !panel.hidden).map((panel) => panel.name), ["项目"]);

  const nativeActions = await client.evaluate(`(() => ({
    more: Boolean(document.querySelector('[data-codex-sidebar-project-actions] button[aria-haspopup="menu"]')),
    create: Boolean(document.querySelector('[data-codex-sidebar-project-actions] button[data-app-action-sidebar-project-create]')),
    retained: document.querySelectorAll('[data-codex-sidebar-project-action-source]').length,
  }))()`);
  assert.deepEqual(nativeActions, { more: true, create: true, retained: 2 },
    "project toolbar must retain both native Codex controls");

  await client.evaluate(`(() => {
    const button = document.querySelector('[data-codex-sidebar-project-actions] button[aria-haspopup="menu"]');
    button?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    button?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    button?.click();
  })()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-project-actions] button[aria-haspopup="menu"]')?.getAttribute("data-state") === "open"`), true,
    "native project options menu must still open from the tab toolbar");
  await client.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }))`);

  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="置顶"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-section-tab="置顶"]')?.getAttribute("aria-selected") === "true"`), true);
  assert.equal(await waitFor(client, `Array.from(document.querySelectorAll('button[data-app-action-sidebar-section-toggle]')).find((button) => button.textContent.trim() === "置顶")?.getAttribute("aria-expanded") === "true"`), true);
  actual = await inspect();
  assert.equal(actual.actionsHidden, true);
  assert.deepEqual(actual.panels.filter((panel) => !panel.hidden).map((panel) => panel.name), ["置顶"]);

  await client.evaluate(`(() => {
    const tab = document.querySelector('[data-codex-sidebar-section-tab="置顶"]');
    tab?.focus();
    tab?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  })()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.getAttribute("aria-selected") === "true"`), true,
    "ArrowRight must select the next tab");
  actual = await inspect();
  assert.equal(actual.actionsHidden, false);
  assert.deepEqual(actual.panels.filter((panel) => !panel.hidden).map((panel) => panel.name), ["项目"]);

  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="最近"]')?.click()`);
  assert.equal(await waitFor(client, `Array.from(document.querySelectorAll('button[data-app-action-sidebar-section-toggle]')).find((button) => button.textContent.trim() === "最近")?.getAttribute("aria-expanded") === "true"`), true,
    "Recent tab must expand the native recent section");
  actual = await inspect();
  assert.equal(actual.actionsHidden, true);
  assert.deepEqual(actual.panels.filter((panel) => !panel.hidden).map((panel) => panel.name), ["最近"]);

  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="中断"]')?.click()`);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-section-tab="中断"]')?.getAttribute("aria-selected") === "true"`), true);
  actual = await inspect();
  assert.equal(actual.actionsHidden, true);
  assert.deepEqual(actual.panels.filter((panel) => !panel.hidden).map((panel) => panel.name), ["中断"]);
  assert.equal(await client.evaluate(`Boolean(document.getElementById("codex-sidebar-interrupted-list"))`), true);
  assert.equal(actual.nativeExpanded["最近"], "true",
    "the virtual interrupted panel must retain a mounted native anchor for later tab restoration");

  await client.evaluate(`(() => {
    window.__codexConversationPreviewInjection__?.destroy?.();
    delete window.__codexConversationPreviewInjection__;
  })()`);
  assert.equal(await waitFor(client, `Boolean(window.__codexConversationPreviewInjection__)`, 20_000), true);
  assert.equal(await waitFor(client, `document.querySelector('[data-codex-sidebar-section-tab="中断"]')?.getAttribute("aria-selected") === "true"`, 20_000), true);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(await client.evaluate(`document.querySelectorAll('button[data-app-action-sidebar-section-toggle]').length`), 3,
    "the virtual interrupted tab must not collapse and unmount every native sidebar section");
  await client.evaluate(`document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click()`);
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-folder-search]')?.getClientRects().length)`, 20_000), true,
    "the first project-tab click after reload must restore the folder search and project content");

  await client.evaluate(`(() => {
    for (const button of document.querySelectorAll('button[data-app-action-sidebar-section-toggle]')) {
      button.dataset.codexSectionToggleTest = 'true';
      button.removeAttribute('data-app-action-sidebar-section-toggle');
    }
    window.__codexConversationPreviewInjection__?.refresh?.();
  })()`);
  assert.equal(await waitFor(client, `!document.getElementById('codex-sidebar-section-tabs')`), true,
    "stale custom tabs must be removed while Codex replaces their native section anchors");
  await client.evaluate(`(() => {
    for (const button of document.querySelectorAll('[data-codex-section-toggle-test="true"]')) {
      button.setAttribute('data-app-action-sidebar-section-toggle', '');
      button.removeAttribute('data-codex-section-toggle-test');
    }
    window.__codexConversationPreviewInjection__?.refresh?.();
  })()`);
  assert.equal(await waitFor(client, `Boolean(document.querySelector('[data-codex-sidebar-folder-search]')?.getClientRects().length)`), true,
    "the project search must rebuild when Codex remounts its native section anchors");

  process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
} finally {
  try { await client.evaluate(`(() => {
    for (const button of document.querySelectorAll('[data-codex-section-toggle-test="true"]')) {
      button.setAttribute('data-app-action-sidebar-section-toggle', '');
      button.removeAttribute('data-codex-section-toggle-test');
    }
    window.__codexConversationPreviewInjection__?.refresh?.();
    document.querySelector('[data-codex-sidebar-section-tab="项目"]')?.click();
  })()`); } catch {}
  client.close();
}
