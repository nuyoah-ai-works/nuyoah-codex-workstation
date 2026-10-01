import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";

const DEFAULT_CODEX_PATHS = Object.freeze([
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  "/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  "/Applications/ChatGPT.app/Contents/Resources/codex",
  "/Applications/Codex.app/Contents/Resources/codex",
]);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SKILLS = 512;

function cleanText(value, maximum, label) {
  const text = String(value || "").normalize("NFC").trim();
  if (!text || text.length > maximum || /[\0\r\n]/u.test(text)) {
    throw new Error(`Invalid ${label}`);
  }
  return text;
}

function cleanSkillMentionPath(value) {
  const mentionPath = String(value || "").normalize("NFC");
  if (!path.isAbsolute(mentionPath) || mentionPath.length > 4096 || /[\0\r\n]/u.test(mentionPath)) {
    return "";
  }
  return mentionPath;
}

function cleanSkillPath(value) {
  const mentionPath = cleanSkillMentionPath(value);
  return path.basename(mentionPath) === "SKILL.md" ? path.dirname(mentionPath) : mentionPath;
}

export function parseRuntimeSkillResponse(payload, expectedCwd) {
  if (!payload || payload.id !== 2 || payload.error || !Array.isArray(payload.result?.data)) {
    throw new Error("Invalid skills/list response");
  }
  if (payload.result.data.length !== 1 || payload.result.data[0]?.cwd !== expectedCwd) {
    throw new Error("Unexpected skills/list workspace");
  }
  const row = payload.result.data[0];
  if (!Array.isArray(row.skills) || row.skills.length > MAX_SKILLS) {
    throw new Error("Invalid skills/list size");
  }
  const seen = new Set();
  return row.skills.flatMap((raw) => {
    if (raw?.enabled !== true) return [];
    const name = cleanText(raw.name, 256, "Skill name");
    const title = raw.interface?.displayName
      ? cleanText(raw.interface.displayName, 512, "Skill display name")
      : name;
    const description = cleanText(raw.description || "打开查看 Skill 详情", 8192, "Skill description");
    const scope = raw.scope === "system" || raw.scope === "user" ? raw.scope : "";
    if (!scope) throw new Error("Invalid Skill scope");
    const pluginId = raw.pluginId ? cleanText(raw.pluginId, 512, "plugin id") : "";
    const skillPath = cleanSkillPath(raw.path);
    const mentionPath = cleanSkillMentionPath(raw.path);
    const id = pluginId ? `plugin|${pluginId}|${name}` : `${scope}|${skillPath || name}`;
    if (seen.has(id)) throw new Error("Duplicate runtime Skill");
    seen.add(id);
    return [{
      ...(pluginId ? { id } : {}),
      name,
      title,
      description,
      path: skillPath,
      mentionPath,
      source: "runtime",
      scope: pluginId ? "plugin" : scope,
    }];
  }).sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
}

export async function findBundledCodex(paths = DEFAULT_CODEX_PATHS) {
  for (const candidate of paths) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("Bundled Codex executable is unavailable");
}

export async function readRuntimeSkillCatalog({
  cwd,
  codexPath,
  timeoutMs = 8_000,
  spawnImpl = spawn,
} = {}) {
  const workspace = path.resolve(String(cwd || process.cwd()));
  const executable = codexPath || await findBundledCodex();
  const child = spawnImpl(executable, ["app-server", "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.setEncoding("utf8");
  child.stderr?.resume?.();
  let buffer = "";
  let settled = false;
  const pending = new Map();

  const finish = (error) => {
    if (settled) return;
    settled = true;
    for (const { reject } of pending.values()) reject(error || new Error("Codex app-server stopped"));
    pending.clear();
  };
  child.on("error", finish);
  child.on("exit", () => finish(new Error("Codex app-server exited")));
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer, "utf8") > MAX_RESPONSE_BYTES) {
      finish(new Error("Codex app-server response exceeded the limit"));
      child.kill("SIGTERM");
      return;
    }
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          const message = JSON.parse(line);
          if (message?.id != null && pending.has(message.id)) {
            const waiter = pending.get(message.id);
            pending.delete(message.id);
            waiter.resolve(message);
          }
        } catch (error) {
          finish(error);
          child.kill("SIGTERM");
          return;
        }
      }
      newline = buffer.indexOf("\n");
    }
  });

  const request = (id, method, params) => new Promise((resolve, reject) => {
    if (settled) {
      reject(new Error("Codex app-server is unavailable"));
      return;
    }
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
      if (!error) return;
      pending.delete(id);
      reject(error);
    });
  });
  const timer = setTimeout(() => {
    finish(new Error("Codex app-server timed out"));
    child.kill("SIGTERM");
  }, timeoutMs);

  try {
    const initialized = await request(1, "initialize", {
      clientInfo: { name: "nuyoah-codex-workstation", title: "Nuyoah Codex Workstation", version: "0.1.0" },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    if (initialized?.id !== 1 || initialized.error || !initialized.result?.codexHome) {
      throw new Error("Codex app-server initialization failed");
    }
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
    const response = await request(2, "skills/list", { cwds: [workspace], forceReload: false });
    return parseRuntimeSkillResponse(response, workspace);
  } finally {
    clearTimeout(timer);
    settled = true;
    pending.clear();
    child.stdin.end();
    child.kill("SIGTERM");
  }
}

export async function readPreferredSkillCatalog({
  cwd,
  fallback,
  runtimeReader = readRuntimeSkillCatalog,
} = {}) {
  try {
    return await runtimeReader({ cwd });
  } catch {
    if (typeof fallback !== "function") return [];
    const catalog = await fallback();
    return (Array.isArray(catalog) ? catalog : []).map((entry) => ({ ...entry, source: "fallback" }));
  }
}
