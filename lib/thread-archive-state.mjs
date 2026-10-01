import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

const DEFAULT_CODEX_PATHS = Object.freeze([
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  "/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  "/Applications/ChatGPT.app/Contents/Resources/codex",
  "/Applications/Codex.app/Contents/Resources/codex",
]);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVED_THREADS = 4096;
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

async function findCodexExecutable(paths = DEFAULT_CODEX_PATHS) {
  for (const candidate of paths) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("Bundled Codex executable is unavailable");
}

export function parseArchivedThreadListResponse(payload) {
  if (!payload || payload.error || !Array.isArray(payload.result?.data)) {
    throw new Error("Invalid archived thread/list response");
  }
  if (payload.result.data.length > MAX_ARCHIVED_THREADS) {
    throw new Error("Archived thread/list response exceeded the limit");
  }
  const ids = [];
  const seen = new Set();
  for (const thread of payload.result.data) {
    const id = String(thread?.id || "").trim().toLocaleLowerCase();
    if (!THREAD_ID_PATTERN.test(id)) throw new Error("Invalid archived thread id");
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export async function readArchivedThreadIds({
  codexPath,
  spawnImpl = spawn,
  timeoutMs = 8_000,
} = {}) {
  const executable = codexPath || await findCodexExecutable();
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
    for (const waiter of pending.values()) waiter.reject(error || new Error("Codex app-server stopped"));
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
          const waiter = pending.get(message?.id);
          if (waiter) {
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
    if (settled) return reject(new Error("Codex app-server is unavailable"));
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
      clientInfo: { name: "nuyoah-codex-workstation", title: "Nuyoah Codex Workstation", version: "0.2.0" },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    if (initialized?.error || !initialized?.result?.codexHome) {
      throw new Error("Codex app-server initialization failed");
    }
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
    const response = await request(2, "thread/list", {
      archived: true,
      limit: MAX_ARCHIVED_THREADS,
      sortKey: "updated_at",
      sortDirection: "desc",
      useStateDbOnly: true,
    });
    if (response?.result?.nextCursor) throw new Error("Archived thread/list response was incomplete");
    return parseArchivedThreadListResponse(response);
  } finally {
    clearTimeout(timer);
    settled = true;
    pending.clear();
    child.stdin.end();
    child.kill("SIGTERM");
  }
}
