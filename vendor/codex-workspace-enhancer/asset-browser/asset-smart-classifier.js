import path from "node:path";

const SMART_GROUPS = new Set(["asset", "review", "noise"]);
const FORMAL_IMAGE_CATEGORIES = new Set(["角色", "场景", "道具", "分镜图"]);

function normalizedPath(value) {
  return String(value || "").replace(/\\/g, "/").toLocaleLowerCase("zh-CN");
}

function sequenceLikeName(filePath, pathApi = path) {
  const stem = pathApi.basename(filePath, pathApi.extname(filePath)).toLocaleLowerCase("zh-CN");
  return /(?:^|[_\-.])(?:frame|shot|thumb|screenshot|preview|extract|img)?[_\-.]*\d{3,}$/iu.test(stem)
    || /(?:帧|截图|缩略图)[_-]*\d{2,}$/u.test(stem);
}

export function buildImageSequenceProfiles(filePaths = [], pathApi = path) {
  const profiles = new Map();
  for (const filePath of filePaths) {
    const directory = pathApi.resolve(pathApi.dirname(filePath));
    const profile = profiles.get(directory) || { total: 0, sequenceLike: 0, density: 0 };
    profile.total += 1;
    if (sequenceLikeName(filePath, pathApi)) profile.sequenceLike += 1;
    profiles.set(directory, profile);
  }
  for (const profile of profiles.values()) {
    profile.density = profile.total ? profile.sequenceLike / profile.total : 0;
  }
  return profiles;
}

function inferFormalImageCategory(filePath) {
  const value = normalizedPath(filePath);
  const rules = [
    ["分镜图", [/(?:^|[/_.-])storyboards?(?:[/_.-]|$)/u, /分镜(?:图)?/u]],
    ["角色", [
      /(?:^|[/_.-])char(?:acter)?s?(?:[/_.-]|$)/u,
      /角色(?:图|设定|立绘|三视图)?|人物(?:图|设定|立绘)?|主角|群像/u,
      /(?:战斗|日常|学生|医官|侦察|突入|防御|战术官|维修|地下战|祭祀?)(?:工装|服|装|制服)|器灵本体/u,
    ]],
    ["场景", [
      /(?:^|[/_.-])(?:scenes?|locations?|environments?)(?:[/_.-]|$)/u,
      /场景(?:图|设定)?|环境(?:图|设定)?|全貌|街道|城区|回收区|战术厅|大厅|传动井|日出|空场/u,
    ]],
    ["道具", [
      /(?:^|[/_.-])(?:props?|items?)(?:[/_.-]|$)/u,
      /道具(?:图|设定)?|物件|物品|遗物|武器|装备|饰品/u,
      /烬骨|断刃|线轴|指环|钥匙|铁腹匣|断路钳|引火齿|万民册|手机|电话|手提包|酒杯|餐盘|维修盒|轴承环|扳手|八音盒/u,
    ]],
  ];
  return rules.find(([, patterns]) => patterns.some((pattern) => pattern.test(value)))?.[0] || "";
}

function noiseCategory(filePath, sequenceNoise) {
  const value = normalizedPath(filePath);
  if (/thumbnail|thumbs?|缩略图/u.test(value)) return "缩略图";
  if (/screenshot|截图/u.test(value)) return "截图";
  if (/contact[_-]?sheets?|联系表/u.test(value)) return "联系表";
  return sequenceNoise ? "视频解析帧" : "过程图";
}

function automaticResult({ smartGroup, category, autoTags, confidence, reason, tags = [] }) {
  return {
    smartGroup,
    category,
    tags,
    autoTags,
    confidence,
    reason,
    source: "local-rule",
    tokenCost: 0,
  };
}

