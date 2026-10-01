#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

async function clickAt(client, x, y) {
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

async function waitForOpen(client, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(`document.getElementById("codex-sidebar-shortcut-settings-dialog")?.open === true`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

const client = await connectMainCodex(9231);
let probe = null;

try {
  probe = await client.evaluate(`(() => {
    const activity = Array.from(document.querySelectorAll("button[aria-label]"))
      .find((button) => button.getAttribute("aria-label")?.startsWith("查看活动"));
    const settings = document.querySelector("[data-codex-sidebar-shortcut-settings]");
    if (!activity || !settings) return null;
    const originalLabel = activity.getAttribute("aria-label");
    const positions = [];
    for (const label of ["查看活动", "查看活动，需要关注"]) {
      activity.setAttribute("aria-label", label);
      window.__codexConversationPreviewInjection__?.refresh?.();
      positions.push({ label, left: settings.getBoundingClientRect().left });
    }
    activity.setAttribute("aria-label", originalLabel);
    window.__codexConversationPreviewInjection__?.refresh?.();
    const rect = settings.getBoundingClientRect();
    window.__codexSettingsClickProbe = false;
    settings.addEventListener("click", () => { window.__codexSettingsClickProbe = true; }, { capture: true, once: true });
    document.getElementById("codex-sidebar-shortcut-settings-dialog")?.close?.();
    return {
      originalLabel,
      positions,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      hitAria: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        ?.closest?.("button")?.getAttribute("aria-label"),
    };
  })()`);

  assert.ok(probe, "settings and activity buttons must exist");
  assert.equal(new Set(probe.positions.map(({ left }) => left)).size, 1,
    "settings button must not move when the activity label gains a status suffix");
  assert.equal(probe.hitAria, "管理快捷入口");

  await clickAt(client, probe.x, probe.y);
  assert.equal(await waitForOpen(client), true, "the first real coordinate click must open settings");
  assert.equal(await client.evaluate(`window.__codexSettingsClickProbe`), true);

  await client.evaluate(`(() => {
    document.getElementById("codex-sidebar-shortcut-settings-dialog")?.close?.();
    const activity = Array.from(document.querySelectorAll("button[aria-label]"))
      .find((button) => button.getAttribute("aria-label")?.startsWith("查看活动"));
    activity?.setAttribute("aria-label", "查看活动");
    window.__codexConversationPreviewInjection__?.refresh?.();
    activity?.setAttribute("aria-label", "查看活动，需要关注");
    window.__codexConversationPreviewInjection__?.refresh?.();
    window.__codexSettingsSecondClickProbe = false;
    document.querySelector("[data-codex-sidebar-shortcut-settings]")
      ?.addEventListener("click", () => { window.__codexSettingsSecondClickProbe = true; }, { capture: true, once: true });
  })()`);
  await clickAt(client, probe.x, probe.y);
  assert.equal(await waitForOpen(client), true, "one click must reopen settings after a sync");
  assert.equal(await client.evaluate(`window.__codexSettingsSecondClickProbe`), true);

  process.stdout.write(`${JSON.stringify(probe, null, 2)}\n`);
} finally {
  await client.evaluate(`(() => {
    document.getElementById("codex-sidebar-shortcut-settings-dialog")?.close?.();
    const activity = Array.from(document.querySelectorAll("button[aria-label]"))
      .find((button) => button.getAttribute("aria-label")?.startsWith("查看活动"));
    if (activity && ${JSON.stringify(probe?.originalLabel || "")}) {
      activity.setAttribute("aria-label", ${JSON.stringify(probe?.originalLabel || "")});
      window.__codexConversationPreviewInjection__?.refresh?.();
    }
  })()`).catch(() => {});
  client.close();
}
