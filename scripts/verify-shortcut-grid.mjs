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

const client = await connectWhenReady();

try {
  const deadline = Date.now() + 8_000;
  while (!await client.evaluate(`(() => {
    const sourceNames = Array.from(document.querySelectorAll("[data-codex-sidebar-shortcut-source-name]"))
      .map((button) => button.dataset.codexSidebarShortcutSourceName);
    const tops = Array.from(document.querySelectorAll("#codex-sidebar-shortcut-grid [data-codex-sidebar-shortcut-card]"))
      .map((button) => button.getBoundingClientRect().top);
    return tops.length > 0
      && sourceNames.length >= 5
      && Math.max(...tops) - Math.min(...tops) <= 1;
  })()`)) {
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const actual = await client.evaluate(`(() => {
    const grid = document.getElementById("codex-sidebar-shortcut-grid");
    if (!grid) return null;
    const cards = Array.from(grid.querySelectorAll(":scope > [data-codex-sidebar-shortcut-card-wrap]"));
    const metrics = cards.map((wrap) => {
      const button = wrap.querySelector("[data-codex-sidebar-shortcut-card]");
      const icon = button?.querySelector(".codex-sidebar-shortcut-icon");
      const label = button?.querySelector(".codex-sidebar-shortcut-label");
      const cardRect = button?.getBoundingClientRect();
      const iconRect = icon?.getBoundingClientRect();
      const labelRect = label?.getBoundingClientRect();
      return {
        name: button?.dataset.codexSidebarShortcutName,
        width: cardRect?.width || 0,
        height: cardRect?.height || 0,
        top: cardRect?.top || 0,
        left: cardRect?.left || 0,
        iconBeforeLabel: Boolean(iconRect && labelRect && iconRect.bottom <= labelRect.top),
        hasImage: Boolean(icon?.querySelector("svg, img")),
        ariaLabel: button?.getAttribute("aria-label"),
      };
    });

    const overflowClones = [];
    while (grid.children.length < 7 && cards[0]) {
      const clone = cards[0].cloneNode(true);
      grid.appendChild(clone);
      overflowClones.push(clone);
    }
    const overflowTop = grid.children[6]
      ?.querySelector("[data-codex-sidebar-shortcut-card]")
      ?.getBoundingClientRect().top || 0;
    overflowClones.forEach((clone) => clone.remove());

    const sourceNames = Array.from(document.querySelectorAll("[data-codex-sidebar-shortcut-source-name]"))
      .map((node) => node.dataset.codexSidebarShortcutSourceName);
    return {
      role: grid.getAttribute("role"),
      ariaLabel: grid.getAttribute("aria-label"),
      columns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length,
      cards: metrics,
      sourceNames,
      visibleNames: metrics.map((card) => card.name),
      hiddenSettingKeys: (() => {
        try {
          return JSON.parse(localStorage.getItem("codex-conversation-preview:shortcut-settings") || "null")?.hidden || [];
        } catch {
          return [];
        }
      })(),
      hiddenNativeNames: ["拉取请求", "站点", "已安排", "插件", "项目管理"].filter((name) => !metrics.some((card) => card.name === name)),
      sourcesHidden: Array.from(document.querySelectorAll("[data-codex-sidebar-shortcut-source-hidden], [data-codex-sidebar-shortcut-source-group-hidden]"))
        .every((node) => getComputedStyle(node).display === "none"),
      overflowTop,
      firstRowTop: metrics[0]?.top || 0,
      quickAction: Boolean(grid.querySelector('[data-codex-sidebar-shortcut-quick="true"]')),
      scheduledStatus: Boolean(grid.querySelector('[data-codex-sidebar-shortcut-name="已安排"]')
        ?.closest("[data-codex-sidebar-shortcut-card-wrap]")
        ?.querySelector(".codex-sidebar-shortcut-status")),
    };
  })()`);

  assert.ok(actual, "shortcut card grid must exist");
  assert.equal(actual.role, "group");
  assert.equal(actual.ariaLabel, "快捷入口");
  assert.equal(actual.columns, 6);
  const canonicalOrder = ["新对话", "拉取请求", "站点", "已安排", "插件", "项目管理"];
  const enhancementOrder = [
    ["Skills 分组", "skills-grouping"],
    ["资产控制台", "asset-console"],
  ];
  const expectedVisible = [
    ...canonicalOrder.filter((name) => !actual.hiddenSettingKeys.includes(`native:${name}`)),
    ...enhancementOrder
      .filter(([, id]) => !actual.hiddenSettingKeys.includes(`enhancement:${id}`))
      .map(([name]) => name),
  ];
  assert.ok(actual.sourceNames.length >= 5, "at least the five stable native shortcuts must be available");
  assert.deepEqual(actual.sourceNames, canonicalOrder.filter((name) => actual.sourceNames.includes(name)));
  assert.deepEqual(actual.visibleNames, expectedVisible);
  assert.deepEqual(
    actual.hiddenNativeNames,
    ["拉取请求", "站点", "已安排", "插件", "项目管理"]
      .filter((name) => actual.hiddenSettingKeys.includes(`native:${name}`)),
  );
  assert.ok(Math.max(...actual.cards.map((card) => card.top)) - Math.min(...actual.cards.map((card) => card.top)) <= 1,
    "shortcut cards must remain visually aligned within one device pixel");
  assert.equal(new Set(actual.cards.map((card) => card.width)).size, 1);
  assert.ok(actual.cards.every((card) => card.height >= 62));
  assert.ok(actual.cards.every((card) => card.hasImage && card.iconBeforeLabel));
  assert.ok(actual.cards.every((card) => card.ariaLabel));
  assert.equal(actual.sourcesHidden, true);
  assert.ok(actual.overflowTop > actual.firstRowTop, "the seventh card must wrap to a second row");
  assert.equal(actual.quickAction, expectedVisible.includes("新对话"));
  assert.equal(actual.scheduledStatus, expectedVisible.includes("已安排"));

  process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
} finally {
  client.close();
}
