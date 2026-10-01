import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test('public installers default to the Nuyoah repository rather than the upstream package', async () => {
  const root = new URL('../', import.meta.url);
  const mac = await readFile(new URL('install.sh', root), 'utf8');
  const windows = await readFile(new URL('install.ps1', root), 'utf8');
  assert.match(mac, /CODEX_SIDEBAR_REPOSITORY:-nuyoah-ai-works\/nuyoah-codex-workstation/);
  assert.match(windows, /"CODEX_SIDEBAR_REPOSITORY" "nuyoah-ai-works\/nuyoah-codex-workstation"/);
});

const projectRoot = path.resolve(".");
const macOnly = { skip: process.platform !== "darwin" };

test("public installer copies a portable runtime and activates it under the current user", macOnly, async () => {
  const testHome = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-public-install-"));
  const installDir = path.join(testHome, "Library", "Application Support", "Codex Sidebar Enhancer");
  try {
    const result = spawnSync("/bin/bash", ["install.sh"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: testHome,
        CODEX_SIDEBAR_SOURCE_DIR: projectRoot,
        CODEX_SIDEBAR_INSTALL_DIR: installDir,
        CODEX_SIDEBAR_NODE: process.execPath,
        CODEX_SIDEBAR_SKIP_LAUNCHCTL: "1",
        CODEX_SIDEBAR_SKIP_OPEN: "1",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Codex Sidebar Enhancer installed/);
    await access(path.join(installDir, "scripts", "injector.mjs"));
    await access(path.join(installDir, "scripts", "runtime.mjs"));
    await access(path.join(installDir, "inject", "conversation-preview.user.js"));
    await access(path.join(installDir, "vendor", "codex-taskboard", "dist", "web", "index.html"));
    await access(path.join(installDir, "vendor", "codex-taskboard", "server", "index.mjs"));
    await access(path.join(installDir, "vendor", "codex-taskboard", "inject", "codex-taskboard.user.js"));
    const taskboardManifest = JSON.parse(await readFile(
      path.join(installDir, "vendor", "codex-taskboard", "VERSION.json"),
      "utf8",
    ));
    assert.equal(taskboardManifest.version, "0.2.0-codexoptimiz.20260831");
    assert.equal(taskboardManifest.snapshotSource, "custom-working-tree-2026-08-31");
    const publicRuntime = [
      await readFile(path.join(installDir, "scripts", "injector.mjs"), "utf8"),
      await readFile(path.join(installDir, "inject", "conversation-preview.user.js"), "utf8"),
    ].join("\n");
    assert.doesNotMatch(publicRuntime, /dz-ailab\.dzkjm\.cn|__codexTvHostV1|TV_SHORTCUT_URL/,
      "The public installer must not ship the private TV entry or its fixed service URL");
    assert.match(publicRuntime, /HIDDEN_SHORTCUT_NAMES = new Set\(\["项目管理"\]\)/,
      "The public UI must replace the separate project-management shortcut with the workstation");
    assert.match(publicRuntime, /id:\s*"workstation", name:\s*"工作站"/,
      "The installed runtime must expose the unified workstation entry");
    const plistPath = path.join(testHome, "Library", "LaunchAgents", "com.yubowen.codex-sidebar-enhancer.plist");
    const plist = await readFile(plistPath, "utf8");
    assert.match(plist, new RegExp(installDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(plist, /scripts\/runtime\.mjs/);
    assert.doesNotMatch(plist, /\/Users\/yubowen/);
    await assert.rejects(access(path.join(installDir, ".git")));
    await assert.rejects(access(path.join(installDir, "codex-folder-switcher-verification.png")));
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
});

test("public uninstaller removes only the installed runtime, LaunchAgent, launcher, and logs", macOnly, async () => {
  const testHome = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-public-uninstall-"));
  const installDir = path.join(testHome, "Library", "Application Support", "Codex Sidebar Enhancer");
  const sharedEnv = {
    ...process.env,
    HOME: testHome,
    CODEX_SIDEBAR_SOURCE_DIR: projectRoot,
    CODEX_SIDEBAR_INSTALL_DIR: installDir,
    CODEX_SIDEBAR_NODE: process.execPath,
    CODEX_SIDEBAR_SKIP_LAUNCHCTL: "1",
    CODEX_SIDEBAR_SKIP_OPEN: "1",
  };
  try {
    const installed = spawnSync("/bin/bash", ["install.sh"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: sharedEnv,
    });
    assert.equal(installed.status, 0, installed.stderr);

    const removed = spawnSync("/bin/bash", ["uninstall.sh"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: sharedEnv,
    });
    assert.equal(removed.status, 0, removed.stderr);
    assert.match(removed.stdout, /Codex Sidebar Enhancer uninstalled/);
    await assert.rejects(access(installDir));
    await assert.rejects(access(path.join(testHome, "Library", "LaunchAgents", "com.yubowen.codex-sidebar-enhancer.plist")));
    await assert.rejects(access(path.join(testHome, "Applications", "Codex Sidebar Enhancer.app")));
    await assert.rejects(access(path.join(testHome, "Library", "Logs", "CodexSidebarEnhancer")));
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
});
