import assert from "node:assert/strict";
import { test } from "node:test";

import {
  codexStartupAction,
  findResidentInjectorPids,
  handleHostBindingPayload,
  reconcileManagedCodexRuntime,
  reconcileInjectionRuntime,
  restartResidentInjector,
  stopCodexForManagedRelaunch,
  waitForAvailableCodexTargets,
} from "../scripts/codex-injector-runtime.mjs";
import * as injectorRuntime from "../scripts/codex-injector-runtime.mjs";

const currentAutomationRequest = {
  id: "host-request-1",
  action: "automation",
  requestId: "automation-request-1",
  operation: "ensure-active",
  taskboardProjectId: "local",
  codexProjectId: "codex-project",
  projectName: "Local",
  workspacePath: "/tmp/project",
  skillPath: "/tmp/manage-taskboard/SKILL.md",
  intervalMinutes: 10,
  model: "gpt-5.6-sol",
  reasoningEffort: "ultra",
};

test("Codex target selection excludes the avatar overlay and keeps the main window", () => {
  const targets = [
    {
      id: "avatar-overlay",
      type: "page",
      title: "Codex",
      url: "app://-/index.html?initialRoute=%2Favatar-overlay",
      webSocketDebuggerUrl: "ws://127.0.0.1/avatar-overlay",
    },
    {
      id: "main-window",
      type: "page",
      title: "Codex",
      url: "app://-/index.html",
      webSocketDebuggerUrl: "ws://127.0.0.1/main-window",
    },
    {
      id: "global-dictation",
      type: "page",
      title: "Codex",
      url: "app://-/index.html?initialRoute=%2Fglobal-dictation",
      webSocketDebuggerUrl: "ws://127.0.0.1/global-dictation",
    },
  ];

  assert.equal(typeof injectorRuntime.selectCodexTargets, "function");
  assert.deepEqual(injectorRuntime.selectCodexTargets(targets), [targets[1]]);
});

test("attach-existing injectors wait for the canonical Taskboard instead of spawning a second server", () => {
  assert.equal(typeof injectorRuntime.taskboardServiceAction, "function");
  assert.equal(
    injectorRuntime.taskboardServiceAction({ reachable: false, attachExisting: true }),
    "wait-for-external",
  );
  assert.equal(
    injectorRuntime.taskboardServiceAction({ reachable: false, attachExisting: false }),
    "start-local",
  );
  assert.equal(
    injectorRuntime.taskboardServiceAction({ reachable: true, attachExisting: true }),
    "ready",
  );
});

test("persistent injectors wait while Codex is closed and relaunch ordinary starts with CDP", () => {
  assert.equal(codexStartupAction({
    cdpReachable: false,
    codexRunning: false,
    launch: false,
    waitForCodex: true,
  }), "wait");
  assert.equal(codexStartupAction({
    cdpReachable: false,
    codexRunning: true,
    launch: false,
    waitForCodex: true,
  }), "relaunch");
  assert.equal(codexStartupAction({
    cdpReachable: true,
    codexRunning: true,
    launch: false,
    waitForCodex: true,
  }), "attach");
});

test("managed relaunch terminates Codex only when graceful quit is ignored", async () => {
  const calls = [];
  const result = await stopCodexForManagedRelaunch({
    requestQuit: () => calls.push("quit"),
    waitUntilStopped: async (timeoutMs) => {
      calls.push(["wait", timeoutMs]);
      if (timeoutMs === 3_000) throw new Error("still running");
    },
    terminate: () => calls.push("terminate"),
  });

  assert.equal(result, "terminated");
  assert.deepEqual(calls, [
    "quit",
    ["wait", 3_000],
    "terminate",
    ["wait", 5_000],
  ]);
});

test("managed relaunch still terminates Codex when graceful quit is rejected", async () => {
  const calls = [];
  const result = await stopCodexForManagedRelaunch({
    requestQuit: () => {
      calls.push("quit");
      throw new Error("user canceled");
    },
    waitUntilStopped: async (timeoutMs) => calls.push(["wait", timeoutMs]),
    terminate: () => calls.push("terminate"),
  });

  assert.equal(result, "terminated");
  assert.deepEqual(calls, [
    "quit",
    "terminate",
    ["wait", 5_000],
  ]);
});

test("resident injector relaunches a later ordinary Codex start with CDP", async () => {
  const calls = [];
  const launchedProcess = { pid: 4321 };
  const result = await reconcileManagedCodexRuntime({
    cdpReachable: false,
    codexRunning: true,
    enabled: true,
    stop: async () => calls.push("stop"),
    launch: () => {
      calls.push("launch");
      return launchedProcess;
    },
    waitUntilReachable: async () => calls.push("ready"),
  });

  assert.deepEqual(result, { action: "relaunch", process: launchedProcess });
  assert.deepEqual(calls, ["stop", "launch", "ready"]);
});

