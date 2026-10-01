import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const PRODUCTION_ACTION = /(生成|制作|创作|生产|出图|绘制|转绘|配音|剪辑|合成|渲染|generate|create|produce|render|draw|edit)/i;
const MEDIA_PURPOSE = /(图片|图像|角色图?|场景图?|道具图?|分镜|视频|音频|声音|配音|音乐|音效|动画|短剧|剧集|素材|资产|image|video|audio|voice|music|storyboard|asset)/i;
const STRONG_MEDIA_DIRECTORY = /(视觉资产|角色图?|场景图?|道具图?|分镜图?|视频|音频|声音|配音|音乐|音效|成片|预告)/i;
const GENERIC_MEDIA_DIRECTORY = /^(?:assets?|images?|pictures?|videos?|audio|media|renders?|outputs?|generated|generation)$/i;
const MARKER_FILES = [".codex-asset-project.json", path.join(".codex", "asset-project.json")];

function cleanString(value) {
  return String(value ?? "").trim();
}

function uniquePaths(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanString(value))
    .filter(Boolean)
    .map((value) => path.resolve(value)))];
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanString).filter(Boolean))];
}

function normalizeComparable(value) {
  return cleanString(value).normalize("NFKC").toLowerCase().replace(/[^a-z0-9\p{Script=Han}]+/gu, "");
}

