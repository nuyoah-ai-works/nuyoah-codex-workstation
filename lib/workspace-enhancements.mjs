import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";

export const BUILT_IN_WORKSPACE_ENHANCEMENTS = Object.freeze([
  Object.freeze({
    id: "workstation",
    label: "工作站",
    defaultVisible: true,
    icon: "workstation",
  }),
]);

export function createAssetConsoleRuntime({
  root,
  platform = process.platform,
  home = os.homedir(),
  localAppData = process.env.LOCALAPPDATA,
  port = 5177,
} = {}) {
  if (!root) throw new Error("Runtime root is required");
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("Invalid Asset Console port");
  }
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const stateRoot = platform === "win32"
    ? pathApi.join(localAppData || pathApi.join(home, "AppData", "Local"), "CodexSidebarEnhancer", "Data", "AssetConsole")
    : platform === "darwin"
      ? pathApi.join(home, "Library", "Application Support", "Codex Sidebar Enhancer Data", "Asset Console")
      : pathApi.join(home, ".local", "share", "codex-sidebar-enhancer", "asset-console");
  const serviceRoot = pathApi.join(root, "nuyoah", "assets");
  return {
    port: Number(port),
    stateRoot,
    serviceRoot,
    serverPath: pathApi.join(serviceRoot, "server.mjs"),
    staticRoot: pathApi.join(serviceRoot, "public"),
    configPath: pathApi.join(stateRoot, "asset-browser.config.json"),
    tokenPath: pathApi.join(stateRoot, ".api-token"),
    ledgerPath: pathApi.join(stateRoot, ".asset-download-ledger.json"),
    generationRegistryPath: pathApi.join(stateRoot, ".generation-tickets.json"),
    generationBindingsPath: pathApi.join(stateRoot, ".thread-project-bindings.json"),
    promptAssociationRegistryPath: pathApi.join(stateRoot, ".codex-prompt-associations.json"),
    assetLibraryIndexPath: pathApi.join(stateRoot, ".asset-library-index.json"),
    duplicateLedgerPath: pathApi.join(stateRoot, ".duplicate-cleanup-ledger.json"),
    duplicateQuarantinePath: pathApi.join(stateRoot, "duplicate-quarantine"),
    promptLibraryRoot: pathApi.join(stateRoot, "prompt-library"),
    actionTrashRoot: pathApi.join(stateRoot, "action-trash"),
    threeDRegistryPath: pathApi.join(stateRoot, ".three-d-reconstruction-tasks.json"),
  };
}

async function writeIfMissing(filePath, contents, mode = 0o600) {
  try {
    await access(filePath);
  } catch {
    await writeFile(filePath, contents, { encoding: "utf8", mode, flag: "wx" }).catch(async (error) => {
      if (error?.code !== "EEXIST") throw error;
    });
  }
}

export async function provisionAssetConsoleState(runtime) {
  if (!runtime?.stateRoot || !runtime?.tokenPath || !runtime?.configPath) {
    throw new Error("Asset Console runtime is incomplete");
  }
  await mkdir(runtime.stateRoot, { recursive: true });
  await writeIfMissing(runtime.tokenPath, `${randomBytes(32).toString("hex")}\n`);
  await writeIfMissing(runtime.configPath, `${JSON.stringify({ enabled: true, projects: [] }, null, 2)}\n`);
  return runtime;
}
