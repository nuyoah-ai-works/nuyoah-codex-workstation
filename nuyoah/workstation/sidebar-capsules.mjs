// Serialized into the host renderer: all helpers stay inside this factory.
export function createCapsuleSidebar({ window: host, readSnapshot, readCurrent, openTask }) {
  const doc = host.document;
  const ROOT = 'nuyoah-capsule-sidebar';
  const STYLE = `${ROOT}-style`;
  const STORAGE = 'nuyoah-workstation:capsule-sidebar-v1';
  const SOURCE = 'data-nuyoah-capsule-source';
  const uuid = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value || '');
  const key = (hostId, id) => JSON.stringify([hostId, id]);
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const attr = (node, name, value) => { if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value)); };
  const hide = (node, value) => { if (node.hidden !== value) node.hidden = value; };
  const element = (tag, className, value) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value) node.textContent = value;
    return node;
  };
  const button = (label, className = '') => {
    const node = element('button', `${className} cursor-interaction`.trim(), label);
    node.type = 'button'; return node;
  };
  const timestamp = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : 0;
    return Date.parse(value || '') || 0;
  };
  function bucket(value) {
    const time = timestamp(value);
    if (!time) return '时间未知';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    return time >= +today ? '今天' : time >= +yesterday ? '昨天' : '更早';
  }
  function timeLabel(value) {
    const time = timestamp(value);
    if (!time) return '';
    return new Date(time).toLocaleString('zh-CN', bucket(value) === '今天'
      ? { hour: '2-digit', minute: '2-digit', hour12: false } : { month: 'numeric', day: 'numeric' });
  }
  let root, scroller, style, toolbar, search, tabs, more, picker, pickerSearch, pickerList;
  let revealedProject = '';
  let count, filter, groupsHost, empty, feedback, newButton, detail;
  let disposed = false, failed = false, inSync = false, saveTimer = null;
  let projects = [], tasks = [], current = {}, selectedProject = '', pickerOpen = false, tabSignature = '';
  let pendingRestore = null, query = '', statusFilter = 'all', lastSnapshot = { tasks: [] };
  let preferences = { selected: '', projects: {}, projectOrder: [] };
  let drag = null, suppressClickUntil = 0;
  let explicitSelection = false, initialProjectResolved = false;
  const cards = new Map(), groups = new Map(), hiddenSources = new Set();
  try {
    const saved = JSON.parse(host.localStorage.getItem(STORAGE) || 'null');
    if (saved?.version === 1 && typeof saved.selected === 'string' && saved.projects && typeof saved.projects === 'object') {
      preferences = { selected: saved.selected, projects: saved.projects,
        projectOrder: Array.isArray(saved.projectOrder) ? saved.projectOrder.filter(id => typeof id === 'string').slice(0, 500) : [] };
      explicitSelection = Boolean(saved.selected);
    }
  } catch {}

  function projectPreference(id = selectedProject) {
    const value = preferences.projects[id];
    if (!value || typeof value !== 'object') preferences.projects[id] = {};
    return preferences.projects[id];
  }
  function persist() {
    if (saveTimer) host.clearTimeout(saveTimer);
    saveTimer = null;
    const entries = Object.entries(preferences.projects).slice(-60);
    try { host.localStorage.setItem(STORAGE, JSON.stringify({ version: 1, selected: explicitSelection ? selectedProject : '', projectOrder: preferences.projectOrder, projects: Object.fromEntries(entries) })); } catch {}
  }
  function queueSave() { if (!saveTimer) saveTimer = host.setTimeout(persist, 300); }
  function ordered(items, order, identity) {
    const ranks = new Map((Array.isArray(order) ? order : []).map((id, index) => [id, index]));
    return [...items].sort((a, b) => (ranks.get(identity(a)) ?? Infinity) - (ranks.get(identity(b)) ?? Infinity));
  }
  function taskEntries(group) {
    const entries = tasks.filter(task => key(task.hostId, task.projectId || '__unassigned__') === selectedProject && bucket(task.updatedAt) === group)
      .sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt) || key(a.hostId, a.threadId).localeCompare(key(b.hostId, b.threadId)));
    return ordered(entries, projectPreference().taskOrder || projectPreference().orders?.[group], task => key(task.hostId, task.threadId));
  }
  function move(kind, id, target, after, group) {
    const ids = kind === 'project' ? projects.map(p => p.key) : taskEntries(group).map(t => key(t.hostId, t.threadId));
    if (id === target || !ids.includes(id) || !ids.includes(target)) return;
    const visible = kind === 'task' ? [...groups.get(group).grid.children].map(n => n.dataset.capsuleTaskKey) : ids;
    const moved = visible.filter(value => value !== id);
    moved.splice(moved.indexOf(target) + (after ? 1 : 0), 0, id);
    let cursor = 0; const visibleIds = new Set(visible);
    const result = ids.map(value => visibleIds.has(value) ? moved[cursor++] : value);
    if (kind === 'project') { preferences.projectOrder = result; projects = ordered(projects, result, p => p.key); }
    else {
      const saved = projectPreference();
      const all = tasks.filter(t => key(t.hostId, t.projectId || '__unassigned__') === selectedProject)
        .sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt) || key(a.hostId, a.threadId).localeCompare(key(b.hostId, b.threadId)));
      const groupIds = new Set(result); let index = 0;
      saved.taskOrder = ordered(all, saved.taskOrder, t => key(t.hostId, t.threadId))
        .map(t => groupIds.has(key(t.hostId, t.threadId)) ? result[index++] : key(t.hostId, t.threadId));
    }
    pendingRestore = { top: scroller?.scrollTop || 0 };
    clearDrag(); render(); if (pickerOpen) renderPicker(); persist();
    text(feedback, '顺序已保存');
  }
  function clearDrag() {
    drag = null;
    root?.querySelectorAll('[data-dragging],[data-drop-position]').forEach(n => { n.removeAttribute('data-dragging'); n.removeAttribute('data-drop-position'); });
  }
  function sortable(node, kind, id) {
    node.draggable = true; node.dataset.sortKind = kind; node.dataset.sortKey = id;
    node.ondragstart = event => {
      if (event.target.closest('.nc-detail-button')) { event.preventDefault(); return; }
      drag = { kind, id, group: node.dataset.sortGroup || '', project: selectedProject };
      event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-nuyoah-sidebar-order', id);
      attr(node, 'data-dragging', 'true'); suppressClickUntil = Date.now() + 700;
    };
    node.ondragover = event => {
      if (!drag || drag.kind !== kind || drag.id === id || (kind === 'task' && (drag.group !== node.dataset.sortGroup || drag.project !== selectedProject))) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move';
      const rect = node.getBoundingClientRect();
      const after = node.classList.contains('nc-project-option') ? event.clientY >= rect.top + rect.height / 2 : event.clientX >= rect.left + rect.width / 2;
      attr(node, 'data-drop-position', after ? 'after' : 'before');
    };
    node.ondragleave = event => { if (!node.contains(event.relatedTarget)) node.removeAttribute('data-drop-position'); };
    node.ondrop = event => {
      if (!drag || drag.kind !== kind || (kind === 'task' && (drag.group !== node.dataset.sortGroup || drag.project !== selectedProject))) return;
      event.preventDefault(); event.stopPropagation();
      const source = drag; suppressClickUntil = Date.now() + 350;
      move(kind, source.id, id, node.dataset.dropPosition === 'after', source.group);
    };
    node.ondragend = () => { suppressClickUntil = Date.now() + 350; clearDrag(); sync(); };
  }
  function scrollScale() {
    return Number(scroller?.currentCSSZoom) || (scroller?.offsetWidth
      ? scroller.getBoundingClientRect().width / scroller.offsetWidth : 1) || 1;
  }
  function captureAnchor() {
    if (!scroller || !root?.isConnected) return null;
    const top = scroller.getBoundingClientRect().top + toolbar.getBoundingClientRect().height;
    const first = [...groupsHost.querySelectorAll('[data-capsule-task-key]')].map(node => cards.get(node.dataset.capsuleTaskKey))
      .find(card => card && !card.node.closest('[hidden]') && card.node.getBoundingClientRect().bottom > top);
    return { top: scroller.scrollTop, id: first?.id || '', coordinate: 'css',
      offset: first ? (first.node.getBoundingClientRect().top - top) / scrollScale() : 0 };
  }
  function restoreAnchor(anchor) {
    if (!anchor || !scroller || !root?.isConnected) return;
    const card = cards.get(anchor.id)?.node;
    if (card?.isConnected && !card.closest('[hidden]')) {
      const top = scroller.getBoundingClientRect().top + toolbar.getBoundingClientRect().height;
      const scale = scrollScale();
      const offset = (Number(anchor.offset) || 0) / (anchor.coordinate === 'css' ? 1 : scale);
      scroller.scrollTop += (card.getBoundingClientRect().top - top) / scale - offset;
    } else scroller.scrollTop = Math.max(0, Number(anchor.top) || 0);
  }
  function rememberPosition() {
    if (selectedProject && !pendingRestore) { projectPreference().anchor = captureAnchor(); queueSave(); }
  }
  // Move only changed children; unchanged cards, focus and text nodes survive refresh.
  function reconcile(parent, desired) {
    const keep = new Set(desired);
    for (const node of [...parent.children]) if (!keep.has(node)) node.remove();
    desired.forEach((node, index) => { if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] || null); });
  }
  function readProjects() {
    const bootstrap = host.electronBridge?.getInitialSidebarBootstrap?.();
    const values = new Map((bootstrap?.globalStateEntries || []).map(entry => [entry.key, entry.value]));
    const local = values.get('local-projects') || {};
    const remote = values.get('remote-projects') || [];
    const known = new Map();
    const add = (id, name, hostId, row = null) => {
      if (!id || !name || !hostId) return;
      const identity = key(hostId, id), old = known.get(identity);
      known.set(identity, { ...old, id, name: clean(name), hostId, key: identity, row: row || old?.row || null });
    };
    for (const row of doc.querySelectorAll('[data-app-action-sidebar-project-row]')) {
      const id = row.getAttribute('data-app-action-sidebar-project-id');
      let hostId = local[id] ? 'local' : remote.find(p => p.id === id)?.hostId;
      let name = row.getAttribute('data-app-action-sidebar-project-label');
      let fiber = row[Object.keys(row).find(k => k.startsWith('__reactFiber'))];
      for (let depth = 0; fiber && depth < 18; depth++, fiber = fiber.return) {
        const group = fiber.memoizedProps?.group;
        if (group?.projectId !== id) continue;
        if (group.projectKind === 'remote') hostId = group.hostId;
        else if (group.projectKind === 'local') hostId = 'local';
        name = group.label || name; break;
      }
      add(id, name, hostId, row);
    }
    for (const [id, project] of Object.entries(local)) add(id, known.get(key('local', id))?.name || project.name, 'local');
    for (const project of remote) add(project.id, known.get(key(project.hostId, project.id))?.name || project.label || project.name, project.hostId);
    // Only metadata already admitted by the existing catalog may add a project.
    for (const task of tasks) if (!known.has(key(task.hostId, task.projectId || '__unassigned__')))
      add(task.projectId || '__unassigned__', task.projectName || '未归入项目', task.hostId);
    for (const project of known.values()) {
      const task = tasks.find(t => t.hostId === project.hostId && t.projectId === project.id);
      const info = project.hostId === 'local' ? null : host.__nuyoahMultiChatNative__?.hostInfo?.(project.hostId);
      project.device = project.hostId === 'local' ? '本机' : clean(task?.hostName || info?.name || '远程设备');
      project.connected = project.hostId === 'local' || info?.available === true;
    }
    return ordered([...known.values()], preferences.projectOrder, project => project.key);
  }
  function installStyles() {
    style = doc.createElement('style'); style.id = STYLE;
    style.textContent = `
      [${SOURCE}="true"]{display:none!important}
      #${ROOT}{--capsule-text:var(--color-text-primary,var(--color-token-text-primary,CanvasText));--capsule-sub:var(--color-text-secondary,color-mix(in srgb,currentColor 65%,transparent));--capsule-surface:var(--color-background-primary-soft,Canvas);--capsule-hover:var(--color-background-primary-ghost-hover,color-mix(in srgb,currentColor 7%,transparent));--capsule-border:var(--color-border-primary-outline,color-mix(in srgb,currentColor 18%,transparent));color:var(--capsule-text);font:inherit;min-width:0;width:100%;overflow-anchor:none;padding:0 8px 16px;position:relative;isolation:isolate;}
      #${ROOT} *{box-sizing:border-box}#${ROOT} [hidden]{display:none!important}
      #${ROOT} button,#${ROOT} input,#${ROOT} select{font:inherit;color:inherit}#${ROOT} button{appearance:none;border:0;background:transparent;text-align:left;border-radius:8px;cursor:var(--cursor-interaction,pointer)}
      #${ROOT} button:focus-visible,#${ROOT} input:focus-visible,#${ROOT} select:focus-visible{outline:2px solid var(--color-ring,var(--capsule-text));outline-offset:2px}
      #${ROOT} button:disabled{opacity:.45;cursor:default}
      #${ROOT} .nc-toolbar{position:sticky;top:0;z-index:3;background:color-mix(in srgb,var(--color-token-main-surface-primary,Canvas) 97%,var(--capsule-text));padding:10px 4px 6px;}
      #${ROOT} .nc-search{display:flex;align-items:center;gap:7px;background:color-mix(in srgb,var(--color-token-main-surface-primary,Canvas) 94%,var(--capsule-text));border-radius:10px;padding:8px 10px;margin-bottom:12px}
      #${ROOT} input{min-width:0;width:100%;border:0;background:transparent;outline-offset:4px;font-size:13px;line-height:20px}#${ROOT} input::placeholder{color:var(--capsule-sub)}
      #${ROOT} .nc-clear{padding:0 4px;font-size:16px}
      #${ROOT} .nc-projectbar{display:flex;align-items:center;gap:4px;min-width:0;margin-bottom:4px}
      #${ROOT} .nc-tabs{display:flex;flex:1;flex-wrap:nowrap;align-items:center;gap:6px;min-width:0;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:thin;padding:3px 2px 6px}
      #${ROOT} .nc-tab{flex:0 0 auto;min-width:0;padding:7px 12px;border-radius:16px;font-size:12px;line-height:18px;white-space:nowrap;text-align:left;color:var(--capsule-sub)}
      #${ROOT} .nc-tab:hover{background:var(--capsule-hover)}#${ROOT} .nc-tab[aria-pressed="true"]{background:var(--color-background-primary-solid,var(--capsule-text));color:var(--color-text-primary-solid,Canvas)}
      #${ROOT} .nc-more{flex:0 0 auto;align-self:flex-start;margin-top:3px;padding:7px 8px}
      #${ROOT} .nc-device{font-size:11px;color:var(--capsule-sub);display:block;margin-top:2px}
      #${ROOT} .nc-new{flex:0 0 30px;height:30px;padding:2px 8px;font-size:18px;line-height:24px}#${ROOT} .nc-new:hover{background:var(--capsule-hover)}
      #${ROOT} .nc-countbar{display:flex;align-items:center;padding:0 2px;color:var(--capsule-sub);font-size:11px;gap:8px;white-space:nowrap}
      #${ROOT} .nc-countbar>span{margin-right:auto}
      #${ROOT} select{border:0;background:transparent;max-width:116px;padding:3px;font-size:12px}
      #${ROOT} .nc-picker{position:absolute;z-index:5;top:92px;left:4px;right:4px;border:1px solid var(--capsule-border);border-radius:12px;background:var(--color-token-main-surface-primary,Canvas);padding:8px;box-shadow:0 8px 26px color-mix(in srgb,CanvasText 12%,transparent)}
      #${ROOT} .nc-picker-list{max-height:260px;overflow-y:auto;overscroll-behavior:contain;margin-top:8px}
      #${ROOT} .nc-project-option{width:100%;display:block;padding:8px;font-size:13px;overflow-wrap:anywhere}#${ROOT} .nc-project-option:hover,#${ROOT} .nc-project-option[aria-pressed="true"]{background:var(--capsule-hover)}
      #${ROOT} .nc-group-toggle{width:100%;display:flex;align-items:center;gap:8px;color:var(--capsule-sub);padding:16px 5px 8px;font-size:12px;line-height:18px}#${ROOT} .nc-group-toggle:hover{color:var(--capsule-text)}#${ROOT} .nc-group-arrow{margin-left:auto}
      #${ROOT} .nc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;align-items:stretch}
      #${ROOT} .nc-card{min-width:0;position:relative;display:flex;flex-direction:column;border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:15px;background:var(--capsule-surface);box-shadow:0 2px 4px rgb(0 0 0 / 9%),0 6px 14px rgb(0 0 0 / 7%);transition:background-color 120ms ease,border-color 120ms ease,box-shadow 120ms ease;}
      #${ROOT} .nc-card:hover{border-color:var(--capsule-border);box-shadow:0 3px 6px rgb(0 0 0 / 11%),0 8px 18px rgb(0 0 0 / 9%)}#${ROOT} .nc-card[data-selected="true"]{border-color:var(--capsule-sub);background:var(--capsule-surface);box-shadow:0 0 0 .5px var(--capsule-sub),0 3px 6px rgb(0 0 0 / 10%),0 7px 16px rgb(0 0 0 / 8%)}
      #${ROOT} .nc-open{padding:12px 11px 5px;flex:1;width:100%;min-width:0;border-radius:14px}
      #${ROOT} .nc-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:500;font-size:13px;line-height:19px;min-height:38px;overflow-wrap:anywhere}
      #${ROOT} .nc-summary{display:block;font-size:12px;line-height:18px;color:var(--capsule-sub);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;margin-top:5px}
      #${ROOT} .nc-meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:0 8px 7px 11px;min-height:28px;font-size:11px;color:var(--capsule-sub)}#${ROOT} .nc-time{margin-right:auto;white-space:nowrap;font-variant-numeric:tabular-nums}#${ROOT} .nc-status{white-space:nowrap}
      #${ROOT} .nc-status[data-kind="running"]{color:var(--color-text-success,currentColor)}#${ROOT} .nc-status[data-kind="waiting"]{color:var(--color-text-warning,currentColor)}#${ROOT} .nc-status[data-kind="failed"]{color:var(--color-text-danger,currentColor)}
      #${ROOT} .nc-detail-button{padding:0 5px;min-width:24px;min-height:24px;font-size:15px}#${ROOT} .nc-detail-button:hover{background:var(--capsule-hover)}
      #${ROOT} .nc-empty,#${ROOT} .nc-feedback{font-size:12px;color:var(--capsule-sub);padding:12px 6px;overflow-wrap:anywhere}
      #${ROOT} .nc-feedback:empty{display:none}
      #${ROOT} .nc-detail{position:sticky;bottom:8px;z-index:4;margin-top:10px;border:1px solid var(--capsule-border);border-radius:12px;background:var(--color-token-main-surface-primary,Canvas);padding:12px;box-shadow:0 5px 18px color-mix(in srgb,CanvasText 10%,transparent);font-size:13px;overflow-wrap:anywhere}
      #${ROOT} .nc-detail p{margin:8px 0 0;white-space:pre-wrap}#${ROOT} .nc-detail-close{float:right;padding:0 5px}
      #${ROOT} [data-dragging="true"]{opacity:.4}
      #${ROOT} [data-drop-position="before"]{box-shadow:inset 3px 0 0 var(--capsule-sub)}
      #${ROOT} [data-drop-position="after"]{box-shadow:inset -3px 0 0 var(--capsule-sub)}
      @media(prefers-reduced-motion:reduce){#${ROOT} .nc-card{transition:none}}
    `;
    doc.head.append(style);
  }
  function mount() {
    const next = doc.querySelector('[data-app-action-sidebar-scroll]');
    if (!next?.querySelector('[data-app-action-sidebar-section]')) return false;
    if (!root) {
      root = element('section'); root.id = ROOT; root.setAttribute('aria-label', '项目与对话');
      toolbar = element('div', 'nc-toolbar');
      const searchBox = element('label', 'nc-search');
      search = element('input'); search.placeholder = '搜索当前项目的对话…'; search.setAttribute('aria-label', '搜索当前项目的对话');
      search.autocomplete = 'off'; search.type = 'search';
      const clear = button('×', 'nc-clear'); clear.setAttribute('aria-label', '清除搜索'); clear.hidden = true;
      search.oninput = () => { query = search.value; clear.hidden = !query; projectPreference().query = query; pendingRestore = { top: 0 }; render(); queueSave(); };
      clear.onclick = () => { search.value = ''; search.oninput(); search.focus({ preventScroll: true }); };
      searchBox.append(search, clear);
      tabs = element('div', 'nc-tabs'); tabs.setAttribute('aria-label', '切换项目');
      const projectbar = element('div', 'nc-projectbar');
      more = button('更多⌄', 'nc-tab nc-more'); more.setAttribute('aria-label', '全部项目');
      more.setAttribute('aria-expanded', 'false');
      more.onclick = () => { pickerOpen = !pickerOpen; picker.hidden = !pickerOpen; attr(more, 'aria-expanded', pickerOpen); if (pickerOpen) { pickerSearch.value = ''; renderPicker(); pickerSearch.focus({ preventScroll: true }); } };
      projectbar.append(tabs, more);
      picker = element('div', 'nc-picker'); picker.hidden = true;
      pickerSearch = element('input'); pickerSearch.placeholder = '查找项目…'; pickerSearch.setAttribute('aria-label', '查找项目'); pickerSearch.type = 'search';
      pickerSearch.oninput = renderPicker;
      pickerList = element('div', 'nc-picker-list'); picker.append(pickerSearch, pickerList);
      newButton = button('+', 'nc-new'); newButton.setAttribute('aria-label', '在当前项目中新建对话');
      newButton.onclick = () => {
        const project = projects.find(p => p.key === selectedProject), native = createButton(project);
        if (!native?.isConnected) { text(feedback, '当前项目的新对话入口暂不可用'); return; }
        rememberPosition(); native.click();
      };
      const bar = element('div', 'nc-countbar'); count = element('span'); count.setAttribute('aria-live', 'polite');
      filter = element('select'); filter.setAttribute('aria-label', '筛选对话状态');
      for (const [value, label] of [['all', '全部状态'], ['running', '运行中'], ['waiting', '需要处理'], ['pinned', '已置顶']]) {
        const option = element('option', '', label); option.value = value; filter.append(option);
      }
      filter.onchange = () => { statusFilter = filter.value; projectPreference().filter = statusFilter; pendingRestore = { top: 0 }; render(); queueSave(); };
      bar.append(count, filter, newButton); toolbar.append(searchBox, projectbar, bar, picker);
      groupsHost = element('div', 'nc-groups'); empty = element('div', 'nc-empty');
      feedback = element('div', 'nc-feedback'); feedback.setAttribute('role', 'status');
      detail = element('div', 'nc-detail'); detail.hidden = true; detail.setAttribute('role', 'region'); detail.setAttribute('aria-label', '对话摘要');
      root.append(toolbar, groupsHost, empty, feedback, detail);
      root.addEventListener('keydown', onKeydown);
      doc.addEventListener('pointerdown', outsidePicker, true);
      host.addEventListener('pagehide', persist);
      installStyles();
    }
    if (!style.isConnected) doc.head.append(style);
    if (scroller !== next || root.parentElement !== next) {
      scroller?.removeEventListener('scroll', rememberPosition);
      scroller = next; scroller.prepend(root);
      scroller.addEventListener('scroll', rememberPosition, { passive: true });
      pendingRestore ||= projectPreference().anchor || { top: 0 };
    }
    for (const node of [...scroller.children]) {
      if (node === root || !node.querySelector('[data-app-action-sidebar-section]')) continue;
      attr(node, SOURCE, 'true'); hiddenSources.add(node);
    }
    return true;
  }
  function createButton(project) {
    if (!project?.row?.isConnected) return null;
    return [...project.row.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === `在 ${project.name} 中开始新聊天`
      || node.getAttribute('aria-label') === `Start new chat in ${project.name}`) || null;
  }
  function chooseProject(id) {
    if (Date.now() < suppressClickUntil) return;
    if (id === selectedProject) { closePicker(true); return; }
    rememberPosition(); selectedProject = id; preferences.selected = id; explicitSelection = true;
    const saved = projectPreference(); query = typeof saved.query === 'string' ? saved.query.slice(0, 300) : '';
    statusFilter = ['all', 'running', 'waiting', 'pinned'].includes(saved.filter) ? saved.filter : 'all';
    search.value = query; search.nextElementSibling.hidden = !query; filter.value = statusFilter;
    pendingRestore = saved.anchor || { top: 0 }; detail.hidden = true; closePicker(); text(feedback, '');
    render(); tabs.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true }); queueSave();
  }
  function renderPicker() {
    if (!pickerOpen) return;
    const needle = pickerSearch.value.toLocaleLowerCase().trim();
    const list = projects.filter(p => `${p.name} ${p.device}`.toLocaleLowerCase().includes(needle));
    pickerList.replaceChildren(...list.map(project => {
      const item = button('', 'nc-project-option'); item.dataset.projectKey = project.key;
      sortable(item, 'project', project.key);
      attr(item, 'aria-pressed', project.key === selectedProject);
      item.append(element('span', '', project.name), element('span', 'nc-device', project.device));
      item.onclick = () => chooseProject(project.key); return item;
    }));
    if (!list.length) pickerList.append(element('div', 'nc-empty', '没有匹配的项目'));
  }
  function closePicker(focus = false) {
    pickerOpen = false; if (picker) picker.hidden = true; if (more) attr(more, 'aria-expanded', false);
    if (focus) more?.focus({ preventScroll: true });
  }
  function outsidePicker(event) {
    if (pickerOpen && !picker.contains(event.target) && !more?.contains(event.target)) closePicker();
  }
  function onKeydown(event) {
    const sortNode = event.target.closest('[data-sort-kind]');
    if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && sortNode) {
      const kind = sortNode.dataset.sortKind, id = sortNode.dataset.sortKey, group = sortNode.dataset.sortGroup;
      const ids = kind === 'project' ? projects.map(p => p.key) : [...groups.get(group).grid.children].map(n => n.dataset.capsuleTaskKey);
      const step = kind === 'task' && ['ArrowUp', 'ArrowDown'].includes(event.key) ? 2 : 1;
      const after = ['ArrowRight', 'ArrowDown'].includes(event.key), target = ids[ids.indexOf(id) + (after ? step : -step)];
      event.preventDefault(); event.stopPropagation();
      if (target) {
        move(kind, id, target, after, group);
        const moved = [...root.querySelectorAll('[data-sort-key]')].find(n => n.dataset.sortKey === id && !n.closest('[hidden]'));
        (kind === 'task' ? moved?.querySelector('.nc-open') : moved)?.focus({ preventScroll: true });
      }
      return;
    }
    if (event.key === 'Escape') {
      if (pickerOpen) { closePicker(true); event.stopPropagation(); }
      else if (!detail.hidden) { detail.hidden = true; cards.get(detail.dataset.owner)?.details.focus({ preventScroll: true }); event.stopPropagation(); }
      else if (query && event.target === search) { search.value = ''; search.oninput(); event.stopPropagation(); }
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && event.target.parentElement === tabs) {
      const buttons = [...tabs.children], index = buttons.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
      event.preventDefault(); buttons[next].focus();
    }
  }
  function renderTabs() {
    const primary = projects;
    const selected = projects.find(p => p.key === selectedProject);
    const signature = JSON.stringify(primary.map(p => [p.key, p.name, p.device]));
    if (signature !== tabSignature) {
      tabSignature = signature;
      const nodes = primary.map(project => {
        const label = project.hostId === 'local' ? project.name : `${project.name} · ${project.device}`;
        const tab = button(label, 'nc-tab'); tab.title = label; tab.dataset.projectKey = project.key;
        sortable(tab, 'project', project.key);
        tab.setAttribute('aria-description', '拖动调整顺序，或按 Alt 加方向键移动');
        tab.onclick = () => chooseProject(project.key); return tab;
      });
      const left = tabs.scrollLeft;
      tabs.replaceChildren(...nodes); tabs.scrollLeft = left;
    }
    const pickerTop = `${tabs.offsetTop + tabs.offsetHeight + 6}px`;
    if (picker.style.top !== pickerTop) picker.style.top = pickerTop;
    for (const tab of tabs.querySelectorAll('[data-project-key]')) attr(tab, 'aria-pressed', tab.dataset.projectKey === selectedProject);
    if (selected) {
      newButton.disabled = !createButton(selected);
      if (revealedProject !== selectedProject) {
        revealedProject = selectedProject;
        const tab = [...tabs.children].find(n => n.dataset.projectKey === selectedProject);
        if (tab) tabs.scrollLeft = Math.max(0, tab.offsetLeft - tabs.offsetLeft - 2);
      }
    }
  }
  function taskState(task) {
    if (task.waitingReason) return { kind: 'waiting', label: task.waitingReason === 'approval' ? '等待授权' : '等待输入' };
    if (task.runtimeStatus === 'running') return { kind: 'running', label: '运行中' };
    if (task.runtimeStatus === 'failed') return { kind: 'failed', label: '已中断' };
    if (task.statusAvailable === false || task.runtimeStatus === 'unknown') return { kind: 'unknown', label: '待同步' };
    return { kind: '', label: '' };
  }
  function summary(task) {
    const value = clean(task.progress || task.summary).replace(/visualize.*?(?:|$)/g, '可交互预览')
      .replace(/<oai-mem-citation>.*$/g, '').replace(/::[a-z-]+\{[^}]*\}/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*|__|`/g, '').replace(/(?:^|\s)#{1,6}\s+/g, ' ').trim();
    return value.slice(0, 400) || (task.hostId !== 'local' ? '远程对话' : '暂无摘要');
  }
  function makeCard(task) {
    const id = key(task.hostId, task.threadId), node = element('article', 'nc-card'); node.dataset.capsuleTaskKey = id;
    sortable(node, 'task', id);
    const open = button('', 'nc-open'), title = element('span', 'nc-title'), preview = element('span', 'nc-summary');
    open.append(title, preview);
    open.setAttribute('aria-description', '拖动调整组内顺序，或按 Alt 加方向键移动');
    const meta = element('div', 'nc-meta'), time = element('span', 'nc-time'), status = element('span', 'nc-status');
    const details = button('⋯', 'nc-detail-button'); details.setAttribute('aria-label', '查看完整标题与摘要');
    meta.append(time, status, details); node.append(open, meta);
    const card = { id, node, open, title, preview, time, status, details, task };
    open.onclick = () => {
      if (drag || Date.now() < suppressClickUntil) return;
      rememberPosition(); closePicker(); detail.hidden = true;
      try {
        if (openTask(card.task) === false) text(feedback, card.task.hostId === 'local' ? '暂时无法打开此对话，请使用原生导航重试' : '远程设备暂未连接');
        else text(feedback, '');
      } catch { text(feedback, '暂时无法打开此对话'); }
    };
    details.onclick = () => {
      detail.dataset.owner = card.id;
      const close = button('×', 'nc-detail-close'); close.setAttribute('aria-label', '关闭摘要');
      close.onclick = () => { detail.hidden = true; card.details.focus({ preventScroll: true }); };
      detail.replaceChildren(close, element('strong', '', card.task.title || '未命名对话'), element('p', '', summary(card.task)));
      detail.hidden = false; close.focus({ preventScroll: true });
    };
    cards.set(id, card); return card;
  }
  function updateCard(task) {
    const id = key(task.hostId, task.threadId), card = cards.get(id) || makeCard(task); card.task = task;
    card.node.dataset.sortGroup = bucket(task.updatedAt);
    const state = taskState(task), selected = current.hostId === task.hostId && current.threadId === task.threadId;
    text(card.title, task.title || '未命名对话'); attr(card.title, 'title', task.title || '未命名对话');
    text(card.preview, summary(task)); attr(card.preview, 'title', summary(task));
    text(card.time, timeLabel(task.updatedAt));
    text(card.status, state.label); attr(card.status, 'data-kind', state.kind);
    attr(card.node, 'data-selected', selected);
    if (selected) attr(card.open, 'aria-current', 'page'); else card.open.removeAttribute('aria-current');
    attr(card.open, 'aria-label', `${task.title || '未命名对话'}${state.label ? `，${state.label}` : ''}`);
    return card.node;
  }
  function ensureGroup(label) {
    if (groups.has(label)) return groups.get(label);
    const node = element('section'), toggle = button('', 'nc-group-toggle'), name = element('span', '', label);
    const total = element('span'), arrow = element('span', 'nc-group-arrow'), grid = element('div', 'nc-grid');
    grid.id = `${ROOT}-group-${groups.size}`; toggle.setAttribute('aria-controls', grid.id);
    toggle.append(name, total, arrow); node.append(toggle, grid);
    toggle.onclick = () => {
      const saved = projectPreference(), folded = new Set(Array.isArray(saved.folded) ? saved.folded : []);
      if (folded.has(label)) folded.delete(label); else folded.add(label);
      saved.folded = [...folded]; render(); queueSave();
    };
    const group = { node, toggle, total, arrow, grid }; groups.set(label, group); return group;
  }
  function render() {
    if (!root?.isConnected || disposed) return;
    const anchor = pendingRestore || captureAnchor();
    const focused = root.contains(doc.activeElement) ? doc.activeElement : null;
    renderTabs();
    const selected = projects.find(p => p.key === selectedProject);
    const needle = query.toLocaleLowerCase().trim();
    const list = tasks.filter(task => key(task.hostId, task.projectId || '__unassigned__') === selectedProject)
      .filter(task => !needle || `${task.title} ${summary(task)}`.toLocaleLowerCase().includes(needle))
      .filter(task => statusFilter === 'all' || (statusFilter === 'pinned' ? task.pinned === true : statusFilter === 'waiting'
        ? !!task.waitingReason || task.runtimeStatus === 'failed' : task.runtimeStatus === 'running'));
    text(count, `${list.length} 个对话`);
    const folded = new Set(projectPreference().folded || []), desired = [];
    for (const label of ['今天', '昨天', '更早', '时间未知']) {
      const shownIds = new Set(list.map(task => key(task.hostId, task.threadId)));
      const entries = taskEntries(label).filter(task => shownIds.has(key(task.hostId, task.threadId)));
      if (!entries.length) continue;
      const group = ensureGroup(label); text(group.total, String(entries.length));
      attr(group.toggle, 'aria-expanded', !folded.has(label)); text(group.arrow, folded.has(label) ? '›' : '⌄');
      hide(group.grid, folded.has(label));
      reconcile(group.grid, entries.map(updateCard)); desired.push(group.node);
    }
    reconcile(groupsHost, desired);
    const shown = new Set(list.map(task => key(task.hostId, task.threadId)));
    for (const [id, card] of cards) if (!shown.has(id)) { card.node.remove(); cards.delete(id); }
    hide(empty, list.length > 0);
    text(empty, !selected ? '正在读取项目…' : needle || statusFilter !== 'all' ? '没有匹配的对话'
      : selected.hostId !== 'local' && !selected.connected ? '远程设备暂未连接' : '此项目暂无对话');
    if (focused?.isConnected && doc.activeElement !== focused) focused.focus({ preventScroll: true });
    // Layout is measured above; restore once synchronously. A deferred second
    // restoration can overwrite a user's scroll in the next frame.
    restoreAnchor(anchor);
    pendingRestore = null;
  }
  function sync() {
    if (disposed || failed || inSync || drag) return;
    inSync = true;
    try {
      if (!mount()) { unmount(); return; }
      const snapshot = readSnapshot?.(); if (Array.isArray(snapshot?.tasks)) lastSnapshot = snapshot;
      const unique = new Map();
      for (const task of lastSnapshot.tasks) {
        if (task.archived === true || !uuid(task.threadId) || !task.hostId || task.hostId === 'chatgpt' || task.source === 'chatgpt') continue;
        unique.set(key(task.hostId, task.threadId), task);
      }
      tasks = [...unique.values()]; current = readCurrent?.() || {};
      projects = readProjects();
      if (!explicitSelection && !initialProjectResolved) {
        const currentProject = projects.find(p => p.id === current.projectId && p.hostId === current.hostId);
        if (currentProject) {
          selectedProject = currentProject.key; initialProjectResolved = true;
          const saved = projectPreference();
          query = typeof saved.query === 'string' ? saved.query.slice(0, 300) : '';
          statusFilter = ['all', 'running', 'waiting', 'pinned'].includes(saved.filter) ? saved.filter : 'all';
          search.value = query; search.nextElementSibling.hidden = !query; filter.value = statusFilter;
          pendingRestore = saved.anchor || { top: 0 };
        }
      }
      if (!projects.some(p => p.key === selectedProject)) {
        selectedProject = projects.some(p => p.key === preferences.selected) ? preferences.selected
          : projects.find(p => p.id === current.projectId && p.hostId === current.hostId)?.key || projects[0]?.key || '';
        const saved = projectPreference(); query = typeof saved.query === 'string' ? saved.query.slice(0, 300) : '';
        statusFilter = ['all', 'running', 'waiting', 'pinned'].includes(saved.filter) ? saved.filter : 'all';
        search.value = query; filter.value = statusFilter; pendingRestore = saved.anchor || { top: 0 };
      }
      render();
    } catch {
      failed = true; unmount();
    } finally { inSync = false; }
  }
  function visible() {
    return !disposed && !failed && root?.isConnected && doc.visibilityState !== 'hidden'
      && root.getBoundingClientRect().width > 0 && scroller?.getBoundingClientRect().height > 0;
  }
  function previewRequests() {
    if (!visible()) return [];
    const bounds = scroller.getBoundingClientRect();
    return [...cards.values()].filter(card => card.task.hostId === 'local' && !card.node.closest('[hidden]'))
      .filter(card => { const rect = card.node.getBoundingClientRect(); return rect.bottom >= bounds.top - 150 && rect.top <= bounds.bottom + 150; })
      .slice(0, 32).map(card => ({ id: `local:${card.task.threadId}`, title: card.task.title, key: `local:${card.task.threadId}\n${card.task.title}` }));
  }
  function unmount() {
    for (const node of hiddenSources) node.removeAttribute(SOURCE);
    hiddenSources.clear(); scroller?.removeEventListener('scroll', rememberPosition);
    root?.remove(); style?.remove();
  }
  function destroy() {
    if (disposed) return;
    rememberPosition(); persist(); disposed = true;
    if (saveTimer) host.clearTimeout(saveTimer);
    doc.removeEventListener('pointerdown', outsidePicker, true);
    host.removeEventListener('pagehide', persist);
    unmount(); cards.clear(); groups.clear();
  }
  return { sync, visible, previewRequests, destroy };
}
