(() => {
  const actionMemory = window.__nuyoahTaskMapUI__?.retainActions?.() || { records: new Map() };
  window.__nuyoahTaskMapUI__?.destroy?.();
  const queue = [], scopes = { conversation: '当前对话', project: '当前项目', global: '全局' };
  const state = { scope: 'conversation', context: {}, tasks: [], options: {}, data: null, pending: null, lastRead: 0, limit: 80, query: '', active: false, cache: new Map(), selectedId: null, actions: actionMemory.records };
  const identity = value => value && typeof value.threadId === 'string' && value.threadId ? JSON.stringify([value.hostId || 'local', value.threadId]) : null;
  const navigationKey = 'nuyoah.task-map-navigation.v1';
  const navigationRef = value => value && typeof value.hostId === 'string' && value.hostId && value.hostId.length <= 200
    && typeof value.threadId === 'string' && value.threadId && value.threadId.length <= 200
    ? { hostId: value.hostId, threadId: value.threadId, title: String(value.threadTitle || value.title || value.threadId).slice(0, 240) } : null;
  state.navigation = []; state.returnTo = null;
  try {
    const saved = JSON.parse(window.sessionStorage?.getItem(navigationKey) || 'null');
    if (saved?.version === 1 && Array.isArray(saved.frames)) {
      state.navigation = saved.frames.slice(-20).flatMap(frame => {
        const from = navigationRef(frame?.from), to = navigationRef(frame?.to);
        return from && to && identity(from) !== identity(to) && Object.hasOwn(scopes, frame.scope)
          ? [{ from, to, scope: frame.scope, arrived: frame.arrived === true }] : [];
      });
      if (Number.isInteger(saved.returnTo) && saved.returnTo >= 0 && saved.returnTo < state.navigation.length) state.returnTo = saved.returnTo;
    }
  } catch { /* An unavailable session store must not prevent navigation. */ }
  function saveNavigation() {
    try { window.sessionStorage?.setItem(navigationKey, JSON.stringify({ version: 1, frames: state.navigation, returnTo: state.returnTo })); } catch {}
  }
  function reconcileNavigation() {
    const current = identity(state.context), last = state.navigation.at(-1); if (!current || !last) return;
    const destination = state.returnTo === null ? null : state.navigation[state.returnTo];
    const ancestor = state.navigation.findIndex(frame => identity(frame.from) === current);
    if ((destination && identity(destination.from) === current) || (last.arrived && ancestor >= 0)) {
      const index = destination && identity(destination.from) === current ? state.returnTo : ancestor;
      state.scope = state.navigation[index].scope; state.navigation = state.navigation.slice(0, index); state.returnTo = null; saveNavigation();
    } else if (identity(last.to) === current) {
      if (!last.arrived) { last.arrived = true; saveNavigation(); }
    } else if (!state.navigation.some(frame => identity(frame.from) === current || identity(frame.to) === current)) {
      state.navigation = []; state.returnTo = null; saveNavigation();
    }
  }
  function renderNavigation() {
    const previous = state.navigation.at(-1)?.from;
    state.backRow.hidden = !previous;
    setText(state.backTitle, previous ? taskCopy(previous).displayTitle : '');
  }
  function openTask(task, returnIndex = null) {
    const previous = state.navigation.slice(), previousReturn = state.returnTo;
    const target = navigationRef(task), current = navigationRef(state.context);
    if (!target || typeof state.options.openTask !== 'function') return;
    if (returnIndex !== null) state.returnTo = returnIndex;
    else {
      const ancestor = state.navigation.findIndex(frame => identity(frame.from) === identity(target));
      if (ancestor >= 0) state.returnTo = ancestor;
      else if (current && identity(current) !== identity(target)) {
        // A repeated click while the native route is still changing must not
        // manufacture another source from the old selected sidebar row.
        const last = state.navigation.at(-1);
        if (!last || last.arrived || identity(last.from) !== identity(current)) state.navigation.push({ from: navigationRef(state.model?.catalog.get(identity(current)) || current), to: target, scope: state.scope, arrived: false });
        else state.navigation[state.navigation.length - 1] = { ...last, to: target };
        state.navigation = state.navigation.slice(-20); state.returnTo = null;
      } else state.returnTo = null;
    }
    saveNavigation(); renderNavigation();
    let started = false;
    try { started = state.options.openTask(task, { returning: state.returnTo !== null }) === true; } catch {}
    if (!started) {
      state.navigation = previous; state.returnTo = previousReturn; saveNavigation(); renderNavigation();
      setText(state.status, '暂时无法打开这个对话，请重试。');
    }
  }
  function goBack() {
    const index = state.navigation.length - 1; if (index >= 0) openTask(state.navigation[index].from, index);
  }
  const boundProject = value => typeof value === 'string' && value && value !== '__unassigned__' ? value : '';
  const contextKey = () => JSON.stringify([state.scope, state.context.hostId || 'local', state.context.threadId || '', state.context.projectId || '']);
  const layoutKey = () => `nuyoah.task-map-layout.v1:${JSON.stringify(state.scope === 'global' ? ['global'] : state.scope === 'project' ? ['project', state.context.hostId || 'local', state.model?.projectId || state.context.projectId || ''] : ['conversation', state.context.hostId || 'local', state.context.threadId || ''])}`;
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  function button(text, onClick, label) { const node = make('button', text); node.type = 'button'; node.onclick = onClick; if (label) node.setAttribute('aria-label', label); return node; }
  function visible() { return state.active && state.root && !state.root.hidden && document.visibilityState !== 'hidden'; }
  function clearPending() { clearTimeout(state.timer); state.timer = null; state.pending = null; queue.length = 0; }
  function clearRelationRefresh() { clearTimeout(state.relationTimer); state.relationTimer = null; state.relationsDirty = false; }
  function invalidateRelations() {
    if (!visible() || state.failure || state.data?.status === 'unavailable') return;
    if (state.pending) { state.relationsDirty = true; return; }
    if (state.relationTimer) return;
    state.relationTimer = setTimeout(() => { state.relationTimer = null; request(); }, 200);
  }
  const completionDelay = 6000, completionKey = 'nuyoah.task-map-completed-view.v1';
  state.completions = new Map(); state.showCompleted = false;
  try {
    const saved = JSON.parse(window.sessionStorage?.getItem(completionKey) || '[]');
    if (Array.isArray(saved)) for (const entry of saved.slice(-4096)) if (Array.isArray(entry) && typeof entry[0] === 'string'
      && typeof entry[1]?.token === 'string' && Number.isFinite(entry[1]?.seenAt)) state.completions.set(entry[0], entry[1]);
  } catch {}
  function saveCompletions() {
    while (state.completions.size > 4096) state.completions.delete(state.completions.keys().next().value);
    try { window.sessionStorage?.setItem(completionKey, JSON.stringify([...state.completions])); } catch {}
  }
  function activity(task) {
    // Live status can disappear after local archive. Only independent parent
    // final evidence or a confirmed manual status can survive that gap.
    if (task.statusAvailable === false || task.runtimeStatus === 'unknown') {
      return task.hostId === 'local' && (task.agentCompletion === true || task.displayStatus === 'completed') ? 'completed' : 'unknown';
    }
    if (task.waitingReason === 'input' || task.waitingReason === 'approval' || task.runtimeStatus === 'waiting') return 'waiting';
    if (task.runtimeStatus === 'running' || !task.runtimeStatus && task.displayStatus === 'running') return 'running';
    if (task.runtimeStatus === 'failed' || task.displayStatus === 'failed') return 'failed';
    if (task.hasFinalResponse === true || task.displayStatus === 'completed') return 'completed';
    if (['completed', 'idle', 'interrupted'].includes(task.runtimeStatus) || ['completed', 'history'].includes(task.displayStatus)) return 'idle';
    return 'unknown';
  }
  function taskCopy(task) {
    const title = String(task.title || '').trim(), chinese = /[\u3400-\u9fff]/;
    const name = title.toLowerCase().replace(/[_-]+/g, ' ');
    const roles = [
      [/return|navigation/, '对话返回检查', '检查子任务跳转与返回主对话的操作。'],
      [/completion|lifecycle/, '任务完成处理', '检查完成提示与任务自动收起。'],
      [/motion|animation|canvas.*activity/, '画布动效', '让正在执行的任务更容易辨认。'],
      [/relationship|relation/, '任务关联', '梳理主对话、子任务和派生任务的关系。'],
      [/task.*map|map.*ui/, '任务地图界面', '实现任务地图的布局与交互。'],
      [/work.*items?/, '工作事项界面', '组织工作方向、事项与关联任务。'],
      [/wechat|weixin/, '公众号适用性研究', '分析产品对公众号内容工作的实际价值。'],
      [/audit|review|verif|test/, '检查与验证', '检查相关改动，确认工作结果。'],
      [/research|investigat|analys/, '调研与分析', '研究相关问题，整理依据与建议。'],
    ];
    const role = /^[a-z][a-z\d_-]*$/i.test(title) ? roles.find(([pattern]) => pattern.test(name)) : null;
    const description = typeof task.description === 'string' && chinese.test(task.description) ? task.description.slice(0, 120) : '';
    return { displayTitle: chinese.test(title) ? title : role?.[1] || (task.child ? '协作子任务' : '项目任务'),
      description: description || role?.[2] || (chinese.test(title) ? `围绕“${title.slice(0, 48)}”开展工作。` : task.child ? '协助主对话中的一项工作，可打开查看具体内容。' : '打开对话，查看这项工作的内容与结果。'),
      originalTitle: title };
  }
  function completionView(model) {
    const now = Date.now(), removable = new Set(); let next = Infinity, changed = false;
    for (const task of model.nodes) {
      if (task.activity !== 'completed') {
        if (['running', 'waiting', 'failed'].includes(task.activity) && state.completions.delete(task.id)) changed = true;
        continue;
      }
      const token = String(task.finalAt || task.activityAt || 'confirmed'), previous = state.completions.get(task.id);
      const record = previous?.token === token ? previous : { token, seenAt: now };
      if (record !== previous) { state.completions.set(task.id, record); changed = true; }
      const remaining = record.seenAt + completionDelay - now;
      if (remaining <= 0) removable.add(task.id); else next = Math.min(next, remaining);
    }
    if (changed) saveCompletions();
    // Keep the selected conversation and real parent links needed by active work.
    const kept = new Set(model.nodes.filter(task => task.current || task.id === state.selectedId || !removable.has(task.id)).map(task => task.id));
    for (let pass = 0, changed = true; changed && pass < model.nodes.length; pass++) {
      changed = false;
      for (const edge of model.edges) if (edge.kind === 'parent' && kept.has(edge.to) && !kept.has(edge.from)) { kept.add(edge.from); changed = true; }
    }
    const folded = model.nodes.filter(task => removable.has(task.id) && !kept.has(task.id));
    clearTimeout(state.completionTimer); state.completionTimer = null;
    if (visible() && Number.isFinite(next)) state.completionTimer = setTimeout(render, Math.max(1, next));
    const foldedIds = new Set(folded.map(task => task.id));
    const nodes = state.showCompleted ? model.nodes : model.nodes.filter(task => !foldedIds.has(task.id));
    const ids = new Set(nodes.map(task => task.id));
    return { ...model, nodes, folded, edges: model.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) };
  }
  function graph() {
    const entries = new Map(), catalog = new Map();
    for (const node of state.data?.nodes || []) { const id = identity(node); if (id) entries.set(id, { ...node, hostId: node.hostId || 'local' }); }
    for (const task of state.tasks) {
      const id = identity(task); if (!id) continue; catalog.set(id, task);
      entries.set(id, { ...entries.get(id), ...task, hostId: task.hostId || 'local', catalogKnown: true });
    }
    const current = identity(state.context);
    if (current && !entries.has(current)) entries.set(current, { hostId: state.context.hostId || 'local', threadId: state.context.threadId, title: state.context.threadTitle || '当前对话', projectId: state.context.projectId, projectName: state.context.projectName, runtimeStatus: 'unknown' });
    const edges = [], seen = new Set();
    for (const edge of state.data?.edges || []) {
      const from = identity(edge.from), to = identity(edge.to), kind = ['parent', 'fork', 'related'].includes(edge.kind) ? edge.kind : null;
      if (!kind || !from || !to || from === to) continue;
      const edgeId = JSON.stringify([from, to, kind]); if (seen.has(edgeId)) continue; seen.add(edgeId);
      for (const endpoint of [edge.from, edge.to]) {
        const id = identity(endpoint); if (!entries.has(id)) entries.set(id, { hostId: endpoint.hostId || 'local', threadId: endpoint.threadId, title: `${endpoint.threadId} · 待同步`, runtimeStatus: 'unknown', resolved: false });
      }
      edges.push({ from, to, kind, label: kind === 'parent' ? '子任务' : kind === 'fork' ? '派生' : '关联' });
    }
    // Only explicit parentage can provide a missing project binding. Never use cwd or titles.
    for (let pass = 0, changed = true; changed && pass < entries.size; pass++) {
      changed = false;
      for (const edge of edges) {
        if (edge.kind !== 'parent') continue;
        const parent = entries.get(edge.from), child = entries.get(edge.to);
        if (parent.hostId !== child.hostId || !boundProject(parent.projectId) || boundProject(child.projectId)) continue;
        child.projectId = parent.projectId; child.projectName = parent.projectName; changed = true;
      }
    }
    const effectiveProject = boundProject(state.context.projectId) || boundProject(entries.get(current)?.projectId); let included;
    if (state.scope === 'conversation') {
      included = new Set(current ? [current] : []); const neighbors = new Map();
      for (const edge of edges) { if (!neighbors.has(edge.from)) neighbors.set(edge.from, []); if (!neighbors.has(edge.to)) neighbors.set(edge.to, []); neighbors.get(edge.from).push(edge.to); neighbors.get(edge.to).push(edge.from); }
      const remaining = [...included]; for (let i = 0; i < remaining.length; i++) for (const id of neighbors.get(remaining[i]) || []) if (!included.has(id)) { included.add(id); remaining.push(id); }
    } else if (state.scope === 'project') {
      const projectId = effectiveProject, hostId = state.context.hostId || 'local';
      included = new Set([...entries].filter(([, task]) => projectId && task.hostId === hostId && task.projectId === projectId && task.archived !== true && task.archived !== 1).map(([id]) => id));
    } else included = new Set([...entries].filter(([, task]) => task.archived !== true && task.archived !== 1).map(([id]) => id));
    const children = new Set(edges.filter(edge => edge.kind === 'parent').map(edge => edge.to));
    return { projectId: effectiveProject, nodes: [...entries].filter(([id]) => included.has(id)).map(([id, original]) => {
      let task = original;
      if (visible() && task.hostId === 'local' && typeof state.options.getLocalStatus === 'function') {
        let native; try { native = state.options.getLocalStatus(task.threadId); } catch { native = null; }
        if (native) {
          task = { ...task, ...native, hasFinalResponse: native.hasFinalResponse === true || original.hasFinalResponse === true,
            finalAt: native.finalAt || original.finalAt, statusAvailable: native.statusAvailable !== false,
            displayStatus: original.displayStatus === 'completed' ? 'completed' : undefined };
        } else task = { ...task, runtimeStatus: 'unknown', statusAvailable: false, waitingReason: null,
          displayStatus: original.displayStatus === 'completed' ? 'completed' : undefined, statusLabel: '状态待同步' };
      }
      const activityState = activity(task); if (activityState === 'unknown') task = { ...task, statusLabel: '状态待同步' };
      const node = { ...task, id, child: children.has(id), current: id === current, activity: activityState, openable: catalog.has(id) || task.hostId === 'local' && task.resolved === true };
      return { ...node, ...taskCopy(node) };
    }), edges: edges.filter(edge => included.has(edge.from) && included.has(edge.to)), catalog };
  }
  function orderedNodes(model) {
    const byId = new Map(model.nodes.map(node => [node.id, node])), neighbors = new Map();
    for (const edge of model.edges) { if (!neighbors.has(edge.from)) neighbors.set(edge.from, []); if (!neighbors.has(edge.to)) neighbors.set(edge.to, []); neighbors.get(edge.from).push(edge.to); neighbors.get(edge.to).push(edge.from); }
    const seeds = [...model.nodes].sort((a, b) => Number(b.current) - Number(a.current) || a.id.localeCompare(b.id)), visited = new Set(), result = [];
    for (const seed of seeds) { if (visited.has(seed.id)) continue; const pending = [seed.id]; visited.add(seed.id); for (let i = 0; i < pending.length; i++) { const id = pending[i]; result.push(byId.get(id)); for (const child of neighbors.get(id) || []) if (byId.has(child) && !visited.has(child)) { visited.add(child); pending.push(child); } } }
    return result;
  }
  function layout(model) {
    const nodes = [], edges = model.edges, groups = new Map(), tones = ['sage', 'blue', 'lilac', 'peach'];
    for (const task of model.nodes) {
      const key = state.scope === 'global' ? JSON.stringify([task.hostId, boundProject(task.projectId)]) : '';
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(task);
    }
    let offset = 0, groupIndex = 0;
    for (const [groupId, tasks] of groups) {
      const tone = tones[groupIndex++ % tones.length], ids = new Set(tasks.map(task => task.id)), children = new Map(), incoming = new Set(), positions = new Map();
      for (const edge of edges) if (edge.kind !== 'related' && ids.has(edge.from) && ids.has(edge.to)) { if (!children.has(edge.from)) children.set(edge.from, []); children.get(edge.from).push(edge.to); incoming.add(edge.to); }
      const roots = tasks.filter(task => !incoming.has(task.id));
      const seeds = [...roots, ...tasks], visited = new Set(), acceptedChildren = new Map();
      let componentX = 0, componentY = offset, componentRowHeight = 0, componentIndex = 0;
      for (const seed of seeds) {
        if (visited.has(seed.id)) continue;
        if (componentIndex && componentIndex % 3 === 0) { componentX = 0; componentY += componentRowHeight + 84; componentRowHeight = 0; }
        const pending = [{ id: seed.id, depth: 0, exit: false }], component = []; let row = 0;
        while (pending.length) {
          const next = pending.pop();
          if (next.exit) {
            const descendants = (acceptedChildren.get(next.id) || []).map(id => positions.get(id));
            const y = descendants.length ? (descendants[0].y + descendants[descendants.length - 1].y) / 2 : row++ * 158;
            positions.set(next.id, { x: next.depth * 292, y }); continue;
          }
          if (visited.has(next.id)) continue; visited.add(next.id); component.push(next.id);
          if (next.parent) { if (!acceptedChildren.has(next.parent)) acceptedChildren.set(next.parent, []); acceptedChildren.get(next.parent).push(next.id); }
          pending.push({ ...next, exit: true });
          for (const id of [...children.get(next.id) || []].reverse()) if (!visited.has(id)) pending.push({ id, parent: next.id, depth: next.depth + 1, exit: false });
        }
        const width = Math.max(...component.map(id => positions.get(id).x)) + 232, height = Math.max(...component.map(id => positions.get(id).y)) + 126;
        for (const id of component) { const point = positions.get(id); positions.set(id, { x: point.x + componentX, y: point.y + componentY }); }
        componentX += width + 76; componentRowHeight = Math.max(componentRowHeight, height); componentIndex++;
      }
      if (state.scope === 'global') {
        const first = tasks[0], host = first.hostName || (first.hostId === 'local' ? '本机' : '远程设备');
        nodes.push({ id: `project:${groupId}`, title: first.projectName || (boundProject(first.projectId) ? '未命名项目' : '未绑定项目'), subtitle: `${host} · ${tasks.length} 个对话`, badge: '项目', kind: 'root', tone, x: -292, y: offset });
      }
      for (const task of tasks) {
        nodes.push({ id: task.id, title: task.resolved === false && !task.catalogKnown ? '待同步任务' : task.displayTitle,
          subtitle: task.description, sourceTitle: task.originalTitle, badge: task.activity === 'completed' ? '已完成' : '',
          width: 232, height: 126, kind: 'task', tone, activity: task.activity, current: task.current, ...positions.get(task.id) });
      }
      offset = componentY + componentRowHeight + 110;
    }
    return { nodes, edges, selectedId: state.selectedId || identity(state.context) || '' };
  }
  function activate(id) {
    const task = state.model?.nodes.find(node => node.id === id); if (!task) return;
    state.selectedId = id;
    let record = state.actions.get(id);
    if (!record) {
      record = { target: navigationRef(task), mode: 'send', drafts: { send: '', create: '', deliver: '' }, title: '', inspection: null, receipt: null };
      state.actions.set(id, record);
    }
    record.task = task; record.target = navigationRef(task);
    record.formOpen = Boolean(record.pending || record.receipt?.status === 'unknown');
    closeTools();
    render(); inspectAction(record);
    focusSelected(); state.actionClose?.focus?.({ preventScroll: true });
  }
  const actionLabels = { send: '补充要求', create: '拆出子任务', deliver: '交给主任务继续' };
  const submitLabels = { send: '发送补充要求', create: '创建子任务', deliver: '发送给主任务' };
  const selectedAction = () => state.actions.get(state.selectedId);
  function actionAllowed(record) {
    const value = record?.inspection;
    if (!record || !record.task.openable || record.inspecting || record.pending || record.receipt?.status === 'unknown' || value?.available !== true) return false;
    return record.mode === 'create' ? value.canCreate === true : record.mode === 'deliver' ? Boolean(value.parent) && value.canSend === true : value.canSend === true;
  }
  function renderActions() {
    if (!state.actionPanel) return;
    const record = selectedAction(); state.actionPanel.hidden = !record;
    state.plane?.setAttribute('data-inspecting', String(Boolean(record)));
    if (!record) return;
    const currentTask = state.fullModel?.nodes.find(task => task.id === state.selectedId);
    if (currentTask) record.task = currentTask;
    const display = taskCopy(record.task).displayTitle, info = record.inspection;
    setText(state.actionHeading, display); state.actionOpen.disabled = !record.task.openable;
    setText(state.actionDescription, record.task.description || '');
    state.actionDescription.hidden = Boolean(record.formOpen);
    state.actionForm.hidden = !record.formOpen; state.actionChoiceList.hidden = Boolean(record.formOpen);
    state.actionBack.hidden = !record.formOpen; state.actionCaption.hidden = Boolean(record.formOpen);
    for (const [mode, node] of Object.entries(state.actionChoices)) { node.setAttribute('aria-pressed', String(record.mode === mode)); node.disabled = Boolean(record.pending); }
    const destination = record.mode === 'deliver' ? info?.parent : record.target;
    setText(state.actionDestination, record.mode === 'create' ? `主任务：${display}` : record.mode === 'deliver' ? destination ? `发送给主任务：${taskCopy(destination).displayTitle}` : '尚未找到可接收成果的主任务。' : `发送给：${display}`);
    state.actionTitleLabel.hidden = record.mode !== 'create';
    if (state.actionTitle.value !== record.title) state.actionTitle.value = record.title;
    state.actionTitle.disabled = Boolean(record.pending);
    setText(state.actionTextLabel, record.mode === 'create' ? '子任务要求' : record.mode === 'deliver' ? '交给主任务的成果与要求' : '补充要求');
    const draft = record.drafts[record.mode]; if (state.actionText.value !== draft) state.actionText.value = draft;
    state.actionText.disabled = Boolean(record.pending);
    state.actionText.placeholder = record.mode === 'create' ? '写清这项子任务要完成什么' : record.mode === 'deliver' ? '确认或编辑要交回的成果，再写下后续要求' : '输入要补充给这个任务的要求';
    setText(state.actionHint, record.mode === 'deliver' && record.resultTruncated ? '成果较长，已填入部分内容。请检查并编辑要交回的内容。' : '');
    state.actionSubmit.disabled = !actionAllowed(record) || !draft.trim();
    setText(state.actionSubmit, record.pending ? '正在处理…' : submitLabels[record.mode]);
    const receipt = record.receipt;
    let status = record.inspecting ? '正在读取可用操作…' : !record.task.openable ? '这个关联任务尚未同步，暂时只能查看。' : !info?.available ? '暂时无法操作这个任务，可打开完整对话查看。' : info.running ? '任务正在运行。' : '';
    if (!record.inspecting && info?.available && record.mode === 'create' && !info.canCreate) status = '这个任务暂不能从画布拆分，可打开完整对话继续。';
    if (receipt) status = receipt.status === 'pending' ? '正在处理，请稍候…' : receipt.status === 'unknown' ? '结果尚未确认，请打开对话核对，暂不重复发送。' : receipt.status === 'failed' ? receipt.message || '操作未完成，要求已保留，请重试。' : receipt.message || '操作已完成。';
    setText(state.actionStatus, status); state.actionStatus.setAttribute('data-status', receipt?.status || (record.inspecting ? 'loading' : info?.available ? 'ready' : 'unavailable'));
    state.actionCheck.hidden = receipt?.status !== 'unknown';
    state.actionChild.hidden = !receipt?.child;
  }
  async function inspectAction(record) {
    if (record.pending || record.receipt?.status === 'unknown') { renderActions(); return; }
    const transport = window.__nuyoahTaskActions__, token = crypto.randomUUID();
    clearTimeout(record.inspectTimer); record.inspectToken = token; record.inspection = null;
    if (!record.task.openable || typeof transport?.inspect !== 'function' || typeof transport?.execute !== 'function') { record.inspecting = false; renderActions(); return; }
    record.inspecting = true; renderActions();
    record.inspectTimer = setTimeout(() => { if (record.inspectToken !== token || state.destroyed) return; record.inspectToken = null; record.inspecting = false; renderActions(); }, 18000);
    try {
      const value = await transport.inspect({ hostId: record.target.hostId, threadId: record.target.threadId });
      if (state.destroyed || record.inspectToken !== token) return;
      if (value?.available === true && identity(value.target) === identity(record.target)) {
        const parent = navigationRef(value.parent);
        record.inspection = { ...value, parent: parent && identity(parent) !== identity(record.target) ? parent : null };
        if (!record.drafts.deliver && typeof value.resultText === 'string') { record.drafts.deliver = value.resultText.slice(0, 16000); record.resultTruncated = value.resultTruncated === true || value.resultText.length > 16000; }
        if (value.pendingReceipt?.status === 'unknown' && identity(value.pendingReceipt.target) === identity(record.target)) {
          record.receipt = { ...value.pendingReceipt, checkTarget: value.pendingReceipt.action === 'deliver' ? record.inspection.parent : record.target, child: navigationRef(value.pendingReceipt.child) };
        }
      }
    } catch { /* An inspection failure never authorizes a write. */ }
    finally {
      if (!state.destroyed && record.inspectToken === token) { clearTimeout(record.inspectTimer); record.inspecting = false; renderActions(); }
    }
  }
  async function submitAction() {
    const record = selectedAction(), transport = window.__nuyoahTaskActions__;
    if (!record?.formOpen || !actionAllowed(record) || !record.drafts[record.mode].trim() || typeof transport?.execute !== 'function') return;
    // Snapshot both the destination and the draft before crossing the async boundary.
    const mode = record.mode, text = record.drafts[mode], title = record.title;
    const request = { id: crypto.randomUUID(), action: mode, target: { hostId: record.target.hostId, threadId: record.target.threadId }, text,
      ...(mode === 'deliver' ? { expectedParent: { hostId: record.inspection.parent.hostId, threadId: record.inspection.parent.threadId } } : {}),
      ...(mode === 'create' && title.trim() ? { title: title.trim() } : {}) };
    const checkTarget = mode === 'deliver' ? record.inspection.parent : record.target;
    record.operationToken = request.id; record.pending = request.id; record.receipt = { id: request.id, status: 'pending', checkTarget }; renderActions();
    record.operationTimer = setTimeout(() => {
      if (record.operationToken !== request.id) return;
      record.pending = null; record.receipt = { id: request.id, status: 'unknown', checkTarget }; actionMemory.notify?.();
    }, 60000);
    let result;
    try { result = await transport.execute(request); } catch { result = { status: 'unknown' }; }
    if (record.operationToken !== request.id) return;
    clearTimeout(record.operationTimer); record.pending = null;
    const status = ['succeeded', 'failed', 'unknown'].includes(result?.status) ? result.status : 'unknown';
    record.receipt = { id: request.id, status, checkTarget, message: typeof result?.message === 'string' ? result.message.slice(0, 300) : '', child: mode === 'create' ? navigationRef(result?.child) : null };
    if (status === 'succeeded') {
      if (record.drafts[mode] === text) record.drafts[mode] = '';
      if (mode === 'create' && record.title === title) record.title = '';
      actionMemory.onSuccess?.();
    }
    actionMemory.notify?.();
  }
  function requestMapRefresh() { state.lastRead = 0; if (!state.pending) request(); }
  actionMemory.notify = () => { if (!state.destroyed) renderActions(); };
  actionMemory.onSuccess = () => { if (!state.destroyed) requestMapRefresh(); };
  function closeInspector() {
    const id = state.selectedId; state.selectedId = null; render();
    if (id && state.model?.nodes.some(task => task.id === id)) state.canvas?.focus?.(id);
    else state.scopeButtons[state.scope]?.focus?.();
  }
  function focusSelected() {
    const frame = state.canvasHost?.getBoundingClientRect?.(), panel = state.actionPanel?.getBoundingClientRect?.();
    const bottomInset = frame && panel && !state.actionPanel.hidden && panel.left < frame.right && panel.top > frame.top ? frame.bottom - panel.top + 14 : 0;
    if (state.selectedId) state.canvas?.focus?.(state.selectedId, { bottomInset });
  }
  function backToDetails() {
    const record = selectedAction(); if (!record) return;
    record.formOpen = false; renderActions(); state.actionChoices[record.mode]?.focus?.();
  }
  function buildActions() {
    state.actionPanel = make('section', undefined, 'nuyoah-task-map-actions'); state.actionPanel.hidden = true; state.actionPanel.setAttribute('aria-label', '选中任务操作');
    const header = make('div', undefined, 'nuyoah-task-map-action-header'); state.actionHeading = make('h3');
    state.actionCaption = make('span', '任务详情'); state.actionBack = button('‹ 任务详情', backToDetails, '返回任务详情');
    state.actionClose = button('×', closeInspector, '收起操作'); state.actionClose.className = 'nuyoah-task-map-icon';
    header.append(state.actionCaption, state.actionBack, state.actionClose); state.actionPanel.append(header, state.actionHeading);
    state.actionDescription = make('p', '', 'nuyoah-task-map-action-description'); state.actionPanel.append(state.actionDescription);
    state.actionOpen = button('打开完整对话', () => { const record = selectedAction(); if (record?.task.openable) openTask(state.model?.catalog.get(state.selectedId) || record.task); });
    const choices = make('div', undefined, 'nuyoah-task-map-action-choices'); state.actionChoiceList = choices; choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', '任务操作'); state.actionChoices = {};
    for (const [mode, label] of Object.entries(actionLabels)) {
      const node = button(label, () => { const record = selectedAction(); if (!record || record.pending) return; record.mode = mode; record.formOpen = true; renderActions(); focusSelected(); state.actionText.focus?.(); }); state.actionChoices[mode] = node; choices.append(node);
    }
    state.actionPanel.append(choices); state.actionForm = make('div', undefined, 'nuyoah-task-map-action-form'); state.actionForm.hidden = true;
    state.actionDestination = make('p', '', 'nuyoah-task-map-action-destination'); state.actionForm.append(state.actionDestination);
    state.actionTitleLabel = make('label', '子任务名称（可选）'); state.actionTitle = make('input'); state.actionTitle.type = 'text'; state.actionTitle.maxLength = 120; state.actionTitle.setAttribute('aria-label', '子任务名称（可选）');
    state.actionTitle.oninput = () => { const record = selectedAction(); if (record && !record.pending) record.title = state.actionTitle.value; }; state.actionTitleLabel.append(state.actionTitle); state.actionForm.append(state.actionTitleLabel);
    const textLabel = make('label'); state.actionTextLabel = make('span'); state.actionText = make('textarea'); state.actionText.rows = 4; state.actionText.maxLength = 16000; state.actionText.setAttribute('aria-label', '任务操作内容');
    state.actionText.oninput = () => { const record = selectedAction(); if (!record || record.pending) return; record.drafts[record.mode] = state.actionText.value; state.actionSubmit.disabled = !actionAllowed(record) || !state.actionText.value.trim(); };
    textLabel.append(state.actionTextLabel, state.actionText); state.actionForm.append(textLabel);
    state.actionHint = make('p', '', 'nuyoah-task-map-action-hint'); state.actionForm.append(state.actionHint);
    state.actionSubmit = button('发送补充要求', submitAction); state.actionSubmit.className = 'nuyoah-task-map-submit'; state.actionForm.append(state.actionSubmit); state.actionPanel.append(state.actionForm);
    state.actionStatus = make('p', '', 'nuyoah-task-map-action-status'); state.actionStatus.setAttribute('role', 'status'); state.actionStatus.setAttribute('aria-live', 'polite'); state.actionPanel.append(state.actionStatus);
    const controls = make('div', undefined, 'nuyoah-task-map-action-controls');
    state.actionCheck = button('打开对话核对', () => { const target = selectedAction()?.receipt?.checkTarget; if (target) openTask(target); });
    state.actionChild = button('打开子任务', () => { const target = selectedAction()?.receipt?.child; if (target) openTask(target); });
    controls.append(state.actionCheck, state.actionChild); state.actionPanel.append(controls);
    const footer = make('div', undefined, 'nuyoah-task-map-action-footer'); footer.append(state.actionOpen); state.actionPanel.append(footer); state.plane.append(state.actionPanel);
  }
  function ensureCanvas() {
    if (!window.__nuyoahWorkCanvas__?.create) return false;
    const key = layoutKey();
    if (state.canvas && state.canvasKey === key) return true;
    let saved = false; try { const value = JSON.parse(window.localStorage?.getItem(key) || 'null'); saved = value?.schemaVersion === 1 && Number.isFinite(value.viewport?.zoom) && Number.isFinite(value.viewport?.x) && Number.isFinite(value.viewport?.y); } catch {}
    state.canvas?.destroy(); state.canvasKey = key; state.initialFocus = !saved; state.canvas = window.__nuyoahWorkCanvas__.create({ container: state.canvasHost, storageKey: key, onActivate: activate }); return true;
  }
  function statusText() {
    if (state.scope === 'conversation' && !identity(state.context)) return '打开一个对话，查看它的关联任务。';
    if (state.failure) return state.failure;
    if (state.pending) return state.data ? '正在更新关联…' : '正在读取关联…';
    if (state.scope === 'project' && !state.model?.projectId) return '当前对话尚未绑定项目。';
    if (state.data?.status === 'unavailable') return '暂时无法读取关联。可重新读取。';
    if (state.data?.status === 'partial' || state.data?.coverage?.status === 'partial') return '部分关联尚未同步，已展示当前可见的任务。';
    if (!state.model?.nodes.length) return '此范围内暂无任务。';
    if (state.model.folded.length && state.model.nodes.length <= 1) return '关联任务已完成，已自动收起。';
    if (state.scope === 'conversation' && state.model.nodes.length === 1) return '尚未发现与当前对话关联的任务。';
    return '';
  }
  function renderSearch() {
    const query = state.query.trim().toLocaleLowerCase(); state.searchResults.replaceChildren();
    if (!query) { state.searchResults.hidden = true; return; }
    state.searchResults.hidden = false;
    const matches = (state.model?.nodes || []).filter(task => `${task.title || ''} ${task.displayTitle || ''} ${task.description || ''} ${task.projectName || ''} ${task.threadId}`.toLocaleLowerCase().includes(query));
    if (!matches.length) { state.searchResults.append(make('span', '没有找到匹配的任务。')); return; }
    for (const task of matches.slice(0, 12)) state.searchResults.append(button(task.displayTitle, () => { state.focused = task.id; render(); state.canvas?.focus?.(task.id); }, `定位任务：${task.displayTitle}`));
    if (matches.length > 12) state.searchResults.append(make('span', `还有 ${matches.length - 12} 个结果，请继续输入缩小范围。`));
  }
  function syncRelationRoots(rendered) {
    const callback = state.options.syncLocalRelationRoots; if (typeof callback !== 'function') return;
    const source = state.fullModel || state.model;
    const parents = new Map(), children = new Set(), tasks = new Map((source?.nodes || []).map(task => [task.id, task])), roots = new Set();
    if (visible() && rendered) for (const edge of source?.edges || []) {
      if (edge.kind !== 'parent' || tasks.get(edge.from)?.hostId !== 'local' || tasks.get(edge.to)?.hostId !== 'local') continue;
      if (!parents.has(edge.to)) parents.set(edge.to, []); parents.get(edge.to).push(edge.from); children.add(edge.from);
    }
    const seeds = [...rendered?.nodes || [], ...state.model?.folded || []].sort((a, b) => Number(b.current) - Number(a.current) || a.id.localeCompare(b.id));
    for (const task of seeds) {
      if (!parents.has(task.id) && !children.has(task.id)) continue;
      const pending = [task.id], visited = new Set();
      for (let index = 0; index < pending.length; index++) {
        const id = pending[index]; if (visited.has(id)) continue; visited.add(id);
        const ancestors = parents.get(id); if (!ancestors?.length) roots.add(id); else pending.push(...[...ancestors].sort());
      }
    }
    const requested = [...roots].slice(0, 16).map(id => tasks.get(id).threadId);
    const signature = JSON.stringify(requested); if (state.relationRootSignature === signature) return;
    state.relationRootSignature = signature;
    try { callback(requested); } catch { /* Relationship status availability must not block the map. */ }
  }
  function render() {
    if (!state.root) return;
    renderNavigation();
    state.refresh.disabled = Boolean(state.pending);
    state.fullModel = graph(); state.model = completionView(state.fullModel);
    renderActions();
    const signature = JSON.stringify([contextKey(), state.limit, state.focused, state.selectedId, state.failure, state.showCompleted, state.model.folded.map(task => task.id), Boolean(state.pending), state.data?.status, state.data?.coverage?.status, state.model.edges,
      state.model.nodes.map(task => [task.id, task.displayTitle, task.description, task.projectId, task.projectName, task.hostName, task.activity, task.current, task.openable])]);
    if (state.renderSignature === signature) { syncRelationRoots(state.rendered); return; } state.renderSignature = signature;
    for (const [key, node] of Object.entries(state.scopeButtons)) node.setAttribute('aria-pressed', String(state.scope === key));
    const ordered = orderedNodes(state.model), shown = ordered.slice(0, state.limit), ids = new Set(shown.map(task => task.id));
    if (state.focused && !ids.has(state.focused)) { const focus = state.model.nodes.find(node => node.id === state.focused); if (focus) { shown.push(focus); ids.add(focus.id); } }
    if (state.selectedId && !ids.has(state.selectedId)) { const selected = state.model.nodes.find(node => node.id === state.selectedId); if (selected) { shown.push(selected); ids.add(selected.id); } }
    const rendered = { nodes: shown, edges: state.model.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) };
    state.rendered = rendered;
    const ready = Boolean(state.data || state.failure), canvas = ready && ensureCanvas(); state.canvasHost.hidden = !canvas || !shown.length; state.fallback.hidden = Boolean(window.__nuyoahWorkCanvas__?.create) || !ready;
    if (canvas) { const view = layout(rendered); state.canvas.update(view); if (state.initialFocus && shown.length) { state.initialFocus = false; if (shown.length > 12) state.canvas.focus?.(shown.find(task => task.current)?.id || view.nodes.find(node => node.kind === 'root')?.id || shown[0].id); } }
    else if (ready && !window.__nuyoahWorkCanvas__?.create) { state.fallback.replaceChildren(); for (const task of shown) state.fallback.append(button(`${task.displayTitle} · ${task.description}${task.activity === 'completed' ? ' · 已完成' : ''}`, () => activate(task.id))); }
    const remaining = Math.max(0, state.model.nodes.length - shown.length);
    setText(state.count, `${state.model.nodes.length} 个对话 · ${state.model.edges.length} 条关联`);
    state.completedToggle.hidden = !state.model.folded.length;
    state.completedToggle.setAttribute('aria-pressed', String(state.showCompleted));
    setText(state.completedToggle, state.showCompleted ? '收起已完成' : `已收起 ${state.model.folded.length} 项`);
    state.completedToggle.setAttribute('aria-label', state.showCompleted ? '收起已完成任务' : `查看已收起任务（${state.model.folded.length}）`);
    state.more.hidden = !remaining; setText(state.more, `显示更多任务（还有 ${remaining} 个）`);
    setText(state.budget, remaining ? `已显示 ${shown.length} / ${state.model.nodes.length} 个任务；可继续展开或查找定位。` : '');
    setText(state.status, statusText()); renderSearch(); syncRelationRoots(rendered);
  }
  function request() {
    if (!visible() || state.pending) return;
    if (state.scope === 'conversation' && !identity(state.context)) { state.failure = ''; state.lastRead = Date.now(); render(); return; }
    clearRelationRefresh();
    const id = crypto.randomUUID(), key = contextKey(); state.pending = { id, key }; state.failure = ''; state.lastRead = Date.now();
    queue.push({ id, consumer: 'task-map', scope: state.scope, hostId: state.context.hostId || 'local', threadId: state.context.threadId || '', projectId: state.context.projectId || '' });
    state.timer = setTimeout(() => { if (state.pending?.id !== id) return; clearPending(); state.failure = state.data ? '关联更新未完成，已保留现有地图。可重新读取。' : '关联读取未完成，请重新读取。'; render(); }, 18000);
    render();
  }
  function changeScope(scope) {
    if (scope === state.scope) return;
    closeTools();
    clearRelationRefresh(); clearPending(); state.scope = scope; state.selectedId = null; state.showCompleted = false; state.data = null; state.lastRead = 0; state.failure = ''; state.query = ''; state.search.value = ''; state.limit = 80; state.focused = null;
    const cached = state.cache.get(contextKey()); if (cached) { state.data = cached.data; state.lastRead = cached.lastRead; }
    render(); request();
  }
  function closeTools(focus = false) {
    const trigger = !state.searchPopover?.hidden ? state.searchToggle : !state.menu?.hidden ? state.menuToggle : null;
    if (state.searchPopover) state.searchPopover.hidden = true;
    if (state.menu) state.menu.hidden = true;
    state.searchToggle?.setAttribute('aria-expanded', 'false'); state.menuToggle?.setAttribute('aria-expanded', 'false');
    if (focus) trigger?.focus?.();
  }
  function toggleTool(kind) {
    const popup = kind === 'search' ? state.searchPopover : state.menu, opening = popup.hidden;
    closeTools(); popup.hidden = !opening;
    (kind === 'search' ? state.searchToggle : state.menuToggle).setAttribute('aria-expanded', String(opening));
    if (opening) (kind === 'search' ? state.search : state.refresh)?.focus?.();
  }
  function dismiss() {
    if (!visible()) return false;
    if (!state.searchPopover.hidden || !state.menu.hidden) closeTools(true);
    else if (selectedAction()?.formOpen) backToDetails();
    else if (state.selectedId) closeInspector();
    else return false;
    return true;
  }
  function build() {
    state.root = make('section', undefined, 'nuyoah-task-map');
    const top = make('div', undefined, 'nuyoah-task-map-top');
    state.backRow = make('div', undefined, 'nuyoah-task-map-back'); state.backTitle = make('span');
    state.backRow.append(button('返回上一对话', goBack), state.backTitle); state.root.append(state.backRow);
    const choices = make('div', undefined, 'nuyoah-task-map-scopes'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', '任务地图范围'); state.scopeButtons = {};
    for (const [key, label] of Object.entries(scopes)) { const node = button(label, () => changeScope(key)); state.scopeButtons[key] = node; choices.append(node); } top.append(choices);
    const tools = make('div', undefined, 'nuyoah-task-map-tools');
    state.searchToggle = button('⌕', () => toggleTool('search'), '查找任务'); state.menuToggle = button('⋯', () => toggleTool('menu'), '地图选项');
    for (const node of [state.searchToggle, state.menuToggle]) { node.className = 'nuyoah-task-map-icon'; node.setAttribute('aria-expanded', 'false'); }
    tools.append(state.searchToggle, state.menuToggle); top.append(tools); state.root.append(top);
    state.menu = make('div', undefined, 'nuyoah-task-map-menu'); state.menu.hidden = true;
    state.refresh = button('重新读取', () => { closeTools(); request(); }, '重新读取任务关联');
    state.expand = button('展开画布', () => { state.large = !state.large; state.plane.setAttribute('data-large', String(state.large)); setText(state.expand, state.large ? '收起画布' : '展开画布'); closeTools(); });
    state.menu.append(state.refresh, button('定位当前对话', () => { closeTools(); state.focused = identity(state.context); render(); state.canvas?.focus?.(state.focused); }), state.expand);
    state.count = make('p', '', 'nuyoah-task-map-count'); state.menu.append(state.count, make('p', '实线 · 子任务　虚线 · 派生　点线 · 关联', 'nuyoah-task-map-legend')); state.root.append(state.menu);
    state.status = make('p', '', 'nuyoah-task-map-status'); state.status.setAttribute('role', 'status'); state.root.append(state.status);
    state.completedToggle = button('', () => { state.showCompleted = !state.showCompleted; render(); }); state.completedToggle.className = 'nuyoah-task-map-completed';
    const searchRow = make('div', undefined, 'nuyoah-task-map-search'); state.search = make('input'); state.search.type = 'search'; state.search.placeholder = '查找并定位任务'; state.search.maxLength = 200; state.search.setAttribute('aria-label', '查找地图中的任务'); state.search.oninput = () => { state.query = state.search.value; renderSearch(); };
    searchRow.append(state.search); state.searchPopover = make('div', undefined, 'nuyoah-task-map-search-popover'); state.searchPopover.hidden = true; state.searchPopover.append(searchRow); state.root.append(state.searchPopover);
    state.searchResults = make('div', undefined, 'nuyoah-task-map-results'); state.searchResults.hidden = true; state.searchPopover.append(state.searchResults);
    state.plane = make('div', undefined, 'nuyoah-task-map-plane'); state.root.append(state.plane);
    state.canvasHost = make('div', undefined, 'nuyoah-task-map-canvas'); state.canvasHost.setAttribute('aria-label', '对话关系画布'); state.plane.append(state.canvasHost, state.completedToggle);
    buildActions();
    state.fallback = make('div', undefined, 'nuyoah-task-map-fallback'); state.root.append(state.fallback);
    state.budget = make('p', '', 'nuyoah-task-map-count'); state.more = button('', () => { state.limit += 80; render(); }); state.root.append(state.budget, state.more);
    state.root.onkeydown = event => {
      if (event.key !== 'Escape' || !dismiss()) return;
      event.preventDefault(); event.stopPropagation();
    };
  }
  function mount(container, options = {}) {
    if (!state.root) build();
    const before = contextKey(); state.context = options.context || {}; state.tasks = Array.isArray(options.tasks) ? options.tasks : []; state.options = options; state.active = true;
    reconcileNavigation();
    if (state.root.getAttribute('data-active') !== 'true') state.root.setAttribute('data-active', 'true');
    if (state.root.parentNode !== container) container.append(state.root);
    const contextChanged = before !== contextKey();
    if (contextChanged) { clearRelationRefresh(); clearPending(); closeTools(); state.selectedId = null; state.data = null; state.lastRead = 0; state.failure = ''; state.focused = null; state.limit = 80; state.query = ''; state.search.value = ''; const cached = state.cache.get(contextKey()); if (cached) { state.data = cached.data; state.lastRead = cached.lastRead; } }
    render();
    // A failed read must stay actionable. Otherwise the frequent sidebar sync
    // immediately starts another request after a timeout and hides the error
    // behind an apparently endless "updating" state.
    if (visible() && !state.pending && !state.failure && state.data?.status !== 'unavailable'
      && (contextChanged || !state.lastRead || Date.now() - state.lastRead >= 10000)) request();
  }
  function receive(response) {
    if (!state.pending || response?.id !== state.pending.id || state.pending.key !== contextKey()) return;
    const dirty = state.relationsDirty; clearRelationRefresh(); clearPending();
    if (state.scope === 'conversation' && !identity(state.context)) { state.data = null; state.failure = ''; render(); return; }
    if (response.error || !response.data || !Array.isArray(response.data.nodes) || !Array.isArray(response.data.edges) || !['ready', 'partial', 'unavailable'].includes(response.data.status)) {
      state.failure = state.data ? '关联更新失败，已保留现有地图。请重新读取。' : '无法读取任务关联，请重新读取。'; render(); return;
    }
    if (response.data.status === 'unavailable' && state.data) state.failure = '暂时无法更新关联，已保留现有地图。可重新读取。';
    else { state.data = response.data; state.failure = ''; state.cache.set(contextKey(), { data: state.data, lastRead: Date.now() }); while (state.cache.size > 12) state.cache.delete(state.cache.keys().next().value); }
    state.lastRead = Date.now(); render();
    if (dirty) invalidateRelations();
  }
  const style = make('style'); style.id = 'nuyoah-task-map-style'; style.textContent = `
 .nuyoah-task-map{font:inherit;color:var(--nuyoah-text,var(--color-token-text-primary,inherit));line-height:1.5;min-width:0;min-height:0;height:100%;display:flex;flex-direction:column;position:relative;container-type:inline-size;--task-map-border:var(--nuyoah-border,color-mix(in srgb,currentColor 12%,transparent));--task-map-surface:var(--nuyoah-surface,var(--color-token-bg-primary,Canvas));--task-map-muted:var(--nuyoah-muted,var(--color-token-text-secondary,GrayText));--task-map-accent:var(--nuyoah-accent,var(--text-link,#2878c8));--task-map-subtle:var(--nuyoah-subtle,color-mix(in srgb,currentColor 5%,transparent));background:var(--nuyoah-canvas-bg,var(--color-token-bg-secondary,var(--task-map-surface)))}
.nuyoah-task-map *{box-sizing:border-box}.nuyoah-task-map [hidden]{display:none!important}
.nuyoah-task-map button,.nuyoah-task-map input,.nuyoah-task-map textarea{font:inherit;color:inherit;border:0;background:transparent;border-radius:8px;padding:7px 10px;max-width:100%;line-height:1.4}
.nuyoah-task-map button{cursor:pointer}.nuyoah-task-map button:hover{background:var(--task-map-subtle)}.nuyoah-task-map button:disabled{opacity:.45;cursor:default}
.nuyoah-task-map :is(button,input,textarea):focus-visible{outline:2px solid var(--task-map-accent);outline-offset:3px}.nuyoah-task-map-top{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:12px 20px;min-height:60px;flex:none}.nuyoah-task-map-scopes{display:flex;gap:2px;align-items:center;background:var(--task-map-subtle);padding:3px;border-radius:10px;min-width:0}.nuyoah-task-map-scopes>button{padding:6px 12px;white-space:nowrap;font-size:.82em;color:var(--task-map-muted)}.nuyoah-task-map-scopes>button[aria-pressed=true]{background:var(--task-map-surface);color:inherit;box-shadow:0 1px 3px #0000000f}.nuyoah-task-map-tools{display:flex;gap:4px;flex:none}.nuyoah-task-map .nuyoah-task-map-icon{width:32px;height:32px;padding:0;display:inline-flex;justify-content:center;align-items:center;flex:none;font-size:22px}.nuyoah-task-map-icon[aria-expanded=true]{color:var(--task-map-accent);background:var(--nuyoah-accent-soft,var(--task-map-subtle))}
.nuyoah-task-map p{margin:0;overflow-wrap:anywhere}.nuyoah-task-map p:empty{display:none}.nuyoah-task-map-status{font-size:.8em;padding:0 20px 10px;color:var(--task-map-muted);flex:none}.nuyoah-task-map-count,.nuyoah-task-map-legend{font-size:.72em;color:var(--task-map-muted)}.nuyoah-task-map>.nuyoah-task-map-count{padding:4px 20px}.nuyoah-task-map-menu,.nuyoah-task-map-search-popover{position:absolute;z-index:15;right:16px;top:58px;width:290px;max-width:calc(100% - 32px);padding:8px;border:1px solid var(--task-map-border);border-radius:13px;background:var(--task-map-surface);box-shadow:0 12px 32px #00000018}.nuyoah-task-map-menu{width:250px;display:grid;gap:3px}.nuyoah-task-map-menu>button{text-align:left;font-size:.85em}.nuyoah-task-map-menu>p{padding:8px 10px}.nuyoah-task-map-search input{width:100%;min-width:0;background:var(--task-map-subtle);font-size:.9em}.nuyoah-task-map-results,.nuyoah-task-map-fallback{display:grid;gap:4px;max-height:260px;overflow:auto;margin-top:6px}.nuyoah-task-map-results button,.nuyoah-task-map-fallback button{text-align:left;overflow-wrap:anywhere;font-size:.85em}
.nuyoah-task-map-plane{position:relative;flex:1;min-height:300px;isolation:isolate;display:grid;grid-template-columns:minmax(0,1fr)}.nuyoah-task-map-canvas{width:100%;height:100%;min-width:0;min-height:300px}.nuyoah-task-map-plane[data-large=true]{min-height:min(76vh,840px)}.nuyoah-task-map .nuyoah-task-map-completed{position:absolute;z-index:4;left:16px;bottom:16px;font-size:.74em;padding:8px 10px;background:var(--task-map-surface);color:var(--task-map-muted);border:1px solid var(--task-map-border);border-radius:10px;max-width:calc(100% - 205px)}
.nuyoah-task-map[data-active=false] .nuyoah-work-canvas-node,.nuyoah-task-map[data-active=false] .nuyoah-work-canvas-node-dot,.nuyoah-task-map[data-active=false] .nuyoah-work-canvas-node::after{animation-play-state:paused!important}
.nuyoah-task-map-back{display:flex;gap:8px;align-items:center;padding:7px 20px 0;min-width:0;flex:none}.nuyoah-task-map-back>button{flex:none;color:var(--task-map-accent);font-size:.8em;padding:5px 0}.nuyoah-task-map-back>span{font-size:.75em;color:var(--task-map-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nuyoah-task-map-actions{position:absolute;z-index:8;top:16px;right:16px;bottom:76px;width:296px;padding:18px;border:1px solid var(--task-map-border);border-radius:18px;min-width:0;background:var(--task-map-surface);box-shadow:0 16px 45px -18px #00000025;display:flex;flex-direction:column;gap:12px;overflow:auto;overscroll-behavior:contain;touch-action:auto}.nuyoah-task-map-action-header{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:.75em;color:var(--task-map-muted)}.nuyoah-task-map-action-header>button:not(.nuyoah-task-map-icon){padding:0;color:var(--task-map-accent);font-size:inherit}.nuyoah-task-map-actions h3{margin:0;line-height:1.5;font-size:1.13em;font-weight:600;overflow-wrap:anywhere}.nuyoah-task-map-action-description,.nuyoah-task-map-action-destination,.nuyoah-task-map-action-hint,.nuyoah-task-map-action-status{font-size:.8em;color:var(--task-map-muted)}.nuyoah-task-map-action-choices{display:flex;flex-direction:column;gap:4px}.nuyoah-task-map-action-choices>button{text-align:left;padding:11px 9px;font-size:.86em}.nuyoah-task-map-action-choices>button:first-child{color:var(--task-map-accent);background:var(--nuyoah-accent-soft,var(--task-map-subtle))}.nuyoah-task-map-action-form{display:flex;flex-direction:column;gap:11px}.nuyoah-task-map-actions label{display:grid;gap:6px;font-size:.77em;color:var(--task-map-muted)}.nuyoah-task-map-actions :is(input,textarea){width:100%;min-width:0;background:var(--nuyoah-canvas-bg,var(--task-map-subtle));border:1px solid var(--task-map-border);padding:10px 11px;color:var(--nuyoah-text,inherit);font-size:1.05em;border-radius:10px}.nuyoah-task-map-actions textarea{resize:vertical;min-height:96px;max-height:180px}.nuyoah-task-map .nuyoah-task-map-submit{align-self:flex-end;font-size:.83em;background:var(--task-map-accent);color:var(--color-token-text-inverse,white);padding:9px 13px}.nuyoah-task-map-action-controls{display:flex;gap:6px;flex-wrap:wrap}.nuyoah-task-map-action-controls:has(>button:not([hidden])){padding-top:4px}.nuyoah-task-map-action-controls>button,.nuyoah-task-map-action-footer>button{color:var(--task-map-accent);font-size:.82em}.nuyoah-task-map-action-footer{margin-top:auto;border-top:1px solid var(--task-map-border);padding-top:9px}.nuyoah-task-map-action-status[data-status=failed],.nuyoah-task-map-action-status[data-status=unknown]{font-weight:600;color:inherit}
@container (min-width:700px){.nuyoah-task-map-plane[data-inspecting=true]{grid-template-columns:minmax(0,1fr) 320px}.nuyoah-task-map-plane[data-inspecting=true] .nuyoah-work-canvas-toolbar{right:12px}.nuyoah-task-map-plane[data-inspecting=true] .nuyoah-task-map-completed{max-width:calc(100% - 525px)}}
@container (max-width:699px){.nuyoah-task-map-actions{top:auto;bottom:72px;left:16px;right:16px;width:auto;max-height:min(440px,calc(100% - 88px));padding:16px;gap:10px}.nuyoah-task-map-actions h3{font-size:1em}.nuyoah-task-map-action-choices{display:grid;grid-template-columns:1fr 1fr;gap:4px}.nuyoah-task-map-action-choices>button{font-size:.8em;padding:10px 7px}.nuyoah-task-map-action-footer{padding-top:6px}.nuyoah-task-map-actions textarea{min-height:82px}}
@container (max-width:480px){.nuyoah-task-map-top{padding:10px 14px;gap:4px}.nuyoah-task-map-scopes>button{padding:6px 9px;font-size:.76em}.nuyoah-task-map-tools{gap:0}.nuyoah-task-map .nuyoah-task-map-completed{max-width:calc(100% - 155px);font-size:.7em;padding:7px 8px}}
`; document.head.append(style);
  const visibilityChanged = () => { if (visible()) render(); else syncRelationRoots(null); };
  document.addEventListener?.('visibilitychange', visibilityChanged);
  window.__nuyoahTaskMapUI__ = { mount, receive, dismiss, invalidateRelations, takeRequest: () => visible() ? queue.shift() || null : null,
    retainActions() { state.retainActions = true; return actionMemory; },
    refreshLive() { if (visible()) render(); },
    suspend() { clearRelationRefresh(); state.active = false; clearTimeout(state.completionTimer); syncRelationRoots(null); if (state.root?.getAttribute('data-active') !== 'false') state.root?.setAttribute('data-active', 'false'); clearPending(); state.lastRead = 0; },
    destroy() { clearRelationRefresh(); clearPending(); clearTimeout(state.completionTimer); state.destroyed = true; for (const record of state.actions.values()) { clearTimeout(record.inspectTimer); record.inspectToken = null; record.inspecting = false; if (!state.retainActions) { clearTimeout(record.operationTimer); record.operationToken = null; } } if (!state.retainActions) state.actions.clear(); state.active = false; syncRelationRoots(null); document.removeEventListener?.('visibilitychange', visibilityChanged); state.cache.clear(); state.canvas?.destroy(); state.root?.remove(); style.remove(); }
  };
})();
