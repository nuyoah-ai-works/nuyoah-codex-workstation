import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff"]);

function clampNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function cleanSegment(value, fallback = "item") {
  const text = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/^\.+|[.\s]+$/g, "");
  return text || fallback;
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function dateStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
    const candidate = path.join(dir, `${stem}-${String(index).padStart(2, "0")}${ext}`);
    if (!await exists(candidate)) return candidate;
  }
  throw new Error("重复文件隔离区中同名文件过多");
}

async function hasGenerationSidecar(filePath) {
  const ext = path.extname(filePath);
  const stem = filePath.slice(0, -ext.length);
  return await exists(`${stem}.prompt.md`) || await exists(`${stem}.meta.json`);
}

function imageFile(filePath) {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

function internalPath(filePath, quarantinePath) {
  if (quarantinePath && isInside(quarantinePath, filePath)) return true;
  return path.resolve(filePath).split(path.sep).some((segment) => segment.startsWith(".asset-"));
}

function keeperScore(item) {
  const created = item.stats.birthtimeMs > 0 ? item.stats.birthtimeMs : item.stats.mtimeMs;
  const copySuffix = /(?:\s\(\d+\)|[-_]copy|[-_]副本|[-_]\d{2,})\.[^.]+$/i.test(path.basename(item.path)) ? 1 : 0;
  return [item.protected ? 0 : 1, copySuffix, created, item.path.length, item.path.toLowerCase()];
}

function compareKeeper(a, b) {
  const left = keeperScore(a);
  const right = keeperScore(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

export function normalizeDeduplication(raw = {}, { defaultQuarantinePath = "" } = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: source.enabled !== false,
    exactContentOnly: true,
    sameDirectoryOnly: true,
    settleSeconds: clampNumber(source.settleSeconds, 5, 2, 60),
    recentSweepHours: clampNumber(source.recentSweepHours, 168, 0, 24 * 365),
    retentionDays: clampNumber(source.retentionDays, 14, 1, 365),
    quarantinePath: path.resolve(source.quarantinePath || defaultQuarantinePath || path.join(process.cwd(), ".asset-duplicate-quarantine"))
  };
}

export class ExactDuplicateCleaner {
  constructor({ ledgerPath }) {
    this.ledgerPath = path.resolve(ledgerPath);
    this.pending = new Map();
    this.queue = Promise.resolve();
  }

  async readLedger() {
    try {
      const parsed = JSON.parse((await fs.readFile(this.ledgerPath, "utf8")).replace(/^\uFEFF/, ""));
      return { version: 1, events: Array.isArray(parsed.events) ? parsed.events : [] };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { version: 1, events: [] };
    }
  }

  async writeLedger(ledger) {
    await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
    const temporaryPath = `${this.ledgerPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify({ version: 1, events: ledger.events.slice(-1000) }, null, 2) + "\n", "utf8");
    await fs.rename(temporaryPath, this.ledgerPath);
  }

  enqueue(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => {});
    return result;
  }

  schedule({ filePath, project, config, onDeduplicated } = {}) {
    const normalized = normalizeDeduplication(config);
    if (!normalized.enabled || !filePath || !imageFile(filePath) || internalPath(filePath, normalized.quarantinePath)) return;
    const absolutePath = path.resolve(filePath);
    const key = absolutePath.toLowerCase();
    const previous = this.pending.get(key);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.enqueue(async () => {
        const result = await this.inspectCandidate(absolutePath, project, normalized);
        if (result.quarantined.length && typeof onDeduplicated === "function") onDeduplicated(result);
        return result;
      }).catch((error) => console.warn(`Exact duplicate cleanup (${absolutePath}):`, error.message));
    }, normalized.settleSeconds * 1000);
    timer.unref?.();
    this.pending.set(key, timer);
  }

  async moveToQuarantine(filePath, keeperPath, project, config, contentHash) {
    const projectRoot = path.resolve(project?.path || path.dirname(filePath));
    const relative = isInside(projectRoot, filePath) ? path.relative(projectRoot, filePath) : path.basename(filePath);
    const safeRelative = relative.split(path.sep).map((segment) => cleanSegment(segment)).join(path.sep);
    const destination = await uniquePath(path.join(
      config.quarantinePath,
      dateStamp(),
      cleanSegment(project?.id || project?.name || "project"),
      safeRelative
    ));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.rename(filePath, destination);
    } catch (error) {
      if (error.code !== "EXDEV") throw error;
      await fs.copyFile(filePath, destination);
      if (await hashFile(destination) !== contentHash) {
        await fs.rm(destination, { force: true });
        throw new Error("重复图片隔离校验失败，原文件已保留");
      }
      await fs.rm(filePath, { force: false });
    }
    return {
      sourcePath: filePath,
      quarantinePath: destination,
      keeperPath,
      sha256: contentHash,
      quarantinedAt: new Date().toISOString()
    };
  }

  async inspectCandidate(filePath, project, rawConfig) {
    const config = normalizeDeduplication(rawConfig);
    const empty = { keeperPath: null, quarantined: [] };
    if (!config.enabled || !await exists(filePath) || !imageFile(filePath) || internalPath(filePath, config.quarantinePath)) return empty;
    const candidateStats = await fs.lstat(filePath);
    if (!candidateStats.isFile() || candidateStats.isSymbolicLink() || candidateStats.size === 0) return empty;
    if (Date.now() - candidateStats.mtimeMs < config.settleSeconds * 1000) return empty;

    const siblings = [];
    for (const entry of await fs.readdir(path.dirname(filePath), { withFileTypes: true })) {
      if (!entry.isFile() || !imageFile(entry.name)) continue;
      const siblingPath = path.join(path.dirname(filePath), entry.name);
      if (internalPath(siblingPath, config.quarantinePath)) continue;
      const stats = await fs.lstat(siblingPath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== candidateStats.size) continue;
      siblings.push({ path: siblingPath, stats, protected: await hasGenerationSidecar(siblingPath) });
    }
    if (siblings.length < 2) return empty;

    const candidateHash = await hashFile(filePath);
    const matches = [];
    for (const item of siblings) {
      if (path.resolve(item.path).toLowerCase() === path.resolve(filePath).toLowerCase()) {
        matches.push({ ...item, hash: candidateHash });
      } else if (await hashFile(item.path) === candidateHash) {
        matches.push({ ...item, hash: candidateHash });
      }
    }
    if (matches.length < 2) return empty;
    matches.sort(compareKeeper);
    const keeper = matches[0];
    const quarantined = [];
    for (const duplicate of matches.slice(1)) {
      if (duplicate.protected || !await exists(duplicate.path) || await hasGenerationSidecar(duplicate.path)) continue;
      if (await hashFile(duplicate.path) !== candidateHash) continue;
      quarantined.push(await this.moveToQuarantine(duplicate.path, keeper.path, project, config, candidateHash));
    }
    if (quarantined.length) {
      const ledger = await this.readLedger();
      ledger.events.push(...quarantined.map((item) => ({ type: "exact-image-duplicate", ...item })));
      await this.writeLedger(ledger);
    }
    return { keeperPath: keeper.path, quarantined };
  }

  async collectRecentImages(root, config, output) {
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return;
    }
    const cutoff = config.recentSweepHours > 0 ? Date.now() - config.recentSweepHours * 60 * 60 * 1000 : 0;
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (!isInside(config.quarantinePath, fullPath) && !isInside(fullPath, config.quarantinePath)) {
          await this.collectRecentImages(fullPath, config, output);
        }
      } else if (entry.isFile() && imageFile(fullPath)) {
        const stats = await fs.lstat(fullPath);
        if ((!cutoff || stats.mtimeMs >= cutoff) && Date.now() - stats.mtimeMs >= config.settleSeconds * 1000) {
          output.push({ path: fullPath, size: stats.size });
        }
      }
    }
  }

  async sweepProjects(projects, rawConfig) {
    const config = normalizeDeduplication(rawConfig);
    if (!config.enabled) return { checkedGroups: 0, quarantined: [] };
    return await this.enqueue(async () => {
      const quarantined = [];
      let checkedGroups = 0;
      const visitedRoots = new Set();
      for (const project of projects || []) {
        for (const scanRoot of project.scanRoots || ["."]) {
          const root = path.resolve(project.path, scanRoot);
          const rootKey = root.toLowerCase();
          if (visitedRoots.has(rootKey) || !isInside(project.path, root) || !await exists(root)) continue;
          visitedRoots.add(rootKey);
          const images = [];
          await this.collectRecentImages(root, config, images);
          const groups = new Map();
          for (const image of images) {
            const key = `${path.dirname(image.path).toLowerCase()}|${image.size}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(image.path);
          }
          for (const files of groups.values()) {
            if (files.length < 2) continue;
            checkedGroups += 1;
            const newest = files.sort().at(-1);
            const result = await this.inspectCandidate(newest, project, config);
            quarantined.push(...result.quarantined);
          }
        }
      }
      const purged = await this.purgeExpired(config);
      return { checkedGroups, quarantined, purged };
    });
  }

  async purgeExpired(rawConfig) {
    const config = normalizeDeduplication(rawConfig);
    if (!await exists(config.quarantinePath)) return [];
    const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;
    const purged = [];
    const walk = async (dir) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          if (!(await fs.readdir(fullPath)).length) await fs.rmdir(fullPath).catch(() => {});
        } else if (entry.isFile()) {
          const stats = await fs.stat(fullPath);
          if (stats.mtimeMs < cutoff) {
            await fs.rm(fullPath, { force: true });
            purged.push(fullPath);
          }
        }
      }
    };
    await walk(config.quarantinePath);
    return purged;
  }
}
