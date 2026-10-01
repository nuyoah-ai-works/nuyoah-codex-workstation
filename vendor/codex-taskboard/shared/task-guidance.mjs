const STAGE_LABELS = {
  backlog: "待梳理",
  todo: "待执行",
  in_progress: "执行中",
  in_review: "待查看",
  blocked: "待推进",
  done: "已完成",
  canceled: "已废弃",
};

const STATUS_NEXT_ACTIONS = {
  backlog: "确认范围与验收条件后开始执行",
  todo: "按任务描述开始执行并同步首轮结果",
  in_progress: "继续完成未验收项并补充验证证据",
  in_review: "按验收条件复核交付并给出明确反馈",
  blocked: "先解除阻塞条件，再恢复任务执行",
  done: "复核最终结果并沉淀可复用结论",
  canceled: "确认是否恢复，以及需要重新执行的范围",
};

const DESCRIPTION_HEADINGS = ["任务描述", "目标", "候选事项", "背景与来源", "背景", "交付物"];
const NEXT_HEADINGS = ["依赖与下一步", "下一步规划", "下一步建议", "下一步", "解除方式", "请求验收"];

function normalizedHeading(value) {
  return String(value || "")
    .replace(/[*_`：:]/g, "")
    .trim()
    .toLocaleLowerCase();
}

function cleanLine(value) {
  return String(value || "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/^\s*\[[ xX]\]\s*/, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function markdownSections(markdown) {
  const sections = [];
  let current = { heading: "", lines: [] };
  sections.push(current);
  let inFence = false;
  for (const rawLine of String(markdown || "").split(/\r?\n/)) {
    if (/^\s*```/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = rawLine.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
      || rawLine.match(/^\s*\*\*(.+?)\*\*\s*:?[：]?\s*$/);
    if (heading) {
      current = { heading: normalizedHeading(heading[1]), lines: [] };
      sections.push(current);
      continue;
    }
    current.lines.push(rawLine);
  }
  return sections;
}

function sectionValue(sections, headings) {
  for (const heading of headings) {
    const normalized = normalizedHeading(heading);
    const section = sections.find((candidate) => candidate.heading.includes(normalized));
    if (!section) continue;
    const value = section.lines.map(cleanLine).filter(Boolean).join(" ");
    if (value) return value;
  }
  return "";
}

function meaningfulDescription(markdown) {
  return String(markdown || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:#{1,6}\s+|```|[-*+]\s*\[[ xX]\])/.test(line))
    .map(cleanLine)
    .filter((line) => line && !/^(?:版本|状态|负责人|项目|标签|优先级)\s*[：:]/.test(line))
    .join(" ");
}

function uncheckedItems(markdown) {
  return String(markdown || "")
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^\s*[-*+]\s*\[\s\]\s*(.+)$/);
      const value = cleanLine(match?.[1]);
      return value ? [value] : [];
    });
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizedHeading(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function taskGuidance(task) {
  const sections = markdownSections(task?.description);
  const pending = uncheckedItems(task?.description);
  const description = clampText(
    sectionValue(sections, DESCRIPTION_HEADINGS)
      || meaningfulDescription(task?.description)
      || task?.title
      || "尚未补充任务描述",
    280,
  );
  const nextAction = clampText(
    sectionValue(sections, NEXT_HEADINGS)
      || pending[0]
      || STATUS_NEXT_ACTIONS[task?.status]
      || STATUS_NEXT_ACTIONS.todo,
    220,
  );
  const reviewAction = task?.status === "in_review"
    ? "按验收条件逐项复核并记录结论"
    : task?.status === "blocked"
      ? "定位当前阻塞并给出可执行的解除步骤"
      : "核对未完成项并补充可验证结果";
  const suggestions = unique([
    nextAction,
    pending.find((item) => normalizedHeading(item) !== normalizedHeading(nextAction)),
    reviewAction,
  ].filter(Boolean)).slice(0, 3).map((value) => clampText(value, 90));
  return {
    description,
    stage: STAGE_LABELS[task?.status] || "待执行",
    nextAction,
    suggestions,
  };
}

export function buildTaskExecutionPrompt({ task, projectName, workspacePath, suggestion }) {
  const guidance = taskGuidance(task);
  const pending = uncheckedItems(task?.description).slice(0, 8);
  const fullDescription = clampText(task?.description || "（未填写）", 7_000);
  const prompt = [
    "请使用 manage-taskboard Skill 读取此议题的最新版本、评论和约束，然后在对应项目中执行所选的下一步建议。保留现有交互与验收边界，不要凭空补写业务信息；完成后回写真实进展与验证证据，未经用户明确验收不要标记 done。",
    "",
    `议题：${task?.identifier || "未知"} ${task?.title || ""}`.trim(),
    `项目：${projectName || task?.projectId || "未知"}`,
    `项目目录：${workspacePath || "未映射"}`,
    `当前阶段：${guidance.stage}`,
    `任务摘要：${guidance.description}`,
    `当前下一步：${guidance.nextAction}`,
    `本次选择：${suggestion || guidance.nextAction}`,
    ...(pending.length ? ["", "未完成验收项：", ...pending.map((item) => `- ${item}`)] : []),
    "",
    "原始任务描述：",
    fullDescription,
  ].join("\n");
  return clampText(prompt, 12_000);
}