test("startup waits for the main Codex renderer after the CDP port opens", async () => {
  let attempts = 0;
  const targets = await waitForAvailableCodexTargets(async () => {
    attempts += 1;
    return attempts === 1 ? [] : [{ id: "main-window" }];
  }, { timeoutMs: 100, intervalMs: 0 });

  assert.deepEqual(targets, [{ id: "main-window" }]);
  assert.equal(attempts, 2);
});

test("a stale automation parser receives an immediate host error instead of timing out", async () => {
  const responses = [];
  const staleParser = () => null;

  const result = await Promise.race([
    handleHostBindingPayload(
      {
        payload: JSON.stringify(currentAutomationRequest),
        executionContextId: 12,
      },
      {
        parseAutomationRequest: staleParser,
        ensure: async () => assert.fail("ensure must not run"),
        runAutomation: async () => assert.fail("automation must not run"),
        prefill: async () => assert.fail("prefill must not run"),
        sendResponse: async (_executionContextId, response) => responses.push(response),
      },
    ),
    new Promise((_, reject) => setTimeout(() => reject(new Error("host response timed out")), 50)),
  ]);

  assert.deepEqual(result, { responded: true, accepted: false });
  assert.deepEqual(responses, [{
    id: currentAutomationRequest.id,
    ok: false,
    error: "自动认领配置暂时无法应用，请刷新后重试",
    diagnosticCode: "AUTOMATION_SCHEMA_MISMATCH",
  }]);
});

test("explicit suggestion execution accepts a long grounded prompt and forwards auto-submit", async () => {
  const responses = [];
  const instruction = `执行建议\n${"项目上下文".repeat(1_000)}`;
  let forwarded = null;
  const result = await handleHostBindingPayload(
    {
      payload: JSON.stringify({
        id: "host-suggestion-1",
        action: "prefill-task-composer",
        instruction,
        skillName: "manage-taskboard",
        skillDisplayName: "Manage Taskboard",
        skillPath: "/tmp/manage-taskboard/SKILL.md",
        autoSubmit: true,
      }),
      executionContextId: 21,
    },
    {
      parseAutomationRequest: () => null,
      ensure: async () => assert.fail("ensure must not run"),
      runAutomation: async () => assert.fail("automation must not run"),
      prefill: async (request) => {
        forwarded = request;
        return { prefilled: true, submitted: true };
      },
      sendResponse: async (_executionContextId, response) => responses.push(response),
    },
  );
  assert.equal(result.accepted, true);
  assert.equal(forwarded.autoSubmit, true);
  assert.equal(forwarded.instruction, instruction);
  assert.deepEqual(responses, [{
    id: "host-suggestion-1",
    ok: true,
    prefilled: true,
    submitted: true,
  }]);
});

test("composer prefill accepts a namespaced plugin Skill", async () => {
  const responses = [];
  let forwarded = null;
  const request = {
    id: "host-plugin-skill-1",
    action: "prefill-task-composer",
    instruction: " ",
    skillName: "documents:documents",
    skillDisplayName: "Documents",
    skillPath: "/tmp/plugins/documents/skills/documents/SKILL.md",
    autoSubmit: false,
  };

  const result = await handleHostBindingPayload(
    { payload: JSON.stringify(request), executionContextId: 22 },
    {
      parseAutomationRequest: () => null,
      ensure: async () => assert.fail("ensure must not run"),
      runAutomation: async () => assert.fail("automation must not run"),
      prefill: async (value) => {
        forwarded = value;
        return { prefilled: true };
      },
      sendResponse: async (_executionContextId, response) => responses.push(response),
    },
  );

  assert.equal(result.accepted, true);
  assert.equal(forwarded.skillName, "documents:documents");
  assert.deepEqual(responses, [{
    id: request.id,
    ok: true,
    prefilled: true,
  }]);
});

test("attach replaces an old runtime with the current source and restores an open page", async () => {
  const calls = [];
  const result = await reconcileInjectionRuntime({
    currentStatus: {
      version: "0.6.7",
      sourceHash: null,
      pageVisible: true,
      scriptIdentifier: "old-registration",
    },
    source: "current-source",
    sourceHash: "current-hash",
    removeRegisteredSource: async (identifier) => calls.push(["remove", identifier]),
    registerCurrentSource: async (source) => {
      calls.push(["register", source]);
      return "current-registration";
    },
    evaluateCurrentSource: async (source) => calls.push(["evaluate", source]),
    publishRegistration: async (identifier) => calls.push(["publish", identifier]),
    reopen: async () => calls.push(["open"]),
  });

  assert.deepEqual(result, {
    replaced: true,
    scriptIdentifier: "current-registration",
    shouldRemainOpen: true,
  });
  assert.deepEqual(calls, [
    ["remove", "old-registration"],
    ["register", "current-source"],
    ["evaluate", "current-source"],
    ["publish", "current-registration"],
    ["open"],
  ]);
});

