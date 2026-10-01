const VIEW_MODES = new Set(["list", "card"]);

const SUBJECT_RULES = [
  [/抖音.{0,8}视频|视频.{0,8}抖音/i, "抖音视频"],
  [/人物.{0,6}情绪|情绪.{0,6}人物/, "人物情绪"],
  [/灯仔|灯罩|灯具|方盒子|工业样机/, "灯具设计"],
  [/seedance/i, "Seedance"],
  [/codex.{0,10}(侧栏|对话|卡片|展示)|(侧栏|卡片).{0,10}codex/i, "Codex侧栏"],
  [/项目(?:管理)?看板|taskboard/i, "项目看板"],
  [/熔神/, "熔神"],
  [/自动剪辑/, "自动剪辑"],
  [/vibe[- ]?learning|学习平台/i, "学习平台"],
  [/世界观/, "世界观"],
  [/短剧/, "短剧制作"],
  [/剧本/, "剧本创作"],
  [/角色|人物/, "角色设计"],
  [/字幕/, "字幕内容"],
  [/音频|\bTTS\b/i, "音频制作"],
  [/视频/, "视频制作"],
  [/提示词/, "提示词"],
  [/日报/, "自动日报"],
  [/记忆/, "记忆系统"],
];

const WORK_RULES = [
  [/根因.{0,16}(确认|定位|修复)|(确认|定位).{0,12}根因|拦截.{0,12}(修复|解决)/, "故障修复"],
  [/(修复|解决).{0,12}(问题|故障|打不开|异常)|(问题|故障|打不开|异常).{0,12}(修复|解决)/, "故障修复"],
  [/(修复|解决|排查|定位)/, "故障修复"],
  [/视频.{0,12}(解析|识别|提取)|(解析|识别|提取).{0,12}视频|\bASR\b|\bOCR\b/i, "视频解析"],
  [/世界观.{0,8}(重构|改写)|(重构|改写).{0,8}世界观/, "世界观重构"],
  [/(安装|部署).{0,8}skills?|skills?.{0,8}(安装|部署)/i, "Skill安装"],
  [/(构建|创建|开发|生成|同步).{0,12}skills?|skills?.{0,12}(构建|创建|开发|生成|同步)/i, "Skill开发"],
  [/(侧栏|卡片|界面|交互|\bUI\b).{0,12}(优化|样式|调整|修复)|(优化|调整|修复).{0,12}(侧栏|卡片|界面|交互|\bUI\b)/i, "界面优化"],
  [/(整理|归档|迁移).{0,12}(项目|文件|文件夹)|(项目|文件|文件夹).{0,12}(整理|归档|迁移)/, "项目整理"],
  [/提示词.{0,8}(优化|重构)|(优化|重构).{0,8}提示词/, "提示词优化"],
  [/(重构|改写)/, "内容重构"],
  [/(优化|修正|改进)/, "内容优化"],
  [/(部署|上线)/, "平台部署"],
  [/(设计|视觉)/, "视觉设计"],
  [/(分析|调研|研究)/, "分析研究"],
  [/(制作|生成|创作)/, "内容制作"],
  [/(梳理|规划|整理)/, "方案梳理"],
];

const OUTCOME_RULES = [
  [/安全检查.{0,16}(拦截|修复)|127\.0\.0\.1|内嵌页面.{0,8}访问/, "本地访问"],
  [/local network access|网络层.{0,10}拦截|页面.{0,8}权限|权限.{0,8}(检查|诊断)/i, "权限诊断"],
  [/(已修复|修复完成|问题已解决|故障已解决)/, "问题已解决"],
  [/字幕.{0,12}(生成|提取|时间线)|(生成|提取).{0,12}字幕/, "字幕提取"],
  [/钉钉.{0,16}(发送|交付|上传)|(发送|交付|上传).{0,16}钉钉/, "钉钉交付"],
  [/(尚未|还未|未).{0,6}付费|待付费|付费.{0,6}(待提交|未提交)/, "待付费提交"],
  [/(尚未|还未|未).{0,6}计费|待计费|计费.{0,6}(待提交|未提交)/, "待计费提交"],
  [/卡片视图|卡片.{0,8}(布局|双列|两列|每行|调整)/, "卡片视图"],
  [/(通用|跨平台).{0,12}skills?|skills?.{0,16}(codex.{0,6}workbuddy|workbuddy.{0,6}codex)/i, "通用交付"],
  [/(灯仔|灯罩|灯具|方盒子|工业样机).{0,24}(优化|修正|设计)|(优化|修正|设计).{0,24}(灯仔|灯罩|灯具|方盒子|工业样机)/, "视觉优化"],
  [/世界观.{0,16}(review|定稿|v\d)|(review|定稿|v\d).{0,16}世界观/i, "版本定稿"],
  [/(文件夹|归档).{0,12}(完成|确认|整理)|(整理|确认).{0,12}(文件夹|归档)/, "文件归档"],
  [/(对照版|方案).{0,8}(准备|完成|定稿)/, "方案已准备"],
  [/(部署|上线).{0,8}(完成|成功)|(完成|成功).{0,8}(部署|上线)/, "部署完成"],
  [/skills?.{0,12}(完成|可用|通过)|(完成|可用|通过).{0,12}skills?/i, "Skill交付"],
  [/(验收|检查).{0,8}(通过|完成)|(通过|完成).{0,8}(验收|检查)/, "验收通过"],
  [/(发送|交付|上传).{0,8}(完成|成功)|(完成|成功).{0,8}(发送|交付|上传)/, "成果交付"],
];

export function normalizeViewMode(value) {
  return VIEW_MODES.has(value) ? value : "list";
}

