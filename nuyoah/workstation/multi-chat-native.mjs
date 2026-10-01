// Serialized into the renderer. Reuses the installed host's React and scopes.
export function createNativeMultiChatAdapter({ window: host, loadModule } = {}) {
  const error = () => new Error('当前版本暂时无法打开四宫格，请继续使用单聊。');
  const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
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
      return { React, ReactDOM, Page, useScope: hooks[0] };
    })().catch(() => { modules = null; throw error(); });
    return modules;
  }
  function capture() {
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
          if (ancestor?.memoizedProps?.value?.routeKind === 'local-thread') {
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
    if (!wrapper || scopes.size !== 3 || !uuid(scopes.get('RouteScope').value?.conversationId)
      || !hostInfo(scopes.get('RouteScope').value.hostId || 'local').known) throw error();
    return { scopes, providers, wrapper, route: scopes.get('RouteScope').value };
  }
  function current() {
    try { const { route } = capture(); return { hostId: route.hostId || 'local', threadId: route.conversationId }; }
    catch { return null; }
  }
  async function mount(container, target, { onError = () => {}, onReady = () => {} } = {}) {
    if (!target?.hostId || !uuid(target.threadId) || !container?.isConnected) throw error();
    if (!hostInfo(target.hostId).available) throw unavailable();
    const { React, ReactDOM, Page, useScope } = await runtime();
    if (!container.isConnected) throw error();
    const { wrapper, scopes, providers } = capture();
    // Persistent workspace sessions must never override a pane's selected task.
    const route = { routeKind: 'local-thread', routeTemplate: '/local/:conversationId',
      conversationId: target.threadId, hostId: target.hostId === 'local' ? null : target.hostId,
      pathname: '/local/' + target.threadId,
      search: target.hostId === 'local' ? '' : '?' + new URLSearchParams({ hostId: target.hostId }), projectContext: null };
    let disposed = false;
    let failed = false;
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
      if (nativeRoute.value.conversationId !== target.threadId || (nativeRoute.value.hostId || 'local') !== target.hostId
        || thread.value.routeConversationId !== target.threadId) {
        throw new Error('Native conversation identity mismatch');
      }
      const value = { ...composer.value, clientThreadId: thread.value.clientThreadId,
        conversationId: target.threadId, routeConversationId: target.threadId, browserTabMentionConversationId: null };
      return React.createElement(composer.type, { scope: composer.scope, value },
        React.createElement(Boundary, null, React.createElement(Page), React.createElement(Ready)));
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
    const root = ReactDOM.createRoot(container, { identifierPrefix: 'nuyoah-' + prefix + '-' + target.threadId + '-',
      onUncaughtError: report, onCaughtError: report });
    root.render(tree);
    return { dispose() { if (!disposed) { disposed = true; root.unmount(); } }, target: { ...target } };
  }
  return { current, mount, hostInfo, prepare: runtime, diagnostic: () => lastFailure };
}
