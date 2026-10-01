import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const MEDIA_EXTENSIONS = {
  image: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]),
  video: new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]),
  audio: new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus"]),
};

function mediaKind(filePath) {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  return Object.entries(MEDIA_EXTENSIONS).find(([, extensions]) => extensions.has(extension))?.[0] || "";
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(cleanString).filter(Boolean))];
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse((await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (["ENOENT", "EISDIR"].includes(error.code) || error instanceof SyntaxError) return null;
    throw error;
  }
}

function normalizeAssociation(value = {}, fallbackPath = "") {
  const rawPath = cleanString(value.assetPath || fallbackPath);
  if (!rawPath) return null;
  const assetPath = path.resolve(rawPath);
  const kind = mediaKind(assetPath) || cleanString(value.kind);
  if (!assetPath || !["image", "video", "audio"].includes(kind)) return null;
  return {
    assetPath,
    kind,
    prompt: cleanString(value.prompt),
    negativePrompt: cleanString(value.negativePrompt),
    references: uniqueStrings(value.references),
    settings: value.settings && typeof value.settings === "object" && !Array.isArray(value.settings) ? value.settings : {},
    generator: cleanString(value.generator),
    model: cleanString(value.model),
    threadId: cleanString(value.threadId),
    cwd: cleanString(value.cwd),
    source: cleanString(value.source) || "manual-registration",
    sourceCallId: cleanString(value.sourceCallId),
    sessionPath: cleanString(value.sessionPath),
    createdAt: cleanString(value.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function outputPathFromEvent(payload, context, kind) {
  const candidates = [
    payload.output_path,
    payload.outputPath,
    payload.saved_path,
    payload.savedPath,
    payload.path,
    payload.result && typeof payload.result === "object" ? payload.result.path || payload.result.saved_path : "",
  ].map(cleanString).filter(Boolean);
  const explicit = candidates.find((candidate) => path.isAbsolute(candidate) && mediaKind(candidate) === kind);
  if (explicit) return path.resolve(explicit);
  if (kind !== "image" || !context.sessionId || !payload.call_id) return "";
  return path.resolve(context.generatedImagesRoot, context.sessionId, `${payload.call_id}.png`);
}

function associationFromEvent(event, context) {
  const payload = event?.payload || {};
  const match = cleanString(payload.type).match(/^(image|video|audio)_generation_end$/);
  if (!match || payload.status && payload.status !== "completed") return null;
  const kind = match[1];
  const assetPath = outputPathFromEvent(payload, context, kind);
  const prompt = cleanString(payload.revised_prompt || payload.prompt || payload.input_prompt);
  if (!assetPath || !prompt) return null;
  return normalizeAssociation({
    assetPath,
    kind,
    prompt,
    negativePrompt: payload.negative_prompt,
    references: payload.references,
    generator: `codex-${kind}`,
    model: payload.model,
    threadId: context.sessionId,
    cwd: context.cwd,
    source: "codex-session",
    sourceCallId: payload.call_id,
    sessionPath: context.sessionPath,
    createdAt: event.timestamp,
  });
}

async function listRecentJsonl(root, cutoffMs) {
  const results = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filePath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const stats = await fs.stat(filePath);
        if (stats.mtimeMs >= cutoffMs) results.push({ filePath, stats });
      }
    }
  }
  await walk(root);
  return results.sort((a, b) => a.stats.mtimeMs - b.stats.mtimeMs);
}

async function endsWithNewline(filePath, size) {
  if (!size) return true;
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(1);
    await handle.read(buffer, 0, 1, size - 1);
    return buffer[0] === 10;
  } finally {
    await handle.close();
  }
}

function associationFromSidecar(assetPath, data) {
  const ticket = data?.ticket || data?.association || data;
  if (!ticket || typeof ticket !== "object") return null;
  const prompt = cleanString(ticket.prompt);
  if (!prompt) return null;
  return normalizeAssociation({
    assetPath,
    kind: ticket.kind,
    prompt,
    negativePrompt: ticket.negativePrompt,
    references: ticket.references,
    settings: ticket.settings,
    generator: ticket.generator,
    model: ticket.model,
    threadId: ticket.sourceContext?.threadId || ticket.threadId,
    cwd: ticket.sourceContext?.cwd,
    source: "generation-sidecar",
    sourceCallId: ticket.sourceContext?.callId,
    createdAt: ticket.createdAt,
  });
}

export class CodexPromptAssociationStore {
  constructor({
    registryPath,
    sessionsRoot = path.join(os.homedir(), ".codex", "sessions"),
    generatedImagesRoot = path.join(os.homedir(), ".codex", "generated_images"),
    lookbackDays = 14,
  }) {
    this.registryPath = path.resolve(registryPath);
    this.sessionsRoot = path.resolve(sessionsRoot);
    this.generatedImagesRoot = path.resolve(generatedImagesRoot);
    this.lookbackDays = Math.max(1, Number(lookbackDays) || 14);
    this.cache = null;
    this.mutation = Promise.resolve();
  }

