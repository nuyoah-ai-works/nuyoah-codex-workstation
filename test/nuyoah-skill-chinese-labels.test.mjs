import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  SkillChineseLabelService,
  defaultSkillLabelCachePath,
  generateChineseSkillLabels,
  skillDescriptionHash,
  stableSkillLabelId,
  validChineseSkillLabel,
  validChineseSkillSummary,
} from "../nuyoah/skills/chinese-labels.mjs";

test("Skill label cache lives in user Application Support", () => {
  assert.equal(defaultSkillLabelCachePath({ platform: "darwin", homeDir: "/Users/demo" }),
    "/Users/demo/Library/Application Support/Nuyoah Codex Workstation/skill-copy-v2.json");
  assert.equal(defaultSkillLabelCachePath({ platform: "win32", homeDir: "C:\\Users\\demo", localAppData: "C:\\Users\\demo\\AppData\\Local", pathApi: path.win32 }),
    "C:\\Users\\demo\\AppData\\Local\\Nuyoah Codex Workstation\\skill-copy-v2.json");
});

test("summaries require Chinese and stay inside the locked 30 to 60 character boundary", () => {
  assert.equal(validChineseSkillSummary("读取本机创作资产并按名称、类型和用途整理，帮助用户快速找到可用于当前任务的内容"), true);
  assert.equal(validChineseSkillSummary("这段简介太短，无法说明完整用途"), false);
  assert.equal(validChineseSkillSummary("This summary is written only in English and should never be accepted as Chinese copy."), false);
});

test("labels require Chinese and stay inside the locked 12 to 28 character boundary", () => {
  assert.equal(validChineseSkillLabel("检索并整理本地视觉创作资产"), true);
  assert.equal(validChineseSkillLabel("太短"), false);
  assert.equal(validChineseSkillLabel("This label is only English"), false);
  assert.equal(validChineseSkillLabel("这是一个明显超过二十八个字符并且不应该被缓存为技能中文短标签的句子"), false);
});

