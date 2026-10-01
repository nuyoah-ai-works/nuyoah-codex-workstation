import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif", ".heic"]);
const videoExts = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".mts", ".m2ts"]);
const audioExts = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".aiff", ".aif"]);
const installerExts = new Set([".exe", ".msi", ".msix", ".appx"]);
const archiveExts = new Set([".zip", ".rar", ".7z", ".tar", ".gz"]);
const documentExts = new Set([".md", ".txt", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv"]);
const temporaryExts = new Set([".crdownload", ".part", ".partial", ".tmp", ".download"]);
const routingTypes = ["image", "video", "audio", "installer", "archive", "document", "other"];

const clampNumber = (value, fallback, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

function defaultDownloadsPath() {
  return path.join(os.homedir(), "Downloads");
}

export function normalizeAutomation(raw = {}) {
  const sourcePath = path.resolve(raw.inbox?.sourcePath || defaultDownloadsPath());
  const quarantinePath = path.resolve(raw.cleanup?.quarantinePath || path.join(sourcePath, ".asset-browser-quarantine"));
  const routingProfiles = (raw.routing?.profiles || []).map((profile) => ({
    id: String(profile.id || "").trim(),
    name: String(profile.name || profile.id || "未命名项目").trim(),
    projectId: String(profile.projectId || "").trim(),
    basePath: String(profile.basePath || "").trim(),
    keywords: (profile.keywords || []).map((item) => String(item || "").trim()).filter(Boolean),
    routes: {
      image: String(profile.routes?.image ?? "图片/{date}").trim(),
      video: String(profile.routes?.video ?? "视频/{date}").trim(),
      audio: String(profile.routes?.audio ?? "音频/{date}").trim(),
      installer: String(profile.routes?.installer ?? "").trim(),
      archive: String(profile.routes?.archive ?? "").trim(),
      document: String(profile.routes?.document ?? "").trim(),
      other: String(profile.routes?.other ?? "").trim()
    }
  })).filter((profile) => profile.id && profile.projectId);
  return {
    inbox: {
      enabled: Boolean(raw.inbox?.enabled),
      capturePolicy: raw.inbox?.capturePolicy === "all-downloads" ? "all-downloads" : "ticketed-only",
      sourcePath,
      projectId: String(raw.inbox?.projectId || ""),
      basePath: String(raw.inbox?.basePath || "").trim(),
      startedAt: raw.inbox?.startedAt || null,
      transferMode: raw.inbox?.transferMode === "move" ? "move" : "copy",
      moveApprovedAt: raw.inbox?.moveApprovedAt || null,
      settleSeconds: clampNumber(raw.inbox?.settleSeconds, 8, 3, 3600),
      pollSeconds: clampNumber(raw.inbox?.pollSeconds, 15, 5, 3600),
      routes: {
        image: String(raw.inbox?.routes?.image ?? "assets/inbox/images").trim(),
        video: String(raw.inbox?.routes?.video ?? "assets/inbox/videos").trim(),
        audio: String(raw.inbox?.routes?.audio ?? "assets/inbox/audio").trim(),
        other: String(raw.inbox?.routes?.other ?? "").trim()
      }
    },
    routing: {
      enabled: Boolean(raw.routing?.enabled) && routingProfiles.length > 0,
      activeProfileId: String(raw.routing?.activeProfileId || "").trim(),
      useActiveForUnmatchedTypes: (raw.routing?.useActiveForUnmatchedTypes || ["image", "video"])
        .map((item) => String(item || "").trim())
        .filter((item) => routingTypes.includes(item)),
      fallbackProfileIds: {
        image: String(raw.routing?.fallbackProfileIds?.image || "").trim(),
        video: String(raw.routing?.fallbackProfileIds?.video || "").trim(),
        audio: String(raw.routing?.fallbackProfileIds?.audio || "").trim(),
        installer: String(raw.routing?.fallbackProfileIds?.installer || "").trim(),
        archive: String(raw.routing?.fallbackProfileIds?.archive || "").trim(),
        document: String(raw.routing?.fallbackProfileIds?.document || "").trim(),
        other: String(raw.routing?.fallbackProfileIds?.other || "").trim()
      },
      profiles: routingProfiles
    },
    cleanup: {
      enabled: Boolean(raw.cleanup?.enabled),
      dryRun: raw.cleanup?.dryRun !== false,
      approvedAt: raw.cleanup?.approvedAt || null,
      intervalHours: clampNumber(raw.cleanup?.intervalHours, 24, 1, 24 * 30),
      retentionDays: clampNumber(raw.cleanup?.retentionDays, 30, 1, 3650),
      quarantinePath,
      purgeEnabled: Boolean(raw.cleanup?.purgeEnabled),
      purgeApprovedAt: raw.cleanup?.purgeApprovedAt || null,
      quarantineDays: clampNumber(raw.cleanup?.quarantineDays, 14, 1, 3650),
      onlyImported: true
    }
  };
}

function isInside(root, target) {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  return absoluteTarget === absoluteRoot || absoluteTarget.startsWith(absoluteRoot + path.sep);
}

function safeProjectRelative(value, label) {
  const text = String(value || "").trim();
  if (!text || text === ".") return "";
  if (path.isAbsolute(text)) throw new Error(`${label}必须是项目内的相对路径`);
  const normalized = path.normalize(text);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`${label}不能跳出项目文件夹`);
  }
  return normalized;
}

function assetType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (imageExts.has(ext)) return "image";
  if (videoExts.has(ext)) return "video";
  if (audioExts.has(ext)) return "audio";
  if (installerExts.has(ext)) return "installer";
  if (archiveExts.has(ext)) return "archive";
  if (documentExts.has(ext)) return "document";
  return "other";
}