  async readRegistry() {
    if (this.cache) return this.cache;
    const data = await readJson(this.registryPath);
    this.cache = {
      version: 1,
      sessions: data?.sessions && typeof data.sessions === "object" ? data.sessions : {},
      associations: data?.associations && typeof data.associations === "object" ? data.associations : {},
    };
    return this.cache;
  }

  async writeRegistry(registry) {
    await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
    const temporaryPath = `${this.registryPath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, this.registryPath);
    this.cache = registry;
  }

  withMutation(operation) {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.then(() => undefined, () => undefined);
    return next;
  }

  async register(input) {
    return await this.withMutation(async () => {
      const association = normalizeAssociation(input);
      if (!association || !association.prompt) throw new Error("关联提示词时必须提供有效的媒体文件和提示词");
      const registry = await this.readRegistry();
      registry.associations[association.assetPath] = association;
      await this.writeRegistry(registry);
      return association;
    });
  }

  async relocate(previousPath, nextPath) {
    return await this.withMutation(async () => {
      const previous = path.resolve(previousPath);
      const next = path.resolve(nextPath);
      const registry = await this.readRegistry();
      const association = registry.associations[previous];
      if (!association) return null;
      const relocated = normalizeAssociation({ ...association, assetPath: next }, next);
      delete registry.associations[previous];
      registry.associations[next] = relocated;
      await this.writeRegistry(registry);
      return relocated;
    });
  }

  async remove(assetPath) {
    return await this.withMutation(async () => {
      const resolvedPath = path.resolve(assetPath);
      const registry = await this.readRegistry();
      if (!registry.associations[resolvedPath]) return false;
      delete registry.associations[resolvedPath];
      await this.writeRegistry(registry);
      return true;
    });
  }

  async get(assetPath) {
    const resolvedPath = path.resolve(assetPath);
    const registry = await this.readRegistry();
    const stored = registry.associations[resolvedPath];
    if (stored) return normalizeAssociation(stored, resolvedPath);
    const extension = path.extname(resolvedPath);
    if (!mediaKind(resolvedPath) || !extension) return null;
    const sidecar = await readJson(`${resolvedPath.slice(0, -extension.length)}.meta.json`);
    return associationFromSidecar(resolvedPath, sidecar);
  }

  async summary(assetPath) {
    const association = await this.get(assetPath);
    if (!association) return { available: false };
    return {
      available: true,
      source: association.source,
      kind: association.kind,
      generator: association.generator,
      model: association.model,
      threadId: association.threadId,
    };
  }

  async syncCodexSessions() {
    return await this.withMutation(async () => {
      const registry = await this.readRegistry();
      const files = await listRecentJsonl(this.sessionsRoot, Date.now() - this.lookbackDays * 86400000);
      let imported = 0;
      const importedAssociations = [];
      let inspected = 0;
      let changed = false;
      for (const { filePath, stats } of files) {
        const previous = registry.sessions[filePath] || {};
        const offset = Number(previous.offset) <= stats.size ? Number(previous.offset) || 0 : 0;
        if (offset === stats.size || !await endsWithNewline(filePath, stats.size)) continue;
        const context = {
          sessionId: cleanString(previous.sessionId),
          cwd: cleanString(previous.cwd),
          sessionPath: filePath,
          generatedImagesRoot: this.generatedImagesRoot,
        };
        const stream = createReadStream(filePath, { start: offset, end: stats.size - 1, encoding: "utf8" });
        const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of lines) {
          if (!line) continue;
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.type === "session_meta") {
            context.sessionId = cleanString(event.payload?.id || event.payload?.session_id || context.sessionId);
            context.cwd = cleanString(event.payload?.cwd || context.cwd);
            continue;
          }
          const association = associationFromEvent(event, context);
          if (!association || !await exists(association.assetPath)) continue;
          const current = registry.associations[association.assetPath];
          registry.associations[association.assetPath] = association;
          if (!current) {
            imported += 1;
            importedAssociations.push(association);
          }
          changed = true;
        }
        registry.sessions[filePath] = {
          offset: stats.size,
          mtimeMs: stats.mtimeMs,
          sessionId: context.sessionId,
          cwd: context.cwd,
        };
        inspected += 1;
        changed = true;
      }
      if (changed) await this.writeRegistry(registry);
      return { imported, inspected, importedAssociations, associations: Object.values(registry.associations) };
    });
  }
}

export { associationFromEvent, mediaKind };
