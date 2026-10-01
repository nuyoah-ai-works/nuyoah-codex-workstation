#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRuntimePlan } from "../lib/runtime-plan.mjs";
import { TASKBOARD_VERSION } from "../lib/runtime-plan.mjs";
import { trustedTaskboardRuntimeBaseUrl } from "../lib/taskboard-status.mjs";

function parseArgs(argv) {
  const options = { json: false, port: 9231 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--port") options.port = Number(argv[++index]);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error("Invalid port");
  }
  return options;
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(700) });
    return response.ok;
  } catch {
    return false;
  }
}

const options = parseArgs(process.argv.slice(2));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePlan = createRuntimePlan({ root, port: options.port });
const manifestPath = path.join(root, "vendor", "codex-taskboard", "VERSION.json");
const required = [
  path.join(root, "scripts", "runtime.mjs"),
  path.join(root, "scripts", "work-items.mjs"),
  path.join(root, "nuyoah", "workstation", "work-items-store.mjs"),
  path.join(root, "nuyoah", "workstation", "work-items-ui.js"),
  path.join(root, "nuyoah", "workstation", "work-canvas.js"),
  path.join(root, "nuyoah", "workstation", "task-map-ui.js"),
  path.join(root, "nuyoah", "workstation", "multi-chat-native.mjs"),
  path.join(root, "nuyoah", "workstation", "multi-chat-ui.mjs"),
  path.join(root, "nuyoah", "workstation", "task-relations.mjs"),
  path.join(root, "inject", "conversation-preview.user.js"),
  path.join(root, "nuyoah", "workstation", "cold-history.mjs"),
  path.join(root, "scripts", "register-cold-history.mjs"),
  path.join(root, "vendor", "codex-thread-cold-history", "scripts", "cold_history.py"),
  path.join(root, "vendor", "codex-taskboard", "scripts", "codex-injector.mjs"),
  path.join(root, "vendor", "codex-taskboard", "dist", "web", "index.html"),
  runtimePlan.assetConsole.serverPath,
  path.join(runtimePlan.assetConsole.staticRoot, "index.html"),
  path.join(runtimePlan.assetConsole.staticRoot, "app.js"),
  path.join(runtimePlan.assetConsole.staticRoot, "ui-v3.css"),
];
const missing = [];
for (const file of required) {
  try { await access(file); } catch { missing.push(path.relative(root, file)); }
}
let manifest = null;
try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch { missing.push(path.relative(root, manifestPath)); }
const [major, minor] = process.versions.node.split(".").map(Number);
let runtimeFile = process.env.CODEX_SIDEBAR_TASKBOARD_RUNTIME_FILE || runtimePlan.taskboardRuntimeFile;
let runtimeUrl = null;
const runtimeCandidates = process.env.CODEX_SIDEBAR_TASKBOARD_RUNTIME_FILE
  ? [runtimeFile]
  : [runtimeFile, path.join(process.env.HOME || "", ".codex", "taskboard-data", "runtime.json")];
let firstTrustedRuntime = null;
for (const candidate of runtimeCandidates) {
  try {
    const descriptor = JSON.parse(await readFile(candidate, "utf8"));
    const baseUrl = trustedTaskboardRuntimeBaseUrl(descriptor);
    if (baseUrl) {
      const trustedRuntime = { file: candidate, url: new URL(`${baseUrl}/`) };
      const managedByCurrentPackage = descriptor?.managedBy === "codex-sidebar-enhancer"
        && descriptor?.version === TASKBOARD_VERSION;
      if (!firstTrustedRuntime || managedByCurrentPackage) firstTrustedRuntime = trustedRuntime;
      if (await reachable(`${baseUrl}/health`)) {
        runtimeUrl = trustedRuntime.url;
        runtimeFile = trustedRuntime.file;
        break;
      }
    }
  } catch {}
}
if (!runtimeUrl && firstTrustedRuntime) {
  runtimeUrl = firstTrustedRuntime.url;
  runtimeFile = firstTrustedRuntime.file;
}
const taskboardPort = runtimeUrl ? Number(runtimeUrl.port) : Number(process.env.CODEX_TASKBOARD_PORT || 47823);
const taskboardCheckUrl = runtimeUrl
  ? `${runtimeUrl.href.replace(/\/$/, "")}/api/meta`
  : `http://127.0.0.1:${taskboardPort}/health`;
const report = {
  package: {
    ready: missing.length === 0 && manifest?.version === TASKBOARD_VERSION,
    taskboardVersion: manifest?.version || null,
    taskboardCommit: manifest?.baseCommit || manifest?.commit || null,
    missing,
  },
  node: {
    version: process.versions.node,
    supported: major > 22 || (major === 22 && minor >= 5),
  },
  codex: {
    port: options.port,
    reachable: await reachable(`http://127.0.0.1:${options.port}/json/version`),
  },
  taskboard: {
    port: taskboardPort,
    runtimeFile,
    reachable: await reachable(taskboardCheckUrl),
  },
  assetConsole: {
    port: runtimePlan.assetConsole.port,
    packaged: required.slice(-4).every((file) => !missing.includes(path.relative(root, file))),
    reachable: await reachable(`http://127.0.0.1:${runtimePlan.assetConsole.port}/`),
  },
};

if (options.json) process.stdout.write(`${JSON.stringify(report)}\n`);
else {
  process.stdout.write(`Package: ${report.package.ready ? "ready" : "incomplete"}\n`);
  process.stdout.write(`Taskboard: ${report.package.taskboardVersion || "missing"} (${report.taskboard.reachable ? "running" : "stopped"})\n`);
  process.stdout.write(`Codex CDP: ${report.codex.reachable ? "reachable" : "not running"}\n`);
  process.stdout.write(`Asset Console: ${report.assetConsole.packaged ? "packaged" : "missing"} (${report.assetConsole.reachable ? "running" : "stopped"})\n`);
  process.stdout.write(`Node.js: ${report.node.version} (${report.node.supported ? "supported" : "unsupported"})\n`);
  if (missing.length) process.stdout.write(`Missing: ${missing.join(", ")}\n`);
}
if (!report.package.ready || !report.node.supported) process.exitCode = 1;
