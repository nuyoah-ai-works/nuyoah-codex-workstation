import { createReadStream } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { extractPreviewTags } from "./card-view.mjs";
import { parseRateLimitLines } from "./usage-data.mjs";

const THREAD_ID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const DEFAULT_MAX_TAIL_BYTES = 8 * 1024 * 1024;
const RECENT_ACTIVITY_REFINE_LIMIT = 80;
const INTERRUPTION_TAIL_BYTES = DEFAULT_MAX_TAIL_BYTES;
const PASSIVE_INTERRUPTION_IDLE_MS = 10 * 60 * 1000;
const SESSION_HEADER_BYTES = 128 * 1024;
const CATALOG_METADATA_CONCURRENCY = 16;

function timestampValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedWorkspacePath(value) {
  let normalized = String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[a-z]:\//i.test(normalized)) normalized = normalized.toLocaleLowerCase();
  return normalized;
}

function projectForWorkspace(projects, workspacePath) {
  const workspace = normalizedWorkspacePath(workspacePath);
  if (!workspace) return null;
  const candidates = [];
  for (const [projectId, project] of Object.entries(projects || {})) {
    for (const rootPath of Array.isArray(project?.rootPaths) ? project.rootPaths : []) {
      const root = normalizedWorkspacePath(rootPath);
      if (!root || (workspace !== root && !workspace.startsWith(`${root}/`))) continue;
      candidates.push({ projectId, project, specificity: root.length });
    }
  }
  if (!candidates.length) return null;
  const specificity = Math.max(...candidates.map((candidate) => candidate.specificity));
  const mostSpecific = candidates.filter((candidate) => candidate.specificity === specificity);
  const projectIds = new Set(mostSpecific.map((candidate) => candidate.projectId));
  return projectIds.size === 1 ? mostSpecific[0] : null;
}

function primaryProjectWorkspacePath(project) {
  return (Array.isArray(project?.rootPaths) ? project.rootPaths : [])
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
}

async function workspacePathStatus(workspacePath) {
  const value = String(workspacePath || "").trim();
  if (!value) return "unknown";
  try {
    return (await stat(value)).isDirectory() ? "available" : "missing";
  } catch (error) {
    return error?.code === "ENOENT" || error?.code === "ENOTDIR" ? "missing" : "unknown";
  }
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function readSessionWorkspace(filePath) {
  if (!filePath) return "";
  let handle;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(SESSION_HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead).toString("utf8");
    const match = header.match(/"cwd"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (!match) return "";
    try { return JSON.parse(`"${match[1]}"`); } catch { return ""; }
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => {});
  }
}

function contentText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && (item.type === "input_text" || item.type === "output_text"))
    .map((item) => item.text || "")
    .filter(Boolean)
    .join("\n");
}

const HIDDEN_HISTORY_PREFIXES = [
  "<recommended_plugins>",
  "# agents.md instructions",
  "<environment_context>",
  "<permissions instructions>",
  "<skills_instructions>",
  "<app-context>",
  "<plugins_instructions>",
];

