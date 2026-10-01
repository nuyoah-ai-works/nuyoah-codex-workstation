import { fileType, previewFile } from '../../../nuyoah/assets/preview.mjs';
import { parseMidjourneyFilename } from '../../../nuyoah/assets/midjourney.mjs';
import { TaskContextStore } from '../../../nuyoah/workstation/task-context-store.mjs';
const taskContexts = new TaskContextStore();
const extraPreviewExts = new Set('.pdf .html .htm .xlsx .pptx .odt .ods .odp .zip .js .mjs .cjs .ts .tsx .jsx .py .sh .css .json .yaml .yml .toml .xml .sql .swift .rs .go .csv'.split(' '));
import { createServer } from "node:http";
import { createReadStream, promises as fs, readFileSync, watch } from "node:fs";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DownloadAutomation, normalizeAutomation } from "./download-automation.js";
import { GenerationPipeline } from "./generation-pipeline.js";
import { ExactDuplicateCleaner, normalizeDeduplication } from "./duplicate-cleaner.js";
import { PromptLibrary } from "./prompt-library.js";
import { ThreeDWorkbench } from "./three-d-workbench.js";
import { createProjectFolder, renameProjectFolder } from "./folder-operations.js";
import { buildImageSequenceProfiles, classifyLocalAsset } from "./asset-smart-classifier.js";
import { readImageDimensions } from "./image-dimensions.js";
import { createAssetScanCoordinator } from "./asset-scan-coordinator.js";
import { filterLibraryResult } from "./asset-library-filter.js";
import { PersistentAssetIndex, sameAssetIndexFolders } from "./persistent-asset-index.js";
import { CodexPromptAssociationStore } from "./codex-prompt-associations.js";
import {
  CodexProductionProjectSync,
  normalizeCodexSyncMetadata,
  reconcileCodexProjects,
} from "./codex-production-project-sync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(__dirname, "public");
const configPath = path.resolve(process.env.ASSET_BROWSER_CONFIG || path.join(__dirname, "asset-browser.config.json"));
const ledgerPath = path.resolve(process.env.ASSET_BROWSER_LEDGER || path.join(__dirname, ".asset-download-ledger.json"));
const generationRegistryPath = path.resolve(process.env.GENERATION_TICKETS || path.join(__dirname, ".generation-tickets.json"));
const generationBindingsPath = path.resolve(process.env.GENERATION_THREAD_BINDINGS || path.join(__dirname, ".thread-project-bindings.json"));
const promptAssociationRegistryPath = path.resolve(process.env.CODEX_PROMPT_ASSOCIATIONS || path.join(path.dirname(generationRegistryPath), ".codex-prompt-associations.json"));
const assetLibraryIndexPath = path.resolve(process.env.ASSET_LIBRARY_INDEX || path.join(path.dirname(configPath), ".asset-library-index.json"));
const duplicateLedgerPath = path.resolve(process.env.DUPLICATE_CLEANUP_LEDGER || path.join(__dirname, ".duplicate-cleanup-ledger.json"));
const duplicateQuarantinePath = path.resolve(process.env.DUPLICATE_QUARANTINE || path.join(__dirname, "duplicate-quarantine"));
const rhythmControlRegistryPath = path.resolve(process.env.RHYTHM_CONTROL_REGISTRY || path.join(__dirname, ".rhythm-control-tracks.json"));
const promptLibraryRoot = path.resolve(process.env.PROMPT_LIBRARY_ROOT || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "AssetBrowser", "prompt-library"));
const threeDRegistryPath = path.resolve(process.env.THREE_D_TASKS || path.join(__dirname, ".three-d-reconstruction-tasks.json"));
const actionTrashRoot = path.resolve(process.env.ASSET_ACTION_TRASH || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "AssetBrowser", "action-trash"));
const img2threejsSkillRoot = path.resolve(process.env.IMG2THREEJS_SKILL_ROOT || path.join(os.homedir(), ".codex", "skills", "img2threejs"));
const rhythmControlScriptPath = path.join(__dirname, "rhythm-control-track.py");
const audioSkillRoot = path.resolve(process.env.SCORE_MIX_SKILL_ROOT || path.join(os.homedir(), ".codex", "skills", "score-and-mix-picture"));
const aceStepLauncher = process.env.ACESTEP_LAUNCHER ? path.resolve(process.env.ACESTEP_LAUNCHER) : "";
const port = Number(process.env.PORT || 5177);
const apiTokenPath = path.resolve(process.env.ASSET_BROWSER_TOKEN_FILE || path.join(__dirname, ".api-token"));
const apiToken = String(process.env.ASSET_BROWSER_API_TOKEN || readFileSync(apiTokenPath, "utf8")).trim();
if (apiToken.length < 32) throw new Error(`AssetBrowser API token is missing or invalid: ${apiTokenPath}`);

const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif", ".heic", ".heif"]);
const videoExts = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const audioExts = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus"]);
const textExts = new Set([".md", ".markdown", ".txt", ".rtf", ".doc", ".docx"]);
const supportedAssetExts = new Set([...imageExts, ...videoExts, ...audioExts, ...textExts, ...extraPreviewExts]);
const libraryScanCoordinator = createAssetScanCoordinator();
const defaultAssetTaxonomy = {
  text: ["提示词", "Skills", "剧本", "文档"],
  image: ["角色", "场景", "道具", "分镜图", "参考图", "视频解析帧", "截图", "缩略图", "联系表", "过程图"],
  audio: ["音效", "音乐", "角色声音", "旁白"],
  video: ["预告", "成片", "抽卡片段", "素材片段"],
};
const sseClients = new Set();
const watcherHandles = new Map();
const pendingWatchPaths = new Set();
const libraryResponseCache = new Map();
const MAX_LIBRARY_RESPONSE_CACHE_ENTRIES = 4;
let watchFlushTimer = null;
let assetIndexUpdateQueue = Promise.resolve();
const downloadAutomation = new DownloadAutomation({ ledgerPath });
const generationPipeline = new GenerationPipeline({
  registryPath: generationRegistryPath,
  bindingsPath: generationBindingsPath
});
const promptAssociations = new CodexPromptAssociationStore({
  registryPath: promptAssociationRegistryPath,
  sessionsRoot: process.env.CODEX_SESSIONS_ROOT || path.join(os.homedir(), ".codex", "sessions"),
  generatedImagesRoot: process.env.CODEX_GENERATED_IMAGES_ROOT || path.join(os.homedir(), ".codex", "generated_images"),
});
const assetLibraryIndex = new PersistentAssetIndex({ filePath: assetLibraryIndexPath });
const codexProductionProjects = new CodexProductionProjectSync({
  globalStatePath: process.env.CODEX_GLOBAL_STATE || path.join(os.homedir(), ".codex", ".codex-global-state.json"),
  sessionIndexPath: process.env.CODEX_SESSION_INDEX || path.join(os.homedir(), ".codex", "session_index.jsonl"),
});
const duplicateCleaner = new ExactDuplicateCleaner({ ledgerPath: duplicateLedgerPath });
const promptLibrary = new PromptLibrary({ root: promptLibraryRoot });
const threeDWorkbench = new ThreeDWorkbench({ registryPath: threeDRegistryPath, skillRoot: img2threejsSkillRoot });
let automationBusy = false;
let promptAssociationSyncBusy = false;
let codexProjectSyncStatus = { state: "idle", lastRunAt: "", candidates: 0, created: 0, updated: 0, error: "" };
let configUpdateQueue = Promise.resolve();

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendJsonBuffer(res, body, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(body);
}

function rememberLibraryResponse(key, body) {
  if (libraryResponseCache.has(key)) libraryResponseCache.delete(key);
  libraryResponseCache.set(key, body);
  while (libraryResponseCache.size > MAX_LIBRARY_RESPONSE_CACHE_ENTRIES) {
    libraryResponseCache.delete(libraryResponseCache.keys().next().value);
  }
  return body;
}

function cachedLibraryResponse(library, filters) {
  const key = JSON.stringify({
    projectId: library.project?.id || "",
    mode: library.index?.mode || "",
    updatedAt: library.index?.updatedAt || "",
    settings: library.settings || {},
    filters,
  });
  const cached = libraryResponseCache.get(key);
  if (cached) {
    libraryResponseCache.delete(key);
    libraryResponseCache.set(key, cached);
    return cached;
  }
  return rememberLibraryResponse(key, Buffer.from(JSON.stringify(filterLibraryResult(library, filters))));
}

function invalidateLibraryResponseCache(projectId = "") {
  if (!projectId) {
    libraryResponseCache.clear();
    return;
  }
  for (const key of libraryResponseCache.keys()) {
    try {
      if (JSON.parse(key).projectId === projectId) libraryResponseCache.delete(key);
    } catch {
      libraryResponseCache.delete(key);
    }
  }
}

function sendText(res, text, status = 200) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function hasValidApiToken(req) {
  const supplied = String(req.headers["x-asset-console-token"] || "");
  const expected = Buffer.from(apiToken);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isAllowedLocalOrigin(req) {
  const origin = String(req.headers.origin || "");
  return !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function isProtectedLocalRoute(pathname) {
  return pathname.startsWith("/api/") || pathname === "/media" || pathname === "/download";
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  if (ext === ".avif") return "image/avif";
  if (ext === ".heic" || ext === ".heif") return "image/heic";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".ogg" || ext === ".oga") return "audio/ogg";
  if (ext === ".opus") return "audio/opus";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function safeResolve(root, requestedPath) {
  const decoded = decodeURIComponent(requestedPath || "");
  const absolute = path.resolve(root, decoded);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error("Path escapes project root");
  }
  return absolute;
}

function safeResolvePublic(requestedPath) {
  const withoutLeadingSlash = String(requestedPath || "").replace(/^\/+/, "");
  return safeResolve(publicRoot, withoutLeadingSlash || "index.html");
}

function normalizeScanRoots(values) {
  const roots = Array.isArray(values) ? values : [];
  const normalized = roots.flatMap((value) => {
    const candidate = String(value || "").trim();
    if (!candidate || candidate === ".") return ["."];
    const parts = candidate.replace(/[\\/]+/g, path.sep).split(path.sep).filter(Boolean);
    if (path.isAbsolute(candidate) || parts.some((part) => part === "..")) return [];
    return [parts.join(path.sep) || "."];
  });
  return [...new Set(normalized.length ? normalized : ["."])];
}

function normalizeProjectFolders(project = {}) {
  const explicit = Array.isArray(project.folders) ? project.folders : [];
  const legacyPath = String(project.path || "").trim();
  const legacyRoots = normalizeScanRoots(project.scanRoots);
  const candidates = explicit.length
    ? explicit
    : legacyPath
      ? legacyRoots.map((root) => path.resolve(legacyPath, root))
      : [];
  return [...new Set(candidates.map((item) => path.resolve(String(item || ""))).filter(Boolean))];
}

function normalizeAssetManagerSettings(value = {}) {
  const taxonomy = {};
  for (const [kind, defaults] of Object.entries(defaultAssetTaxonomy)) {
    const supplied = Array.isArray(value.taxonomy?.[kind]) ? value.taxonomy[kind] : [];
    taxonomy[kind] = [...new Set([...defaults, ...supplied].map((item) => String(item || "").trim()).filter(Boolean))];
  }
  return {
    columns: Math.max(1, Math.min(8, Number(value.columns) || 4)),
    tags: [...new Set((Array.isArray(value.tags) ? value.tags : []).map((item) => String(item || "").trim()).filter(Boolean))],
    taxonomy,
  };
}

function normalizeAssetMetadata(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([filePath, meta]) => [path.resolve(filePath), {
    category: String(meta?.category || ""),
    tags: [...new Set((Array.isArray(meta?.tags) ? meta.tags : []).map((item) => String(item || "").trim()).filter(Boolean))],
    smartGroup: ["asset", "review", "noise"].includes(meta?.smartGroup) ? meta.smartGroup : "",
  }]));
}

function normalizeAssetAssignments(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([filePath, projectId]) => [path.resolve(filePath), String(projectId || "")])
    .filter(([, projectId]) => projectId));
}

function systemCapabilities() {
  return {
    platform: process.platform,
    name: process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux",
    pathSeparator: path.sep,
    homeDirectory: os.homedir(),
  };
}

