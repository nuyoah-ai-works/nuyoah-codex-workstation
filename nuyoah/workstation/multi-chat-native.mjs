// Serialized into the renderer. Reuses the installed host's React and scopes.
export function createNativeMultiChatAdapter({ window: host, loadModule } = {}) {
  const error = () => new Error('当前版本暂时无法打开四宫格，请继续使用单聊。');
  const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
  const draft = value => typeof value === 'string' && value.startsWith('client-new-thread:') && uuid(value.slice(18));
  const directory = value => typeof value === 'string' && value.length < 4096 && !/[\0\r\n]/.test(value)
    && (value.startsWith('/') || /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]+\\/.test(value));
  let modules;
  let pageType;
  let lastFailure = null;
  function hostInfo(hostId) {
    if (hostId === 'local') return { known: true, available: true, name: '本机' };
    if (typeof hostId !== 'string' || !hostId || hostId.length >= 512 || /[\0\r\n]/.test(hostId)) return { known: false, available: false };
    const config = ['remote_control_connections', 'remote_ssh_connections', 'remote_wsl_connections']
      .flatMap(key => host.electronBridge?.getSharedObjectSnapshotValue?.(key) || []).find(config => config.hostId === hostId);
    return { known: Boolean(config), available: Boolean(config && config.autoConnect !== false && config.online !== false),
      name: String(config?.displayName || config?.name || '远程设备').slice(0, 100) };
  }
  function unavailable() { const cause = error(); cause.code = 'remote_unavailable'; return cause; }
  function asset(value, base) {
    const url = new URL(value, base);
    if (url.protocol !== 'app:' || url.hostname !== '-' || !/^\/assets\/[\w.-]+\.js$/.test(url.pathname)) throw error();
    return url.href;
  }
  async function source(url, limit = 16000000) {
    const response = await host.fetch(url);
    if (!response.ok) throw error();
    const text = await response.text();
    if (text.length > limit) throw error();
    return text;
  }
  function alias(text, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.slice(text.lastIndexOf('export{')).match(new RegExp('(?:\\{|,)' + escaped + ' as ([\\w$]+)(?=[,}])'))?.[1];
  }
  function libraryAlias(text, marker) {
    const index = text.indexOf(marker);
    if (index < 0) throw error();
    const imports = text.match(/import\{([^}]+)\}from["'][^"']*rolldown-runtime[^"']*["']/)?.[1];
    const helper = imports?.match(/(?:^|,)t as ([\w$]+)(?:,|$)/)?.[1];
    if (!helper) throw error();
    const escaped = helper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('([\\w$]+)=' + escaped + '\\(\\(', 'g');
    const declarations = [...text.slice(0, index).matchAll(pattern)];
    const name = declarations.at(-1)?.[1];
    if (!name) throw error();
    const direct = alias(text, name);
    if (direct) return direct;
    const call = text.indexOf('exports=' + name + '()', index);
    if (call < 0) throw error();
    const outer = [...text.slice(0, call).matchAll(pattern)].at(-1)?.[1];
    const exported = outer && alias(text, outer);
    if (!exported) throw error();
    return exported;
  }
  async function runtime() {
    if (!modules) modules = (async () => {
      const scripts = Array.from(host.document.scripts).map(script => script.src).filter(Boolean);
      let entry = scripts.find(url => /\/app-initial-[\w-]+\.js$/.test(url));
      if (!entry) {
        const index = scripts.find(url => /^app:\/\/-\/assets\/index-[\w-]+\.js$/.test(url));
        if (!index) throw error();
        const text = await source(asset(index), 1000000);
        const relative = text.match(/["'`]([^"'`]*\/app-initial-[\w-]+\.js)["'`]/)?.[1];
        if (!relative) throw error();
        entry = asset(relative, index);
      }
      const text = await source(asset(entry));
      const sharedPath = text.match(/from["'`]([^"'`]*\/app-shared-[\w-]+\.js)["'`]/)?.[1];
      if (!sharedPath) throw error();
      const sharedUrl = asset(sharedPath, entry), sharedText = await source(sharedUrl);
      const shared = loadModule ? await loadModule(sharedUrl) : await import(sharedUrl);
      const React = shared[libraryAlias(sharedText, '.createElement=function')]?.();
      const ReactDOM = shared[libraryAlias(sharedText, '.createRoot=function')]?.();
      if (!React?.createElement || !ReactDOM?.createRoot) throw error();
      const hooks = Object.values(shared).filter(value => {
        let text; try { text = typeof value === 'function' ? Function.prototype.toString.call(value) : ''; } catch { return false; }
        return text.includes('getOwnValue') && text.includes('Missing query client') && text.includes('useRef');
      });
      if (hooks.length !== 1) throw error();
      const paths = [...new Set([...text.matchAll(/["'`]([^"'`]*\/local-conversation-page-[\w-]+\.js)["'`]/g)].map(match => match[1]))];
      let Page;
      for (const relative of paths.slice(0, 3)) {
        const url = asset(relative, entry), pageText = await source(url, 100000);
        if (!/as LocalConversationPage[},]/.test(pageText)) continue;
        const page = loadModule ? await loadModule(url) : await import(url);
        Page = page.LocalConversationPage;
        if (typeof Page === 'function') break;
      }
      if (!Page) throw error();
      pageType = Page;
      const services = Object.values(shared).filter(value => value && typeof value === 'object'
        && typeof value.threadProjectAssignments?.setAssignment === 'function');
      return { React, ReactDOM, Page, useScope: hooks[0], projectAssignments: services.length === 1 ? services[0].threadProjectAssignments : null };
    })().catch(() => { modules = null; throw error(); });
    return modules;
  }
  function capture(discoverComposer = false) {
    const area = Array.from(host.document.querySelectorAll?.('[data-app-shell-main-content-layout]') || [])
      .find(node => { const r = node.getBoundingClientRect(); return r.width > 100 && r.height > 100 && !node.closest('#nuyoah-chat-grid, [hidden]'); });
    const visible = node => {
      const r = node.getBoundingClientRect?.();
      if (!r || r.width <= 0 || r.height <= 0 || node.closest('[hidden]')) return false;
      for (let parent = node; parent && parent !== area; parent = parent.parentElement) {
        if (parent.getAttribute?.('aria-hidden') === 'true' && !parent.hasAttribute?.('data-nuyoah-chat-source-hidden')) return false;
        if (host.getComputedStyle && !parent.hasAttribute?.('data-nuyoah-chat-source-hidden')) {
          const style = host.getComputedStyle(parent);
          if (style.visibility !== 'visible' || style.opacity === '0') return false;
        }
      }
      return true;
    };
    const isPage = fiber => {
      if (pageType && (fiber?.type === pageType || fiber?.type?.type === pageType)) return true;
      if (typeof fiber?.type !== 'function') return false;
      let text; try { text = Function.prototype.toString.call(fiber.type); } catch { return false; }
      return text.includes('renderComposer') && text.includes('showComposer') && text.includes('onNewChat') && !text.includes('conversationId');
    };
    const stack = [host.__codexRoot?._internalRoot?.current], seen = new Set();
    let page;
    let dom = Array.from(area?.querySelectorAll('[contenteditable="true"], [data-app-action-timeline-scroll]') || []).find(visible);
    while (dom && !page) {
      const key = Object.keys(dom).find(key => key.startsWith('__reactFiber'));
      let candidate = key && dom[key];
      if (candidate) {
        const rootOf = fiber => { while (fiber?.return) fiber = fiber.return; return fiber; };
        const root = rootOf(candidate), current = root?.stateNode?.current;
        if (current && root !== current && candidate.alternate && rootOf(candidate.alternate) === current) candidate = candidate.alternate;
        for (let fiber = candidate; fiber; fiber = fiber.return) if (isPage(fiber)) { page = fiber; break; }
      }
      dom = dom.parentElement;
    }
    while (!page && stack.length && seen.size < 20000) {
      const fiber = stack.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      if (isPage(fiber)) {
          let ancestor = fiber.return;
          while (ancestor && ancestor.memoizedProps?.scope?.__scopeBrand !== 'RouteScope') ancestor = ancestor.return;
          if (['local-thread', 'client-local-thread'].includes(ancestor?.memoizedProps?.value?.routeKind)) {
            let node = fiber.child;
            const children = [node];
            while (children.length) {
              node = children.pop(); if (!node) continue;
              if (node.tag === 5 && node.stateNode && (!area || area.contains(node.stateNode)) && visible(node.stateNode)) { page = fiber; break; }
              if (node.child) children.push(node.child); if (node.sibling) children.push(node.sibling);
            }
            if (page) break;
          }
      }
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child) stack.push(fiber.child);
    }
    if (!page) throw error();
    const scopes = new Map(), providers = [];
    let wrapper;
    let outer = false;
    for (let fiber = page.return, depth = 0; fiber && depth < 400; fiber = fiber.return, depth++) {
      const props = fiber.memoizedProps || {}, brand = props.scope?.__scopeBrand;
      if (!wrapper && typeof fiber.type === 'function' && typeof props.route?.routeKind === 'string') {
        let text; try { text = Function.prototype.toString.call(fiber.type); } catch { text = ''; }
        if (text.includes('initialWorkspacePrimarySurface') && text.includes('routeConversationId') && text.includes('clientThreadId')) wrapper = fiber.type;
      }
      if (['ComposerScope', 'RouteScope', 'ThreadScope'].includes(brand) && !scopes.has(brand)) {
        scopes.set(brand, { type: fiber.type, scope: props.scope, value: props.value });
        if (brand === 'ThreadScope') outer = true;
      } else if (outer && fiber.tag === 10) {
        providers.push({ type: fiber.type, value: props.value });
      }
    }
    const route = scopes.get('RouteScope')?.value;
    if (!wrapper || scopes.size !== 3 || !(uuid(route?.conversationId) || draft(route?.clientThreadId))
      || !hostInfo(scopes.get('RouteScope').value.hostId || 'local').known) throw error();
    // The native timeline composer waits for an existing server task. New panes
    // use the host's first-turn composer instead, including its project picker.
    const composers = new Set(), children = discoverComposer ? [page.child] : [], visited = new Set();
    let modelCatalog = null;
    while (children.length && visited.size < 20000) {
      const fiber = children.pop(); if (!fiber || visited.has(fiber)) continue;
      visited.add(fiber);
      if (typeof fiber.type === 'function') {
        const text = Function.prototype.toString.call(fiber.type);
        if (text.length < 2000 && text.includes('useAsbDirect===!0')) composers.add(fiber.type);
      }
      const props = fiber.memoizedProps;
      if (Array.isArray(props?.models) && Array.isArray(props?.modelOptions) && typeof props.onSelectModel === 'function') {
        modelCatalog = { model: props.model, effort: props.reasoningEffort,
          models: props.models.filter(m => typeof m.model === 'string' && !m.hidden).map(m => ({
            id: m.model, name: String(m.displayName || m.model),
            efforts: (m.supportedReasoningEfforts || []).map(e => e.reasoningEffort).filter(e => typeof e === 'string'),
            defaultEffort: m.defaultReasoningEffort,
            disabled: props.modelOptions.find(o => o.model?.model === m.model)?.disabledReason != null,
          })) };
      }
      if (fiber.child) children.push(fiber.child); if (fiber.sibling) children.push(fiber.sibling);
    }
    return { scopes, providers, wrapper, route: scopes.get('RouteScope').value,
      NewComposer: composers.size === 1 ? [...composers][0] : null, modelCatalog };
  }
  function current() {
    try { const { route } = capture(); return { hostId: route.hostId || 'local', ...(uuid(route.conversationId)
      ? { threadId: route.conversationId } : { clientThreadId: route.clientThreadId }) }; }
    catch { return null; }
  }
  function newTarget() { return { hostId: 'local', clientThreadId: 'client-new-thread:' + host.crypto.randomUUID(), title: '新会话' }; }
  async function readTaskMetadata(target) {
    if (target?.hostId !== 'local' || !uuid(target.threadId)) throw error();
    const read = host.__nuyoahNativeTaskAdapter__?.readTaskMetadata;
    if (typeof read !== 'function') throw error();
    return read(target);
  }
  function importedFolders() {
    const folders = new Map(), rows = Array.from(host.document.querySelectorAll?.('[data-app-action-sidebar-project-row]') || []);
    const add = (projectId, name, paths, hostId = 'local') => {
      const cwd = (Array.isArray(paths) ? paths : []).find(directory);
      if (typeof projectId !== 'string' || !projectId || projectId.length > 512 || !cwd || !hostInfo(hostId).known) return;
      folders.set(hostId + ':' + projectId, { projectId, name: String(name || cwd.split(/[\\/]/).pop()).slice(0, 180), cwd, hostId });
    };
    const bootstrap = host.electronBridge?.getInitialSidebarBootstrap?.()?.globalStateEntries || [];
    const projects = bootstrap.find(entry => entry.key === 'local-projects')?.value || {};
    if (!rows.length) for (const [id, project] of Object.entries(projects)) add(id, project?.name, project?.rootPaths);
    for (const row of rows) {
      const id = row.getAttribute('data-app-action-sidebar-project-id');
      const name = row.getAttribute('data-app-action-sidebar-project-label');
      let fiber = row[Object.keys(row).find(key => key.startsWith('__reactFiber'))], matched = false;
      for (let depth = 0; fiber && depth < 18; depth++, fiber = fiber.return) {
        const group = fiber.memoizedProps?.group;
        if (group?.projectId !== id) continue;
        if (!['local', 'remote'].includes(group.projectKind)) { matched = true; break; }
        add(id, group.label || name, [group.path, ...(group.rootPaths || [])], group.projectKind === 'remote' ? group.hostId : 'local');
        matched = true; break;
      }
      if (!matched && projects[id]) add(id, name || projects[id].name, projects[id].rootPaths);
    }
    return [...folders.values()];
  }
  async function mount(container, target, { onError = () => {}, onReady = () => {}, onTarget = () => {}, onFolder = () => {}, onModel = () => {}, onSubmitting = () => {} } = {}) {
    const pending = !target?.threadId && target?.hostId === 'local' && draft(target?.clientThreadId);
    if (!target?.hostId || !(uuid(target.threadId) || pending) || !container?.isConnected) throw error();
    if (!hostInfo(target.hostId).available) throw unavailable();
    const { React, ReactDOM, Page, useScope, projectAssignments } = await runtime();
    if (!container.isConnected) throw error();
    const { wrapper, scopes, providers, NewComposer, modelCatalog } = capture(pending);
    if (pending && (!NewComposer || !modelCatalog?.models?.length)) throw error();
    // Persistent workspace sessions must never override a pane's selected task.
    const route = { routeKind: pending ? 'client-local-thread' : 'local-thread', routeTemplate: '/local/:conversationId',
      ...(pending ? { clientThreadId: target.clientThreadId } : { conversationId: target.threadId }), hostId: target.hostId === 'local' ? null : target.hostId,
      pathname: '/local/' + (target.threadId || target.clientThreadId),
      search: target.hostId === 'local' ? '' : '?' + new URLSearchParams({ hostId: target.hostId }), projectContext: null };
    let disposed = false;
    let failed = false;
    let submittedFolder = null, adoptedThread = null;
    function adopt(threadId, hostId = 'local') {
      if (disposed || !pending || !uuid(threadId) || adoptedThread === threadId) return;
      adoptedThread = threadId;
      onTarget({ hostId, threadId, ...(submittedFolder?.cwd ? { selectedCwd: submittedFolder.cwd } : {}) });
    }
    function report(cause) {
      if (disposed || failed) return;
      failed = true;
      const message = String(cause?.message || '');
      lastFailure = { kind: /^(Missing scope instance|Missing parent scope|Missing query client|Native conversation identity mismatch)$/.test(message) ? message : 'native_component_error',
        frames: String(cause?.stack || '').match(/app:\/\/-\/assets\/[\w.-]+\.js:\d+:\d+/g)?.slice(0, 6) || [] };
      host.setTimeout(() => { if (!disposed) onError(error()); }, 0);
    }
    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { failed: false }; }
      static getDerivedStateFromError() { return { failed: true }; }
      componentDidCatch(cause) { report(cause); }
      render() { return this.state.failed ? null : this.props.children; }
    }
    function Ready() { React.useEffect(() => { if (!disposed) onReady(); }, []); return null; }
    function ScopedChat() {
      const thread = useScope(scopes.get('ThreadScope').scope), nativeRoute = useScope(scopes.get('RouteScope').scope), composer = scopes.get('ComposerScope');
      const [folders, setFolders] = React.useState(() => pending ? importedFolders() : []);
      const [projectId, setProjectId] = React.useState(target.projectId || '');
      const [modelId, setModelId] = React.useState(target.model || modelCatalog?.model || '');
      const [effort, setEffort] = React.useState(target.reasoningEffort || modelCatalog?.effort || '');
      const model = modelCatalog?.models.find(m => m.id === modelId);
      const selectedEffort = model?.efforts.includes(effort) ? effort : model?.defaultEffort;
      const changeModel = (id, nextEffort) => {
        const chosen = modelCatalog.models.find(m => m.id === id && !m.disabled);
        if (!chosen || !chosen.efforts.includes(nextEffort)) return;
        setModelId(id); setEffort(nextEffort); target.model = id; target.reasoningEffort = nextEffort;
        onModel({ model: id, reasoningEffort: nextEffort });
      };
      const folder = folders.find(folder => folder.hostId === 'local' && folder.projectId === projectId);
      const changeProject = selected => {
        const fresh = importedFolders();
        const next = fresh.find(folder => folder.hostId === 'local' && folder.projectId === selected?.projectId) || null;
        setFolders(fresh);
        setProjectId(next?.projectId || '');
        if (next) { target.cwd = next.cwd; target.projectId = next.projectId; } else { delete target.cwd; delete target.projectId; }
        onFolder(next);
      };
      const conversationId = nativeRoute.value.conversationId || null, hostId = nativeRoute.value.hostId || 'local';
      if (pending ? thread.value.clientThreadId !== target.clientThreadId || !hostInfo(hostId).known
        : conversationId !== target.threadId || hostId !== target.hostId || thread.value.routeConversationId !== target.threadId) {
        throw new Error('Native conversation identity mismatch');
      }
      React.useEffect(() => { adopt(conversationId, hostId); }, [conversationId, hostId]);
      // Native local first-turn composers retain drafts by client identity;
      // home composers persist a shared home draft even with separate focus keys.
      const value = pending && !conversationId ? { kind: 'local', placement: 'main', clientThreadId: target.clientThreadId,
        conversationId: null, routeConversationId: null, browserTabMentionConversationId: target.clientThreadId } : { ...composer.value, clientThreadId: thread.value.clientThreadId,
        conversationId, routeConversationId: conversationId, browserTabMentionConversationId: null };
      const content = pending && !conversationId ? React.createElement('div', {
        style: { display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', flex: 1, minHeight: 0 },
      }, React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', minWidth: 0 } }, '文件夹',
        React.createElement('select', { 'aria-label': '会话所在文件夹', value: projectId, title: folder?.cwd || '选择 Codex 已导入的文件夹',
          style: { flex: 1, width: '100%', minWidth: 0 },
          onFocus: () => setFolders(importedFolders()),
          onChange: event => {
            if (disposed) return;
            changeProject({ projectId: event.target.value });
          },
        }, React.createElement('option', { value: '' }, folders.length ? '选择已导入的文件夹' : '请先在 Codex 导入文件夹'),
        ...folders.map(folder => React.createElement('option', { key: folder.hostId + ':' + folder.projectId, value: folder.projectId,
          disabled: folder.hostId !== 'local' }, folder.name + (folder.hostId !== 'local' ? ' · 远程（暂不支持新会话）' : '')))),
        projectId && !folder ? React.createElement('span', { role: 'status' }, '原文件夹已移除，请重新选择。') : null),
      React.createElement('div', { style: { display: 'flex', gap: 8, padding: '0 12px 8px', flexWrap: 'wrap' } },
        React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, '模型 ', React.createElement('select', { 'aria-label': '新会话模型', value: modelId,
          style: { width: 150, minWidth: 100, maxWidth: '100%' },
          onChange: event => { const next = modelCatalog.models.find(m => m.id === event.target.value);
            if (next) changeModel(next.id, next.efforts.includes(effort) ? effort : next.defaultEffort); } },
        ...modelCatalog.models.map(m => React.createElement('option', { key: m.id, value: m.id, disabled: m.disabled }, m.name)))),
        React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, '推理强度 ', React.createElement('select', { 'aria-label': '新会话推理强度', value: selectedEffort,
          style: { width: 80, minWidth: 60 },
          onChange: event => changeModel(modelId, event.target.value) },
        ...(model?.efforts || []).map(e => React.createElement('option', { key: e, value: e },
          ({ none: '无', minimal: '极低', low: '轻度', medium: '中', high: '高', xhigh: '极高', max: 'Max', ultra: 'Ultra' })[e] || e))))),
      React.createElement(NewComposer, { surfacePlacement: { kind: 'thread' }, disableAutoFocus: true,
        defaultCwd: folder?.cwd, selectedProject: folder ? { type: 'local', projectId: folder.projectId } : null,
        onProjectChange: changeProject, submitDisabled: !!projectId && !folder || !model || model.disabled,
        hideModeControls: true,
        showWorkspaceDropdownInUtilityBar: false,
        prepareLocalSubmit: async context => {
          if (!model || model.disabled || !model.efforts.includes(selectedEffort)) throw new Error('请重新选择可用模型。');
          submittedFolder = folder || null;
          if (!disposed) onSubmitting(true);
          return { ...context, collaborationMode: { ...context.collaborationMode,
            mode: context.collaborationMode?.mode || 'default',
            settings: { ...context.collaborationMode?.settings, model: modelId, reasoning_effort: selectedEffort } } };
        },
        onLocalSubmitStart: () => { submittedFolder = folder || null; if (!disposed) onSubmitting(true); },
        onLocalSubmitError: () => { if (!disposed) onSubmitting(false); },
        // The host's new-composer wrapper forwards the created ID as a string.
        beforeFirstTurn: async threadId => {
          const selected = submittedFolder || folder;
          if (!selected) return;
          // Native navigation can dispose the draft view while its accepted
          // creation request still owns this task. UI disposal is not cancellation.
          const reason = !uuid(threadId) ? 'project_binding_invalid_identity' : !projectAssignments ? 'project_binding_unavailable'
            : !importedFolders().some(f => f.hostId === 'local' && f.projectId === selected.projectId && f.cwd === selected.cwd)
              ? 'project_binding_stale_folder' : null;
          if (reason) {
            lastFailure = { kind: reason, frames: [] };
            throw new Error('新会话的工作文件夹暂时无法绑定，请检查所选文件夹。');
          }
          await projectAssignments.setAssignment({ hostId: 'local', threadId,
            assignment: { projectKind: 'local', projectId: selected.projectId } });
        },
        onLocalConversationCreated: threadId => adopt(threadId),
      })) : React.createElement(Page);
      return React.createElement(composer.type, { scope: composer.scope, value },
        React.createElement(Boundary, null, content, React.createElement(Ready)));
    }
    // The host resolves a separate client-new-thread identity for each stored
    // conversation. Reuse its wrapper rather than treating server IDs as client IDs.
    let tree = React.createElement(wrapper, { route, archivedConversationPreview: false },
      React.createElement(ScopedChat));
    for (const provider of providers) {
      let value = provider.value;
      if (provider.type.displayName === 'Location' && value?.location) value = { ...value,
        location: { ...value.location, pathname: route.pathname, search: route.search, state: null } };
      tree = React.createElement(provider.type, { value }, tree);
    }
    const prefix = Array.from(target.hostId, char => /^[a-z\d-]$/i.test(char) ? char : '_' + char.codePointAt(0).toString(16) + '_').join('');
    const root = ReactDOM.createRoot(container, { identifierPrefix: 'nuyoah-' + prefix + '-' + (target.threadId || target.clientThreadId.slice(18)) + '-',
      onUncaughtError: report, onCaughtError: report });
    root.render(tree);
    return { dispose() { if (!disposed) { disposed = true; root.unmount(); } }, target: { ...target } };
  }
  return { current, mount, newTarget, importedFolders, readTaskMetadata, hostInfo, prepare: runtime, diagnostic: () => lastFailure };
}