function historyAttachmentNames(value) {
  const section = String(value || "").match(/#\s*Files mentioned by the user:\s*([\s\S]*?)(?:\n\s*Distinguish instructions|\n\s*##?\s*My request:|$)/i)?.[1] || "";
  return section.split("\n").flatMap((line) => {
    const match = line.match(/^\s*##\s+(.+?):\s+\/.+$/);
    return match?.[1]?.trim() ? [match[1].trim()] : [];
  });
}

export function isHiddenConversationContent(value) {
  const text = String(value || "").trim().toLocaleLowerCase();
  return !text || HIDDEN_HISTORY_PREFIXES.some((prefix) => text.startsWith(prefix));
}

export function visibleConversationText(value, { user = false } = {}) {
  let text = String(value || "")
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gi, "")
    .trim();
  if (!text || isHiddenConversationContent(text)) return "";
  if (!user) return text;

  const attachments = historyAttachmentNames(text);
  const marker = text.match(/(?:^|\n)##?\s*My request:\s*\n?/i);
  if (marker?.index != null) text = text.slice(marker.index + marker[0].length).trim();
  const attachmentLabel = attachments.length ? `附件：${attachments.join("、")}` : "";
  return [attachmentLabel, text].filter(Boolean).join("\n\n");
}

export function parseConversationMessageEntry(entry) {
  if (entry?.type !== "response_item" || entry.payload?.type !== "message") return null;
  const role = entry.payload.role;
  if (role !== "user" && role !== "assistant") return null;
  const parts = (Array.isArray(entry.payload.content) ? entry.payload.content : [])
    .filter((item) => item && (item.type === "input_text" || item.type === "output_text"))
    .map((item) => visibleConversationText(item.text, { user: role === "user" }))
    .filter(Boolean);
  const text = parts.join("\n\n").trim();
  if (!text) return null;
  return {
    id: String(entry.payload.id || ""),
    role,
    phase: role === "assistant" ? String(entry.payload.phase || "") : "",
    timestamp: timestampValue(entry.timestamp) ? new Date(timestampValue(entry.timestamp)).toISOString() : null,
    text,
  };
}

async function readConversationAppend(filePath, { start = 0, remainder = null, onEntry } = {}) {
  let lineParts = [];
  let lineBytes = 0;
  let lineRelevant = remainder?.relevant ?? null;
  if (Buffer.isBuffer(remainder?.buffer) && remainder.buffer.length) {
    lineParts = [remainder.buffer];
    lineBytes = remainder.buffer.length;
  }

  const finishPart = (part, complete) => {
    if (part.length && lineRelevant !== false) lineParts.push(part);
    lineBytes += part.length;
    if (lineRelevant == null && (complete || lineBytes >= 512)) {
      const prefix = Buffer.concat(lineParts, Math.min(lineBytes, 4096)).subarray(0, 4096).toString("utf8");
      if (prefix.includes('"type":"response_item"') && prefix.includes('"payload":{"type":"message"')) {
        lineRelevant = true;
      } else if (complete || lineBytes >= 4096) {
        lineRelevant = false;
        lineParts = [];
      }
    }
    if (!complete) return;
    if (lineRelevant === true) {
      let line = Buffer.concat(lineParts, lineBytes);
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      try { onEntry?.(JSON.parse(line.toString("utf8"))); } catch {}
    }
    lineParts = [];
    lineBytes = 0;
    lineRelevant = null;
  };

  for await (const chunk of createReadStream(filePath, { start })) {
    let cursor = 0;
    let lineEnd = chunk.indexOf(0x0a, cursor);
    while (lineEnd >= 0) {
      finishPart(chunk.subarray(cursor, lineEnd), true);
      cursor = lineEnd + 1;
      lineEnd = chunk.indexOf(0x0a, cursor);
    }
    if (cursor < chunk.length) finishPart(chunk.subarray(cursor), false);
  }
  return {
    buffer: lineRelevant === false ? Buffer.alloc(0) : Buffer.concat(lineParts, lineBytes),
    relevant: lineRelevant,
  };
}

export function cleanPreviewText(value, { user = false } = {}) {
  let text = String(value || "")
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gi, " ")
    .replace(/<recommended_plugins>[\s\S]*?<\/recommended_plugins>/gi, " ")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, " ")
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, " ")
    .replace(/```[\s\S]*?```/g, " [代码] ");

  if (user) {
    const requestMarker = text.match(/(?:^|\n)##?\s*My request:\s*\n?/i);
    if (requestMarker?.index != null) {
      text = text.slice(requestMarker.index + requestMarker[0].length);
    }
    text = text.replace(/(?:^|\n)#\s*Files mentioned by the user:[\s\S]*?(?=\n#|$)/gi, " ");
  }

  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[图片]")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateText(value, maxLength = 360) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function coreSummary(value, fallback = "暂无可用总结") {
  const text = cleanPreviewText(value);
  if (!text) return fallback;
  const sentence = text.match(/^.{12,90}?[。！？!?]/)?.[0] || text;
  return truncateText(sentence, 96);
}

function eventCandidate(entry) {
  const time = timestampValue(entry.timestamp);
  if (entry.type === "event_msg") {
    if (entry.payload?.type === "user_message") {
      return { kind: "user", time, text: entry.payload.message || "" };
    }
    if (entry.payload?.type === "agent_message") {
      return { kind: "assistant", time, text: entry.payload.message || "" };
    }
    if (entry.payload?.type === "task_complete") {
      return { kind: "complete", time, text: entry.payload.last_agent_message || "" };
    }
  }
  if (entry.type === "response_item" && entry.payload?.type === "message") {
    const text = contentText(entry.payload.content);
    if (entry.payload.role === "user") return { kind: "user-fallback", time, text };
    if (entry.payload.role === "assistant") return { kind: entry.payload.phase === "final_answer" ? "final" : "assistant-fallback", time, text };
  }
  return null;
}

export function parsePreviewLines(lines, { title = "" } = {}) {
  const latest = new Map();
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line || (!line.includes('"event_msg"') && !line.includes('"response_item"'))) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const candidate = eventCandidate(entry);
    if (!candidate || !candidate.text) continue;
    if (!latest.has(candidate.kind)) latest.set(candidate.kind, candidate);
  }

  const user = latest.get("user") || latest.get("user-fallback");
  const assistant = latest.get("assistant") || latest.get("assistant-fallback") || latest.get("final");
  const complete = [latest.get("complete"), latest.get("final")].filter(Boolean).sort((a, b) => b.time - a.time)[0];
  const final = complete && (!user || complete.time >= user.time) ? complete : null;
  const activityAtMs = Math.max(0, ...Array.from(latest.values()).map((candidate) => candidate.time || 0));
  const summarySource = complete && (!user || complete.time >= user.time)
    ? complete.text
    : assistant?.text || user?.text || title;

  return {
    summary: coreSummary(summarySource, title ? `围绕“${title}”的对话` : "暂无可用总结"),
    recentInput: truncateText(cleanPreviewText(user?.text, { user: true }), 520),
    recentOutput: truncateText(cleanPreviewText(assistant?.text || complete?.text), 520),
    finalOutput: final ? truncateText(cleanPreviewText(final.text), 520) : "",
    hasFinalResponse: Boolean(final),
    resultLinks: final ? finalResultLinks(final.text) : [],
    activityAt: activityAtMs ? new Date(activityAtMs).toISOString() : null,
  };
}

