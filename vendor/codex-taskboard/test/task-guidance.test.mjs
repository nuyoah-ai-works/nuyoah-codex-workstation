import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTaskExecutionPrompt, taskGuidance } from "../shared/task-guidance.mjs";

test("task guidance extracts a grounded description, stage, next action, and suggestions", () => {
  const task = {
    identifier: "DEMO-3",
    projectId: "demo",
    title: "补全项目筛选",
    status: "in_progress",
    description: [
      "## 任务描述",
      "从 Codex 完整项目目录补全筛选项，并保留项目中文名称。",
      "",
      "## 验收条件",
      "- [x] 管理优化可见",
      "- [ ] 我将成为超级创作者可见",
      "",
      "## 下一步",
      "完成真实页面坐标点击验证。",
    ].join("\n"),
  };
  assert.deepEqual(taskGuidance(task), {
    description: "从 Codex 完整项目目录补全筛选项，并保留项目中文名称。",
    stage: "执行中",
    nextAction: "完成真实页面坐标点击验证。",
    suggestions: ["完成真实页面坐标点击验证。", "我将成为超级创作者可见", "核对未完成项并补充可验证结果"],
  });
});

test("execution prompt keeps project context and selected suggestion without inventing details", () => {
  const prompt = buildTaskExecutionPrompt({
    task: {
      identifier: "DEMO-4",
      projectId: "demo",
      title: "验证筛选",
      status: "in_review",
      description: "## 验收条件\n- [ ] 点击文件夹后仅展示匹配项目",
    },
    projectName: "管理优化",
    workspacePath: "/Users/alice/management",
    suggestion: "点击文件夹并记录结果",
  });
  assert.match(prompt, /DEMO-4 验证筛选/);
  assert.match(prompt, /项目：管理优化/);
  assert.match(prompt, /项目目录：\/Users\/alice\/management/);
  assert.match(prompt, /本次选择：点击文件夹并记录结果/);
  assert.match(prompt, /未经用户明确验收不要标记 done/);
});
