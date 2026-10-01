import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

const DEFAULT_CODEX_PATHS = Object.freeze([
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  "/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  "/Applications/ChatGPT.app/Contents/Resources/codex",
  "/Applications/Codex.app/Contents/Resources/codex",
]);
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_THREADS = 4096;
const PAGE_SIZE = 100;
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

function timestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1_000).toISOString();
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function parseCodexThreadListPage(payload) {
  if (!payload || payload.error || !Array.isArray(payload.result?.data)) {
    throw new Error("Invalid Codex thread/list response");
  }
  return {
    nextCursor: typeof payload.result.nextCursor === "string" && payload.result.nextCursor
      ? payload.result.nextCursor
      : null,
    threads: payload.result.data.map((thread) => {
      const threadId = String(thread?.id || "").trim().toLocaleLowerCase();
      if (!THREAD_ID_PATTERN.test(threadId)) throw new Error("Invalid Codex thread id");
      const title = String(thread?.name || "").replace(/\s+/g, " ").trim().slice(0, 500);
      const workspacePath = String(thread?.cwd || "").trim().slice(0, 4096);
      return {
        threadId,
        title,
        updatedAt: timestamp(thread?.updatedAt ?? thread?.recencyAt ?? thread?.createdAt),
        workspacePath,
      };
    }),
  };
}

export async function readUnarchivedCodexThreads({
  codexPath,
  spawnImpl = spawn,
  timeoutMs = 10_000,
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
  let requestId = 0;
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

  const request = (method, params) => new Promise((resolve, reject) => {
    if (settled) return reject(new Error("Codex app-server is unavailable"));
    const id = ++requestId;
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
    const initialized = await request("initialize", {
      clientInfo: { name: "nuyoah-codex-workstation", title: "Nuyoah Codex Workstation", version: "0.2.0" },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    if (initialized?.error || !initialized?.result?.codexHome) {
      throw new Error("Codex app-server initialization failed");
    }
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);

    const threads = [];
    const seen = new Set();
    const seenCursors = new Set();
    let cursor = null;
    do {
      if (cursor && seenCursors.has(cursor)) throw new Error("Codex thread/list pagination looped");
      if (cursor) seenCursors.add(cursor);
      const page = parseCodexThreadListPage(await request("thread/list", {
        archived: false,
        limit: PAGE_SIZE,
        sortKey: "updated_at",
        sortDirection: "desc",
        useStateDbOnly: true,
        ...(cursor ? { cursor } : {}),
      }));
      for (const thread of page.threads) {
        if (seen.has(thread.threadId)) continue;
        seen.add(thread.threadId);
        threads.push(thread);
        if (threads.length > MAX_THREADS) throw new Error("Codex thread/list response exceeded the limit");
      }
      cursor = page.nextCursor;
    } while (cursor);
    return threads;
  } finally {
    clearTimeout(timer);
    settled = true;
    pending.clear();
    child.stdin.end();
    child.kill("SIGTERM");
  }
}
