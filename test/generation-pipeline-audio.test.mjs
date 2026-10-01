import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GenerationPipeline } from "../vendor/codex-workspace-enhancer/asset-browser/generation-pipeline.js";

test("generation pipeline archives audio with the same prompt sidecars as image and video", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-generation-audio-"));
  try {
    const projectRoot = path.join(root, "project");
    await mkdir(projectRoot);
    const sourcePath = path.join(root, "voice.wav");
    await writeFile(sourcePath, "audio");
    const pipeline = new GenerationPipeline({
      registryPath: path.join(root, "tickets.json"),
      bindingsPath: path.join(root, "bindings.json"),
    });
    const config = {
      projects: [{ id: "project", name: "Project", path: projectRoot, folders: [projectRoot] }],
      automation: { routing: { profiles: [] } },
    };
    const ticket = await pipeline.create({
      projectId: "project",
      kind: "audio",
      prompt: "温暖但克制的角色旁白",
      negativePrompt: "不要机械感",
      generator: "local-tts",
      nameStem: "character-voice",
    }, config);
    assert.equal(ticket.kind, "audio");
    const archived = await pipeline.attach(ticket.id, { sourcePath }, config);
    assert.equal(archived.ticket.kind, "audio");
    assert.match(archived.output.relativePath, /音频/);
    assert.match(await readFile(archived.output.promptPath, "utf8"), /类型：音频/);
    const metadata = JSON.parse(await readFile(archived.output.metaPath, "utf8"));
    assert.equal(metadata.ticket.prompt, "温暖但克制的角色旁白");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
