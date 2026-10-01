const HOST_REQUEST_ERROR = "自动认领配置暂时无法应用，请刷新后重试";
const AUTOMATION_SCHEMA_DIAGNOSTIC = "AUTOMATION_SCHEMA_MISMATCH";

export function taskboardServiceAction({ reachable, attachExisting }) {
  if (reachable) return "ready";
  return attachExisting ? "wait-for-external" : "start-local";
}

export function codexStartupAction({
  cdpReachable,
  codexRunning,
  launch,
  waitForCodex,
}) {
  if (cdpReachable) return "attach";
  if (waitForCodex) return codexRunning ? "relaunch" : "wait";
  if (!launch) return "error";
  return codexRunning ? "error-running-without-cdp" : "launch";
}

export async function stopCodexForManagedRelaunch({
  requestQuit,
  waitUntilStopped,
  terminate,
}) {
  let gracefulQuitRequested = false;
  try {
    requestQuit();
    gracefulQuitRequested = true;
  } catch {}
  if (gracefulQuitRequested) {
    try {
      await waitUntilStopped(3_000);
      return "quit";
    } catch {}
  }
  terminate();
  await waitUntilStopped(5_000);
  return "terminated";
}

export async function reconcileManagedCodexRuntime({
  cdpReachable,
  codexRunning,
  enabled,
  stop,
  launch,
  waitUntilReachable,
}) {
  if (!enabled || cdpReachable) return { action: "attach", process: null };
  if (!codexRunning) return { action: "wait", process: null };
  await stop();
  const launchedProcess = launch();
  await waitUntilReachable();
  return { action: "relaunch", process: launchedProcess };
}

export async function waitForAvailableCodexTargets(
  readTargets,
  { timeoutMs, intervalMs },
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      const targets = await readTargets();
      if (targets.length > 0) return targets;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (lastError) throw lastError;
  throw new Error("Timed out waiting for the main Codex renderer target");
}

export function selectCodexTargets(targets) {
  return targets.filter(
    (target) =>
      target.type === "page"
      && target.webSocketDebuggerUrl
      && !target.url?.includes("initialRoute=%2Fglobal-dictation")
      && !target.url?.includes("initialRoute=%2Favatar-overlay")
      && (target.url?.startsWith("app://") || target.title === "Codex"),
  );
}

function parseHostRequest(payload, parseAutomationRequest) {
  if (typeof payload !== "string" || payload.length > 24_000) {
    return { id: null, request: null, error: HOST_REQUEST_ERROR };
  }

  let request;
  try {
    request = JSON.parse(payload);
  } catch {
    return { id: null, request: null, error: HOST_REQUEST_ERROR };
  }

  const id = (
    request
    && typeof request.id === "string"
    && /^[a-z0-9-]{1,80}$/i.test(request.id)
  ) ? request.id : null;
  if (!id) return { id: null, request: null, error: HOST_REQUEST_ERROR };
  if (request.action === "ensure") return { id, request, error: null };
  if (request.action === "automation") {
    const parsed = parseAutomationRequest(request);
    return parsed
      ? { id, request: parsed, error: null }
      : {
          id,
          request: null,
          error: HOST_REQUEST_ERROR,
          diagnosticCode: AUTOMATION_SCHEMA_DIAGNOSTIC,
        };
  }
  if (
    request.action === "prefill-task-composer"
    && typeof request.instruction === "string"
    && request.instruction.length > 0
    && request.instruction.length <= 16_000
    && typeof request.skillName === "string"
    && /^[a-z0-9][a-z0-9-]{0,79}(?::[a-z0-9][a-z0-9-]{0,79})?$/i.test(request.skillName)
    && typeof request.skillDisplayName === "string"
    && request.skillDisplayName.length > 0
    && request.skillDisplayName.length <= 120
    && typeof request.skillPath === "string"
    && request.skillPath.length > 0
    && request.skillPath.length <= 1_024
    && (request.autoSubmit === undefined || typeof request.autoSubmit === "boolean")
    && (request.preserveDraft === undefined || typeof request.preserveDraft === "boolean")
  ) {
    return { id, request, error: null };
  }
  return { id, request: null, error: HOST_REQUEST_ERROR };
}

