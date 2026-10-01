import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

test("public package contains every managed runtime and excludes local-only output", () => {
  const result = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  }))[0];
  const files = new Set(result.files.map((entry) => entry.path));
  const taskboardIndex = readFileSync(path.join(root, "vendor/codex-taskboard/dist/web/index.html"), "utf8");
  const taskboardEntry = taskboardIndex.match(/src="(?:\.\/|\/)assets\/([^"]+\.js)"/)?.[1];
  assert.ok(taskboardEntry, "built Taskboard entry script must be referenced by index.html");
  const required = [
    "inject/conversation-preview.user.js",
    "nuyoah/skills/runtime-catalog.mjs",
    "nuyoah/assets/server.mjs",
    "nuyoah/assets/catalog.mjs",
    "nuyoah/assets/previews.mjs",
    "nuyoah/assets/public/index.html",
    "nuyoah/assets/public/app.js",
    "nuyoah/assets/public/asset-ui.js",
    "nuyoah/assets/public/ui-v3.css",
    "lib/orchestrator-reader-config.mjs",
    "scripts/configure-orchestrator-reader.mjs",
    "scripts/runtime.mjs",
    "vendor/codex-taskboard/VERSION.json",
    "vendor/codex-taskboard/dist/web/index.html",
    `vendor/codex-taskboard/dist/web/assets/${taskboardEntry}`,
    "vendor/codex-workspace-enhancer/asset-browser/asset-library-filter.js",
    "vendor/codex-workspace-enhancer/asset-browser/image-dimensions.js",
    "vendor/codex-workspace-enhancer/asset-browser/asset-scan-coordinator.js",
    "vendor/codex-workspace-enhancer/asset-browser/persistent-asset-index.js",
    "vendor/codex-workspace-enhancer/asset-browser/codex-prompt-associations.js",
    "vendor/codex-workspace-enhancer/asset-browser/codex-production-project-sync.js",
    "vendor/codex-workspace-enhancer/asset-browser/server.js",
    "vendor/codex-workspace-enhancer/asset-console/public/index.html",
    "vendor/codex-workspace-enhancer/asset-console/public/asset-metadata-ui.js",
    "install.sh",
    "install.ps1",
    "uninstall.sh",
    "uninstall.ps1",
  ];

  assert.deepEqual(required.filter((entry) => !files.has(entry)), []);
  assert.equal([...files].some((entry) => entry.startsWith("output/")), false);
  assert.equal([...files].some((entry) => entry.includes("node_modules/")), false);
});