async function loadConfig() {
  try {
    const config = JSON.parse((await fs.readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
    return {
      enabled: config.enabled !== false,
      projects: (config.projects || []).map((project) => ({
        id: project.id,
        name: project.name || project.id,
        path: path.resolve(project.path || normalizeProjectFolders(project)[0] || "."),
        scanRoots: normalizeScanRoots(project.scanRoots),
        folders: normalizeProjectFolders(project),
        codexSync: normalizeCodexSyncMetadata(project.codexSync),
      })).filter((project) => project.id && project.folders.length),
      system: systemCapabilities(),
      automation: normalizeAutomation(config.automation),
      deduplication: normalizeDeduplication(config.deduplication, { defaultQuarantinePath: duplicateQuarantinePath }),
      assetManager: normalizeAssetManagerSettings(config.assetManager),
      assetMetadata: normalizeAssetMetadata(config.assetMetadata),
      assetAssignments: normalizeAssetAssignments(config.assetAssignments),
    };
  } catch {
    return {
      enabled: true,
      projects: [],
      system: systemCapabilities(),
      automation: normalizeAutomation(),
      deduplication: normalizeDeduplication({}, { defaultQuarantinePath: duplicateQuarantinePath }),
      assetManager: normalizeAssetManagerSettings(),
      assetMetadata: {},
      assetAssignments: {},
    };
  }
}

async function saveConfig(config) {
  const normalized = {
    enabled: config.enabled !== false,
    projects: (config.projects || []).map((project) => ({
      id: project.id,
      name: project.name || project.id,
      path: path.resolve(project.path),
      scanRoots: normalizeScanRoots(project.scanRoots),
      folders: normalizeProjectFolders(project),
      ...(normalizeCodexSyncMetadata(project.codexSync) ? { codexSync: normalizeCodexSyncMetadata(project.codexSync) } : {}),
    })),
    automation: normalizeAutomation(config.automation),
    deduplication: normalizeDeduplication(config.deduplication, { defaultQuarantinePath: duplicateQuarantinePath }),
    assetManager: normalizeAssetManagerSettings(config.assetManager),
    assetMetadata: normalizeAssetMetadata(config.assetMetadata),
    assetAssignments: normalizeAssetAssignments(config.assetAssignments),
  };
  const tempPath = path.join(
    path.dirname(configPath),
    `.${path.basename(configPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(tempPath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
    await fs.rename(tempPath, configPath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
  return normalized;
}

function updateConfig(mutator) {
  const operation = configUpdateQueue.then(async () => {
    const config = await loadConfig();
    const result = await mutator(config);
    const saved = await saveConfig(config);
    return { saved, result };
  });
  configUpdateQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function slugify(input) {
  const base = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return base || `project-${Date.now()}`;
}

async function getProject(projectId) {
  const config = await loadConfig();
  const project = config.projects.find((item) => item.id === projectId) || config.projects[0];
  if (!project) throw new Error("No configured project folders");
  return project;
}

async function getProjectStrict(projectId) {
  const config = await loadConfig();
  const project = config.projects.find((item) => item.id === projectId);
  if (!project) throw new Error(`项目不存在：${projectId || "未指定"}`);
  return project;
}

function safeResolveProject(project, requestedPath) {
  return safeResolve(project.path, requestedPath);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function cleanFileStem(value, fallback = "asset") {
  const stem = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  return stem || fallback;
}

async function uniqueAssetPath(desiredPath) {
  const dir = path.dirname(desiredPath);
  const ext = path.extname(desiredPath);
  const stem = path.basename(desiredPath, ext);
  for (let index = 1; index < 10000; index += 1) {
    const suffix = index === 1 ? "" : `-${String(index).padStart(2, "0")}`;
    const candidate = path.join(dir, `${stem}${suffix}${ext}`);
    const candidateStem = candidate.slice(0, -ext.length);
    if (!await exists(candidate) && !await exists(`${candidateStem}.prompt.md`) && !await exists(`${candidateStem}.meta.json`)) {
      return candidate;
    }
  }
  throw new Error("目标文件夹中同名素材过多，无法生成安全文件名");
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function directoryHasMedia(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.some((entry) => {
      if (!entry.isFile()) return false;
      const ext = path.extname(entry.name).toLowerCase();
      return imageExts.has(ext) || videoExts.has(ext) || audioExts.has(ext);
    });
  } catch {
    return false;
  }
}

async function countMediaFiles(dir) {
  try {
    const files = await walk(dir);
    return files.filter((filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      return imageExts.has(ext) || videoExts.has(ext) || audioExts.has(ext);
    }).length;
  } catch {
    return 0;
  }
}

async function readMeta(caseDir) {
  const metaPath = path.join(caseDir, ".asset-review-meta.json");
  try {
    return JSON.parse((await fs.readFile(metaPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

async function writeMeta(caseDir, meta) {
  const metaPath = path.join(caseDir, ".asset-review-meta.json");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
}

function assetKind(filePath, caseDir) {
  const ext = path.extname(filePath).toLowerCase();
  const rel = path.relative(caseDir, filePath);
  const parts = rel.split(path.sep);
  const base = path.basename(filePath).toLowerCase();
  if (videoExts.has(ext)) return "video";
  if (audioExts.has(ext)) return "audio";
  if (imageExts.has(ext) && base.includes("contact_sheet")) return "contact";
  if (imageExts.has(ext) && (parts.includes("frames") || /^frame[_-]/.test(base))) return "frame";
  if (imageExts.has(ext)) return "image";
  return "other";
}

function inferVersion(relPath) {
  const match = relPath.match(/(?:^|[_-])v(\d+)(?:[_\-.]|$)/i);
  if (match) return `v${match[1]}`;
  if (relPath.includes("两段式")) return "v4";
  if (relPath.includes("机制母版")) return "v5";
  if (relPath.includes("无首尾帧")) return "v3";
  if (relPath.includes("全能参考_v2")) return "v2";
  return "";
}

function initialStatus(relPath) {
  if (relPath.includes("机制母版_v5_test")) return "可用";
  if (relPath.includes("两段式_v4")) return "可用但需优化";
  if (relPath.includes("无首尾帧_v3")) return "可用但需优化";
  if (relPath.includes("v2") || relPath.includes("雨夜古风追逐")) return "不通过但有参考价值";
  return "未评估";
}

async function listProjects() {
  const config = await loadConfig();
  const projects = [];
  for (const project of config.projects) {
    projects.push({
      id: project.id,
      name: project.name,
      path: project.path,
      scanRoots: project.scanRoots,
      folders: project.folders,
      codexSync: project.codexSync || null,
      exists: (await Promise.all(project.folders.map((folder) => exists(folder)))).every(Boolean)
    });
  }
  return projects;
}

async function listProjectFolders(projectId) {
  const project = await getProjectStrict(projectId);
  const folders = [{ path: "", name: "项目根目录", depth: 0 }];
  const limit = 1500;
  const maxDepth = 8;

  async function collect(directory, relativePath = "", depth = 0) {
    if (depth >= maxDepth || folders.length >= limit) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
    for (const entry of directories) {
      if (folders.length >= limit) return;
      const childRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;
      folders.push({ path: childRelative, name: entry.name, depth: depth + 1 });
      await collect(path.join(directory, entry.name), childRelative, depth + 1);
    }
  }

  await collect(project.path);
  return { project: { id: project.id, name: project.name, path: project.path }, folders, truncated: folders.length >= limit };
}

async function addProjectFolder({ projectId, parentPath = "", name }) {
  const project = await getProjectStrict(projectId);
  const folder = await createProjectFolder({ projectPath: project.path, parentPath, name });
  let scanRootAdded = false;

  if (!folder.parentRelativePath) {
    try {
      const update = await updateConfig((config) => {
        const configuredProject = config.projects.find((item) => item.id === project.id);
        if (!configuredProject) throw new Error(`项目不存在：${project.id}`);
        const normalizeRoot = (value) => String(value || "").replace(/[\\/]+/g, path.sep).replace(/[\\/]+$/, "").toLowerCase();
        const roots = configuredProject.scanRoots || [];
        const scansWholeProject = roots.some((root) => ["", "."].includes(String(root || "").trim()));
        const targetRoot = normalizeRoot(folder.relativePath);
        if (scansWholeProject || roots.some((root) => normalizeRoot(root) === targetRoot)) return false;
        configuredProject.scanRoots = [...roots, folder.relativePath];
        return true;
      });
      scanRootAdded = update.result;
    } catch (error) {
      try {
        await fs.rmdir(folder.absolutePath);
      } catch (rollbackError) {
        throw new Error(`${error.message || error}；新文件夹回滚失败：${rollbackError.message || rollbackError}`);
      }
      throw error;
    }
  }

  if (scanRootAdded) await ensureWatchers().catch(() => {});
  notifyClients("project-change");
  return {
    path: folder.relativePath,
    name: folder.name,
    parentPath: folder.parentRelativePath,
    scanRootAdded,
  };
}

function normalizeRelativeDirectory(value) {
  const parts = String(value || "")
    .replace(/[\\/]+/g, path.sep)
    .split(path.sep)
    .filter((part) => part && part !== ".");
  return parts.join(path.sep);
}

function replaceRelativeDirectoryPrefix(value, previousPath, nextPath) {
  const candidate = normalizeRelativeDirectory(value);
  const previous = normalizeRelativeDirectory(previousPath);
  const next = normalizeRelativeDirectory(nextPath);
  if (!candidate || !previous) return candidate;
  const candidateParts = candidate.split(path.sep);
  const previousParts = previous.split(path.sep);
  const matches = previousParts.every((part, index) => candidateParts[index]?.toLowerCase() === part.toLowerCase());
  if (!matches) return candidate;
  return [...next.split(path.sep).filter(Boolean), ...candidateParts.slice(previousParts.length)].join(path.sep);
}

function relativeDirectoryFromBase(fullPath, basePath) {
  const full = normalizeRelativeDirectory(fullPath);
  const base = normalizeRelativeDirectory(basePath);
  if (!base) return full;
  if (full.toLowerCase() === base.toLowerCase()) return "";
  const prefix = `${base.toLowerCase()}${path.sep}`;
  return full.toLowerCase().startsWith(prefix) ? full.slice(base.length + 1) : null;
}

function rewriteAutomationDirectory(holder, previousPath, nextPath) {
  if (!holder || typeof holder !== "object") return false;
  const previousBasePath = normalizeRelativeDirectory(holder.basePath);
  const nextBasePath = replaceRelativeDirectoryPrefix(previousBasePath, previousPath, nextPath);
  let changed = nextBasePath !== previousBasePath;
  if (holder.routes && typeof holder.routes === "object") {
    for (const [kind, route] of Object.entries(holder.routes)) {
      const routePath = normalizeRelativeDirectory(route);
      const fullPath = normalizeRelativeDirectory([previousBasePath, routePath].filter(Boolean).join(path.sep));
      const rewrittenFullPath = replaceRelativeDirectoryPrefix(fullPath, previousPath, nextPath);
      if (rewrittenFullPath === fullPath) continue;
      const rewrittenRoute = relativeDirectoryFromBase(rewrittenFullPath, nextBasePath);
      if (rewrittenRoute !== null) {
        holder.routes[kind] = rewrittenRoute;
        changed = true;
      }
    }
  }
  holder.basePath = nextBasePath;
  return changed;
}

async function renameProjectDirectory({ projectId, path: folderPath, name }) {
  const project = await getProjectStrict(projectId);
  closeProjectWatchers(project.path);
  try {
    const folder = await renameProjectFolder({ projectPath: project.path, folderPath, name });
    if (folder.unchanged) {
      return {
        path: folder.relativePath,
        previousPath: folder.previousRelativePath,
        name: folder.name,
        previousName: folder.previousName,
        unchanged: true,
      };
    }

    try {
      await updateConfig((config) => {
        const configuredProject = config.projects.find((item) => item.id === project.id);
        if (!configuredProject) throw new Error(`项目不存在：${project.id}`);
        configuredProject.scanRoots = (configuredProject.scanRoots || [])
          .map((root) => ["", "."].includes(String(root || "").trim())
            ? root
            : replaceRelativeDirectoryPrefix(root, folder.previousRelativePath, folder.relativePath));

        if (config.automation?.inbox?.projectId === project.id) {
          rewriteAutomationDirectory(config.automation.inbox, folder.previousRelativePath, folder.relativePath);
        }
        for (const profile of config.automation?.routing?.profiles || []) {
          if (profile.projectId === project.id) {
            rewriteAutomationDirectory(profile, folder.previousRelativePath, folder.relativePath);
          }
        }
      });
    } catch (error) {
      try {
        await renameProjectFolder({
          projectPath: project.path,
          folderPath: folder.relativePath,
          name: folder.previousName,
        });
      } catch (rollbackError) {
        throw new Error(`${error.message || error}；文件夹改名回滚失败：${rollbackError.message || rollbackError}`);
      }
      throw error;
    }

    notifyClients("project-change");
    return {
      path: folder.relativePath,
      previousPath: folder.previousRelativePath,
      name: folder.name,
      previousName: folder.previousName,
      unchanged: false,
    };
  } finally {
    await ensureWatchers().catch(() => {});
  }
}

async function addProject({ name, path: projectPath, scanRoots, folders }) {
  const requestedFolders = Array.isArray(folders) && folders.length
    ? folders.map((folder) => path.resolve(String(folder || ""))).filter(Boolean)
    : projectPath
      ? normalizeScanRoots(scanRoots).map((root) => path.resolve(projectPath, root))
      : [];
  const absoluteFolders = [...new Set(requestedFolders)];
  if (!absoluteFolders.length) throw new Error("至少需要关联一个文件夹");
  for (const folder of absoluteFolders) {
    const stats = await fs.stat(folder).catch(() => null);
    if (!stats?.isDirectory()) throw new Error(`关联文件夹不存在：${folder}`);
  }
  const absolutePath = path.resolve(projectPath || absoluteFolders[0]);
  const { result: project } = await updateConfig((config) => {
    const idBase = slugify(name || path.basename(absolutePath));
    let id = idBase;
    let counter = 2;
    while (config.projects.some((item) => item.id === id)) id = `${idBase}-${counter++}`;
    const createdProject = {
      id,
      name: name || path.basename(absolutePath),
      path: absolutePath,
      scanRoots: normalizeScanRoots(scanRoots),
      folders: absoluteFolders,
    };
    config.projects.push(createdProject);
    return createdProject;
  });
  await ensureWatchers();
  notifyClients("project-change");
  return project;
}

async function updateProject(projectId, body = {}) {
  const requestedFolders = Array.isArray(body.folders)
    ? [...new Set(body.folders.map((folder) => path.resolve(String(folder || ""))).filter(Boolean))]
    : null;
  if (requestedFolders) {
    if (!requestedFolders.length) throw new Error("项目至少需要关联一个文件夹");
    for (const folder of requestedFolders) {
      const stats = await fs.stat(folder).catch(() => null);
      if (!stats?.isDirectory()) throw new Error(`关联文件夹不存在：${folder}`);
    }
  }
  const { result } = await updateConfig((config) => {
    const project = config.projects.find((item) => item.id === projectId);
    if (!project) throw new Error(`项目不存在：${projectId}`);
    const requestedName = String(body.name || "").trim();
    const codexSync = normalizeCodexSyncMetadata(project.codexSync);
    if (requestedName) {
      if (codexSync && requestedName !== project.name) codexSync.userCustomizedName = true;
      project.name = requestedName;
    }
    if (requestedFolders) {
      if (codexSync) {
        const requested = new Set(requestedFolders);
        const managed = new Set(codexSync.managedFolders);
        codexSync.excludedFolders = [...new Set([
          ...codexSync.excludedFolders.filter((folder) => !requested.has(folder)),
          ...codexSync.managedFolders.filter((folder) => !requested.has(folder)),
        ])];
        for (const folder of requested) {
          if (managed.has(folder)) codexSync.excludedFolders = codexSync.excludedFolders.filter((excluded) => excluded !== folder);
        }
        codexSync.userCustomizedFolders = true;
      }
      project.folders = requestedFolders;
      project.path = requestedFolders[0];
      project.scanRoots = ["."];
    }
    if (codexSync) project.codexSync = codexSync;
    return project;
  });
  await ensureWatchers();
  notifyClients("project-change");
  return result;
}

async function reorderProjects(projectIds) {
  if (!Array.isArray(projectIds)) throw new Error("Missing project order");
  await updateConfig((config) => {
    const byId = new Map(config.projects.map((project) => [project.id, project]));
    const ordered = [];
    const seen = new Set();
    for (const id of projectIds) {
      if (!byId.has(id) || seen.has(id)) continue;
      ordered.push(byId.get(id));
      seen.add(id);
    }
    for (const project of config.projects) {
      if (!seen.has(project.id)) ordered.push(project);
    }
    config.projects = ordered;
  });
  return listProjects();
}

async function writeMetaOrRemove(caseDir, meta) {
  if (Object.keys(meta).length) {
    await writeMeta(caseDir, meta);
  } else {
    await fs.rm(path.join(caseDir, ".asset-review-meta.json"), { force: true });
  }
}

function caseContainsPath(caseId, relativePath) {
  if (caseId === "." || caseId === "") return true;
  const normalizedCase = path.normalize(caseId);
  const normalizedPath = path.normalize(relativePath);
  return normalizedPath === normalizedCase || normalizedPath.startsWith(normalizedCase + path.sep);
}

async function transferReviewMeta({ sourceProject, sourceCaseId, sourceAssetId, targetProject, targetRelativePath }) {
  if (!sourceCaseId || !sourceAssetId) return null;
  const sourceCaseDir = safeResolveProject(sourceProject, sourceCaseId);
  if (!await exists(sourceCaseDir)) return null;
  const sourceAssetPath = safeResolve(sourceCaseDir, sourceAssetId);
  const sourceKey = path.relative(sourceCaseDir, sourceAssetPath);
  const sourceMeta = await readMeta(sourceCaseDir);
  const annotation = sourceMeta[sourceKey];
  if (!annotation) return null;

  const targetCases = await listCases(targetProject.id);
  const targetCase = targetCases
    .filter((item) => caseContainsPath(item.id, targetRelativePath))
    .sort((a, b) => b.id.length - a.id.length)[0];
  if (!targetCase) return null;
  const targetCaseDir = safeResolveProject(targetProject, targetCase.id);
  const targetAssetPath = safeResolveProject(targetProject, targetRelativePath);
  const targetKey = path.relative(targetCaseDir, targetAssetPath);

  const sameMetaFile = path.resolve(sourceCaseDir).toLowerCase() === path.resolve(targetCaseDir).toLowerCase();
  if (sameMetaFile) {
    delete sourceMeta[sourceKey];
    sourceMeta[targetKey] = annotation;
    await writeMetaOrRemove(sourceCaseDir, sourceMeta);
  } else {
    delete sourceMeta[sourceKey];
    await writeMetaOrRemove(sourceCaseDir, sourceMeta);
    const targetMeta = await readMeta(targetCaseDir);
    targetMeta[targetKey] = annotation;
    await writeMeta(targetCaseDir, targetMeta);
  }
  return { caseId: targetCase.id, assetId: targetKey };
}

function profileForTarget(config, targetProject, targetRelativePath) {
  const normalizedTarget = path.normalize(targetRelativePath || "").toLowerCase();
  return (config.automation?.routing?.profiles || [])
    .filter((profile) => profile.projectId === targetProject.id)
    .map((profile) => {
      const basePath = path.normalize(String(profile.basePath || "").trim()).replace(/^\.[\\/]/, "");
      const normalizedBase = basePath === "." ? "" : basePath.toLowerCase();
      const matches = !normalizedBase || normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}${path.sep}`);
      return matches ? { profile, length: normalizedBase.length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0]?.profile || null;
}

async function updateMovedSidecars(destinationPath, sourceProject, sourcePath, targetProject, targetProfile) {
  const ext = path.extname(destinationPath);
  const destinationStem = destinationPath.slice(0, -ext.length);
  const promptPath = `${destinationStem}.prompt.md`;
  const metaPath = `${destinationStem}.meta.json`;
  const oldRelative = path.relative(sourceProject.path, sourcePath);
  const newRelative = path.relative(targetProject.path, destinationPath);

  if (await exists(promptPath)) {
    try {
      const prompt = await fs.readFile(promptPath, "utf8");
      await fs.writeFile(promptPath, prompt
        .split(oldRelative).join(newRelative)
        .split(sourceProject.name).join(targetProject.name), "utf8");
    } catch {}
  }
  if (await exists(metaPath)) {
    try {
      const meta = JSON.parse((await fs.readFile(metaPath, "utf8")).replace(/^\uFEFF/, ""));
      const context = {
        ticketId: String(meta.ticket?.id || ""),
        outputId: String(meta.output?.id || ""),
        threadId: String(meta.ticket?.sourceContext?.threadId || meta.ticket?.sourceContext?.taskId || ""),
        sourceTask: String(meta.ticket?.sourceContext?.sourceTask || meta.ticket?.sourceContext?.taskTitle || "")
      };
      if (meta.ticket && typeof meta.ticket === "object") {
        meta.ticket.projectId = targetProject.id;
        meta.ticket.projectName = targetProject.name;
        meta.ticket.profileId = targetProfile?.id || "";
        meta.ticket.profileName = targetProfile?.name || "";
        meta.ticket.destinationRelativePath = path.dirname(newRelative);
        meta.ticket.routingResolution = {
          source: "manual-move",
          confidence: "high",
          matchedKeyword: "",
          matchedOn: "",
          threadId: context.threadId
        };
      }
      if (meta.output && typeof meta.output === "object") {
        meta.output.path = destinationPath;
        meta.output.relativePath = newRelative;
        meta.output.fileName = path.basename(destinationPath);
        meta.output.promptPath = promptPath;
        meta.output.metaPath = metaPath;
      }
      if (meta.project && typeof meta.project === "object") {
        meta.project.id = targetProject.id;
        meta.project.name = targetProject.name;
        meta.project.path = targetProject.path;
      }
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
      return context;
    } catch {}
  }
  return null;
}

async function moveAsset(body) {
  const config = await loadConfig();
  const sourceProject = await getProjectStrict(body.sourceProjectId);
  const targetProject = await getProjectStrict(body.targetProjectId);
  const sourcePath = safeResolveProject(sourceProject, body.sourcePath);
  const sourceStats = await fs.lstat(sourcePath);
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) throw new Error("只能移动普通素材文件");

  const targetDirectory = safeResolveProject(targetProject, body.targetDirectory || "");
  await fs.mkdir(targetDirectory, { recursive: true });
  const sourceExt = path.extname(sourcePath);
  const requestedName = String(body.fileName || path.basename(sourcePath)).trim();
  const requestedStem = cleanFileStem(path.basename(requestedName, path.extname(requestedName)), path.basename(sourcePath, sourceExt));
  const desiredPath = path.join(targetDirectory, `${requestedStem}${sourceExt}`);
  if (path.resolve(desiredPath).toLowerCase() === path.resolve(sourcePath).toLowerCase()) {
    throw new Error("素材已经在这个位置，请选择其他文件夹或修改文件名");
  }
  const destinationPath = await uniqueAssetPath(desiredPath);
  const sourceStem = sourcePath.slice(0, -sourceExt.length);
  const destinationStem = destinationPath.slice(0, -sourceExt.length);
  const mappings = [{ source: sourcePath, destination: destinationPath, role: "asset" }];
  for (const suffix of [".prompt.md", ".meta.json"]) {
    const sidecarSource = `${sourceStem}${suffix}`;
    if (await exists(sidecarSource)) mappings.push({ source: sidecarSource, destination: `${destinationStem}${suffix}`, role: suffix.slice(1) });
  }

  const staged = [];
  try {
    for (const mapping of mappings) {
      const temporaryPath = path.join(path.dirname(mapping.destination), `.${path.basename(mapping.destination)}.${process.pid}.${Date.now()}.moving`);
      await fs.copyFile(mapping.source, temporaryPath);
      const [sourceHash, copiedHash] = await Promise.all([hashFile(mapping.source), hashFile(temporaryPath)]);
      if (sourceHash !== copiedHash) throw new Error(`移动校验失败：${path.basename(mapping.source)}`);
      staged.push({ ...mapping, temporaryPath, sha256: sourceHash });
    }
    for (const mapping of staged) await fs.rename(mapping.temporaryPath, mapping.destination);
  } catch (error) {
    for (const mapping of staged) await fs.rm(mapping.temporaryPath, { force: true }).catch(() => {});
    throw error;
  }

  for (const mapping of mappings) await fs.rm(mapping.source, { force: false });
  const targetRelativePath = path.relative(targetProject.path, destinationPath);
  const targetProfile = profileForTarget(config, targetProject, targetRelativePath);
  const movedGeneration = await updateMovedSidecars(destinationPath, sourceProject, sourcePath, targetProject, targetProfile);
  let ticketRelocation = null;
  let taskBinding = null;
  let routingCorrectionError = "";
  if (movedGeneration?.ticketId) {
    try {
      ticketRelocation = await generationPipeline.relocateArchivedOutput(movedGeneration.ticketId, {
        projectId: targetProject.id,
        profileId: targetProfile?.id || "",
        oldPath: sourcePath,
        newPath: destinationPath,
        outputId: movedGeneration.outputId
      }, config);
      const metaPath = `${destinationStem}.meta.json`;
      if (await exists(metaPath)) {
        const meta = JSON.parse((await fs.readFile(metaPath, "utf8")).replace(/^\uFEFF/, ""));
        meta.ticket = { ...ticketRelocation.ticket, outputs: undefined, inboxBaseline: undefined };
        meta.output = ticketRelocation.output;
        meta.project = { id: targetProject.id, name: targetProject.name, path: targetProject.path };
        await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
      }
      const ledgerDir = path.join(targetProject.path, "生成记录");
      await fs.mkdir(ledgerDir, { recursive: true });
      await fs.appendFile(path.join(ledgerDir, "生成资产台账.jsonl"), JSON.stringify({
        schemaVersion: 1,
        event: "relocated",
        ticketId: movedGeneration.ticketId,
        projectId: targetProject.id,
        profileId: targetProfile?.id || "",
        previous: ticketRelocation.previous,
        output: ticketRelocation.output,
        movedAt: ticketRelocation.movedAt
      }) + "\n", "utf8");
    } catch (error) {
      routingCorrectionError = String(error.message || error);
    }
  }
  const canBindTarget = movedGeneration?.threadId
    && !["pending-review", "misc-library", "ai-reference-library", "reference-library"].includes(targetProject.id);
  if (canBindTarget) {
    try {
      taskBinding = await generationPipeline.bindThread({
        threadId: movedGeneration.threadId,
        projectId: targetProject.id,
        profileId: targetProfile?.id || "",
        source: "manual-asset-move",
        sourceTask: movedGeneration.sourceTask
      }, config);
    } catch (error) {
      routingCorrectionError ||= String(error.message || error);
    }
  }
  const reviewMeta = await transferReviewMeta({
    sourceProject,
    sourceCaseId: body.sourceCaseId,
    sourceAssetId: body.sourceAssetId,
    targetProject,
    targetRelativePath
  });
  return {
    sourceProjectId: sourceProject.id,
    sourcePath,
    sourceRelativePath: path.relative(sourceProject.path, sourcePath),
    sourceFileName: path.basename(sourcePath),
    targetProjectId: targetProject.id,
    targetProjectName: targetProject.name,
    destinationPath,
    targetRelativePath,
    fileName: path.basename(destinationPath),
    movedSidecars: staged.filter((item) => item.role !== "asset").map((item) => item.role),
    reviewMeta,
    taskBinding,
    ticketRelocation: ticketRelocation ? { ticketId: movedGeneration.ticketId, movedAt: ticketRelocation.movedAt } : null,
    routingCorrectionError
  };
}

async function batchMoveAssets(body) {
  if (!Array.isArray(body.items) || !body.items.length) throw new Error("没有可移动的素材");
  const results = [];
  const errors = [];
  for (const item of body.items.slice(0, 200)) {
    try {
      results.push(await moveAsset({
        ...item,
        targetProjectId: item.targetProjectId || body.targetProjectId,
        targetDirectory: item.targetDirectory ?? body.targetDirectory,
        fileName: item.fileName || path.basename(item.sourcePath || "")
      }));
    } catch (error) {
      errors.push({ sourcePath: item.sourcePath || "", message: String(error.message || error) });
    }
  }
  return { results, errors };
}

async function markAsset(body) {
  const project = await getProjectStrict(body.projectId);
  const caseDir = safeResolveProject(project, body.caseId);
  const assetPath = safeResolve(caseDir, body.assetId);
  const relToCase = path.relative(caseDir, assetPath);
  const meta = await readMeta(caseDir);
  const previous = meta[relToCase] || {};
  meta[relToCase] = {
    ...previous,
    userStatus: body.userStatus || "",
    notes: body.notes || "",
    favorite: Boolean(body.favorite),
    tags: Array.isArray(body.tags) ? body.tags : [],
    updatedAt: new Date().toISOString()
  };
  await writeMeta(caseDir, meta);
  return { projectId: project.id, caseId: body.caseId, assetId: relToCase, previous, meta: meta[relToCase] };
}

async function batchMarkAssets(body) {
  if (!Array.isArray(body.items) || !body.items.length) throw new Error("没有可标记的素材");
  const results = [];
  const errors = [];
  for (const item of body.items.slice(0, 500)) {
    try {
      results.push(await markAsset(item));
    } catch (error) {
      errors.push({ assetId: item.assetId || "", message: String(error.message || error) });
    }
  }
  return { results, errors };
}

function scheduleTrashPurge(tokenDirectory, delayMs = 15 * 60 * 1000) {
  const timer = setTimeout(() => fs.rm(tokenDirectory, { recursive: true, force: true }).catch(() => {}), delayMs);
  timer.unref?.();
}

async function trashAssets(body) {
  if (!Array.isArray(body.items) || !body.items.length) throw new Error("没有可删除的素材");
  const token = randomUUID();
  const tokenDirectory = safeResolve(actionTrashRoot, token);
  const storedItems = [];
  let originalsTouched = false;
  await fs.mkdir(tokenDirectory, { recursive: true });

  try {
    for (const [index, item] of body.items.slice(0, 200).entries()) {
      const project = await getProjectStrict(item.projectId);
      const sourcePath = safeResolveProject(project, item.sourcePath);
      const stats = await fs.lstat(sourcePath);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`只能删除普通素材文件：${item.sourcePath}`);
      const sourceExt = path.extname(sourcePath);
      const sourceStem = sourcePath.slice(0, -sourceExt.length);
      const mappings = [{ source: sourcePath, name: path.basename(sourcePath), role: "asset" }];
      for (const suffix of [".prompt.md", ".meta.json"]) {
        const sidecar = `${sourceStem}${suffix}`;
        if (await exists(sidecar)) mappings.push({ source: sidecar, name: path.basename(sidecar), role: suffix.slice(1) });
      }

      const storedDirectory = path.join(tokenDirectory, "files", String(index));
      await fs.mkdir(storedDirectory, { recursive: true });
      const storedMappings = [];
      for (const mapping of mappings) {
        const storedPath = path.join(storedDirectory, mapping.name);
        await fs.copyFile(mapping.source, storedPath);
        const [sourceHash, storedHash] = await Promise.all([hashFile(mapping.source), hashFile(storedPath)]);
        if (sourceHash !== storedHash) throw new Error(`删除前校验失败：${mapping.name}`);
        storedMappings.push({ ...mapping, storedPath: path.relative(tokenDirectory, storedPath), sha256: sourceHash });
      }

      let reviewMeta = null;
      if (item.caseId && item.assetId) {
        const caseDir = safeResolveProject(project, item.caseId);
        const assetPath = safeResolve(caseDir, item.assetId);
        const key = path.relative(caseDir, assetPath);
        const meta = await readMeta(caseDir);
        if (meta[key]) reviewMeta = { caseId: item.caseId, assetId: key, value: meta[key] };
      }
      storedItems.push({ projectId: project.id, sourcePath: item.sourcePath, mappings: storedMappings, reviewMeta });
    }

    const manifest = { token, createdAt: new Date().toISOString(), items: storedItems };
    await fs.writeFile(path.join(tokenDirectory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

    originalsTouched = true;
    for (const item of storedItems) {
      for (const mapping of item.mappings) await fs.rm(mapping.source, { force: false });
      if (item.reviewMeta) {
        const project = await getProjectStrict(item.projectId);
        const caseDir = safeResolveProject(project, item.reviewMeta.caseId);
        const meta = await readMeta(caseDir);
        delete meta[item.reviewMeta.assetId];
        await writeMetaOrRemove(caseDir, meta);
      }
    }
    scheduleTrashPurge(tokenDirectory);
    return { token, count: storedItems.length, expiresInMs: 15 * 60 * 1000 };
  } catch (error) {
    if (!originalsTouched) await fs.rm(tokenDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function restoreTrashedAssets(body) {
  const token = String(body.token || "").trim();
  if (!token) throw new Error("缺少撤销记录");
  const tokenDirectory = safeResolve(actionTrashRoot, token);
  const manifest = JSON.parse((await fs.readFile(path.join(tokenDirectory, "manifest.json"), "utf8")).replace(/^\uFEFF/, ""));

  for (const item of manifest.items || []) {
    const project = await getProjectStrict(item.projectId);
    for (const mapping of item.mappings || []) {
      const destination = safeResolveProject(project, path.relative(project.path, mapping.source));
      if (await exists(destination)) throw new Error(`原位置已有同名文件，无法撤销：${path.basename(destination)}`);
    }
  }

  for (const item of manifest.items || []) {
    const project = await getProjectStrict(item.projectId);
    for (const mapping of item.mappings || []) {
      const storedPath = safeResolve(tokenDirectory, mapping.storedPath);
      const destination = safeResolveProject(project, path.relative(project.path, mapping.source));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${process.pid}.${Date.now()}.restoring`;
      await fs.copyFile(storedPath, temporary);
      const restoredHash = await hashFile(temporary);
      if (restoredHash !== mapping.sha256) {
        await fs.rm(temporary, { force: true });
        throw new Error(`撤销校验失败：${path.basename(destination)}`);
      }
      await fs.rename(temporary, destination);
    }
    if (item.reviewMeta) {
      const caseDir = safeResolveProject(project, item.reviewMeta.caseId);
      const meta = await readMeta(caseDir);
      meta[item.reviewMeta.assetId] = item.reviewMeta.value;
      await writeMeta(caseDir, meta);
    }
  }
  await fs.rm(tokenDirectory, { recursive: true, force: true });
  return { token, count: manifest.items?.length || 0 };
}

async function appendCaseDirectories({ project, scanRoot, rootDir, currentDir = rootDir, depth = 1, maxDepth = 1, cases }) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const caseDir = path.join(currentDir, entry.name);
    const stats = await fs.stat(caseDir);
    const relPath = path.relative(project.path, caseDir);
    cases.push({
      id: relPath,
      projectId: project.id,
      name: entry.name.replace(/^\d{4}-\d{2}-\d{2}-/, ""),
      relPath,
      scanRoot,
      mediaCount: await countMediaFiles(caseDir),
      mtimeMs: stats.mtimeMs
    });
    if (depth < maxDepth) {
      await appendCaseDirectories({ project, scanRoot, rootDir, currentDir: caseDir, depth: depth + 1, maxDepth, cases });
    }
  }
}

async function listCases(projectId) {
  const project = await getProject(projectId);
  const cases = [];
  for (const scanRoot of project.scanRoots) {
    const rootDir = safeResolveProject(project, scanRoot);
    if (!await exists(rootDir)) continue;
    const rootStats = await fs.stat(rootDir);
    if (await directoryHasMedia(rootDir)) {
      const rootRelPath = path.relative(project.path, rootDir) || ".";
      cases.push({
        id: rootRelPath,
        projectId: project.id,
        name: path.basename(rootDir),
        relPath: rootRelPath,
        scanRoot,
        mediaCount: await countMediaFiles(rootDir),
        mtimeMs: rootStats.mtimeMs
      });
    }
    const maxDepth = ["ai-reference-library", "reference-library"].includes(project.id) ? 5 : 1;
    await appendCaseDirectories({ project, scanRoot, rootDir, maxDepth, cases });
  }
  return cases.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function listAssets(projectId, caseId) {
  const project = await getProject(projectId);
  const caseDir = safeResolveProject(project, caseId);
  if (!await exists(caseDir)) throw new Error(`Case not found: ${caseId}`);
  const files = await walk(caseDir);
  const meta = await readMeta(caseDir);
  const assets = [];
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    if (!imageExts.has(ext) && !videoExts.has(ext) && !audioExts.has(ext)) continue;
    const stats = await fs.stat(filePath);
    const relToCase = path.relative(caseDir, filePath);
    const relToProject = path.relative(project.path, filePath);
    const kind = assetKind(filePath, caseDir);
    const stored = meta[relToCase] || {};
    assets.push({
      id: relToCase,
      projectId: project.id,
      projectName: project.name,
      caseId,
      kind,
      version: inferVersion(relToCase),
      name: path.basename(filePath),
      relPath: relToProject,
      caseRelPath: relToCase,
      dir: path.dirname(relToProject),
      mediaUrl: `/media?project=${encodeURIComponent(project.id)}&path=${encodeURIComponent(relToProject)}`,
      downloadUrl: `/download?project=${encodeURIComponent(project.id)}&path=${encodeURIComponent(relToProject)}`,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      mtime: new Date(stats.mtimeMs).toISOString(),
      initialStatus: initialStatus(relToCase),
      userStatus: stored.userStatus || "",
      notes: stored.notes || "",
      favorite: Boolean(stored.favorite),
      tags: stored.tags || []
    });
  }
  return assets.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function isPathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function encodeAssetRef(filePath) {
  return Buffer.from(path.resolve(filePath), "utf8").toString("base64url");
}

function decodeAssetRef(value) {
  try {
    const decoded = Buffer.from(String(value || ""), "base64url").toString("utf8");
    if (!decoded || !path.isAbsolute(decoded)) throw new Error();
    return path.resolve(decoded);
  } catch {
    throw new Error("素材引用无效");
  }
}

function allManagedFolders(config) {
  return [...new Set(config.projects.flatMap((project) => project.folders || normalizeProjectFolders(project)))];
}

async function resolveManagedAsset(config, assetRef) {
  const filePath = decodeAssetRef(assetRef);
  const managed = allManagedFolders(config).some((folder) => isPathInside(folder, filePath))
    || Object.hasOwn(config.assetAssignments || {}, filePath);
  if (!managed) throw new Error("素材不属于任何本地项目");
  const stats = await fs.lstat(filePath).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink()) throw new Error("素材文件不存在或不是普通文件");
  return { filePath, stats };
}

async function walkLibrary(directory, files, limit = 30000) {
  if (files.length >= limit) return;
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= limit) return;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await walkLibrary(filePath, files, limit);
    } else if (entry.isFile() && !entry.name.endsWith(".meta.json") && supportedAssetExts.has(path.extname(entry.name).toLowerCase())) {
      files.push(filePath);
    }
  }
}

function libraryAssetKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (textExts.has(ext) || extraPreviewExts.has(ext)) return "text";
  if (imageExts.has(ext)) return "image";
  if (audioExts.has(ext)) return "audio";
  if (videoExts.has(ext)) return "video";
  return "other";
}

function inferAssetCategory(filePath, kind) {
  const haystack = filePath.toLowerCase();
  const rules = {
    text: [
      ["Skills", ["skill.md", "skills", "技能"]],
      ["提示词", ["prompt", "提示词", "提示語"]],
      ["剧本", ["screenplay", "script", "剧本", "分集"]],
    ],
    image: [
      ["分镜图", ["storyboard", "分镜", "shot"]],
      ["角色", ["character", "角色", "人物"]],
      ["场景", ["scene", "场景", "环境"]],
      ["道具", ["prop", "道具"]],
    ],
    audio: [
      ["角色声音", ["voice", "角色声音", "音色", "对白"]],
      ["音效", ["sfx", "sound effect", "音效"]],
      ["音乐", ["music", "bgm", "音乐", "配乐"]],
      ["旁白", ["narration", "voiceover", "旁白"]],
    ],
    video: [
      ["预告", ["trailer", "teaser", "预告"]],
      ["成片", ["final", "master", "成片", "正片"]],
      ["抽卡片段", ["抽卡", "draw", "card clip"]],
    ],
  };
  const match = (rules[kind] || []).find(([, tokens]) => tokens.some((token) => haystack.includes(token)));
  return match?.[0] || (kind === "image" ? "参考图" : defaultAssetTaxonomy[kind]?.at(-1)) || "其他";
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function readZipEntries(buffer) {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error("Word 文档结构无效");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Word 文档目录损坏");
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const modTime = buffer.readUInt16LE(cursor + 12);
    const modDate = buffer.readUInt16LE(cursor + 14);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (flags & 1) throw new Error("不支持加密的 Word 文档");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Word 文档内容损坏");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!data || data.length !== uncompressedSize) throw new Error(`不支持的 Word 压缩格式：${method}`);
    entries.push({ name, data, method, modTime, modDate, crc, externalAttributes });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
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

function writeZipEntries(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const method = entry.name.endsWith("/") || !data.length ? 0 : 8;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(entry.modTime || 0, 10);
    local.writeUInt16LE(entry.modDate || 0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(entry.modTime || 0, 12);
    central.writeUInt16LE(entry.modDate || 0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.externalAttributes || 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function extractDocxText(buffer) {
  const document = readZipEntries(buffer).find((entry) => entry.name === "word/document.xml");
  if (!document) throw new Error("Word 文档缺少正文");
  const xml = document.data.toString("utf8");
  return [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((paragraph) => {
    const body = paragraph[1].replace(/<w:tab\s*\/>/g, "\t").replace(/<w:(?:br|cr)\s*\/>/g, "\n");
    return [...body.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => decodeXmlEntities(match[1])).join("");
  }).join("\n");
}

function replaceDocxText(buffer, text) {
  const entries = readZipEntries(buffer);
  const document = entries.find((entry) => entry.name === "word/document.xml");
  if (!document) throw new Error("Word 文档缺少正文");
  const xml = document.data.toString("utf8");
  const match = xml.match(/^([\s\S]*?<w:body\b[^>]*>)([\s\S]*)(<\/w:body>[\s\S]*)$/);
  if (!match) throw new Error("Word 正文结构无法编辑");
  const section = match[2].match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] || "";
  const paragraphs = String(text || "").split(/\r?\n/).map((line) => line
    ? `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
    : "<w:p/>").join("");
  document.data = Buffer.from(`${match[1]}${paragraphs}${section}${match[3]}`, "utf8");
  return writeZipEntries(entries);
}

async function textAssetContent(filePath, maxBytes = 5 * 1024 * 1024) {
  const ext = path.extname(filePath).toLowerCase();
  const stats = await fs.stat(filePath);
  if (stats.size > maxBytes) throw new Error("文本文件超过 5MB，无法在卡片编辑器中打开");
  if (ext === ".docx") return extractDocxText(await fs.readFile(filePath));
  if (ext === ".doc") throw new Error("旧版 .doc 仅作为资产管理；请先另存为 .docx 后编辑");
  const raw = await fs.readFile(filePath, "utf8");
  return ext === ".rtf"
    ? raw.replace(/\\'[0-9a-f]{2}/gi, "").replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "").trim()
    : raw;
}

async function readTextPreview(filePath) {
  try {
    const text = extraPreviewExts.has(path.extname(filePath).toLowerCase())
      ? (await previewFile(filePath)).text : await textAssetContent(filePath, 2 * 1024 * 1024);
    return text.replace(/\s+/g, " ").trim().slice(0, 420);
  } catch (error) {
    return String(error.message || error);
  }
}

async function buildLibraryAsset(filePath, project, config, assignment, classificationContext) {
  const stats = await fs.stat(filePath);
  const kind = libraryAssetKind(filePath);
  const dimensions = kind === "image" ? await readImageDimensions(filePath).catch(() => null) : null;
  const promptAssociation = ["image", "video", "audio"].includes(kind)
    ? await promptAssociations.summary(filePath)
    : { available: false };
  const metadata = config.assetMetadata?.[filePath] || {};
  const assetRef = encodeAssetRef(filePath);
  const classification = classifyLocalAsset({
    filePath,
    kind,
    metadata,
    inferredCategory: inferAssetCategory(filePath, kind),
    width: dimensions?.width || 0,
    height: dimensions?.height || 0,
  }, classificationContext);
  return {
    id: assetRef,
    sourcePath: filePath,
    projectId: project.id,
    projectName: project.name,
    name: path.basename(filePath),
    title: path.basename(filePath, path.extname(filePath)),
    extension: path.extname(filePath).slice(1).toUpperCase(),
    previewType: fileType(filePath),
    mjProfiles: parseMidjourneyFilename(path.basename(filePath))?.profiles || [],
    kind,
    category: classification.category,
    tags: classification.tags,
    smartGroup: classification.smartGroup,
    autoTags: classification.autoTags,
    confidence: classification.confidence,
    classificationReason: classification.reason,
    classificationSource: classification.source,
    tokenCost: classification.tokenCost,
    size: stats.size,
    width: dimensions?.width || 0,
    height: dimensions?.height || 0,
    mtimeMs: stats.mtimeMs,
    mtime: new Date(stats.mtimeMs).toISOString(),
    directory: path.dirname(filePath),
    assigned: Boolean(assignment),
    promptAssociation,
    editable: kind === "text" && !extraPreviewExts.has(path.extname(filePath).toLowerCase()) && ![".doc", ".rtf"].includes(path.extname(filePath).toLowerCase()),
    preview: kind === "text" ? await readTextPreview(filePath) : "",
    mediaUrl: `/media?id=${encodeURIComponent(assetRef)}`,
    downloadUrl: `/download?id=${encodeURIComponent(assetRef)}`,
  };
}

function indexedAssetPath(asset) {
  try {
    return path.resolve(asset?.sourcePath || decodeAssetRef(asset?.id));
  } catch {
    return "";
  }
}

function projectContainsAsset(project, filePath, config) {
  const resolved = path.resolve(filePath);
  const assignment = config.assetAssignments?.[resolved] || "";
  if (assignment) return assignment === project.id;
  return project.folders.some((folder) => isPathInside(folder, resolved));
}

async function buildLibraryAssets(project, config, candidates, contextPaths = candidates) {
  const unique = [...new Set(candidates.map((item) => path.resolve(item)))];
  const classificationContext = {
    profiles: buildImageSequenceProfiles(
      [...new Set(contextPaths.map((item) => path.resolve(item)))]
        .filter((filePath) => libraryAssetKind(filePath) === "image"),
      path,
    ),
    pathApi: path,
  };
  const assets = [];
  for (const filePath of unique) {
    if (filePath.endsWith(".meta.json") || !supportedAssetExts.has(path.extname(filePath).toLowerCase())) continue;
    if (!projectContainsAsset(project, filePath, config) || !await exists(filePath)) continue;
    const assignment = config.assetAssignments?.[filePath] || "";
    const asset = await buildLibraryAsset(filePath, project, config, assignment, classificationContext);
    assets.push(asset);
  }
  return assets;
}

function createLibraryResult(project, entry, settings, mode) {
  const assets = (entry?.assets || [])
    .map((asset) => asset.projectId === project.id && asset.projectName === project.name
      ? asset
      : { ...asset, projectId: project.id, projectName: project.name })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  const counts = { all: assets.length, text: 0, image: 0, audio: 0, video: 0 };
  const smartCounts = { asset: 0, review: 0, noise: 0 };
  for (const asset of assets) {
    counts[asset.kind] = (counts[asset.kind] || 0) + 1;
    smartCounts[asset.smartGroup] = (smartCounts[asset.smartGroup] || 0) + 1;
  }
  return {
    project: { id: project.id, name: project.name, folders: project.folders },
    assets,
    counts,
    smartCounts,
    settings,
    index: {
      mode,
      initializedAt: entry?.initializedAt || "",
      updatedAt: entry?.updatedAt || "",
      persistent: true,
    },
  };
}

async function rebuildLibraryIndex(project, config, mode = "initial-scan") {
  const candidates = [];
  for (const folder of project.folders) await walkLibrary(folder, candidates);
  for (const [filePath, assignedProjectId] of Object.entries(config.assetAssignments || {})) {
    if (assignedProjectId === project.id && supportedAssetExts.has(path.extname(filePath).toLowerCase())) candidates.push(filePath);
  }
  const assets = await buildLibraryAssets(project, config, candidates);
  const entry = await assetLibraryIndex.replaceProject(project, assets);
  invalidateLibraryResponseCache(project.id);
  return createLibraryResult(project, entry, config.assetManager, mode);
}

async function reconcileIndexedProject(project, config, entry) {
  const existingPaths = entry.assets.map(indexedAssetPath).filter(Boolean);
  const existingIds = new Set(entry.assets.map((asset) => String(asset.id)));
  const removeIds = entry.assets
    .filter((asset) => {
      const filePath = indexedAssetPath(asset);
      return !filePath || !projectContainsAsset(project, filePath, config);
    })
    .map((asset) => String(asset.id));
  const addedFolders = project.folders.filter((folder) => !entry.folders.includes(path.resolve(folder)));
  const candidates = [];
  for (const folder of addedFolders) await walkLibrary(folder, candidates);
  for (const [filePath, assignedProjectId] of Object.entries(config.assetAssignments || {})) {
    const id = encodeAssetRef(filePath);
    if (assignedProjectId === project.id && !existingIds.has(id)) candidates.push(filePath);
  }
  const upserts = await buildLibraryAssets(project, config, candidates, [...existingPaths, ...candidates]);
  if (!removeIds.length && !upserts.length && sameAssetIndexFolders(entry.folders, project.folders)) return entry;
  const patched = await assetLibraryIndex.patchProject(project, {
    upserts,
    removeIds,
    folders: project.folders,
  });
  invalidateLibraryResponseCache(project.id);
  return patched;
}

async function listLibraryAssets(projectId, { force = false } = {}) {
  const config = await loadConfig();
  const project = config.projects.find((item) => item.id === projectId) || config.projects[0];
  if (!project) return {
    project: null,
    assets: [],
    counts: { all: 0, text: 0, image: 0, audio: 0, video: 0 },
    smartCounts: { asset: 0, review: 0, noise: 0 },
    settings: config.assetManager,
    index: { mode: "empty", initializedAt: "", updatedAt: "", persistent: true },
  };
  if (force) return rebuildLibraryIndex(project, config, "manual-rescan");
  const existing = await assetLibraryIndex.getProject(project.id);
  if (!existing) return rebuildLibraryIndex(project, config, "initial-scan");
  if (existing.assetFormatVersion < 2) return rebuildLibraryIndex(project, config, "format-upgrade");
  const entry = await reconcileIndexedProject(project, config, existing);
  const mode = sameAssetIndexFolders(existing.folders, project.folders) ? "persistent" : "folder-incremental";
  return createLibraryResult(project, entry, config.assetManager, mode);
}

async function assignAssetToProject(body = {}) {
  const config = await loadConfig();
  const { filePath } = await resolveManagedAsset(config, body.assetId);
  const target = config.projects.find((project) => project.id === body.targetProjectId);
  if (!target) throw new Error("目标项目不存在");
  await updateConfig((draft) => { draft.assetAssignments[filePath] = target.id; });
  await enqueueAssetIndexUpdate([filePath]);
  notifyClients("asset-change");
  return { assetId: encodeAssetRef(filePath), targetProjectId: target.id, movedFile: false };
}

async function clearAssetProjectAssignment(body = {}) {
  const config = await loadConfig();
  const { filePath } = await resolveManagedAsset(config, body.assetId);
  const previousProjectId = config.assetAssignments[filePath] || "";
  if (!previousProjectId) return { assetId: encodeAssetRef(filePath), removed: false };
  await updateConfig((draft) => { delete draft.assetAssignments[filePath]; });
  await enqueueAssetIndexUpdate([filePath]);
  notifyClients("asset-change");
  return { assetId: encodeAssetRef(filePath), removed: true, previousProjectId };
}

async function renameLibraryAsset(body = {}) {
  const config = await loadConfig();
  const { filePath } = await resolveManagedAsset(config, body.assetId);
  const currentExt = path.extname(filePath);
  const requested = String(body.name || "").trim();
  if (!requested || requested !== path.basename(requested) || /[\\/]/.test(requested)) throw new Error("请输入有效文件名");
  const nextName = path.extname(requested) ? requested : `${requested}${currentExt}`;
  const nextPath = path.join(path.dirname(filePath), nextName);
  if (path.extname(nextPath).toLowerCase() !== currentExt.toLowerCase()) throw new Error("重命名不能改变文件格式");
  if (await exists(nextPath)) throw new Error("同名文件已经存在");
  const currentStem = filePath.slice(0, -currentExt.length);
  const nextStem = nextPath.slice(0, -currentExt.length);
  const renameMappings = [{ source: filePath, destination: nextPath }];
  for (const suffix of [".prompt.md", ".meta.json"]) {
    const source = `${currentStem}${suffix}`;
    const destination = `${nextStem}${suffix}`;
    if (!await exists(source)) continue;
    if (await exists(destination)) throw new Error(`同名关联文件已经存在：${path.basename(destination)}`);
    renameMappings.push({ source, destination });
  }
  const renamed = [];
  try {
    for (const mapping of renameMappings) {
      await fs.rename(mapping.source, mapping.destination);
      renamed.push(mapping);
    }
  } catch (error) {
    for (const mapping of renamed.reverse()) await fs.rename(mapping.destination, mapping.source).catch(() => {});
    throw error;
  }
  await promptAssociations.relocate(filePath, nextPath);
  await updateConfig((draft) => {
    if (draft.assetAssignments[filePath]) {
      draft.assetAssignments[nextPath] = draft.assetAssignments[filePath];
      delete draft.assetAssignments[filePath];
    }
    if (draft.assetMetadata[filePath]) {
      draft.assetMetadata[nextPath] = draft.assetMetadata[filePath];
      delete draft.assetMetadata[filePath];
    }
  });
  await enqueueAssetIndexUpdate([filePath, nextPath]);
  notifyClients("asset-change");
  return { assetId: encodeAssetRef(nextPath), name: path.basename(nextPath), previousName: path.basename(filePath) };
}

async function readTextAsset(assetId) {
  const config = await loadConfig();
  const { filePath, stats } = await resolveManagedAsset(config, assetId);
  if (libraryAssetKind(filePath) !== "text") throw new Error("该素材不是文本文件");
  return { assetId, name: path.basename(filePath), content: await textAssetContent(filePath), size: stats.size, editable: !extraPreviewExts.has(path.extname(filePath).toLowerCase()) && ![".doc", ".rtf"].includes(path.extname(filePath).toLowerCase()) };
}

async function saveTextAsset(body = {}) {
  const config = await loadConfig();
  const { filePath } = await resolveManagedAsset(config, body.assetId);
  const ext = path.extname(filePath).toLowerCase();
  if (libraryAssetKind(filePath) !== "text" || extraPreviewExts.has(ext) || [".doc", ".rtf"].includes(ext)) throw new Error("该文本格式暂不支持直接保存");
  const content = String(body.content ?? "");
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.editing`;
  if (ext === ".docx") {
    await fs.writeFile(tempPath, replaceDocxText(await fs.readFile(filePath), content));
  } else {
    await fs.writeFile(tempPath, content, "utf8");
  }
  await fs.rename(tempPath, filePath);
  await enqueueAssetIndexUpdate([filePath]);
  notifyClients("asset-change");
  return { saved: true, assetId: encodeAssetRef(filePath), size: (await fs.stat(filePath)).size };
}

async function updateLibraryAssetMetadata(body = {}) {
  const config = await loadConfig();
  const { filePath } = await resolveManagedAsset(config, body.assetId);
  const metadata = {
    category: String(body.category || ""),
    tags: [...new Set((Array.isArray(body.tags) ? body.tags : []).map((item) => String(item || "").trim()).filter(Boolean))],
    smartGroup: ["asset", "review", "noise"].includes(body.smartGroup) ? body.smartGroup : "",
  };
  await updateConfig((draft) => { draft.assetMetadata[filePath] = metadata; });
  await enqueueAssetIndexUpdate([filePath]);
  notifyClients("asset-change");
  return metadata;
}

async function updateAssetManagerSettings(body = {}) {
  const { result } = await updateConfig((config) => {
    config.assetManager = normalizeAssetManagerSettings({
      ...config.assetManager,
      ...body,
      taxonomy: { ...config.assetManager.taxonomy, ...(body.taxonomy || {}) },
    });
    return config.assetManager;
  });
  notifyClients("config-change");
  return result;
}

async function serveFile(req, res, filePath, asDownload = false) {
  const stats = await fs.stat(filePath);
  const headers = {
    "content-type": contentType(filePath),
    "accept-ranges": "bytes",
    "cache-control": "no-store"
  };
  if (asDownload) {
    headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`;
  }

  const range = req.headers.range;
  if (range && !asDownload) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stats.size - 1;
      res.writeHead(206, {
        ...headers,
        "content-range": `bytes ${start}-${end}/${stats.size}`,
        "content-length": end - start + 1
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, { ...headers, "content-length": stats.size });
  createReadStream(filePath).pipe(res);
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function openFinder(targetPath, reveal = true) {
  let command;
  let args;
  if (process.platform === "win32") {
    command = "explorer.exe";
    args = reveal ? ["/select,", targetPath] : [targetPath];
  } else if (process.platform === "darwin") {
    command = "open";
    args = reveal ? ["-R", targetPath] : [targetPath];
  } else {
    command = "xdg-open";
    args = [reveal ? path.dirname(targetPath) : targetPath];
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}

function localDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function readRhythmControlRegistry() {
  try {
    const data = JSON.parse((await fs.readFile(rhythmControlRegistryPath, "utf8")).replace(/^\uFEFF/, ""));
    return {
      schemaVersion: 1,
      tracks: Array.isArray(data.tracks) ? data.tracks : [],
      activeByProject: data.activeByProject && typeof data.activeByProject === "object" ? data.activeByProject : {}
    };
  } catch {
    return { schemaVersion: 1, tracks: [], activeByProject: {} };
  }
}

async function writeRhythmControlRegistry(registry) {
  await fs.writeFile(rhythmControlRegistryPath, JSON.stringify({
    schemaVersion: 1,
    tracks: (registry.tracks || []).slice(0, 200),
    activeByProject: registry.activeByProject || {}
  }, null, 2) + "\n", "utf8");
}

async function runRhythmControlBuilder(payload) {
  if (!await exists(rhythmControlScriptPath)) throw new Error("节奏控制轨生成器缺失");
  const tempRoot = path.join(__dirname, "rhythm-control-work");
  await fs.mkdir(tempRoot, { recursive: true });
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const payloadPath = path.join(tempRoot, `${runId}.payload.json`);
  const resultPath = path.join(tempRoot, `${runId}.result.json`);
  await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), "utf8");

  let stdout = "";
  let stderr = "";
  try {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.env.PYTHON || "python", [
        rhythmControlScriptPath,
        "--payload", payloadPath,
        "--result", resultPath
      ], {
        cwd: __dirname,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("节奏控制轨生成超时"));
      }, 12 * 60 * 1000);
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    const result = await exists(resultPath)
      ? JSON.parse((await fs.readFile(resultPath, "utf8")).replace(/^\uFEFF/, ""))
      : null;
    if (exitCode !== 0 || !result?.ok) {
      throw new Error(result?.error || stderr.trim() || stdout.trim() || "节奏控制轨生成失败");
    }
    return result;
  } finally {
    await fs.rm(payloadPath, { force: true }).catch(() => {});
    await fs.rm(resultPath, { force: true }).catch(() => {});
  }
}

async function rhythmControlCapabilities() {
  let sfxCount = 0;
  const catalogPath = path.join(audioSkillRoot, "references", "sfx-catalog.json");
  try {
    const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
    sfxCount = Number(catalog.total || catalog.entries?.length || 0);
  } catch {}
  let musicReady = false;
  try {
    const response = await fetch("http://127.0.0.1:8001/health", { signal: AbortSignal.timeout(1500) });
    const health = await response.json();
    musicReady = response.ok && (health.data?.status || health.status) === "ok";
  } catch {}
  return {
    sfxCount,
    sfxReady: sfxCount > 0,
    musicReady,
    musicCanAutoStart: await exists(aceStepLauncher)
  };
}

function rhythmControlDestination(project, profile, body) {
  if (String(body.destinationPath || "").trim()) return String(body.destinationPath).trim();
  const date = localDateStamp();
  if (profile?.basePath) return path.join(profile.basePath, "节奏控制轨", date);
  return path.join("节奏控制轨", date);
}

async function createRhythmControlTrack(body) {
  const config = await loadConfig();
  const project = await getProjectStrict(body.projectId);
  const profile = config.automation?.routing?.profiles?.find((item) => item.id === body.profileId && item.projectId === project.id) || null;
  const destinationRelativePath = rhythmControlDestination(project, profile, body);
  const outputDir = safeResolveProject(project, destinationRelativePath);
  const duration = Number(body.duration || 0);
  if (!Number.isFinite(duration) || duration < 2 || duration > 180) throw new Error("目标时长应在 2–180 秒之间");
  const cues = Array.isArray(body.cues) ? body.cues : [];
  const result = await runRhythmControlBuilder({
    projectRoot: project.path,
    projectId: project.id,
    projectName: project.name || project.id,
    profileId: profile?.id || "",
    outputDir,
    name: body.name,
    duration,
    mode: body.mode || "sfx",
    bpm: Number(body.bpm || 96),
    keyScale: body.keyScale || "D minor",
    timeSignature: body.timeSignature || "4",
    description: body.description || "",
    musicPrompt: body.musicPrompt || "",
    cues,
    apiUrl: "http://127.0.0.1:8001",
    audioSkillRoot,
    sfxCatalog: path.join(audioSkillRoot, "references", "sfx-catalog.json"),
    musicGeneratorScript: path.join(audioSkillRoot, "scripts", "generate_music_acestep.py"),
    aceStepLauncher,
    workDir: path.join(__dirname, "rhythm-control-work", `render-${Date.now()}`)
  });
  const trackPath = safeResolveProject(project, result.track.relativePath);
  if (!await exists(trackPath)) throw new Error("控制轨生成结束，但没有找到输出文件");
  const track = {
    ...result.track,
    projectId: project.id,
    projectName: project.name || project.id,
    profileId: profile?.id || "",
    destinationRelativePath,
    mediaUrl: `/media?project=${encodeURIComponent(project.id)}&path=${encodeURIComponent(result.track.relativePath)}`
  };
  const registry = await readRhythmControlRegistry();
  registry.tracks = [track, ...registry.tracks.filter((item) => item.id !== track.id)];
  registry.activeByProject[project.id] = track.id;
  await writeRhythmControlRegistry(registry);
  return track;
}

async function rhythmControlStatus(projectId = "") {
  const registry = await readRhythmControlRegistry();
  const tracks = registry.tracks
    .filter((track) => !projectId || track.projectId === projectId)
    .filter((track) => track.absolutePath && path.isAbsolute(track.absolutePath))
    .slice(0, 40);
  return {
    capabilities: await rhythmControlCapabilities(),
    activeTrackId: projectId ? registry.activeByProject[projectId] || "" : "",
    tracks
  };
}

async function saveAutomationSettings(body) {
  const { saved } = await updateConfig((config) => {
  const automation = normalizeAutomation(body.automation || body);
  const previouslyEnabled = Boolean(config.automation?.inbox?.enabled);
  if (automation.inbox.enabled && !previouslyEnabled) {
    automation.inbox.startedAt = new Date().toISOString();
  } else if (automation.inbox.enabled) {
    automation.inbox.startedAt = automation.inbox.startedAt || config.automation?.inbox?.startedAt || new Date().toISOString();
  } else {
    automation.inbox.startedAt = null;
  }
  if (automation.inbox.transferMode === "move") {
    if (body.confirmMove === true) {
      automation.inbox.moveApprovedAt = new Date().toISOString();
    } else if (!automation.inbox.moveApprovedAt) {
      throw new Error("启用自动转移前需要明确确认");
    }
  } else {
    automation.inbox.moveApprovedAt = null;
  }
  if (automation.inbox.enabled && automation.routing.enabled) {
    const projectIds = new Set(config.projects.map((project) => project.id));
    const missing = automation.routing.profiles.find((profile) => !projectIds.has(profile.projectId));
    if (missing) throw new Error(`分流规则的目标项目不存在：${missing.name}`);
    if (!automation.routing.profiles.some((profile) => profile.id === automation.routing.activeProfileId)) {
      throw new Error("请选择一个有效的当前下载项目");
    }
  } else if (automation.inbox.enabled && !config.projects.some((project) => project.id === automation.inbox.projectId)) {
    throw new Error("自动归档已开启，但尚未选择有效的目标项目");
  }

  if (automation.cleanup.enabled && !automation.cleanup.dryRun) {
    if (body.confirmCleanup !== true) throw new Error("启用实际清理前需要明确确认");
    automation.cleanup.approvedAt = new Date().toISOString();
  } else {
    automation.cleanup.approvedAt = null;
  }

  if (automation.cleanup.purgeEnabled) {
    if (body.confirmPurge !== true) throw new Error("启用隔离区永久清空前需要单独确认");
    automation.cleanup.purgeApprovedAt = new Date().toISOString();
  } else {
    automation.cleanup.purgeApprovedAt = null;
  }

  config.automation = automation;
  });
  notifyClients("automation-change");
  return saved.automation;
}

async function withAutomationLock(operation) {
  if (automationBusy) throw new Error("下载整理任务正在运行，请稍后再试");
  automationBusy = true;
  try {
    return await operation();
  } finally {
    automationBusy = false;
  }
}

async function checkAutomationSchedule() {
  if (automationBusy) return;
  automationBusy = true;
  try {
    const config = await loadConfig();
    if (config.automation.inbox.enabled) {
      const generationClaims = await generationPipeline.claimArmedDownloads(config, {
        settleSeconds: Math.min(6, Math.max(2, config.automation.inbox.settleSeconds || 4))
      });
      if (generationClaims.length) notifyClients("generation-change");
    }
    const ledger = await downloadAutomation.readLedger();
    const now = Date.now();
    const organizerDue = !ledger.lastOrganizerRunAt || now - Date.parse(ledger.lastOrganizerRunAt) >= config.automation.inbox.pollSeconds * 1000;
    if (
      config.automation.inbox.enabled
      && config.automation.inbox.capturePolicy === "all-downloads"
      && organizerDue
    ) {
      const result = await downloadAutomation.runOrganizer(config.automation, config.projects);
      if (result.imported.length) notifyClients("automation-change");
    }

    const latestLedger = await downloadAutomation.readLedger();
    const cleanupDue = !latestLedger.lastCleanupRunAt || now - Date.parse(latestLedger.lastCleanupRunAt) >= config.automation.cleanup.intervalHours * 60 * 60 * 1000;
    if (
      config.automation.inbox.capturePolicy === "all-downloads" &&
      config.automation.cleanup.enabled &&
      !config.automation.cleanup.dryRun &&
      config.automation.cleanup.approvedAt &&
      cleanupDue
    ) {
      const result = await downloadAutomation.runCleanup(config.automation);
      if (result.quarantined?.length || result.purged?.length) notifyClients("automation-change");
    }
  } catch (error) {
    console.warn("Download automation:", error.message);
  } finally {
    automationBusy = false;
  }
}

function projectForPromptAssociation(association, config, bindings) {
  const boundProjectId = bindings?.bindings?.[association.threadId]?.projectId;
  const bound = config.projects.find((project) => project.id === boundProjectId);
  if (bound) return bound;
  if (association.cwd) {
    const cwdMatches = config.projects
      .filter((project) => project.folders.some((folder) => isPathInside(folder, association.cwd)))
      .sort((a, b) => Math.max(...b.folders.map((folder) => folder.length)) - Math.max(...a.folders.map((folder) => folder.length)));
    if (cwdMatches[0]) return cwdMatches[0];
  }
  return config.projects.find((project) => project.id === "pending-review") || null;
}

async function syncCodexProductionProjects(associations) {
  const startedAt = new Date().toISOString();
  try {
    const candidates = await codexProductionProjects.discover({ associations });
    const snapshot = await loadConfig();
    const preview = reconcileCodexProjects(snapshot.projects, candidates, { now: startedAt });
    if (!preview.changed) {
      codexProjectSyncStatus = {
        state: "ready",
        lastRunAt: startedAt,
        candidates: candidates.length,
        created: 0,
        updated: 0,
        error: "",
      };
      return { ...codexProjectSyncStatus, changed: false };
    }
    const { result } = await updateConfig((config) => {
      const reconciliation = reconcileCodexProjects(config.projects, candidates, { now: startedAt });
      if (reconciliation.changed) config.projects = reconciliation.projects;
      return reconciliation;
    });
    if (result.changed) {
      await ensureWatchers();
      notifyClients("project-change");
    }
    codexProjectSyncStatus = {
      state: "ready",
      lastRunAt: startedAt,
      candidates: candidates.length,
      created: result.created.length,
      updated: result.updated.length,
      error: "",
    };
    return { ...codexProjectSyncStatus, changed: result.changed };
  } catch (error) {
    codexProjectSyncStatus = {
      ...codexProjectSyncStatus,
      state: "error",
      lastRunAt: startedAt,
      error: error.message || String(error),
    };
    throw error;
  }
}

async function syncCodexPromptAssociations() {
  if (promptAssociationSyncBusy) return;
  promptAssociationSyncBusy = true;
  try {
    const synced = await promptAssociations.syncCodexSessions();
    const projectSync = await syncCodexProductionProjects(synced.associations);
    const [config, bindings] = await Promise.all([loadConfig(), generationPipeline.readBindings()]);
    const assignments = {};
    for (const association of synced.importedAssociations) {
      if (!await exists(association.assetPath) || config.assetAssignments[association.assetPath]) continue;
      const alreadyScannedBy = config.projects.find((project) => project.folders.some((folder) => isPathInside(folder, association.assetPath)));
      if (alreadyScannedBy) continue;
      const project = projectForPromptAssociation(association, config, bindings);
      if (project) assignments[association.assetPath] = project.id;
    }
    if (Object.keys(assignments).length) {
      await updateConfig((draft) => Object.assign(draft.assetAssignments, assignments));
    }
    const indexedChanges = [...new Set([
      ...synced.importedAssociations.map((association) => association.assetPath),
      ...Object.keys(assignments),
    ].filter(Boolean))];
    if (indexedChanges.length) await enqueueAssetIndexUpdate(indexedChanges);
    if (synced.imported || Object.keys(assignments).length || projectSync.changed) notifyClients("asset-change");
  } catch (error) {
    console.warn("Codex prompt association:", error.message);
  } finally {
    promptAssociationSyncBusy = false;
  }
}

function notifyClients(event = "asset-change") {
  const payload = JSON.stringify({ event, at: new Date().toISOString() });
  for (const client of sseClients) {
    client.write(`event: ${event}\n`);
    client.write(`data: ${payload}\n\n`);
  }
}

async function syncAssetIndexPaths(changedPaths = []) {
  const paths = [...new Set(changedPaths.map((filePath) => path.resolve(String(filePath || ""))).filter(Boolean))];
  if (!paths.length) return { paths: 0, projects: 0 };
  const config = await loadConfig();
  const expanded = [];
  for (const changedPath of paths) {
    const stats = await fs.lstat(changedPath).catch(() => null);
    if (stats?.isDirectory() && !stats.isSymbolicLink()) {
      const candidates = [];
      await walkLibrary(changedPath, candidates);
      expanded.push({ changedPath, candidates, removePrefix: changedPath });
    } else if (stats?.isFile() && !stats.isSymbolicLink() && supportedAssetExts.has(path.extname(changedPath).toLowerCase())) {
      expanded.push({ changedPath, candidates: [changedPath], removePrefix: "" });
    } else {
      expanded.push({ changedPath, candidates: [], removePrefix: changedPath });
    }
  }

  let updatedProjects = 0;
  for (const project of config.projects) {
    const entry = await assetLibraryIndex.getProject(project.id);
    if (!entry) continue;
    const existingPaths = entry.assets.map(indexedAssetPath).filter(Boolean);
    const affected = expanded.some(({ changedPath, candidates, removePrefix }) =>
      candidates.some((candidate) => projectContainsAsset(project, candidate, config))
        || existingPaths.some((filePath) => filePath === changedPath || (removePrefix && isPathInside(removePrefix, filePath))));
    if (!affected) continue;

    const candidates = expanded.flatMap((change) => change.candidates)
      .filter((filePath) => projectContainsAsset(project, filePath, config));
    const removeIds = expanded.map(({ changedPath }) => encodeAssetRef(changedPath));
    const removePrefixes = expanded.map(({ removePrefix }) => removePrefix).filter(Boolean);
    const retainedContext = existingPaths.filter((filePath) =>
      !removePrefixes.some((prefix) => filePath === prefix || isPathInside(prefix, filePath)));
    const upserts = await buildLibraryAssets(project, config, candidates, [...retainedContext, ...candidates]);
    await assetLibraryIndex.patchProject(project, {
      upserts,
      removeIds,
      removePrefixes,
      folders: project.folders,
    });
    invalidateLibraryResponseCache(project.id);
    updatedProjects += 1;
  }
  return { paths: paths.length, projects: updatedProjects };
}

function enqueueAssetIndexUpdate(paths) {
  const operation = assetIndexUpdateQueue.then(() => syncAssetIndexPaths(paths));
  assetIndexUpdateQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function scheduleAssetIndexUpdate(changedPath) {
  pendingWatchPaths.add(path.resolve(changedPath));
  if (watchFlushTimer) clearTimeout(watchFlushTimer);
  watchFlushTimer = setTimeout(() => {
    const paths = [...pendingWatchPaths];
    pendingWatchPaths.clear();
    enqueueAssetIndexUpdate(paths)
      .then(() => notifyClients("asset-change"))
      .catch((error) => console.warn("Asset index update:", error.message));
  }, 450);
}

async function runDuplicateSweep() {
  try {
    const config = await loadConfig();
    const result = await duplicateCleaner.sweepProjects(config.projects, config.deduplication);
    if (result.quarantined.length || result.purged.length) notifyClients("deduplication-change");
    if (result.quarantined.length) console.log(`Exact duplicate images quarantined: ${result.quarantined.length}`);
  } catch (error) {
    console.warn("Exact duplicate cleanup:", error.message);
  }
}

async function ensureWatchers() {
  const config = await loadConfig();
  const desiredRoots = new Set(config.projects.flatMap((project) => project.folders.map((folder) => path.resolve(folder))));
  for (const [watchRoot, watcher] of watcherHandles) {
    if (desiredRoots.has(watchRoot)) continue;
    watcher.close();
    watcherHandles.delete(watchRoot);
  }
  for (const project of config.projects) {
    for (const watchRoot of project.folders) {
      const resolvedWatchRoot = path.resolve(watchRoot);
      if (!await exists(resolvedWatchRoot)) continue;
      if (watcherHandles.has(resolvedWatchRoot)) continue;
      try {
        const watcher = watch(resolvedWatchRoot, { recursive: true }, (_eventType, filename) => {
          const changedPath = filename
            ? path.resolve(resolvedWatchRoot, String(filename))
            : resolvedWatchRoot;
          scheduleAssetIndexUpdate(changedPath);
          if (!filename) return;
          duplicateCleaner.schedule({
            filePath: changedPath,
            project,
            config: config.deduplication,
            onDeduplicated: () => notifyClients("deduplication-change")
          });
        });
        watcher.on("error", (error) => {
          console.warn(`Asset watcher error (${resolvedWatchRoot}):`, error.message);
        });
        watcherHandles.set(resolvedWatchRoot, watcher);
        console.log(`Watching assets: ${resolvedWatchRoot}`);
      } catch (error) {
        console.warn(`Asset watcher unavailable (${resolvedWatchRoot}):`, error.message);
      }
    }
  }
}

function closeProjectWatchers(projectPath) {
  const projectRoot = path.resolve(projectPath);
  for (const [watchRoot, watcher] of watcherHandles) {
    const relative = path.relative(projectRoot, path.resolve(watchRoot));
    const belongsToProject = relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    if (!belongsToProject) continue;
    watcher.close();
    watcherHandles.delete(watchRoot);
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      const origin = String(req.headers.origin || "");
      if (!isAllowedLocalOrigin(req)) {
        sendJson(res, { error: "Origin is not allowed" }, 403);
        return;
      }
      res.writeHead(204, {
        "access-control-allow-origin": origin || `http://127.0.0.1:${port}`,
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,x-asset-console-token",
        vary: "origin"
      });
      res.end();
      return;
    }

    if (isProtectedLocalRoute(url.pathname) && (!isAllowedLocalOrigin(req) || !hasValidApiToken(req))) {
      sendJson(res, { error: "Local API authentication failed" }, 403);
      return;
    }

    if (url.pathname === "/api/prompt-library/health" && req.method === "GET") {
      sendJson(res, await promptLibrary.health());
      return;
    }

    if (url.pathname === "/api/prompt-library" && req.method === "GET") {
      sendJson(res, await promptLibrary.list({
        kind: url.searchParams.get("kind") || "",
        query: url.searchParams.get("query") || "",
        category: url.searchParams.get("category") || "",
        projectId: url.searchParams.get("project") || "",
        reviewStatus: url.searchParams.get("reviewStatus") || ""
      }));
      return;
    }

    if (url.pathname === "/api/prompt-library/compile" && req.method === "POST") {
      const result = await promptLibrary.compile();
      notifyClients("prompt-library-change");
      sendJson(res, { ok: true, ...result });
      return;
    }

    if (url.pathname === "/api/prompt-library/captures" && req.method === "POST") {
      const body = await readRequestBody(req);
      const result = await promptLibrary.create("capture", body);
      notifyClients("prompt-library-change");
      const origin = String(req.headers.origin || "");
      if (origin.startsWith("chrome-extension://")) res.setHeader("access-control-allow-origin", origin);
      sendJson(res, { ok: true, ...result });
      return;
    }

    if (url.pathname === "/api/prompt-library/items" && req.method === "POST") {
      const body = await readRequestBody(req);
      const result = await promptLibrary.create(String(body.kind || "capture"), body);
      notifyClients("prompt-library-change");
      sendJson(res, { ok: true, ...result });
      return;
    }

    const promptItemMatch = url.pathname.match(/^\/api\/prompt-library\/items\/(capture|term|recipe|prompt)\/([^/]+)$/);
    if (promptItemMatch && (req.method === "PUT" || req.method === "DELETE")) {
      const [, kind, rawId] = promptItemMatch;
      const id = decodeURIComponent(rawId);
      const result = req.method === "PUT"
        ? await promptLibrary.update(kind, id, await readRequestBody(req))
        : await promptLibrary.remove(kind, id);
      notifyClients("prompt-library-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/3d/status" && req.method === "GET") {
      sendJson(res, await threeDWorkbench.status());
      return;
    }

    if (url.pathname === "/api/3d/tasks" && req.method === "GET") {
      sendJson(res, {
        tasks: await threeDWorkbench.list({
          projectId: url.searchParams.get("project") || "",
          limit: url.searchParams.get("limit") || 100
        })
      });
      return;
    }

    if (url.pathname === "/api/3d/tasks" && req.method === "POST") {
      const body = await readRequestBody(req);
      const config = await loadConfig();
      const task = await threeDWorkbench.create(body, config.projects);
      notifyClients("three-d-change");
      sendJson(res, { ok: true, task });
      return;
    }

    const threeDMatch = url.pathname.match(/^\/api\/3d\/tasks\/([^/]+)\/(refresh|open)$/);
    if (threeDMatch && req.method === "POST") {
      const [, rawId, action] = threeDMatch;
      const id = decodeURIComponent(rawId);
      const { task } = await threeDWorkbench.get(id);
      const result = action === "refresh" ? await threeDWorkbench.refresh(id) : task;
      if (action === "open") openFinder(task.workspacePath, false);
      notifyClients("three-d-change");
      sendJson(res, { ok: true, task: result });
      return;
    }

    const threeDDeleteMatch = url.pathname.match(/^\/api\/3d\/tasks\/([^/]+)$/);
    if (threeDDeleteMatch && req.method === "DELETE") {
      const result = await threeDWorkbench.remove(decodeURIComponent(threeDDeleteMatch[1]));
      notifyClients("three-d-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/projects/reorder" && req.method === "POST") {
      const body = await readRequestBody(req);
      const projects = await reorderProjects(body.projectIds);
      sendJson(res, { ok: true, projects });
      return;
    }

    if (url.pathname === "/api/codex-project-sync" && req.method === "GET") {
      sendJson(res, codexProjectSyncStatus);
      return;
    }

    if (url.pathname === "/api/projects" && req.method === "POST") {
      const body = await readRequestBody(req);
      const project = await addProject(body);
      sendJson(res, { ok: true, project });
      return;
    }

    const projectUpdateMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectUpdateMatch && req.method === "PATCH") {
      const project = await updateProject(decodeURIComponent(projectUpdateMatch[1]), await readRequestBody(req));
      sendJson(res, { ok: true, project });
      return;
    }

    if (url.pathname === "/api/projects") {
      sendJson(res, { projects: await listProjects() });
      return;
    }

    if (url.pathname === "/api/folders" && req.method === "POST") {
      const folder = await addProjectFolder(await readRequestBody(req));
      sendJson(res, { ok: true, folder });
      return;
    }

    if (url.pathname === "/api/folders" && req.method === "PATCH") {
      const folder = await renameProjectDirectory(await readRequestBody(req));
      sendJson(res, { ok: true, folder });
      return;
    }

    if (url.pathname === "/api/folders") {
      const projectId = url.searchParams.get("project");
      sendJson(res, await listProjectFolders(projectId));
      return;
    }

    if (url.pathname === "/api/move-asset" && req.method === "POST") {
      const body = await readRequestBody(req);
      const result = await moveAsset(body);
      notifyClients("asset-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/batch-move" && req.method === "POST") {
      const result = await batchMoveAssets(await readRequestBody(req));
      if (result.results.length) notifyClients("asset-change");
      sendJson(res, { ok: result.errors.length === 0, ...result });
      return;
    }

    if (url.pathname === "/api/batch-mark" && req.method === "POST") {
      const result = await batchMarkAssets(await readRequestBody(req));
      sendJson(res, { ok: result.errors.length === 0, ...result });
      return;
    }

    if (url.pathname === "/api/trash-assets" && req.method === "POST") {
      const result = await trashAssets(await readRequestBody(req));
      notifyClients("asset-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/restore-trash" && req.method === "POST") {
      const result = await restoreTrashedAssets(await readRequestBody(req));
      notifyClients("asset-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/library" && req.method === "GET") {
      const projectId = url.searchParams.get("project") || "";
      const force = url.searchParams.get("rescan") === "1";
      const library = await libraryScanCoordinator.run(projectId, () => listLibraryAssets(projectId, { force }));
      const filters = {
        kind: url.searchParams.get("kind") || "",
        category: url.searchParams.get("category") || "",
        smartGroup: url.searchParams.get("smartGroup") || "",
        query: url.searchParams.get("query") || "",
      };
      sendJsonBuffer(res, cachedLibraryResponse(library, filters));
      return;
    }

    if (url.pathname === "/api/assets/prompt" && req.method === "GET") {
      const config = await loadConfig();
      const { filePath } = await resolveManagedAsset(config, url.searchParams.get("id") || "");
      const association = await promptAssociations.get(filePath);
      if (!association) throw new Error("该资产没有关联提示词");
      sendJson(res, association);
      return;
    }

    if (url.pathname === "/api/assets/prompt" && req.method === "POST") {
      const body = await readRequestBody(req);
      const config = await loadConfig();
      const { filePath } = await resolveManagedAsset(config, body.assetId);
      const association = await promptAssociations.register({ ...body, assetPath: filePath });
      await enqueueAssetIndexUpdate([filePath]);
      notifyClients("asset-change");
      sendJson(res, { ok: true, association });
      return;
    }

    if (url.pathname === "/api/assets/assign" && req.method === "POST") {
      sendJson(res, { ok: true, result: await assignAssetToProject(await readRequestBody(req)) });
      return;
    }

    if (url.pathname === "/api/assets/assign" && req.method === "DELETE") {
      sendJson(res, { ok: true, result: await clearAssetProjectAssignment(await readRequestBody(req)) });
      return;
    }

    if (url.pathname === "/api/assets/rename" && req.method === "POST") {
      sendJson(res, { ok: true, result: await renameLibraryAsset(await readRequestBody(req)) });
      return;
    }

    if (url.pathname === "/api/assets/delete" && req.method === "DELETE") {
      sendJson(res, { ok: false, error: "V1 不提供永久删除" }, 405);
      return;
    }

    if (url.pathname === "/api/assets/metadata" && req.method === "PATCH") {
      sendJson(res, { ok: true, metadata: await updateLibraryAssetMetadata(await readRequestBody(req)) });
      return;
    }

    if (url.pathname === "/api/task-references" && req.method === "GET") {
      const data = await taskContexts.view(url.searchParams.get('threadId'));
      sendJson(res, { references: data.references });
      return;
    }
    if (url.pathname === "/api/preview" && req.method === "GET") {
      const config = await loadConfig();
      const { filePath } = await resolveManagedAsset(config, url.searchParams.get('id') || '');
      sendJson(res, await previewFile(filePath));
      return;
    }

    if (url.pathname === "/api/text" && req.method === "GET") {
      sendJson(res, await readTextAsset(url.searchParams.get("id") || ""));
      return;
    }

    if (url.pathname === "/api/text" && req.method === "PUT") {
      sendJson(res, { ok: true, result: await saveTextAsset(await readRequestBody(req)) });
      return;
    }

    if (url.pathname === "/api/settings" && req.method === "PATCH") {
      sendJson(res, { ok: true, settings: await updateAssetManagerSettings(await readRequestBody(req)) });
      return;
    }

    if (url.pathname === "/api/config") {
      sendJson(res, await loadConfig());
      return;
    }

    if (url.pathname === "/api/rhythm-control/status") {
      sendJson(res, await rhythmControlStatus(url.searchParams.get("project") || ""));
      return;
    }

    if (url.pathname === "/api/rhythm-control/create" && req.method === "POST") {
      const body = await readRequestBody(req);
      const track = await createRhythmControlTrack(body);
      notifyClients("rhythm-control-change");
      sendJson(res, { ok: true, track });
      return;
    }

    if (url.pathname === "/api/generation/status") {
      sendJson(res, await generationPipeline.status());
      return;
    }

    if (url.pathname === "/api/generation/bindings" && req.method === "GET") {
      sendJson(res, { bindings: await generationPipeline.listBindings() });
      return;
    }

    if (url.pathname === "/api/generation/bindings" && req.method === "POST") {
      const body = await readRequestBody(req);
      const binding = await generationPipeline.bindThread(body, await loadConfig());
      notifyClients("generation-change");
      sendJson(res, { ok: true, binding });
      return;
    }

    if (url.pathname === "/api/generation/bindings" && req.method === "DELETE") {
      const body = await readRequestBody(req);
      const result = await generationPipeline.unbindThread(body.threadId || url.searchParams.get("threadId") || "");
      notifyClients("generation-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/generation/tickets" && req.method === "GET") {
      sendJson(res, {
        tickets: await generationPipeline.list({
          limit: url.searchParams.get("limit") || 100,
          status: url.searchParams.get("status") || ""
        })
      });
      return;
    }

    if (url.pathname === "/api/generation/tickets" && req.method === "POST") {
      const body = await readRequestBody(req);
      const ticket = await generationPipeline.create(body, await loadConfig());
      notifyClients("generation-change");
      sendJson(res, { ok: true, ticket });
      return;
    }

    const generationMatch = url.pathname.match(/^\/api\/generation\/tickets\/([^/]+)\/(arm|generated|attach|cancel)$/);
    if (generationMatch && req.method === "POST") {
      const [, rawTicketId, action] = generationMatch;
      const ticketId = decodeURIComponent(rawTicketId);
      const body = await readRequestBody(req);
      const config = await loadConfig();
      let result;
      if (action === "arm") {
        result = await generationPipeline.arm(ticketId, {
          sourcePath: body.sourcePath || config.automation.inbox.sourcePath,
          expectedName: body.expectedName || ""
        });
      } else if (action === "generated") {
        result = await generationPipeline.markGenerated(ticketId, body);
      } else if (action === "attach") {
        result = await generationPipeline.attach(ticketId, body, config);
      } else {
        result = await generationPipeline.cancel(ticketId, body.reason || "");
      }
      notifyClients("generation-change");
      sendJson(res, { ok: true, result });
      return;
    }

    if (url.pathname === "/api/automation/status") {
      const config = await loadConfig();
      sendJson(res, await downloadAutomation.status(config.automation, config.projects));
      return;
    }

    if (url.pathname === "/api/automation/settings" && req.method === "POST") {
      const body = await readRequestBody(req);
      const automation = await saveAutomationSettings(body);
      sendJson(res, { ok: true, automation });
      return;
    }

    if (url.pathname === "/api/automation/active-profile" && req.method === "POST") {
      const body = await readRequestBody(req);
      const { saved, result: profile } = await updateConfig((config) => {
        const selected = config.automation.routing.profiles.find((item) => item.id === body.profileId);
        if (!selected) throw new Error("当前下载项目不存在");
        config.automation.routing.activeProfileId = selected.id;
        return selected;
      });
      notifyClients("automation-change");
      sendJson(res, { ok: true, activeProfileId: profile.id, profile, automation: saved.automation });
      return;
    }

    if (url.pathname === "/api/automation/organizer/preview" && req.method === "POST") {
      const body = await readRequestBody(req);
      const config = await loadConfig();
      sendJson(res, await downloadAutomation.previewOrganizer(body.automation || config.automation, config.projects));
      return;
    }

    if (url.pathname === "/api/automation/organizer/run" && req.method === "POST") {
      const body = await readRequestBody(req);
      const config = await loadConfig();
      const result = await withAutomationLock(() => downloadAutomation.runOrganizer(body.automation || config.automation, config.projects));
      if (result.imported.length) notifyClients("automation-change");
      sendJson(res, result);
      return;
    }

    if (url.pathname === "/api/automation/cleanup/preview" && req.method === "POST") {
      const body = await readRequestBody(req);
      const config = await loadConfig();
      sendJson(res, await downloadAutomation.previewCleanup(body.automation || config.automation));
      return;
    }

    if (url.pathname === "/api/automation/cleanup/run" && req.method === "POST") {
      const body = await readRequestBody(req);
      const config = await loadConfig();
      if (!config.automation.cleanup.dryRun && body.confirm !== true) {
        throw new Error("实际清理需要再次确认");
      }
      const result = await withAutomationLock(() => downloadAutomation.runCleanup(config.automation));
      if (result.quarantined?.length || result.purged?.length) notifyClients("automation-change");
      sendJson(res, result);
      return;
    }

    if (url.pathname === "/api/toggle-enabled" && req.method === "POST") {
      const body = await readRequestBody(req);
      const enabled = Boolean(body.enabled);
      await updateConfig((config) => { config.enabled = enabled; });
      notifyClients("config-change");
      sendJson(res, { ok: true, enabled });
      return;
    }

    if (url.pathname === "/api/cases") {
      const projectId = url.searchParams.get("project");
      const project = await getProject(projectId);
      sendJson(res, { projectRoot: project.path, project, cases: await listCases(project.id) });
      return;
    }

    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive"
      });
      res.write(`event: connected\n`);
      res.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (url.pathname === "/api/assets") {
      const projectId = url.searchParams.get("project");
      const caseId = url.searchParams.get("case");
      if (!caseId) return sendJson(res, { error: "Missing case" }, 400);
      const project = await getProject(projectId);
      sendJson(res, { projectId: project.id, caseId, assets: await listAssets(project.id, caseId) });
      return;
    }

    if (url.pathname === "/api/mark" && req.method === "POST") {
      const body = await readRequestBody(req);
      const result = await markAsset(body);
      sendJson(res, { ok: true, meta: result.meta, previous: result.previous });
      return;
    }

    if (url.pathname === "/api/reveal" && req.method === "POST") {
      const body = await readRequestBody(req);
      const project = await getProject(body.projectId);
      const target = safeResolveProject(project, body.path);
      openFinder(target, true);
      sendJson(res, { ok: true });
      return;
    }

    if (url.pathname === "/api/open-folder" && req.method === "POST") {
      const body = await readRequestBody(req);
      const project = await getProject(body.projectId);
      const target = safeResolveProject(project, body.path);
      openFinder(path.dirname(target), false);
      sendJson(res, { ok: true });
      return;
    }

    if (url.pathname === "/media" || url.pathname === "/download") {
      let filePath;
      if (url.searchParams.get("id")) {
        const resolved = await resolveManagedAsset(await loadConfig(), url.searchParams.get("id"));
        filePath = resolved.filePath;
      } else {
        const projectId = url.searchParams.get("project");
        const project = await getProject(projectId);
        const requested = url.searchParams.get("path");
        filePath = safeResolveProject(project, requested);
      }
      await serveFile(req, res, filePath, url.pathname === "/download");
      return;
    }

    let staticPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = safeResolvePublic(staticPath);
    if (!await exists(filePath)) {
      sendText(res, "Not found", 404);
      return;
    }
    await serveFile(req, res, filePath);
  } catch (error) {
    sendJson(res, { error: error.message || String(error) }, 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Generation asset workbench running at http://127.0.0.1:${port}`);
  console.log(`Config: ${configPath}`);
});

ensureWatchers();

setTimeout(runDuplicateSweep, 8000).unref();
setInterval(runDuplicateSweep, 6 * 60 * 60 * 1000).unref();
setTimeout(checkAutomationSchedule, 3000).unref();
setInterval(checkAutomationSchedule, 5000).unref();
setTimeout(syncCodexPromptAssociations, 1200).unref();
setInterval(syncCodexPromptAssociations, 8000).unref();

setInterval(() => {
  for (const client of sseClients) {
    client.write(`event: ping\n`);
    client.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  }
}, 30000).unref();
