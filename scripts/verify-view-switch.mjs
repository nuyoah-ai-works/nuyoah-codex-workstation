#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

const client = await connectMainCodex(9231);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function state() {
  return client.evaluate(`(() => {
    const button = document.getElementById("codex-conversation-view-toggle");
    const thumb = button?.querySelector(".codex-conversation-view-switch-thumb");
    const rect = button?.getBoundingClientRect();
    return {
      mode: document.documentElement.dataset.codexConversationView,
      stored: localStorage.getItem("codex-conversation-preview:view-mode"),
      role: button?.getAttribute("role"),
      checked: button?.getAttribute("aria-checked"),
      label: button?.getAttribute("aria-label"),
      width: rect?.width || 0,
      height: rect?.height || 0,
      thumb: Boolean(thumb),
      center: rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null,
    };
  })()`);
}

async function pointerClick(center) {
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: center.x,
    y: center.y,
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: center.x,
    y: center.y,
    button: "left",
    clickCount: 1,
  });
  await wait(250);
}

try {
  let initial = await state();
  assert.ok(initial.center, "view switch must exist");
  if (initial.mode === "card") {
    await pointerClick(initial.center);
    initial = await state();
  }

  assert.equal(initial.mode, "list");
  assert.equal(initial.role, "switch");
  assert.equal(initial.checked, "false");
  assert.equal(initial.thumb, true);
  assert.ok(initial.width >= 48);
  assert.ok(initial.height >= 26);

  await client.evaluate(`(() => {
    const current = document.getElementById("codex-conversation-view-toggle");
    current.replaceWith(current.cloneNode(true));
    window.__codexConversationPreviewInjection__.refresh();
  })()`);
  const rebound = await state();
  await pointerClick(rebound.center);
  const card = await state();
  assert.equal(card.mode, "card");
  assert.equal(card.stored, "card");
  assert.equal(card.checked, "true");

  await client.evaluate(`document.getElementById("codex-conversation-view-toggle").focus()`);
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space" });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space" });
  await wait(250);
  const restored = await state();
  assert.equal(restored.mode, "list");
  assert.equal(restored.stored, "list");
  assert.equal(restored.checked, "false");

  process.stdout.write(`${JSON.stringify({ initial, card, restored }, null, 2)}\n`);
} finally {
  try {
    const current = await state();
    if (current.mode === "card" && current.center) await pointerClick(current.center);
  } catch {}
  client.close();
}