export async function handleHostBindingPayload(params, handlers) {
  const parsed = parseHostRequest(params.payload, handlers.parseAutomationRequest);
  if (!parsed.request) {
    if (!parsed.id) return { responded: false, accepted: false };
    await handlers.sendResponse(params.executionContextId, {
      id: parsed.id,
      ok: false,
      error: parsed.error,
      ...(parsed.diagnosticCode ? { diagnosticCode: parsed.diagnosticCode } : {}),
    });
    return { responded: true, accepted: false };
  }

  try {
    let result;
    if (parsed.request.action === "ensure") {
      result = await handlers.ensure();
    } else if (parsed.request.action === "automation") {
      result = await handlers.runAutomation(parsed.request, params.executionContextId);
    } else {
      result = await handlers.prefill(parsed.request, params.executionContextId);
    }
    await handlers.sendResponse(params.executionContextId, {
      id: parsed.request.id,
      ok: true,
      ...result,
    });
  } catch (error) {
    await handlers.sendResponse(params.executionContextId, {
      id: parsed.request.id,
      ok: false,
      error: error.message,
    });
  }
  return { responded: true, accepted: true };
}

export async function reconcileInjectionRuntime({
  currentStatus,
  source,
  sourceHash,
  openRequested = false,
  removeRegisteredSource,
  registerCurrentSource,
  evaluateCurrentSource,
  publishRegistration,
  reopen,
}) {
  if (currentStatus.scriptIdentifier) {
    try {
      await removeRegisteredSource(currentStatus.scriptIdentifier);
    } catch {}
  }
  const scriptIdentifier = await registerCurrentSource(source);
  await evaluateCurrentSource(source);
  await publishRegistration(scriptIdentifier);
  const replaced = currentStatus.sourceHash !== sourceHash;
  const shouldRemainOpen = openRequested || currentStatus.pageVisible === true;
  if (shouldRemainOpen && (replaced || currentStatus.pageVisible !== true)) await reopen();
  return { replaced, scriptIdentifier, shouldRemainOpen };
}

export function findResidentInjectorPids({
  processList,
  currentPid,
  injectorPath,
  projectRoot,
  port,
  defaultPort,
  cwdForPid,
}) {
  const absoluteScript = new RegExp(
    `(?:^|\\s)${escapeRegExp(injectorPath)}(?=\\s|$)`,
  );
  const relativeScript = /(?:^|\s)(?:\.\/)?scripts\/codex-injector\.mjs(?=\s|$)/;
  const residents = [];

  for (const line of processList.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (pid === currentPid || !/(?:^|\s)--watch(?=\s|$)/.test(command)) continue;
    const scriptMatches = absoluteScript.test(command)
      || (relativeScript.test(command) && cwdForPid(pid) === projectRoot);
    if (!scriptMatches || commandPort(command, defaultPort) !== port) continue;
    residents.push(pid);
  }
  return residents;
}

export async function restartResidentInjector(port, handlers) {
  const previousPids = handlers.findResidents(port);
  if (previousPids.length === 0) return { previousPids: [], pid: null, restarted: false };

  for (const pid of previousPids) await handlers.stopResident(pid);
  const startupToken = handlers.createStartupToken();
  const started = handlers.startResident(port, startupToken);
  await handlers.waitUntilReady(port, started.pid, startupToken);
  return {
    previousPids,
    pid: started.pid,
    restarted: true,
  };
}

function commandPort(command, defaultPort) {
  const match = command.match(/(?:^|\s)--port(?:=(\d+)|\s+(\d+))(?=\s|$)/);
  return match ? Number(match[1] ?? match[2]) : defaultPort;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Read before disconnecting so a failed/unfinished install leaves the last
// working runtime connected. A changed hash must also invalidate target skips.
export async function refreshInjectionSource(current, readSource, injectedTargets) {
  const next = await readSource();
  if (next.sourceHash === current.sourceHash) return current;
  for (const connection of injectedTargets.values()) connection.close();
  injectedTargets.clear();
  return next;
}