function isPathInside(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

function isSafeProjectRoot(root, home = os.homedir()) {
  const resolved = path.resolve(root);
  return resolved !== path.parse(resolved).root && resolved !== path.resolve(home);
}

function normalizeCodexProject(value = {}) {
  const id = cleanString(value.id);
  const rootPaths = uniquePaths(value.rootPaths).filter((root) => isSafeProjectRoot(root));
  if (!id || !rootPaths.length) return null;
  return {
    id,
    name: cleanString(value.name) || path.basename(rootPaths[0]),
    rootPaths,
    updatedAt: Number(value.updatedAt) || 0,
  };
}

function parseUpdatedAt(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isProductionIntentTitle(title) {
  const value = cleanString(title);
  return Boolean(value && PRODUCTION_ACTION.test(value) && MEDIA_PURPOSE.test(value));
}

async function readJson(filePath) {
  try {
    return JSON.parse((await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function readLatestSessionTitles(filePath) {
  const latest = new Map();
  let content = "";
  try { content = await fs.readFile(filePath, "utf8"); } catch (error) {
    if (error.code === "ENOENT") return latest;
    throw error;
  }
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const id = cleanString(row.id).toLowerCase();
    const title = cleanString(row.thread_name);
    if (!id || !title) continue;
    const updatedAt = parseUpdatedAt(row.updated_at);
    const current = latest.get(id);
    if (!current || updatedAt >= current.updatedAt) latest.set(id, { title, updatedAt });
  }
  return latest;
}

async function inspectRoot(root) {
  const marker = (await Promise.all(MARKER_FILES.map(async (relative) => {
    try {
      return (await fs.stat(path.join(root, relative))).isFile();
    } catch {
      return false;
    }
  }))).some(Boolean);
  let score = 0;
  let visited = 0;
  async function walk(directory, depth) {
    if (depth > 2 || visited >= 160) return;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (visited >= 160) return;
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      visited += 1;
      if (STRONG_MEDIA_DIRECTORY.test(entry.name)) score += 2;
      else if (GENERIC_MEDIA_DIRECTORY.test(entry.name)) score += 1;
      if (score < 4) await walk(path.join(directory, entry.name), depth + 1);
    }
  }
  await walk(root, 0);
  return { marker, structure: score >= 2, structureScore: score };
}

function projectForAssociation(association, projects, assignments) {
  const threadId = cleanString(association.threadId).toLowerCase();
  const assignedProjectId = cleanString(assignments[threadId]?.projectId);
  const assigned = projects.find((project) => project.id === assignedProjectId);
  if (assigned) return assigned;
  const location = cleanString(association.cwd || association.assetPath);
  if (!location || !path.isAbsolute(location)) return null;
  return projects
    .filter((project) => project.rootPaths.some((root) => isPathInside(root, location)))
    .sort((left, right) => Math.max(...right.rootPaths.map((root) => root.length)) - Math.max(...left.rootPaths.map((root) => root.length)))[0] || null;
}

export function discoverProductionProjects({
  projects = [],
  assignments = {},
  titlesByThread = new Map(),
  associations = [],
  rootInspections = new Map(),
} = {}) {
  const normalizedProjects = projects.map(normalizeCodexProject).filter(Boolean);
  const ownershipCount = new Map();
  for (const project of normalizedProjects) {
    for (const root of project.rootPaths) ownershipCount.set(root, (ownershipCount.get(root) || 0) + 1);
  }

  const generationByProject = new Map(normalizedProjects.map((project) => [project.id, []]));
  for (const association of associations) {
    if (!association || !["image", "video", "audio"].includes(cleanString(association.kind))) continue;
    const project = projectForAssociation(association, normalizedProjects, assignments);
    if (project) generationByProject.get(project.id).push(association);
  }

  const intentThreadsByProject = new Map(normalizedProjects.map((project) => [project.id, new Set()]));
  for (const [threadId, assignment] of Object.entries(assignments || {})) {
    const projectId = cleanString(assignment?.projectId);
    const title = titlesByThread.get(threadId.toLowerCase())?.title || "";
    if (intentThreadsByProject.has(projectId) && isProductionIntentTitle(title)) {
      intentThreadsByProject.get(projectId).add(threadId.toLowerCase());
    }
  }

  const candidates = [];
  for (const project of normalizedProjects) {
    const generated = generationByProject.get(project.id) || [];
    const intentThreads = intentThreadsByProject.get(project.id) || new Set();
    const rootEvidence = project.rootPaths.map((root) => ({
      root,
      inspection: rootInspections.get(root) || { marker: false, structure: false, structureScore: 0 },
    }));
    const explicit = rootEvidence.some((item) => item.inspection.marker);
    const hasStructure = rootEvidence.some((item) => item.inspection.structure);
    const projectPurpose = MEDIA_PURPOSE.test(project.name);
    const qualifies = explicit
      || generated.length > 0 && (projectPurpose || intentThreads.size >= 1)
      || intentThreads.size >= 2 && hasStructure;
    if (!qualifies) continue;

    const inspectionByRoot = new Map(rootEvidence.map((item) => [item.root, item.inspection]));
    let folders = project.rootPaths.filter((root) => {
      if ((ownershipCount.get(root) || 0) <= 1) return true;
      if (normalizeComparable(path.basename(root)) === normalizeComparable(project.name)) return true;
      return Boolean(inspectionByRoot.get(root)?.marker);
    });
    if (!folders.length && project.rootPaths.length === 1) folders = [...project.rootPaths];
    if (!folders.length) continue;
    const generatedKinds = uniqueStrings(generated.map((association) => association.kind)).sort();
    const reasons = [];
    if (explicit) reasons.push("显式资产项目标记");
    if (generated.length) reasons.push(`${generated.length} 个 Codex 生成记录`);
    if (hasStructure) reasons.push("媒体制作目录结构");
    if (intentThreads.size) reasons.push(`${intentThreads.size} 个制作型任务`);
    candidates.push({
      codexProjectId: project.id,
      name: project.name,
      folders,
      generatedKinds,
      generatedThreadIds: uniqueStrings(generated.map((association) => association.threadId)),
      reason: reasons.join(" · "),
      codexUpdatedAt: project.updatedAt,
    });
  }
  return candidates.sort((left, right) => right.codexUpdatedAt - left.codexUpdatedAt || left.name.localeCompare(right.name, "zh-CN"));
}

function projectSlug(value) {
  const slug = cleanString(value).toLowerCase().replace(/[^a-z0-9\p{Script=Han}]+/gu, "-").replace(/^-+|-+$/g, "");
  return `codex-${slug || "production"}`;
}

function normalizeSyncMetadata(value = {}) {
  if (!value || typeof value !== "object" || !cleanString(value.projectId)) return null;
  return {
    projectId: cleanString(value.projectId),
    managedFolders: uniquePaths(value.managedFolders),
    excludedFolders: uniquePaths(value.excludedFolders),
    generatedKinds: uniqueStrings(value.generatedKinds),
    reason: cleanString(value.reason),
    userCustomizedName: Boolean(value.userCustomizedName),
    userCustomizedFolders: Boolean(value.userCustomizedFolders),
    lastSyncedAt: cleanString(value.lastSyncedAt),
  };
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSyncContent(left, right) {
  return left.projectId === right.projectId
    && sameArray(left.managedFolders, right.managedFolders)
    && sameArray(left.excludedFolders, right.excludedFolders)
    && sameArray(left.generatedKinds, right.generatedKinds)
    && left.reason === right.reason
    && left.userCustomizedName === right.userCustomizedName
    && left.userCustomizedFolders === right.userCustomizedFolders;
}

export function reconcileCodexProjects(projects = [], candidates = [], { now = new Date().toISOString() } = {}) {
  const output = structuredClone(projects);
  const created = [];
  const updated = [];
  for (const candidate of candidates) {
    const candidateFolders = uniquePaths(candidate.folders);
    if (!candidate.codexProjectId || !candidateFolders.length) continue;
    let project = output.find((item) => item.codexSync?.projectId === candidate.codexProjectId);
    if (!project) {
      project = output.find((item) => uniquePaths(item.folders).some((folder) => candidateFolders.includes(folder)));
    }
    if (!project) {
      const idBase = projectSlug(candidate.codexProjectId);
      let id = idBase;
      let index = 2;
      while (output.some((item) => item.id === id)) id = `${idBase}-${index++}`;
      project = {
        id,
        name: candidate.name,
        path: candidateFolders[0],
        scanRoots: ["."],
        folders: [...candidateFolders],
        codexSync: {
          projectId: candidate.codexProjectId,
          managedFolders: [...candidateFolders],
          excludedFolders: [],
          generatedKinds: uniqueStrings(candidate.generatedKinds),
          reason: cleanString(candidate.reason),
          userCustomizedName: false,
          userCustomizedFolders: false,
          lastSyncedAt: now,
        },
      };
      output.push(project);
      created.push(project.id);
      continue;
    }

    const previousSync = normalizeSyncMetadata(project.codexSync);
    const adopted = !previousSync;
    const sync = previousSync || {
      projectId: candidate.codexProjectId,
      managedFolders: uniquePaths(project.folders).filter((folder) => candidateFolders.includes(folder)),
      excludedFolders: [],
      generatedKinds: [],
      reason: "",
      userCustomizedName: true,
      userCustomizedFolders: true,
      lastSyncedAt: "",
    };
    const excluded = new Set(sync.excludedFolders);
    const managedFolders = candidateFolders.filter((folder) => !excluded.has(folder));
    const previousManaged = new Set(sync.managedFolders);
    const manualFolders = uniquePaths(project.folders).filter((folder) => !previousManaged.has(folder));
    const nextFolders = uniquePaths([...managedFolders, ...manualFolders]);
    const nextSync = {
      ...sync,
      projectId: candidate.codexProjectId,
      managedFolders,
      generatedKinds: uniqueStrings(candidate.generatedKinds),
      reason: cleanString(candidate.reason),
    };
    const nameChanged = !nextSync.userCustomizedName && project.name !== candidate.name;
    const foldersChanged = !sameArray(uniquePaths(project.folders), nextFolders);
    const syncChanged = adopted || !sameSyncContent(sync, nextSync);
    if (nameChanged) project.name = candidate.name;
    if (foldersChanged) {
      project.folders = nextFolders;
      project.path = nextFolders[0] || project.path;
      project.scanRoots = ["."];
    }
    if (nameChanged || foldersChanged || syncChanged) {
      project.codexSync = { ...nextSync, lastSyncedAt: now };
      updated.push(project.id);
    }
  }
  return { projects: output, created, updated, changed: Boolean(created.length || updated.length) };
}

export class CodexProductionProjectSync {
  constructor({
    globalStatePath = path.join(os.homedir(), ".codex", ".codex-global-state.json"),
    sessionIndexPath = path.join(os.homedir(), ".codex", "session_index.jsonl"),
  } = {}) {
    this.globalStatePath = path.resolve(globalStatePath);
    this.sessionIndexPath = path.resolve(sessionIndexPath);
    this.rootCache = new Map();
  }

  async inspectRoot(root) {
    try {
      const stats = await fs.stat(root);
      if (!stats.isDirectory()) return null;
      const cacheKey = `${stats.mtimeMs}:${stats.ctimeMs}`;
      const cached = this.rootCache.get(root);
      if (cached?.cacheKey === cacheKey) return cached.value;
      const value = await inspectRoot(root);
      this.rootCache.set(root, { cacheKey, value });
      return value;
    } catch {
      return null;
    }
  }

  async discover({ associations = [] } = {}) {
    const state = await readJson(this.globalStatePath);
    const projects = Object.values(state?.["local-projects"] || {});
    const assignments = state?.["thread-project-assignments"] || {};
    const titlesByThread = await readLatestSessionTitles(this.sessionIndexPath);
    const roots = uniquePaths(projects.flatMap((project) => project?.rootPaths || []));
    const inspections = await Promise.all(roots.map(async (root) => [root, await this.inspectRoot(root)]));
    const rootInspections = new Map(inspections.filter(([, inspection]) => inspection));
    return discoverProductionProjects({ projects, assignments, titlesByThread, associations, rootInspections });
  }
}

export { normalizeSyncMetadata as normalizeCodexSyncMetadata };
