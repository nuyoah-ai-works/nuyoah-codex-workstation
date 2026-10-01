import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../vendor/codex-workspace-enhancer/asset-browser/server.js", import.meta.url));

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [fileName, content] of Object.entries(files)) {
    const name = Buffer.from(fileName);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(directory.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, eocd]);
}

test("local asset API scans multiple folders and keeps project moves logical", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-local-assets-"));
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  const target = path.join(root, "target");
  const productionExtra = path.join(root, "production-extra");
  const sessionsRoot = path.join(root, "sessions");
  const generatedImagesRoot = path.join(root, "generated-images");
  const generatedThreadId = "generated-thread";
  const generatedCallId = "exec-generated-image";
  const generatedImagePath = path.join(generatedImagesRoot, generatedThreadId, `${generatedCallId}.png`);
  const unrelatedThreadId = "unrelated-thread";
  const unrelatedCallId = "exec-unrelated-image";
  const unrelatedImagePath = path.join(generatedImagesRoot, unrelatedThreadId, `${unrelatedCallId}.png`);
  const frameDirectory = path.join(second, "video-analysis", "frames", "second_frames");
  const miscDirectory = path.join(second, "misc");
  // Create the parent before recursive child setup; racing both can raise EEXIST.
  await mkdir(second);
  await Promise.all([mkdir(first), mkdir(target), mkdir(productionExtra), mkdir(frameDirectory, { recursive: true }), mkdir(miscDirectory, { recursive: true }), mkdir(path.join(sessionsRoot, "2026", "08", "20"), { recursive: true }), mkdir(path.dirname(generatedImagePath), { recursive: true }), mkdir(path.dirname(unrelatedImagePath), { recursive: true })]);
  const promptPath = path.join(first, "hero-prompt.md");
  const audioPath = path.join(first, "character-voice.mp3");
  const imagePath = path.join(second, "角色海报.png");
  const videoPath = path.join(second, "final-trailer.mp4");
  const wordPath = path.join(first, "production-notes.docx");
  const ambiguousImagePath = path.join(miscDirectory, "visual.png");
  const globalStatePath = path.join(root, "codex-global-state.json");
  const sessionIndexPath = path.join(root, "session-index.jsonl");
  const codexState = {
    "local-projects": {
      production: { id: "production", name: "角色图制作", rootPaths: [first] },
      code: { id: "code", name: "侧栏代码工具", rootPaths: [target] },
    },
    "thread-project-assignments": {
      [generatedThreadId]: { projectId: "production" },
      [unrelatedThreadId]: { projectId: "code" },
    },
  };
  const framePaths = Array.from({ length: 24 }, (_, index) =>
    path.join(frameDirectory, `frame_${String(index).padStart(4, "0")}.jpg`));
  await Promise.all([
    writeFile(promptPath, "# Hero\nOriginal prompt"),
    writeFile(audioPath, "audio-fixture"),
    writeFile(imagePath, "image-fixture"),
    writeFile(path.join(second, "角色海报.meta.json"), JSON.stringify({
      schemaVersion: 1,
      ticket: {
        kind: "image",
        prompt: "九比十六竖版东方女将角色全身设定图",
        negativePrompt: "避免文字和水印",
        generator: "codex-image",
        model: "image-v1",
        sourceContext: { threadId: "image-thread" },
      },
    })),
    writeFile(videoPath, "video-fixture"),
    writeFile(ambiguousImagePath, "ambiguous-image-fixture"),
    writeFile(generatedImagePath, "generated-image-fixture"),
    writeFile(unrelatedImagePath, "unrelated-generated-image-fixture"),
    writeFile(globalStatePath, JSON.stringify(codexState)),
    writeFile(sessionIndexPath, [
      JSON.stringify({ id: generatedThreadId, thread_name: "批量生成角色图", updated_at: new Date().toISOString() }),
      JSON.stringify({ id: unrelatedThreadId, thread_name: "修复 README 图片链接", updated_at: new Date().toISOString() }),
      "",
    ].join("\n")),
    writeFile(path.join(sessionsRoot, "2026", "08", "20", "rollout.jsonl"), [
      JSON.stringify({ timestamp: new Date().toISOString(), type: "session_meta", payload: { id: generatedThreadId, cwd: first } }),
      JSON.stringify({ timestamp: new Date().toISOString(), type: "event_msg", payload: { type: "image_generation_end", call_id: generatedCallId, status: "completed", revised_prompt: "Codex 自动关联的角色概念图" } }),
      "",
    ].join("\n")),
    writeFile(path.join(sessionsRoot, "2026", "08", "20", "unrelated-rollout.jsonl"), [
      JSON.stringify({ timestamp: new Date().toISOString(), type: "session_meta", payload: { id: unrelatedThreadId, cwd: path.join(root, "not-a-project") } }),
      JSON.stringify({ timestamp: new Date().toISOString(), type: "event_msg", payload: { type: "image_generation_end", call_id: unrelatedCallId, status: "completed", revised_prompt: "不应串入其他项目的生成图" } }),
      "",
    ].join("\n")),
    ...framePaths.map((filePath) => writeFile(filePath, "frame-fixture")),
    writeFile(wordPath, createStoredZip({
      "[Content_Types].xml": "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"></Types>",
      "word/document.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Word original</w:t></w:r></w:p><w:sectPr/></w:body></w:document>",
    })),
  ]);

  const port = await freePort();
  const token = "local-asset-service-integration-token-0000000001";
  const tokenPath = path.join(root, "token");
  await writeFile(tokenPath, token);
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      NUYOAH_WORKSTATION_DATA_DIR: path.join(root, "workstation"),
      ASSET_BROWSER_TOKEN_FILE: tokenPath,
      ASSET_BROWSER_CONFIG: path.join(root, "config.json"),
      ASSET_BROWSER_LEDGER: path.join(root, "ledger.json"),
      GENERATION_TICKETS: path.join(root, "generation.json"),
      GENERATION_THREAD_BINDINGS: path.join(root, "bindings.json"),
      CODEX_PROMPT_ASSOCIATIONS: path.join(root, "prompt-associations.json"),
      ASSET_LIBRARY_INDEX: path.join(root, "asset-library-index.json"),
      CODEX_SESSIONS_ROOT: sessionsRoot,
      CODEX_GENERATED_IMAGES_ROOT: generatedImagesRoot,
      CODEX_GLOBAL_STATE: globalStatePath,
      CODEX_SESSION_INDEX: sessionIndexPath,
      DUPLICATE_CLEANUP_LEDGER: path.join(root, "duplicates.json"),
      DUPLICATE_QUARANTINE: path.join(root, "quarantine"),
      RHYTHM_CONTROL_REGISTRY: path.join(root, "rhythm.json"),
      PROMPT_LIBRARY_ROOT: path.join(root, "prompts"),
      THREE_D_TASKS: path.join(root, "three-d.json"),
      ASSET_ACTION_TRASH: path.join(root, "trash"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });

  async function request(route, options = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      ...options,
      headers: { "content-type": "application/json", "x-asset-console-token": token, ...(options.headers || {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || String(response.status));
    return data;
  }

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { await request("/api/config"); ready = true; break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, logs);

    const sourceProject = (await request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Source", folders: [first, second] }),
    })).project;
    const targetProject = (await request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Target", folders: [target] }),
    })).project;
    assert.deepEqual(sourceProject.folders, [first, second]);

    let synchronizedProject = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const projects = (await request("/api/projects")).projects;
      synchronizedProject = projects.find((project) => project.id === sourceProject.id && project.codexSync?.projectId === "production");
      if (synchronizedProject) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(synchronizedProject, "the matching manual project should be linked instead of duplicated");
    assert.equal((await request("/api/projects")).projects.filter((project) => project.codexSync?.projectId === "production").length, 1);
    assert.equal((await request("/api/projects")).projects.some((project) => project.codexSync?.projectId === "code"), false, "ordinary code projects must not be auto-imported");
    assert.equal((await request("/api/codex-project-sync")).state, "ready");

    codexState["local-projects"].production.rootPaths.push(productionExtra);
    await writeFile(globalStatePath, JSON.stringify(codexState));
    for (let attempt = 0; attempt < 180; attempt += 1) {
      synchronizedProject = (await request("/api/projects")).projects.find((project) => project.id === sourceProject.id);
      if (synchronizedProject?.folders.includes(productionExtra)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(synchronizedProject.folders.includes(productionExtra), "new Codex project folders should be merged on the next incremental sync");
    assert.ok(synchronizedProject.folders.includes(second), "manual folders must survive Codex synchronization");

    const initial = await request(`/api/library?project=${sourceProject.id}`);
    assert.equal(initial.index.mode, "initial-scan");
    assert.equal(initial.index.persistent, true);
    const cached = await request(`/api/library?project=${sourceProject.id}`);
    assert.equal(cached.index.mode, "persistent", "opening the library again must read the saved index");
    assert.equal(existsSync(path.join(root, "asset-library-index.json")), true);
    assert.deepEqual(initial.counts, { all: 31, text: 2, image: 27, audio: 1, video: 1 });
    assert.deepEqual(initial.smartCounts, { asset: 5, review: 2, noise: 24 });
    assert.equal(initial.assets.find((asset) => asset.name === "hero-prompt.md").category, "提示词");
    assert.equal(initial.assets.find((asset) => asset.name === "character-voice.mp3").category, "角色声音");
    const roleImage = initial.assets.find((asset) => asset.name === "角色海报.png");
    assert.equal(roleImage.smartGroup, "asset");
    assert.ok(roleImage.autoTags.includes("自动·角色"));
    assert.deepEqual(roleImage.promptAssociation, {
      available: true,
      source: "generation-sidecar",
      kind: "image",
      generator: "codex-image",
      model: "image-v1",
      threadId: "image-thread",
    });
    const linkedPrompt = await request(`/api/assets/prompt?id=${encodeURIComponent(roleImage.id)}`);
    assert.equal(linkedPrompt.prompt, "九比十六竖版东方女将角色全身设定图");
    assert.equal(linkedPrompt.negativePrompt, "避免文字和水印");
    const renamedLinked = await request("/api/assets/rename", {
      method: "POST",
      body: JSON.stringify({ assetId: roleImage.id, name: "角色设定" }),
    });
    const renamedLinkedPath = path.join(second, "角色设定.png");
    const renamedLinkedMetaPath = path.join(second, "角色设定.meta.json");
    assert.equal(existsSync(renamedLinkedPath), true);
    assert.equal(existsSync(renamedLinkedMetaPath), true, "prompt sidecar must follow a renamed asset");
    assert.equal((await request(`/api/assets/prompt?id=${encodeURIComponent(renamedLinked.result.assetId)}`)).prompt, "九比十六竖版东方女将角色全身设定图");
    await assert.rejects(() => request("/api/assets/delete", {
      method: "DELETE",
      body: JSON.stringify({ assetId: renamedLinked.result.assetId, confirmName: "角色设定.png" }),
    }), /V1 不提供永久删除/);
    assert.equal(existsSync(renamedLinkedPath), true);
    assert.equal(existsSync(renamedLinkedMetaPath), true, "a disabled delete must preserve the prompt sidecar");
    let importedGenerated = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      importedGenerated = (await request(`/api/library?project=${sourceProject.id}`)).assets
        .find((asset) => asset.name === `${generatedCallId}.png`);
      if (importedGenerated) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(importedGenerated, "Codex-generated media should be assigned by the session cwd");
    assert.equal(importedGenerated.promptAssociation.available, true);
    assert.equal((await request(`/api/assets/prompt?id=${encodeURIComponent(importedGenerated.id)}`)).prompt, "Codex 自动关联的角色概念图");
    assert.equal((await request(`/api/library?project=${sourceProject.id}`)).assets.some((asset) => asset.name === `${unrelatedCallId}.png`), false, "an unrelated cwd must not fall back into the only configured project");
    assert.equal((await request("/api/assets/assign", { method: "DELETE", body: JSON.stringify({ assetId: importedGenerated.id }) })).result.removed, true);
    assert.equal((await request(`/api/library?project=${sourceProject.id}`)).assets.some((asset) => asset.id === importedGenerated.id), false);
    const extractedFrame = initial.assets.find((asset) => asset.name === "frame_0008.jpg");
    assert.equal(extractedFrame.smartGroup, "noise");
    assert.equal(extractedFrame.category, "视频解析帧");
    assert.ok(extractedFrame.confidence >= 95);
    assert.equal(initial.assets.find((asset) => asset.name === "visual.png").smartGroup, "review");

    const watchedPath = path.join(first, "incremental-note.txt");
    await writeFile(watchedPath, "first incremental version");
    let watchedAsset = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const library = await request(`/api/library?project=${sourceProject.id}`);
      assert.equal(library.index.mode, "persistent");
      watchedAsset = library.assets.find((asset) => asset.name === "incremental-note.txt");
      if (watchedAsset) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(watchedAsset, "a new file should be inserted by the watcher without a full scan");
    const firstSize = watchedAsset.size;
    await writeFile(watchedPath, "second incremental version with more content");
    for (let attempt = 0; attempt < 80; attempt += 1) {
      watchedAsset = (await request(`/api/library?project=${sourceProject.id}`)).assets
        .find((asset) => asset.name === "incremental-note.txt");
      if (watchedAsset?.size > firstSize) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(watchedAsset.size > firstSize, "a changed file should refresh only its indexed record");
    await rm(watchedPath);
    for (let attempt = 0; attempt < 80; attempt += 1) {
      watchedAsset = (await request(`/api/library?project=${sourceProject.id}`)).assets
        .find((asset) => asset.name === "incremental-note.txt");
      if (!watchedAsset) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(watchedAsset, undefined, "a deleted file should disappear from the persistent index");

    const repaired = await request(`/api/library?project=${sourceProject.id}&rescan=1`);
    assert.equal(repaired.index.mode, "manual-rescan", "only the explicit repair action should traverse every folder");

    const prompt = initial.assets.find((asset) => asset.name === "hero-prompt.md");
    const read = await request(`/api/text?id=${encodeURIComponent(prompt.id)}`);
    assert.match(read.content, /Original prompt/);
    await request("/api/text", { method: "PUT", body: JSON.stringify({ assetId: prompt.id, content: "# Hero\nEdited locally" }) });
    assert.match((await request(`/api/text?id=${encodeURIComponent(prompt.id)}`)).content, /Edited locally/);

    const word = initial.assets.find((asset) => asset.name === "production-notes.docx");
    assert.match((await request(`/api/text?id=${encodeURIComponent(word.id)}`)).content, /Word original/);
    await request("/api/text", { method: "PUT", body: JSON.stringify({ assetId: word.id, content: "Word edited\nSecond line" }) });
    assert.match((await request(`/api/text?id=${encodeURIComponent(word.id)}`)).content, /Word edited\nSecond line/);

    await request("/api/assets/metadata", {
      method: "PATCH",
      body: JSON.stringify({ assetId: prompt.id, category: "剧本", tags: ["已审核"] }),
    });
    const tagged = (await request(`/api/library?project=${sourceProject.id}`)).assets.find((asset) => asset.id === prompt.id);
    assert.equal(tagged.category, "剧本");
    assert.deepEqual(tagged.tags, ["已审核"]);

    await request("/api/assets/metadata", {
      method: "PATCH",
      body: JSON.stringify({ assetId: extractedFrame.id, smartGroup: "asset", category: "角色", tags: ["人工确认"] }),
    });
    const overriddenFrame = (await request(`/api/library?project=${sourceProject.id}`)).assets
      .find((asset) => asset.id === extractedFrame.id);
    assert.equal(overriddenFrame.smartGroup, "asset");
    assert.equal(overriddenFrame.category, "角色");
    assert.deepEqual(overriddenFrame.tags, ["人工确认"]);
    assert.equal(overriddenFrame.classificationSource, "manual");

    await request("/api/assets/assign", {
      method: "POST",
      body: JSON.stringify({ assetId: prompt.id, targetProjectId: targetProject.id }),
    });
    assert.equal((await request(`/api/library?project=${sourceProject.id}`)).assets.some((asset) => asset.id === prompt.id), false);
    assert.equal((await request(`/api/library?project=${targetProject.id}`)).assets.some((asset) => asset.id === prompt.id), true);
    assert.equal(existsSync(promptPath), true, "logical move must not move the file on disk");

    const assigned = (await request(`/api/library?project=${targetProject.id}`)).assets.find((asset) => asset.id === prompt.id);
    const renamed = await request("/api/assets/rename", {
      method: "POST",
      body: JSON.stringify({ assetId: assigned.id, name: "hero-script" }),
    });
    assert.equal(renamed.result.name, "hero-script.md");
    const renamedPath = path.join(first, "hero-script.md");
    assert.equal(existsSync(renamedPath), true);

    await assert.rejects(() => request("/api/assets/delete", {
      method: "DELETE",
      body: JSON.stringify({ assetId: renamed.result.assetId, confirmName: "hero-script.md" }),
    }), /V1 不提供永久删除/);
    assert.equal(existsSync(renamedPath), true);
    const codePath = path.join(first, 'read-only.js');
    await writeFile(codePath, 'console.log("preview only");');
    const codeRef = Buffer.from(codePath).toString('base64url');
    const codePreview = await request(`/api/preview?id=${codeRef}`);
    assert.match(codePreview.text, /preview only/);
    await assert.rejects(() => request('/api/text', { method: 'PUT', body: JSON.stringify({ assetId: codeRef, content: 'changed' }) }), /不支持直接保存/);
    const outside = path.join(root, 'outside.txt'); await writeFile(outside, 'outside');
    await assert.rejects(() => request(`/api/preview?id=${Buffer.from(outside).toString('base64url')}`), /不属于/);
    const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await mkdir(path.join(root, 'workstation', 'tasks'), { recursive: true });
    await writeFile(path.join(root, 'workstation', 'tasks', `${taskId}.json`), JSON.stringify({ threadId: taskId, revision: 1, updatedAt: new Date().toISOString(), summary: {}, notes: 'private note', references: [{ relation: 'reference', path: codePath, label: 'code' }] }));
    const refs = await request(`/api/task-references?threadId=${taskId}`);
    assert.equal(refs.references[0].path, codePath); assert.equal(refs.references[0].exists, true);
    assert.equal(Object.hasOwn(refs, 'notes'), false);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  }
});
