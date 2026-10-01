import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readInstalledSkillCatalog } from "../lib/skill-catalog.mjs";

test("installed Skill catalog reads metadata and prefers the first root", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "codex-skill-catalog-"));
  const primary = path.join(fixture, "primary");
  const fallback = path.join(fixture, "fallback");
  try {
    await mkdir(path.join(primary, "demo", "agents"), { recursive: true });
    await mkdir(path.join(fallback, "demo"), { recursive: true });
    await writeFile(path.join(primary, "demo", "SKILL.md"), "---\nname: demo\ndescription: Search local assets\n---\n");
    await writeFile(path.join(primary, "demo", "agents", "openai.yaml"), "interface:\n  display_name: 本地资产检索\n");
    await writeFile(path.join(fallback, "demo", "SKILL.md"), "---\nname: demo\ndescription: fallback\n---\n");

    const catalog = await readInstalledSkillCatalog({ roots: [primary, fallback] });
    assert.deepEqual(catalog, [{
      name: "demo",
      title: "本地资产检索",
      description: "Search local assets",
      path: path.join(primary, "demo"),
      mentionPath: path.join(primary, "demo", "SKILL.md"),
    }]);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
