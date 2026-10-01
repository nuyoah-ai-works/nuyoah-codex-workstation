#!/usr/bin/env node

import assert from "node:assert/strict";

import { connectMainCodex } from "./cdp-client.mjs";

async function waitFor(client, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

const client = await connectMainCodex(Number(process.env.CODEX_SIDEBAR_PORT || 9231));
const diagnostics = [];
const requestUrls = new Map();
const isTaskboardUrl = (value) => typeof value === "string"
  && /127\.0\.0\.1:\d+\/.+(?:assets\/|api\/|\?host=codex)/.test(value);
const record = (value) => {
  diagnostics.push(value);
  if (diagnostics.length > 40) diagnostics.shift();
};
client.on("Log.entryAdded", (event) => {
  const text = event.entry?.text;
  if (/taskboard|127\.0\.0\.1|cors|module/i.test(text || "")) record({ type: "log", text });
});
client.on("Network.requestWillBeSent", (event) => {
  const url = event.request?.url;
  requestUrls.set(event.requestId, url);
  if (isTaskboardUrl(url)) record({ type: "request", url, method: event.request?.method });
});
client.on("Network.responseReceived", (event) => {
  const url = event.response?.url || requestUrls.get(event.requestId);
  if (isTaskboardUrl(url)) record({
    type: "response",
    url,
    status: event.response?.status,
    mimeType: event.response?.mimeType,
    corsOrigin: event.response?.headers?.["access-control-allow-origin"],
  });
});
client.on("Network.loadingFailed", (event) => {
  const url = requestUrls.get(event.requestId);
  if (isTaskboardUrl(url)) record({
    type: "loadingFailed",
    url,
    errorText: event.errorText,
    blockedReason: event.blockedReason,
    corsErrorStatus: event.corsErrorStatus,
  });
});
client.on("Runtime.exceptionThrown", (event) => record({
  type: "exception",
  url: event.exceptionDetails?.url,
  text: event.exceptionDetails?.exception?.description || event.exceptionDetails?.text,
}));
try {
  await Promise.all([
    client.send("Log.enable"),
    client.send("Network.enable"),
    client.send("Runtime.enable"),
  ]);
  assert.equal(await waitFor(client, `Boolean(document.querySelector(
    '#codex-sidebar-shortcut-grid [data-codex-sidebar-shortcut-name="项目管理"]'
  ))`, 20_000), true, "项目管理快捷入口必须完成挂载");
  const clicked = await client.evaluate(`(() => {
    const button = document.querySelector('#codex-sidebar-shortcut-grid [data-codex-sidebar-shortcut-name="项目管理"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, "项目管理快捷入口必须存在并可点击");
  const loaded = await waitFor(client, `(() => {
    const page = document.getElementById("codex-taskboard-page");
    const frame = document.getElementById("codex-taskboard-frame");
    const frameDocument = frame?.contentDocument;
    return document.documentElement.getAttribute("data-codex-taskboard-open") === "true"
      && page?.hidden === false
      && frame?.hidden === false
      && Boolean(frameDocument?.querySelector(".project-swimlane-scroll"));
  })()`);

  const state = await client.evaluate(`(() => ({
    entryLabel: document.querySelector('#codex-taskboard-entry')?.textContent?.trim() || null,
    open: document.documentElement.getAttribute("data-codex-taskboard-open"),
    pageVisible: document.getElementById("codex-taskboard-page")?.hidden === false,
    frameReady: Boolean(document.getElementById("codex-taskboard-frame")?.contentDocument?.querySelector(".project-swimlane-scroll")),
    frameTitle: document.getElementById("codex-taskboard-frame")?.title || null,
    frameUrl: document.getElementById("codex-taskboard-frame")?.src || null,
    status: document.getElementById("codex-taskboard-status")?.textContent?.trim() || null,
    panelWidth: document.getElementById("codex-taskboard-page")?.getBoundingClientRect().width || 0,
    composerVisible: Boolean(Array.from(document.querySelectorAll('[contenteditable="true"]')).find((node) => node.getClientRects().length > 0)),
    nativeHiddenCount: document.querySelectorAll('[data-codex-taskboard-native-hidden="true"]').length
  }))()`);
  assert.equal(loaded, true, `项目管理页面必须在 Codex 主工作区完成加载：${JSON.stringify({ state, diagnostics })}`);
  assert.equal(state.entryLabel, "项目管理");
  assert.equal(state.open, "true");
  assert.equal(state.pageVisible, true);
  assert.equal(state.frameReady, true);
  assert.equal(state.composerVisible, true, "打开项目管理后原生对话输入框必须继续可用");
  assert.equal(state.nativeHiddenCount, 0, "侧边面板不得隐藏 Codex 原生对话工作区");
  assert.ok(state.panelWidth >= 420 && state.panelWidth <= 1100, "项目管理必须以可调整宽度的右侧面板展示");
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
} finally {
  try { await client.evaluate("window.__codexTaskboardInjection__?.close?.(false)"); } catch {}
  client.close();
}