function isTemporary(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return name.startsWith("~$") || temporaryExts.has(path.extname(name));
}

function fingerprint(filePath, stats) {
  const canonicalPath = process.platform === "win32" ? path.resolve(filePath).toLowerCase() : path.resolve(filePath);
  return createHash("sha256")
    .update(`${canonicalPath}\0${stats.size}\0${Math.trunc(stats.mtimeMs)}`)
    .digest("hex");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function uniquePath(desiredPath) {
  if (!await pathExists(desiredPath)) return desiredPath;
  const dir = path.dirname(desiredPath);
  const ext = path.extname(desiredPath);
  const stem = path.basename(desiredPath, ext);
  for (let index = 2; index < 10000; index += 1) {
    const candidate = path.join(dir, `${stem} (${index})${ext}`);
    if (!await pathExists(candidate)) return candidate;
  }
  throw new Error(`无法为 ${path.basename(desiredPath)} 生成不冲突的文件名`);
}

function cleanResultItem(item) {
  return {
    fingerprint: item.fingerprint,
    name: item.name,
    type: item.type,
    size: item.size,
    ageSeconds: item.ageSeconds,
    sourcePath: item.sourcePath,
    destinationPath: item.destinationPath,
    projectId: item.projectId,
    profileId: item.profileId,
    profileName: item.profileName,
    reason: item.reason,
    importedAt: item.importedAt,
    quarantinedAt: item.quarantinedAt,
    transferredAt: item.transferredAt
  };
}

export class DownloadAutomation {
  constructor({ ledgerPath }) {
    this.ledgerPath = ledgerPath;
  }

  async readLedger() {
    try {
      const ledger = JSON.parse((await fs.readFile(this.ledgerPath, "utf8")).replace(/^\uFEFF/, ""));
      return {
        version: 1,
        imports: ledger.imports || {},
        runs: Array.isArray(ledger.runs) ? ledger.runs : [],
        lastOrganizerRunAt: ledger.lastOrganizerRunAt || null,
        lastCleanupRunAt: ledger.lastCleanupRunAt || null
      };
    } catch {
      return { version: 1, imports: {}, runs: [], lastOrganizerRunAt: null, lastCleanupRunAt: null };
    }
  }

  async writeLedger(ledger) {
    const temporaryPath = `${this.ledgerPath}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
    await fs.writeFile(temporaryPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
    await fs.rename(temporaryPath, this.ledgerPath);
  }

  async listInbox(config) {
    const sourceRoot = path.resolve(config.inbox.sourcePath);
    let entries;
    try {
      entries = await fs.readdir(sourceRoot, { withFileTypes: true });
    } catch (error) {
      throw new Error(`下载文件夹不可用：${sourceRoot}（${error.message}）`);
    }

    const now = Date.now();
    const stable = [];
    const pending = [];
    const ignoredBefore = [];
    const startedAt = Date.parse(config.inbox.startedAt || "");
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const sourcePath = path.join(sourceRoot, entry.name);
      if (isTemporary(sourcePath)) {
        pending.push({ name: entry.name, sourcePath, reason: "仍在下载" });
        continue;
      }
      const stats = await fs.lstat(sourcePath);
      if (!stats.isFile() || stats.isSymbolicLink()) continue;
      const ageSeconds = Math.max(0, (now - stats.mtimeMs) / 1000);
      const item = {
        name: entry.name,
        sourcePath,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        atime: stats.atime,
        mtime: stats.mtime,
        ageSeconds,
        type: assetType(sourcePath),
        fingerprint: fingerprint(sourcePath, stats)
      };
      if (Number.isFinite(startedAt) && stats.mtimeMs < startedAt) {
        ignoredBefore.push({ ...item, reason: "自动归档启用前已有文件" });
        continue;
      }
      if (ageSeconds < config.inbox.settleSeconds) {
        pending.push({ ...item, reason: "等待下载完成并稳定" });
      } else {
        stable.push(item);
      }
    }
    return { stable, pending, ignoredBefore };
  }

  resolveProject(config, projects) {
    const project = projects.find((item) => item.id === config.inbox.projectId);
    if (!project) throw new Error("请先选择一个有效的目标项目");
    return project;
  }

  routingDecision(item, config, projects) {
    if (!config.routing.enabled) {
      const project = this.resolveProject(config, projects);
      const desiredPath = this.destinationFor(item, config, project);
      return desiredPath ? { project, desiredPath, profileId: "", profileName: project.name } : null;
    }

    const profiles = config.routing.profiles;
    const lowerName = item.name.toLowerCase();
    let profile = profiles.find((candidate) => candidate.keywords.some((keyword) => lowerName.includes(keyword.toLowerCase())));
    if (!profile && config.routing.useActiveForUnmatchedTypes.includes(item.type)) {
      profile = profiles.find((candidate) => candidate.id === config.routing.activeProfileId);
    }
    if (!profile) {
      const fallbackId = config.routing.fallbackProfileIds[item.type];
      profile = profiles.find((candidate) => candidate.id === fallbackId);
    }
    if (!profile) return null;

    const project = projects.find((candidate) => candidate.id === profile.projectId);
    if (!project) throw new Error(`分流项目不存在：${profile.name}`);
    const routeTemplate = profile.routes[item.type];
    const route = safeProjectRelative(this.expandRoute(routeTemplate, item), `${profile.name} 的 ${item.type} 归档目录`);
    if (!route) return null;
    const basePath = safeProjectRelative(this.expandRoute(profile.basePath, item), `${profile.name} 的基础目录`);
    const destinationDir = path.resolve(project.path, basePath, route);
    if (!isInside(project.path, destinationDir)) throw new Error(`${profile.name} 的目标目录跳出了项目文件夹`);
    return {
      project,
      desiredPath: path.join(destinationDir, item.name),
      profileId: profile.id,
      profileName: profile.name
    };
  }

  expandRoute(template, item) {
    const date = new Date(item.mtimeMs);
    const year = String(date.getFullYear());
    const month = `${year}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const day = `${month}-${String(date.getDate()).padStart(2, "0")}`;
    return String(template || "")
      .replaceAll("{date}", day)
      .replaceAll("{month}", month)
      .replaceAll("{year}", year);
  }

  destinationFor(item, config, project) {
    const route = safeProjectRelative(config.inbox.routes[item.type], `${item.type} 归档目录`);
    if (!route) return null;
    const basePath = safeProjectRelative(config.inbox.basePath, "项目内基础目录");
    const destinationDir = path.resolve(project.path, basePath, route);
    if (!isInside(project.path, destinationDir)) throw new Error("目标目录跳出了项目文件夹");
    return path.join(destinationDir, item.name);
  }

  async previewOrganizer(rawConfig, projects) {
    const config = normalizeAutomation(rawConfig);
    if (config.inbox.capturePolicy !== "all-downloads") {
      return {
        capturePolicy: config.inbox.capturePolicy,
        sourcePath: config.inbox.sourcePath,
        disabledReason: "当前只接收已登记的生成任务；普通下载文件不会被扫描、复制或移动。",
        project: null,
        activeProfileId: config.routing.activeProfileId,
        planned: [],
        pending: [],
        alreadyImported: [],
        ignored: []
      };
    }
    const project = config.routing.enabled ? null : this.resolveProject(config, projects);
    const ledger = await this.readLedger();
    const { stable, pending, ignoredBefore } = await this.listInbox(config);
    const planned = [];
    const alreadyImported = [];
    const ignored = [...ignoredBefore];

    for (const item of stable) {
      const previous = ledger.imports[item.fingerprint];
      if (previous?.targetPath && await pathExists(previous.targetPath)) {
        alreadyImported.push({ ...item, destinationPath: previous.targetPath, reason: "已经归档" });
        continue;
      }
      const decision = this.routingDecision(item, config, projects);
      if (!decision) {
        ignored.push({ ...item, reason: `${item.type} 类型没有匹配的项目规则` });
        continue;
      }
      planned.push({
        ...item,
        destinationPath: await uniquePath(decision.desiredPath),
        projectId: decision.project.id,
        profileId: decision.profileId,
        profileName: decision.profileName
      });
    }

    return {
      project: project ? { id: project.id, name: project.name, path: project.path } : null,
      activeProfileId: config.routing.activeProfileId,
      sourcePath: config.inbox.sourcePath,
      planned: planned.map(cleanResultItem),
      pending: pending.map(cleanResultItem),
      alreadyImported: alreadyImported.map(cleanResultItem),
      ignored: ignored.map(cleanResultItem)
    };
  }

  async runOrganizer(rawConfig, projects) {
    const config = normalizeAutomation(rawConfig);
    if (config.inbox.capturePolicy !== "all-downloads") {
      return {
        capturePolicy: config.inbox.capturePolicy,
        sourcePath: config.inbox.sourcePath,
        disabledReason: "当前只接收已登记的生成任务；普通下载文件保持原位。",
        imported: [],
        pending: [],
        alreadyImported: [],
        ignored: [],
        failed: []
      };
    }
    if (config.inbox.transferMode === "move" && !config.inbox.moveApprovedAt) {
      throw new Error("自动转移尚未获得明确确认");
    }
    if (!config.routing.enabled) this.resolveProject(config, projects);
    const ledger = await this.readLedger();
    const { stable, pending, ignoredBefore } = await this.listInbox(config);
    const imported = [];
    const alreadyImported = [];
    const ignored = [...ignoredBefore];
    const failed = [];

    for (const item of stable) {
      try {
        const previous = ledger.imports[item.fingerprint];
        if (previous?.targetPath && await pathExists(previous.targetPath)) {
          alreadyImported.push({ ...item, destinationPath: previous.targetPath, reason: "已经归档" });
          continue;
        }
        const decision = this.routingDecision(item, config, projects);
        if (!decision) {
          ignored.push({ ...item, reason: `${item.type} 类型没有匹配的项目规则` });
          continue;
        }

        const desiredPath = decision.desiredPath;

        await fs.mkdir(path.dirname(desiredPath), { recursive: true });
        const sourceHash = await hashFile(item.sourcePath);
        let destinationPath = desiredPath;
        let copied = true;
        if (await pathExists(destinationPath)) {
          const existingStats = await fs.lstat(destinationPath);
          if (existingStats.isFile() && !existingStats.isSymbolicLink() && existingStats.size === item.size && await hashFile(destinationPath) === sourceHash) {
            copied = false;
          } else {
            destinationPath = await uniquePath(destinationPath);
          }
        }

        if (copied) {
          const temporaryPath = path.join(path.dirname(destinationPath), `.${path.basename(destinationPath)}.${process.pid}.${Date.now()}.copying`);
          await fs.copyFile(item.sourcePath, temporaryPath);
          const afterStats = await fs.lstat(item.sourcePath);
          if (fingerprint(item.sourcePath, afterStats) !== item.fingerprint) {
            await fs.rm(temporaryPath, { force: true });
            throw new Error("复制时源文件仍在变化，本轮已跳过");
          }
          await fs.rename(temporaryPath, destinationPath);
          await fs.utimes(destinationPath, item.atime, item.mtime);
        }

        if (await hashFile(destinationPath) !== sourceHash) {
          throw new Error("项目目标文件内容复核失败，下载原件已保留");
        }
        const transferred = config.inbox.transferMode === "move";
        if (transferred) await fs.unlink(item.sourcePath);

        const record = {
          fingerprint: item.fingerprint,
          sourcePath: item.sourcePath,
          sourceName: item.name,
          size: item.size,
          mtimeMs: Math.trunc(item.mtimeMs),
          contentHash: sourceHash,
          targetPath: destinationPath,
          projectId: decision.project.id,
          profileId: decision.profileId,
          profileName: decision.profileName,
          type: item.type,
          importedAt: new Date().toISOString(),
          status: transferred ? "transferred" : "imported",
          transferredAt: transferred ? new Date().toISOString() : null
        };
        ledger.imports[item.fingerprint] = record;
        imported.push({
          ...item,
          destinationPath,
          projectId: decision.project.id,
          profileId: decision.profileId,
          profileName: decision.profileName,
          transferredAt: record.transferredAt,
          reason: transferred ? "已校验并转移" : copied ? "已复制" : "项目内已有相同文件，已登记"
        });
      } catch (error) {
        failed.push({ ...item, reason: error.message || String(error) });
      }
    }

    ledger.lastOrganizerRunAt = new Date().toISOString();
    ledger.runs.push({
      type: "organizer",
      at: ledger.lastOrganizerRunAt,
      imported: imported.length,
      alreadyImported: alreadyImported.length,
      ignored: ignored.length,
      failed: failed.length
    });
    ledger.runs = ledger.runs.slice(-100);
    await this.writeLedger(ledger);
    return {
      imported: imported.map(cleanResultItem),
      pending: pending.map(cleanResultItem),
      alreadyImported: alreadyImported.map(cleanResultItem),
      ignored: ignored.map(cleanResultItem),
      failed: failed.map(cleanResultItem)
    };
  }

  async previewCleanup(rawConfig) {
    const config = normalizeAutomation(rawConfig);
    if (config.inbox.capturePolicy !== "all-downloads") {
      return {
        capturePolicy: config.inbox.capturePolicy,
        disabledReason: "Cleanup is disabled while generated-ticket-only capture is active.",
        candidates: [],
        protectedItems: []
      };
    }
    const ledger = await this.readLedger();
    const sourceRoot = path.resolve(config.inbox.sourcePath);
    const cutoff = Date.now() - config.cleanup.retentionDays * 24 * 60 * 60 * 1000;
    const candidates = [];
    const protectedItems = [];

    for (const record of Object.values(ledger.imports)) {
      if (record.status !== "imported" || !record.sourcePath || !record.targetPath) continue;
      if (!isInside(sourceRoot, record.sourcePath) || path.dirname(path.resolve(record.sourcePath)) !== sourceRoot) continue;
      if (Date.parse(record.importedAt || 0) > cutoff) {
        protectedItems.push({ name: record.sourceName, sourcePath: record.sourcePath, destinationPath: record.targetPath, importedAt: record.importedAt, reason: "仍在保留期内" });
        continue;
      }
      if (!await pathExists(record.sourcePath) || !await pathExists(record.targetPath)) {
        protectedItems.push({ name: record.sourceName, sourcePath: record.sourcePath, destinationPath: record.targetPath, importedAt: record.importedAt, reason: "源文件或项目副本不存在" });
        continue;
      }
      const sourceStats = await fs.lstat(record.sourcePath);
      const targetStats = await fs.lstat(record.targetPath);
      if (!sourceStats.isFile() || sourceStats.isSymbolicLink() || !targetStats.isFile() || targetStats.isSymbolicLink()) {
        protectedItems.push({ name: record.sourceName, sourcePath: record.sourcePath, destinationPath: record.targetPath, importedAt: record.importedAt, reason: "不是普通文件" });
        continue;
      }
      if (fingerprint(record.sourcePath, sourceStats) !== record.fingerprint || sourceStats.size !== targetStats.size) {
        protectedItems.push({ name: record.sourceName, sourcePath: record.sourcePath, destinationPath: record.targetPath, importedAt: record.importedAt, reason: "文件已变化，保留不动" });
        continue;
      }
      candidates.push({
        name: record.sourceName,
        sourcePath: record.sourcePath,
        destinationPath: record.targetPath,
        importedAt: record.importedAt,
        fingerprint: record.fingerprint,
        size: record.size,
        reason: "运行时还会核对完整内容"
      });
    }
    return { candidates: candidates.map(cleanResultItem), protectedItems: protectedItems.map(cleanResultItem) };
  }

  validateQuarantine(config) {
    const sourceRoot = path.resolve(config.inbox.sourcePath);
    const quarantineRoot = path.resolve(config.cleanup.quarantinePath);
    if (quarantineRoot === sourceRoot || !isInside(sourceRoot, quarantineRoot)) {
      throw new Error("隔离区必须位于下载文件夹内部，且不能等于下载文件夹本身");
    }
    return quarantineRoot;
  }

  async runCleanup(rawConfig) {
    const config = normalizeAutomation(rawConfig);
    if (config.inbox.capturePolicy !== "all-downloads") {
      return {
        dryRun: config.cleanup.dryRun,
        capturePolicy: config.inbox.capturePolicy,
        disabledReason: "Cleanup is disabled while generated-ticket-only capture is active.",
        quarantined: [],
        purged: [],
        failed: [],
        protectedItems: []
      };
    }
    if (config.cleanup.dryRun) return { dryRun: true, ...await this.previewCleanup(config) };
    if (!config.cleanup.approvedAt) throw new Error("定期清理尚未获得明确启用确认");

    const quarantineRoot = this.validateQuarantine(config);
    const preview = await this.previewCleanup(config);
    const ledger = await this.readLedger();
    const quarantined = [];
    const failed = [];
    const dateFolder = new Date().toISOString().slice(0, 10);

    for (const item of preview.candidates) {
      const record = ledger.imports[item.fingerprint];
      try {
        if (!record) throw new Error("归档记录已变化，请重新预览");
        const [sourceHash, targetHash] = await Promise.all([hashFile(record.sourcePath), hashFile(record.targetPath)]);
        if (sourceHash !== record.contentHash || targetHash !== record.contentHash) {
          throw new Error("源文件与项目副本内容不再一致，保留不动");
        }
        const desiredPath = path.join(quarantineRoot, dateFolder, record.sourceName);
        await fs.mkdir(path.dirname(desiredPath), { recursive: true });
        const quarantinePath = await uniquePath(desiredPath);
        await fs.rename(record.sourcePath, quarantinePath);
        record.status = "quarantined";
        record.quarantinePath = quarantinePath;
        record.quarantinedAt = new Date().toISOString();
        quarantined.push({ ...item, destinationPath: quarantinePath, quarantinedAt: record.quarantinedAt, reason: "已移入隔离区" });
      } catch (error) {
        failed.push({ ...item, reason: error.message || String(error) });
      }
    }

    const purged = [];
    if (config.cleanup.purgeEnabled && config.cleanup.purgeApprovedAt) {
      const purgeCutoff = Date.now() - config.cleanup.quarantineDays * 24 * 60 * 60 * 1000;
      for (const record of Object.values(ledger.imports)) {
        if (record.status !== "quarantined" || !record.quarantinePath || Date.parse(record.quarantinedAt || 0) > purgeCutoff) continue;
        try {
          if (!isInside(quarantineRoot, record.quarantinePath)) throw new Error("隔离文件路径超出受控范围");
          const stats = await fs.lstat(record.quarantinePath);
          if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("隔离对象不是普通文件");
          if (await hashFile(record.quarantinePath) !== record.contentHash) throw new Error("隔离文件内容已变化");
          await fs.unlink(record.quarantinePath);
          record.status = "purged";
          record.purgedAt = new Date().toISOString();
          purged.push({ name: record.sourceName, sourcePath: record.quarantinePath, importedAt: record.importedAt, quarantinedAt: record.quarantinedAt, reason: "隔离期满后已清空" });
        } catch (error) {
          if (error.code !== "ENOENT") failed.push({ name: record.sourceName, sourcePath: record.quarantinePath, reason: error.message || String(error) });
        }
      }
    }

    ledger.lastCleanupRunAt = new Date().toISOString();
    ledger.runs.push({ type: "cleanup", at: ledger.lastCleanupRunAt, quarantined: quarantined.length, purged: purged.length, failed: failed.length });
    ledger.runs = ledger.runs.slice(-100);
    await this.writeLedger(ledger);
    return {
      dryRun: false,
      quarantined: quarantined.map(cleanResultItem),
      purged: purged.map(cleanResultItem),
      failed: failed.map(cleanResultItem),
      protectedItems: preview.protectedItems
    };
  }

  async status(rawConfig, projects) {
    const config = normalizeAutomation(rawConfig);
    const ledger = await this.readLedger();
    let organizerPreview = null;
    let organizerError = null;
    if (config.inbox.projectId || (config.routing.enabled && config.routing.profiles.length)) {
      try {
        organizerPreview = await this.previewOrganizer(config, projects);
      } catch (error) {
        organizerError = error.message || String(error);
      }
    }
    return {
      config,
      lastOrganizerRunAt: ledger.lastOrganizerRunAt,
      lastCleanupRunAt: ledger.lastCleanupRunAt,
      recentRuns: ledger.runs.slice(-10).reverse(),
      organizerPreview,
      organizerError
    };
  }
}
