#!/usr/bin/env node

import assert from "node:assert/strict";

import { PreviewRepository } from "../lib/preview-data.mjs";
import { presentRateLimit } from "../lib/usage-data.mjs";
import { connectMainCodex } from "./cdp-client.mjs";

const repository = new PreviewRepository();
let expected = presentRateLimit(await repository.readUsage(), { timeZone: "Asia/Shanghai" });

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
  const readActual = () => client.evaluate(`(() => {
      const usage = document.getElementById("codex-conversation-usage-status");
      const switchButton = document.getElementById("codex-conversation-view-toggle");
      const fill = usage?.querySelector(".codex-conversation-usage-fill");
      const usageRect = usage?.getBoundingClientRect();
      const switchRect = switchButton?.getBoundingClientRect();
      return usage ? {
        text: usage.querySelector(".codex-conversation-usage-text")?.textContent,
        value: usage.querySelector(".codex-conversation-usage-value")?.textContent,
        role: usage.getAttribute("role"),
        live: usage.getAttribute("aria-live"),
        ariaLabel: usage.getAttribute("aria-label"),
        remainingPercent: usage.dataset.remainingPercent === "" ? null : Number(usage.dataset.remainingPercent),
        fillStyleWidth: fill?.style.width || "",
        fillWidth: fill ? parseFloat(getComputedStyle(fill).width) : 0,
        trackWidth: fill?.parentElement ? parseFloat(getComputedStyle(fill.parentElement).width) : 0,
        visibilityState: document.visibilityState,
        width: usageRect.width,
        height: usageRect.height,
        beforeSwitch: usageRect.right <= switchRect.left + 1,
        sameHost: usage.parentElement === switchButton.parentElement,
      } : null;
    })()`);
  const deadline = Date.now() + 8_000;
  let actual;
  do {
    expected = presentRateLimit(await repository.readUsage(), { timeZone: "Asia/Shanghai" });
    actual = await readActual();
    const valueSettled = actual?.remainingPercent === expected.remainingPercent
      && actual?.ariaLabel === expected.ariaLabel;
    const fillSettled = expected.remainingPercent == null
      ? actual?.fillStyleWidth === "0%"
      : actual?.fillStyleWidth === `${expected.remainingPercent}%`;
    const settled = valueSettled && fillSettled;
    if (actual && settled) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);

  assert.ok(actual, "usage status must exist");
  const [expectedText, expectedValue] = expected.text.split(/\s+(?=[^\s]+$)/);
  assert.equal(actual.text, expectedText);
  assert.equal(actual.value, expectedValue);
  assert.equal(actual.role, "status");
  assert.equal(actual.live, "polite");
  assert.equal(actual.ariaLabel, expected.ariaLabel);
  assert.equal(actual.remainingPercent, expected.remainingPercent);
  assert.equal(actual.fillStyleWidth, `${expected.remainingPercent ?? 0}%`);
  if (actual.visibilityState === "visible" && expected.remainingPercent != null) {
    assert.ok(Math.abs(actual.fillWidth / actual.trackWidth * 100 - expected.remainingPercent) < 1);
  }
  assert.ok(actual.width >= 104 && actual.width <= 120);
  assert.equal(actual.height, 28);
  assert.equal(actual.beforeSwitch, true);
  assert.equal(actual.sameHost, true);

  process.stdout.write(`${JSON.stringify({ expected, actual }, null, 2)}\n`);
} finally {
  client.close();
}
