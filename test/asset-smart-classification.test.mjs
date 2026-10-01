import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const classifierUrl = new URL(
  "../vendor/codex-workspace-enhancer/asset-browser/asset-smart-classifier.js",
  import.meta.url,
);

async function classifierApi() {
  try {
    return await import(classifierUrl);
  } catch {
    return {
      buildImageSequenceProfiles: () => new Map(),
      classifyLocalAsset: () => ({}),
    };
  }
}

test("continuous video extraction frames are grouped as local noise without model calls", async () => {
  const { buildImageSequenceProfiles, classifyLocalAsset } = await classifierApi();
  const files = Array.from({ length: 24 }, (_, index) =>
    `/project/video-analysis/frames/second_frames/frame_${String(index).padStart(4, "0")}.jpg`);
  const profiles = buildImageSequenceProfiles(files, path.posix);

  const result = classifyLocalAsset({ filePath: files[8], kind: "image" }, { profiles, pathApi: path.posix });

  assert.equal(result.smartGroup, "noise");
  assert.equal(result.category, "视频解析帧");
  assert.ok(result.autoTags.includes("自动·视频解析帧"));
  assert.ok(result.autoTags.includes("连续帧序列"));
  assert.ok(result.confidence >= 95);
  assert.match(result.reason, /连续|帧/u);
  assert.equal(result.tokenCost, 0);
});

test("role scene and prop folders become formal image assets", async () => {
  const { buildImageSequenceProfiles, classifyLocalAsset } = await classifierApi();
  const fixtures = [
    ["/project/04-资产/角色图/CHAR_HERO_BASE.png", "角色"],
    ["/project/04-资产/场景图/SCENE_TEMPLE.png", "场景"],
    ["/project/04-资产/道具图/PROP_SWORD.png", "道具"],
  ];
  const profiles = buildImageSequenceProfiles(fixtures.map(([filePath]) => filePath), path.posix);

  for (const [filePath, category] of fixtures) {
    const result = classifyLocalAsset({ filePath, kind: "image" }, { profiles, pathApi: path.posix });
    assert.equal(result.smartGroup, "asset");
    assert.equal(result.category, category);
    assert.ok(result.autoTags.includes(`自动·${category}`));
    assert.ok(result.confidence >= 90);
  }
});

test("9:16 character sheets are recognized even when the filename only contains the costume", async () => {
  const { classifyLocalAsset } = await classifierApi();
  const result = classifyLocalAsset({
    filePath: "/project/05-生成结果/images/IMG01_林照_第七码队战斗工装.png",
    kind: "image",
    width: 941,
    height: 1672,
  }, { pathApi: path.posix });

  assert.equal(result.smartGroup, "asset");
  assert.equal(result.category, "角色");
  assert.ok(result.autoTags.includes("9:16竖版"));
  assert.match(result.reason, /9:16|竖版/u);
});

test("short-drama semantic filenames identify scenes and props without special folders", async () => {
  const { classifyLocalAsset } = await classifierApi();
  const fixtures = [
    ["/project/images/IMG15_垂天城与铸日塔全貌.png", "场景"],
    ["/project/images/IMG17_第七码队战术厅.png", "场景"],
    ["/project/images/IMG23_炉序烬骨.png", "道具"],
    ["/project/images/IMG27_门序七枚旧钥匙.png", "道具"],
    ["/project/items/item_rohan_phone_a/candidate.png", "道具"],
  ];

  for (const [filePath, category] of fixtures) {
    const result = classifyLocalAsset({ filePath, kind: "image" }, { pathApi: path.posix });
    assert.equal(result.smartGroup, "asset", filePath);
    assert.equal(result.category, category, filePath);
  }
});

test("contact sheets, representative frames, and audit outputs are excluded as process noise", async () => {
  const { classifyLocalAsset } = await classifierApi();
  const files = [
    "/project/review/contact-sheet.jpg",
    "/project/review/frame-first.jpg",
    "/project/04-审计/candidate.png",
    "/project/候选资产总览/overview.png",
  ];

  for (const filePath of files) {
    const result = classifyLocalAsset({ filePath, kind: "image" }, { pathApi: path.posix });
    assert.equal(result.smartGroup, "noise", filePath);
  }
});

test("explicit scene semantics win over the 9:16 role fallback", async () => {
  const { classifyLocalAsset } = await classifierApi();
  const result = classifyLocalAsset({
    filePath: "/project/images/SCENE_city_street.png",
    kind: "image",
    width: 1080,
    height: 1920,
  }, { pathApi: path.posix });

  assert.equal(result.smartGroup, "asset");
  assert.equal(result.category, "场景");
});

test("unidentified images stay in review instead of being guessed", async () => {
  const { buildImageSequenceProfiles, classifyLocalAsset } = await classifierApi();
  const filePath = "/project/misc/visual.png";
  const profiles = buildImageSequenceProfiles([filePath], path.posix);

  const result = classifyLocalAsset({ filePath, kind: "image" }, { profiles, pathApi: path.posix });

  assert.equal(result.smartGroup, "review");
  assert.equal(result.category, "参考图");
  assert.deepEqual(result.autoTags, ["自动·待确认", "信息不足"]);
  assert.ok(result.confidence < 80);
});

test("Windows temp roots do not turn real or ambiguous images into process noise", async () => {
  const { buildImageSequenceProfiles, classifyLocalAsset } = await classifierApi();
  const fixtures = [
    ["C:\\Users\\runner\\AppData\\Local\\Temp\\fixture\\角色\\hero.png", "asset", "角色"],
    ["C:\\Users\\runner\\AppData\\Local\\Temp\\fixture\\misc\\visual.png", "review", "参考图"],
    ["C:\\Users\\runner\\AppData\\Local\\Temp\\fixture\\screenshots\\shot.png", "noise", "截图"],
  ];
  const profiles = buildImageSequenceProfiles(fixtures.map(([filePath]) => filePath), path.win32);

  for (const [filePath, smartGroup, category] of fixtures) {
    const result = classifyLocalAsset({ filePath, kind: "image" }, { profiles, pathApi: path.win32 });
    assert.equal(result.smartGroup, smartGroup, filePath);
    assert.equal(result.category, category, filePath);
  }
});

test("manual grouping and labels permanently override local inference", async () => {
  const { buildImageSequenceProfiles, classifyLocalAsset } = await classifierApi();
  const filePath = "/project/frames/frame_0042.jpg";
  const profiles = buildImageSequenceProfiles(
    Array.from({ length: 20 }, (_, index) => `/project/frames/frame_${String(index).padStart(4, "0")}.jpg`),
    path.posix,
  );

  const result = classifyLocalAsset({
    filePath,
    kind: "image",
    metadata: { smartGroup: "asset", category: "角色", tags: ["主角", "已确认"] },
  }, { profiles, pathApi: path.posix });

  assert.equal(result.smartGroup, "asset");
  assert.equal(result.category, "角色");
  assert.deepEqual(result.tags, ["主角", "已确认"]);
  assert.equal(result.source, "manual");
  assert.equal(result.confidence, 100);
  assert.equal(result.tokenCost, 0);
});
