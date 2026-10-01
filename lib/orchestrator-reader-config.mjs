import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { defaultTaskboardDataDir } from "./runtime-plan.mjs";

const CONFIG_FILE = "orchestrator-reader.json";

export function orchestratorReaderConfigPath({
  platform = process.platform,
  home = os.homedir(),
  localAppData = process.env.LOCALAPPDATA,
} = {}) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  return pathApi.join(defaultTaskboardDataDir({ platform, home, localAppData }), CONFIG_FILE);
}

export async function validOrchestratorDatabasePath(databasePath) {
  if (typeof databasePath !== "string" || !databasePath || !path.isAbsolute(databasePath)
    || path.resolve(databasePath) !== databasePath || databasePath.includes("\0")) return false;
  try {
    const info = await lstat(databasePath);
    if (!info.isFile()) return false;
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const version = database.prepare("PRAGMA user_version").get().user_version;
      const tables = database.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name IN ('requests', 'dispatches')
      `).all();
      return Number.isInteger(version) && version >= 2 && tables.length === 2;
    } finally {
      database.close();
    }
  } catch {
    return false;
  }
}

export async function readOrchestratorReaderConfig(configPath = orchestratorReaderConfigPath()) {
  let info;
  try {
    info = await lstat(configPath);
  } catch (error) {
    return { status: error?.code === "ENOENT" ? "missing" : "invalid", databasePath: null };
  }
  if (!info.isFile() || info.size > 4096 || (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    || (typeof process.getuid === "function" && info.uid !== process.getuid())) {
    return { status: "invalid", databasePath: null };
  }
  try {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    if (!config || typeof config !== "object" || Array.isArray(config)
      || Object.keys(config).sort().join(",") !== "databasePath,version"
      || config.version !== 1 || !await validOrchestratorDatabasePath(config.databasePath)) {
      return { status: "invalid", databasePath: null };
    }
    return { status: "configured", databasePath: config.databasePath };
  } catch {
    return { status: "invalid", databasePath: null };
  }
}

export async function resolveOrchestratorReader({
  environment = process.env,
  configPath = orchestratorReaderConfigPath(),
} = {}) {
  if (Object.hasOwn(environment, "NUYOAH_ORCHESTRATOR_DB")) {
    const databasePath = environment.NUYOAH_ORCHESTRATOR_DB;
    return await validOrchestratorDatabasePath(databasePath)
      ? { source: "environment", databasePath }
      : { source: "invalid_environment", databasePath: null };
  }
  const saved = await readOrchestratorReaderConfig(configPath);
  return {
    source: saved.status === "configured" ? "saved" : saved.status,
    databasePath: saved.databasePath,
  };
}

export async function saveOrchestratorReaderConfig(databasePath, configPath = orchestratorReaderConfigPath()) {
  if (!await validOrchestratorDatabasePath(databasePath)) {
    const error = new Error("Choose an absolute, readable SQLite database file.");
    error.code = "INVALID_DATABASE_PATH";
    throw error;
  }
  const directory = path.dirname(configPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(directory, `.${CONFIG_FILE}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify({ version: 1, databasePath })}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, configPath);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  return readOrchestratorReaderConfig(configPath);
}

export async function clearOrchestratorReaderConfig(configPath = orchestratorReaderConfigPath()) {
  try {
    await unlink(configPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