test("Codex label generation is ephemeral, structured, read-only, and isolated from user rules", async () => {
  let invocation = null;
  let prompt = "";
  const spawnImpl = (executable, args, options) => {
    invocation = { executable, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => child.emit("exit", null, "SIGTERM");
    child.stdin = {
      end: (value) => {
        prompt = String(value || "");
        const outputPath = args[args.indexOf("--output-last-message") + 1];
        void writeFile(outputPath, JSON.stringify({
          labels: [{
            id: "skill-1234567890abcdef12345678",
            title: "检索并整理本地视觉创作资产",
            summary: "读取本机创作资产并按名称、类型和用途整理，帮助用户快速找到可用于当前任务的内容",
          }],
        })).then(() => child.emit("exit", 0, null));
      },
    };
    return child;
  };
  const result = await generateChineseSkillLabels([{
    id: "skill-1234567890abcdef12345678",
    name: "asset-search",
    description: "Search local creative assets",
  }], { codexPath: "/fixture/codex", spawnImpl });
  assert.equal(result[0].title, "检索并整理本地视觉创作资产");
  assert.match(result[0].summary, /当前任务/);
  assert.equal(invocation.executable, "/fixture/codex");
  assert.deepEqual(invocation.args.slice(0, 8), [
    "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--skip-git-repo-check", "--sandbox", "read-only",
  ]);
  assert.ok(invocation.args.includes('approval_policy="never"'));
  assert.ok(invocation.args.includes('web_search="disabled"'));
  assert.ok(invocation.args.includes('shell_environment_policy.inherit="none"'));
  const developerInstructions = invocation.args.find((value) => value.startsWith("developer_instructions="));
  assert.match(developerInstructions, /不可信数据/);
  assert.match(developerInstructions, /不得调用工具、Shell、网络或读取文件/);
  assert.match(developerInstructions, /少于 12 个字符无效/);
  assert.ok(invocation.args.includes("--output-schema"));
  assert.ok(invocation.args.includes("--output-last-message"));
  assert.equal(Object.hasOwn(invocation.options.env, "OPENAI_API_KEY"), false);
  assert.match(prompt, /asset-search/);
  assert.match(prompt, /Search local creative assets/);
  assert.doesNotMatch(prompt, /不得调用工具/);
});

test("generation keeps partial successes, caches no source descriptions, and only retries missing or changed entries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuyoah-label-test-"));
  const cachePath = path.join(root, "labels.json");
  const firstCatalog = [
    { name: "asset-search", title: "asset-search", description: "Search and organize local creative assets", source: "runtime", scope: "user", path: "/fixture/skills/asset-search" },
    { name: "grill-me", title: "grill-me", description: "持续追问用户的方案与决策", source: "runtime", scope: "user", path: "/fixture/skills/grill-me" },
  ];
  const calls = [];
  const service = new SkillChineseLabelService({
    cachePath,
    now: () => new Date("2026-09-02T00:00:00.000Z"),
    generator: async (entries) => {
      calls.push(entries);
      if (calls.length === 1) return [{
        id: entries[0].id,
        title: "检索并整理本地视觉创作资产",
        summary: "读取本机创作资产并按名称、类型和用途整理，帮助用户快速找到可用于当前任务的内容",
      }];
      return entries.map((entry) => ({
        id: entry.id,
        title: entry.name === "asset-search" ? "查找并归整本地视觉素材资产" : "持续追问并检验用户方案决策",
        summary: entry.name === "asset-search"
          ? "查找、标记并整理本机创作素材，让当前任务可以快速引用准确的原始资产内容"
          : "围绕用户提出的方案持续追问关键假设，帮助发现风险、矛盾和仍需补充的决策依据",
      }));
    },
  });

  const initial = await service.decorate(firstCatalog);
  assert.deepEqual(initial.map((entry) => entry.description), ["待生成", "待生成"]);
  assert.deepEqual(initial.map((entry) => entry.summary), ["待生成中文简介", "待生成中文简介"]);
  assert.deepEqual(initial.map((entry) => entry.sourceDescription), firstCatalog.map((entry) => entry.description));
  assert.deepEqual(initial.map((entry) => entry.labelStatus), ["pending", "pending"]);

  assert.deepEqual(await service.generate(firstCatalog, { mode: "missing" }), { requested: 2, generated: 1, failed: 1 });
  const partial = await service.decorate(firstCatalog);
  assert.deepEqual(partial.map((entry) => entry.description), ["检索并整理本地视觉创作资产", "待生成"]);
  assert.match(partial[0].summary, /当前任务/);
  const persisted = await readFile(cachePath, "utf8");
  assert.doesNotMatch(persisted, /Search and organize|持续追问用户/);
  assert.doesNotMatch(persisted, /fixture\/skills/);

  const changedCatalog = [
    { ...firstCatalog[0], description: "Search, tag, and organize creative assets" },
    firstCatalog[1],
  ];
  const invalidated = await service.decorate(changedCatalog);
  assert.deepEqual(invalidated.map((entry) => entry.description), ["待生成", "待生成"]);
  assert.deepEqual(await service.generate(changedCatalog, { mode: "missing" }), { requested: 2, generated: 2, failed: 0 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].map((entry) => entry.id), changedCatalog.map(stableSkillLabelId));

  const ready = await service.decorate(changedCatalog);
  assert.deepEqual(ready.map((entry) => entry.labelStatus), ["ready", "ready"]);
  assert.deepEqual(await service.generate(changedCatalog, { mode: "missing" }), { requested: 0, generated: 0, failed: 0 });
  assert.equal(calls.length, 2);

  await rm(root, { recursive: true, force: true });
});

test("legacy titles survive migration and only the changed Skill regenerates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuyoah-label-migration-test-"));
  const cachePath = path.join(root, "skill-copy-v2.json");
  const legacyCachePath = path.join(root, "skill-labels-v1.json");
  const catalog = [
    { name: "one", description: "First callable Skill", source: "runtime", scope: "system" },
    { name: "two", description: "Second callable Skill", source: "runtime", scope: "system" },
  ];
  await writeFile(legacyCachePath, JSON.stringify({
    schemaVersion: 1,
    labels: Object.fromEntries(catalog.map((entry, index) => [stableSkillLabelId(entry), {
      descriptionHash: skillDescriptionHash(entry),
      label: index ? "处理第二项可调用技能任务" : "处理第一项可调用技能任务",
      updatedAt: "2026-09-02T00:00:00.000Z",
    }])),
  }));
  const batches = [];
  const service = new SkillChineseLabelService({
    cachePath,
    legacyCachePath,
    generator: async (entries) => {
      batches.push(entries.map((entry) => entry.id));
      return entries.map((entry) => ({
        id: entry.id,
        title: entry.name === "one" ? "处理第一项可调用技能任务" : "处理第二项可调用技能任务",
        summary: entry.name === "one"
          ? "处理第一项当前可调用技能的核心用途，并提供清晰准确的中文说明供任务选择使用"
          : "处理第二项当前可调用技能的核心用途，并提供清晰准确的中文说明供任务选择使用",
      }));
    },
  });

  const migrated = await service.decorate(catalog);
  assert.deepEqual(migrated.map((entry) => entry.description), ["处理第一项可调用技能任务", "处理第二项可调用技能任务"]);
  assert.deepEqual(migrated.map((entry) => entry.labelStatus), ["pending", "pending"]);
  await service.generate(catalog, { mode: "missing" });

  const changedCatalog = [{ ...catalog[0], description: "Updated first callable Skill" }, catalog[1]];
  const afterChange = await service.decorate(changedCatalog);
  assert.deepEqual(afterChange.map((entry) => entry.labelStatus), ["pending", "ready"]);
  assert.equal(afterChange[1].description, "处理第二项可调用技能任务");
  await service.generate(changedCatalog, { mode: "missing" });
  assert.deepEqual(batches.map((batch) => batch.length), [2, 1]);
  assert.deepEqual(batches[1], [stableSkillLabelId(changedCatalog[0])]);

  await rm(root, { recursive: true, force: true });
});

