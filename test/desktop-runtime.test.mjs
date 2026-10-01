import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopAppRuntime } from "../lib/desktop-runtime.mjs";

test("Windows runtime reads only the main desktop process and stops it by pid", async () => {
  const calls = [];
  const processList = JSON.stringify({
    ProcessId: 700,
    Name: "Codex.exe",
    ExecutablePath: "C:\\Apps\\Codex.exe",
    CommandLine: '"C:\\Apps\\Codex.exe"',
  });
  const runtime = createDesktopAppRuntime({
    platform: "win32",
    execFileAsync: async (command, args) => {
      calls.push({ command, args });
      if (command === "powershell.exe") return { stdout: processList };
      return { stdout: "" };
    },
    spawnProcess: () => { throw new Error("not used"); },
  });

  assert.deepEqual(await runtime.readProcess(), {
    pid: 700,
    appPath: "C:\\Apps\\Codex.exe",
    appName: "Codex.exe",
  });
  await runtime.quit({ pid: 700 });
  assert.equal(calls[0].command, "powershell.exe");
  assert.deepEqual(calls[1], { command: "taskkill.exe", args: ["/PID", "700", "/T"] });
});

test("Windows runtime launches the discovered executable detached with debugging enabled", () => {
  const calls = [];
  const child = { unrefCalled: false, unref() { this.unrefCalled = true; } };
  const runtime = createDesktopAppRuntime({
    platform: "win32",
    execFileAsync: async () => ({ stdout: "" }),
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
  });

  runtime.launch("C:\\Apps\\ChatGPT.exe", 9231);
  assert.deepEqual(calls, [{
    command: "C:\\Apps\\ChatGPT.exe",
    args: [
      "--remote-debugging-port=9231",
      "--remote-allow-origins=http://127.0.0.1:9231",
      "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly",
    ],
    options: { detached: true, stdio: "ignore" },
  }]);
  assert.equal(child.unrefCalled, true);
});

test("macOS runtime keeps the existing exact process, quit, and open behavior", async () => {
  const calls = [];
  const child = { unref() {} };
  const runtime = createDesktopAppRuntime({
    platform: "darwin",
    home: "/Users/example",
    execFileAsync: async (command, args) => {
      calls.push({ command, args });
      if (command === "/bin/ps") {
        return { stdout: "99 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n" };
      }
      return { stdout: "" };
    },
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
  });

  const app = await runtime.readProcess();
  await runtime.quit(app);
  runtime.launch(app.appPath, 9231);
  assert.equal(calls[0].command, "/bin/ps");
  assert.equal(calls[1].command, "/usr/bin/osascript");
  assert.equal(calls[2].command, "/usr/bin/open");
  assert.deepEqual(calls[2].args, [
    "-na",
    "/Applications/ChatGPT.app",
    "--args",
    "--user-data-dir=/Users/example/Library/Application Support/Codex",
    "--remote-debugging-port=9231",
    "--remote-allow-origins=http://127.0.0.1:9231",
    "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly",
  ]);
});
