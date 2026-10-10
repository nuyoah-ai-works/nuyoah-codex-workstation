export function createMultiChatUI({ window: host, adapter, storage = host.localStorage } = {}) {
  const doc = host.document, key = 'nuyoah:chat-grid-layout-v1';
  const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
  const draft = target => target?.hostId === 'local' && !target.threadId && typeof target.clientThreadId === 'string'
    && target.clientThreadId.startsWith('client-new-thread:') && uuid(target.clientThreadId.slice(18));
  const validTarget = target => validHost(target?.hostId) && (uuid(target.threadId) || draft(target));
  const directory = value => typeof value === 'string' && value.length < 4096 && !/[\0\r\n]/.test(value)
    && (value.startsWith('/') || /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]+\\/.test(value));
  const storedTarget = target => target ? { hostId: target.hostId, ...(draft(target)
    ? { clientThreadId: target.clientThreadId, ...(directory(target.cwd) && typeof target.projectId === 'string' && target.projectId.length < 512
      ? { cwd: target.cwd, projectId: target.projectId } : {}) } : { threadId: target.threadId }) } : null;
  const validHost = value => typeof value === 'string' && value.length > 0 && value.length < 512
    && !/[\0\r\n]/.test(value) && !value.startsWith('chatgpt') && value !== 'durable';
  let saved;
  try { saved = JSON.parse(storage.getItem(key)); } catch {}
  const selected = new Set();
  let targets = Array.from({ length: 4 }, (_, index) => {
    const target = saved?.targets?.[index];
    if (!validTarget(target) || selected.has(identity(target))) return null;
    selected.add(identity(target)); return { ...storedTarget(target), ...(draft(target) ? { title: '新会话' } : {}) };
  });
  const ratio = value => Number.isFinite(value) ? Math.min(.8, Math.max(.2, value)) : .5;
  const state = { open: false, suspended: false, active: Number.isInteger(saved?.active) && saved.active >= 0 && saved.active < 4 ? saved.active : 0,
    x: ratio(saved?.x), y: ratio(saved?.y), generation: 0 };
  let restoreOpen = saved?.open === true, opening = false, swapping = null;
  let pickerSignature = '';
  let entry, view, area, timer, observer, resizeObserver, dragging, notice;
  let slots = [], hidden = [], sourceArea = null, original = null, lastNative = null, navigating = null;
  let destroyed = false, painting = false;
  let layoutFrame = null, resizeTimer = null, lastLayout = '';
  let keyboardFocusUntil = 0;
  let focusRequest = null, focusFrame = null;
  function cancelFocusRequest() { focusRequest = null; if (focusFrame != null) host.cancelAnimationFrame(focusFrame); focusFrame = null; }
  function keepRequestedFocus() {
    focusFrame = null;
    if (!state.open || state.suspended || !focusRequest || Date.now() > focusRequest.until || state.active !== focusRequest.index || !focusRequest.editor.isConnected) { focusRequest = null; return; }
    const active = doc.activeElement;
    if (doc.hasFocus() && (!active || active === doc.body || active.closest?.('[data-nuyoah-chat-source-hidden]'))) focusRequest.editor.focus({ preventScroll: true });
    focusFrame = host.requestAnimationFrame(keepRequestedFocus);
  }
  function requestFocus(index, editor) {
    cancelFocusRequest(); focusRequest = { index, editor, until: Date.now() + 1600 }; keepRequestedFocus();
  }
  function node(tag, className, text) { const el = doc.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el; }
  function button(label, action) { const el = node('button', '', label); el.type = 'button'; el.onclick = action; return el; }
  function identity(target) { return target && target.hostId + ':' + (target.threadId || target.clientThreadId); }
  function pickerValue(target) { return target?.hostId === 'local' ? target.threadId || target.clientThreadId : JSON.stringify([target.hostId, target.threadId]); }
  function deviceName(target) { return target.hostId === 'local' ? '本机' : target.hostName || adapter.hostInfo?.(target.hostId)?.name || '远程设备'; }
  function catalog() {
    const tasks = new Map();
    const add = (task, retained = false) => {
      const threadId = typeof task?.threadId === 'string' ? task.threadId.replace(/^local:/, '').toLowerCase() : '';
      if (!validHost(task?.hostId) || !uuid(threadId) || !retained && adapter.hostInfo?.(task.hostId)?.known === false) return;
      tasks.set(identity({ hostId: task.hostId, threadId }), { hostId: task.hostId, threadId,
        title: String(task.title || task.threadTitle || '未命名对话').slice(0, 180),
        hostName: String(task.hostName || adapter.hostInfo?.(task.hostId)?.name || (task.hostId === 'local' ? '本机' : '远程设备')).slice(0, 100) });
    };
    for (const task of host.__nuyoahRemoteTaskCatalog__?.snapshot?.() || []) add(task);
    for (const task of host.__codexConversationPreviewInjection__?.getTaskboardSnapshot?.()?.tasks || []) add(task);
    for (const row of doc.querySelectorAll('[data-app-action-sidebar-thread-id]')) add({
      hostId: row.getAttribute('data-app-action-sidebar-thread-host-id') || 'local',
      threadId: row.getAttribute('data-app-action-sidebar-thread-id'),
      title: row.getAttribute('data-app-action-sidebar-thread-title') });
    const current = adapter.current();
    if (current && !tasks.has(identity(current))) add(current);
    for (const slot of slots) if (slot.target && !tasks.has(identity(slot.target))) add(slot.target, true);
    return [...tasks.values()];
  }
  function currentTarget() {
    const current = adapter.current();
    return current && (catalog().find(task => identity(task) === identity(current)) || current);
  }
  function nativeArea() {
    const candidates = [...doc.querySelectorAll('[data-app-shell-main-content-layout]')];
    return candidates.filter(el => !el.closest('#nuyoah-chat-grid') && !el.closest('[hidden]'))
      .find(el => { const r = el.getBoundingClientRect(); return r.width > 100 && r.height > 100; });
  }
  function restoreSource() {
    for (const record of hidden) {
      record.el.style.visibility = record.visibility;
      record.el.style.opacity = record.opacity;
      record.el.inert = record.inert;
      if (!record.marked) record.el.removeAttribute('data-nuyoah-chat-source-hidden');
      if (record.aria == null) record.el.removeAttribute('aria-hidden'); else record.el.setAttribute('aria-hidden', record.aria);
    }
    hidden = []; sourceArea = null;
  }
  function concealSource(next) {
    if (sourceArea === next) return;
    restoreSource(); sourceArea = next;
    hidden = [{ el: next, visibility: next.style.visibility, opacity: next.style.opacity, inert: next.inert,
      aria: next.getAttribute('aria-hidden'), marked: next.hasAttribute('data-nuyoah-chat-source-hidden') }];
    for (const record of hidden) {
      // Inert already removes the covered chat from focus and accessibility.
      // Keep the viewport's native visibility marker available to panel mounting.
      record.el.style.opacity = '0'; record.el.inert = true;
      if (record.aria !== 'true') record.el.setAttribute('data-nuyoah-chat-source-hidden', '');
    }
  }
  function feedback(message) {
    if (!notice) { notice = node('span', 'nuyoah-chat-grid-notice'); notice.setAttribute('role', 'status'); entry?.parentElement?.append(notice); }
    notice.textContent = message;
  }
  function layout() {
    if (!view || !state.open || painting) return;
    let source = sourceArea?.isConnected && !sourceArea.closest('[hidden]') ? sourceArea : null;
    let rect = source?.getBoundingClientRect();
    if (!rect || rect.width <= 100 || rect.height <= 100) { source = nativeArea(); rect = source?.getBoundingClientRect(); }
    if (!source) { suspend(); return; }
    if (rect.width < 540 || rect.height < 440) { suspend(); return; }
    if (state.suspended) return;
    concealSource(source);
    const width = Math.max(1, rect.width - 8), height = Math.max(1, rect.height - 40);
    const x = Math.max(260 / width, Math.min(1 - 260 / width, state.x));
    const y = Math.max(190 / height, Math.min(1 - 190 / height, state.y));
    const signature = [rect.left, rect.top, rect.width, rect.height, x, y, state.active].join(':');
    if (signature === lastLayout) return;
    lastLayout = signature; painting = true;
    const style = (el, name, value) => { if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value); };
    const attribute = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };
    for (const [name, value] of Object.entries({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })) style(view, name, value + 'px');
    style(area, 'grid-template-columns', `${x}fr ${1 - x}fr`);
    style(area, 'grid-template-rows', `${y}fr ${1 - y}fr`);
    style(area, '--split-x', `${x * 100}%`); style(area, '--split-y', `${y * 100}%`);
    attribute(view, 'data-active', String(state.active));
    for (const slot of slots) {
      attribute(slot.el, 'data-active', String(slot.index === state.active));
      style(slot.el, 'grid-area', `${Math.floor(slot.index / 2) + 1} / ${slot.index % 2 + 1}`);
    }
    for (const separator of area.querySelectorAll('[role="separator"]')) {
      attribute(separator, 'aria-valuenow', String(Math.round((separator.dataset.axis === 'y' ? y : x) * 100)));
    }
    painting = false;
  }
  function scheduleLayout() {
    if (destroyed || layoutFrame != null) return;
    layoutFrame = host.requestAnimationFrame(() => { layoutFrame = null; layout(); });
  }
  function resize() {
    scheduleLayout(); host.clearTimeout(resizeTimer);
    resizeTimer = host.setTimeout(() => { resizeTimer = null; sync(); }, 120);
  }
  function save() {
    if (slots.length) targets = slots.map(slot => storedTarget(slot.target));
    try { storage.setItem(key, JSON.stringify({ x: state.x, y: state.y, active: state.active, targets, open: state.open })); } catch {}
  }
  function suspend() {
    if (!state.open || state.suspended) return;
    state.suspended = true; cancelFocusRequest(); cancelSwap(); endDrag();
    view.hidden = true; restoreSource(); resizeObserver?.disconnect();
    entry?.setAttribute('aria-expanded', 'false');
    host.__codexConversationPreviewInjection__?.refresh?.();
  }
  function navigate(target) {
    if (!target || draft(target) || identity(adapter.current()) === identity(target)) return;
    navigating = { id: identity(target), until: Date.now() + 5000 };
    host.__codexConversationPreviewInjection__?.openMultiChatTask?.(target);
  }
  function activate(index, shouldNavigate = true) {
    state.active = index; layout(); save();
    if (shouldNavigate && slots[index]?.target) navigate(slots[index].target);
    host.__codexConversationPreviewInjection__?.refresh?.();
  }
  function updatePickers() {
    const tasks = catalog();
    const signature = JSON.stringify([tasks.map(task => [identity(task), task.title, task.hostName]), slots.map(slot => identity(slot.target))]);
    for (const slot of slots) {
      const task = tasks.find(task => identity(task) === identity(slot.target));
      if (task && slot.target) { slot.target.title = task.title; slot.target.hostName = task.hostName; }
    }
    if (signature === pickerSignature) return;
    pickerSignature = signature;
    for (const slot of slots) {
      const current = slot.target ? pickerValue(slot.target) : '';
      slot.picker.replaceChildren();
      const empty = node('option', '', '选择对话'); empty.value = ''; slot.picker.append(empty);
      if (draft(slot.target)) { const option = node('option', '', '新会话 · 本机'); option.value = pickerValue(slot.target); slot.picker.append(option); }
      for (const task of tasks) {
        const option = node('option', '', task.title + ' · ' + deviceName(task)); option.value = pickerValue(task);
        option.disabled = slots.some(other => other !== slot && identity(other.target) === identity(task))
          || adapter.hostInfo?.(task.hostId)?.available === false;
        slot.picker.append(option);
      }
      slot.picker.value = current;
      slot.picker.title = slot.target ? slot.target.title + ' · ' + deviceName(slot.target) : '选择对话';
    }
  }
  async function bind(index, target, { select = true, reload = false } = {}) {
    const slot = slots[index];
    if (!slot || !state.open) return;
    if (target && !validTarget(target)) { feedback('请选择本机或已配置远程设备的 Codex 对话。'); return; }
    const existing = target && slots.find(other => other !== slot && identity(other.target) === identity(target));
    if (existing) { activate(existing.index); updatePickers(); return; }
    if (!reload && identity(slot.target) === identity(target)) { if (select) activate(index); return; }
    const generation = ++slot.generation;
    slot.session?.dispose(); slot.session = null; slot.target = target; slot.body.replaceChildren();
    delete slot.el.dataset.loaded;
    slot.status.textContent = target ? '正在打开…' : '新建会话，或选择已有对话';
    slot.expand.disabled = !target;
    if (select) activate(index, false);
    updatePickers();
    save();
    if (!target) return;
    const mountNode = node('div', 'nuyoah-chat-grid-surface'); slot.body.append(mountNode);
    try {
      const session = await adapter.mount(mountNode, target, {
        onReady: () => { if (state.open && slots[slot.index] === slot && slot.generation === generation) { slot.status.textContent = ''; slot.el.dataset.loaded = 'true'; } },
        onError: () => { if (state.open && slots[slot.index] === slot && slot.generation === generation) close('这个版本暂时无法显示独立对话，已恢复单聊。'); },
        onFolder: folder => {
          if (!state.open || slots[slot.index] !== slot || slot.generation !== generation || !draft(slot.target)) return;
          if (folder && (folder.hostId !== 'local' || !directory(folder.cwd) || typeof folder.projectId !== 'string' || folder.projectId.length >= 512)) return;
          if (folder) { slot.target.cwd = folder.cwd; slot.target.projectId = folder.projectId; }
          else { delete slot.target.cwd; delete slot.target.projectId; }
          save(); host.__codexConversationPreviewInjection__?.refresh?.();
        },
        onTarget: next => {
          if (!state.open || slots[slot.index] !== slot || slot.generation !== generation || !validTarget(next) || draft(next)) return;
          slot.target = { ...next, title: '新会话' }; updatePickers(); save();
          if (state.active === slot.index) navigate(slot.target);
          host.__codexConversationPreviewInjection__?.refresh?.();
        },
      });
      if (!state.open || slots[slot.index] !== slot || slot.generation !== generation) { session.dispose(); return; }
      slot.session = session;
      if (select) navigate(target);
    } catch (cause) {
      if (!state.open || slot.generation !== generation) return;
      if (target.hostId !== 'local' && cause?.code === 'remote_unavailable') {
        slot.body.replaceChildren(); slot.status.textContent = '远程设备暂未连接 ';
        slot.status.append(button('重试', () => void bind(slot.index, slot.target, { reload: true })));
        slot.expand.disabled = true;
      } else close('四宫格暂时无法打开，已恢复单聊。');
    }
  }
  function newChat(index) {
    if (!slots[index] || !state.open) return;
    try { return bind(index, adapter.newTarget()); }
    catch { feedback('新会话暂时无法打开，请稍后重试。'); }
  }
  function selectTask(target) {
    if (!state.open || state.suspended || !validTarget(target)) return false;
    void bind(state.active, target); return true;
  }
  function expand(index) {
    activate(index, false);
    if (state.expanded === index) { Object.assign(state, state.beforeExpand); state.expanded = null; }
    else {
      if (state.expanded == null) state.beforeExpand = { x: state.x, y: state.y };
      state.expanded = index; state.x = index % 2 === 0 ? .72 : .28; state.y = index < 2 ? .72 : .28;
    }
    for (const slot of slots) { slot.expand.textContent = state.expanded === slot.index ? '恢复' : '放大'; slot.expand.setAttribute('aria-pressed', String(state.expanded === slot.index)); }
    layout(); save();
  }
  function move(event) {
    if (!dragging) return;
    const rect = area.getBoundingClientRect();
    if (dragging.axis.includes('x')) state.x = (event.clientX - rect.left) / rect.width;
    if (dragging.axis.includes('y')) state.y = (event.clientY - rect.top) / rect.height;
    const minX = 260 / (rect.width - 8), minY = 190 / (rect.height - 8);
    state.x = Math.max(minX, Math.min(1 - minX, state.x)); state.y = Math.max(minY, Math.min(1 - minY, state.y));
    if (state.expanded != null) {
      state.expanded = null;
      for (const slot of slots) { slot.expand.textContent = '放大'; slot.expand.setAttribute('aria-pressed', 'false'); }
    }
    scheduleLayout();
  }
  function endDrag() { if (!dragging) return; dragging = null; view?.removeAttribute('data-dragging'); layout(); save(); }
  function cancelSwap() {
    swapping = null; view?.removeAttribute('data-swapping');
    for (const slot of slots) slot.el.removeAttribute('data-swap-target');
  }
  function swap(from, to) {
    if (!state.open || state.suspended || from === to || !slots[from] || !slots[to]) return;
    cancelFocusRequest();
    const active = slots[state.active];
    [slots[from], slots[to]] = [slots[to], slots[from]];
    lastLayout = '';
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index]; slot.index = index; slot.el.dataset.slot = String(index);
      slot.el.setAttribute('aria-label', '对话区域 ' + (index + 1));
      slot.picker.setAttribute('aria-label', '区域 ' + (index + 1) + ' 的对话');
      slot.handle.setAttribute('aria-label', '交换区域 ' + (index + 1) + ' 的位置');
      slot.create.setAttribute('aria-label', '区域 ' + (index + 1) + ' 新建会话');
    }
    state.active = active.index;
    if (state.expanded != null) { Object.assign(state, state.beforeExpand); state.expanded = null; }
    for (const slot of slots) { slot.expand.textContent = '放大'; slot.expand.setAttribute('aria-pressed', 'false'); }
    layout(); save(); host.__codexConversationPreviewInjection__?.refresh?.();
  }
  function swapHandle(slot) {
    const handle = button('⠿', () => {}); handle.className = 'nuyoah-chat-grid-swap';
    handle.setAttribute('aria-label', '交换区域 ' + (slot.index + 1) + ' 的位置');
    handle.title = '拖动交换位置；方向键移动';
    handle.onclick = event => event.stopPropagation();
    handle.onpointerdown = event => {
      if (event.button !== 0) return;
      swapping = { slot, x: event.clientX, y: event.clientY, to: slot.index, moved: false };
      handle.focus({ preventScroll: true });
      handle.setPointerCapture?.(event.pointerId); event.preventDefault();
    };
    handle.onpointermove = event => {
      if (!swapping || swapping.slot !== slot) return;
      if (Math.hypot(event.clientX - swapping.x, event.clientY - swapping.y) < 6 && !swapping.moved) return;
      swapping.moved = true; view.dataset.swapping = 'true'; swapping.to = -1;
      for (const candidate of slots) {
        const r = candidate.el.getBoundingClientRect(), over = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
        candidate.el.toggleAttribute('data-swap-target', over && candidate !== slot);
        if (over) swapping.to = candidate.index;
      }
    };
    handle.onpointerup = () => { const drag = swapping; cancelSwap(); if (drag?.moved) swap(slot.index, drag.to); };
    handle.onpointercancel = cancelSwap;
    handle.onkeydown = event => {
      const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }[event.key];
      if (!offset) return;
      event.preventDefault(); event.stopPropagation();
      if (Math.abs(offset) === 2 || (offset === -1 ? slot.index % 2 === 1 : slot.index % 2 === 0)) swap(slot.index, slot.index + offset);
    };
    return handle;
  }
  function keydown(event) {
    if (!state.open) return;
    if (event.key === 'Tab') keyboardFocusUntil = Date.now() + 500;
    if (event.key === 'Escape' && swapping) { cancelSwap(); event.preventDefault(); event.stopPropagation(); return; }
    if (event.key === 'Escape' && dragging) { Object.assign(state, dragging.before); dragging = null; view.removeAttribute('data-dragging'); layout(); event.preventDefault(); event.stopPropagation(); return; }
    if (event.key === 'Escape' && event.target === entry) { close(); event.preventDefault(); event.stopPropagation(); }
  }
  function separator(axis, label) {
    const el = node('div', 'nuyoah-chat-grid-divider divider-' + axis); el.dataset.axis = axis;
    el.setAttribute('role', 'separator'); el.tabIndex = 0; el.setAttribute('aria-label', label);
    el.setAttribute('aria-orientation', axis === 'y' ? 'horizontal' : 'vertical'); el.setAttribute('aria-valuemin', '20'); el.setAttribute('aria-valuemax', '80');
    el.onpointerdown = event => {
      if (event.button !== 0) return;
      dragging = { axis, before: { x: state.x, y: state.y } }; view.dataset.dragging = axis;
      el.setPointerCapture?.(event.pointerId); event.preventDefault();
    };
    el.onpointermove = move; el.onpointerup = endDrag; el.onpointercancel = () => {
      if (dragging) { Object.assign(state, dragging.before); dragging = null; view.removeAttribute('data-dragging'); layout(); }
    };
    el.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
      if (event.key === 'Home') { state.x = .5; state.y = .5; }
      else if (axis.includes('x') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) state.x = ratio(state.x + (event.key === 'ArrowLeft' ? -.03 : .03));
      else if (axis.includes('y') && ['ArrowUp', 'ArrowDown'].includes(event.key)) state.y = ratio(state.y + (event.key === 'ArrowUp' ? -.03 : .03));
      event.preventDefault(); event.stopPropagation(); layout(); save();
    };
    return el;
  }
  async function open() {
    if (destroyed || state.open || opening) return;
    opening = true;
    const generation = ++state.generation;
    try { await adapter.prepare?.(); } catch { opening = false; restoreOpen = false; feedback('当前版本暂时无法打开四宫格，请继续使用单聊。'); return; }
    opening = false;
    if (destroyed || generation !== state.generation) return;
    original = currentTarget(); if (!original) { feedback('请先打开一个 Codex 对话。'); return; }
    const source = nativeArea(), rect = source?.getBoundingClientRect();
    if (!rect || rect.width < 540 || rect.height < 440) { feedback('请扩大聊天区域后再打开四宫格。'); return; }
    notice?.remove(); notice = null; state.open = true; state.suspended = false; restoreOpen = false; lastLayout = ''; lastNative = identity(original);
    const restoring = targets.some(Boolean), initialTargets = restoring ? targets.slice() : [original, null, null, null];
    if (!restoring) state.active = 0;
    view = node('section', '', ''); view.id = 'nuyoah-chat-grid'; view.setAttribute('aria-label', '四宫格对话');
    const toolbar = node('div', 'nuyoah-chat-grid-toolbar'); toolbar.append(node('span', '', '四宫格'));
    toolbar.append(button('恢复等分', () => { state.x = .5; state.y = .5; state.expanded = null; for (const slot of slots) slot.expand.textContent = '放大'; layout(); save(); }));
    toolbar.append(button('返回单聊', () => close())); view.append(toolbar);
    area = node('div', 'nuyoah-chat-grid-area'); view.append(area); slots = []; pickerSignature = '';
    for (let index = 0; index < 4; index++) {
      const el = node('section', 'nuyoah-chat-grid-slot'); el.dataset.slot = String(index); el.setAttribute('aria-label', '对话区域 ' + (index + 1));
      const head = node('div', 'nuyoah-chat-grid-slot-head'), picker = node('select'); picker.setAttribute('aria-label', '区域 ' + (index + 1) + ' 的对话');
      const slot = { index, el, picker, target: null, session: null, generation: 0 };
      picker.onchange = () => void bind(slot.index, catalog().find(task => pickerValue(task) === picker.value) || null);
      const expandButton = button('放大', () => expand(slot.index)); expandButton.disabled = true;
      slot.handle = swapHandle(slot);
      slot.create = button('新建会话', () => void newChat(slot.index)); slot.create.setAttribute('aria-label', '区域 ' + (index + 1) + ' 新建会话');
      head.append(slot.handle, picker, slot.create, expandButton, button('移除', () => void bind(slot.index, null)));
      const status = node('div', 'nuyoah-chat-grid-slot-status', '新建会话，或选择已有对话'); status.setAttribute('role', 'status');
      const body = node('div', 'nuyoah-chat-grid-native');
      el.append(head, status, body); el.addEventListener('pointerdown', event => {
        activate(slot.index, false);
        const editor = event.target.closest?.('[contenteditable="true"], textarea');
        if (editor && body.contains(editor)) requestFocus(slot.index, editor);
      }, true);
      el.addEventListener('click', () => { if (state.open && state.active === slot.index && slot.target) navigate(slot.target); });
      el.onfocusin = event => {
        if (state.active === slot.index) return;
        if (Date.now() < keyboardFocusUntil) { activate(slot.index); if (body.contains(event.target)) requestFocus(slot.index, event.target); return; }
        // A background native composer may request focus after hydration.
        // Only explicit pointer or Tab selection changes the active task.
        event.target.blur?.();
        slots[state.active]?.body.querySelector('[contenteditable="true"], textarea')?.focus();
      };
      area.append(el); Object.assign(slot, { expand: expandButton, status, body }); slots.push(slot);
    }
    area.append(separator('x', '调整左右对话宽度'), separator('y', '调整上下对话高度'), separator('xy', '调整四格比例'));
    doc.body.append(view); entry?.setAttribute('aria-expanded', 'true'); layout();
    resizeObserver = new host.ResizeObserver(scheduleLayout); resizeObserver.observe(source);
    const tasks = catalog();
    for (let index = 0; index < 4; index++) if (initialTargets[index]) void bind(index,
      tasks.find(task => identity(task) === identity(initialTargets[index])) || initialTargets[index], { select: false });
    updatePickers(); save();
  }
  function close(message = '') {
    const activeTarget = slots[state.active]?.target;
    cancelFocusRequest();
    if (layoutFrame != null) host.cancelAnimationFrame(layoutFrame); layoutFrame = null;
    cancelSwap(); restoreOpen = false;
    state.generation++; state.open = false; state.suspended = false; dragging = null; save();
    for (const slot of slots) { slot.generation++; slot.session?.dispose(); }
    slots = []; resizeObserver?.disconnect(); resizeObserver = null;
    view?.remove(); view = null; area = null; restoreSource(); entry?.setAttribute('aria-expanded', 'false');
    if (!destroyed && !message && activeTarget) {
      if (!draft(activeTarget)) navigate(activeTarget);
    }
    if (!destroyed) host.__codexConversationPreviewInjection__?.refresh?.();
    if (message) feedback(message);
    if (!destroyed) entry?.focus();
  }
  function sync() {
    if (destroyed) return;
    const nativeEntry = doc.getElementById('nuyoah-workstation-entry');
    if (!nativeEntry?.parentElement) { if (entry?.isConnected) entry.remove(); suspend(); return; }
    if (!entry) { entry = button('四宫格', () => state.open ? close() : void open()); entry.id = 'nuyoah-chat-layout-entry'; entry.setAttribute('aria-expanded', 'false'); }
    if (entry.parentElement !== nativeEntry.parentElement) nativeEntry.after(entry);
    if (resizeTimer != null && state.open && !state.suspended) { scheduleLayout(); return; }
    if (!state.open) { if (restoreOpen && adapter.current() && nativeArea()) void open(); return; }
    const current = adapter.current(), id = identity(current);
    updatePickers();
    if (!id) { suspend(); return; }
    if (state.suspended) {
      const source = nativeArea(), rect = source?.getBoundingClientRect();
      if (!rect || rect.width < 540 || rect.height < 440) return;
      state.suspended = false; view.hidden = false; lastNative = id; navigating = null;
      resizeObserver?.observe(source); entry.setAttribute('aria-expanded', 'true');
      layout(); host.__codexConversationPreviewInjection__?.refresh?.(); return;
    }
    if (navigating) {
      if (id === navigating.id || Date.now() > navigating.until) { lastNative = id; navigating = null; }
    } else if (id && id !== lastNative) {
      lastNative = id;
      const existing = slots.find(slot => identity(slot.target) === id);
      if (existing) activate(existing.index, false);
      else void bind(state.active, currentTarget(), { select: false });
    }
    scheduleLayout();
  }
  const style = node('style'); style.id = 'nuyoah-chat-grid-style'; style.textContent = `
    #nuyoah-chat-layout-entry{border:0;border-radius:6px;padding:5px 9px;color:inherit;background:var(--color-token-bg-secondary,#8881);font:inherit;font-size:12px;cursor:pointer}
    #nuyoah-chat-grid{position:fixed;z-index:41;display:flex;flex-direction:column;overflow:hidden;color:var(--color-token-text-primary,inherit);background:var(--color-token-bg-primary,Canvas);font-family:inherit;box-sizing:border-box}
    #nuyoah-chat-grid *{box-sizing:border-box}
    #nuyoah-chat-grid[hidden]{display:none!important}
    #nuyoah-chat-grid .nuyoah-chat-grid-toolbar{height:32px;flex-shrink:0;display:flex;align-items:center;gap:8px;padding:0 8px;border-bottom:1px solid var(--color-token-border-secondary,#8883);font-size:12px}
    #nuyoah-chat-grid .nuyoah-chat-grid-toolbar>span{margin-right:auto}
    #nuyoah-chat-grid button{border:0;border-radius:5px;background:var(--color-token-bg-secondary,#8881);color:inherit;padding:3px 7px;font:inherit;font-size:12px;cursor:pointer}
    #nuyoah-chat-grid button:disabled{opacity:.45;cursor:default}
    #nuyoah-chat-grid button:focus-visible,#nuyoah-chat-grid select:focus-visible,#nuyoah-chat-grid [role=separator]:focus-visible{outline:2px solid var(--color-token-text-link,#568bdd);outline-offset:-2px}
    #nuyoah-chat-grid .nuyoah-chat-grid-area{position:relative;display:grid;gap:8px;flex:1;min-height:0;padding:0}
    #nuyoah-chat-grid .nuyoah-chat-grid-slot{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;border:1px solid var(--color-token-border-secondary,#8883);border-radius:5px;background:var(--color-token-bg-primary,Canvas)}
    #nuyoah-chat-grid .nuyoah-chat-grid-slot[data-active=true]{border-color:var(--color-token-text-link,#568bdd)}
    #nuyoah-chat-grid .nuyoah-chat-grid-slot[data-swap-target]{outline:2px solid var(--color-token-text-link,#568bdd);outline-offset:-2px}
    #nuyoah-chat-grid .nuyoah-chat-grid-swap{cursor:grab;touch-action:none;font-size:16px;padding:0 4px}
    #nuyoah-chat-grid .nuyoah-chat-grid-slot-head{display:flex;align-items:center;gap:4px;padding:4px 5px;flex-shrink:0;border-bottom:1px solid var(--color-token-border-secondary,#8883);font-size:12px}
    #nuyoah-chat-grid select{flex:1;width:0;min-width:0;max-width:100%;border:0;background:transparent;color:inherit;font:inherit;overflow:hidden;text-overflow:ellipsis}
    #nuyoah-chat-grid option{background:var(--color-token-bg-primary,Canvas);color:var(--color-token-text-primary,CanvasText)}
    #nuyoah-chat-grid .nuyoah-chat-grid-slot-status{font-size:13px;padding:8px;text-align:center}
    #nuyoah-chat-grid .nuyoah-chat-grid-slot-status:empty{display:none}
    #nuyoah-chat-grid .nuyoah-chat-grid-native{flex:1;min-width:0;min-height:0;position:relative;display:flex;flex-direction:column;overflow:hidden}
    #nuyoah-chat-grid .nuyoah-chat-grid-native>div{min-width:0;min-height:0;max-width:100%;flex:1}
    #nuyoah-chat-grid .nuyoah-chat-grid-surface{display:flex;flex-direction:column;height:100%;overflow:hidden}
    #nuyoah-chat-grid [data-app-action-timeline-scroll]{min-width:0!important;max-width:100%!important;height:100%;flex:1}
    #nuyoah-chat-grid [data-app-action-timeline-scroll]>div{max-width:100%}
    #nuyoah-chat-grid .nuyoah-chat-grid-divider{position:absolute;z-index:5;touch-action:none}
    #nuyoah-chat-grid .divider-x{left:calc(var(--split-x) - 4px);top:0;bottom:0;width:8px;cursor:col-resize}
    #nuyoah-chat-grid .divider-y{top:calc(var(--split-y) - 4px);left:0;right:0;height:8px;cursor:row-resize}
    #nuyoah-chat-grid .divider-xy{left:calc(var(--split-x) - 8px);top:calc(var(--split-y) - 8px);width:16px;height:16px;cursor:move;background:var(--color-token-bg-secondary,#8882);border-radius:4px}
    #nuyoah-chat-grid[data-dragging] .nuyoah-chat-grid-native{pointer-events:none}
    #nuyoah-chat-grid[data-swapping] .nuyoah-chat-grid-native{pointer-events:none}
    .nuyoah-chat-grid-notice{font-size:12px;max-width:320px}
    @media(prefers-reduced-motion:reduce){#nuyoah-chat-grid *{animation-duration:0s!important;transition-duration:0s!important}}
  `;
  doc.head.append(style); sync();
  observer = new host.MutationObserver(() => { if (!timer) timer = host.setTimeout(() => { timer = null; sync(); }, 120); });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  host.addEventListener('resize', resize); doc.addEventListener('keydown', keydown, true);
  doc.addEventListener('pointerdown', cancelFocusRequest, true);
  const interval = host.setInterval(sync, 800);
  return { open, close, bind, activate, swap, sync, newChat, selectTask, isOpen: () => state.open && !state.suspended, currentTarget: () => state.open && !state.suspended ? slots[state.active]?.target || null : null,
    composer: () => state.open && !state.suspended ? slots[state.active]?.body.querySelector('[contenteditable="true"]') || null : null,
    snapshot: () => ({ open: state.open && !state.suspended, suspended: state.suspended, active: state.active, x: state.x, y: state.y,
    slots: slots.map(slot => ({ target: slot.target, loaded: slot.el.dataset.loaded === 'true' })) }),
    destroy() { if (destroyed) return; const resume = state.open || restoreOpen; destroyed = true; close();
      try { storage.setItem(key, JSON.stringify({ ...JSON.parse(storage.getItem(key)), open: resume })); } catch {}
      observer.disconnect(); host.clearTimeout(timer); host.clearInterval(interval);
      host.clearTimeout(resizeTimer); host.removeEventListener('resize', resize); doc.removeEventListener('keydown', keydown, true); doc.removeEventListener('pointerdown', cancelFocusRequest, true); entry?.remove(); notice?.remove(); style.remove(); },
  };
}
