#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectMainCodex, readTargets, selectMainCodexTarget } from "./cdp-client.mjs";
import { orderCatalogByArchive, PreviewRepository } from "../lib/preview-data.mjs";
import { presentCardPreview } from "../lib/card-view.mjs";
import { presentRateLimit } from "../lib/usage-data.mjs";
import {
  DesktopAppRecovery,
  needsPreviewAttachment,
} from "../lib/injector-state.mjs";
import { createDesktopAppRuntime } from "../lib/desktop-runtime.mjs";
import { createInjectorScheduler } from "../lib/injector-scheduler.mjs";
import { AssetConsoleBridge } from "../lib/asset-console-bridge.mjs";
import { readInstalledSkillCatalog } from "../lib/skill-catalog.mjs";
import { readPreferredSkillCatalog } from "../nuyoah/skills/runtime-catalog.mjs";
import { SkillChineseLabelService } from "../nuyoah/skills/chinese-labels.mjs";
import { readArchivedThreadIds } from "../lib/thread-archive-state.mjs";
import { readUnarchivedCodexThreads } from "../lib/codex-thread-catalog.mjs";
import { createChatGptCatalog } from "../nuyoah/taskboard/chatgpt-catalog.mjs";
import { createRemoteTaskCatalog } from "../nuyoah/taskboard/remote-catalog.mjs";

import { TaskContextStore, handleTaskContextRequest } from '../nuyoah/workstation/task-context-store.mjs';
import { createSkillTimeline } from '../nuyoah/workstation/skill-timeline-ui.mjs';
import { WorkItemsStore, handleWorkItemsRequest } from '../nuyoah/workstation/work-items-store.mjs';
import { createProjectView } from '../nuyoah/workstation/project-view.mjs';
import { liveStateRuntimeSource } from '../nuyoah/taskboard/live-state.mjs';
import { ColdHistoryService } from '../nuyoah/workstation/cold-history.mjs';
import { readSkillConfiguration } from '../nuyoah/skills/configuration.mjs';
const taskContextStore = new TaskContextStore();
const workItemsStore = new WorkItemsStore();
import { TaskRelationsService } from '../nuyoah/workstation/task-relations.mjs';
import { TaskActionStore } from '../nuyoah/workstation/task-action-store.mjs';
import { TaskActionService, rendererTaskAdapter } from '../nuyoah/workstation/task-action-service.mjs';
import { createNativeTaskMapAdapter } from '../nuyoah/workstation/task-map-native.mjs';
import { createNativeMultiChatAdapter } from '../nuyoah/workstation/multi-chat-native.mjs';
import { createMultiChatUI } from '../nuyoah/workstation/multi-chat-ui.mjs';
const taskActionStore = new TaskActionStore();
const taskActions = new TaskActionService({ store: taskActionStore, native: rendererTaskAdapter(() => client) });
// Bootstrap only the selected parent tail; later reads keep the 2 MiB budget.
const taskRelations = new TaskRelationsService({ maxInitialBodyBytes: 32 * 1024 * 1024, explicitRelations: () => taskActionStore.relations() });
import { TokenSmartEvidence } from '../nuyoah/workstation/token-smart-evidence.mjs';
import { SkillHistory } from '../nuyoah/workstation/skill-history.mjs';
const skillHistory = new SkillHistory();
const tokenSmart = new TokenSmartEvidence({ history: skillHistory });
let historyCatalog = [];
import { AutomaticReferences } from '../nuyoah/workstation/automatic-references.mjs';
const automaticReferences = new AutomaticReferences();
const coldHistory = new ColdHistoryService({ store: taskContextStore });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "inject", "conversation-preview.user.js");
const SCRIPT_ID_GLOBAL = "__CODEX_CONVERSATION_PREVIEW_SCRIPT_IDENTIFIER__";

