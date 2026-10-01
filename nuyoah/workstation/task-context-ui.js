(() => {
  const previous = window.__nuyoahTaskContextUI__;
  previous?.destroy?.();
  const views = new Map(), queue = [];
  let active = null;
  const preferencesKey = 'nuyoah.task-context-position.v1';
  function savedPreferences(threadId) {
    try { return JSON.parse(localStorage.getItem(preferencesKey) || '{}')[threadId] || {}; } catch { return {}; }
  }
  function savePreferences(view) {
    try {
      const saved = JSON.parse(localStorage.getItem(preferencesKey) || '{}');
      delete saved[view.threadId]; saved[view.threadId] = view.preferences;
      localStorage.setItem(preferencesKey, JSON.stringify(Object.fromEntries(Object.entries(saved).slice(-100))));
    } catch {}
  }
  function rememberDetails(view, element, key, defaultOpen = false) {
    element.open = typeof view.preferences[key] === 'boolean' ? view.preferences[key] : defaultOpen;
    element.addEventListener('toggle', () => { view.preferences[key] = element.open; savePreferences(view); });
  }
  function requestPreview(view, ref, trigger) {
    if (view.previewPending) return;
    const id = crypto.randomUUID(); view.previewPending = id;
    view.previewDialog?.remove();
    const dialog = node('dialog'); dialog.className = 'nuyoah-file-preview'; dialog.setAttribute('aria-label', `预览 ${ref.label}`);
    const header = node('div'); header.className = 'nuyoah-context-actions'; header.append(node('strong', ref.label));
    const close = node('button', '关闭'); close.type = 'button'; close.onclick = () => dialog.close(); header.append(close);
    view.previewBody = node('div', '正在读取文件…'); view.previewBody.setAttribute('role', 'status'); dialog.append(header, view.previewBody);
    dialog.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.close(); } };
    dialog.onclose = () => { view.previewPending = null; clearTimeout(view.previewTimer); dialog.remove(); if (trigger.isConnected) trigger.focus(); };
    view.root.append(dialog); view.previewDialog = dialog; dialog.showModal();
    view.previewTimer = setTimeout(() => { if (view.previewPending === id) { view.previewPending = null; view.previewBody.textContent = '读取超时，请关闭后重试。'; } }, 18000);
    queue.push({ id, threadId: view.threadId, action: 'preview', path: ref.path });
  }
  function closePreviewOnEscape(event) {
    if (event.key !== 'Escape' || !active?.previewDialog?.open) return;
    event.preventDefault(); event.stopImmediatePropagation(); active.previewDialog.close();
  }
  window.addEventListener('keydown', closePreviewOnEscape, true);
  const fields = { goal: '目标', progress: '进展', nextStep: '下一步', agreements: '固定约定', assistantVerification: '助手验证', userConfirmation: '用户确认' };
  function node(tag, text) { const el = document.createElement(tag); if (text) el.textContent = text; return el; }
  function request(view, action, extra = {}) {
    if (view.pending) return;
    const id = crypto.randomUUID();
    view.pending = { id, action, section: extra.section, enabled: extra.enabled, editVersion: view.edits[extra.section] || 0 };
    view.status.textContent = action === 'read' ? (view.data ? '' : '正在读取…') : action === 'cold:archive' ? '正在请求冷存…' : '正在保存…';
    renderCold(view);
    view.timer = setTimeout(() => {
      if (view.pending?.id !== id) return;
      view.pending = null; renderCold(view); view.tokenSmart.textContent = 'Token Smart · 暂时无法核对'; view.status.textContent = '未收到保存或读取结果，请重新读取核对；输入已保留。';
    }, 18000);
    queue.push({ id, threadId: view.threadId, action, ...extra });
  }
  function build(threadId, insert) {
    const view = { threadId, dirty: new Set(), edits: {}, data: null, inputs: {}, pending: null, lastRead: 0, preferences: savedPreferences(threadId) };
    view.root = node('section'); view.root.className = 'nuyoah-task-context';
    const heading = node('div'); heading.className = 'nuyoah-context-actions nuyoah-context-heading';
    const menu = node('details'); menu.className = 'nuyoah-context-menu'; view.menu = menu;
    const menuToggle = node('summary', '⋯'); menuToggle.setAttribute('aria-label', '摘要选项');
    const menuActions = node('div'); menuActions.className = 'nuyoah-context-menu-actions'; menu.append(menuToggle, menuActions); heading.append(menu);
    const reload = node('button', '↻'); reload.type = 'button'; reload.className = 'nuyoah-context-reload'; reload.title = '重新读取'; reload.setAttribute('aria-label', '重新读取');
    reload.onclick = () => { menu.open = false; request(view, 'read'); };
    const maintain = node('button', '请助手更新'); maintain.type = 'button'; maintain.className = 'nuyoah-context-maintain';
    maintain.onclick = () => {
      menu.open = false;
      const command = window.__NUYOAH_WORKSTATION_CONFIG__?.taskContextCommand || [];
      const ok = insert(`请核对本任务的接续摘要。任务 ID：${threadId}。先使用 ${command.map(x => JSON.stringify(x)).join(' ')} read ${threadId} 读取记录，再通过 update 命令只更新 summary 区域并传入已读取的 revision。仅记录已知事实，区分助手验证和用户确认；没有实质变化无需写入。保留 notes、references，不读取全部历史，不启用提醒。`);
      view.status.textContent = ok ? '已插入，发送后由助手核对。' : '当前输入区不可用。';
    };
    menuActions.append(reload, maintain); view.root.append(heading);
    view.status = node('p'); view.status.setAttribute('role', 'status');
    view.root.append(view.status);
    view.tokenSmart = node('button', 'Token Smart · 核对中'); view.tokenSmart.type = 'button';
    view.tokenSmart.className = 'nuyoah-token-badge';
    view.tokenSmart.setAttribute('aria-expanded', 'false');
    const evidenceRow = node('div'); evidenceRow.className = 'nuyoah-context-actions';
    evidenceRow.append(view.tokenSmart); view.root.append(evidenceRow);
    view.evidence = node('p'); view.evidence.className = 'nuyoah-token-details'; view.evidence.hidden = true;
    view.tokenSmart.onclick = () => { view.evidence.hidden = !view.evidence.hidden; view.tokenSmart.setAttribute('aria-expanded', String(!view.evidence.hidden)); };
    view.root.append(view.evidence);
    const summary = node('section'); summary.className = 'nuyoah-summary';
    view.presentation = node('div'); summary.append(view.presentation);
    view.summaryDetails = node('details'); view.summaryDetails.hidden = true; view.summaryDetails.append(node('summary', '进展与约定'));
    view.secondaryPresentation = node('div'); view.summaryDetails.append(view.secondaryPresentation); summary.append(view.summaryDetails);
    rememberDetails(view, view.summaryDetails, 'summaryDetails');
    view.editor = node('div'); view.editor.hidden = true;
    const edit = node('button', '编辑摘要'); edit.type = 'button'; edit.className = 'nuyoah-context-edit';
    edit.onclick = () => { menu.open = false; view.editor.hidden = !view.editor.hidden; if (!view.editor.hidden) view.inputs.goal.focus(); };
    menuActions.insertBefore(edit, reload); summary.append(view.editor);
    for (const [key, label] of Object.entries(fields)) {
      const holder = node('label', label); const input = node('textarea'); input.rows = key === 'progress' ? 3 : 2; input.maxLength = 8000;
      input.oninput = () => { view.dirty.add('summary'); view.edits.summary = (view.edits.summary || 0) + 1; }; holder.append(input); view.editor.append(holder); view.inputs[key] = input;
    }
    function saveButton(section, value) {
      const button = node('button', '保存'); button.type = 'button';
      button.onclick = () => {
        if (!view.data) { view.status.textContent = '请先读取任务记录。'; return; }
        request(view, 'save', { section, value: value(), revision: view.data.revision });
      };
      return button;
    }
    view.editor.append(saveButton('summary', () => Object.fromEntries(Object.keys(fields).map(k => [k, view.inputs[k].value]))));
    view.root.append(summary);
    const cold = node('details'); cold.className = 'nuyoah-cold-history'; view.cold = cold;
    const coldHeading = node('summary'); coldHeading.append(node('span', '冷历史'));
    view.coldBadge = node('span', '未读取'); view.coldBadge.className = 'nuyoah-cold-badge'; coldHeading.append(view.coldBadge); cold.append(coldHeading);
    const coldActions = node('div'); coldActions.className = 'nuyoah-context-actions';
    const autoLabel = node('label'); autoLabel.className = 'nuyoah-cold-switch';
    view.coldAuto = node('input'); view.coldAuto.type = 'checkbox'; view.coldAuto.setAttribute('aria-label', '自动冷存');
    autoLabel.append(view.coldAuto, node('span', '自动冷存'));
    view.coldAuto.onchange = () => request(view, 'cold:auto', { enabled: view.coldAuto.checked });
    view.coldSave = node('button', '立即冷存'); view.coldSave.type = 'button';
    view.coldSave.onclick = () => request(view, 'cold:archive'); coldActions.append(autoLabel, view.coldSave); cold.append(coldActions);
    view.coldMessage = node('p'); view.coldMessage.setAttribute('role', 'status'); cold.append(view.coldMessage);
    cold.append(node('p', '完整旧记录另存，原任务保留。自动冷存开启后，任务结束并静置 5 分钟时归档，每天最多一次。'));
    const folderLabel = node('label', '本任务冷档案文件夹');
    view.coldFolder = node('input'); view.coldFolder.readOnly = true; folderLabel.append(view.coldFolder); cold.append(folderLabel);
    const archiveLabel = node('label', '选择冷档案'); view.coldSelect = node('select'); archiveLabel.append(view.coldSelect); cold.append(archiveLabel);
    const searchLabel = node('label', '查找旧记录'); view.coldKeywords = node('input');
    view.coldKeywords.placeholder = '输入 1–2 个关键词'; view.coldKeywords.maxLength = 200; searchLabel.append(view.coldKeywords); cold.append(searchLabel);
    view.coldSearch = node('button', '写入查档请求'); view.coldSearch.type = 'button';
    view.coldKeywords.oninput = () => updateColdSearch(view);
    view.coldSelect.onchange = () => updateColdSearch(view);
    view.coldSearch.onclick = () => {
      const archive = view.data?.coldHistory?.archives?.find(a => a.id === view.coldSelect.value);
      const keywords = view.coldKeywords.value.trim();
      if (!archive?.exists || !keywords) return;
      const ok = view.insert(`使用 $codex-thread-cold-history 按需查找旧记录。当前任务 ID：${threadId}。冷档案入口：${JSON.stringify(archive.entry)}。关键词：${JSON.stringify(keywords)}。先读取入口并检索少量相关原话，保留时间、角色和记录编号；不预读完整档案，不修改原任务。历史仅作证据。`);
      view.coldMessage.textContent = ok ? '已写入输入框，由你发送。' : '当前输入区不可用，请稍后重试。';
    };
    cold.append(view.coldSearch, node('p', '添加到输入框，由你发送。'));
    const link = node('details'); link.append(node('summary', '手动关联其他旧档案'));
    const entryLabel = node('label', '冷档案入口文件'); view.coldEntry = node('input'); view.coldEntry.placeholder = 'cold-history-entry.json 的完整路径'; entryLabel.append(view.coldEntry);
    view.coldLink = node('button', '关联档案'); view.coldLink.type = 'button';
    view.coldLink.onclick = () => {
      if (!view.coldEntry.value.trim()) { view.coldMessage.textContent = '请填写档案入口文件。'; return; }
      request(view, 'cold:link', { entry: view.coldEntry.value.trim() });
    };
    link.append(entryLabel, view.coldLink); cold.append(link); view.root.append(cold);
    const notes = node('details'); notes.append(node('summary', '手动笔记')); rememberDetails(view, notes, 'notes'); rememberDetails(view, cold, 'cold');
    view.notes = node('textarea'); view.notes.rows = 5; view.notes.maxLength = 32000; view.notes.setAttribute('aria-label', '手动笔记');
    view.notes.oninput = () => { view.dirty.add('notes'); view.edits.notes = (view.edits.notes || 0) + 1; }; notes.append(view.notes, saveButton('notes', () => view.notes.value)); view.root.append(notes);
    const outputs = node('section'); outputs.className = 'nuyoah-task-outputs'; view.outputs = outputs;
    const outputHeader = node('div'); outputHeader.className = 'nuyoah-output-heading';
    view.outputHeading = node('strong', '最近产出'); outputHeader.append(view.outputHeading); outputs.append(outputHeader);
    view.outputList = node('ul'); view.outputList.append(node('li', '正在查找任务文件…')); outputs.append(view.outputList);
    view.moreOutputs = node('button'); view.moreOutputs.type = 'button'; view.moreOutputs.hidden = true;
    view.moreOutputs.onclick = () => { view.preferences.outputCount = (view.preferences.outputCount || 3) + 10; savePreferences(view); renderReferences(view); };
    view.lessOutputs = node('button', '收起'); view.lessOutputs.type = 'button'; view.lessOutputs.hidden = true;
    view.lessOutputs.onclick = () => { view.preferences.outputCount = 3; savePreferences(view); renderReferences(view); };
    outputHeader.append(view.moreOutputs, view.lessOutputs);
    const refs = node('details'); view.referenceHeading = node('summary', '参考资料'); refs.append(view.referenceHeading); rememberDetails(view, refs, 'references');
    view.referenceStatus = node('p', '正在查找任务文件…'); view.referenceStatus.setAttribute('role', 'status'); refs.append(view.referenceStatus);
    const restore = node('button', '恢复已隐藏文件'); restore.type = 'button'; view.restoreReferences = restore;
    restore.onclick = () => request(view, 'save', { section: 'excludedReferencePaths', value: [], revision: view.data.revision });
    restore.hidden = true; refs.append(restore);
    view.list = node('ul'); refs.append(view.list);
    const management = node('details'); management.append(node('summary', '管理资料')); rememberDetails(view, management, 'management');
    const form = node('form');
    const relation = node('select'); relation.setAttribute('aria-label', '引用关系');
    for (const [value, label] of [['output', '本任务产出'], ['reference', '工作参考'], ['history', '历史引用']]) {
      const option = node('option', label); option.value = value; relation.append(option);
    }
    const file = node('input'); file.placeholder = '本机文件的完整路径'; file.setAttribute('aria-label', '文件路径'); file.required = true;
    const label = node('input'); label.placeholder = '名称（可选）'; label.setAttribute('aria-label', '引用名称');
    const add = node('button', '添加引用'); add.type = 'submit';
    form.append(relation, file, label, add);
    form.onsubmit = event => {
      event.preventDefault(); if (!view.data) return;
      request(view, 'save', { section: 'references', revision: view.data.revision,
        value: [...view.data.references.map(({ exists, ...ref }) => ref), { relation: relation.value, path: file.value, label: label.value }] });
    };
    management.append(form, restore); refs.append(management);
    const related = node('details'); related.className = 'nuyoah-related-tasks';
    view.relatedHeading = node('summary', '关联任务'); related.append(view.relatedHeading);
    view.relatedList = node('div'); related.append(view.relatedList);
    rememberDetails(view, related, 'related');
    const resources = node('details'); resources.className = 'nuyoah-context-resources'; resources.append(node('summary', '参考与笔记'), refs, notes); rememberDetails(view, resources, 'resources');
    const records = node('details'); records.className = 'nuyoah-context-records'; records.append(node('summary', '更多记录')); view.records = records; rememberDetails(view, records, 'records');
    const usage = node('details'); usage.append(node('summary', '使用记录'), evidenceRow, view.evidence);
    records.append(view.summaryDetails, usage, cold);
    view.root.append(outputs, related, resources, records); view.insert = insert;
    menu.addEventListener('focusout', event => { if (event.relatedTarget && !menu.contains(event.relatedTarget)) menu.open = false; });
    renderCold(view);
    return view;
  }
  function updateColdSearch(view) {
    const archive = view.data?.coldHistory?.archives?.find(a => a.id === view.coldSelect.value);
    view.coldSearch.disabled = !archive?.exists || !view.coldKeywords.value.trim();
  }
  function renderCold(view) {
    if (!view.coldBadge) return;
    const data = view.data?.coldHistory;
    const busy = Boolean(data?.busy);
    view.coldBadge.textContent = data?.unavailable ? '不可用' : busy ? '冷存中' : data?.archives?.length ? '已冷存' : data ? '未冷存' : '未连接';
    view.coldSave.disabled = view.coldAuto.disabled = view.coldLink.disabled = !data || data.unavailable || busy || Boolean(view.pending);
    view.coldSave.textContent = busy ? '正在冷存…' : '立即冷存';
    view.coldAuto.checked = view.pending?.action === 'cold:auto' ? view.pending.enabled : Boolean(data?.autoEnabled);
    view.coldFolder.value = data?.directory || '';
    const selected = view.coldSelect.value;
    view.coldSelect.replaceChildren();
    if (!data?.archives?.length) { const option = node('option', '尚无冷档案'); option.value = ''; view.coldSelect.append(option); }
    for (const archive of data?.archives || []) {
      const date = new Date(archive.createdAt).toLocaleString();
      const option = node('option', `${archive.label} · ${date}${archive.exists ? '' : '（文件失效）'}`);
      option.value = archive.id; view.coldSelect.append(option);
    }
    if (Array.from(view.coldSelect.options).some(o => o.value === selected)) view.coldSelect.value = selected;
    view.coldMessage.textContent = data?.error || (busy ? '正在保存完整原文与索引…' : !data ? '等待冷历史服务连接。'
      : data.archives?.length ? `已关联 ${data.archives.length} 份冷档案。` : '尚无档案，可在任务结束后立即冷存。');
    updateColdSearch(view);
  }
  let history = null;
  function mountHistory(parent, context) {
    if (!history) {
      const root = node('details'); root.className = 'nuyoah-skill-history nuyoah-task-context';
      root.append(node('summary', '技能调用记录'));
      const heading = node('div'); heading.className = 'nuyoah-context-actions';
      const scope = node('select'); scope.setAttribute('aria-label', '技能记录范围'); scope.hidden = true;
      for (const [value, label] of [['project', '当前项目']]) { const option = node('option', label); option.value = value; scope.append(option); }
      const reload = node('button', '刷新'); reload.type = 'button';
      const status = node('p'); status.setAttribute('role', 'status');
      const list = node('ul');
      heading.append(scope, reload); root.append(heading, status, list);
      history = { root, scope, status, list, reload, context: {}, key: '', pending: null };
      scope.onchange = () => loadHistory(); reload.onclick = () => loadHistory();
      root.addEventListener('toggle', loadVisibleHistory);
    }
    const key = JSON.stringify([context.threadId, context.projectId, context.hostId]);
    history.context = context;
    const destination = active?.root.parentElement === parent ? active.records : parent.querySelector('[data-nuyoah-project-records]') || parent;
    const fallback = parent.querySelector('[data-nuyoah-project-records]');
    if (fallback) fallback.hidden = destination !== fallback;
    if (history.root.parentElement !== destination) {
      history.root.parentElement?.removeEventListener('toggle', loadVisibleHistory);
      destination.append(history.root);
      destination.addEventListener('toggle', loadVisibleHistory);
    }
    if (key !== history.key) {
      history.key = key;
      clearTimeout(history.timer); history.pending = null;
      history.scope.options[0].disabled = !context.projectId || context.projectId === '__unassigned__';
      history.scope.value = 'project';
      history.loadedKey = ''; history.list.replaceChildren(); history.status.textContent = '';
    }
    loadVisibleHistory();
  }
  function loadVisibleHistory() {
    if (!history || history.loadedKey === history.key || !history.root.open || !history.root.getClientRects().length) return;
    for (let parent = history.root.parentElement; parent; parent = parent.parentElement) {
      if (parent.hidden || (parent.tagName === 'DETAILS' && !parent.open)) return;
    }
    loadHistory();
  }
  function loadHistory() {
    const h = history; if (!h) return;
    h.loadedKey = h.key;
    clearTimeout(h.timer); h.pending = null; h.list.replaceChildren();
    if (h.context.hostId !== 'local') { h.status.textContent = '远程任务的技能记录暂不可核对。'; return; }
    if (!(h.scope.value === 'task' ? h.context.threadId : h.context.projectId)) { h.status.textContent = '选择项目或任务后查看记录。'; return; }
    const id = crypto.randomUUID(); h.pending = id; h.status.textContent = '正在核对技能记录…';
    // Only one pending history request for the visible scope.
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].action === 'skills:history') queue.splice(i, 1);
    queue.push({ id, action: 'skills:history', scope: h.scope.value, ...h.context });
    h.timer = setTimeout(() => { if (h.pending === id) { h.pending = null; h.status.textContent = '核对超时，请刷新重试。'; } }, 30000);
  }
  function receiveHistory(result) {
    if (!history || result.id !== history.pending) return;
    const h = history, data = result.skillHistory; h.pending = null; clearTimeout(h.timer);
    const project = h.scope.value === 'project';
    h.status.textContent = data.status === 'unavailable' ? '暂时无法核对，请刷新重试。'
      : `${project ? `已核对 ${data.checked} / ${data.total} 个任务 · ` : ''}${data.status === 'partial' ? '部分记录 · ' : ''}${data.skills.length} 个技能`;
    h.list.replaceChildren(...data.skills.map(skill => {
      const row = node('li'); row.append(node('strong', skill.name));
      row.append(node('small', `${skill.count} 次读取${project ? ` · ${skill.taskCount} 个任务` : ''} · ${new Date(skill.readAt).toLocaleString('zh-CN')}`));
      return row;
    }));
    if (!data.skills.length && data.status !== 'unavailable') h.list.append(node('li', data.status === 'partial' ? '已核对的记录中未发现技能读取。' : '尚未发现技能读取记录。'));
  }
  function receive(result) {
    if (result.skillHistory) { receiveHistory(result); return; }
    const view = views.get(result.threadId);
    if (!view) return;
    if (view.previewPending === result.id) {
      view.previewPending = null; clearTimeout(view.previewTimer);
      if (active !== view || !view.previewDialog?.open) return;
      view.previewBody.replaceChildren();
      if (result.error) view.previewBody.textContent = result.error;
      else if (result.preview?.image) { const img = node('img'); img.src = result.preview.image; img.alt = result.preview.label; view.previewBody.append(img); }
      else { const text = node('pre', result.preview?.text || '此格式暂不支持预览。'); view.previewBody.append(text); if (result.preview?.truncated) view.previewBody.append(node('p', '文件较大，已显示部分内容。')); }
      return;
    }
    if (view.pending?.id !== result.id) return;
    const pending = view.pending; view.pending = null; clearTimeout(view.timer);
    if (result.error) { renderCold(view); view.tokenSmart.textContent = 'Token Smart · 暂时无法核对'; view.status.textContent = result.error; return; }
    if (!result.data || result.data.threadId !== view.threadId) { view.status.textContent = '任务响应不匹配，请重试。'; return; }
    view.data = result.data; view.lastRead = Date.now();
    const evidence = view.data.tokenSmart;
    view.tokenSmart.textContent = 'Token Smart · ' + (evidence?.status === 'read' ? '已读取' : evidence?.status === 'not_observed' ? '未见读取' : '暂不可核对');
    view.evidence.textContent = evidence?.status === 'read' ? `本任务最近读取：${new Date(evidence.readAt).toLocaleString()}。读取不代表逐条执行或额度节省。`
      : evidence?.status === 'not_observed' ? '本任务尚未发现匹配的读取记录。' : '暂时无法核对本任务的读取记录，可重新读取。';
    renderCold(view);
    if (pending.action === 'save' && (view.edits[pending.section] || 0) === pending.editVersion) view.dirty.delete(pending.section);
    if (!view.dirty.has('summary')) for (const key of Object.keys(fields)) view.inputs[key].value = view.data.summary[key] || '';
    if (!view.dirty.has('notes')) view.notes.value = view.data.notes || '';
    view.presentation.replaceChildren(); view.secondaryPresentation.replaceChildren();
    for (const [key, label] of Object.entries(fields)) {
      const value = view.data.summary[key]; if (!value) continue;
      const row = node('div'); row.className = 'nuyoah-summary-row'; row.dataset.summaryField = key;
      row.append(node('strong', label), node('p', value)); (['goal', 'nextStep'].includes(key) ? view.presentation : view.secondaryPresentation).append(row);
    }
    view.summaryDetails.hidden = !view.secondaryPresentation.childElementCount;
    if (!view.presentation.childElementCount) view.presentation.append(node('p', '尚无任务摘要'));
    if (pending.action === 'save' && pending.section === 'summary' && !view.dirty.has('summary')) view.editor.hidden = true;
    renderReferences(view); renderRelated(view);
    view.status.textContent = view.dirty.size ? '已读取最新记录；未保存输入已保留，请核对后保存。' : pending.action === 'save' ? '已保存' : '';
  }
  function renderRelated(view) {
    const refs = view.data?.automaticReferences?.relatedThreads || [];
    const tasks = refs.map(ref => view.catalog?.find(task => task.threadId === ref.threadId && task.hostId === 'local')
      || { threadId: ref.threadId, title: `任务 · ${ref.threadId.slice(-6)}`, statusLabel: '待同步', unavailable: true });
    const signature = JSON.stringify(tasks.map(task => [task.threadId, task.title, task.statusLabel, task.projectName, task.unavailable]));
    if (signature === view.relatedSignature) return;
    view.relatedSignature = signature;
    const focused = view.relatedList.contains(document.activeElement) ? document.activeElement.dataset.threadId : null;
    view.relatedHeading.textContent = `关联任务${tasks.length ? ` · ${tasks.length}` : ''}`;
    view.relatedList.replaceChildren(...tasks.map(task => {
      const button = node('button'); button.type = 'button'; button.className = 'nuyoah-project-task';
      button.dataset.threadId = task.threadId; button.disabled = Boolean(task.unavailable);
      const duplicate = tasks.filter(other => other.title === task.title).length > 1;
      const suffix = duplicate ? ` · 编号 ${task.threadId.slice(-6)}` : '';
      button.setAttribute('aria-label', `打开任务：${task.title}${suffix}`);
      const content = node('div'); content.className = 'nuyoah-project-task-content'; content.append(node('strong', task.title));
      if (task.projectName || suffix) content.append(node('small', `${task.projectName || ''}${suffix}`));
      const status = node('span', task.statusLabel); status.className = 'nuyoah-project-task-status';
      button.append(content, status); button.onclick = () => view.openTask?.(task); return button;
    }));
    if (!tasks.length) view.relatedList.append(node('p', view.data ? '尚未发现可打开的关联任务。' : '正在查找关联任务…'));
    if (focused) Array.from(view.relatedList.children).find(row => row.dataset.threadId === focused)?.focus({ preventScroll: true });
  }
  function renderReferences(view) {
    if (!view.data) return;
    const auto = view.data.automaticReferences;
    const all = [...view.data.references, ...(auto?.references || [])].sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
    const signature = JSON.stringify([all, auto?.status, view.data.excludedReferencePaths, view.preferences.outputCount]);
    if (signature === view.referenceSignature) return;
    view.referenceSignature = signature;
    const outputs = all.filter(ref => ref.relation === 'output'), references = all.filter(ref => ref.relation !== 'output');
    view.outputHeading.textContent = '最近产出';
    view.outputs.hidden = !outputs.length && auto?.status === 'ready';
    view.referenceHeading.textContent = `参考资料${references.length ? ` · ${references.length}` : ''}`;
    view.referenceStatus.textContent = auto?.status === 'unavailable' ? '自动收录暂时无法读取，可稍后重新读取。'
      : auto?.status === 'partial' ? '仅显示近期可读取记录中的文件与任务。' : references.length ? '' : '尚无参考资料。';
    view.restoreReferences.hidden = !view.data.excludedReferencePaths?.length;
    const count = Math.max(3, Math.min(2000, Number(view.preferences.outputCount) || 3));
    view.outputList.replaceChildren(...outputs.slice(0, count).map(ref => referenceItem(view, ref)));
    if (!outputs.length) view.outputList.append(node('li', '尚未发现本任务产出。'));
    view.list.replaceChildren(...references.map(ref => referenceItem(view, ref)));
    view.moreOutputs.hidden = outputs.length <= count; view.moreOutputs.textContent = `查看更多（${outputs.length} 项）`;
    view.lessOutputs.hidden = count <= 3 || outputs.length <= 3;
    if (auto?.status === 'unavailable' || auto?.status === 'partial') view.outputList.append(node('li', view.referenceStatus.textContent));
  }
  function referenceItem(view, ref) {
    const item = node('li'); item.className = 'nuyoah-reference-item'; item.title = ref.path;
    const content = node('button'); content.type = 'button'; content.className = 'nuyoah-reference-content';
    content.append(node('span', `${ref.label}${ref.exists ? '' : '（文件失效）'}`));
    if (ref.evidence === 'delivery') content.append(node('small', '对话交付'));
    if (ref.modifiedAt) content.append(node('small', new Date(ref.modifiedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })));
    content.disabled = !ref.exists; content.setAttribute('aria-label', `预览 ${ref.label}`);
    content.onclick = () => requestPreview(view, ref, content);
    const more = node('div'); more.className = 'nuyoah-reference-more'; more.hidden = true;
    const toggle = node('button', '⋯'); toggle.type = 'button'; toggle.className = 'nuyoah-reference-toggle'; toggle.setAttribute('aria-label', `${ref.label} 的更多操作`); toggle.setAttribute('aria-expanded', 'false');
    toggle.onclick = () => { more.hidden = !more.hidden; toggle.setAttribute('aria-expanded', String(!more.hidden)); };
    const path = node('p', ref.path); path.className = 'nuyoah-reference-path'; more.append(path);
    const use = node('button', ref.relation === 'history' ? '插入检索请求' : '插入到任务'); use.type = 'button'; use.disabled = !ref.exists;
    use.onclick = () => { const ok = view.insert(ref.relation === 'history'
      ? `请按当前问题按需检索历史引用 ${JSON.stringify(ref.path)}，只读取相关部分，不修改档案。`
      : `参考文件：${JSON.stringify(ref.path)}`); view.status.textContent = ok ? '已插入输入框，由你发送。' : '当前输入区不可用。'; };
    const remove = node('button', ref.automatic ? '隐藏' : '移除引用'); remove.type = 'button';
    remove.onclick = () => request(view, 'save', ref.automatic
      ? { section: 'excludedReferencePaths', revision: view.data.revision, value: [...(view.data.excludedReferencePaths || []), ref.path] }
      : { section: 'references', revision: view.data.revision, value: view.data.references.filter(r => r.path !== ref.path).map(({ exists, ...r }) => r) });
    more.append(use, remove); item.append(content, toggle, more); return item;
  }
  function mount(parent, threadId, insert, hostId = 'local', catalog = [], openTask) {
    if (hostId !== 'local' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(threadId || '')) {
      active?.previewDialog?.close(); active?.root.remove(); active = null; return;
    }
    let view = views.get(threadId);
    if (!view) { view = build(threadId, insert); views.set(threadId, view); }
    view.catalog = catalog; view.openTask = openTask; renderRelated(view);
    if (active !== view) { active?.previewDialog?.close(); active?.root.remove(); active = view; }
    if (view.root.parentElement !== parent) { const metrics = parent.querySelector('.nuyoah-project-task-directory, .nuyoah-project-section-title, .nuyoah-project-metrics'); if (metrics) metrics.before(view.root); else parent.prepend(view.root); }
    if (!view.pending && !view.dirty.size && Date.now() - view.lastRead > 10000) request(view, 'read');
  }
  const style = node('style'); style.id = 'nuyoah-task-context-style';
  style.textContent = `
.nuyoah-task-context{position:relative;min-width:0;font:inherit;color:var(--nuyoah-text,var(--color-token-foreground,CanvasText));margin:0 0 24px;--context-surface:var(--nuyoah-surface,var(--color-token-bg-primary,Canvas));--context-muted:var(--nuyoah-muted,var(--color-token-text-secondary,GrayText));--context-line:var(--nuyoah-border,color-mix(in srgb,currentColor 12%,transparent));--context-soft:var(--nuyoah-subtle,color-mix(in srgb,currentColor 4%,var(--context-surface)));--context-accent:var(--nuyoah-accent,var(--text-link,#0868cd))}
.nuyoah-task-context [hidden]{display:none!important}.nuyoah-task-context *{box-sizing:border-box}.nuyoah-task-context button,.nuyoah-task-context input,.nuyoah-task-context select,.nuyoah-task-context textarea{font:inherit;color:inherit}.nuyoah-task-context button{border:0;border-radius:8px;background:transparent;padding:7px 10px;cursor:pointer;font-size:.85em;transition:background 180ms ease}.nuyoah-task-context button:hover{background:var(--context-soft)}.nuyoah-task-context button:disabled{opacity:.45;cursor:default}.nuyoah-task-context :is(button,input,select,textarea,summary):focus-visible{outline:2px solid var(--context-accent);outline-offset:3px}
.nuyoah-task-context label{display:block;margin:12px 0;font-size:.82em;color:var(--context-muted)}.nuyoah-task-context input,.nuyoah-task-context textarea,.nuyoah-task-context select{display:block;width:100%;min-width:0;max-width:100%;margin:7px 0;padding:10px 12px;border:1px solid var(--context-line);border-radius:10px;background:var(--context-soft);color:var(--nuyoah-text,var(--color-token-foreground,CanvasText))}.nuyoah-task-context textarea{resize:vertical;max-height:360px;line-height:1.65}.nuyoah-task-context [role=status]{font-size:.8em;line-height:1.6;margin:10px 0;color:var(--context-muted)}.nuyoah-task-context [role=status]:empty{display:none}.nuyoah-context-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.nuyoah-context-actions strong{margin-right:auto}.nuyoah-task-context .nuyoah-context-heading{position:absolute;top:0;right:0;z-index:3}
.nuyoah-task-context details{margin:0}.nuyoah-task-context summary{cursor:pointer;list-style:none;font-size:.85em;font-weight:500;line-height:1.6;padding:15px 0;display:flex;align-items:center;gap:9px}.nuyoah-task-context summary::-webkit-details-marker{display:none}.nuyoah-task-context summary::after{content:'›';margin-left:auto;color:var(--context-muted);transition:transform 180ms ease}.nuyoah-task-context details[open]>summary::after{transform:rotate(90deg)}.nuyoah-task-context>details{border-bottom:1px solid var(--context-line)}.nuyoah-task-context details>:not(summary){margin-left:14px;margin-right:4px}.nuyoah-task-context details>details{margin-left:12px}.nuyoah-task-context details>button{margin-bottom:12px}.nuyoah-task-context .nuyoah-context-menu{position:relative;border:0}.nuyoah-context-menu>summary{width:32px;height:32px;padding:0;display:grid;place-items:center;border-radius:8px;font-size:22px}.nuyoah-context-menu>summary::after{display:none}.nuyoah-context-menu>summary:hover{background:var(--context-soft)}.nuyoah-context-menu:not([open])>.nuyoah-context-menu-actions{display:none}.nuyoah-task-context .nuyoah-context-menu-actions{position:absolute;top:36px;right:0;width:160px;padding:6px;margin:0;display:flex;flex-direction:column;background:var(--context-surface);border:1px solid var(--context-line);border-radius:12px;box-shadow:0 8px 28px #0002;z-index:12}.nuyoah-context-menu-actions button{text-align:left;width:100%;margin:0}
.nuyoah-summary{padding:0 42px 0 0;margin:0 0 30px}.nuyoah-summary>div>p{font-size:.85em;color:var(--context-muted);margin:4px 0}.nuyoah-summary-row{margin:14px 0}.nuyoah-summary-row strong{font-size:.75em;font-weight:400;color:var(--context-muted)}.nuyoah-summary-row p{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0;font-size:.92em;line-height:1.75}.nuyoah-summary-row[data-summary-field=goal]>strong{display:none}.nuyoah-summary-row[data-summary-field=goal] p{color:var(--context-muted)}.nuyoah-summary-row[data-summary-field=nextStep]{background:var(--context-soft);border-radius:13px;padding:14px 18px;margin:22px -42px 0 0}.nuyoah-summary-row[data-summary-field=nextStep]>strong::before{content:'→';color:var(--context-accent);margin-right:9px}.nuyoah-summary-row[data-summary-field=nextStep] p{margin:5px 0 0}.nuyoah-context-records .nuyoah-summary-row p{font-size:.85em}.nuyoah-output-heading{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px}.nuyoah-output-heading>strong{font-size:.87em;font-weight:600;margin-right:auto}.nuyoah-output-heading button{font-size:.75em;color:var(--context-accent);padding:5px 0}.nuyoah-task-outputs{margin:0 0 26px}.nuyoah-task-context ul{list-style:none;padding:0;margin:6px 0}.nuyoah-task-context li{overflow-wrap:anywhere}.nuyoah-task-context .nuyoah-reference-item{display:grid;grid-template-columns:minmax(0,1fr) 30px;align-items:center;gap:6px;margin:0;padding:5px 0;border-bottom:1px solid var(--context-line)}.nuyoah-task-context .nuyoah-reference-content{display:grid;grid-template-columns:32px minmax(0,1fr);gap:2px 12px;min-width:0;text-align:left;padding:10px 0;background:transparent;border:0}.nuyoah-reference-content::before{content:'▤';grid-row:1/span 3;display:grid;place-items:center;align-self:center;width:30px;height:36px;font-size:19px;color:var(--context-muted);background:var(--context-soft);border:1px solid var(--context-line);border-radius:6px}.nuyoah-reference-content>span{overflow-wrap:anywhere;line-height:1.5}.nuyoah-reference-content small{grid-column:2;font-size:.8em;color:var(--context-muted);line-height:1.5}.nuyoah-task-context .nuyoah-reference-toggle{padding:5px 0;width:30px;font-size:18px;color:var(--context-muted)}.nuyoah-task-context .nuyoah-reference-more{grid-column:1/-1;margin:0;padding:5px 12px 12px;background:var(--context-soft);border-radius:10px;font-size:.85em}.nuyoah-reference-path{font-size:.8em;overflow-wrap:anywhere}.nuyoah-token-badge{font-size:.8em!important;white-space:normal;text-align:left;overflow-wrap:anywhere}.nuyoah-token-details{font-size:.8em;color:var(--context-muted);line-height:1.6}.nuyoah-cold-badge{font-weight:400;font-size:.85em;color:var(--context-muted);margin-left:auto}.nuyoah-task-context .nuyoah-cold-switch{display:flex;align-items:center;gap:8px;margin-right:auto}.nuyoah-task-context .nuyoah-cold-switch input{width:auto;margin:0}.nuyoah-cold-history p{font-size:.82em;line-height:1.7}.nuyoah-task-context.nuyoah-skill-history{margin:0}.nuyoah-skill-history li{padding:10px 0;border-bottom:1px solid var(--context-line)}.nuyoah-skill-history li strong{font-size:.85em;font-weight:500}.nuyoah-skill-history li small{display:block;font-size:.72em;margin-top:5px;color:var(--context-muted)}
.nuyoah-file-preview{box-sizing:border-box;width:min(800px,90vw);max-height:85vh;overflow:auto;border:1px solid color-mix(in srgb,currentColor 12%,transparent);border-radius:18px;background:var(--color-token-bg-primary,Canvas);color:var(--color-token-foreground,CanvasText);padding:22px;box-shadow:0 20px 65px #0003}.nuyoah-file-preview::backdrop{background:#0005}.nuyoah-file-preview img{max-width:100%;max-height:65vh;object-fit:contain;display:block;margin:12px auto}.nuyoah-file-preview pre{font:13px/1.7 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.nuyoah-file-preview .nuyoah-context-actions{position:sticky;top:-22px;background:inherit;padding:8px 0}.nuyoah-file-preview .nuyoah-context-actions strong{overflow-wrap:anywhere;min-width:0}
@media(prefers-reduced-motion:reduce){.nuyoah-task-context *,.nuyoah-task-context *::before,.nuyoah-task-context *::after{transition:none!important}}
`;
  document.head.append(style);
  const poll = setInterval(() => {
    if (active?.root.isConnected && active.root.getClientRects().length && !active.pending && (active.data?.coldHistory?.busy
      || Date.now() - active.lastRead > 10000)) request(active, 'read');
  }, 1500);
  function dismiss() {
    if (!active?.root.getClientRects().length) return false;
    if (active.menu.open) { active.menu.open = false; active.menu.querySelector('summary').focus(); return true; }
    if (!active.editor.hidden) { active.editor.hidden = true; active.menu.querySelector('summary').focus(); return true; }
    const more = [...active.root.querySelectorAll('.nuyoah-reference-more')].find(element => !element.hidden);
    if (more) { more.hidden = true; const toggle = more.parentElement.querySelector('.nuyoah-reference-toggle'); toggle?.setAttribute('aria-expanded', 'false'); toggle?.focus(); return true; }
    return false;
  }
  window.__nuyoahTaskContextUI__ = { mount, mountHistory, receive, dismiss, takeRequest: () => queue.shift() || null,
    destroy() { clearTimeout(history?.timer); history?.root.remove(); clearInterval(poll); window.removeEventListener('keydown', closePreviewOnEscape, true); views.forEach(view => { clearTimeout(view.timer); clearTimeout(view.previewTimer); view.previewDialog?.close(); view.root.remove(); }); style.remove(); } };
})();
