import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const macOnly = { skip: process.platform !== "darwin" };

test("installer dry-run renders portable user paths and XML-safe launch configuration", macOnly, async () => {
  const testHome = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-home-"));
  const installDir = path.join(testHome, "Library", "Application Support", "Codex & Sidebar");
  try {
    const result = spawnSync(process.execPath, [
      "scripts/install.mjs",
      "--dry-run",
      "--home", testHome,
      "--install-dir", installDir,
      "--node-path", process.execPath,
    ], { cwd: path.resolve("."), encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.installDir, installDir);
    assert.equal(plan.port, 9231);
    assert.equal(plan.label, "com.yubowen.codex-sidebar-enhancer");
    assert.equal(plan.plistPath, path.join(testHome, "Library", "LaunchAgents", `${plan.label}.plist`));
    assert.match(plan.plist, /Codex &amp; Sidebar/);
    assert.doesNotMatch(plan.plist, /\/Users\/yubowen/);
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
});

test("installer activation writes a loadable user LaunchAgent without invoking launchctl in test mode", macOnly, async () => {
  const testHome = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-activate-"));
  try {
    const launchAgentsDir = path.join(testHome, "Library", "LaunchAgents");
    const legacyPlistPath = path.join(launchAgentsDir, "com.yubowen.codex-conversation-preview.plist");
    await mkdir(launchAgentsDir, { recursive: true });
    await writeFile(legacyPlistPath, "legacy");
    const result = spawnSync(process.execPath, [
      "scripts/install.mjs",
      "--activate",
      "--skip-launchctl",
      "--home", testHome,
      "--install-dir", path.resolve("."),
      "--node-path", process.execPath,
    ], { cwd: path.resolve("."), encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const activation = JSON.parse(result.stdout);
    assert.equal(activation.activated, true);
    assert.equal(activation.launchctlSkipped, true);
    const plist = await readFile(activation.plistPath, "utf8");
    assert.match(plist, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(plist, /scripts\/runtime\.mjs/);
    assert.equal(activation.launcherPath, path.join(testHome, "Applications", "Codex Sidebar Enhancer.app"));
    await access(path.join(activation.launcherPath, "Contents", "Info.plist"));
    const launcherExecutable = path.join(activation.launcherPath, "Contents", "MacOS", "applet");
    const launcherScript = path.join(activation.launcherPath, "Contents", "Resources", "launcher.sh");
    const launcherSource = await readFile(launcherScript, "utf8");
    assert.match(launcherSource, /PORT=9231/);
    assert.match(launcherSource, /--remote-debugging-port=\$\{PORT\}/);
    assert.match(
      launcherSource,
      /--enable-features=LocalNetworkAccessForSubframeNavigationsWarningOnly/,
    );
    assert.ok((await stat(launcherExecutable)).mode & 0o100, "launcher must be executable by its owner");
    const verified = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", activation.launcherPath], { encoding: "utf8" });
    assert.equal(verified.status, 0, verified.stderr);
    const bundleId = spawnSync("/usr/bin/defaults", ["read", path.join(activation.launcherPath, "Contents", "Info"), "CFBundleIdentifier"], { encoding: "utf8" });
    assert.equal(bundleId.stdout.trim(), "com.yubowen.codex-sidebar-enhancer.launcher");
    await assert.rejects(access(legacyPlistPath));
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
});

test("installer explicitly kickstarts the registered LaunchAgent after bootstrap", macOnly, async () => {
  const testHome = await mkdtemp(path.join(os.tmpdir(), "codex-sidebar-kickstart-"));
  const fakeLaunchctl = path.join(testHome, "launchctl");
  const launchctlLog = path.join(testHome, "launchctl.log");
  try {
    await writeFile(fakeLaunchctl, "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$CODEX_TEST_LAUNCHCTL_LOG\"\n", { mode: 0o755 });
    const result = spawnSync(process.execPath, [
      "scripts/install.mjs",
      "--activate",
      "--home", testHome,
      "--install-dir", path.resolve("."),
      "--node-path", process.execPath,
      "--launchctl-path", fakeLaunchctl,
    ], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: { ...process.env, CODEX_TEST_LAUNCHCTL_LOG: launchctlLog },
    });

    assert.equal(result.status, 0, result.stderr);
    const commands = (await readFile(launchctlLog, "utf8")).trim().split("\n");
    assert.ok(commands.some((command) => command.startsWith("bootstrap gui/")));
    assert.ok(commands.some((command) => command === `kickstart -k gui/${process.getuid()}/com.yubowen.codex-sidebar-enhancer`));
  } finally {
    await rm(testHome, { recursive: true, force: true });
  }
});
