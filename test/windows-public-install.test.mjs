import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const windowsOnly = { skip: process.platform !== "win32" };
const projectRoot = path.resolve(".");

test("Windows public installer creates a user-local runtime and login shortcuts", windowsOnly, async () => {
  const testRoot = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-windows-install-"));
  const installDir = path.join(testRoot, "install");
  const logsDir = path.join(testRoot, "logs");
  const startupDir = path.join(testRoot, "startup");
  const startMenuDir = path.join(testRoot, "start-menu");
  const sentinel = path.join(testRoot, "keep.txt");
  const env = {
    ...process.env,
    CODEX_SIDEBAR_SOURCE_DIR: projectRoot,
    CODEX_SIDEBAR_INSTALL_DIR: installDir,
    CODEX_SIDEBAR_LOGS_DIR: logsDir,
    CODEX_SIDEBAR_STARTUP_DIR: startupDir,
    CODEX_SIDEBAR_START_MENU_DIR: startMenuDir,
    CODEX_SIDEBAR_NODE: process.execPath,
    CODEX_SIDEBAR_SKIP_OPEN: "1",
  };
  try {
    await writeFile(sentinel, "preserve");
    const installed = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", "install.ps1",
    ], { cwd: projectRoot, encoding: "utf8", env });

    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /Codex Sidebar Enhancer installed for Windows/);
    await access(path.join(installDir, "scripts", "injector.mjs"));
    await access(path.join(installDir, "inject", "conversation-preview.user.js"));
    const config = JSON.parse(await readFile(path.join(installDir, "windows", "config.json"), "utf8"));
    assert.equal(path.resolve(config.nodePath), path.resolve(process.execPath));
    assert.equal(config.port, 9231);
    await access(path.join(startupDir, "Codex Sidebar Enhancer.lnk"));
    await access(path.join(startMenuDir, "Codex Sidebar Enhancer.lnk"));

    const removed = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", "uninstall.ps1",
    ], { cwd: projectRoot, encoding: "utf8", env });
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, /Codex Sidebar Enhancer uninstalled from Windows/);
    await assert.rejects(access(installDir));
    await assert.rejects(access(logsDir));
    await assert.rejects(access(path.join(startupDir, "Codex Sidebar Enhancer.lnk")));
    await assert.rejects(access(path.join(startMenuDir, "Codex Sidebar Enhancer.lnk")));
    assert.equal(await readFile(sentinel, "utf8"), "preserve");
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});