function parseArgs(argv) {
  const options = { port: 9231, watch: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--watch") options.watch = true;
    else if (arg === "--port") options.port = Number(argv[++index]);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error("Invalid port");
  return options;
}

async function targetId(port) {
  try {
    return selectMainCodexTarget(await readTargets(port))?.id || null;
  } catch {
    return null;
  }
}

const options = parseArgs(process.argv.slice(2));
const repository = new PreviewRepository();

let stopped = false;
let attachedTargetId = null;
let client = null;
let registeredScriptIdentifier = null;
let rendererRevision = 0;
const scheduler = createInjectorScheduler({ onError: name => process.stderr.write(`[injector] ${name} unavailable; existing view retained\n`) });
const isCurrentRenderer = (owner, revision) => !stopped && owner === client && revision === rendererRevision && Boolean(attachedTargetId);
let rawSkillCatalog = [];
let skillCatalog = [];
let nextSkillCatalogRefreshAt = 0;
let archivedThreadIds = [];
let nextArchivedThreadRefreshAt = 0;
let unarchivedThreads = [];
let nextUnarchivedThreadRefreshAt = 0;
const skillLabelService = new SkillChineseLabelService();
const desktopAppRecovery = new DesktopAppRecovery();
const desktopAppRuntime = createDesktopAppRuntime();
const assetConsoleBridge = new AssetConsoleBridge({
  staticRoot: process.env.CODEX_ASSET_CONSOLE_STATIC_ROOT
    || path.join(root, "vendor", "codex-workspace-enhancer", "asset-console", "public"),
  tokenPath: process.env.CODEX_ASSET_CONSOLE_TOKEN_FILE,
  port: Number(process.env.CODEX_ASSET_CONSOLE_PORT || 5177),
  logger: (message) => process.stdout.write(`[asset-console] ${message}\n`),
});

async function closeClient() {
  rendererRevision++;
  const closingClient = client;
  if (assetConsoleBridge.client === closingClient) await assetConsoleBridge.dispose();
  closingClient?.close();
  if (client === closingClient) client = null;
}

async function attach() {
  const nextTargetId = await targetId(options.port);
  if (!nextTargetId && options.watch) {
    let app = null;
    try { app = await desktopAppRuntime.readProcess(); } catch {}
    const action = desktopAppRecovery.next({ targetAvailable: false, app });
    if (action?.type === "quit") {
      try {
        await desktopAppRuntime.quit(action.app);
        process.stdout.write(`Restarting ${action.app.appPath} to enable sidebar enhancement\n`);
      } catch {}
    } else if (action?.type === "launch") {
      desktopAppRuntime.launch(action.appPath, options.port);
      desktopAppRecovery.markLaunched();
      process.stdout.write(`Launching ${action.appPath} with sidebar enhancement enabled\n`);
    }
    return false;
  }
  desktopAppRecovery.next({ targetAvailable: Boolean(nextTargetId), app: null });
  if (!await needsPreviewAttachment({ client, attachedTargetId, nextTargetId })) return false;
  rendererRevision++;

  if (!client || nextTargetId !== attachedTargetId) {
    await closeClient();
    client = await connectMainCodex(options.port);
    registeredScriptIdentifier = null;
  }

  const oldIdentifier = registeredScriptIdentifier
    || await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] || null`);
  if (oldIdentifier) {
    try { await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: oldIdentifier }); } catch {}
  }
  const userSource = await readFile(sourcePath, "utf8");
  const taskContextSource = await readFile(path.join(root, 'nuyoah/workstation/task-context-ui.js'), 'utf8');
  const workItemsSource = await readFile(path.join(root, 'nuyoah/workstation/work-items-ui.js'), 'utf8');
  const workCanvasSource = await readFile(path.join(root, 'nuyoah/workstation/work-canvas.js'), 'utf8');
  const taskMapSource = await readFile(path.join(root, 'nuyoah/workstation/task-map-ui.js'), 'utf8');
  const taskActionTransportSource = await readFile(path.join(root, 'nuyoah/workstation/task-action-transport.js'), 'utf8');
  const workstationConfig = { workItemsCommand: [process.execPath, path.join(root, 'scripts/work-items.mjs')], skills: await readSkillConfiguration(), taskContextCommand: [process.execPath, path.join(root, 'scripts/task-context.mjs')] };
  const remoteSource = `(() => {
    window.__nuyoahRemoteTaskCatalog__?.destroy?.();
    const catalog = (${createRemoteTaskCatalog.toString()})({
      bridge: window.electronBridge,
      initiallyActive: false,
      requestPage: (hostId, params, options) => window.__nuyoahNativeTaskAdapter__.listThreads(hostId, params, options),
      initialTasks: window.__NUYOAH_REMOTE_TASK_SNAPSHOT__ || [],
      initialCatalog: window.electronBridge?.getInitialSidebarBootstrap?.()?.catalogEntries || [],
      includeLocal: true,
      onChange: change => {
        window.__codexTaskboardInjection__?.refreshContext?.();
        window.__nuyoahTaskMapUI__?.refreshLive?.();
        if (change?.relationsChanged) window.__nuyoahTaskMapUI__?.invalidateRelations?.();
      },
      getProjects: () => {
        const saved = window.electronBridge?.getInitialSidebarBootstrap?.()?.globalStateEntries
          ?.find(entry => entry.key === 'remote-projects')?.value || [];
        const savedProjects = new Map((Array.isArray(saved) ? saved : []).map(p => [p.id, { ...p, path: p.remotePath, name: p.name || p.label }]));
        const projects = new Map();
        document.querySelectorAll('[data-app-action-sidebar-project-row]').forEach(row => {
          const id = row.getAttribute('data-app-action-sidebar-project-id');
          if (!id) return;
          const project = { ...savedProjects.get(id), id, name: row.getAttribute('data-app-action-sidebar-project-label') };
          // Read only the owning native project's metadata, including projects added
          // since bootstrap. Do not walk conversation state or mutate React nodes.
          let fiber = row[Object.keys(row).find(key => key.startsWith('__reactFiber'))];
          for (let depth = 0; fiber && depth < 18; depth++, fiber = fiber.return) {
            const group = fiber.memoizedProps?.group;
            if (group?.projectId !== id || group.projectKind !== 'remote') continue;
            project.hostId = group.hostId;
            project.path = group.path;
            project.threadIds = (Array.isArray(group.threadKeys) ? group.threadKeys : []).map(key => String(key).replace(/^local:/, ''));
            break;
          }
          projects.set(id, project);
        });
        return [...projects.values()];
      },
    });
    const chats = (${createChatGptCatalog.toString()})({
      read: () => window.__nuyoahNativeTaskAdapter__.listChatGptThreads(),
      onChange: () => window.__codexTaskboardInjection__?.refreshContext?.(),
    });
    window.__nuyoahChatGptCatalog__ = chats;
    const receive = event => { if (event.source === window || event.source === null) catalog.handleMessage(event.data); };
    window.addEventListener('message', receive);
    const syncActivity = () => {
      chats.setActive(document.visibilityState !== 'hidden'
        && window.__codexConversationPreviewInjection__?.isWorkstationVisible?.() === true);
      catalog.setActive(document.visibilityState !== 'hidden'
        && window.__codexConversationPreviewInjection__?.isWorkstationVisible?.() === true);
    };
    // Opening or closing a panel changes activity immediately. An in-flight scan
    // stops on close, so pagination and relation timers cannot keep going.
    const visibilityObserver = new MutationObserver(syncActivity);
    visibilityObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', syncActivity);
    const timer = window.setInterval(() => { syncActivity(); void catalog.refresh(); }, 15000);
    window.__nuyoahRemoteTaskCatalog__ = { ...catalog, destroy() {
      window.__NUYOAH_REMOTE_TASK_SNAPSHOT__ = catalog.snapshot();
      window.clearInterval(timer);
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', syncActivity);
      window.removeEventListener('message', receive);
      catalog.dispose(); chats.dispose();
      delete window.__nuyoahChatGptCatalog__;
      delete window.__nuyoahRemoteTaskCatalog__;
    } };
    delete window.__NUYOAH_REMOTE_TASK_SNAPSHOT__;
    syncActivity();
  })();`;
  const projectSource = `window.__nuyoahProjectView__ = (${createProjectView.toString()})({storage: window.localStorage, states: ${liveStateRuntimeSource()}});`;
  const multiChatSource = `window.__nuyoahMultiChat__?.destroy?.(); window.__nuyoahMultiChatNative__ = (${createNativeMultiChatAdapter.toString()})({ window }); window.__nuyoahMultiChat__ = (${createMultiChatUI.toString()})({ window, adapter: window.__nuyoahMultiChatNative__ });`;
  const rendererSource = `if (window.top === window) { window.__NUYOAH_WORKSTATION_CONFIG__ = ${JSON.stringify(workstationConfig)}; ${projectSource}\n${taskContextSource}\nwindow.__nuyoahTaskMapUI__?.retainActions?.();\n${userSource}\n${workCanvasSource}\nwindow.__nuyoahNativeTaskAdapter__ = (${createNativeTaskMapAdapter.toString()})({ window });\n${taskActionTransportSource}\n${taskMapSource}\n${workItemsSource}\nwindow.__nuyoahSkillTimeline__?.destroy?.(); window.__nuyoahSkillTimeline__ = (${createSkillTimeline.toString()})({ window, document });\n${remoteSource}\n${multiChatSource}\n}`;
  const registered = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: rendererSource });
  registeredScriptIdentifier = registered.identifier;
  await client.evaluate(rendererSource);
  await client.evaluate(`window[${JSON.stringify(SCRIPT_ID_GLOBAL)}] = ${JSON.stringify(registered.identifier)}`);
  await assetConsoleBridge.install(client);
  attachedTargetId = nextTargetId;
  process.stdout.write(`Codex conversation preview attached to renderer ${nextTargetId}\n`);
  return true;
}

async function readActiveConversationContext(owner = client) {
  if (!client || !attachedTargetId) return { threadId: "", title: "" };
  return owner.evaluate(`(() => {
    const active = document.querySelector('[data-app-action-sidebar-thread-active="true"], [data-app-action-sidebar-thread-selected="true"], [data-app-action-sidebar-thread-row][aria-current="page"]');
    return {
      threadId: active?.getAttribute('data-app-action-sidebar-thread-id') || '',
      title: active?.getAttribute('data-app-action-sidebar-thread-title') || '',
    };
  })()`);
}

async function pushSkillCatalog(owner = client, revision = rendererRevision) {
  if (!isCurrentRenderer(owner, revision)) return;
  await owner.evaluate(`window.__codexConversationPreviewInjection__?.setSkillCatalog?.(${JSON.stringify(skillCatalog)})`);
}

async function processSkillLabelRequest(request, owner = client, revision = rendererRevision) {
  if (!isCurrentRenderer(owner, revision)) return;
  const mode = request?.mode;
  if (mode === "refresh") {
    nextSkillCatalogRefreshAt = 0;
    nextFullRefreshAt = 0;
    return;
  }
  if (!rawSkillCatalog.length) return;
  const id = typeof request?.id === "string" ? request.id : "";
  if (!(["missing", "all"].includes(mode) || (mode === "single" && /^skill-[a-f0-9]{24}$/u.test(id)))) return;
  let result = { requested: 0, generated: 0, failed: 0 };
  try {
    result = await skillLabelService.generate(rawSkillCatalog, { mode, id });
  } catch {}
  skillCatalog = await skillLabelService.decorate(rawSkillCatalog);
  await pushSkillCatalog(owner, revision);
  process.stdout.write(`Skill Chinese labels: ${result.generated}/${result.requested} generated, ${result.failed} pending\n`);
}

async function processTaskContextRequest(request, owner = client, revision = rendererRevision) {
  if (!request) return;
  const response = request.action === 'skills:history'
    ? { id: request.id, skillHistory: request.hostId && request.hostId !== 'local' ? { status: 'unavailable', skills: [] }
      : request.scope === 'project' ? await skillHistory.project(request.projectId, historyCatalog) : await skillHistory.view(request.threadId) }
    : await handleTaskContextRequest(taskContextStore, request, coldHistory, tokenSmart, automaticReferences);
  const receiver = request.consumer === 'timeline' ? '__nuyoahSkillTimeline__' : '__nuyoahTaskContextUI__';
  if (isCurrentRenderer(owner, revision)) await owner.evaluate(`window.${receiver}?.receive?.(${JSON.stringify(response)})`);
}

async function processWorkItemsRequest(request, owner = client, revision = rendererRevision) {
  if (!request) return;
  const response = await handleWorkItemsRequest(workItemsStore, request);
  if (isCurrentRenderer(owner, revision)) await owner.evaluate(`window.__nuyoahWorkItemsUI__?.receive?.(${JSON.stringify(response)})`);
}

async function processTaskMapRequest(packet, owner = client, revision = rendererRevision) {
  if (!packet) return;
  let response;
  try { response = { id: packet.request.id, data: await taskRelations.view({ ...packet.request, tasks: packet.tasks }) }; }
  catch { response = { id: packet.request?.id, error: '任务关联暂时无法读取。' }; }
  if (isCurrentRenderer(owner, revision)) await owner.evaluate(`window.__nuyoahTaskMapUI__?.receive?.(${JSON.stringify(response)})`);
}

const activeActionRequests = new Set();
async function processTaskActionRequest(request, owner = client, revision = rendererRevision) {
  if (!isCurrentRenderer(owner, revision) || activeActionRequests.size >= 4) return;
  if (!request || !['inspect', 'execute'].includes(request.kind)) return;
  activeActionRequests.add(request.id);
  void (async () => {
    let result;
    try { result = await taskActions[request.kind](request.value); }
    catch { result = request.kind === 'inspect' ? { available: false, target: request.value }
      : { status: 'unknown', message: '尚未确认执行结果，请打开对话核对；请勿重复发送。' }; }
    try { if (isCurrentRenderer(owner, revision)) await owner.evaluate(`window.__nuyoahTaskActionTransport__?.receive?.(${JSON.stringify({ id: request.id, result })})`); } catch {}
    finally { activeActionRequests.delete(request.id); }
  })();
}

async function currentArchivedThreadIds() {
  if (Date.now() < nextArchivedThreadRefreshAt) return archivedThreadIds;
  try {
    archivedThreadIds = await readArchivedThreadIds();
  } catch {}
  nextArchivedThreadRefreshAt = Date.now() + 5_000;
  return archivedThreadIds;
}

async function currentUnarchivedThreads() {
  if (Date.now() < nextUnarchivedThreadRefreshAt) return unarchivedThreads;
  try {
    unarchivedThreads = await readUnarchivedCodexThreads();
  } catch {}
  nextUnarchivedThreadRefreshAt = Date.now() + 15_000;
  return unarchivedThreads;
}

async function refreshSkillCatalog(owner = client, revision = rendererRevision) {
  const activeContext = await readActiveConversationContext(owner);
  const activeThreadId = String(activeContext?.threadId || '').replace(/^(?:local|cloud):/i, '').toLowerCase();
  await repository.ensureIndex();
  const cwd = activeThreadId ? await repository.sessionWorkspace(activeThreadId).catch(() => '') : '';
  const raw = await readPreferredSkillCatalog({ cwd: cwd || os.homedir(), fallback: () => readInstalledSkillCatalog() });
  const decorated = await skillLabelService.decorate(raw);
  if (!isCurrentRenderer(owner, revision)) return;
  rawSkillCatalog = raw; skillCatalog = decorated;
  nextSkillCatalogRefreshAt = Date.now() + 5 * 60_000;
  await pushSkillCatalog(owner, revision);
}

async function pushPreviews(owner = client, revision = rendererRevision) {
  if (!isCurrentRenderer(owner, revision)) return;
  if (!await owner.evaluate(`window.__codexConversationPreviewInjection__?.sidebarMode === 'enhanced'
    || (document.visibilityState !== 'hidden'
      && window.__codexConversationPreviewInjection__?.isWorkstationVisible?.() === true)`)) return;
  const [requests, rawRecentCatalog, pinnedThreadIds, nativeUnarchivedThreads, archivedIds] = await Promise.all([
    owner.evaluate(`(() => {
      const seen = new Set();
      const allPanel = document.getElementById('codex-sidebar-all-projects');
      const rows = allPanel
        ? Array.from(allPanel.querySelectorAll('[data-codex-sidebar-all-project-row]'))
        : Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]:not([data-codex-sidebar-all-project-row])'));
      const pending = rows.filter((row) => row.getAttribute('data-codex-conversation-preview-loaded') !== 'true');
      const loaded = rows.filter((row) => row.getAttribute('data-codex-conversation-preview-loaded') === 'true');
      return [...pending, ...loaded].flatMap((row) => {
        const id = row.getAttribute('data-app-action-sidebar-thread-id') || '';
        const title = row.getAttribute('data-app-action-sidebar-thread-title') || '';
        const key = id + '\\n' + title;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ key, id, title }];
      });
    })()`),
    repository.readRecentCatalog(),
    repository.readPinnedThreadIds(),
    currentUnarchivedThreads(),
    currentArchivedThreadIds(),
  ]);
  const recentCatalog = orderCatalogByArchive(rawRecentCatalog, archivedIds);
  historyCatalog = recentCatalog;
  const taskCatalog = nativeUnarchivedThreads.length
    ? await repository.readRecentCatalog({ sourceThreads: nativeUnarchivedThreads })
    : recentCatalog.filter((entry) => entry.archived !== true);
  const activeThreadIds = await repository.readRunningThreadIds({ catalog: taskCatalog });
  const interruptedCatalog = await repository.readInterruptedCatalog({
    activeThreadIds,
    archivedThreadIds: archivedIds,
    catalog: taskCatalog,
  });
  const recentRequests = recentCatalog.slice(0, 30).map((entry) => ({
    key: `local:${entry.threadId}\n${entry.title}`,
    id: `local:${entry.threadId}`,
    title: entry.title,
  }));
  const interruptedRequests = interruptedCatalog.slice(0, 30).map((entry) => ({
    key: `local:${entry.threadId}\n${entry.title}`,
    id: `local:${entry.threadId}`,
    title: entry.title,
  }));
  const taskRequests = taskCatalog.slice(0, 80).map((entry) => ({
    key: `local:${entry.threadId}\n${entry.title}`,
    id: `local:${entry.threadId}`,
    title: entry.title,
  }));
  const previewRequests = Array.from(new Map(
    [...taskRequests, ...recentRequests, ...interruptedRequests, ...(Array.isArray(requests) ? requests : [])]
      .map((request) => [request.key, request]),
  ).values());
  const searchCatalog = recentCatalog.filter((entry) => entry.projectId && entry.projectName);
  const [rawPreviews, rawUsage] = await Promise.all([
    repository.readMany(previewRequests),
    repository.readUsage(),
  ]);
  const previews = rawPreviews.map((preview) => presentCardPreview(preview));
  const usage = presentRateLimit(rawUsage, { timeZone: "Asia/Shanghai" });
  if (!isCurrentRenderer(owner, revision)) return;
  const snapshot = { previews, usage, searchCatalog, recentCatalog,
    taskCatalog: taskCatalog.map(task => ({ ...task, activityAt: repository.taskActivityAt(task.threadId) })),
    interruptedCatalog, pinnedThreadIds, activeThreadIds };
  await owner.evaluate(`window.__codexConversationPreviewInjection__?.applySnapshot?.(${JSON.stringify(snapshot)})`);
}

// One renderer crossing drains only idle services. A slow scan never prevents
// the next map request from being picked up, and cannot start duplicate scans.
async function pumpRequests() {
  const owner = client, revision = rendererRevision;
  if (!isCurrentRenderer(owner, revision)) return false;
  const ready = Object.fromEntries(['skills', 'context', 'work', 'map'].map(name => [name, !scheduler.busy(name)]));
  ready.action = activeActionRequests.size < 4;
  const packet = await owner.evaluate(`(() => {
    const ready = ${JSON.stringify(ready)}, api = window.__codexConversationPreviewInjection__;
    const request = ready.map ? window.__nuyoahTaskMapUI__?.takeRequest?.() : null;
    const tasks = request ? api?.getTaskboardSnapshot?.({ includeProjectHistory: true })?.tasks || [] : [];
    return {
      active: document.visibilityState !== 'hidden' && (api?.sidebarMode === 'enhanced' || api?.isWorkstationVisible?.() === true),
      skills: ready.skills ? api?.takeSkillLabelRequest?.() : null,
      context: ready.context ? window.__nuyoahSkillTimeline__?.takeRequest?.() || window.__nuyoahTaskContextUI__?.takeRequest?.() : null,
      work: ready.work ? window.__nuyoahWorkItemsUI__?.takeRequest?.() : null,
      map: request ? { request, tasks: tasks.slice(0, 4096).map(({ hostId, threadId, title, projectId, projectName, runtimeStatus, parentThreadId, forkedFromId, archived }) =>
        ({ hostId, threadId, title, projectId, projectName, runtimeStatus, parentThreadId, forkedFromId, archived })) } : null,
      action: ready.action ? window.__nuyoahTaskActionTransport__?.takeRequest?.() : null,
    };
  })()`);
  if (!isCurrentRenderer(owner, revision)) return false;
  for (const [name, handler] of Object.entries({ skills: processSkillLabelRequest, context: processTaskContextRequest,
    work: processWorkItemsRequest, map: processTaskMapRequest })) {
    if (packet[name]) void scheduler.run(name, () => handler(packet[name], owner, revision));
  }
  if (packet.action) await processTaskActionRequest(packet.action, owner, revision);
  return packet.active === true;
}

async function stop() {
  if (stopped) return;
  stopped = true;
  try { await client?.evaluate("window.__nuyoahTaskMapUI__?.retainActions?.(); window.__codexConversationPreviewInjection__?.destroy?.()") } catch {}
  await closeClient();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await stop();
    process.exit(0);
  });
}

let nextFullRefreshAt = 0;
let nextAttachAt = 0, previouslyActive = false;
try {
  while (!stopped) {
    let active = false;
    try {
      let attached = false;
      if (Date.now() >= nextAttachAt) { attached = await attach(); nextAttachAt = Date.now() + 1000; }
      active = await pumpRequests();
      void coldHistory.tick().catch(() => {});
      if (attached) { nextFullRefreshAt = 0; nextSkillCatalogRefreshAt = 0; }
      if (active && !previouslyActive) nextFullRefreshAt = 0;
      previouslyActive = active;
      const owner = client, revision = rendererRevision;
      if (active && Date.now() >= nextFullRefreshAt && !scheduler.busy('previews')) {
        nextFullRefreshAt = Date.now() + 5_000;
        void scheduler.run('previews', () => pushPreviews(owner, revision));
      }
      if (active && Date.now() >= nextSkillCatalogRefreshAt && !scheduler.busy('skills')) {
        nextSkillCatalogRefreshAt = Date.now() + 30_000;
        void scheduler.run('skills', () => refreshSkillCatalog(owner, revision));
      }
      if (!options.watch) await scheduler.settle();
    } catch (error) {
      attachedTargetId = null;
      registeredScriptIdentifier = null;
      await closeClient();
      if (!options.watch) throw error;
    }
    if (!options.watch) break;
    await new Promise((resolve) => setTimeout(resolve, active ? 250 : 1_000));
  }
} finally {
  if (!options.watch) await stop();
}
