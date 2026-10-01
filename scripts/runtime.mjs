#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRuntimePlan } from "../lib/runtime-plan.mjs";
import { resolveLoopbackPort } from "../lib/runtime-port.mjs";
import { resolveOrchestratorReader } from "../lib/orchestrator-reader-config.mjs";
import { provisionAssetConsoleState } from "../lib/workspace-enhancements.mjs";

function parseArgs(argv) {
  const options = { port: 9231 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--watch") continue;
    if (arg === "--port") options.port = Number(argv[++index]);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error("Invalid port");
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let runtimeEnvironment = process.env;
if (!process.env.CODEX_SIDEBAR_TASKBOARD_DATA_DIR) {
  const legacyDataDir = path.join(os.homedir(), ".codex", "taskboard-data");
  try {
    await access(path.join(legacyDataDir, "taskboard.sqlite"));
    runtimeEnvironment = { ...process.env, CODEX_SIDEBAR_TASKBOARD_DATA_DIR: legacyDataDir };
  } catch {}
}
const preferredTaskboardPort = Number(process.env.CODEX_TASKBOARD_PORT || 47823);
const taskboardPort = await resolveLoopbackPort(preferredTaskboardPort);
const preferredAssetConsolePort = Number(process.env.CODEX_ASSET_CONSOLE_PORT || 5177);
const assetConsolePort = await resolveLoopbackPort(preferredAssetConsolePort);
runtimeEnvironment = { ...runtimeEnvironment, CODEX_ASSET_CONSOLE_PORT: String(assetConsolePort) };
const orchestratorReader = await resolveOrchestratorReader({ environment: runtimeEnvironment });
const plan = createRuntimePlan({
  root,
  port: options.port,
  taskboardPort,
  environment: runtimeEnvironment,
  orchestratorDatabasePath: orchestratorReader.databasePath,
});
const children = new Map();
const restartTimers = new Map();
let stopping = false;

for (const child of plan.children) await access(child.args[0]);
await access(path.join(plan.taskboardRoot, "dist", "web", "index.html"));
await access(plan.assetConsole.staticRoot);
await provisionAssetConsoleState(plan.assetConsole);
await mkdir(plan.taskboardDataDir, { recursive: true });
await writeFile(plan.taskboardRuntimeFile, `${JSON.stringify({
  managedBy: "codex-sidebar-enhancer",
  version: plan.children[1].env.CODEX_TASKBOARD_VERSION,
  url: `http://127.0.0.1:${taskboardPort}/`,
  pid: process.pid,
  startedAt: new Date().toISOString(),
}, null, 2)}\n`, { mode: 0o600 });

function start(definition) {
  if (stopping) return;
  const child = spawn(definition.command, definition.args, {
    cwd: definition.cwd,
    env: definition.env,
    stdio: "inherit",
  });
  children.set(definition.name, child);
  process.stdout.write(`[runtime] ${definition.name} started (${child.pid})\n`);
  child.once("error", (error) => {
    process.stderr.write(`[runtime] ${definition.name} error: ${error.message}\n`);
  });
  child.once("exit", (code, signal) => {
    if (children.get(definition.name) === child) children.delete(definition.name);
    if (stopping) return;
    process.stderr.write(`[runtime] ${definition.name} exited (${signal || code}); restarting\n`);
    const timer = setTimeout(() => {
      restartTimers.delete(definition.name);
      start(definition);
    }, 1_000);
    restartTimers.set(definition.name, timer);
  });
}

async function stop() {
  if (stopping) return;
  stopping = true;
  for (const timer of restartTimers.values()) clearTimeout(timer);
  restartTimers.clear();
  const exits = [];
  for (const child of children.values()) {
    exits.push(new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 3_000).unref?.();
    }));
  }
  await Promise.allSettled(exits);
  children.clear();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stop();
    process.exit(0);
  });
}

for (const definition of plan.children) start(definition);
process.stdout.write(`[runtime] Taskboard loopback port ${taskboardPort}\n`);
process.stdout.write(`[runtime] Asset Console loopback port ${assetConsolePort}\n`);
