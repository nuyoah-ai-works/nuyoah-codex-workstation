import assert from "node:assert/strict";
import test from "node:test";

async function cardViewModule() {
  return import("../lib/card-view.mjs").catch(() => ({}));
}

test("missing or invalid saved state defaults to list view", async () => {
  const { normalizeViewMode } = await cardViewModule();
  assert.equal(normalizeViewMode?.(null), "list");
  assert.equal(normalizeViewMode?.("unknown"), "list");
  assert.equal(normalizeViewMode?.("card"), "card");
});

test("view toggle switches in both directions", async () => {
  const { nextViewMode } = await cardViewModule();
  assert.equal(nextViewMode?.("list"), "card");
  assert.equal(nextViewMode?.("card"), "list");
});

test("tag extraction returns exactly three relevant distinct labels", async () => {
  const { extractPreviewTags } = await cardViewModule();
  const tags = extractPreviewTags?.({
    title: "创建抖音视频解析Skill",
    summary: "完成抖音视频解析与字幕时间线生成。",
    recentInput: "需要下载视频并识别口播。",
    recentOutput: "已完成 ASR、OCR 和关键帧提取。",
  });
  assert.deepEqual(tags, ["抖音视频", "视频解析", "字幕提取"]);
});

test("tags summarize subject, work type, and outcome instead of raw keywords", async () => {
  const { extractPreviewTags } = await cardViewModule();
  const fixtures = [
    {
      preview: {
        title: "熔神序章",
        summary: "已完成优化并发送到钉钉“于博文”，sendStatus=SUCCESS。",
      },
      want: ["熔神", "内容优化", "钉钉交付"],
    },
    {
      preview: {
        title: "安装这个Skills",
        summary: "已完成灯仔 V2 优化设计，重点修正方盒子、工业样机感和灯罩比例。",
      },
      want: ["灯具设计", "Skill安装", "视觉优化"],
    },
    {
      preview: {
        title: "构建人物情绪优化 Skill",
        summary: "已优化成纯 Markdown 通用 Skill，可同时用于 Codex 和 WorkBuddy。",
      },
      want: ["人物情绪", "Skill开发", "通用交付"],
    },
    {
      preview: {
        title: "安装 Skill 并说明用法",
        summary: "Seedance 2.0 对照版已准备，尚未付费提交。",
      },
      want: ["Seedance", "Skill安装", "待付费提交"],
    },
    {
      preview: {
        title: "安装 Skill 并说明用法",
        summary: "Seedance 2.0 对照版已准备，尚未计费提交。",
      },
      want: ["Seedance", "Skill安装", "待计费提交"],
    },
    {
      preview: {
        title: "优化 Codex 对话展示交互样式",
        summary: "卡片视图改为每行固定展示两张，并修复侧栏错位。",
      },
      want: ["Codex侧栏", "界面优化", "卡片视图"],
    },
    {
      preview: {
        title: "修复项目看板打不开问题",
        summary: "Chromium 网络层拦截了 Local Network Access，已定位到页面权限检查。",
      },
      want: ["项目看板", "故障修复", "权限诊断"],
    },
    {
      preview: {
        title: "项目管理看板",
        summary: "根因已确认并修复：Codex 新安全检查拦截内嵌页面访问 127.0.0.1。",
      },
      want: ["项目看板", "故障修复", "本地访问"],
    },
    {
      preview: {
        title: "排查登录按钮点击无响应",
        summary: "定位到事件监听未绑定并已修复。",
      },
      want: ["登录按钮", "故障修复", "问题已解决"],
    },
  ];
  for (const { preview, want } of fixtures) {
    assert.deepEqual(extractPreviewTags?.(preview), want);
  }
});

test("examples mentioned in a summary do not override the conversation title scope", async () => {
  const { extractPreviewTags } = await cardViewModule();
  assert.deepEqual(extractPreviewTags?.({
    title: "优化 Codex 对话展示交互样式",
    summary: "标签示例包括人物情绪、Skill开发和钉钉交付，当前继续调整卡片布局。",
  }), ["Codex侧栏", "界面优化", "卡片视图"]);
});

test("semantic tags reject versions, status codes, and generic tool tokens", async () => {
  const { extractPreviewTags } = await cardViewModule();
  const tags = extractPreviewTags?.({
    title: "构建人物情绪优化 Skill",
    summary: "V16 已完成，SUCCESS；通用包包含 ZIP、API，并可用于 Codex。",
  });
  for (const lowValue of ["V16", "SUCCESS", "ZIP", "API", "Codex"]) {
    assert.equal(tags?.includes(lowValue), false);
  }
});

test("last communication time is compact and relative to the current day", async () => {
  const { formatLastCommunication } = await cardViewModule();
  const now = new Date("2026-08-09T12:00:00+08:00");
  const options = { timeZone: "Asia/Shanghai" };
  assert.equal(formatLastCommunication?.("2026-08-09T10:35:00+08:00", now, options), "10:35");
  assert.equal(formatLastCommunication?.("2026-08-08T23:10:00+08:00", now, options), "昨天 23:10");
  assert.equal(formatLastCommunication?.("2026-07-28T09:00:00+08:00", now, options), "7月28日");
  assert.equal(
    formatLastCommunication?.("2026-08-09T10:35:00+08:00", now, { timeZone: "UTC" }),
    "02:35",
  );
});

test("view switch exposes its current checked state and destination", async () => {
  const { viewTogglePresentation } = await cardViewModule();
  assert.deepEqual(viewTogglePresentation?.("list"), {
    mode: "list",
    checked: false,
    label: "卡片视图已关闭，切换为卡片视图",
  });
  assert.deepEqual(viewTogglePresentation?.("card"), {
    mode: "card",
    checked: true,
    label: "卡片视图已开启，切换为列表视图",
  });
});

test("card presentation always contains compact time, summary, and three tags", async () => {
  const { presentCardPreview } = await cardViewModule();
  const card = presentCardPreview?.({
    title: "侧栏展示优化",
    summary: "为 Codex 对话侧栏补充卡片视图和悬浮详情。",
    recentInput: "增加样式切换按钮。",
    recentOutput: "已完成交互实现。",
    updatedAt: "2026-08-09T10:35:00+08:00",
  }, new Date("2026-08-09T12:00:00+08:00"), { timeZone: "Asia/Shanghai" });
  assert.equal(card?.lastCommunication, "10:35");
  assert.equal(card?.summary, "为 Codex 对话侧栏补充卡片视图和悬浮详情。");
  assert.equal(card?.tags.length, 3);
  assert.equal(new Set(card?.tags).size, 3);
});

test("card layout adapts its columns and height to available space and content", async () => {
  const { cardLayoutPresentation } = await cardViewModule();
  assert.deepEqual(cardLayoutPresentation?.(), {
    columns: "auto-fit",
    minCardWidth: "min(100%, 10.5rem)",
    cardHeight: "auto",
    titleHeight: "content",
    summaryHeight: "content",
    tagCount: 3,
  });
});
