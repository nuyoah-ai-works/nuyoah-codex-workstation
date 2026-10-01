import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import test from "node:test";

import {
  findBundledCodex,
  parseRuntimeSkillResponse,
  readPreferredSkillCatalog,
} from "../nuyoah/skills/runtime-catalog.mjs";

test("bundled Codex discovery supports the current macOS app layout", async (t) => {
  const candidates = [
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    "/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  ];
  let installed = "";
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      installed = candidate;
      break;
    } catch {}
  }
  if (!installed) return t.skip("Current macOS Codex bundle is not installed");
  assert.equal(await findBundledCodex(), installed);
});

test("runtime skills/list is authoritative and keeps callable symlink entries", () => {
  const cwd = "/Users/demo/project";
  const catalog = parseRuntimeSkillResponse({
    id: 2,
    result: {
      data: [{
        cwd,
        errors: [],
        skills: [
          {
            name: "demo-skill",
            description: "A callable personal Skill",
            interface: { displayName: "Demo Skill" },
            enabled: true,
            scope: "user",
            path: "/Users/demo/.codex/skills/demo-skill/SKILL.md",
          },
          {
            name: "disabled-skill",
            description: "Not callable",
            enabled: false,
            scope: "user",
            path: "/Users/demo/.codex/skills/disabled/SKILL.md",
          },
          {
            name: "plugin-skill",
            description: "A callable plugin Skill",
            enabled: true,
            scope: "user",
            pluginId: "demo-plugin@openai",
            path: "/Users/demo/.codex/plugins/cache/demo-plugin/2.0.0/skills/plugin-skill/SKILL.md",
          },
        ],
      }],
    },
  }, cwd);
  assert.deepEqual(catalog, [{
    name: "demo-skill",
    title: "Demo Skill",
    description: "A callable personal Skill",
    path: "/Users/demo/.codex/skills/demo-skill",
    mentionPath: "/Users/demo/.codex/skills/demo-skill/SKILL.md",
    source: "runtime",
    scope: "user",
  }, {
    id: "plugin|demo-plugin@openai|plugin-skill",
    name: "plugin-skill",
    title: "plugin-skill",
    description: "A callable plugin Skill",
    path: "/Users/demo/.codex/plugins/cache/demo-plugin/2.0.0/skills/plugin-skill",
    mentionPath: "/Users/demo/.codex/plugins/cache/demo-plugin/2.0.0/skills/plugin-skill/SKILL.md",
    source: "runtime",
    scope: "plugin",
  }]);
});

test("runtime catalog rejects a response for another workspace", () => {
  assert.throws(() => parseRuntimeSkillResponse({
    id: 2,
    result: { data: [{ cwd: "/wrong", errors: [], skills: [] }] },
  }, "/expected"), /Unexpected skills\/list workspace/);
});

test("directory scanning is used only when runtime discovery is unavailable", async () => {
  const fallback = [{ name: "fallback" }];
  assert.deepEqual(await readPreferredSkillCatalog({
    cwd: "/project",
    runtimeReader: async () => [{ name: "runtime" }],
    fallback: async () => fallback,
  }), [{ name: "runtime" }]);
  assert.deepEqual(await readPreferredSkillCatalog({
    cwd: "/project",
    runtimeReader: async () => { throw new Error("offline"); },
    fallback: async () => fallback,
  }), [{ name: "fallback", source: "fallback" }]);
});
