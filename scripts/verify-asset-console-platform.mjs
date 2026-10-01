#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(root, "vendor", "codex-workspace-enhancer", "asset-browser", "server.js");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codex-asset-platform-"));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
const port = await freePort();
const token = "asset-console-platform-verification-token-00000001";
const tokenPath = path.join(temporaryRoot, "token");
const configPath = path.join(temporaryRoot, "config.json");
const projectPath = path.join(temporaryRoot, "macOS image project");
await mkdir(path.join(projectPath, "images"), { recursive: true });
await mkdir(path.join(projectPath, "references"), { recursive: true });
await writeFile(path.join(projectPath, "images", "shot-a.png"), "fixture");
await writeFile(path.join(projectPath, "references", "shot-b.heic"), "fixture");
await writeFile(tokenPath, token);

const child = spawn(process.execPath, [serverPath], {
  env: {
    ...process.env,
    PORT: String(port),
    ASSET_BROWSER_TOKEN_FILE: tokenPath,
    ASSET_BROWSER_CONFIG: configPath,
    ASSET_BROWSER_LEDGER: path.join(temporaryRoot, "ledger.json"),
    GENERATION_TICKETS: path.join(temporaryRoot, "generation.json"),
    GENERATION_THREAD_BINDINGS: path.join(temporaryRoot, "bindings.json"),
    DUPLICATE_CLEANUP_LEDGER: path.join(temporaryRoot, "duplicates.json"),
    DUPLICATE_QUARANTINE: path.join(temporaryRoot, "quarantine"),
    RHYTHM_CONTROL_REGISTRY: path.join(temporaryRoot, "rhythm.json"),
    PROMPT_LIBRARY_ROOT: path.join(temporaryRoot, "prompts"),
    THREE_D_TASKS: path.join(temporaryRoot, "three-d.json"),
    ASSET_ACTION_TRASH: path.join(temporaryRoot, "trash"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });

async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-asset-console-token": token,
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${response.status}`);
  return data;
}

try {
  let config = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { config = await request("/api/config"); break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(config, `Asset service did not start: ${logs}`);
  assert.equal(config.system.platform, process.platform);
  assert.equal(config.system.name, process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux");

  const created = await request("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "Cross-platform image scan",
      path: projectPath,
      scanRoots: ["images", "references", "images", "../outside"],
    }),
  });
  assert.deepEqual(created.project.scanRoots, ["images", "references"]);

  const cases = await request(`/api/cases?project=${encodeURIComponent(created.project.id)}`);
  assert.deepEqual(new Set(cases.cases.map((item) => item.scanRoot)), new Set(["images", "references"]));

  const assets = [];
  for (const item of cases.cases) {
    const data = await request(`/api/assets?project=${encodeURIComponent(created.project.id)}&case=${encodeURIComponent(item.id)}`);
    assets.push(...data.assets);
  }
  assert.deepEqual(new Set(assets.map((item) => item.name)), new Set(["shot-a.png", "shot-b.heic"]));
  assert.ok(assets.every((item) => item.kind === "image"));

  process.stdout.write(`${JSON.stringify({
    platform: config.system,
    projectPath,
    scanRoots: created.project.scanRoots,
    images: assets.map((item) => ({ name: item.name, path: item.relPath, kind: item.kind })),
  }, null, 2)}\n`);
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  await rm(temporaryRoot, { recursive: true, force: true });
}
