import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";

const SCHEMA_VERSION = 1;

function normalizedFolders(folders = []) {
  return [...new Set((Array.isArray(folders) ? folders : [])
    .map((folder) => path.resolve(String(folder || "")))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, projects: {} };
}

function normalizeProjectEntry(projectId, value = {}) {
  const assets = Array.isArray(value.assets)
    ? value.assets.filter((asset) => asset && typeof asset === "object" && asset.id)
    : [];
  return {
    projectId,
    assetFormatVersion: Number(value.assetFormatVersion) || 0,
    projectName: String(value.projectName || projectId),
    folders: normalizedFolders(value.folders),
    initializedAt: String(value.initializedAt || value.updatedAt || ""),
    updatedAt: String(value.updatedAt || ""),
    assets,
  };
}

function normalizeState(value) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION || typeof value.projects !== "object") {
    return emptyState();
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    projects: Object.fromEntries(Object.entries(value.projects)
      .map(([projectId, project]) => [projectId, normalizeProjectEntry(projectId, project)])),
  };
}

export class PersistentAssetIndex {
  constructor({ filePath }) {
    if (!filePath) throw new Error("Asset index path is required");
    this.filePath = path.resolve(filePath);
    this.state = null;
    this.loadPromise = null;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.state) return this.state;
    if (!this.loadPromise) {
      this.loadPromise = fs.readFile(this.filePath, "utf8")
        .then((raw) => normalizeState(JSON.parse(raw.replace(/^\uFEFF/, ""))))
        .catch(() => emptyState())
        .then((state) => {
          this.state = state;
          return state;
        });
    }
    return this.loadPromise;
  }

  async getProject(projectId) {
    const state = await this.load();
    const entry = state.projects[String(projectId || "")];
    return entry ? normalizeProjectEntry(entry.projectId, entry) : null;
  }

  async replaceProject(project, assets, now = new Date().toISOString()) {
    return this.mutate((state) => {
      const previous = state.projects[project.id];
      state.projects[project.id] = normalizeProjectEntry(project.id, {
        assetFormatVersion: 2,
        projectName: project.name,
        folders: project.folders,
        initializedAt: previous?.initializedAt || now,
        updatedAt: now,
        assets,
      });
      return state.projects[project.id];
    });
  }

  async patchProject(project, {
    upserts = [],
    removeIds = [],
    removePrefixes = [],
    folders = project.folders,
  } = {}, now = new Date().toISOString()) {
    return this.mutate((state) => {
      const current = normalizeProjectEntry(project.id, state.projects[project.id] || {
        projectName: project.name,
        folders,
        initializedAt: now,
        updatedAt: now,
        assets: [],
      });
      const removeIdSet = new Set(removeIds.map(String));
      const normalizedPrefixes = removePrefixes.map((prefix) => path.resolve(String(prefix || "")));
      const byId = new Map(current.assets
        .filter((asset) => !removeIdSet.has(String(asset.id)))
        .filter((asset) => {
          const assetPath = String(asset.sourcePath || "");
          if (!assetPath) return true;
          return !normalizedPrefixes.some((prefix) => assetPath === prefix || assetPath.startsWith(`${prefix}${path.sep}`));
        })
        .map((asset) => [String(asset.id), asset]));
      for (const asset of upserts) {
        if (asset?.id) byId.set(String(asset.id), asset);
      }
      state.projects[project.id] = normalizeProjectEntry(project.id, {
        ...current,
        projectName: project.name,
        folders,
        updatedAt: now,
        assets: [...byId.values()],
      });
      return state.projects[project.id];
    });
  }

  async removeProjectsExcept(projectIds) {
    const keep = new Set(projectIds.map(String));
    return this.mutate((state) => {
      for (const projectId of Object.keys(state.projects)) {
        if (!keep.has(projectId)) delete state.projects[projectId];
      }
      return state;
    });
  }

  mutate(mutator) {
    const operation = this.writeQueue.then(async () => {
      const state = await this.load();
      const result = await mutator(state);
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = path.join(
        path.dirname(this.filePath),
        `.${path.basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`,
      );
      try {
        await fs.writeFile(temporary, `${JSON.stringify(state)}\n`, "utf8");
        await fs.rename(temporary, this.filePath);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
      return result;
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

export function sameAssetIndexFolders(left = [], right = []) {
  const a = normalizedFolders(left);
  const b = normalizedFolders(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
