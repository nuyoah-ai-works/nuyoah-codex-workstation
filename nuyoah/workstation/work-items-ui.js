(() => {
  window.__nuyoahWorkItemsUI__?.destroy?.();
  const queue = [], itemStates = { idea: '想法', todo: '待推进', doing: '推进中', waiting: '等待中', done: '已完成', paused: '已暂停' };
  const nodeStates = { todo: '待推进', doing: '推进中', waiting: '等待中', done: '已完成' };
  const kinds = { goal: '目标', milestone: '里程碑', next: '下一步', blocker: '阻塞', note: '补充' };
  const state = { data: null, pending: null, draft: null, dirty: false, draftRevision: 0, tasks: [], context: {}, options: {}, lastRead: 0, query: '', direction: '', archived: false, itemLimit: 30, nodeId: null, planView: 'graph', overviewView: 'canvas', detailsOpen: false, taskQuery: '', taskLimit: 30 };
  const clone = value => JSON.parse(JSON.stringify(value));
  const identity = value => JSON.stringify([value.hostId || 'local', value.threadId]);
  const hasCanvas = () => Boolean(window.__nuyoahWorkCanvas__?.create);
  const writing = () => state.pending && state.pending.action !== 'read';
  const el = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
  function button(text, action, label) { const element = el('button', text); element.type = 'button'; element.onclick = action; if (label) element.setAttribute('aria-label', label); return element; }
  function field(label, input) { const holder = el('label', undefined, 'nuyoah-work-field'); holder.append(el('span', label), input); return holder; }
  function input(label, value, oninput, multiline = false) {
    const element = el(multiline ? 'textarea' : 'input'); element.value = value || ''; element.setAttribute('aria-label', label); element.maxLength = multiline ? 8000 : 500;
    if (multiline) element.rows = 3;
    element.oninput = () => oninput(element.value); return element;
  }
  function select(label, choices, value, onchange) {
    const element = el('select'); element.setAttribute('aria-label', label);
    for (const [key, text] of Object.entries(choices)) { const option = el('option', text); option.value = key; element.append(option); }
    element.value = value; element.onchange = () => onchange(element.value); return element;
  }
  function message(text) { state.status.textContent = text; }
  function markDirty() { state.dirty = true; state.save.disabled = Boolean(state.pending) || !state.draft?.title.trim() || stale(); state.cancel.textContent = '放弃草稿'; state.editNotice.textContent = stale() ? '记录已有更新，草稿已保留。请查看最新记录后重新编辑。' : '有未保存的修改'; updateOverviewCanvas(); updatePlanCanvas(); }
  function stale() { return state.draft && state.draftRevision !== state.data?.revision; }
  function request(action, extra = {}) {
    if (state.pending) return;
    const id = crypto.randomUUID(); state.pending = { id, action, ...extra };
    if (action !== 'read' || !state.data) message(action === 'read' ? '正在读取…' : '正在保存…');
    if (state.save) state.save.disabled = true;
    if (action !== 'read') for (const control of state.editor.querySelectorAll('button,input,textarea,select')) control.disabled = true;
    state.timer = setTimeout(() => {
      if (state.pending?.id !== id) return;
      state.pending = null; if (action !== 'read' && state.draft) renderEditor(); message('未收到结果，请重新读取核对。草稿已保留。'); if (state.save) state.save.disabled = true;
    }, 18000);
    queue.push({ id, consumer: 'work-items', action, ...extra });
  }
  function download(value, suffix = '') {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = `work-items${suffix}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function choose(item) {
    if (writing()) { message('正在保存，请稍候。'); return; }
    if (state.dirty) { if (item.id && state.draft?.id === item.id) { state.editor.hidden = false; return; } message('请先保存或放弃当前草稿。'); state.editor.hidden = false; return; }
    state.draft = clone(item); state.baseItem = clone(item); state.draftRevision = state.data.revision; state.nodeId = null; state.taskQuery = ''; state.taskLimit = 30; state.detailsOpen = !item.id; state.draftCanvasId = item.id || crypto.randomUUID();
    closeMenu(); renderEditor(); state.editor.hidden = false; updateOverviewCanvas();
    if (!item.id) state.titleInput.focus(); else state.overviewCanvas?.focus?.(`item:${item.id}`);
  }
  function newItem() {
    if (!state.data || state.pending) return;
    choose({ id: '', title: '', direction: state.direction, nextStep: '', note: '', status: 'idea', focus: false, archived: false, threadLinks: [], nodes: [] });
  }
  function cancelDraft() { state.planCanvas?.destroy(); state.planCanvas = null; state.draft = null; state.dirty = false; state.nodeId = null; state.editor.hidden = true; state.editor.replaceChildren(); updateOverviewCanvas(); message(''); }
  function closeMenu() { state.menu.hidden = true; state.menuButton.setAttribute('aria-expanded', 'false'); }
  function showFilters() { closeMenu(); state.filters.hidden = false; state.search.focus(); }
  function updateFilterLabel() { state.menuButton.title = state.query || state.direction || state.archived ? '工作事项选项 · 筛选中' : '工作事项选项'; }
  function dismiss() {
    if (!state.root) return false;
    if (!state.menu.hidden) { closeMenu(); state.menuButton.focus(); return true; }
    if (!state.filters.hidden) { state.filters.hidden = true; state.menuButton.focus(); return true; }
    if (!state.editor.hidden && !writing()) { state.editor.hidden = true; if (state.dirty) message('草稿已保留。'); state.add.focus(); return true; }
    return false;
  }
  function build() {
    state.root = el('section', undefined, 'nuyoah-work-items');
    const heading = el('div', undefined, 'nuyoah-work-toolbar'); heading.setAttribute('aria-label', '工作事项工具栏');
    const modes = el('div', undefined, 'nuyoah-work-view-modes'); modes.setAttribute('aria-label', '事项视图'); state.overviewModes = modes;
    state.canvasMode = button('画布', () => { state.overviewView = 'canvas'; renderList(); });
    state.listMode = button('列表', () => { state.overviewView = 'list'; renderList(); }, '事项列表');
    modes.append(state.canvasMode, state.listMode); heading.append(modes);
    const tools = el('div', undefined, 'nuyoah-work-toolbar-tools');
    state.add = button('新建事项', newItem); state.add.disabled = true;
    state.menuButton = button('···', () => { state.menu.hidden = !state.menu.hidden; state.menuButton.setAttribute('aria-expanded', String(!state.menu.hidden)); if (!state.menu.hidden) state.filterButton.focus(); }, '工作事项选项');
    state.menuButton.setAttribute('aria-expanded', 'false'); state.menuButton.setAttribute('aria-controls', 'nuyoah-work-items-menu');
    tools.append(state.add, state.menuButton); heading.append(tools); state.root.append(heading);
    state.menu = el('div', undefined, 'nuyoah-work-menu'); state.menu.id = 'nuyoah-work-items-menu'; state.menu.hidden = true; state.menu.setAttribute('aria-label', '更多事项操作');
    state.filterButton = button('查找与筛选', showFilters);
    const archiveFilter = button('已归档事项', () => { state.archived = true; state.rangeSelect.value = 'archived'; state.itemLimit = 30; showFilters(); renderList(); });
    const reload = button('刷新', () => { closeMenu(); request('read'); }, '重新读取工作事项');
    const exportButton = button('导出记录', () => { closeMenu(); if (state.data) download(state.data); });
    state.menu.append(state.filterButton, archiveFilter, reload, exportButton); state.root.append(state.menu);
    state.status = el('p', '', 'nuyoah-work-status'); state.status.setAttribute('role', 'status'); state.root.append(state.status);
    const filters = el('div', undefined, 'nuyoah-work-filters'); state.filters = filters; filters.hidden = true; filters.setAttribute('aria-label', '查找与筛选工作事项');
    const search = input('搜索工作事项', '', value => { state.query = value; state.itemLimit = 30; renderList(); }); search.placeholder = '搜索事项或下一步';
    state.search = search;
    state.directionSelect = select('工作方向', { '': '所有方向' }, '', value => { state.direction = value; state.itemLimit = 30; renderList(); });
    const archived = select('事项范围', { active: '当前事项', archived: '已归档' }, 'active', value => { state.archived = value === 'archived'; state.itemLimit = 30; renderList(); });
    state.rangeSelect = archived;
    const clear = button('清除筛选', () => { state.query = ''; state.direction = ''; state.archived = false; search.value = ''; state.directionSelect.value = ''; archived.value = 'active'; state.itemLimit = 30; renderList(); });
    filters.append(search, state.directionSelect, archived, clear, button('收起筛选', () => { filters.hidden = true; state.menuButton.focus(); })); state.root.append(filters);
    state.stage = el('div', undefined, 'nuyoah-work-stage'); state.root.append(state.stage);
    const main = el('div', undefined, 'nuyoah-work-main'); state.stage.append(main);
    state.canvasHost = el('div', undefined, 'nuyoah-work-canvas-host'); state.canvasHost.setAttribute('aria-label', '工作事项画布'); main.append(state.canvasHost);
    state.list = el('div', undefined, 'nuyoah-work-list'); main.append(state.list);
    state.moreItems = el('div', undefined, 'nuyoah-work-more'); main.append(state.moreItems);
    state.editor = el('section', undefined, 'nuyoah-work-editor'); state.editor.hidden = true; state.editor.setAttribute('role', 'region'); state.editor.setAttribute('aria-label', '事项详情'); state.stage.append(state.editor);
    state.root.onkeydown = event => {
      if (event.key !== 'Escape' || !dismiss()) return;
      event.preventDefault(); event.stopPropagation();
    };
  }
  function renderDirections() {
    const values = [...new Set((state.data?.items || []).map(item => item.direction).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (state.direction && !values.includes(state.direction)) values.unshift(state.direction);
    state.directionSelect.replaceChildren();
    for (const [value, label] of [['', '所有方向'], ...values.map(value => [value, value])]) { const option = el('option', label); option.value = value; state.directionSelect.append(option); }
    state.directionSelect.value = state.direction;
  }
  function selectedItems() {
    const query = state.query.trim().toLocaleLowerCase();
    return (state.data?.items || []).filter(item => Boolean(item.archived) === state.archived && (!state.direction || item.direction === state.direction) && (!query || `${item.title} ${item.direction} ${item.nextStep}`.toLocaleLowerCase().includes(query)))
      .sort((a, b) => Number(b.focus) - Number(a.focus));
  }
  function renderList() {
    state.list.replaceChildren(); state.moreItems.replaceChildren(); updateFilterLabel();
    const canvas = hasCanvas() && state.overviewView === 'canvas';
    state.canvasMode.hidden = !hasCanvas();
    state.canvasMode.setAttribute('aria-pressed', String(canvas)); state.listMode.setAttribute('aria-pressed', String(!canvas));
    state.canvasHost.hidden = !canvas; state.list.hidden = canvas;
    if (!state.data) return;
    const items = selectedItems();
    if (!items.length) {
      state.overviewCanvas?.update({ nodes: [], edges: [], selectedId: '' }); state.canvasHost.hidden = true; state.list.hidden = false;
      const empty = el('div', undefined, 'nuyoah-work-empty');
      empty.append(el('strong', state.data.items.length ? '没有符合筛选的事项' : '记下一件想推进的事'), el('p', state.data.items.length ? '调整筛选，或新建一件事项。' : '可以是一个想法，也可以是一个长期方向。'));
      empty.append(button('新建事项', newItem, state.data.items.length ? '创建工作事项' : '创建第一件事项')); state.list.append(empty);
    }
    else if (canvas) updateOverviewCanvas();
    else for (const item of items.slice(0, state.itemLimit)) {
      const card = button('', () => choose(item)); card.className = 'nuyoah-work-card'; card.setAttribute('aria-label', `编辑事项：${item.title}`);
      const top = el('span', undefined, 'nuyoah-work-card-title'); top.append(el('strong', item.title)); if (item.focus) top.append(el('span', '重点', 'nuyoah-work-badge'));
      const meta = [item.direction, itemStates[item.status], item.threadLinks.length ? `${item.threadLinks.length} 个关联任务` : ''].filter(Boolean).join(' · ');
      card.append(top, el('span', meta, 'nuyoah-work-muted'));
      if (item.nextStep) card.append(el('span', `下一步 · ${item.nextStep}`, 'nuyoah-work-next'));
      state.list.append(card);
    }
    if (items.length > state.itemLimit) state.moreItems.append(button(`显示更多事项（还有 ${items.length - state.itemLimit} 项）`, () => { state.itemLimit += 30; renderList(); }));
  }
  function updateOverviewCanvas() {
    if (!hasCanvas() || !state.canvasHost || state.overviewView !== 'canvas' || !state.data) return;
    if (!state.overviewCanvas) state.overviewCanvas = window.__nuyoahWorkCanvas__.create({ container: state.canvasHost, storageKey: 'nuyoah.work-items-canvas.v1', onActivate(value) {
      const id = typeof value === 'string' ? value : value?.id, target = state.canvasTargets?.get(id); if (!target) return;
      if (target.type === 'direction') { state.direction = target.value; state.directionSelect.value = target.value; state.itemLimit = 30; renderList(); state.overviewCanvas.focus?.(id); }
      else if (target.type === 'item') choose(target.value);
      else if (target.type === 'task') { const task = resolved(target.value); if (task) state.options.openTask?.(task); else message('关联任务尚未同步。'); }
    } });
    const items = selectedItems().slice(0, state.itemLimit), groups = new Map(), nodes = [], edges = []; state.canvasTargets = new Map();
    for (const item of items) { const key = item.direction || ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
    let y = 0; const tones = ['sage', 'blue', 'peach', 'lilac']; let groupIndex = 0;
    for (const [direction, group] of groups) {
      const directionId = `direction:${encodeURIComponent(direction)}`, tone = tones[groupIndex++ % tones.length];
      nodes.push({ id: directionId, title: direction || '未分方向', subtitle: `${group.length} 件事项`, badge: '工作方向', kind: 'direction', tone, x: 0, y: y + (group.length - 1) * 100 });
      state.canvasTargets.set(directionId, { type: 'direction', value: direction });
      for (const saved of group) {
        const item = state.draft?.id === saved.id ? state.draft : saved, itemId = `item:${item.id}`, itemY = y;
        nodes.push({ id: itemId, title: item.title, subtitle: item.nextStep ? `下一步 · ${item.nextStep}` : '下一步待记录', badge: [item.focus ? '重点' : '', itemStates[item.status], state.dirty && state.draft?.id === item.id ? '未保存' : ''].filter(Boolean).join(' · '), kind: 'item', tone, x: 300, y: itemY });
        edges.push({ from: directionId, to: itemId }); state.canvasTargets.set(itemId, { type: 'item', value: saved });
        if (state.draft?.id === item.id) item.threadLinks.forEach((link, index) => {
          const task = resolved(link), taskId = `task:${identity(link)}`;
          nodes.push({ id: taskId, title: task?.title || `${link.threadId.slice(0, 8)} · 待同步`, subtitle: task ? (link.hostId === 'local' ? '本机任务' : '远程任务') : '关联任务尚未同步', badge: task?.statusLabel || '待同步', kind: 'task', tone: 'lilac', x: 620, y: itemY + index * 200 });
          edges.push({ from: itemId, to: taskId }); state.canvasTargets.set(taskId, { type: 'task', value: link });
        });
        y += Math.max(200, state.draft?.id === item.id ? item.threadLinks.length * 200 : 0);
      }
      y += 70;
    }
    state.overviewCanvas.update({ nodes, edges, selectedId: state.draft?.id ? `item:${state.draft.id}` : '' });
  }
  function maintain() {
    const command = window.__NUYOAH_WORKSTATION_CONFIG__?.workItemsCommand || [];
    if (!command.length || !state.options.insertText) { message('当前输入区不可用。'); return; }
    if (!state.draft?.id || state.dirty) { message('请先保存事项，再请助手更新。'); return; }
    const ok = state.options.insertText(`请核对工作事项 ${JSON.stringify(state.draft.title)}（事项 ID：${state.draft.id}）。先使用 ${command.map(value => JSON.stringify(value)).join(' ')} read ${state.draft.id} 读取该事项及 revision，将更新后的完整 item 写入临时 JSON 文件，再执行同一命令 save <JSON文件> <已读取的revision>。仅更新这件事项的已知进展、下一步及计划节点的记录状态。保留稳定节点 ID、计划主线、手动状态覆盖和其他事项；结构确需变化时说明原因。任务停止运行不代表事项完成，不代替用户确认验收；无实质变化无需写入。关联任务的摘要与产出沿用原工作台，不复制材料，不读取远程正文。`);
    message(ok ? '已插入，发送后由助手核对。' : '当前输入区不可用。');
  }
  function renderEditor() {
    const item = state.draft; if (!item) return; state.planCanvas?.destroy(); state.planCanvas = null; state.editor.replaceChildren();
    const heading = el('div', undefined, 'nuyoah-work-actions nuyoah-work-inspector-heading'); heading.append(el('h3', item.title || '新建事项', 'nuyoah-work-inspector-title'));
    state.cancel = button(state.dirty ? '放弃草稿' : '关闭', cancelDraft); heading.append(state.cancel); state.editor.append(heading);
    if (item.id) {
      state.editor.append(el('p', [item.direction, itemStates[item.status], item.focus ? '重点' : ''].filter(Boolean).join(' · '), 'nuyoah-work-muted'));
      if (item.nextStep) state.editor.append(el('p', item.nextStep, 'nuyoah-work-inspector-next'));
    }
    state.editNotice = el('p', state.dirty ? '有未保存的修改' : '', 'nuyoah-work-status'); state.editNotice.setAttribute('role', 'status'); state.editor.append(state.editNotice);
    state.conflict = el('div', undefined, 'nuyoah-work-conflict'); state.editor.append(state.conflict);
    const details = el('details', undefined, 'nuyoah-work-item-details'); details.open = state.detailsOpen; details.append(el('summary', '编辑事项')); state.itemDetails = details;
    details.ontoggle = () => { if (state.itemDetails === details) state.detailsOpen = details.open; }; state.editor.append(details);
    state.titleInput = input('事项名称', item.title, value => { item.title = value; markDirty(); }); state.titleInput.required = true; state.titleInput.maxLength = 240;
    details.append(field('事项名称', state.titleInput));
    const direction = input('工作方向', item.direction, value => { item.direction = value; markDirty(); }); direction.placeholder = '如产品、内容、日常'; direction.maxLength = 120;
    details.append(field('工作方向', direction));
    const status = select('事项状态', itemStates, item.status, value => { item.status = value; markDirty(); });
    const focus = el('input'); focus.type = 'checkbox'; focus.checked = item.focus; focus.onchange = () => { item.focus = focus.checked; markDirty(); };
    const focusLabel = el('label', undefined, 'nuyoah-work-check'); focusLabel.append(focus, el('span', '设为重点'));
    const row = el('div', undefined, 'nuyoah-work-actions'); row.append(field('事项状态', status), focusLabel); details.append(row);
    const nextStep = input('下一步', item.nextStep, value => { item.nextStep = value; markDirty(); }, true); nextStep.maxLength = 2000;
    const note = input('补充说明', item.note, value => { item.note = value; markDirty(); }, true); note.maxLength = 16000;
    details.append(field('下一步', nextStep), field('补充说明', note));
    const related = el('section', undefined, 'nuyoah-work-related'); related.append(el('strong', '关联任务')); state.linkList = el('div'); related.append(state.linkList);
    const picker = el('details'); picker.append(el('summary', '添加关联任务'));
    const taskSearch = input('查找可关联任务', state.taskQuery, value => { state.taskQuery = value; state.taskLimit = 30; renderTaskPicker(); }); taskSearch.placeholder = '按任务名称查找'; picker.append(taskSearch);
    state.taskChoices = el('div', undefined, 'nuyoah-work-task-choices'); picker.append(state.taskChoices); related.append(picker); details.append(related);
    state.plan = el('section', undefined, 'nuyoah-work-plan'); state.editor.append(state.plan);
    const actions = el('div', undefined, 'nuyoah-work-actions nuyoah-work-save-actions');
    state.save = button('保存事项', () => {
      if (state.pending || stale() || !state.draft.title.trim()) return;
      const unnamed = state.draft.nodes.find(node => !node.title.trim());
      if (unnamed) { state.nodeId = unnamed.id; renderPlan(); state.nodeTitle.focus(); message('请填写节点名称后保存。'); return; }
      // Reuse this identity after a timeout: a lost response must not create a second item.
      if (!state.draft.id) state.draft.id = state.draftCanvasId || crypto.randomUUID();
      request('save', { item: clone(state.draft), revision: state.draftRevision });
    });
    state.save.disabled = Boolean(state.pending) || stale() || !item.title.trim(); actions.append(state.save, button('请助手更新', maintain));
    if (item.id) actions.append(button(item.archived ? '恢复事项' : '归档事项', () => {
      if (state.dirty) { message('请先保存或放弃当前草稿。'); return; }
      request('archive', { itemId: item.id, archived: !item.archived, revision: state.draftRevision });
    }));
    state.editor.append(actions); renderLinks(); renderTaskPicker(); renderPlan(); renderConflict();
  }
  function renderConflict() {
    if (!state.conflict || !state.draft) return; state.conflict.replaceChildren(); if (!stale()) return;
    state.save.disabled = true; state.editNotice.textContent = '记录已有更新，草稿已保留。请查看最新记录后重新编辑。';
    const current = state.data.items.find(item => item.id === state.draft.id);
    const details = el('details'); details.append(el('summary', '查看最新记录'));
    if (current) {
      details.append(el('strong', current.title), el('p', [current.direction, itemStates[current.status]].filter(Boolean).join(' · ')), el('p', `下一步 · ${current.nextStep || '尚未填写'}`));
      if (current.note) details.append(el('p', current.note));
      for (const node of current.nodes) details.append(el('p', `${kinds[node.kind]} · ${node.title} · ${nodeStates[node.manualStatus || node.status]}`));
    } else details.append(el('p', state.draft.id ? '此事项已不在最新记录中。' : '其他事项已有更新。'));
    state.conflict.append(details, button('下载这份草稿', () => download(state.draft, '-draft')), button('放弃草稿并重载', () => {
      const id = state.draft.id; state.dirty = false;
      const latest = state.data.items.find(item => item.id === id); if (latest) choose(latest); else cancelDraft();
    }));
  }
  function resolved(link) { return state.tasks.find(task => identity(task) === identity(link)); }
  function renderLinks() {
    if (!state.linkList || !state.draft) return; state.linkList.replaceChildren();
    for (const link of state.draft.threadLinks) {
      const task = resolved(link), row = el('div', undefined, 'nuyoah-work-link');
      const title = task?.title || `${link.threadId.slice(0, 8)} · 待同步`;
      const open = button(title, () => { if (task) state.options.openTask?.(task); }); open.disabled = !task;
      row.append(open, el('span', task?.statusLabel || '待同步', 'nuyoah-work-muted'), button('移除', () => {
        state.draft.threadLinks = state.draft.threadLinks.filter(value => identity(value) !== identity(link)); markDirty(); renderLinks(); renderTaskPicker();
      }, `移除关联：${title}`)); state.linkList.append(row);
    }
    if (!state.draft.threadLinks.length) state.linkList.append(el('p', '尚未关联任务', 'nuyoah-work-muted'));
  }
  function renderTaskPicker() {
    if (!state.taskChoices || !state.draft) return; state.taskChoices.replaceChildren();
    const query = state.taskQuery.trim().toLocaleLowerCase();
    const unique = [...new Map(state.tasks.filter(task => task.threadId).map(task => [identity(task), task])).values()];
    const tasks = unique.filter(task => (!query || `${task.title || ''} ${task.hostId || 'local'}`.toLocaleLowerCase().includes(query)) && !state.draft.threadLinks.some(link => identity(link) === identity(task)));
    for (const task of tasks.slice(0, state.taskLimit)) {
      const entry = button('', () => { if (state.draft.threadLinks.length >= 100) { message('每个事项最多关联 100 个任务。'); return; } state.draft.threadLinks.push({ hostId: task.hostId || 'local', threadId: task.threadId }); markDirty(); renderLinks(); renderTaskPicker(); }); entry.className = 'nuyoah-work-task-choice';
      entry.append(el('span', task.title || '未命名任务'), el('span', [task.hostId && task.hostId !== 'local' ? task.hostId : '本机', task.statusLabel, task.threadId.slice(0, 8)].filter(Boolean).join(' · '), 'nuyoah-work-muted'));
      state.taskChoices.append(entry);
    }
    if (!tasks.length) state.taskChoices.append(el('p', '没有可添加的任务。', 'nuyoah-work-muted'));
    if (tasks.length > state.taskLimit) state.taskChoices.append(button('显示更多任务', () => { state.taskLimit += 50; renderTaskPicker(); }));
  }
  function effective(node) { return node.manualStatus || node.status; }
  function childrenOf(parentId) { return state.draft.nodes.filter(node => (node.parentId || '') === parentId); }
  function nodeButton(node) {
    const pick = button('', () => { if (writing()) return; state.nodeId = node.id; renderNodeEditor(); state.nodeTitle?.focus(); }); pick.className = 'nuyoah-work-node';
    pick.setAttribute('aria-label', `编辑节点：${node.title || '未命名节点'}`);
    const label = el('span', `${kinds[node.kind]} · ${node.title || '未命名节点'}`); state.nodeLabels.set(node.id, label);
    pick.append(label, el('span', `${nodeStates[effective(node)]}${node.manualStatus ? ' · 手动' : ''}`, 'nuyoah-work-muted')); return pick;
  }
  function updatePlanCanvas() {
    if (!state.planCanvas || !state.draft) return;
    const item = state.draft, nodes = [{ id: 'root', title: item.title || '工作事项', subtitle: item.nextStep, badge: itemStates[item.status], kind: 'root', tone: 'sage', x: 0, y: 0 }], edges = [], visited = new Set(); let row = 0;
    const append = (node, depth) => {
      if (visited.has(node.id)) return; visited.add(node.id);
      nodes.push({ id: `plan:${node.id}`, title: node.title || '未命名节点', subtitle: kinds[node.kind], badge: `${nodeStates[effective(node)]}${node.manualStatus ? ' · 手动' : ''}`, kind: 'plan', tone: node.kind === 'blocker' ? 'peach' : node.kind === 'next' ? 'blue' : 'lilac', x: depth * 280, y: row++ * 200 });
      edges.push({ from: node.parentId ? `plan:${node.parentId}` : 'root', to: `plan:${node.id}` });
      for (const child of childrenOf(node.id)) append(child, depth + 1);
    };
    for (const node of childrenOf('')) append(node, 1);
    for (const node of item.nodes) if (!visited.has(node.id)) append(node, 1);
    nodes[0].y = Math.max(0, (row - 1) * 70);
    state.planCanvas.update({ nodes, edges, selectedId: state.nodeId ? `plan:${state.nodeId}` : 'root' });
  }
  function renderPlan() {
    if (!state.plan || !state.draft) return; state.planCanvas?.destroy(); state.planCanvas = null; state.plan.replaceChildren(); state.nodeLabels = new Map();
    const heading = el('div', undefined, 'nuyoah-work-actions'); heading.append(el('strong', '计划'));
    const add = button('添加节点', () => {
      if (writing()) return;
      if (state.draft.nodes.length >= 200) { message('每个事项最多保存 200 个计划节点。'); return; }
      const node = { id: crypto.randomUUID(), parentId: '', title: '', kind: 'milestone', status: 'todo', manualStatus: null, source: '', updatedAt: null };
      state.draft.nodes.push(node); state.nodeId = node.id; markDirty(); renderPlan(); state.nodeTitle?.focus();
    }); heading.append(add); state.plan.append(heading);
    if (!state.draft.nodes.length) { state.plan.append(el('p', '需要分步推进时，添加计划节点。', 'nuyoah-work-muted')); return; }
    const graph = hasCanvas() && state.planView === 'graph', modes = el('div', undefined, 'nuyoah-work-actions');
    for (const [value, label] of [['graph', '计划图'], ['list', '列表']]) {
      if (value === 'graph' && !hasCanvas()) continue;
      const pick = button(label, () => { state.planView = value; renderPlan(); }, value === 'list' ? '计划列表' : label); pick.setAttribute('aria-pressed', String(value === (graph ? 'graph' : 'list'))); modes.append(pick);
    }
    state.plan.append(modes);
    const body = el('div', undefined, graph ? 'nuyoah-work-canvas-host nuyoah-work-plan-canvas' : 'nuyoah-work-node-list'); body.setAttribute('aria-label', graph ? '事项计划图' : '事项计划列表'); state.plan.append(body);
    if (graph) {
      state.planCanvas = window.__nuyoahWorkCanvas__.create({ container: body, storageKey: `nuyoah.work-item-plan-canvas.v1:${state.draft.id || state.draftCanvasId}`, onActivate(value) {
        if (writing()) return; const id = typeof value === 'string' ? value : value?.id;
        if (id?.startsWith('plan:')) { state.nodeId = id.slice(5); renderNodeEditor(); state.nodeTitle?.focus(); updatePlanCanvas(); }
      } });
      updatePlanCanvas();
      const enlarge = button(state.largePlan ? '收起计划图' : '放大计划图', () => { state.largePlan = !state.largePlan; body.style.height = state.largePlan ? 'min(72vh, 760px)' : '340px'; enlarge.textContent = state.largePlan ? '收起计划图' : '放大计划图'; }); modes.append(enlarge);
      body.style.height = state.largePlan ? 'min(72vh, 760px)' : '340px';
    } else {
      const visited = new Set();
      function appendBranch(nodes, depth = 0) {
        for (const node of nodes) {
          if (visited.has(node.id)) continue; visited.add(node.id);
          const branch = el('div', undefined, 'nuyoah-work-node-row'); branch.style.marginInlineStart = `${Math.min(depth, 6) * 10}px`;
          branch.append(nodeButton(node)); body.append(branch); appendBranch(childrenOf(node.id), depth + 1);
        }
      }
      appendBranch(childrenOf('')); appendBranch(state.draft.nodes.filter(node => !visited.has(node.id)));
    }
    state.nodeEditor = el('div', undefined, 'nuyoah-work-node-editor'); state.plan.append(state.nodeEditor); renderNodeEditor();
  }
  function descendantIds(id) {
    const ids = new Set([id]); let changed = true;
    while (changed) { changed = false; for (const node of state.draft.nodes) if (ids.has(node.parentId) && !ids.has(node.id)) { ids.add(node.id); changed = true; } }
    return ids;
  }
  function renderNodeEditor() {
    if (!state.nodeEditor) return; state.nodeEditor.replaceChildren();
    const node = state.draft.nodes.find(value => value.id === state.nodeId); if (!node) return;
    const heading = el('div', undefined, 'nuyoah-work-actions'); heading.append(el('strong', '编辑节点'), button('收起', () => { state.nodeId = null; renderNodeEditor(); })); state.nodeEditor.append(heading);
    state.nodeTitle = input('节点名称', node.title, value => { node.title = value; markDirty(); if (state.nodeLabels?.has(node.id)) state.nodeLabels.get(node.id).textContent = `${kinds[node.kind]} · ${value || '未命名节点'}`; }); state.nodeEditor.append(field('节点名称', state.nodeTitle));
    state.nodeEditor.append(field('节点类型', select('节点类型', kinds, node.kind, value => { node.kind = value; markDirty(); renderPlan(); })));
    const excluded = descendantIds(node.id), choices = { '': '事项根节点' };
    for (const other of state.draft.nodes) if (!excluded.has(other.id)) choices[other.id] = other.title || '未命名节点';
    state.nodeEditor.append(field('父节点', select('父节点', choices, node.parentId || '', value => { node.parentId = value; markDirty(); renderPlan(); })));
    state.nodeEditor.append(el('p', `记录状态 · ${nodeStates[node.status]}`, 'nuyoah-work-muted'));
    if (node.source) state.nodeEditor.append(el('p', node.source, 'nuyoah-work-muted'));
    if (node.updatedAt) { const date = new Date(node.updatedAt); if (Number.isFinite(date.getTime())) state.nodeEditor.append(el('p', date.toLocaleString(), 'nuyoah-work-muted')); }
    state.nodeEditor.append(field('显示状态', select('显示状态', { '': '跟随记录', ...nodeStates }, node.manualStatus || '', value => { node.manualStatus = value || null; markDirty(); renderPlan(); })));
    state.nodeEditor.append(button('移除节点', () => {
      const parent = node.parentId || ''; state.draft.nodes = state.draft.nodes.filter(value => value.id !== node.id).map(value => value.parentId === node.id ? { ...value, parentId: parent } : value);
      state.nodeId = null; markDirty(); renderPlan();
    }));
  }
  function receive(response) {
    if (!state.pending || response.id !== state.pending.id) return;
    const pending = state.pending; clearTimeout(state.timer); state.pending = null;
    if (response.error) { if (pending.action !== 'read' && state.draft) renderEditor(); message(`${response.error} 草稿已保留，请重新读取核对。`); if (state.save) state.save.disabled = true; return; }
    if (!response.data || !Array.isArray(response.data.items) || !Number.isInteger(response.data.revision)) { if (pending.action !== 'read' && state.draft) renderEditor(); message('记录未能读取，请重试。草稿已保留。'); return; }
    state.data = response.data; state.lastRead = Date.now(); state.add.disabled = false;
    renderDirections(); renderList();
    if (pending.action === 'save' || pending.action === 'archive') {
      if (state.draft?.id === (pending.item?.id || pending.itemId)) cancelDraft();
      message(pending.action === 'save' ? '已保存。' : pending.archived ? '已归档，可在已归档中恢复。' : '已恢复。');
    }
    else if (state.draft) {
      if (!state.dirty) {
        const current = state.data.items.find(item => item.id === state.draft.id);
        if (current) {
          const changed = JSON.stringify(current) !== JSON.stringify(state.draft);
          state.baseItem = clone(current); state.draftRevision = state.data.revision;
          if (changed) { state.draft = clone(current); renderEditor(); }
          if (state.save) state.save.disabled = !state.draft.title.trim();
        }
        else if (!state.draft.id) { state.draftRevision = state.data.revision; if (state.save) state.save.disabled = !state.draft.title.trim(); }
        else cancelDraft();
      } else {
        const current = state.data.items.find(item => item.id === state.draft.id);
        if (current && JSON.stringify(current) === JSON.stringify(state.draft)) {
          state.dirty = false; state.baseItem = clone(current); state.draftRevision = state.data.revision; renderEditor();
        }
        // A different item changing need not invalidate this untouched base.
        if (!state.draft.id || JSON.stringify(current) === JSON.stringify(state.baseItem)) state.draftRevision = state.data.revision;
        renderConflict(); state.save.disabled = stale() || !state.draft.title.trim();
      }
      message(stale() ? '记录已有更新。未保存的草稿已保留。' : '');
    } else message('');
  }
  function mount(container, options = {}) {
    if (!state.root) build();
    const signature = JSON.stringify((options.tasks || []).map(task => [task.hostId || 'local', task.threadId, task.title, task.statusLabel]));
    const contextSignature = JSON.stringify([options.context?.hostId, options.context?.threadId, options.context?.projectId]);
    const contextChanged = contextSignature !== state.contextSignature; state.contextSignature = contextSignature;
    const changed = state.taskSignature !== signature || contextChanged;
    state.taskSignature = signature; state.tasks = options.tasks || []; state.context = options.context || {}; state.options = options;
    if (state.root.parentNode !== container) container.append(state.root);
    if (changed && !writing()) { if (state.draft) { renderLinks(); renderTaskPicker(); } if (state.data && !state.data.items.length) renderList(); else updateOverviewCanvas(); }
    if (!state.data && !state.pending) request('read');
    else if (state.data && !state.pending && Date.now() - state.lastRead >= 10000) request('read');
  }
  const style = el('style'); style.id = 'nuyoah-work-items-style';
  style.textContent = `
.nuyoah-work-items{font:inherit;line-height:1.5;color:var(--nuyoah-text,var(--color-token-foreground,inherit));min-width:0;min-height:0;height:100%;display:flex;flex-direction:column;position:relative;container-type:inline-size;background:var(--nuyoah-surface,var(--color-token-bg-primary,transparent))}
.nuyoah-work-items *{box-sizing:border-box}.nuyoah-work-items [hidden]{display:none!important}
.nuyoah-work-items button,.nuyoah-work-items input,.nuyoah-work-items textarea,.nuyoah-work-items select{font:inherit;color:inherit;border:1px solid var(--nuyoah-border,color-mix(in srgb,currentColor 12%,transparent));border-radius:8px;background:transparent;padding:7px 10px;max-width:100%}
.nuyoah-work-items button{cursor:pointer;line-height:1.45}.nuyoah-work-items button:hover{background:var(--nuyoah-subtle,color-mix(in srgb,currentColor 5%,transparent))}.nuyoah-work-items button:disabled{opacity:.5;cursor:default}
.nuyoah-work-items :is(button,input,select,textarea,summary):focus-visible{outline:2px solid var(--nuyoah-accent,#527ca8);outline-offset:2px}
.nuyoah-work-items p{margin:7px 0;white-space:pre-wrap;overflow-wrap:anywhere}.nuyoah-work-items strong{font-weight:600}
.nuyoah-work-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;flex:none;border-bottom:1px solid var(--nuyoah-border,color-mix(in srgb,currentColor 10%,transparent));font-size:.85em}
.nuyoah-work-toolbar-tools,.nuyoah-work-view-modes{display:flex;align-items:center;gap:4px;min-width:0}.nuyoah-work-toolbar button{white-space:nowrap;border-color:transparent}.nuyoah-work-toolbar-tools>button:first-child{color:var(--nuyoah-accent,#527ca8)}
.nuyoah-work-view-modes{padding:3px;border-radius:9px;background:var(--nuyoah-subtle,color-mix(in srgb,currentColor 5%,transparent))}.nuyoah-work-view-modes button[aria-pressed=true]{background:var(--nuyoah-surface,var(--color-token-bg-primary,transparent));border-color:var(--nuyoah-border,color-mix(in srgb,currentColor 8%,transparent))}
.nuyoah-work-menu{position:absolute;z-index:30;right:16px;top:58px;width:184px;display:grid;gap:3px;padding:6px;border:1px solid var(--nuyoah-border,color-mix(in srgb,currentColor 12%,transparent));border-radius:12px;background:var(--nuyoah-surface,var(--color-token-bg-primary,#fff));box-shadow:0 8px 28px #0002;font-size:.88em}
.nuyoah-work-menu button{border:0;text-align:start}.nuyoah-work-filters{position:absolute;z-index:25;top:64px;left:16px;right:16px;display:flex;gap:8px;flex-wrap:wrap;padding:14px;border:1px solid var(--nuyoah-border,color-mix(in srgb,currentColor 12%,transparent));border-radius:12px;background:var(--nuyoah-surface,var(--color-token-bg-primary,#fff));box-shadow:0 8px 28px #0002;font-size:.88em}.nuyoah-work-filters>input{flex:1 1 100%;width:100%}.nuyoah-work-filters>select{flex:1;min-width:0}
.nuyoah-work-stage{position:relative;flex:1;min-width:0;min-height:0;isolation:isolate;background:var(--nuyoah-canvas-bg,var(--color-token-bg-secondary,var(--color-token-bg-primary,transparent)))}
.nuyoah-work-main{height:100%;min-height:0;display:flex;flex-direction:column}.nuyoah-work-main>.nuyoah-work-canvas-host{flex:1;height:100%;min-height:0;border:0;border-radius:0}
.nuyoah-work-list{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1;overflow:auto;padding:18px;overscroll-behavior:contain}.nuyoah-work-card{display:flex;text-align:start;flex-direction:column;gap:5px;width:100%;padding:14px!important;overflow-wrap:anywhere;background:var(--nuyoah-surface,var(--color-token-bg-primary,transparent))!important;flex:none}
.nuyoah-work-card-title{display:flex;gap:8px;align-items:baseline;justify-content:space-between;width:100%}.nuyoah-work-card-title strong{min-width:0}.nuyoah-work-badge{font-size:.76em;white-space:nowrap;padding:1px 5px;border-radius:5px;background:var(--nuyoah-accent-soft,color-mix(in srgb,#527ca8 10%,transparent));color:var(--nuyoah-accent,#527ca8)}
.nuyoah-work-muted{font-size:.84em;color:var(--nuyoah-muted,var(--color-token-text-secondary,inherit));overflow-wrap:anywhere}.nuyoah-work-next{font-size:.9em;white-space:pre-wrap}.nuyoah-work-empty{margin:auto;text-align:center;max-width:28em;padding:30px 18px}.nuyoah-work-empty strong{font-size:1.1em}.nuyoah-work-empty p{font-size:.9em;color:var(--nuyoah-muted,var(--color-token-text-secondary,inherit));margin:10px 0 20px}.nuyoah-work-empty button{color:var(--nuyoah-accent,#527ca8);background:var(--nuyoah-accent-soft,color-mix(in srgb,#527ca8 10%,transparent));border-color:transparent}
.nuyoah-work-editor{position:absolute;z-index:10;right:16px;top:16px;bottom:70px;width:340px;max-width:calc(100% - 32px);overflow:auto;overscroll-behavior:contain;padding:16px 18px;border:1px solid var(--nuyoah-border,color-mix(in srgb,currentColor 12%,transparent));border-radius:15px;background:var(--nuyoah-surface,var(--color-token-bg-primary,#fff));box-shadow:0 12px 36px #0002;scrollbar-gutter:stable;font-size:.9em}
.nuyoah-work-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}.nuyoah-work-actions>strong{margin-inline-end:auto}.nuyoah-work-inspector-heading{flex-wrap:nowrap;align-items:flex-start;margin-top:0}.nuyoah-work-inspector-title{font-size:1.15em;line-height:1.5;font-weight:600;margin:0;flex:1;min-width:0;overflow-wrap:anywhere}.nuyoah-work-inspector-heading>button{font-size:.85em;flex:none;border:0}.nuyoah-work-inspector-next{font-size:.94em}
.nuyoah-work-field{display:flex;flex-direction:column;gap:5px;margin:12px 0;min-width:0}.nuyoah-work-field>span{font-size:.88em;color:var(--nuyoah-muted,var(--color-token-text-secondary,inherit))}.nuyoah-work-field>input,.nuyoah-work-field>textarea{width:100%}.nuyoah-work-field textarea{resize:vertical;min-height:64px;max-height:180px}.nuyoah-work-check{display:flex;align-items:center;gap:5px}
.nuyoah-work-status:empty{display:none}.nuyoah-work-status{font-size:.86em}.nuyoah-work-items>.nuyoah-work-status{margin:0;padding:8px 18px;flex:none}.nuyoah-work-conflict:not(:empty){border:1px solid var(--nuyoah-border,color-mix(in srgb,currentColor 12%,transparent));padding:10px;border-radius:8px;background:var(--nuyoah-subtle,color-mix(in srgb,currentColor 5%,transparent))}.nuyoah-work-conflict>button{margin:8px 6px 0 0}
.nuyoah-work-related,.nuyoah-work-plan{border-top:1px solid var(--nuyoah-border,color-mix(in srgb,currentColor 12%,transparent));margin-top:15px;padding-top:12px}.nuyoah-work-related summary{cursor:pointer;margin:10px 0}.nuyoah-work-related details>input{width:100%}.nuyoah-work-link{display:flex;gap:6px;align-items:center;margin:6px 0;flex-wrap:wrap}.nuyoah-work-link>button:first-child{flex:1;min-width:100px;text-align:start;overflow-wrap:anywhere}
.nuyoah-work-task-choices{display:grid;gap:6px;max-height:260px;overflow:auto;margin-top:8px}.nuyoah-work-task-choice{display:flex;flex-direction:column;gap:3px;text-align:start}
.nuyoah-work-node{display:flex;flex-direction:column;text-align:start;gap:3px;width:100%;margin:5px 0;overflow-wrap:anywhere}.nuyoah-work-node-editor{border:1px solid var(--nuyoah-border,color-mix(in srgb,currentColor 12%,transparent));border-radius:8px;padding:0 10px 10px;margin-top:10px}.nuyoah-work-node-editor:empty{display:none}
.nuyoah-work-canvas-host{min-width:0;width:100%;border-radius:10px;overflow:hidden;border:1px solid var(--nuyoah-border,color-mix(in srgb,currentColor 12%,transparent))}.nuyoah-work-plan-canvas{height:340px}
.nuyoah-work-item-details>summary{padding:12px 0;cursor:pointer;color:var(--nuyoah-accent,#527ca8)}.nuyoah-work-item-details{border-top:1px solid var(--nuyoah-border,color-mix(in srgb,currentColor 12%,transparent));margin-top:12px}.nuyoah-work-more:empty{display:none}.nuyoah-work-more{padding:10px 18px;flex:none}.nuyoah-work-more>button{width:100%}
.nuyoah-work-save-actions{position:sticky;bottom:-16px;background:var(--nuyoah-surface,var(--color-token-bg-primary,#fff));padding:12px 0 4px;margin-bottom:0;border-top:1px solid var(--nuyoah-border,color-mix(in srgb,currentColor 12%,transparent))}.nuyoah-work-save-actions>button:first-child{background:var(--nuyoah-accent-soft,color-mix(in srgb,#527ca8 10%,transparent));color:var(--nuyoah-accent,#527ca8);border-color:transparent}
.nuyoah-work-items button[aria-pressed=true]{background:var(--nuyoah-subtle,color-mix(in srgb,currentColor 5%,transparent))}
@container (max-width:700px){.nuyoah-work-editor{top:auto;left:12px;right:12px;bottom:64px;width:auto;max-width:none;max-height:62%;padding:14px 16px;border-radius:14px}.nuyoah-work-inspector-title{font-size:1.05em}.nuyoah-work-toolbar{padding:10px 12px;gap:6px}.nuyoah-work-toolbar-tools{gap:0}.nuyoah-work-toolbar button{padding:6px 8px}}
@media (prefers-reduced-motion:reduce){.nuyoah-work-items *{scroll-behavior:auto!important}}
`; document.head.append(style);
  window.__nuyoahWorkItemsUI__ = {
    mount, receive, dismiss, takeRequest: () => queue.shift() || null,
    destroy() { clearTimeout(state.timer); queue.length = 0; state.pending = null; state.overviewCanvas?.destroy(); state.planCanvas?.destroy(); state.root?.remove(); style.remove(); }
  };
})();
