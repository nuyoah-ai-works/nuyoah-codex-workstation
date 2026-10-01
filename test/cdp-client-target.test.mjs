import assert from "node:assert/strict";
import test from "node:test";

import { selectMainCodexTarget } from "../scripts/cdp-client.mjs";

function target(overrides = {}) {
  return {
    id: "main",
    type: "page",
    title: "Codex",
    url: "app://-/index.html",
    webSocketDebuggerUrl: "ws://127.0.0.1/main",
    ...overrides,
  };
}

test("main Codex target accepts the ChatGPT title used by current desktop builds", () => {
  const overlay = target({
    id: "overlay",
    title: "ChatGPT",
    url: "app://-/index.html?initialRoute=%2Favatar-overlay",
    webSocketDebuggerUrl: "ws://127.0.0.1/overlay",
  });
  const main = target({ title: "ChatGPT" });

  assert.equal(selectMainCodexTarget([overlay, main]), main);
});

test("main Codex target keeps supporting legacy Codex titles", () => {
  const main = target();
  assert.equal(selectMainCodexTarget([main]), main);
});

test("main Codex target rejects routed overlays and unrelated pages", () => {
  assert.equal(selectMainCodexTarget([
    target({ title: "ChatGPT", url: "app://-/index.html?initialRoute=%2Favatar-overlay" }),
    target({ title: "ChatGPT", url: "https://chatgpt.com/" }),
    target({ title: "Other", url: "app://-/settings.html" }),
  ]), undefined);
});
