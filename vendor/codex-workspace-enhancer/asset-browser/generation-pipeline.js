import { createHash, randomBytes } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus"]);
const TEMP_EXTS = new Set([".crdownload", ".part", ".partial", ".tmp", ".download"]);

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

function localDateParts(date = new Date()) {
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    compactDate: `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    compactTime: `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  };
}

function cleanSegment(value, fallback = "") {
  const text = String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  return text || fallback;
}

function cleanRelative(value, label = "目标目录") {
  const raw = String(value ?? "").trim().replace(/\//g, path.sep);
  if (!raw || raw === ".") return "";
  if (path.isAbsolute(raw)) throw new Error(`${label}必须是项目内的相对路径`);
  const normalized = path.normalize(raw).replace(/^[.][\\/]/, "");
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`${label}不能跳出项目文件夹`);
  }
  return normalized;
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assetKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return "other";
}

function kindLabel(kind) {
  return { image: "图片", video: "视频", audio: "音频" }[kind] || "资产";
}

function isTemporary(filePath) {
  const lower = path.basename(filePath).toLowerCase();
  return [...TEMP_EXTS].some((ext) => lower.endsWith(ext));
}

function exactDownloadName(value) {
  const name = String(value || "").trim();
  if (!name) return "";
  if (name === "." || name === ".." || /[\\/]/.test(name) || path.basename(name) !== name) {
    throw new Error("expectedName must be one exact file name without a path");
  }
  return name;
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

async function uniquePath(desiredPath) {
  if (!await exists(desiredPath)) return desiredPath;
  const dir = path.dirname(desiredPath);
  const ext = path.extname(desiredPath);
  const stem = path.basename(desiredPath, ext);
  for (let index = 2; index < 10000; index += 1) {
    const candidate = path.join(dir, `${stem}-${pad(index)}${ext}`);
    if (!await exists(candidate)) return candidate;
  }
  throw new Error("目标目录中同名文件过多，无法生成安全文件名");
}

function projectFor(config, projectId) {
  const project = (config.projects || []).find((item) => item.id === projectId);
  if (!project) throw new Error(`项目不存在：${projectId || "未指定"}`);
  return { ...project, path: path.resolve(project.path) };
}

function profileFor(config, profileId) {
  if (!profileId) return null;
  return (config.automation?.routing?.profiles || []).find((item) => item.id === profileId) || null;
}

function threadIdFor(input) {
  return String(input?.sourceContext?.threadId || input?.sourceContext?.taskId || input?.threadId || "").trim();
}

function routingTextFor(input, includePrompt = false) {
  const context = input?.sourceContext && typeof input.sourceContext === "object" ? input.sourceContext : {};
  const values = [
    input?.projectName,
    input?.profileName,
    input?.episode,
    input?.scene,
    input?.shot,
    input?.role,
    input?.notes,
    context.project,
    context.projectName,
    context.profile,
    context.episode,
    context.sourceTask,
    context.taskTitle,
    context.conversationTitle,
    context.cwd
  ];
  if (includePrompt) values.push(input?.prompt, input?.negativePrompt);
  return values.map((item) => String(item || "").trim()).filter(Boolean).join("\n").toLowerCase();
}

function pendingRouting(config) {
  const profiles = config.automation?.routing?.profiles || [];
  const profile = profiles.find((item) => item.id === "pending-review") || null;
  const project = (config.projects || []).find((item) => item.id === (profile?.projectId || "pending-review")) || null;
  return project ? { project, profile } : null;
}

function keywordRouting(config, input) {
  const profiles = config.automation?.routing?.profiles || [];
  const contextText = routingTextFor(input, false);
  const allText = routingTextFor(input, true);
  const candidates = [];
  for (const profile of profiles) {
    if (profile.id === "pending-review" || profile.id === "misc-library") continue;
    let score = 0;
    let matchedKeyword = "";
    let matchedOn = "";
    const keywords = [profile.name, profile.id, ...(profile.keywords || [])]
      .map((item) => String(item || "").trim().toLowerCase())
      .filter((item) => item.length >= 2);
    for (const keyword of keywords) {
      if (contextText.includes(keyword) && 200 + keyword.length > score) {
        score = 200 + keyword.length;
        matchedKeyword = keyword;
        matchedOn = "context";
      } else if (allText.includes(keyword) && 100 + keyword.length > score) {
        score = 100 + keyword.length;
        matchedKeyword = keyword;
        matchedOn = "prompt";
      }
    }
    if (score) candidates.push({ profile, score, matchedKeyword, matchedOn });
  }
  candidates.sort((a, b) => b.score - a.score || b.matchedKeyword.length - a.matchedKeyword.length);
  const winner = candidates[0];
  if (winner) {
    const project = (config.projects || []).find((item) => item.id === winner.profile.projectId);
    if (project) return { project, ...winner };
  }

  const project = (config.projects || [])
    .filter((item) => !["pending-review", "misc-library", "ai-reference-library", "reference-library"].includes(item.id))
    .map((item) => {
      const names = [item.name, item.id].map((value) => String(value || "").trim().toLowerCase()).filter((value) => value.length >= 2);
      const matched = names.find((value) => contextText.includes(value));
      return matched ? { project: item, score: 150 + matched.length, matchedKeyword: matched, matchedOn: "context" } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)[0];
  return project ? { ...project, profile: null } : null;
}

function defaultDestination(config, input, project, profile, date) {
  if (input.destinationPath != null && String(input.destinationPath).trim()) {
    return cleanRelative(input.destinationPath, "生成资产目录");
  }

  const basePath = cleanRelative(input.basePath ?? profile?.basePath ?? "", "项目基础目录");
  const assetLabel = kindLabel(input.kind);
  const tail = (profile?.id === "pending-review" || project.id === "pending-review")
    ? path.join(date, assetLabel)
    : path.join("生成资产", date, assetLabel);
  return cleanRelative(path.join(basePath, tail), "生成资产目录");
}

function buildNameStem(input, now) {
  if (String(input.nameStem || "").trim()) return cleanSegment(input.nameStem, "生成资产");
  const versionNumber = Number.parseInt(input.version, 10);
  const parts = [input.episode, input.scene, input.shot, input.role]
    .map((item) => cleanSegment(item))
    .filter(Boolean);
  if (Number.isFinite(versionNumber) && versionNumber > 0) parts.push(`v${pad(versionNumber, 3)}`);
  if (!parts.length) {
    const stamp = localDateParts(now);
    parts.push(cleanSegment(input.generator, "generation"), input.kind || "asset", `${stamp.compactDate}-${stamp.compactTime}`);
  }
  return cleanSegment(parts.join("_"), "生成资产");
}

function makeTicketId(now = new Date()) {
  const stamp = localDateParts(now);
  return `gen-${stamp.compactDate}-${stamp.compactTime}-${randomBytes(2).toString("hex")}`;
}

function relativeOrAbsolute(projectRoot, filePath) {
  return isInside(projectRoot, filePath) ? path.relative(projectRoot, filePath) : path.resolve(filePath);
}

function promptMarkdown(ticket, output, project) {
  const references = (ticket.references || []).length
    ? ticket.references.map((item) => `- ${item}`).join("\n")
    : "- 无登记参考素材";
  const settings = Object.keys(ticket.settings || {}).length
    ? `\n\n## 生成参数\n\n\`\`\`json\n${JSON.stringify(ticket.settings, null, 2)}\n\`\`\``
    : "";
  return `# 生成提示词与结果记录

- 项目：${project.name || project.id}
- 类型：${kindLabel(ticket.kind)}
- 生成工具：${ticket.generator || "未登记"}
- 模型：${ticket.model || "未登记"}
- 集数：${ticket.episode || "-"}
- 场景：${ticket.scene || "-"}
- 镜头：${ticket.shot || "-"}
- 资产角色：${ticket.role || "-"}
- 版本：${ticket.version || "-"}
- 任务创建：${ticket.createdAt}
- 结果归档：${output.archivedAt}
- 结果文件：${output.relativePath}
- SHA-256：${output.sha256}

## 正向提示词

${ticket.prompt || "（未登记）"}

## 负向提示词 / 稳定性约束

${ticket.negativePrompt || "（未登记）"}

## 参考素材

${references}${settings}

## 备注

${ticket.notes || "（无）"}
`;
}

export class GenerationPipeline {
  constructor({ registryPath, bindingsPath = "" }) {
    this.registryPath = path.resolve(registryPath);
    this.lockPath = `${this.registryPath}.lock`;
    this.bindingsPath = path.resolve(bindingsPath || path.join(path.dirname(this.registryPath), ".thread-project-bindings.json"));
  }

  async withLock(operation) {
    await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
    let handle = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        handle = await fs.open(this.lockPath, "wx");
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!handle) throw new Error("生成任务正在被另一个操作更新，请稍后再试");
    try {
      return await operation();
    } finally {
      await handle.close().catch(() => {});
      await fs.rm(this.lockPath, { force: true }).catch(() => {});
    }
  }

  async readRegistry() {
    try {
      const data = JSON.parse((await fs.readFile(this.registryPath, "utf8")).replace(/^\uFEFF/, ""));
      return { version: 1, tickets: Array.isArray(data.tickets) ? data.tickets : [] };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { version: 1, tickets: [] };
    }
  }

  async writeRegistry(registry) {
    const temporaryPath = `${this.registryPath}.tmp`;
    await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
    await fs.writeFile(temporaryPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
    await fs.rename(temporaryPath, this.registryPath);
  }

  async readBindings() {
    try {
      const data = JSON.parse((await fs.readFile(this.bindingsPath, "utf8")).replace(/^\uFEFF/, ""));
      return { version: 1, bindings: data.bindings && typeof data.bindings === "object" ? data.bindings : {} };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { version: 1, bindings: {} };
    }
  }

  async writeBindings(data) {
    const temporaryPath = `${this.bindingsPath}.tmp`;
    await fs.mkdir(path.dirname(this.bindingsPath), { recursive: true });
    await fs.writeFile(temporaryPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    await fs.rename(temporaryPath, this.bindingsPath);
  }

  async listBindings() {
    const data = await this.readBindings();
    return Object.values(data.bindings).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async bindThread(input, config) {
    return await this.withLock(async () => {
      const threadId = String(input.threadId || "").trim();
      if (!threadId) throw new Error("绑定任务时必须提供 threadId");
      const profile = profileFor(config, input.profileId);
      const project = projectFor(config, input.projectId || profile?.projectId);
      if (profile && profile.projectId !== project.id) throw new Error("任务绑定的项目和分流项目不一致");
      if (["ai-reference-library", "reference-library"].includes(project.id)) {
        throw new Error("精选参考库只能手动收录，不能设为生成任务的自动归属");
      }
      const data = await this.readBindings();
      const now = new Date().toISOString();
      const binding = {
        threadId,
        projectId: project.id,
        projectName: project.name || project.id,
        profileId: profile?.id || "",
        profileName: profile?.name || "",
        source: String(input.source || "manual").trim(),
        sourceTask: String(input.sourceTask || "").trim(),
        createdAt: data.bindings[threadId]?.createdAt || now,
        updatedAt: now
      };
      data.bindings[threadId] = binding;
      await this.writeBindings(data);
      return binding;
    });
  }

  async unbindThread(threadId) {
    return await this.withLock(async () => {
      const key = String(threadId || "").trim();
      if (!key) throw new Error("取消绑定时必须提供 threadId");
      const data = await this.readBindings();
      const previous = data.bindings[key] || null;
      delete data.bindings[key];
      await this.writeBindings(data);
      return { removed: Boolean(previous), binding: previous };
    });
  }

  async resolveRouting(input, config) {
    const explicitProfile = profileFor(config, input.profileId);
    if (input.profileId && !explicitProfile) throw new Error(`分流项目不存在：${input.profileId}`);
    if (input.projectId || explicitProfile) {
      const project = projectFor(config, input.projectId || explicitProfile.projectId);
      if (explicitProfile && explicitProfile.projectId !== project.id) throw new Error("生成任务的项目和分流项目不一致");
      if (["ai-reference-library", "reference-library"].includes(project.id)) {
        throw new Error("精选参考库只能手动收录，不能作为生成结果的默认目的地");
      }
      return { project, profile: explicitProfile, source: "explicit", confidence: "high" };
    }

    const threadId = threadIdFor(input);
    if (threadId) {
      const bindings = await this.readBindings();
      const binding = bindings.bindings[threadId];
      if (binding) {
        const project = (config.projects || []).find((item) => item.id === binding.projectId);
        const profile = profileFor(config, binding.profileId);
        if (project && (!profile || profile.projectId === project.id)) {
          return { project, profile, source: "thread-binding", confidence: "high", binding };
        }
      }
    }

    const keyword = keywordRouting(config, input);
    if (keyword?.matchedOn === "context") {
      return {
        project: keyword.project,
        profile: keyword.profile,
        source: "keyword",
        confidence: keyword.matchedOn === "context" ? "high" : "medium",
        matchedKeyword: keyword.matchedKeyword,
        matchedOn: keyword.matchedOn
      };
    }

    const pending = pendingRouting(config);
    if (pending) return { ...pending, source: "pending-fallback", confidence: "low" };
    throw new Error("无法确定生成结果归属，且未配置“待确认”项目；请提供 projectId 或 profileId");
  }

  async list({ limit = 100, status = "" } = {}) {
    const registry = await this.readRegistry();
    const statuses = String(status || "").split(",").map((item) => item.trim()).filter(Boolean);
    return registry.tickets
      .filter((ticket) => !statuses.length || statuses.includes(ticket.status))
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
      .slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)));
  }

  async get(ticketId) {
    const registry = await this.readRegistry();
    const ticket = registry.tickets.find((item) => item.id === ticketId);
    if (!ticket) throw new Error(`生成任务不存在：${ticketId}`);
    return ticket;
  }

  async status() {
    const tickets = await this.list({ limit: 500 });
    const counts = {};
    for (const ticket of tickets) counts[ticket.status] = (counts[ticket.status] || 0) + 1;
    return {
      counts,
      active: tickets.filter((ticket) => ["draft", "awaiting_download", "claiming", "generated"].includes(ticket.status)),
      recent: tickets.slice(0, 30)
    };
  }

  async create(input, config) {
    return await this.withLock(async () => {
      const now = new Date();
      const kind = ["image", "video", "audio"].includes(input.kind) ? input.kind : "image";
      const resolution = await this.resolveRouting({ ...input, kind }, config);
      const { project, profile } = resolution;
      const destinationRelativePath = defaultDestination(config, { ...input, kind }, project, profile, localDateParts(now).date);
      const destinationPath = path.resolve(project.path, destinationRelativePath);
      if (!isInside(project.path, destinationPath)) throw new Error("生成资产目录跳出了项目文件夹");
      const versionNumber = Number.parseInt(input.version, 10);
      const ticket = {
        id: makeTicketId(now),
        projectId: project.id,
        projectName: project.name || project.id,
        profileId: profile?.id || "",
        profileName: profile?.name || "",
        kind,
        generator: cleanSegment(input.generator, { video: "tapnow", audio: "codex-audio", image: "codex-image" }[kind]),
        model: String(input.model || "").trim(),
        episode: String(input.episode || "").trim(),
        scene: String(input.scene || "").trim(),
        shot: String(input.shot || "").trim(),
        role: String(input.role || "").trim(),
        version: Number.isFinite(versionNumber) && versionNumber > 0 ? versionNumber : 1,
        nameStem: buildNameStem({ ...input, kind }, now),
        destinationRelativePath,
        prompt: String(input.prompt || "").trim(),
        negativePrompt: String(input.negativePrompt || "").trim(),
        references: Array.isArray(input.references) ? input.references.map(String).filter(Boolean) : [],
        settings: input.settings && typeof input.settings === "object" && !Array.isArray(input.settings) ? input.settings : {},
        notes: String(input.notes || "").trim(),
        sourceContext: input.sourceContext && typeof input.sourceContext === "object" ? input.sourceContext : {},
        routingResolution: {
          source: resolution.source,
          confidence: resolution.confidence,
          matchedKeyword: resolution.matchedKeyword || "",
          matchedOn: resolution.matchedOn || "",
          threadId: threadIdFor(input)
        },
        status: "draft",
        outputs: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };
      const registry = await this.readRegistry();
      registry.tickets.push(ticket);
      await this.writeRegistry(registry);
      const threadId = threadIdFor(input);
      const shouldBind = threadId
        && input.bindThread !== false
        && project.id !== "pending-review"
        && (resolution.source === "explicit" || (resolution.source === "keyword" && resolution.confidence === "high"));
      if (shouldBind) {
        const bindings = await this.readBindings();
        const sourceTask = String(input.sourceContext?.sourceTask || input.sourceContext?.taskTitle || "").trim();
        bindings.bindings[threadId] = {
          threadId,
          projectId: project.id,
          projectName: project.name || project.id,
          profileId: profile?.id || "",
          profileName: profile?.name || "",
          source: resolution.source,
          sourceTask,
          createdAt: bindings.bindings[threadId]?.createdAt || now.toISOString(),
          updatedAt: now.toISOString()
        };
        await this.writeBindings(bindings);
      }
      return { ...ticket, destinationPath, expectedName: ticket.nameStem };
    });
  }

  async arm(ticketId, { sourcePath = "", expectedName = "" } = {}) {
    return await this.withLock(async () => {
      const registry = await this.readRegistry();
      const ticket = registry.tickets.find((item) => item.id === ticketId);
      if (!ticket) throw new Error(`生成任务不存在：${ticketId}`);
      const inboxPath = path.resolve(sourcePath);
      if (!sourcePath || !await exists(inboxPath)) throw new Error("下载文件夹不存在，无法等待下一个结果");
      const conflictingTicket = registry.tickets.find((item) => item.id !== ticket.id
        && ["awaiting_download", "claiming"].includes(item.status)
        && item.kind === ticket.kind
        && item.inboxPath
        && path.resolve(item.inboxPath).toLowerCase() === inboxPath.toLowerCase());
      if (conflictingTicket) {
        throw new Error(`已有同类型下载任务正在等待：${conflictingTicket.id}。请先完成/取消它，或使用 TapNow 资产 ID 直接绑定。`);
      }
      const exactName = exactDownloadName(expectedName);
      const baseline = [];
      if (exactName) {
        const exactPath = path.join(inboxPath, exactName);
        try {
          const stats = await fs.stat(exactPath);
          if (stats.isFile() && !isTemporary(exactName)) baseline.push(`${exactName}|${stats.size}|${stats.mtimeMs}`);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      ticket.status = "awaiting_download";
      ticket.armedAt = new Date().toISOString();
      ticket.inboxPath = inboxPath;
      ticket.inboxBaseline = baseline;
      ticket.expectedDownloadName = exactName;
      ticket.claimObservation = exactName ? null : {
        state: "identity-required",
        observedAt: ticket.armedAt,
        message: "No exact generated file name or asset ID was supplied; automatic claiming is disabled."
      };
      ticket.updatedAt = ticket.armedAt;
      await this.writeRegistry(registry);
      return ticket;
    });
  }

  async markGenerated(ticketId, extra = {}) {
    return await this.withLock(async () => {
      const registry = await this.readRegistry();
      const ticket = registry.tickets.find((item) => item.id === ticketId);
      if (!ticket) throw new Error(`生成任务不存在：${ticketId}`);
      ticket.status = "generated";
      ticket.generatorResult = { ...(ticket.generatorResult || {}), ...extra };
      ticket.updatedAt = new Date().toISOString();
      await this.writeRegistry(registry);
      return ticket;
    });
  }

  async cancel(ticketId, reason = "") {
    return await this.withLock(async () => {
      const registry = await this.readRegistry();
      const ticket = registry.tickets.find((item) => item.id === ticketId);
      if (!ticket) throw new Error(`生成任务不存在：${ticketId}`);
      ticket.status = "cancelled";
      ticket.cancelReason = String(reason || "").trim();
      ticket.updatedAt = new Date().toISOString();
      await this.writeRegistry(registry);
      return ticket;
    });
  }

  async relocateArchivedOutput(ticketId, input, config) {
    return await this.withLock(async () => {
      const registry = await this.readRegistry();
      const ticket = registry.tickets.find((item) => item.id === ticketId);
      if (!ticket) throw new Error(`生成任务不存在：${ticketId}`);
      const project = projectFor(config, input.projectId);
      const profile = profileFor(config, input.profileId);
      if (profile && profile.projectId !== project.id) throw new Error("移动后的项目和分流项目不一致");
      const oldPath = path.resolve(String(input.oldPath || ""));
      const newPath = path.resolve(String(input.newPath || ""));
      const output = ticket.outputs.find((item) => item.path && path.resolve(item.path).toLowerCase() === oldPath.toLowerCase())
        || ticket.outputs.find((item) => item.id === input.outputId)
        || null;
      if (!output) throw new Error(`生成任务中没有找到待迁移输出：${path.basename(oldPath)}`);
      if (!isInside(project.path, newPath)) throw new Error("移动后的生成结果跳出了目标项目文件夹");
      const ext = path.extname(newPath);
      const stemPath = newPath.slice(0, -ext.length);
      const previous = {
        projectId: ticket.projectId,
        profileId: ticket.profileId,
        path: output.path,
        relativePath: output.relativePath
      };
      ticket.projectId = project.id;
      ticket.projectName = project.name || project.id;
      ticket.profileId = profile?.id || "";
      ticket.profileName = profile?.name || "";
      ticket.destinationRelativePath = path.dirname(path.relative(project.path, newPath));
      ticket.routingResolution = {
        source: "manual-move",
        confidence: "high",
        matchedKeyword: "",
        matchedOn: "",
        threadId: threadIdFor(ticket)
      };
      output.path = newPath;
      output.relativePath = path.relative(project.path, newPath);
      output.fileName = path.basename(newPath);
      output.promptPath = `${stemPath}.prompt.md`;
      output.metaPath = `${stemPath}.meta.json`;
      const movedAt = new Date().toISOString();
      ticket.relocationHistory = Array.isArray(ticket.relocationHistory) ? ticket.relocationHistory : [];
      ticket.relocationHistory.push({ ...previous, movedAt, projectId: project.id, profileId: profile?.id || "", path: newPath });
      ticket.updatedAt = movedAt;
      await this.writeRegistry(registry);
      return { ticket, output, movedAt, previous };
    });
  }

  async attach(ticketId, input, config) {
    return await this.withLock(async () => {
      const registry = await this.readRegistry();
      const ticket = registry.tickets.find((item) => item.id === ticketId);
      if (!ticket) throw new Error(`生成任务不存在：${ticketId}`);
      const project = projectFor(config, ticket.projectId);
      const sourcePath = path.resolve(String(input.sourcePath || ""));
      const sourceStats = await fs.stat(sourcePath);
      if (!sourceStats.isFile()) throw new Error("生成结果不是文件");
      const kind = assetKind(sourcePath);
      if (kind !== ticket.kind) throw new Error(`文件类型与任务不一致：任务是 ${ticket.kind}，文件是 ${kind}`);

      const destinationDir = path.resolve(project.path, cleanRelative(ticket.destinationRelativePath, "生成资产目录"));
      if (!isInside(project.path, destinationDir)) throw new Error("生成资产目录跳出了项目文件夹");
      await fs.mkdir(destinationDir, { recursive: true });
      const ext = path.extname(sourcePath).toLowerCase();
      const baseStem = cleanSegment(input.nameStem || ticket.nameStem, "生成资产");
      const takeSuffix = ticket.outputs.length ? `_take${pad(ticket.outputs.length + 1)}` : "";
      const requestedPath = path.join(destinationDir, `${baseStem}${takeSuffix}${ext}`);
      const sourceHash = await hashFile(sourcePath);
      const duplicateOutput = ticket.outputs.find((item) => item.sha256 === sourceHash && item.path);
      if (duplicateOutput && await exists(duplicateOutput.path) && await hashFile(duplicateOutput.path) === sourceHash) {
        const sourceIsArchivedOutput = path.resolve(sourcePath).toLowerCase() === path.resolve(duplicateOutput.path).toLowerCase();
        if (input.moveSource === true && !sourceIsArchivedOutput) await fs.rm(sourcePath, { force: false });
        ticket.status = "archived";
        ticket.updatedAt = new Date().toISOString();
        ticket.inboxBaseline = undefined;
        ticket.claimSourcePath = undefined;
        await this.writeRegistry(registry);
        return {
          ticket,
          output: duplicateOutput,
          ledgerPath: path.join(project.path, "生成记录", "生成资产台账.jsonl"),
          duplicate: true
        };
      }

      const sourceIsRequestedPath = path.resolve(sourcePath).toLowerCase() === path.resolve(requestedPath).toLowerCase();
      const destinationPath = sourceIsRequestedPath ? requestedPath : await uniquePath(requestedPath);
      const sameFile = path.resolve(sourcePath).toLowerCase() === path.resolve(destinationPath).toLowerCase();
      let sha256 = sourceHash;

      if (!sameFile) {
        const temporaryPath = path.join(destinationDir, `.${path.basename(destinationPath)}.${ticket.id}.partial`);
        await fs.copyFile(sourcePath, temporaryPath);
        const copiedHash = await hashFile(temporaryPath);
        if (sourceHash !== copiedHash) {
          await fs.rm(temporaryPath, { force: true });
          throw new Error("生成结果归档校验失败，源文件保持不动");
        }
        await fs.rename(temporaryPath, destinationPath);
        if (input.moveSource === true) await fs.rm(sourcePath, { force: false });
      }
      const archivedStats = await fs.stat(destinationPath);
      const archivedAt = new Date().toISOString();
      const relativePath = path.relative(project.path, destinationPath);
      const output = {
        id: `${ticket.id}-out-${pad(ticket.outputs.length + 1)}`,
        path: destinationPath,
        relativePath,
        sourcePath: relativeOrAbsolute(project.path, sourcePath),
        fileName: path.basename(destinationPath),
        size: archivedStats.size,
        sha256,
        archivedAt,
        movedSource: input.moveSource === true && !sameFile
      };
      const stemPath = destinationPath.slice(0, -ext.length);
      const promptPath = `${stemPath}.prompt.md`;
      const metaPath = `${stemPath}.meta.json`;
      output.promptPath = promptPath;
      output.metaPath = metaPath;
      await fs.writeFile(promptPath, promptMarkdown(ticket, output, project), "utf8");
      await fs.writeFile(metaPath, JSON.stringify({
        schemaVersion: 1,
        ticket: { ...ticket, outputs: undefined, inboxBaseline: undefined },
        output,
        project: { id: project.id, name: project.name || project.id, path: project.path }
      }, null, 2) + "\n", "utf8");

      const ledgerDir = path.join(project.path, "生成记录");
      await fs.mkdir(ledgerDir, { recursive: true });
      const ledgerPath = path.join(ledgerDir, "生成资产台账.jsonl");
      await fs.appendFile(ledgerPath, JSON.stringify({
        schemaVersion: 1,
        ticketId: ticket.id,
        projectId: ticket.projectId,
        kind: ticket.kind,
        generator: ticket.generator,
        model: ticket.model,
        prompt: ticket.prompt,
        negativePrompt: ticket.negativePrompt,
        references: ticket.references,
        settings: ticket.settings,
        episode: ticket.episode,
        scene: ticket.scene,
        shot: ticket.shot,
        role: ticket.role,
        version: ticket.version,
        output
      }) + "\n", "utf8");

      ticket.outputs.push(output);
      ticket.status = "archived";
      ticket.updatedAt = archivedAt;
      ticket.inboxBaseline = undefined;
      ticket.claimSourcePath = undefined;
      await this.writeRegistry(registry);
      return { ticket, output, ledgerPath };
    });
  }

  async claimArmedDownloads(config, { settleSeconds = 4 } = {}) {
    const tickets = (await this.list({ limit: 100, status: "awaiting_download" }))
      .sort((a, b) => Date.parse(a.armedAt) - Date.parse(b.armedAt));
    const claimed = [];
    for (const ticket of tickets) {
      const inboxPath = ticket.inboxPath;
      if (!inboxPath || !await exists(inboxPath)) continue;

      let expectedName = "";
      try {
        expectedName = exactDownloadName(ticket.expectedDownloadName);
      } catch {
        expectedName = "";
      }
      if (!expectedName) {
        await this.withLock(async () => {
          const registry = await this.readRegistry();
          const current = registry.tickets.find((item) => item.id === ticket.id);
          if (!current || current.status !== "awaiting_download") return;
          if (current.claimObservation?.state === "identity-required") return;
          current.claimObservation = {
            state: "identity-required",
            observedAt: new Date().toISOString(),
            message: "No exact generated file name or asset ID was supplied; automatic claiming is disabled."
          };
          current.updatedAt = current.claimObservation.observedAt;
          await this.writeRegistry(registry);
        });
        continue;
      }

      const candidatePath = path.join(inboxPath, expectedName);
      if (assetKind(candidatePath) !== ticket.kind || isTemporary(expectedName)) continue;
      let stats;
      try {
        stats = await fs.stat(candidatePath);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (!stats.isFile()) continue;
      const fingerprint = `${expectedName}|${stats.size}|${stats.mtimeMs}`;
      if (new Set(ticket.inboxBaseline || []).has(fingerprint)) continue;
      if (stats.mtimeMs < Date.parse(ticket.armedAt) - 2000) continue;
      if (Date.now() - stats.mtimeMs < Math.max(1, settleSeconds) * 1000) continue;

      const normalizedCandidate = path.resolve(candidatePath).toLowerCase();
      const reserved = await this.withLock(async () => {
        const registry = await this.readRegistry();
        const current = registry.tickets.find((item) => item.id === ticket.id);
        if (!current || current.status !== "awaiting_download") return false;
        let currentName = "";
        try {
          currentName = exactDownloadName(current.expectedDownloadName);
        } catch {
          return false;
        }
        const currentPath = path.resolve(current.inboxPath || "", currentName).toLowerCase();
        if (currentPath !== normalizedCandidate) return false;
        current.status = "claiming";
        current.claimSourcePath = path.resolve(candidatePath);
        current.updatedAt = new Date().toISOString();
        await this.writeRegistry(registry);
        return true;
      });
      if (!reserved) continue;

      try {
        claimed.push(await this.attach(ticket.id, {
          sourcePath: candidatePath,
          moveSource: config.automation?.inbox?.transferMode === "move"
        }, config));
      } catch (error) {
        await this.withLock(async () => {
          const registry = await this.readRegistry();
          const current = registry.tickets.find((item) => item.id === ticket.id);
          if (!current || current.status !== "claiming" || String(current.claimSourcePath || "").toLowerCase() !== normalizedCandidate) return;
          current.status = "awaiting_download";
          current.claimSourcePath = undefined;
          current.claimObservation = {
            state: "claim-failed",
            observedAt: new Date().toISOString(),
            message: error.message || String(error)
          };
          current.updatedAt = current.claimObservation.observedAt;
          await this.writeRegistry(registry);
        });
      }
    }
    return claimed;
  }
}

export function generationAssetKind(filePath) {
  return assetKind(filePath);
}
