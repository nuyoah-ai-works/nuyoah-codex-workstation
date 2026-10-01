import os from "node:os";
import path from "node:path";

import { createAssetConsoleRuntime } from "./workspace-enhancements.mjs";

export const TASKBOARD_VERSION = "0.2.0-codexoptimiz.20260831";

export function defaultTaskboardDataDir({ platform, home, localAppData }) {
  if (platform === "win32") {
    const base = localAppData || path.win32.join(home, "AppData", "Local");
    return path.win32.join(base, "CodexSidebarEnhancer", "Data", "Taskboard");
  }
  if (platform === "darwin") {
    return path.posix.join(home, "Library", "Application Support", "Codex Sidebar Enhancer Data", "Taskboard");
  }
  return path.posix.join(home, ".local", "share", "codex-sidebar-enhancer", "taskboard");
}

export function createRuntimePlan({
  root,
  nodePath = process.execPath,
  port = 9231,
  platform = process.platform,
  home = os.homedir(),
  localAppData = process.env.LOCALAPPDATA,
  environment = process.env,
  taskboardPort = Number(environment.CODEX_TASKBOARD_PORT || 47823),
  orchestratorDatabasePath = null,
} = {}) {
  if (!root) throw new Error("Runtime root is required");
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("Invalid Codex debugging port");
  }
  if (!Number.isInteger(Number(taskboardPort)) || Number(taskboardPort) < 1 || Number(taskboardPort) > 65535) {
    throw new Error("Invalid Taskboard port");
  }
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const childEnvironment = { ...environment };
  delete childEnvironment.NUYOAH_ORCHESTRATOR_DB;
  const taskboardRoot = pathApi.join(root, "vendor", "codex-taskboard");
  const taskboardDataDir = environment.CODEX_SIDEBAR_TASKBOARD_DATA_DIR
    || defaultTaskboardDataDir({ platform, home, localAppData });
  const taskboardRuntimeFile = pathApi.join(taskboardDataDir, "runtime.json");
  const assetConsole = createAssetConsoleRuntime({
    root,
    platform,
    home,
    localAppData,
    port: Number(environment.CODEX_ASSET_CONSOLE_PORT || 5177),
  });
  const sharedArgs = ["--port", String(port), "--watch"];

  return {
    root,
    taskboardRoot,
    taskboardDataDir,
    taskboardRuntimeFile,
    assetConsole,
    children: [
      {
        name: "sidebar",
        command: nodePath,
        args: [pathApi.join(root, "scripts", "injector.mjs"), ...sharedArgs],
        cwd: root,
        env: {
          ...childEnvironment,
          CODEX_SIDEBAR_TASKBOARD_RUNTIME_FILE: taskboardRuntimeFile,
          CODEX_ASSET_CONSOLE_PORT: String(assetConsole.port),
          CODEX_ASSET_CONSOLE_STATIC_ROOT: assetConsole.staticRoot,
          CODEX_ASSET_CONSOLE_TOKEN_FILE: assetConsole.tokenPath,
        },
      },
      {
        name: "taskboard",
        command: nodePath,
        args: [pathApi.join(taskboardRoot, "scripts", "codex-injector.mjs"), ...sharedArgs],
        cwd: taskboardRoot,
        env: {
          ...childEnvironment,
          CODEX_TASKBOARD_HOST: "127.0.0.1",
          CODEX_TASKBOARD_PORT: String(taskboardPort),
          CODEX_TASKBOARD_DATA_DIR: taskboardDataDir,
          CODEX_TASKBOARD_RUNTIME_FILE: taskboardRuntimeFile,
          CODEX_TASKBOARD_VERSION: TASKBOARD_VERSION,
          ...(orchestratorDatabasePath ? { NUYOAH_ORCHESTRATOR_DB: orchestratorDatabasePath } : {}),
        },
      },
      {
        name: "asset-console",
        command: nodePath,
        args: [assetConsole.serverPath],
        cwd: assetConsole.serviceRoot,
        env: {
          ...childEnvironment,
          PORT: String(assetConsole.port),
          ASSET_BROWSER_CONFIG: assetConsole.configPath,
          ASSET_BROWSER_TOKEN_FILE: assetConsole.tokenPath,
          ASSET_BROWSER_LEDGER: assetConsole.ledgerPath,
          GENERATION_TICKETS: assetConsole.generationRegistryPath,
          GENERATION_THREAD_BINDINGS: assetConsole.generationBindingsPath,
          CODEX_PROMPT_ASSOCIATIONS: assetConsole.promptAssociationRegistryPath,
          ASSET_LIBRARY_INDEX: assetConsole.assetLibraryIndexPath,
          DUPLICATE_CLEANUP_LEDGER: assetConsole.duplicateLedgerPath,
          DUPLICATE_QUARANTINE: assetConsole.duplicateQuarantinePath,
          PROMPT_LIBRARY_ROOT: assetConsole.promptLibraryRoot,
          ASSET_ACTION_TRASH: assetConsole.actionTrashRoot,
          THREE_D_TASKS: assetConsole.threeDRegistryPath,
          NO_PROXY: "localhost,127.0.0.1,::1",
          no_proxy: "localhost,127.0.0.1,::1",
        },
      },
    ],
  };
}
