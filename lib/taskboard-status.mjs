import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TASKBOARD_VERSION, defaultTaskboardDataDir } from "./runtime-plan.mjs";

export function trustedTaskboardRuntimeBaseUrl(descriptor) {
  try {
    const url = new URL(descriptor?.url);
    if (url.protocol !== "http:") return null;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
    const tokenized = /^\/[a-z0-9-]{16,128}\/?$/i.test(url.pathname);
    const managedRoot = /^\/?$/.test(url.pathname)
      && descriptor?.managedBy === "codex-sidebar-enhancer"
      && descriptor?.version === TASKBOARD_VERSION;
    if (!tokenized && !managedRoot) return null;
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function readActiveTaskThreads({
  runtimeFile,
  fetchImpl = fetch,
  timeoutMs = 1_500,
} = {}) {
  const configuredRuntimeFile = runtimeFile || process.env.CODEX_SIDEBAR_TASKBOARD_RUNTIME_FILE;
  const runtimeFiles = configuredRuntimeFile
    ? [configuredRuntimeFile]
    : [
        path.join(os.homedir(), ".codex", "taskboard-data", "runtime.json"),
        path.join(defaultTaskboardDataDir({
          platform: process.platform,
          home: os.homedir(),
          localAppData: process.env.LOCALAPPDATA,
        }), "runtime.json"),
      ];
  for (const candidate of [...new Set(runtimeFiles)]) {
    try {
      const descriptor = JSON.parse(await readFile(candidate, "utf8"));
      const baseUrl = trustedTaskboardRuntimeBaseUrl(descriptor);
      if (!baseUrl) continue;
      const response = await fetchImpl(`${baseUrl}/api/tasks`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const activeThreadIds = Array.from(new Set(
        (Array.isArray(payload?.tasks) ? payload.tasks : [])
          .filter((task) => task?.status === "in_progress" && typeof task?.threadId === "string")
          .map((task) => task.threadId.trim())
          .filter(Boolean),
      ));
      return { available: true, activeThreadIds };
    } catch {}
  }
  return { available: false, activeThreadIds: [] };
}