test("attach is idempotent for the same source hash and does not open a closed page", async () => {
  const calls = [];
  const result = await reconcileInjectionRuntime({
    currentStatus: {
      version: "0.6.8",
      sourceHash: "current-hash",
      pageVisible: false,
      scriptIdentifier: "old-registration",
    },
    source: "current-source",
    sourceHash: "current-hash",
    removeRegisteredSource: async (identifier) => calls.push(["remove", identifier]),
    registerCurrentSource: async (source) => {
      calls.push(["register", source]);
      return "current-registration";
    },
    evaluateCurrentSource: async (source) => calls.push(["evaluate", source]),
    publishRegistration: async (identifier) => calls.push(["publish", identifier]),
    reopen: async () => calls.push(["open"]),
  });

  assert.deepEqual(result, {
    replaced: false,
    scriptIdentifier: "current-registration",
    shouldRemainOpen: false,
  });
  assert.deepEqual(calls, [
    ["remove", "old-registration"],
    ["register", "current-source"],
    ["evaluate", "current-source"],
    ["publish", "current-registration"],
  ]);
});

test("attach opens a closed page when startup requests the taskboard by default", async () => {
  const calls = [];
  const result = await reconcileInjectionRuntime({
    currentStatus: {
      version: "0.6.11",
      sourceHash: "current-hash",
      pageVisible: false,
      scriptIdentifier: "old-registration",
    },
    source: "current-source",
    sourceHash: "current-hash",
    openRequested: true,
    removeRegisteredSource: async (identifier) => calls.push(["remove", identifier]),
    registerCurrentSource: async (source) => {
      calls.push(["register", source]);
      return "current-registration";
    },
    evaluateCurrentSource: async (source) => calls.push(["evaluate", source]),
    publishRegistration: async (identifier) => calls.push(["publish", identifier]),
    reopen: async () => calls.push(["open"]),
  });

  assert.deepEqual(result, {
    replaced: false,
    scriptIdentifier: "current-registration",
    shouldRemainOpen: true,
  });
  assert.deepEqual(calls, [
    ["remove", "old-registration"],
    ["register", "current-source"],
    ["evaluate", "current-source"],
    ["publish", "current-registration"],
    ["open"],
  ]);
});

test("resident discovery accepts this repository's absolute and relative launch forms only", () => {
  const projectRoot = "/workspace/codex-taskboard";
  const injectorPath = `${projectRoot}/scripts/codex-injector.mjs`;
  const processList = [
    `101 node ${injectorPath} --watch --port 9231`,
    "102 node scripts/codex-injector.mjs --watch",
    "103 node ./scripts/codex-injector.mjs --watch --port=9231",
    "104 node scripts/codex-injector.mjs --watch",
    `105 node ${injectorPath} --watch --port 9229`,
    `106 node ${injectorPath} --port 9231`,
  ].join("\n");
  const cwdByPid = new Map([
    [102, projectRoot],
    [103, projectRoot],
    [104, "/workspace/another-repository"],
  ]);

  assert.deepEqual(findResidentInjectorPids({
    processList,
    currentPid: 999,
    injectorPath,
    projectRoot,
    port: 9231,
    defaultPort: 9229,
    cwdForPid: (pid) => cwdByPid.get(pid) ?? null,
  }), [101, 103]);
  assert.deepEqual(findResidentInjectorPids({
    processList,
    currentPid: 999,
    injectorPath,
    projectRoot,
    port: 9229,
    defaultPort: 9229,
    cwdForPid: (pid) => cwdByPid.get(pid) ?? null,
  }), [102, 105]);
});

test("refresh stops every stale resident before starting one token-verified replacement", async () => {
  const calls = [];
  const startupToken = "replacement-token";
  const replacement = await restartResidentInjector(9231, {
    findResidents: () => [4321, 5432],
    stopResident: async (pid) => calls.push(["stop", pid]),
    createStartupToken: () => startupToken,
    startResident: (port, token) => {
      calls.push(["start", port, token]);
      return { pid: 9876, started: true };
    },
    waitUntilReady: async (port, pid, token) => calls.push(["ready", port, pid, token]),
  });

  assert.deepEqual(replacement, {
    previousPids: [4321, 5432],
    pid: 9876,
    restarted: true,
  });
  assert.deepEqual(calls, [
    ["stop", 4321],
    ["stop", 5432],
    ["start", 9231, startupToken],
    ["ready", 9231, 9876, startupToken],
  ]);
});