// Only explicit links in this turn's final response; never scan a workspace.
export function finalResultLinks(text) {
  const found = new Map();
  for (const match of String(text || "").matchAll(/!?\[([^\]\n]*)\]\((<\/[^>\n]+>|\/[^)\n]+)\)/g)) {
    let file = match[2].replace(/^<|>$/g, "");
    try { file = decodeURIComponent(file); } catch { continue; }
    file = file.replace(/:\d+(?::\d+)?$/, "");
    if (!path.isAbsolute(file) || file.startsWith("//") || /[\0\r\n]/.test(file) || file.length > 4096) continue;
    if (/(?:^|\/)(?:\.env(?:\..*)?|auth\.json|credentials[^/]*|[^/]*\.pem|[^/]*\.key)$/.test(file)) continue;
    if (!found.has(file)) found.set(file, { path: file, label: match[1].trim().slice(0, 160) || path.basename(file) });
    if (found.size >= 8) break;
  }
  return [...found.values()];
}

async function checkResultLinks(preview) {
  return { ...preview, resultLinks: await Promise.all((preview.resultLinks || []).map(async link => ({ ...link,
    exists: await stat(link.path).then(info => info.isFile()).catch(() => false),
  }))) };
}

export function conversationDedupeKey({ title = "", recentInput = "", recentOutput = "" } = {}) {
  const content = cleanPreviewText([title, recentInput, recentOutput].filter(Boolean).join(" "))
    .normalize("NFKC")
    .toLocaleLowerCase();
  if (!/(?:安装|\binstall\b|skills?@latest\s+add|\badd\b)/i.test(content)) return "";
  const skillName = content.match(/--skill(?:=|\s+)([a-z0-9][a-z0-9._-]{1,63})/i)?.[1]
    || content.match(/(?:skill|技能)(?:名称)?\s*[：:]\s*([a-z0-9][a-z0-9._-]{1,63})/i)?.[1]
    || content.match(/(?:\.agents\/)?skills\/([a-z0-9][a-z0-9._-]{1,63})\/skill\.md/i)?.[1];
  return skillName ? `install-skill:${skillName.toLocaleLowerCase()}` : "";
}