export function nextViewMode(value) {
  return normalizeViewMode(value) === "card" ? "list" : "card";
}

export function viewTogglePresentation(value) {
  const mode = normalizeViewMode(value);
  return {
    mode,
    checked: mode === "card",
    label: mode === "card"
      ? "卡片视图已开启，切换为列表视图"
      : "卡片视图已关闭，切换为卡片视图",
  };
}

export function cardLayoutPresentation() {
  return {
    columns: "auto-fit",
    minCardWidth: "min(100%, 10.5rem)",
    cardHeight: "auto",
    titleHeight: "content",
    summaryHeight: "content",
    tagCount: 3,
  };
}

function firstRuleLabel(text, rules) {
  return rules.find(([pattern]) => pattern.test(String(text || "")))?.[1] || "";
}

function firstLabelFromSources(sources, rules) {
  for (const source of sources) {
    const label = firstRuleLabel(source, rules);
    if (label) return label;
  }
  return "";
}

function deriveSubject(title, text) {
  const cleaned = String(title || "")
    .replace(/\b(?:skills?|codex|api|cli|zip|success|v\d+(?:\.\d+)*)\b/gi, " ")
    .replace(/^(创建|构建|优化|更新|安装|调研|查找|梳理|整理|生成|制作|部署|同步|说明|修复|解决|排查|定位)+/u, "")
    .replace(/[《》“”「」【】()[\]：:，,。.!！?？/\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const core = cleaned.split(/点击|无法|无响应|打不开|报错|失败|异常|问题|故障/u)[0].trim() || cleaned;
  const chinesePhrase = core.match(/[\p{Script=Han}]{2,8}/u)?.[0];
  if (chinesePhrase) return chinesePhrase.slice(0, 8);
  const englishPhrase = cleaned.match(/[A-Za-z][A-Za-z0-9-]{2,15}/)?.[0];
  if (englishPhrase) return englishPhrase.slice(0, 12);
  if (/需求|要求|问题/.test(text)) return "需求处理";
  return "任务主题";
}

export function extractPreviewTags({ title = "", summary = "", recentInput = "", recentOutput = "" } = {}) {
  const sanitize = (value) => String(value || "")
    .replace(/sendStatus\s*=\s*\w+/gi, "")
    .replace(/\b(?:SUCCESS|FAILED|V\d+(?:\.\d+)*|ZIP|API|CLI)\b/gi, "");
  const titleText = sanitize(title);
  const summaryText = sanitize(summary);
  const inputText = sanitize(recentInput);
  const outputText = sanitize(recentOutput);
  const text = [titleText, summaryText, inputText, outputText].filter(Boolean).join("。");
  const tags = [];
  const seen = new Set();
  const add = (candidate) => {
    const tag = String(candidate || "").trim().slice(0, 12);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  };

  const subject = firstLabelFromSources([titleText, summaryText, inputText, outputText], SUBJECT_RULES)
    || deriveSubject(title, text);
  const work = firstLabelFromSources([titleText, summaryText, inputText, outputText], WORK_RULES)
    || (/完成|已/.test(text) ? "成果整理" : "需求梳理");
  let outcome = firstLabelFromSources([summaryText, outputText, inputText, titleText], OUTCOME_RULES)
    || (/完成|已完成|通过/.test(text) ? "阶段完成" : "持续推进");
  if (subject === "Codex侧栏" && /卡片/.test(text)) outcome = "卡片视图";
  if (subject === "项目看板" && /local network access|网络层|页面.{0,8}权限|权限.{0,8}(检查|诊断)/i.test(text)) {
    outcome = "权限诊断";
  }
  if (subject === "项目看板" && /安全检查|127\.0\.0\.1|内嵌页面.{0,8}访问/.test(text)) {
    outcome = "本地访问";
  }
  add(subject);
  add(work);
  add(outcome);
  for (const rules of [SUBJECT_RULES, WORK_RULES, OUTCOME_RULES]) {
    for (const [, label] of rules) {
      if (text.includes(label)) add(label);
      if (tags.length >= 3) break;
    }
  }
  for (const fallback of ["任务主题", "需求梳理", "阶段成果"]) add(fallback);
  return tags.slice(0, 3);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function zonedDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const valueOf = (type) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: valueOf("year"),
    month: valueOf("month"),
    day: valueOf("day"),
    hour: valueOf("hour"),
    minute: valueOf("minute"),
  };
}

export function formatLastCommunication(
  value,
  now = new Date(),
  { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {},
) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  const current = zonedDateParts(now, timeZone);
  const target = zonedDateParts(date, timeZone);
  const dayNumber = ({ year, month, day }) => Date.UTC(year, month - 1, day) / 86_400_000;
  const dayDiff = dayNumber(current) - dayNumber(target);
  const time = `${pad2(target.hour)}:${pad2(target.minute)}`;
  if (dayDiff === 0) return time;
  if (dayDiff === 1) return `昨天 ${time}`;
  if (dayDiff > 1 && dayDiff < 7) {
    return `${new Intl.DateTimeFormat("zh-CN", { timeZone, weekday: "short" }).format(date)} ${time}`;
  }
  return `${target.month}月${target.day}日`;
}

export function presentCardPreview(preview = {}, now = new Date(), options = {}) {
  const summary = String(preview.summary || "暂无 AI 总结").trim();
  const tags = Array.isArray(preview.tags) && preview.tags.length >= 3
    ? preview.tags.slice(0, 3)
    : extractPreviewTags(preview);
  return {
    ...preview,
    summary,
    lastCommunication: formatLastCommunication(preview.updatedAt, now, options),
    tags,
  };
}
