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
      const rpcGetter = candidate => onlyFunction(candidate, ['AppServerManager RPC is not connected', '.forHost('])
        || onlyFunction(candidate, ['AppServerManager RPC is unavailable for hostId:', '.forHost(']);
      let getClient = rpcGetter(module), sharedModule = module, sharedSource = source;
      if (!getClient) {
        // Updated shells move the registered RPC accessor into app-shared.
        // Follow only this explicit local import; never scan unrelated bundles.
        const sharedImports = [...new Set([...source.matchAll(/from["'`]([^"'`]*\/app-shared-[\w-]+\.js)["'`]/g)].map(match => match[1]))];
        if (sharedImports.length === 1) {
          const sharedUrl = localAsset(sharedImports[0], url);
          const shared = loadModule ? await loadModule(sharedUrl) : await import(sharedUrl);
          sharedModule = shared?.module || shared;
          sharedSource = shared?.source ?? await sourceAt(sharedUrl, 18000000);
          getClient = rpcGetter(sharedModule);
        }
      }
      const createThread = onlyFunction(module, ['preparePrimaryRuntimeForFirstTurn', 'readThreadCreationInputs', '.startConversation(']);
      const listChats = onlyFunction(module, ['Failed to list ChatGPT threads', 'pinnedThreads']);
      return { getClient, createThread, listChats, sharedModule, sharedSource,
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
  async function readTaskMetadata(value) {
    const target = targetOf(value), { client } = await runtime();
    const info = await metadata(client, target);
    return { hostId: target.hostId, threadId: target.threadId, cwd: info.cwd };
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
  function assertChatAccountReady(scope) {
    const queries = scope.queryClient?.getQueryCache?.()?.getAll?.();
    if (!Array.isArray(queries)) throw fail('incompatible');
    for (const query of queries) {
      const [kind, detail] = query.queryKey || [];
      const accountInput = kind === 'usage-settings' || kind === 'workspace-policy'
        || (kind === 'accounts' && ['check', 'settings'].includes(detail));
      // Inspect only active native account inputs. Historical/disabled account
      // errors must not block a different account; never refetch or clear them.
      if (!accountInput || query.isActive?.() !== true) continue;
      if (query.state?.status === 'error'
        || (query.state?.status === 'pending' && query.state?.data == null)) throw fail('settings_unavailable');
    }
  }
  async function listChatGptThreads() {
    const { scope, listChats, initializeChats, chatPins } = await runtime(null);
    if (!listChats || !initializeChats || !chatPins) throw fail('incompatible');
    assertChatAccountReady(scope);
    // Native metadata query only; never call conversation read or copy snippets.
    initializeChats();
    const pins = await scope.query.getOrFetch(chatPins);
    assertChatAccountReady(scope);
    if (!Array.isArray(pins) || pins.length > 100) throw fail('incompatible');
    // The native list helper adds pinned count to limit before its HTTP request.
    // The endpoint accepts at most 100 total, including those pinned slots.
    const result = await listChats({ scope, limit: 100 - pins.length, query: '' });
    assertChatAccountReady(scope);
    if (result?.isUnavailable) throw fail('unavailable');
    if (!Array.isArray(result?.threads) || !Array.isArray(result?.pinnedThreads)) throw fail('incompatible');
    const pinned = new Set(result.pinnedThreads.map(item => item.id));
    return [...result.pinnedThreads, ...result.threads].slice(0, 200).filter(item => uuid(item?.id) && item.kind === 'chatgpt')
      .map(item => ({ id: item.id.toLowerCase(), title: clean(item.title) || '未命名聊天', status: item.status,
        updatedAt: item.updatedAt, pinned: pinned.has(item.id) }));
  }
  async function metadataSession() {
    const { scope, client, sharedModule: module, sharedSource: source } = await runtime('local');
    const services = Object.values(module).filter(value => value && typeof value === 'object'
      && typeof value.threadMetadataGeneration?.generateTitle === 'function');
    const completed = exportedSelector(module, source, source.match(/([\w$]+)=[\w$]+\([^,]+,null,\{onMount:[\s\S]{0,400}?event:`turn-completed`/));
    const descriptionNames = source.match(/([\w$]+)=`thread-descriptions-v1`,([\w$]+)=[\w$]+\(\1,\{\}\)/);
    const getDescription = descriptionNames && onlyFunction(module, [`.get(${descriptionNames[2]})[`, '??null']);
    const setDescription = descriptionNames && onlyFunction(module, [`.set(${descriptionNames[2]},`, `${descriptionNames[1]},`]);
    if (services.length !== 1 || !completed || !getDescription || !setDescription || typeof scope.watch !== 'function') throw fail('incompatible');
    async function currentState(id) {
      let subscription, timer, resolve;
      const value = new Promise(done => { resolve = done; });
      const pending = client.subscribe({ type: 'thread', key: { hostId: 'local', threadId: id },
        field: 'listState', listener: state => resolve(state) });
      try {
        subscription = await pending;
        timer = hostWindow.setTimeout(() => resolve(null), 5000);
        return await value;
      } finally { if (timer) hostWindow.clearTimeout(timer); dispose(subscription); dispose(pending); }
    }
    async function read(id, turnId, includeText = false) {
      if (!uuid(id)) throw fail('invalid_target');
      let response;
      try { response = await call(client, 'readThread', id, { includeTurns: false }); }
      catch (error) { if (/thread (?:not loaded|not found)/i.test(String(error?.message))) return null; throw error; }
      const thread = response?.thread;
      if (!thread || thread.id !== id || thread.ephemeral || thread.parentThreadId || thread.status?.type !== 'idle') return null;
      if (thread.source && typeof thread.source === 'object' && thread.source.subAgent) return null;
      let state;
      try { state = await currentState(id); }
      catch (error) { if (/thread (?:not loaded|not found)/i.test(String(error?.message))) return null; throw error; }
      if (!state || state.ephemeral || state.sideConversation || state.isConversationInProgress
        || state.latestTurnId !== turnId || state.latestTurnStatus !== 'completed') return null;
      const result = { title: clean(thread.name, 160), description: clean(getDescription(scope, id), 100), turnId, user: '', assistant: '' };
      if (!includeText) return result;
      // The native reader projects bounded text only, excluding tool outputs,
      // reasoning and attachments. It works with both native history formats.
      const messages = await call(client, 'readRecentThreadMessages', id, { maxItems: 16, maxTextLength: 2000 });
      if (!Array.isArray(messages)) return null;
      for (const message of messages.slice(-16).reverse()) {
        if (message.role === 'user' && !result.user) result.user = String(message.text || '').slice(0, 2000);
        if (message.role === 'assistant' && !result.assistant) result.assistant = String(message.text || '').slice(0, 2000);
      }
      // Carry earlier user intent from the same already-bounded native projection.
      // No additional history read and no transcript persistence.
      const requests = messages.slice(-16).filter(message => message.role === 'user')
        .map(message => String(message.text || '').slice(0, 500)).filter(Boolean);
      result.recentRequests = requests.slice(0, -1).slice(-8);
      // Long turns can push the user message outside the small window. The old
      // description plus final response still suffice; do not scan older history.
      return result.assistant ? result : null;
    }
    return {
      subscribe(callback) {
        let first = true;
        return scope.watch(({ get }) => {
          const event = get(completed);
          if (first) { first = false; return; }
          if (event?.hostId === 'local') callback({ hostId: 'local', threadId: event.conversationId,
            turnId: event.turnId, status: event.status, hasPendingContinuation: event.hasPendingContinuation });
        });
      },
      read,
      async generate(prompt, { signal } = {}) {
        // The native metadata helper permits provider/model fallback. Keep its
        // ephemeral, read-only shape but explicitly forbid that costly fallback.
        const models = { model: 'gpt-6-luna', modelProvider: 'openai' };
        const config = { project_doc_max_bytes: 0, include_environment_context: false,
          include_permissions_instructions: false, include_apps_instructions: false,
          'features.hooks': false, 'features.apps': false, 'features.plugins': false,
          'features.multi_agent': false, 'features.multi_agent_v2': false,
          'features.enable_fanout': false, 'features.shell_tool': false,
          'features.unified_exec': false, 'features.shell_snapshot': false,
          'features.apply_patch_freeform': false, 'features.js_repl': false,
          'features.js_repl_tools_only': false, 'features.code_mode': false,
          'features.code_mode_only': false, 'features.tool_suggest': false,
          web_search: 'disabled', memories: { use_memories: false, generate_memories: false },
          skills: { bundled: { enabled: false }, config: [] },
        };
        const servers = await call(client, 'sendRequest', 'mcpServerStatus/list', { limit: 100 });
        if (!Array.isArray(servers?.data) || servers.nextCursor) throw fail('incompatible');
        const configured = await call(client, 'sendRequest', 'config/read', { includeLayers: false });
        const configuredServers = configured?.config?.mcp_servers || {};
        const names = new Set([...Object.keys(configuredServers), ...servers.data.map(server => server.name)]);
        for (const name of names) {
          if (typeof name !== 'string' || !/^[\w-]+$/.test(name)) throw fail('incompatible');
          // Existing transports must remain structurally valid. Runtime-only
          // app servers have no config transport, so use the native disabled stub.
          config[`mcp_servers.${name}`] = Object.hasOwn(configuredServers, name)
            ? { enabled: false } : { enabled: false, command: '' };
        }
        signal?.throwIfAborted();
        const created = await call(client, 'sendRequest', 'thread/start', {
          ...models, allowProviderModelFallback: false, serviceTier: null, cwd: null,
          approvalPolicy: 'never', permissions: ':read-only', runtimeWorkspaceRoots: [],
          config, baseInstructions: 'Only return the requested JSON metadata. Make zero tool calls.',
          developerInstructions: '', ephemeral: true, threadSource: 'conversation_digest', dynamicTools: [],
        });
        const id = created?.thread?.id;
        if (!uuid(id)) throw fail('unavailable');
        let subscription, pendingSubscription, turnId, done = false, output = '', timeout;
        let resolveDone, rejectDone;
        const finished = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
        // Avoid an unhandled rejection if cancellation happens before turn/start returns.
        finished.catch(() => {});
        const abort = () => rejectDone(new Error('Metadata generation canceled'));
        signal?.addEventListener('abort', abort, { once: true });
        try {
          if (created.model !== models.model || created.modelProvider !== models.modelProvider || created.thread.ephemeral !== true) throw fail('incompatible');
          signal?.throwIfAborted();
          pendingSubscription = client.subscribe({ type: 'notification', key: { hostId: 'local' },
            methods: ['item/agentMessage/delta', 'item/completed', 'turn/completed'], listener: event => {
              if (event.params?.threadId !== id) return;
              if (event.method === 'item/agentMessage/delta') output = (output + String(event.params.delta || '')).slice(0, 4000);
              if (event.method === 'item/completed' && event.params.item?.type === 'agentMessage') output = String(event.params.item.text || '').slice(0, 4000);
              if (event.method === 'turn/completed') {
                done = true;
                event.params.turn?.status === 'completed' ? resolveDone(output) : rejectDone(new Error('Metadata generation failed'));
              }
            },
          });
          subscription = await pendingSubscription;
          const started = await call(client, 'sendRequest', 'turn/start', { threadId: id,
            input: [{ type: 'text', text: prompt, text_elements: [] }], model: models.model, effort: 'low',
            outputSchema: { type: 'object', properties: { title: { type: 'string', maxLength: 36 },
              description: { type: 'string', maxLength: 100 } }, required: ['title', 'description'], additionalProperties: false },
          });
          turnId = started?.turn?.id;
          timeout = hostWindow.setTimeout(() => rejectDone(new Error('Metadata generation timed out')), 35000);
          const text = await finished;
          signal?.throwIfAborted();
          if (!text.trim()) throw fail('unavailable');
          return JSON.parse(text);
        } finally {
          if (timeout) hostWindow.clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
          dispose(subscription); dispose(pendingSubscription);
          if (!done && turnId) await call(client, 'sendRequest', 'turn/interrupt', { threadId: id, turnId }).catch(() => {});
          await call(client, 'sendRequest', 'thread/unsubscribe', { threadId: id }).catch(() => {});
        }
      },
      async rename(id, title, expectedTitle) {
        return call(client, 'setThreadTitle', id, title, { expectedTitle, requireAcknowledgement: true });
      },
      setDescription: (id, text) => setDescription(scope, id, text),
    };
  }
  return { inspect, readTaskMetadata, send, create, listThreads, listChatGptThreads, metadataSession };
}
