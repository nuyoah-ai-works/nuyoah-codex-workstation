import { execFile, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  desktopAppLaunchArgs,
  parseDesktopAppProcess,
  parseWindowsDesktopAppProcess,
  windowsDesktopAppLaunchArgs,
} from "./injector-state.mjs";

const defaultExecFileAsync = promisify(execFile);

const WINDOWS_PROCESS_QUERY = [
  "$items = Get-CimInstance Win32_Process",
  "| Where-Object { $_.Name -in @('ChatGPT.exe','Codex.exe') -and $_.CommandLine -notmatch '(?:^|\\s)--type=' }",
  "| Select-Object ProcessId,Name,ExecutablePath,CommandLine;",
  "@($items) | ConvertTo-Json -Compress",
].join(" ");

export function createDesktopAppRuntime({
  platform = process.platform,
  home = os.homedir(),
  execFileAsync = defaultExecFileAsync,
  spawnProcess = spawn,
} = {}) {
  return {
    async readProcess() {
      if (platform === "darwin") {
        const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,command="]);
        return parseDesktopAppProcess(stdout);
      }
      if (platform === "win32") {
        const { stdout } = await execFileAsync("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          WINDOWS_PROCESS_QUERY,
        ]);
        return parseWindowsDesktopAppProcess(stdout);
      }
      return null;
    },

    async quit(app) {
      if (platform === "darwin") {
        await execFileAsync("/usr/bin/osascript", [
          "-e",
          `tell application id ${JSON.stringify(app.bundleId)} to quit`,
        ]);
      } else if (platform === "win32") {
        await execFileAsync("taskkill.exe", ["/PID", String(app.pid), "/T"]);
      }
    },

    launch(appPath, port) {
      const command = platform === "darwin" ? "/usr/bin/open" : appPath;
      const args = platform === "darwin"
        ? desktopAppLaunchArgs(
          appPath,
          port,
          path.posix.join(home, "Library", "Application Support", "Codex"),
        )
        : windowsDesktopAppLaunchArgs(port);
      const child = spawnProcess(command, args, { detached: true, stdio: "ignore" });
      child.unref();
      return child;
    },
  };
}
