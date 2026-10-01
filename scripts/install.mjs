#!/usr/bin/env node

import { createInstallPlan, LEGACY_TASKBOARD_LABELS } from "../lib/install-config.mjs";
import { access, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

function parseArgs(argv) {
  const options = { dryRun: false, activate: false, skipLaunchctl: false, launchctlPath: "launchctl" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--activate") options.activate = true;
    else if (argument === "--skip-launchctl") options.skipLaunchctl = true;
    else if (argument === "--home") options.home = argv[++index];
    else if (argument === "--install-dir") options.installDir = argv[++index];
    else if (argument === "--node-path") options.nodePath = argv[++index];
    else if (argument === "--port") options.port = Number(argv[++index]);
    else if (argument === "--launchctl-path") options.launchctlPath = argv[++index];
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const plan = createInstallPlan(options);

if (options.dryRun) {
  process.stdout.write(`${JSON.stringify(plan)}\n`);
} else if (options.activate) {
  await access(path.join(plan.installDir, "scripts", "runtime.mjs"));
  await access(path.join(plan.installDir, "vendor", "codex-taskboard", "dist", "web", "index.html"));
  await mkdir(plan.launchAgentsDir, { recursive: true });
  await mkdir(plan.logsDir, { recursive: true });
  await mkdir(path.dirname(plan.launcherPath), { recursive: true });
  await writeFile(plan.plistPath, plan.plist, { mode: 0o644 });
  await rm(plan.launcherPath, { recursive: true, force: true });
  const compiled = spawnSync("/usr/bin/osacompile", ["-o", plan.launcherPath, "-e", plan.launcherAppleScript], { encoding: "utf8" });
  if (compiled.status !== 0) throw new Error(compiled.stderr || "launcher compilation failed");
  const launcherInfoPath = path.join(plan.launcherContentsDir, "Info.plist");
  for (const [key, value] of [
    ["CFBundleIdentifier", "com.yubowen.codex-sidebar-enhancer.launcher"],
    ["CFBundleDisplayName", "Codex Sidebar Enhancer"],
    ["CFBundleName", "Codex Sidebar Enhancer"],
  ]) {
    const updated = spawnSync("/usr/bin/plutil", ["-replace", key, "-string", value, launcherInfoPath], { encoding: "utf8" });
    if (updated.status !== 0) throw new Error(updated.stderr || `launcher metadata update failed: ${key}`);
  }
  await mkdir(path.dirname(plan.launcherScriptPath), { recursive: true });
  await writeFile(plan.launcherScriptPath, plan.launcherScript, { mode: 0o755 });
  const signed = spawnSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", plan.launcherPath], { encoding: "utf8" });
  if (signed.status !== 0) throw new Error(signed.stderr || "launcher signing failed");
  const legacyPlistPath = path.join(plan.launchAgentsDir, "com.yubowen.codex-conversation-preview.plist");
  if (!options.skipLaunchctl) {
    const domain = `gui/${process.getuid()}`;
    const disabledLegacyLabels = [];
    for (const legacyLabel of LEGACY_TASKBOARD_LABELS) {
      const legacyPlistPath = path.join(plan.launchAgentsDir, `${legacyLabel}.plist`);
      try {
        await access(legacyPlistPath);
        spawnSync(options.launchctlPath, ["bootout", domain, legacyPlistPath], { stdio: "ignore" });
        const disabled = spawnSync(options.launchctlPath, ["disable", `${domain}/${legacyLabel}`], { encoding: "utf8" });
        if (disabled.status === 0) disabledLegacyLabels.push(legacyLabel);
      } catch {}
    }
    if (disabledLegacyLabels.length > 0) {
      await writeFile(plan.legacyCompatibilityMarker, `${disabledLegacyLabels.join("\n")}\n`, { mode: 0o600 });
    }
    spawnSync(options.launchctlPath, ["bootout", domain, plan.plistPath], { stdio: "ignore" });
    const loaded = spawnSync(options.launchctlPath, ["bootstrap", domain, plan.plistPath], { encoding: "utf8" });
    if (loaded.status !== 0) throw new Error(loaded.stderr || "launchctl bootstrap failed");
    const kicked = spawnSync(options.launchctlPath, ["kickstart", "-k", `${domain}/${plan.label}`], { encoding: "utf8" });
    if (kicked.status !== 0) throw new Error(kicked.stderr || "launchctl kickstart failed");
    spawnSync(options.launchctlPath, ["bootout", domain, legacyPlistPath], { stdio: "ignore" });
  }
  try { await unlink(legacyPlistPath); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  process.stdout.write(`${JSON.stringify({
    activated: true,
    launchctlSkipped: options.skipLaunchctl,
    label: plan.label,
    plistPath: plan.plistPath,
    logsDir: plan.logsDir,
    launcherPath: plan.launcherPath,
  })}\n`);
} else {
  throw new Error("Choose --dry-run or --activate");
}