test("plugin cache survives a versioned path change", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuyoah-plugin-label-test-"));
  const cachePath = path.join(root, "skill-copy-v2.json");
  const plugin = {
    id: "plugin|demo-plugin@openai|plugin-skill",
    name: "plugin-skill",
    description: "A callable plugin Skill",
    source: "runtime",
    scope: "plugin",
    path: "/plugins/demo-plugin/1.0.0/skills/plugin-skill",
  };
  await writeFile(cachePath, JSON.stringify({
    schemaVersion: 2,
    labels: {
      [stableSkillLabelId({ ...plugin, id: "" })]: {
        descriptionHash: skillDescriptionHash(plugin),
        title: "处理插件提供的可调用技能任务",
        summary: "处理插件提供的当前可调用技能核心用途，并保持版本更新前后的中文标题与简介稳定可用",
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    },
  }));
  const service = new SkillChineseLabelService({ cachePath });

  assert.equal((await service.decorate([plugin]))[0].labelStatus, "ready");
  const upgraded = { ...plugin, path: "/plugins/demo-plugin/2.0.0/skills/plugin-skill" };
  const afterUpgrade = await service.decorate([upgraded]);
  assert.equal(afterUpgrade[0].labelStatus, "ready");
  assert.equal(afterUpgrade[0].description, "处理插件提供的可调用技能任务");
  assert.equal(Object.keys(JSON.parse(await readFile(cachePath, "utf8")).labels).length, 1);

  await rm(root, { recursive: true, force: true });
});

test("single and all requests regenerate the requested scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuyoah-label-scope-test-"));
  const cachePath = path.join(root, "labels.json");
  const catalog = [
    { name: "one", description: "First callable Skill", source: "runtime", scope: "system" },
    { name: "two", description: "Second callable Skill", source: "runtime", scope: "system" },
  ];
  const batches = [];
  const service = new SkillChineseLabelService({
    cachePath,
    generator: async (entries) => {
      batches.push(entries.map((entry) => entry.id));
      return entries.map((entry, index) => ({
        id: entry.id,
        title: index ? "处理第二项可调用技能任务" : "处理第一项可调用技能任务",
        summary: index
          ? "处理第二项当前可调用技能的核心用途，并提供清晰准确的中文说明供任务选择使用"
          : "处理第一项当前可调用技能的核心用途，并提供清晰准确的中文说明供任务选择使用",
      }));
    },
  });
  await service.generate(catalog, { mode: "all" });
  await service.generate(catalog, { mode: "single", id: stableSkillLabelId(catalog[1]) });
  assert.deepEqual(batches.map((batch) => batch.length), [2, 1]);
  assert.deepEqual(batches[1], [stableSkillLabelId(catalog[1])]);
  await rm(root, { recursive: true, force: true });
});

test("fallback discovery is displayed as unverified and cannot start generation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nuyoah-label-fallback-test-"));
  let called = false;
  const catalog = [{ name: "fallback", description: "Unverified cached Skill", source: "fallback" }];
  const service = new SkillChineseLabelService({
    cachePath: path.join(root, "labels.json"),
    generator: async () => { called = true; return []; },
  });
  const decorated = await service.decorate(catalog);
  assert.equal(decorated[0].description, "清单待验证");
  assert.equal(decorated[0].sourceDescription, "Unverified cached Skill");
  assert.equal(decorated[0].labelStatus, "unverified");
  assert.deepEqual(await service.generate(catalog, { mode: "missing" }), { requested: 0, generated: 0, failed: 0 });
  assert.equal(called, false);
  await rm(root, { recursive: true, force: true });
});
