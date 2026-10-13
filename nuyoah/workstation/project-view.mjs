// Serialized into the host renderer; only presentation preferences are persisted.
export function createProjectView({ storage, states }) {
  const key = 'nuyoah.project-position.v1';
  const statuses = ['all', 'attention', 'running', 'failed', 'completed', 'history'];
  const labels = { running: '执行中', failed: '失败', completed: '已确认完成', history: '已查看历史' };
  const identity = task => `${task.hostId || 'local'}/${task.threadId}`;
  const scope = (hostId, projectId) => JSON.stringify([hostId || 'local', projectId || '__unassigned__']);
  function normalize(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    return { query: typeof value.query === 'string' ? value.query.slice(0, 500) : '',
      filter: statuses.includes(value.filter) ? value.filter : 'all',
      count: Number.isFinite(value.count) ? Math.max(12, Math.min(5000, Math.floor(value.count))) : 12,
      scrollTop: Number.isFinite(value.scrollTop) ? Math.max(0, value.scrollTop) : 0 };
  }
  function read(id) { try { return normalize(JSON.parse(storage.getItem(key) || '{}')[id]); } catch { return normalize(); } }
  function save(id, value) {
    try {
      const saved = JSON.parse(storage.getItem(key) || '{}');
      const next = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
      delete next[id]; next[id] = normalize(value);
      storage.setItem(key, JSON.stringify(Object.fromEntries(Object.entries(next).slice(-100))));
    } catch {}
  }
  function present(tasks) {
    let meta = {}, hasStore = false, cutoff, hours = 48;
    try {
      const preference = JSON.parse(storage.getItem('taskboard.codex-live-position.v1') || '{}').projectAutoCompleteHours;
      if ([0, 24, 48, 72, 168].includes(preference)) hours = preference;
      const raw = storage.getItem('taskboard.codex-live-meta.v2'); hasStore = raw !== null;
      const value = JSON.parse(raw || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) meta = value;
      cutoff = Number(storage.getItem('taskboard.remote-history-cutoff.v1'));
    } catch {}
    if (!hasStore) for (const task of tasks) meta[task.taskKey || task.threadId] = { seenAt: task.updatedAt, initialHistory: true };
    if (!Number.isFinite(cutoff) || cutoff <= 0) { const today = new Date(); today.setHours(0, 0, 0, 0); cutoff = today.getTime(); }
    meta = states.bootstrapRemoteHistory(tasks, meta, cutoff);
    return tasks.map(task => {
      const saved = meta[task.taskKey || task.threadId] || {};
      const now = Date.now();
      const kind = states.completionKind(saved, task, now, hours);
      let status = states.liveTaskStatus(task, saved, now, hours);
      if (status === 'completed' && kind === 'history') status = 'history';
      if (task.catalogHistory && !task.waitingReason && task.runtimeStatus !== 'running') status = 'history';
      return { ...task, identity: identity(task), displayStatus: status,
        statusLabel: task.catalogHistory && status === 'history' ? task.archived ? '已归档' : '历史记录'
          : status === 'attention' ? states.taskAttentionLabel(task, saved) : status === 'completed' && kind === 'automatic' ? '已完成' : labels[status] };
    }).sort((a, b) => Number(a.catalogHistory === true) - Number(b.catalogHistory === true)
      || (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  }
  function select(tasks, value) {
    const state = normalize(value), query = state.query.trim().toLocaleLowerCase();
    const filtered = tasks.filter(task => (state.filter === 'all' || state.filter === task.displayStatus)
      && (!query || `${task.title || ''} ${task.progress || ''}`.toLocaleLowerCase().includes(query)));
    return { filtered, visible: filtered.slice(0, state.count), remaining: Math.max(0, filtered.length - state.count) };
  }
  return { scope, identity, read, save, present, select, normalize };
}
