import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CodexPromptAssociationStore } from "../vendor/codex-workspace-enhancer/asset-browser/codex-prompt-associations.js";

test("imports Codex image generation events and keeps the prompt linked to the exact output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-prompt-links-"));
  try {
    const sessionsRoot = path.join(root, "sessions");
    const generatedRoot = path.join(root, "generated_images");
    const threadId = "00000000-0000-4000-8000-50e6df13fe6e";
    const sessionDirectory = path.join(sessionsRoot, "2026", "08", "20");
    const outputDirectory = path.join(generatedRoot, threadId);
    await Promise.all([mkdir(sessionDirectory, { recursive: true }), mkdir(outputDirectory, { recursive: true })]);
    const callId = "exec-30c19a92-4dfd-413a-8aaa-87acdd92a0dc";
    const outputPath = path.join(outputDirectory, `${callId}.png`);
    await writeFile(outputPath, "image");
    await writeFile(path.join(sessionDirectory, "rollout.jsonl"), [
      JSON.stringify({ timestamp: "2026-08-20T01:00:00.000Z", type: "session_meta", payload: { id: threadId, cwd: "/work/current-project" } }),
      JSON.stringify({ timestamp: "2026-08-20T01:01:00.000Z", type: "event_msg", payload: { type: "image_generation_end", call_id: callId, status: "completed", revised_prompt: "九比十六竖版角色全身设定图" } }),
      "",
    ].join("\n"));

    const store = new CodexPromptAssociationStore({
      registryPath: path.join(root, "associations.json"),
      sessionsRoot,
      generatedImagesRoot: generatedRoot,
      lookbackDays: 365,
    });
    const synced = await store.syncCodexSessions();
    assert.equal(synced.imported, 1);
    const association = await store.get(outputPath);
    assert.equal(association.kind, "image");
    assert.equal(association.prompt, "九比十六竖版角色全身设定图");
    assert.equal(association.threadId, threadId);
    assert.equal(association.cwd, "/work/current-project");
    assert.equal(association.source, "codex-session");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registers video and audio prompts and reads existing generation sidecars", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-prompt-links-"));
  try {
    const store = new CodexPromptAssociationStore({
      registryPath: path.join(root, "associations.json"),
      sessionsRoot: path.join(root, "sessions"),
      generatedImagesRoot: path.join(root, "generated_images"),
    });
    const videoPath = path.join(root, "trailer.mp4");
    const audioPath = path.join(root, "character.wav");
    await Promise.all([writeFile(videoPath, "video"), writeFile(audioPath, "audio")]);
    await store.register({
      assetPath: videoPath,
      kind: "video",
      prompt: "末日城市预告片，缓慢推镜",
      negativePrompt: "不要字幕",
      generator: "Seedance",
      model: "2.5",
      threadId: "video-thread",
    });
    await writeFile(`${audioPath.slice(0, -path.extname(audioPath).length)}.meta.json`, JSON.stringify({
      schemaVersion: 1,
      ticket: {
        kind: "audio",
        prompt: "冷静克制的成年女性角色声音",
        negativePrompt: "避免机械感",
        generator: "local-tts",
        model: "voice-v1",
        references: ["voice-reference.wav"],
        sourceContext: { threadId: "audio-thread" },
      },
    }));

    const video = await store.get(videoPath);
    assert.equal(video.kind, "video");
    assert.equal(video.prompt, "末日城市预告片，缓慢推镜");
    assert.equal(video.negativePrompt, "不要字幕");
    const audio = await store.get(audioPath);
    assert.equal(audio.kind, "audio");
    assert.equal(audio.prompt, "冷静克制的成年女性角色声音");
    assert.equal(audio.threadId, "audio-thread");
    assert.deepEqual(audio.references, ["voice-reference.wav"]);
    assert.deepEqual(await store.summary(audioPath), {
      available: true,
      source: "generation-sidecar",
      kind: "audio",
      generator: "local-tts",
      model: "voice-v1",
      threadId: "audio-thread",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