export function orderCatalogByArchive(items, archivedThreadIds = []) {
  const archived = new Set(Array.from(archivedThreadIds, (value) =>
    String(value || "").replace(/^(?:local|cloud):/i, "").toLocaleLowerCase(),
  ));
  return (Array.isArray(items) ? items : [])
    .map((item, sourceIndex) => ({
      ...item,
      archived: archived.has(String(item?.threadId || "").replace(/^(?:local|cloud):/i, "").toLocaleLowerCase()),
      sourceIndex,
    }))
    .sort((left, right) => Number(left.archived) - Number(right.archived)
      || timestampValue(right.updatedAt) - timestampValue(left.updatedAt)
      || left.sourceIndex - right.sourceIndex)
    .map(({ sourceIndex, ...item }) => item);
}

export function parseTaskActivityLines(lines) {
  let latest = 0;
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const event = entry.type === "event_msg" && ["task_started", "task_complete", "turn_aborted",
      "error", "task_failed", "turn_failed", "user_message", "agent_message"].includes(entry.payload?.type);
    if (event || parseConversationMessageEntry(entry)) latest = Math.max(latest, timestampValue(entry.timestamp));
  }
  return latest ? new Date(latest).toISOString() : null;
}

export function parseInterruptionLines(lines) {
  let outcome = null;
  let reason = null;
  let startedAtMs = 0;
  let interruptedAtMs = 0;
  let activityAtMs = 0;
  for (const line of lines) {
    if (!line?.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const time = timestampValue(entry.timestamp);
    if (time) activityAtMs = Math.max(activityAtMs, time);
    if (entry.type !== "event_msg") continue;
    if (entry.payload?.type === "task_started") {
      outcome = "pending";
      reason = null;
      startedAtMs = time;
      interruptedAtMs = 0;
    } else if (entry.payload?.type === "task_complete") {
      outcome = "complete";
      reason = null;
      startedAtMs = 0;
      interruptedAtMs = 0;
    } else if (entry.payload?.type === "turn_aborted") {
      outcome = "interrupted";
      reason = "stopped";
      startedAtMs = 0;
      interruptedAtMs = time;
    } else if (["error", "task_failed", "turn_failed"].includes(entry.payload?.type)) {
      outcome = "interrupted";
      reason = "error";
      startedAtMs = 0;
      interruptedAtMs = time;
    }
  }
  if (outcome === "interrupted") {
    return { kind: "active", reason, interruptedAtMs: interruptedAtMs || activityAtMs };
  }
  if (outcome === "pending") {
    return { kind: "passive", interruptedAtMs: activityAtMs || startedAtMs };
  }
  return null;
}

async function tailLines(filePath, maxBytes = DEFAULT_MAX_TAIL_BYTES) {
  const fileStat = await stat(filePath);
  const length = Math.min(fileStat.size, maxBytes);
  const start = fileStat.size - length;
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let text = buffer.toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    return { lines: text.split("\n"), fileStat };
  } finally {
    await handle.close();
  }
}

async function walkSessionFiles(root, result) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return walkSessionFiles(entryPath, result);
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return;
    const threadId = entry.name.match(THREAD_ID_PATTERN)?.[1]?.toLowerCase();
    if (threadId) result.set(threadId, entryPath);
  }));
}

export class PreviewRepository {
  constructor({
    codexHome = path.join(os.homedir(), ".codex"),
    maxTailBytes = DEFAULT_MAX_TAIL_BYTES,
  } = {}) {
    this.codexHome = codexHome;
    this.sessionsRoot = path.join(codexHome, "sessions");
    this.sessionIndexPath = path.join(codexHome, "session_index.jsonl");
    this.globalStatePath = path.join(codexHome, ".codex-global-state.json");
    this.maxTailBytes = maxTailBytes;
    this.filesById = new Map();
    this.idsByTitle = new Map();
    this.metadataById = new Map();
    this.cache = new Map();
    this.sessionWorkspaceById = new Map();
    this.searchCatalogCache = null;
    this.recentCatalogCaches = new Map();
    this.catalogIndexKey = null;
    this.nativeMembership = null;
    this.indexRefresh = null;
    this.interruptionCache = new Map();
    this.conversationHistoryCache = new Map();
    this.indexed = false;
  }

  async refreshIndex() {
    if (this.indexRefresh) return this.indexRefresh;
    this.indexRefresh = this.rebuildIndex();
    try { await this.indexRefresh; } finally { this.indexRefresh = null; }
  }

