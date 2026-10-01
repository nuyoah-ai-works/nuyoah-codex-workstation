import assert from "node:assert/strict";
import test from "node:test";

import { needsPreviewAttachment } from "../lib/injector-state.mjs";

test("a same-id renderer is reattached when a reload removed the preview runtime", async () => {
  const expressions = [];
  const client = {
    async evaluate(expression) {
      expressions.push(expression);
      return false;
    },
  };

  assert.equal(await needsPreviewAttachment({
    client,
    attachedTargetId: "renderer-1",
    nextTargetId: "renderer-1",
  }), true);
  assert.deepEqual(expressions, ["Boolean(window.__codexConversationPreviewInjection__)"]);
});

test("a healthy same-id renderer is not registered twice", async () => {
  const client = { evaluate: async () => true };

  assert.equal(await needsPreviewAttachment({
    client,
    attachedTargetId: "renderer-1",
    nextTargetId: "renderer-1",
  }), false);
});

test("a new renderer target always needs attachment", async () => {
  const client = { evaluate: async () => { throw new Error("should not evaluate the old target"); } };

  assert.equal(await needsPreviewAttachment({
    client,
    attachedTargetId: "renderer-1",
    nextTargetId: "renderer-2",
  }), true);
});

test("a normally launched desktop app is relaunched once after a transient target grace period", async () => {
  const state = await import("../lib/injector-state.mjs");
  assert.equal(typeof state.DesktopAppRecovery, "function",
    "the watch injector needs a desktop app recovery state machine");

  const recovery = new state.DesktopAppRecovery({ missingTargetGraceMs: 10_000 });
  const app = {
    pid: 22323,
    appPath: "/Applications/ChatGPT.app",
    bundleId: "com.openai.codex",
  };
  assert.equal(recovery.next({ targetAvailable: false, app, now: 1_000 }), null,
    "a renderer reload must not immediately restart the desktop app");
  assert.equal(recovery.next({ targetAvailable: false, app, now: 10_999 }), null);
  assert.deepEqual(recovery.next({ targetAvailable: false, app, now: 11_000 }), {
    type: "quit",
    app,
  });
  assert.equal(recovery.next({ targetAvailable: false, app, now: 12_000 }), null,
    "the same running process must not be restarted repeatedly inside the retry interval");
  assert.deepEqual(recovery.next({ targetAvailable: false, app: null, now: 13_000 }), {
    type: "launch",
    appPath: "/Applications/ChatGPT.app",
  });
  recovery.markLaunched(13_000);
  assert.equal(recovery.next({ targetAvailable: false, app: { ...app, pid: 22400 }, now: 14_000 }), null,
    "the app launched by recovery must be given time to expose its debugging port");
  assert.equal(recovery.next({ targetAvailable: true, app: { ...app, pid: 22400 }, now: 15_000 }), null);
  assert.equal(recovery.next({ targetAvailable: false, app: { ...app, pid: 22500 }, now: 16_000 }), null);
  assert.deepEqual(recovery.next({ targetAvailable: false, app: { ...app, pid: 22500 }, now: 26_000 }), {
    type: "quit",
    app: { ...app, pid: 22500 },
  }, "a later ordinary relaunch must be recovered again after a healthy target was observed");
});

test("desktop app recovery targets only the exact ChatGPT or Codex main process", async () => {
  const state = await import("../lib/injector-state.mjs");
  assert.equal(typeof state.parseDesktopAppProcess, "function");
  const processList = [
    "  901 /Applications/ChatGPT.app/Contents/Frameworks/Codex Helper.app/Contents/MacOS/Codex Helper --type=renderer",
    "22323 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    "22324 /usr/bin/open -a ChatGPT",
  ].join("\n");
  assert.deepEqual(state.parseDesktopAppProcess(processList), {
    pid: 22323,
    appPath: "/Applications/ChatGPT.app",
    bundleId: "com.openai.codex",
  });
  assert.equal(state.parseDesktopAppProcess("42 /Applications/Other.app/Contents/MacOS/Other"), null);
});

test("desktop app recovery launches the app with the user profile and complete debugging arguments", async () => {
  const state = await import("../lib/injector-state.mjs");
  assert.equal(typeof state.desktopAppLaunchArgs, "function");
  assert.deepEqual(state.desktopAppLaunchArgs(
    "/Applications/ChatGPT.app",
    9231,
    "/Users/example/Library/Application Support/Codex",
  ), [
    "-na",
    "/Applications/ChatGPT.app",
    "--args",
    "--user-data-dir=/Users/example/Library/Application Support/Codex",
    "--remote-debugging-port=9231",
    "--remote-allow-origins=http://127.0.0.1:9231",
    "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly",
  ]);
});

test("desktop app recovery retries a launched app that never exposes the debugging target", async () => {
  const state = await import("../lib/injector-state.mjs");
  const recovery = new state.DesktopAppRecovery({ launchRetryMs: 10_000 });
  const app = {
    pid: 22323,
    appPath: "/Applications/ChatGPT.app",
    bundleId: "com.openai.codex",
  };

  recovery.pending = { phase: "launching", appPath: app.appPath };
  recovery.markLaunched(1_000);
  assert.equal(recovery.next({ targetAvailable: false, app, now: 9_000 }), null);
  assert.deepEqual(recovery.next({ targetAvailable: false, app, now: 12_000 }), {
    type: "quit",
    app,
  });
});

test("Windows desktop app recovery ignores Electron helpers and selects the main process", async () => {
  const state = await import("../lib/injector-state.mjs");
  assert.equal(typeof state.parseWindowsDesktopAppProcess, "function");
  const processList = JSON.stringify([
    {
      ProcessId: 401,
      Name: "ChatGPT.exe",
      ExecutablePath: "C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT\\ChatGPT.exe",
      CommandLine: '"C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT\\ChatGPT.exe" --type=renderer',
    },
    {
      ProcessId: 400,
      Name: "ChatGPT.exe",
      ExecutablePath: "C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT\\ChatGPT.exe",
      CommandLine: '"C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT\\ChatGPT.exe"',
    },
  ]);

  assert.deepEqual(state.parseWindowsDesktopAppProcess(processList), {
    pid: 400,
    appPath: "C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT\\ChatGPT.exe",
    appName: "ChatGPT.exe",
  });
  assert.equal(state.parseWindowsDesktopAppProcess(JSON.stringify([
    { ProcessId: 1, Name: "Other.exe", ExecutablePath: "C:\\Other.exe", CommandLine: "C:\\Other.exe" },
  ])), null);
});

test("Windows desktop app recovery uses the same complete debugging arguments", async () => {
  const state = await import("../lib/injector-state.mjs");
  assert.equal(typeof state.windowsDesktopAppLaunchArgs, "function");
  assert.deepEqual(state.windowsDesktopAppLaunchArgs(9231), [
    "--remote-debugging-port=9231",
    "--remote-allow-origins=http://127.0.0.1:9231",
    "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly",
  ]);
});
