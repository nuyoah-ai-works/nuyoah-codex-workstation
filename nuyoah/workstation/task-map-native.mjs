// Kept self-contained: the injector serializes this factory into the renderer.
// Native contracts were inspected in the installed desktop bundle on 2026-09-22.
export function createNativeTaskMapAdapter({ window: hostWindow, loadModule } = {}) {
  const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
  const clean = (value, limit = 160) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const dispose = value => { try { value?.[Symbol.dispose]?.(); } catch {} };
  const fail = (code, outcome = 'failed', child = null) => Object.assign(new Error({
    invalid_target: '请选择本机任务。', invalid_message: '请填写要发送的内容。',
    unavailable: '任务连接暂时不可用，请稍后重试。', missing: '这个任务暂时无法读取。',
    incompatible: '当前版本暂不支持这个操作。', settings_unavailable: '任务设置暂时无法读取。',
    rejected: '操作未被接受，请检查任务状态。', unknown: '操作结果尚未确认，请先查看任务，避免重复发送。',
    first_turn_failed: '任务已创建，但首条消息未发送。',
  }[code] || '任务操作暂时无法完成。'), { code, outcome, definite: outcome === 'failed', unknown: outcome === 'unknown', ...(child ? { child } : {}) });
  function targetOf(value) {
    if (value?.hostId !== 'local' || !uuid(value?.threadId)) throw fail('invalid_target');
    return { hostId: 'local', threadId: value.threadId.toLowerCase(), title: clean(value.title) || '未命名任务' };
  }
  function messageOf(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 32000) throw fail('invalid_message');
    return value.trim();
  }
  async function call(client, method, ...args) {
    const pending = client[method](...args);
    try { return await pending; } finally { dispose(pending); }
  }
  function sourceOf(value) {
    try { return typeof value === 'function' ? Function.prototype.toString.call(value) : ''; } catch { return ''; }
  }
  function onlyFunction(module, includes) {
    const matches = Object.values(module).filter(value => {
      const source = sourceOf(value);
      return source && includes.every(part => source.includes(part));
    });
    return matches.length === 1 ? matches[0] : null;
  }
  function existingScope() {
    // Read an existing AppScope hook handle, never manufacture a second store.
    const stack = [hostWindow?.__codexRoot?._internalRoot?.current], seen = new Set();
    while (stack.length && seen.size < 12000) {
      const fiber = stack.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      let hook = fiber.memoizedState;
      for (let count = 0; hook && count < 150; count++, hook = hook.next) {
        const scope = hook.memoizedState?.current;
        if (scope?.scope?.__scopeBrand === 'AppScope' && typeof scope.get === 'function' && typeof scope.set === 'function') return scope;
      }
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child) stack.push(fiber.child);
    }
    throw fail('unavailable');
  }
  function localAsset(value, base) {
    const url = new URL(value, base);
    if (url.protocol !== 'app:' || url.hostname !== '-' || !/^\/assets\/[\w.-]+\.js$/.test(url.pathname)) throw fail('incompatible');
    return url.href;
  }
  async function sourceAt(url, limit) {
    const response = await hostWindow.fetch(url);
    if (!response.ok) throw fail('unavailable');
    const text = await response.text();
    if (text.length > limit) throw fail('incompatible');
    return text;
  }
  function exportedSelector(module, source, match) {
    if (!match) return null;
    const exports = source.slice(source.lastIndexOf('export{'));
    const name = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alias = exports.match(new RegExp('(?:\\{|,)' + name + ' as ([\\w$]+)(?:,|\\})'))?.[1];
    const selector = alias ? module[alias] : null;
    return selector && typeof selector.resolve === 'function' ? selector : null;
  }
  function chatInitializer(module, source) {
    const marker = source.indexOf('chatgpt-thread-list');
    const start = source.lastIndexOf('function ', marker);
    const name = start >= 0 ? source.slice(start, marker).match(/^function ([\w$]+)\(\)/)?.[1] : null;
    if (!name) return null;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alias = source.slice(source.lastIndexOf('export{')).match(new RegExp('(?:\\{|,)' + escaped + ' as ([\\w$]+)(?:,|\\})'))?.[1];
    return alias && typeof module[alias] === 'function' ? module[alias] : null;
  }
  function selectorExport(module, source, field) {
    // Resolve the exported native projection by its field, not a release-specific alias.
    return exportedSelector(module, source, source.match(new RegExp('(?:^|[,;])([\\w$]+)=[\\w$]+\\(\\(\\{' + field + ':([\\w$]+)\\}\\)=>\\2(?:\\?\\?null)?[,)]')));
  }
  let loaded;
  async function runtime(hostId = 'local') {
    if (!loaded) loaded = (async () => {
      const scripts = Array.from(hostWindow?.document?.scripts || []).map(script => script.src).filter(Boolean);
      let url = scripts.find(value => /\/app-initial-[\w-]+\.js$/.test(value));
      if (!url) {
        const entry = scripts.find(value => /^app:\/\/-\/assets\/index-[\w-]+\.js$/.test(value));
        if (!entry) throw fail('incompatible');
        const entrySource = await sourceAt(localAsset(entry), 1000000);
        const relative = entrySource.match(/["'`]([^"'`]*\/app-initial-[\w-]+\.js)["'`]/)?.[1];
        if (!relative) throw fail('incompatible');
        url = localAsset(relative, entry);
      }
      url = localAsset(url);
      const imported = loadModule ? await loadModule(url) : await import(url);
      const module = imported?.module || imported;
      const source = imported?.source ?? await sourceAt(url, 18000000);
      let getClient = onlyFunction(module, ['AppServerManager RPC is not connected', '.forHost(']);
      if (!getClient) {
        // Updated shells move the registered RPC accessor into app-shared.
        // Follow only this explicit local import; never scan unrelated bundles.
        const sharedImports = [...new Set([...source.matchAll(/from["'`]([^"'`]*\/app-shared-[\w-]+\.js)["'`]/g)].map(match => match[1]))];
        if (sharedImports.length === 1) {
          const sharedUrl = localAsset(sharedImports[0], url);
          const shared = loadModule ? await loadModule(sharedUrl) : await import(sharedUrl);
          getClient = onlyFunction(shared?.module || shared, ['AppServerManager RPC is not connected', '.forHost(']);
        }
      }
      const createThread = onlyFunction(module, ['preparePrimaryRuntimeForFirstTurn', 'readThreadCreationInputs', '.startConversation(']);
      const listChats = onlyFunction(module, ['Failed to list ChatGPT threads', 'pinnedThreads']);
      return { getClient, createThread, listChats,
        chatPins: exportedSelector(module, source, sourceOf(listChats).match(/\.query\.getOrFetch\(([\w$]+)\)/)),
        initializeChats: chatInitializer(module, source), permissions: selectorExport(module, source, 'currentPermissions'),
        collaborationMode: selectorExport(module, source, 'latestCollaborationMode'),
        workspaceKind: selectorExport(module, source, 'workspaceKind'),
        outputDirectory: selectorExport(module, source, 'projectlessOutputDirectory'),
        projectAssignments: exportedSelector(module, source, source.match(/(?:^|[,;])([\w$]+)=[\w$]+\([\w$]+,\(\{get:([\w$]+)\}\)=>[\w$]+\(\2,[\w$]+\.THREAD_PROJECT_ASSIGNMENTS\)\)/)) };
    })().catch(error => { loaded = null; throw error?.outcome ? error : fail('unavailable'); });
    const discovered = await loaded;
    const scope = existingScope();
    if (hostId === null) return { ...discovered, scope };
    if (!discovered.getClient) throw fail('incompatible');
    let client;
    try { client = discovered.getClient(scope, hostId); } catch { throw fail('unavailable'); }
    if (!client) throw fail('unavailable');
    return { ...discovered, scope, client };
  }
  async function metadata(client, target) {
    let response;
    try { response = await call(client, 'readThread', target.threadId, { includeTurns: false }); }
    catch { throw fail('missing'); }
    const thread = response?.thread;
    if (thread?.id?.toLowerCase() !== target.threadId || thread.ephemeral === true) throw fail('missing');
    return { title: clean(thread.name) || target.title, cwd: typeof thread.cwd === 'string' ? thread.cwd : null,
      running: thread.status?.type === 'active', parent: uuid(thread.parentThreadId) ? thread.parentThreadId.toLowerCase() : null };
  }
  async function latestResult(client, target) {
    // Only the latest completed turn is a result; never substitute an older result for an active turn.
    const turns = await call(client, 'sendRequest', 'thread/turns/list', {
      threadId: target.threadId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded',
    }, { timeoutMs: 12000 });
    const turn = turns?.data?.[0];
    if (turn?.status !== 'completed' || typeof turn.id !== 'string') return { text: null, truncated: false };
    const items = await call(client, 'sendRequest', 'thread/items/list', {
      threadId: target.threadId, turnId: turn.id, cursor: null, limit: 50, sortDirection: 'desc',
    }, { timeoutMs: 12000 });
    for (const record of (items?.data || []).slice(0, 50)) {
      if (record?.item && record.turnId !== turn.id) throw fail('missing');
      const item = record?.item || record;
      if (item?.type !== 'agentMessage' || (item.phase != null && item.phase !== 'final_answer')) continue;
      if (typeof item.text === 'string' && item.text.trim()) {
        const text = item.text.trim();
        return { text: text.slice(0, 12000), truncated: text.length > 12000 };
      }
    }
    return { text: null, truncated: false };
  }
  function mutationFailure(error, child = null) {
    if (error?.outcome) return error;
    const stage = error?.delivery?.stage;
    // A JSON-RPC error may be a later step of a submission that already took effect.
    const definite = stage === 'not-sent';
    return fail(definite ? 'rejected' : 'unknown', definite ? 'failed' : 'unknown', child);
  }
  async function inspect(value) {
    const target = targetOf(value);
    try {
      const native = await runtime(), info = await metadata(native.client, target);
      let result = { text: null, truncated: false }, resultAvailable = true;
      try { result = await latestResult(native.client, target); } catch { resultAvailable = false; }
      return { available: true, target: { ...target, title: info.title }, running: info.running,
        canSend: true, canCreate: !!(native.createThread && native.permissions && native.workspaceKind && native.projectAssignments && info.cwd), parent: info.parent,
        resultText: result.text, resultTruncated: result.truncated, resultAvailable };
    } catch (error) {
      return { available: false, target, running: false, canSend: false, canCreate: false,
        parent: null, resultText: null, resultTruncated: false, resultAvailable: false, error: error?.outcome ? error.message : fail('unavailable').message };
    }
  }
  async function send(value, text) {
    const target = targetOf(value), prompt = messageOf(text);
    const { client } = await runtime();
    await metadata(client, target);
    try {
      const turnId = await call(client, 'sendFollowUpMessage', target.threadId, { prompt });
      if (typeof turnId !== 'string' || !turnId) throw fail('unknown', 'unknown');
      return { target, turnId, status: 'sent' };
    } catch (error) { throw mutationFailure(error); }
  }
  async function create(value, { text, title } = {}) {
    const target = targetOf(value), prompt = messageOf(text), childTitle = clean(title) || '新任务';
    const native = await runtime(), { client } = native;
    const info = await metadata(client, target);
    if (!native.createThread || !native.permissions || !native.workspaceKind || !native.projectAssignments || !info.cwd) throw fail('incompatible');
    // Resume hydrates native settings without submitting a turn; never fork or copy history.
    let resumed;
    try { resumed = await call(client, 'resumeConversation', { conversationId: target.threadId,
      model: null, reasoningEffort: null, workspaceRoots: [info.cwd], collaborationMode: null }); }
    catch { throw fail('settings_unavailable'); }
    if (resumed?.status !== 'ready') throw fail('settings_unavailable');
    let execution;
    try { execution = await call(client, 'getThreadExecutionState', target.threadId); }
    catch { throw fail('settings_unavailable'); }
    let permissions, collaborationMode, workspaceKind, projectAssignment, outputDirectory;
    try {
      permissions = native.scope.get(native.permissions, target.threadId);
      collaborationMode = native.collaborationMode ? native.scope.get(native.collaborationMode, target.threadId) : null;
      workspaceKind = native.scope.get(native.workspaceKind, target.threadId);
      const assignments = native.scope.get(native.projectAssignments);
      if (assignments == null || !['project', 'projectless'].includes(workspaceKind)) throw fail('settings_unavailable');
      projectAssignment = assignments[target.threadId] ?? null;
      outputDirectory = native.outputDirectory ? native.scope.get(native.outputDirectory, target.threadId) : null;
    } catch { throw fail('settings_unavailable'); }
    if (!permissions?.sandboxPolicy || permissions.approvalPolicy == null || !execution?.latestModel) throw fail('settings_unavailable');
    const roots = permissions.runtimeWorkspaceRoots;
    if (!Array.isArray(roots) || !roots.length || roots.some(root => typeof root !== 'string')) throw fail('settings_unavailable');
    const params = { input: [{ type: 'text', text: prompt, text_elements: [] }], cwd: info.cwd,
      workspaceRoots: [...roots], workspaceKind, permissionsConfig: permissions,
      collaborationMode: collaborationMode?.settings?.model ? collaborationMode : { mode: 'default', settings: { model: execution.latestModel,
        reasoning_effort: execution.latestReasoningEffort ?? null, developer_instructions: null } },
      projectAssignment, ...(workspaceKind === 'projectless' && outputDirectory ? { projectlessOutputDirectory: outputDirectory } : {}),
      initialTitle: childTitle, skipAutoTitleGeneration: Boolean(clean(title)) };
    let result, child = null;
    try {
      result = await native.createThread(native.scope, 'local', params, {});
      if (result?.status === 'created' && uuid(result.conversationId)) child = { hostId: 'local', threadId: result.conversationId.toLowerCase(), title: childTitle };
      if (result?.status === 'outcome-unknown' || result?.firstTurn?.status === 'outcome-unknown') throw fail('unknown', 'unknown', child);
      if (!child) throw fail(result?.status === 'failed' ? 'rejected' : 'unknown', result?.status === 'failed' ? 'failed' : 'unknown');
      if (result.firstTurn?.status !== 'accepted') throw fail('first_turn_failed', 'failed', child);
      return { child, turnId: result.firstTurn.turnId || null, status: 'created' };
    } catch (error) { throw mutationFailure(error, child); }
  }
  async function listThreads(hostId, params, { signal, timeoutMs = 12000 } = {}) {
    if (hostId !== 'local') {
      const keys = ['remote_control_connections', 'remote_ssh_connections', 'remote_wsl_connections'];
      const known = keys.flatMap(key => hostWindow.electronBridge?.getSharedObjectSnapshotValue?.(key) || [])
        .some(config => config.hostId === hostId && config.autoConnect !== false && config.online !== false);
      if (!known) throw fail('unavailable');
    }
    if (signal?.aborted) throw fail('unavailable');
    const { client } = await runtime(hostId);
    if (signal?.aborted) throw fail('unavailable');
    const pending = client.sendRequest('thread/list', {
      archived: false, limit: 100, sortKey: 'updated_at', sortDirection: 'desc', useStateDbOnly: true,
      ...(typeof params?.cursor === 'string' ? { cursor: params.cursor } : {}),
      ...(uuid(params?.ancestorThreadId) && hostId === 'local' ? {
        ancestorThreadId: params.ancestorThreadId,
        sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview',
          'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'],
      } : {}),
    }, { timeoutMs: Number.isFinite(timeoutMs) ? Math.max(1, Math.min(60000, timeoutMs)) : 12000 });
    let rejectAbort;
    // The RPC handle disposal releases its result, not the underlying request.
    // Already-sent requests are bounded by the native timeout above.
    const abort = () => rejectAbort?.(fail('unavailable'));
    const cancelled = new Promise((_, reject) => { rejectAbort = reject; });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try { return await Promise.race([pending, cancelled]); }
    finally { signal?.removeEventListener('abort', abort); dispose(pending); }
  }
  async function listChatGptThreads() {
    const { scope, listChats, initializeChats, chatPins } = await runtime(null);
    if (!listChats || !initializeChats || !chatPins) throw fail('incompatible');
    // Native metadata query only; never call conversation read or copy snippets.
    initializeChats();
    const pins = await scope.query.getOrFetch(chatPins);
    if (!Array.isArray(pins) || pins.length > 100) throw fail('incompatible');
    // The native list helper adds pinned count to limit before its HTTP request.
    // The endpoint accepts at most 100 total, including those pinned slots.
    const result = await listChats({ scope, limit: 100 - pins.length, query: '' });
    if (result?.isUnavailable) throw fail('unavailable');
    if (!Array.isArray(result?.threads) || !Array.isArray(result?.pinnedThreads)) throw fail('incompatible');
    const pinned = new Set(result.pinnedThreads.map(item => item.id));
    return [...result.pinnedThreads, ...result.threads].slice(0, 200).filter(item => uuid(item?.id) && item.kind === 'chatgpt')
      .map(item => ({ id: item.id.toLowerCase(), title: clean(item.title) || '未命名聊天', status: item.status,
        updatedAt: item.updatedAt, pinned: pinned.has(item.id) }));
  }
  return { inspect, send, create, listThreads, listChatGptThreads };
}