  async rebuildIndex() {
    const files = new Map();
    await walkSessionFiles(this.sessionsRoot, files);
    this.filesById = files;

    const idsByTitle = new Map();
    const metadataById = new Map();
    try {
      const content = await readFile(this.sessionIndexPath, "utf8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          const id = String(row.id || "").toLowerCase();
          const title = String(row.thread_name || "").trim();
          if (!THREAD_ID_PATTERN.test(id) || !title) continue;
          const existing = idsByTitle.get(title);
          const updatedAt = timestampValue(row.updated_at);
          if (!existing || updatedAt >= existing.updatedAt) {
            idsByTitle.set(title, { id, updatedAt });
          }
          const existingMetadata = metadataById.get(id);
          if (!existingMetadata || updatedAt >= existingMetadata.updatedAtMs) {
            metadataById.set(id, {
              title,
              updatedAtMs: updatedAt,
              updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
            });
          }
        } catch {}
      }
    } catch {}
    this.idsByTitle = idsByTitle;
    this.metadataById = metadataById;
    this.indexed = true;
  }

  async ensureIndex() {
    if (!this.indexed) await this.refreshIndex();
  }

  resolveThreadId(rawId, title = "") {
    const normalized = String(rawId || "").replace(/^(?:local|cloud):/i, "").toLowerCase();
    if (THREAD_ID_PATTERN.test(normalized) && this.filesById.has(normalized)) return normalized;
    return this.idsByTitle.get(String(title || "").trim())?.id || null;
  }

  async readPreview(rawId, title = "") {
    await this.ensureIndex();
    let threadId = this.resolveThreadId(rawId, title);
    if (!threadId) {
      await this.refreshIndex();
      threadId = this.resolveThreadId(rawId, title);
    }
    if (!threadId) {
      return {
        threadId: null,
        summary: title ? `围绕“${title}”的对话` : "暂无可用总结",
        recentInput: "",
        recentOutput: "",
        updatedAt: null,
        tags: extractPreviewTags({ title }),
      };
    }

    const metadata = this.metadataById.get(threadId);
    const filePath = this.filesById.get(threadId);
    if (!filePath) {
      return {
        threadId,
        summary: title ? `围绕“${title}”的对话` : "暂无可用总结",
        recentInput: "",
        recentOutput: "",
        updatedAt: metadata?.updatedAt || null,
        tags: extractPreviewTags({ title }),
      };
    }
    const currentStat = await stat(filePath);
    const indexedUpdatedAt = metadata?.updatedAt || new Date(currentStat.mtimeMs).toISOString();
    const cacheKey = `${currentStat.size}:${currentStat.mtimeMs}:${indexedUpdatedAt}`;
    const cached = this.cache.get(threadId);
    if (cached?.cacheKey === cacheKey && cached.preview) return checkResultLinks(cached.preview);

    const { lines } = await tailLines(filePath, this.maxTailBytes);
    const parsed = parsePreviewLines(lines, { title });
    const updatedAtMs = Math.max(timestampValue(indexedUpdatedAt), timestampValue(parsed.activityAt));
    const preview = {
      threadId,
      ...parsed,
      updatedAt: updatedAtMs ? new Date(updatedAtMs).toISOString() : null,
    };
    delete preview.activityAt;
    if (!preview.recentInput && cached?.preview?.recentInput) {
      preview.recentInput = cached.preview.recentInput;
    }
    preview.tags = extractPreviewTags({ title, ...preview });
    this.cache.set(threadId, { cacheKey, preview, usage: parseRateLimitLines(lines) });
    return checkResultLinks(preview);
  }

  async readConversationHistory(rawId, title = "") {
    await this.ensureIndex();
    let threadId = this.resolveThreadId(rawId, title);
    if (!threadId) {
      await this.refreshIndex();
      threadId = this.resolveThreadId(rawId, title);
    }
    if (!threadId) return null;
    const filePath = this.filesById.get(threadId);
    if (!filePath) return null;

    const fileStat = await stat(filePath);
    let cached = this.conversationHistoryCache.get(threadId);
    if (!cached || fileStat.size < cached.size) {
      cached = { size: 0, remainder: null, messages: [], messageIds: new Set() };
    }
    if (fileStat.size > cached.size) {
      const messages = cached.messages.slice();
      const messageIds = new Set(cached.messageIds);
      const remainder = await readConversationAppend(filePath, {
        start: cached.size,
        remainder: cached.remainder,
        onEntry: (entry) => {
          const message = parseConversationMessageEntry(entry);
          if (!message) return;
          const fallbackId = `${message.timestamp || ""}:${message.role}:${messages.length}:${message.text.length}`;
          const messageId = message.id || fallbackId;
          if (messageIds.has(messageId)) return;
          messageIds.add(messageId);
          messages.push({ ...message, id: messageId });
        },
      });
      cached = { size: fileStat.size, remainder, messages, messageIds };
      this.conversationHistoryCache.set(threadId, cached);
    }

    const metadata = this.metadataById.get(threadId);
    const messages = cached.messages;
    const userCount = messages.reduce((count, message) => count + (message.role === "user" ? 1 : 0), 0);
    return {
      threadId,
      title: String(title || metadata?.title || "").trim() || "未命名对话",
      updatedAt: messages.at(-1)?.timestamp || metadata?.updatedAt || new Date(fileStat.mtimeMs).toISOString(),
      sourceSize: fileStat.size,
      totalCount: messages.length,
      userCount,
      assistantCount: messages.length - userCount,
      messages,
    };
  }

  async readMany(requests) {
    const unique = requests.slice(0, 200);
    return Promise.all(unique.map(async (request) => ({
      key: String(request.key || ""),
      ...(await this.readPreview(request.id, request.title)),
    })));
  }

  async readSearchCatalog() {
    return (await this.readRecentCatalog()).filter((item) => item.projectId && item.projectName);
  }

  async sessionWorkspace(threadId) {
    if (this.sessionWorkspaceById.has(threadId)) return this.sessionWorkspaceById.get(threadId);
    const workspacePath = await readSessionWorkspace(this.filesById.get(threadId));
    this.sessionWorkspaceById.set(threadId, workspacePath);
    return workspacePath;
  }

  async readRecentCatalog({ sourceThreads = null } = {}) {
    const authoritativeSource = Array.isArray(sourceThreads);
    const sourceSignature = authoritativeSource
      ? sourceThreads.map((thread) => [
          String(thread?.threadId || ""),
          String(thread?.title || ""),
          String(thread?.updatedAt || ""),
          String(thread?.workspacePath || ""),
        ].join("\u0000")).join("\u0001")
      : "";
    let indexStat;
    let stateStat = null;
    try {
      indexStat = await stat(this.sessionIndexPath);
    } catch {
      return [];
    }
    try { stateStat = await stat(this.globalStatePath); } catch {}
    const indexKey = `${indexStat.size}:${indexStat.mtimeMs}`;
    const cacheKey = `${indexKey}:${stateStat?.size || 0}:${stateStat?.mtimeMs || 0}:${sourceSignature}`;
    const bucket = authoritativeSource ? 'native' : 'index';
    const cached = this.recentCatalogCaches.get(bucket);
    let items = cached?.cacheKey === cacheKey ? cached.items : null;

    const memberIds = authoritativeSource ? sourceThreads.map(thread => String(thread?.threadId || '').toLowerCase()).filter(id => THREAD_ID_PATTERN.test(id)).sort() : null;
    const membership = memberIds?.join(':');
    const newMissingMember = memberIds && membership !== this.nativeMembership && memberIds.some(id => !this.filesById.has(id));
    // Metadata changes do not rediscover files. New native tasks can precede the index.
    if (!this.indexed || this.catalogIndexKey !== indexKey || newMissingMember) {
      await this.refreshIndex();
      this.catalogIndexKey = indexKey;
    }
    if (memberIds) this.nativeMembership = membership;

    if (!items) {
      let indexContent;
      let state = {};
      try {
        indexContent = await readFile(this.sessionIndexPath, "utf8");
      } catch {
        return [];
      }
      try { state = JSON.parse(await readFile(this.globalStatePath, "utf8")); } catch {}

      const projects = state?.["local-projects"] || {};
      const assignments = state?.["thread-project-assignments"] || {};
      const sourceById = new Map((authoritativeSource ? sourceThreads : []).flatMap((thread) => {
        const threadId = String(thread?.threadId || "").toLowerCase();
        return THREAD_ID_PATTERN.test(threadId) ? [[threadId, thread]] : [];
      }));
      const newestById = new Map();
      for (const line of indexContent.split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          const threadId = String(row.id || "").toLowerCase();
          const title = String(row.thread_name || "").trim();
          const updatedAtMs = timestampValue(row.updated_at);
          if (!THREAD_ID_PATTERN.test(threadId) || !title) continue;
          if (authoritativeSource && !sourceById.has(threadId)) continue;
          const current = newestById.get(threadId);
          if (!current || updatedAtMs >= current.updatedAtMs) {
            newestById.set(threadId, { threadId, title, updatedAtMs });
          }
        } catch {}
      }

      for (const [threadId, source] of sourceById) {
        const current = newestById.get(threadId);
        const updatedAtMs = Math.max(timestampValue(source?.updatedAt), current?.updatedAtMs || 0);
        newestById.set(threadId, {
          threadId,
          title: String(source?.title || current?.title || this.metadataById.get(threadId)?.title || "未命名任务").trim(),
          updatedAtMs,
          workspacePath: String(source?.workspacePath || "").trim(),
        });
      }

      items = await mapWithConcurrency(Array.from(newestById.values()), CATALOG_METADATA_CONCURRENCY, async (thread) => {
        const assignment = assignments[thread.threadId];
        let projectId = String(assignment?.projectId || "");
        let projectName = String(projects[projectId]?.name || "").trim();
        const workspacePath = thread.workspacePath || await this.sessionWorkspace(thread.threadId);
        if (!projectId || !projectName) {
          const inferred = projectForWorkspace(projects, workspacePath);
          if (inferred) {
            projectId = inferred.projectId;
            projectName = String(inferred.project?.name || "").trim();
          }
        }
        const projectWorkspacePath = primaryProjectWorkspacePath(projects[projectId]);
        return {
          threadId: thread.threadId,
          title: thread.title,
          updatedAt: thread.updatedAtMs ? new Date(thread.updatedAtMs).toISOString() : null,
          projectId,
          projectName,
          workspacePath,
          projectWorkspacePath,
        };
      });
      this.recentCatalogCaches.set(bucket, { cacheKey, items });
    }

    const activeItems = await mapWithConcurrency(items, CATALOG_METADATA_CONCURRENCY, async (item) => {
      const filePath = this.filesById.get(item.threadId);
      const [recordedWorkspaceStatus, projectWorkspaceStatus] = await Promise.all([
        workspacePathStatus(item.workspacePath),
        workspacePathStatus(item.projectWorkspacePath),
      ]);
      const withWorkspaceState = {
        ...item,
        workspacePathStatus: recordedWorkspaceStatus,
        projectWorkspacePathStatus: projectWorkspaceStatus,
      };
      if (!filePath) return withWorkspaceState;
      try {
        const fileStat = await stat(filePath);
        const updatedAtMs = Math.max(timestampValue(item.updatedAt), fileStat.mtimeMs);
        return { ...withWorkspaceState, updatedAt: new Date(updatedAtMs).toISOString() };
      } catch {
        return withWorkspaceState;
      }
    });
    activeItems.sort((left, right) => timestampValue(right.updatedAt) - timestampValue(left.updatedAt));
    const refined = await Promise.all(activeItems.slice(0, RECENT_ACTIVITY_REFINE_LIMIT).map(async (item) => {
      try {
        const preview = await this.readPreview(`local:${item.threadId}`, item.title);
        const updatedAt = preview?.updatedAt || item.updatedAt;
        const dedupeKey = conversationDedupeKey({ title: item.title, ...preview });
        return dedupeKey ? { ...item, updatedAt, dedupeKey } : { ...item, updatedAt };
      } catch {
        return item;
      }
    }));
    const refinedById = new Map(refined.map((item) => [item.threadId, item]));
    return activeItems
      .map((item) => refinedById.get(item.threadId) || item)
      .sort((left, right) => timestampValue(right.updatedAt) - timestampValue(left.updatedAt));
  }

  async readRunningThreadIds({
    catalog = null,
    nowMs = Date.now(),
    passiveIdleMs = PASSIVE_INTERRUPTION_IDLE_MS,
  } = {}) {
    const recent = Array.isArray(catalog) ? catalog : await this.readRecentCatalog();
    const running = await mapWithConcurrency(recent, CATALOG_METADATA_CONCURRENCY, async (item) => {
      const filePath = this.filesById.get(item.threadId);
      if (!filePath) return null;
      try {
        const fileStat = await stat(filePath);
        const cacheKey = `${fileStat.size}:${fileStat.mtimeMs}`;
        let cached = this.interruptionCache.get(item.threadId);
        if (cached?.cacheKey !== cacheKey) {
          const { lines } = await tailLines(filePath, Math.min(this.maxTailBytes, INTERRUPTION_TAIL_BYTES));
          let state = parseInterruptionLines(lines);
          if (!state && fileStat.size > INTERRUPTION_TAIL_BYTES
            && nowMs - fileStat.mtimeMs < passiveIdleMs) {
            const complete = await tailLines(filePath, fileStat.size);
            state = parseInterruptionLines(complete.lines);
          }
          cached = { cacheKey, state, activityAt: parseTaskActivityLines(lines) };
          this.interruptionCache.set(item.threadId, cached);
        }
        const state = cached.state;
        if (state?.kind !== "passive") return null;
        return nowMs - state.interruptedAtMs < passiveIdleMs ? item.threadId : null;
      } catch {
        return null;
      }
    });
    return running.filter(Boolean);
  }

  taskActivityAt(threadId) {
    return this.interruptionCache.get(threadId)?.activityAt || null;
  }

  async readInterruptedCatalog({
    nowMs = Date.now(),
    passiveIdleMs = PASSIVE_INTERRUPTION_IDLE_MS,
    activeThreadIds = [],
    archivedThreadIds = [],
    catalog = null,
  } = {}) {
    const active = new Set(activeThreadIds.map((value) => String(value || "").replace(/^(?:local|cloud):/i, "").toLowerCase()));
    const archived = new Set(archivedThreadIds.map((value) => String(value || "").replace(/^(?:local|cloud):/i, "").toLowerCase()));
    const recent = Array.isArray(catalog) ? catalog : await this.readRecentCatalog();
    const interrupted = await mapWithConcurrency(recent, CATALOG_METADATA_CONCURRENCY, async (item) => {
      if (active.has(item.threadId) || archived.has(item.threadId)) return null;
      const filePath = this.filesById.get(item.threadId);
      if (!filePath) return null;
      try {
        const fileStat = await stat(filePath);
        const cacheKey = `${fileStat.size}:${fileStat.mtimeMs}`;
        let cached = this.interruptionCache.get(item.threadId);
        if (cached?.cacheKey !== cacheKey) {
          const { lines } = await tailLines(filePath, Math.min(this.maxTailBytes, INTERRUPTION_TAIL_BYTES));
          cached = { cacheKey, state: parseInterruptionLines(lines), activityAt: parseTaskActivityLines(lines) };
          this.interruptionCache.set(item.threadId, cached);
        }
        const state = cached.state;
        if (!state) return null;
        if (state.kind === "passive" && nowMs - state.interruptedAtMs < passiveIdleMs) return null;
        return {
          ...item,
          updatedAt: state.interruptedAtMs ? new Date(state.interruptedAtMs).toISOString() : item.updatedAt,
          interruptionKind: state.kind,
          interruptionLabel: state.kind === "active"
            ? state.reason === "error" ? "运行异常" : "主动停止"
            : "失联超时",
        };
      } catch {
        return null;
      }
    });
    return interrupted
      .filter(Boolean)
      .sort((left, right) => timestampValue(right.updatedAt) - timestampValue(left.updatedAt));
  }

  async readPinnedThreadIds() {
    try {
      const state = JSON.parse(await readFile(this.globalStatePath, "utf8"));
      return [...new Set((Array.isArray(state?.["pinned-thread-ids"])
        ? state["pinned-thread-ids"]
        : [])
        .map((value) => String(value || "").replace(/^(?:local|cloud):/i, "").toLowerCase())
        .filter((value) => THREAD_ID_PATTERN.test(value)))];
    } catch {
      return [];
    }
  }

  async readUsage() {
    await this.ensureIndex();
    const candidates = Array.from(this.metadataById.entries())
      .filter(([threadId]) => this.filesById.has(threadId))
      .sort((left, right) => right[1].updatedAtMs - left[1].updatedAtMs);
    for (const [threadId] of candidates.slice(0, 12)) {
      const cached = this.cache.get(threadId);
      if (cached?.usage) return cached.usage;
      try {
        const { lines } = await tailLines(this.filesById.get(threadId), this.maxTailBytes);
        const usage = parseRateLimitLines(lines);
        if (usage) return usage;
      } catch {}
    }
    return null;
  }
}
