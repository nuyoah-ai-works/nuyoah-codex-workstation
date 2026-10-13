// Self-contained so the same implementation runs in node tests and the renderer.
// Uses the desktop's existing connection; never opens a host or reads thread bodies.
export function createRemoteTaskCatalog({ bridge, getProjects = () => [], onChange = () => {}, now = Date.now, initialTasks = [], initialCatalog = [],
  timeoutMs = 12_000, includeLocal = false, refreshIntervalMs = 120_000, localRefreshIntervalMs = 15_000,
  localRelationRefreshIntervalMs = 15_000, retryBaseMs = 15_000, maxRetryMs = 120_000, scanTimeoutMs = 60_000,
  setRelationTimer = setTimeout, clearRelationTimer = clearTimeout, requestPage, readAttention = () => null, initiallyActive = true }) {
  const hosts = new Map();
  const newHost = (hostId) => ({ hostId, entries: new Map(), updates: new Map(), admitted: new Set(), available: false,
    refreshing: false, generation: 0, connectionState: "unknown", blockedByConfig: null,
    failures: 0, nextRefreshAt: 0, lastSuccessAt: null, lastFailure: null, lastChunkFailure: null, pagesRead: 0 });
  const localHost = newHost("local");
  const localRelationHosts = new Map();
  const knownLocalThreads = new Set();
  const pending = new Map();
  const transfers = new Map();
  const connections = ["remote_control_connections", "remote_ssh_connections", "remote_wsl_connections"];
  let disposed = false;
  let active = initiallyActive;
  let sequence = 0;
  let localRelationRefreshWork = null, localRelationRootsChanged = false;
  let localRelationTimer = null;
  const prefix = `nuyoah-task-catalog-${now()}-`;
  const remote = (id) => typeof id === "string" && id.length > 0 && id.length < 512
    && id !== "local" && !id.startsWith("chatgpt:");
  const text = (value, max = 500) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value.toLowerCase() : null;
  const timestamp = (value) => {
    const ms = typeof value === "number" ? value * (value < 1e12 ? 1000 : 1) : Date.parse(value || "");
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  };
  const runtimeStatus = (status) => status?.type === "active" ? "running"
    : status?.type === "systemError" ? "failed"
      : ["idle", "notLoaded"].includes(status?.type) ? "completed" : "unknown";
  const waitingReason = (status) => status?.type !== "active" ? null
    : status.activeFlags?.includes("waitingOnUserInput") ? "input"
      : status.activeFlags?.includes("waitingOnApproval") ? "approval" : null;
  const failure = (code) => Object.assign(new Error("Remote catalog unavailable"), { code });

  // The native UI acknowledges transport chunks. Independently retain only our
  // requested catalog envelope and admitted metadata, never previews or turns.
  function receiveChunk(message) {
    const { transferId, sequence, kind } = message;
    if (typeof transferId !== "string" || !Number.isSafeInteger(sequence)) return;
    if (kind === "start") {
      if (!pending.size) return;
      for (const [id, state] of transfers) if (now() - state.startedAt > timeoutMs) transfers.delete(id);
      if (transfers.size >= 8) return;
      transfers.set(transferId, { next: sequence + 1, stack: [], root: null, string: null, size: 0, startedAt: now() });
      return;
    }
    const state = transfers.get(transferId);
    if (!state || sequence !== state.next++) { transfers.delete(transferId); return; }
    const slot = () => {
      const frame = state.stack.at(-1), key = frame?.key;
      if (!frame) return "root";
      if (frame.role === "root") return key === "message" ? "message" : ["type", "hostId"].includes(key) ? "scalar" : null;
      if (frame.role === "message") {
        if (key === "id") return "scalar";
        if (!["result", "error"].includes(key)) return null;
        if (state.root?.type !== "mcp-response" || pending.get(state.root.message?.id)?.hostId !== state.root.hostId) throw new Error("Unowned response");
        return key;
      }
      if (frame.role === "result") return key === "data" ? "data" : key === "nextCursor" ? "scalar" : null;
      if (frame.role === "data") return "thread";
      if (frame.role === "thread") return key === "status" ? "status"
        : ["id", "name", "cwd", "projectId", "updatedAt", "createdAt", "ephemeral", "parentThreadId", "forkedFromId"].includes(key) ? "scalar" : null;
      if (frame.role === "status") return key === "type" ? "scalar" : key === "activeFlags" ? "flags" : null;
      if (frame.role === "flags") return "scalar";
      return null;
    };
    const save = (value, role) => {
      const frame = state.stack.at(-1);
      if (!frame) { state.root = value; return; }
      if (role && frame.value) {
        if (Array.isArray(frame.value)) frame.value.push(value);
        else Object.defineProperty(frame.value, frame.key, { value, enumerable: true, configurable: true, writable: true });
      }
      frame.key = null;
    };
    try {
      if (kind === "end") {
        transfers.delete(transferId);
        if (!state.stack.length && !state.string && state.root) handleMessage(state.root);
        return;
      }
      if (kind !== "chunk" || !Array.isArray(message.tokens)) throw new Error("Invalid chunk");
      for (const token of message.tokens) {
        if (token.type === "object-start" || token.type === "array-start") {
          const role = slot();
          const value = role ? token.type === "array-start" ? [] : {} : null;
          save(value, role); state.stack.push({ role, value, key: null });
        } else if (token.type === "container-end") {
          if (!state.stack.pop()) throw new Error("Invalid container");
        } else if (token.type === "key") {
          const frame = state.stack.at(-1);
          if (!frame) throw new Error("Invalid key");
          frame.key = frame.role ? token.value : null;
        } else if (token.type === "value") {
          const role = slot();
          const value = role ? typeof token.value === "string" ? token.value.slice(0, 4096) : token.value : null;
          save(value, role);
        } else if (token.type === "string-start") {
          state.string = { target: token.target, role: token.target === "key" ? "scalar" : slot(), text: "" };
        } else if (token.type === "string-chunk") {
          if (state.string?.role) state.string.text = (state.string.text + token.value).slice(0, 4096);
        } else if (token.type === "string-end") {
          if (!state.string) throw new Error("Invalid string");
          if (state.string.target === "key") state.stack.at(-1).key = state.string.text;
          else save(state.string.text, state.string.role);
          state.string = null;
        }
        // Bound retained metadata and malformed container nesting.
        if (++state.size > 500000 || state.stack.length > 32) throw new Error("Oversized catalog");
      }
    } catch (error) {
      const waiter = pending.get(state.root?.message?.id);
      const host = waiter?.owner;
      if (host) host.lastChunkFailure = error?.message === "Oversized catalog" ? "size"
        : error?.message === "Unowned response" ? "ownership" : "format";
      transfers.delete(transferId);
    }
  }

  function request(host, cursor, waitMs = timeoutMs) {
    const hostId = host.hostId;
    const id = `${prefix}${++sequence}`;
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        pending.delete(id);
        controller.abort();
        reject(failure("timeout"));
      }, waitMs);
      pending.set(id, { hostId, owner: host, resolve, reject, timer, controller });
      const envelope = {
        type: "mcp-request", hostId, timeoutMs: waitMs,
        request: { id, method: "thread/list", params: {
          archived: false, limit: 100, sortKey: "updated_at", sortDirection: "desc",
          // Some native versions omit children even with all source kinds. Visible
          // graph ancestors therefore have separate, explicitly scoped scans.
          ...(host.relationRoot ? { sourceKinds: ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview",
            "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"] } : {}),
          ...(host.relationRoot ? { ancestorThreadId: host.relationRoot } : {}),
          useStateDbOnly: true, ...(cursor ? { cursor } : {}),
        } },
      };
      // Production uses the host client's registered request table. Sending a raw
      // mcp-request creates a second owner and an unregistered native response.
      const send = () => {
        if (controller.signal.aborted) return;
        if (requestPage) return Promise.resolve(requestPage(hostId, envelope.request.params, { signal: controller.signal, timeoutMs: waitMs }))
          .then(result => handleMessage({ type: "mcp-response", hostId, message: { id, result } }));
        return bridge.sendMessageFromView(envelope);
      };
      let operation;
      try { operation = send(); } catch (error) { operation = Promise.reject(error); }
      Promise.resolve(operation).catch(() => {
        const waiter = pending.get(id);
        if (!waiter) return;
        clearTimeout(timer);
        pending.delete(id);
        reject(failure("send"));
      });
    });
  }

  function cancelHost(host) {
    host.generation++;
    host.refreshing = false;
    host.available = false;
    // A reconnect must not replay a previous local connection's activity hints.
    if (host.hostId === "local") host.updates.clear();
    for (const [id, waiter] of pending) {
      if (waiter.owner !== host) continue;
      clearTimeout(waiter.timer);
      waiter.controller.abort();
      pending.delete(id);
      waiter.reject(new Error("Remote connection changed"));
    }
  }

  function normalize(thread, host) {
    const threadId = String(thread?.id || "").toLowerCase();
    const updatedAt = timestamp(thread?.updatedAt ?? thread?.createdAt);
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(threadId) || !updatedAt || thread.ephemeral === true) return null;
    if (host.hostId === "local") {
      knownLocalThreads.delete(threadId); knownLocalThreads.add(threadId);
      if (knownLocalThreads.size > 4096) knownLocalThreads.delete(knownLocalThreads.values().next().value);
    }
    const parentThreadId = uuid(thread.parentThreadId), forkedFromId = uuid(thread.forkedFromId);
    return {
      threadId, taskKey: `${host.hostId}/${threadId}`, hostId: host.hostId,
      ...(parentThreadId ? { parentThreadId } : {}), ...(forkedFromId ? { forkedFromId } : {}),
      hostName: host.displayName, title: text(thread.name) || "未命名任务",
      projectId: text(thread.projectId), workspacePath: text(thread.cwd, 4096),
      workspacePathStatus: "unknown", createdAt: timestamp(thread.createdAt), updatedAt, runtimeStatus: runtimeStatus(thread.status),
      waitingReason: waitingReason(thread.status),
    };
  }

  async function refreshHost(host) {
    if (!active || host.refreshing || disposed || host.blockedByConfig || now() < host.nextRefreshAt
      || !["unknown", "connected"].includes(host.connectionState)) return;
    const generation = ++host.generation;
    host.refreshing = true;
    host.pagesRead = 0;
    const startedAt = now();
    try {
      const entries = new Map();
      const cursors = new Set();
      let cursor = null;
      let pages = 0;
      do {
        if (!active || disposed || host.generation !== generation) return;
        const remainingMs = scanTimeoutMs - (now() - startedAt);
        if (remainingMs <= 0 || ++pages > (host.relationRoot ? 16 : 100)) throw new Error("Incomplete remote catalog");
        const page = await request(host, cursor, Math.min(timeoutMs, remainingMs));
        if (disposed || host.generation !== generation) return;
        if (!Array.isArray(page?.data)) throw new Error("Invalid remote catalog");
        host.pagesRead++;
        for (const thread of page.data) {
          const entry = normalize(thread, host);
          if (!entry) continue;
          const previous = host.entries.get(entry.threadId);
          if (entry.runtimeStatus === "completed" && previous?.hasFinalResponse && Date.parse(entry.updatedAt) <= previous.finalAt) {
            entry.hasFinalResponse = true;
            entry.finalAt = previous.finalAt;
            entry.updatedAt = previous.updatedAt;
          }
          if (entry.runtimeStatus === "completed" && previous?.failureAt
            && Date.parse(entry.updatedAt) <= previous.failureAt) {
            entry.runtimeStatus = "failed";
            entry.failureAt = previous.failureAt;
            entry.updatedAt = previous.updatedAt;
          }
          entries.set(entry.threadId, entry);
        }
        cursor = page.nextCursor || null;
        if (cursor && cursors.has(cursor) || entries.size > (host.relationRoot ? 1600 : 10_000)) throw new Error("Incomplete remote catalog");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      // A notification received while paging is newer than the requested snapshot.
      for (const [id, update] of host.updates) {
        if (update.at < startedAt) continue;
        if (update.archived) entries.delete(id);
        else if (entries.has(id)) Object.assign(entries.get(id), update.fields);
        else if (update.entry && (!host.relationRoot || update.entry.parentThreadId === host.relationRoot
          || entries.has(update.entry.parentThreadId))) entries.set(id, { ...update.entry, ...update.fields });
      }
      host.entries = entries;
      if (host.relationRoot) for (const id of entries.keys()) host.relationThreadIds.add(id);
      for (const id of host.admitted) if (!entries.has(id)) host.admitted.delete(id);
      host.updates.clear();
      host.available = true;
      host.failures = 0;
      host.lastFailure = null;
      host.lastChunkFailure = null;
      host.lastSuccessAt = now();
      host.nextRefreshAt = now() + (host.relationRoot ? localRelationRefreshIntervalMs
        : host === localHost ? localRefreshIntervalMs : refreshIntervalMs);
    } catch (error) {
      if (disposed || host.generation !== generation) return;
      host.available = false;
      host.failures++;
      // Fixed categories only; never retain native error text, task data or paths.
      host.lastFailure = ["timeout", "send", "remote"].includes(error?.code) ? error.code
        : error?.message === "Incomplete remote catalog" ? "incomplete" : "invalid";
      host.nextRefreshAt = now() + Math.min(maxRetryMs, retryBaseMs * 2 ** Math.min(host.failures - 1, 8));
    } finally {
      if (!disposed && host.generation === generation) {
        host.refreshing = false;
        onChange();
      }
    }
  }

  function clearLocalRelationTimer() {
    if (localRelationTimer !== null) clearRelationTimer(localRelationTimer);
    localRelationTimer = null;
  }

  function scheduleLocalRelationRefresh() {
    clearLocalRelationTimer();
    if (!active || disposed || !includeLocal || !localRelationHosts.size) return;
    const due = [...localRelationHosts.values()].filter(host => !host.refreshing
      && ["unknown", "connected"].includes(host.connectionState)).map(host => host.nextRefreshAt);
    if (!due.length) return;
    localRelationTimer = setRelationTimer(() => {
      localRelationTimer = null;
      void refreshLocalRelations();
    }, Math.max(1, Math.min(...due) - now()));
    localRelationTimer?.unref?.();
  }

  function refreshLocalRelations() {
    if (!active || !includeLocal || disposed) return Promise.resolve();
    if (localRelationRefreshWork) return localRelationRefreshWork;
    localRelationRefreshWork = (async () => {
      await Promise.resolve(); // Coalesce same-turn root changes before taking a snapshot.
      do {
        localRelationRootsChanged = false;
        const roots = [...localRelationHosts.values()];
        // Leave transport room for ordinary local and remote requests and their chunks.
        for (let offset = 0; offset < roots.length; offset += 4) await Promise.allSettled(
          roots.slice(offset, offset + 4).filter(host => localRelationHosts.get(host.relationRoot) === host).map(refreshHost));
      } while (!disposed && localRelationRootsChanged);
    })().finally(() => {
      localRelationRefreshWork = null;
      if (!disposed && localRelationRootsChanged) void refreshLocalRelations();
      else scheduleLocalRelationRefresh();
    });
    return localRelationRefreshWork;
  }

  function setLocalRelationRoots(ids) {
    if (disposed || !includeLocal) return;
    const roots = new Set([...new Set((Array.isArray(ids) ? ids : []).slice(0, 4096).map(uuid).filter(Boolean))].slice(0, 16));
    let changed = false;
    for (const [id, host] of localRelationHosts) if (!roots.has(id)) {
      cancelHost(host); localRelationHosts.delete(id); changed = true;
    }
    for (const id of roots) if (!localRelationHosts.has(id)) {
      localRelationHosts.set(id, { ...newHost("local"), relationRoot: id, relationThreadIds: new Set(), connectionState: localHost.connectionState });
      changed = true;
    }
    if (changed) { clearLocalRelationTimer(); localRelationRootsChanged = true; onChange(); void refreshLocalRelations(); }
  }

  async function refresh() {
    if (!active || disposed || !bridge?.getSharedObjectSnapshotValue) return;
    const configs = connections.flatMap((key) => bridge.getSharedObjectSnapshotValue(key) || []);
    const known = new Set();
    const work = includeLocal ? [refreshHost(localHost), refreshLocalRelations()] : [];
    for (const config of configs) {
      if (!remote(config.hostId)) continue;
      known.add(config.hostId);
      let host = hosts.get(config.hostId);
      if (!host) {
        host = newHost(config.hostId);
        // Native sidebar bootstrap contains metadata only. It is a stale fallback,
        // admitted by the same project filter and never treated as a live scan.
        for (const item of initialCatalog.filter(item => item.hostId === config.hostId)) {
          const task = normalize({ id: item.threadId, name: item.displayTitle, cwd: item.cwd,
            updatedAt: item.sourceUpdatedAt, createdAt: item.sourceCreatedAt }, host);
          if (task) host.entries.set(task.threadId, task);
        }
        for (const task of initialTasks.filter(task => task.hostId === config.hostId)) {
          host.entries.set(task.threadId, { ...task });
          host.admitted.add(task.threadId);
        }
        hosts.set(config.hostId, host);
      }
      host.displayName = text(config.displayName) || "远程设备";
      const blocked = config.autoConnect === false ? "paused" : config.online === false ? "offline" : null;
      if (blocked) {
        if (host.blockedByConfig !== blocked) cancelHost(host);
        host.blockedByConfig = blocked;
        continue;
      }
      if (host.blockedByConfig) {
        host.blockedByConfig = null;
        host.nextRefreshAt = 0;
      }
      work.push(refreshHost(host));
    }
    initialTasks = [];
    initialCatalog = [];
    for (const [id, host] of hosts) if (!known.has(id)) { cancelHost(host); hosts.delete(id); }
    onChange();
    await Promise.allSettled(work);
  }

  function handleMessage(message) {
    if (disposed || !message || typeof message !== "object") return;
    if (message.marker === "codex-host-chunked-message-v1") { receiveChunk(message); return; }
    if (message.type === "mcp-response") {
      const waiter = pending.get(message.message?.id);
      if (!waiter || waiter.hostId !== message.hostId) return;
      pending.delete(message.message.id);
      clearTimeout(waiter.timer);
      if (message.message.error) waiter.reject(failure("remote"));
      else waiter.resolve(message.message.result);
      return;
    }
    const host = message.hostId === "local" ? includeLocal ? localHost : null : hosts.get(message.hostId);
    if (!host) return;
    if (message.type === "codex-app-server-connection-changed") {
      if (!["connected", "connecting", "disconnected", "error"].includes(message.state)) return;
      for (const target of host === localHost ? [localHost, ...localRelationHosts.values()] : [host]) {
        const previous = target.connectionState;
        target.connectionState = message.state;
        if (message.state !== "connected") {
          if (previous !== message.state || target.refreshing) cancelHost(target);
        } else if (previous !== "connected") {
          target.nextRefreshAt = 0;
          target.failures = 0;
          if (!target.relationRoot) void refreshHost(target);
        }
      }
      if (host === localHost && message.state === "connected") {
        localRelationRootsChanged = true; void refreshLocalRelations();
      } else if (host === localHost) scheduleLocalRelationRefresh();
      onChange();
      return;
    }
    if (message.type !== "mcp-notification") return;
    if (host.hostId === "local" && !["unknown", "connected"].includes(host.connectionState)) return;
    const id = message.params?.threadId || message.params?.thread?.id;
    const parent = uuid(message.params?.thread?.parentThreadId);
    // Stream chunks are not task state changes. Only applied metadata updates
    // may repaint consumers; identical status notifications are also no-ops.
    let changed = false;
    if (host !== localHost || host.entries.has(id) || !parent) changed = applyNotification(host, message) || changed;
    if (host === localHost) for (const relationHost of localRelationHosts.values()) {
      const belongs = relationHost.entries.has(id) || parent === relationHost.relationRoot
        || parent && relationHost.entries.has(parent);
      if (belongs || relationHost.refreshing) changed = applyNotification(relationHost, message, !belongs) || changed;
    }
    if (changed) onChange({ relationsChanged: host === localHost
      && ['thread/started', 'thread/archived', 'thread/name/updated', 'turn/completed'].includes(message.method) });
  }

  function applyNotification(host, message, deferNewEntry = false) {
    const { method, params } = message;
    const id = params?.threadId || params?.thread?.id;
    if (!id) return;
    const fields = {};
    const update = { at: now(), fields };
    if (method === "thread/archived") {
      update.archived = true;
      host.entries.delete(id);
      host.admitted.delete(id);
    } else if (method === "thread/started") {
      update.entry = normalize(params.thread, host);
      if (update.entry) {
        if (host.relationRoot) update.entry.stateObservedAt = now();
        if (!deferNewEntry) {
          if (host.relationRoot) host.relationThreadIds.add(id);
          host.entries.set(id, update.entry);
        }
      }
    } else if (method === "thread/status/changed") {
      fields.runtimeStatus = runtimeStatus(params.status);
      fields.waitingReason = waitingReason(params.status);
      if (fields.runtimeStatus !== "completed") { fields.hasFinalResponse = false; fields.finalAt = null; }
      if (fields.runtimeStatus === "completed" && host.entries.get(id)?.failureAt) return;
      if (fields.runtimeStatus === host.entries.get(id)?.runtimeStatus
        && fields.waitingReason === host.entries.get(id)?.waitingReason) return;
    } else if (method === "turn/started") {
      fields.runtimeStatus = "running";
      fields.waitingReason = null;
      fields.hasFinalResponse = false;
      fields.finalAt = null;
    } else if (method === "turn/completed") {
      fields.runtimeStatus = ["failed", "interrupted"].includes(params.turn?.status) ? "failed" : "completed";
      fields.waitingReason = null;
      fields.hasFinalResponse = params.turn?.status === "completed";
      fields.finalAt = fields.hasFinalResponse ? now() : null;
    } else if (method === "thread/name/updated") {
      fields.title = text(params.threadName || params.name);
    } else return;
    if (fields.runtimeStatus === "failed") fields.failureAt = now();
    else if (fields.runtimeStatus) fields.failureAt = null;
    if (host.relationRoot && fields.runtimeStatus) fields.stateObservedAt = now();
    if (method !== "thread/name/updated") fields.updatedAt = timestamp(now());
    if (host.entries.has(id)) Object.assign(host.entries.get(id), fields);
    host.updates.set(id, update);
    return true;
  }

  function snapshot() {
    const projects = getProjects();
    return [...hosts.values()].flatMap((host) => [...host.entries.values()].flatMap((entry) => {
      const project = projects.find((p) => p.id === entry.projectId && (!p.hostId || p.hostId === host.hostId))
        || projects.find((p) => p.hostId === host.hostId && p.threadIds?.includes(entry.threadId))
        || projects.find((p) => p.hostId === host.hostId && p.path === entry.workspacePath);
      const status = host.available ? entry.runtimeStatus : "unknown";
      // The workstation follows projects the user actually added to this desktop.
      // An unassigned old remote session is not a newly admitted task.
      if (project || entry.runtimeStatus === "running") host.admitted.add(entry.threadId);
      if (!host.admitted.has(entry.threadId)) return [];
      return [{ ...entry, hostName: host.displayName, runtimeStatus: status,
        waitingReason: host.available ? readAttention(host.hostId, entry.threadId) || entry.waitingReason : null,
        projectId: project?.id || entry.projectId || "__unassigned__",
        projectName: project?.name || "未归入项目", statusAvailable: host.available,
        progress: status === "running" ? "Codex 正在执行…" : status === "failed" ? "执行中断"
          : status === "unknown" ? "远程状态待同步" : "等待查看任务结果",
      }];
    }));
  }

  function setActive(value) {
    if (disposed || active === Boolean(value)) return;
    active = Boolean(value);
    clearLocalRelationTimer();
    for (const host of [localHost, ...hosts.values(), ...localRelationHosts.values()]) {
      if (!active) cancelHost(host);
      else host.nextRefreshAt = 0;
    }
    if (active) void refresh();
  }

  function dispose() {
    disposed = true;
    clearLocalRelationTimer();
    knownLocalThreads.clear(); localRelationHosts.clear();
    transfers.clear();
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.controller.abort();
      waiter.reject(new Error("Remote catalog disposed"));
    }
    pending.clear();
  }
  function syncState() {
    return [...hosts.values()].filter(host => !host.available)
      .map(host => ({ hostId: host.hostId, hostName: host.displayName, loading: host.refreshing === true,
        hasSnapshot: host.lastSuccessAt !== null || host.entries.size > 0,
        phase: host.blockedByConfig || (host.connectionState === "connecting" ? "connecting"
          : ["error", "disconnected"].includes(host.connectionState) ? "disconnected"
            : host.failures ? "retrying" : "loading"),
      }));
  }
  function localStatusFields(entry) {
    // idle/notLoaded only mean inactive. Successful turn completion is separate
    // evidence and must not be manufactured from a catalog snapshot.
    const hasFinalResponse = entry.runtimeStatus === "completed" && entry.hasFinalResponse === true
      && Number.isFinite(entry.finalAt);
    return { runtimeStatus: entry.runtimeStatus, waitingReason: entry.waitingReason,
      hasFinalResponse, finalAt: hasFinalResponse ? entry.finalAt : null };
  }
  function localStatus(threadId) {
    if (disposed) return null;
    const related = [...localRelationHosts.values()].filter(host => host.relationThreadIds.has(threadId));
    if (related.length) {
      const fresh = related.filter(host => host.available && host.entries.has(threadId)
        && now() - Math.max(host.lastSuccessAt ?? 0, host.entries.get(threadId).stateObservedAt || 0) < localRelationRefreshIntervalMs)
        .sort((a, b) => Math.max(b.lastSuccessAt ?? 0, b.entries.get(threadId).stateObservedAt || 0)
          - Math.max(a.lastSuccessAt ?? 0, a.entries.get(threadId).stateObservedAt || 0));
      const entry = fresh[0]?.entries.get(threadId);
      return entry ? localStatusFields(entry) : null;
    }
    const entry = localHost.entries.get(threadId);
    return localHost.available && entry ? localStatusFields(entry) : null;
  }
  function hasLocalThread(threadId) {
    const id = uuid(threadId);
    return !disposed && Boolean(id) && (knownLocalThreads.has(id) || localHost.entries.has(id)
      || [...localRelationHosts.values()].some(host => host.relationThreadIds.has(id)));
  }
  function diagnostics() {
    return [...hosts.values(), ...localRelationHosts.values()].map(host => ({ hostId: host.hostId,
      ...(host.relationRoot ? { scope: "local-relations", rootThreadId: host.relationRoot,
        ageMs: host.lastSuccessAt === null ? null : Math.max(0, now() - host.lastSuccessAt) } : {}), connectionState: host.connectionState,
      available: host.available, refreshing: host.refreshing, failures: host.failures,
      lastFailure: host.lastFailure, lastChunkFailure: host.lastChunkFailure,
      pagesRead: host.pagesRead, lastSuccessAt: host.lastSuccessAt,
      nextRefreshAt: host.nextRefreshAt, pendingRequests: [...pending.values()].filter(p => p.owner === host).length,
    }));
  }
  return { refresh, setActive, handleMessage, snapshot, syncState, localStatus, hasLocalThread, setLocalRelationRoots, diagnostics, dispose };
}
