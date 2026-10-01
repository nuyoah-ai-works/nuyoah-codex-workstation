export async function needsPreviewAttachment({ client, attachedTargetId, nextTargetId }) {
  if (!nextTargetId) return false;
  if (!client || nextTargetId !== attachedTargetId) return true;
  const runtimeAlive = await client.evaluate(
    "Boolean(window.__codexConversationPreviewInjection__)",
  );
  return !runtimeAlive;
}

const DESKTOP_APP_PROCESSES = [
  {
    executable: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    appPath: "/Applications/ChatGPT.app",
    bundleId: "com.openai.codex",
  },
  {
    executable: "/Applications/Codex.app/Contents/MacOS/Codex",
    appPath: "/Applications/Codex.app",
    bundleId: "com.openai.codex",
  },
];

export function parseDesktopAppProcess(processList) {
  for (const line of String(processList || "").split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (!match) continue;
    const candidate = DESKTOP_APP_PROCESSES.find((item) => match[2] === item.executable);
    if (!candidate) continue;
    return { pid: Number(match[1]), appPath: candidate.appPath, bundleId: candidate.bundleId };
  }
  return null;
}

export function desktopAppLaunchArgs(appPath, port, userDataDir = null) {
  const args = [
    "-na",
    appPath,
    "--args",
  ];
  if (userDataDir) args.push(`--user-data-dir=${userDataDir}`);
  args.push(
    `--remote-debugging-port=${port}`,
    `--remote-allow-origins=http://127.0.0.1:${port}`,
    "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly",
  );
  return args;
}

export function windowsDesktopAppLaunchArgs(port) {
  return [
    `--remote-debugging-port=${port}`,
    `--remote-allow-origins=http://127.0.0.1:${port}`,
    "--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly",
  ];
}

export function parseWindowsDesktopAppProcess(processList) {
  let items;
  try {
    const parsed = JSON.parse(String(processList || "[]"));
    items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return null;
  }
  for (const item of items) {
    const name = String(item?.Name || "");
    const executablePath = String(item?.ExecutablePath || "");
    const commandLine = String(item?.CommandLine || "");
    if (!/^(?:ChatGPT|Codex)\.exe$/i.test(name)) continue;
    if (!executablePath || /(?:^|\s)--type=/i.test(commandLine)) continue;
    const pid = Number(item?.ProcessId);
    if (!Number.isInteger(pid) || pid < 1) continue;
    return { pid, appPath: executablePath, appName: name };
  }
  return null;
}

export class DesktopAppRecovery {
  constructor({ missingTargetGraceMs = 10_000, quitRetryMs = 5_000, launchRetryMs = 15_000 } = {}) {
    this.missingTargetGraceMs = missingTargetGraceMs;
    this.quitRetryMs = quitRetryMs;
    this.launchRetryMs = launchRetryMs;
    this.missingSince = null;
    this.pending = null;
  }

  next({ targetAvailable, app, now = Date.now() }) {
    if (targetAvailable) {
      this.missingSince = null;
      this.pending = null;
      return null;
    }
    if (this.pending?.phase === "launched") {
      if (!app || now - this.pending.launchedAt < this.launchRetryMs) return null;
    }
    if (!app) {
      if (this.pending?.phase !== "quitting") return null;
      const appPath = this.pending.app.appPath;
      this.pending = { phase: "launching", appPath };
      return { type: "launch", appPath };
    }
    if (!this.pending) {
      if (this.missingSince === null) this.missingSince = now;
      if (now - this.missingSince < this.missingTargetGraceMs) return null;
    }
    if (this.pending?.phase === "quitting" && this.pending.app.pid === app.pid) {
      if (now - this.pending.requestedAt < this.quitRetryMs) return null;
    }
    this.pending = { phase: "quitting", app, requestedAt: now };
    return { type: "quit", app };
  }

  markLaunched(now = Date.now()) {
    if (this.pending?.phase !== "launching") return;
    this.pending = { ...this.pending, phase: "launched", launchedAt: now };
  }
}
