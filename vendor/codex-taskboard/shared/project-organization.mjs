import path from "node:path";

const CATEGORY_RULES = [
  {
    category: "learning",
    tokens: ["学习", "考试", "课程", "training", "course"],
  },
  {
    category: "automation",
    tokens: ["自动", "automation", "钉钉", "dingtalk", "日报", "统计", "report"],
  },
  {
    category: "assets",
    tokens: ["资产", "素材", "asset", "library"],
  },
  {
    category: "content-production",
    tokens: ["熔神", "短剧", "测试剧", "影视", "drama", "video", "seedance"],
  },
  {
    category: "engineering",
    tokens: ["codex", "skill", "cli", "github", "工程", "优化", "工具"],
  },
  {
    category: "work-management",
    tokens: ["工作", "理想", "创新", "管理"],
  },
];

export function normalizeWorkspacePath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return path.resolve(value.trim());
}

export function classifyProject(project) {
  const name = typeof project.name === "string" ? project.name.trim() : "";
  const workspacePath = normalizeWorkspacePath(project.workspacePath);
  const nameSearch = name.toLocaleLowerCase("zh-CN");
  const pathSearch = (workspacePath ?? "").toLocaleLowerCase("zh-CN");

  for (const rule of CATEGORY_RULES) {
    const nameToken = rule.tokens.find((token) => nameSearch.includes(token.toLocaleLowerCase("zh-CN")));
    if (nameToken) {
      return { category: rule.category, basis: [`名称包含“${nameToken}”`] };
    }
    const pathToken = rule.tokens.find((token) => pathSearch.includes(token.toLocaleLowerCase("zh-CN")));
    if (pathToken) {
      return { category: rule.category, basis: [`目录包含“${pathToken}”`] };
    }
  }

  return {
    category: "general",
    basis: [workspacePath ? "未命中已配置分类规则" : "缺少项目目录且未命中名称规则"],
  };
}

export function uniqueProjectSources(projects) {
  const byId = new Map();
  const seenPaths = new Set();
  const result = [];

  for (const project of projects) {
    const id = project.id.trim();
    const workspacePath = normalizeWorkspacePath(project.workspacePath);
    const existing = byId.get(id);
    if (existing) {
      if (!existing.workspacePath && workspacePath && !seenPaths.has(workspacePath)) {
        existing.workspacePath = workspacePath;
        seenPaths.add(workspacePath);
      }
      continue;
    }
    if (workspacePath && seenPaths.has(workspacePath)) continue;
    const normalized = { id, name: project.name.trim(), workspacePath };
    byId.set(id, normalized);
    if (workspacePath) seenPaths.add(workspacePath);
    result.push(normalized);
  }
  return result;
}

export function organizationTaskInput(project) {
  const workspacePath = normalizeWorkspacePath(project.workspacePath);
  const classification = classifyProject({ ...project, workspacePath });
  const directoryLine = workspacePath
    ? `项目目录：${workspacePath}`
    : "项目目录：待补充项目目录";
  return {
    title: `整理项目：${project.name}`,
    description: [
      `来源项目：${project.name}（${project.id}）`,
      directoryLine,
      `自动分类：${classification.category}`,
      `分类依据：${classification.basis.join("；")}`,
      "下一步：核对项目现状、未完成事项、交付物与验收标准；任何付费、发送、发布或权限变更仍需单独审批。",
    ].join("\n"),
    issueType: "automation_organization",
    status: "todo",
    priority: "none",
    labels: ["自动化整理", `项目分类:${classification.category}`],
    sourceProjectId: project.id,
    sourceProjectName: project.name,
    sourceWorkspacePath: workspacePath,
    projectCategory: classification.category,
    classificationBasis: classification.basis,
  };
}