export function classifyLocalAsset(
  { filePath, kind, metadata = {}, inferredCategory = "", width = 0, height = 0 } = {},
  { profiles = new Map(), pathApi = path } = {},
) {
  const manualTags = [...new Set((Array.isArray(metadata.tags) ? metadata.tags : [])
    .map((item) => String(item || "").trim()).filter(Boolean))];
  const manualCategory = String(metadata.category || "").trim();
  const manualGroup = SMART_GROUPS.has(metadata.smartGroup) ? metadata.smartGroup : "";
  if (manualGroup || manualCategory || manualTags.length) {
    const category = manualCategory || inferredCategory || (kind === "image" ? "参考图" : "其他");
    return {
      smartGroup: manualGroup || (kind === "image" && !FORMAL_IMAGE_CATEGORIES.has(category) ? "review" : "asset"),
      category,
      tags: manualTags,
      autoTags: [],
      confidence: 100,
      reason: "人工分类优先，自动整理不会覆盖",
      source: "manual",
      tokenCost: 0,
    };
  }

  if (kind !== "image") {
    return automaticResult({
      smartGroup: "asset",
      category: inferredCategory || "其他",
      autoTags: [],
      confidence: 100,
      reason: "非图片资产保留在正式资产分组",
    });
  }

  const normalized = normalizedPath(filePath);
  const directory = pathApi.resolve(pathApi.dirname(filePath));
  const profile = profiles.get(directory) || { total: 0, sequenceLike: 0, density: 0 };
  const denseSequence = profile.total >= 12 && profile.density >= 0.8;
  const explicitFramePath = /(?:^|\/)(?:frames?|second[_-]?frames?|video[_-]?frames?|extracted[_-]?frames?|final[_-]?frames?)(?:\/|$)|(?:^|[/_.-])frame[_-]?(?:first|middle|last)(?:[/_.-]|$)|抽帧|截帧|视频帧/u.test(normalized);
  const explicitProcessPath = /(?:^|\/)(?:thumbnails?|contact[_-]?sheets?|screenshots?|rendered[_-]?reference|audit)(?:\/|$)|(?:^|[/_.-])contact[_-]?sheet(?:[/_.-]|$)|缩略图|联系表|(?:^|\/)\d{0,2}-?审计(?:\/|$)|审计图|过程图|候选资产总览/u.test(normalized);
  if (denseSequence || explicitFramePath || explicitProcessPath) {
    const sequenceNoise = denseSequence || explicitFramePath;
    return automaticResult({
      smartGroup: "noise",
      category: noiseCategory(filePath, sequenceNoise),
      autoTags: sequenceNoise
        ? ["自动·视频解析帧", denseSequence ? "连续帧序列" : "解析帧目录"]
        : ["自动·干扰项", "过程产物"],
      confidence: denseSequence && explicitFramePath ? 99 : sequenceNoise ? 96 : 92,
      reason: denseSequence
        ? `同目录 ${profile.sequenceLike}/${profile.total} 张图片采用连续帧编号`
        : explicitFramePath
          ? "路径命中视频解析帧目录"
          : "路径命中缩略图、联系表或审计过程目录",
    });
  }

  const formalCategory = inferFormalImageCategory(filePath);
  if (formalCategory) {
    const nearNineSixteen = width >= 600 && height >= 1000 && height / width >= 1.68 && height / width <= 1.88;
    return automaticResult({
      smartGroup: "asset",
      category: formalCategory,
      autoTags: [`自动·${formalCategory}`, "正式资产", ...(nearNineSixteen ? ["9:16竖版"] : [])],
      confidence: 96,
      reason: `目录或文件名明确匹配${formalCategory}资产语义${nearNineSixteen ? "，图片比例接近9:16竖版" : ""}`,
    });
  }

  const nearNineSixteen = width >= 600 && height >= 1000 && height / width >= 1.68 && height / width <= 1.88;
  if (nearNineSixteen) {
    return automaticResult({
      smartGroup: "asset",
      category: "角色",
      autoTags: ["自动·角色", "正式资产", "9:16竖版"],
      confidence: 82,
      reason: "图片比例接近9:16竖版，且未命中场景、道具或过程图语义",
    });
  }

  return automaticResult({
    smartGroup: "review",
    category: inferredCategory || "参考图",
    autoTags: ["自动·待确认", "信息不足"],
    confidence: 60,
    reason: "文件路径和名称不足以可靠判断资产用途",
  });
}
