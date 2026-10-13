// Serialized into the renderer. Only the native recent/pinned metadata projection
// is admitted; this source never fetches a conversation body or image.
export function createChatGptCatalog({ read, onChange = () => {}, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let active = false, disposed = false, epoch = 0, work = null, timer = null;
  let tasks = [], failed = false, hasSnapshot = false, signature = '';
  let failures = 0, nextReadAt = 0;
  const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
  function cancelTimer() { clearTimer(timer); timer = null; }
  function schedule() {
    cancelTimer();
    if (active && !disposed && !work) timer = setTimer(() => { timer = null; void refresh(); },
      Math.min(2147483647, Math.max(failed ? 0 : 2000, nextReadAt - now())));
  }
  function recordFailure(error) {
    const protectedFailure = [401, 403, 429].includes(error?.status)
      || error?.errorCode === 'cloudflare_challenge';
    const delay = protectedFailure ? 300000 : error?.code === 'settings_unavailable' ? 60000
      : Math.min(300000, 15000 * 2 ** Math.min(failures, 5));
    failures++;
    nextReadAt = Math.max(now() + delay, Number.isFinite(error?.retryAtMs) ? error.retryAtMs : 0);
    const changed = !failed;
    failed = true;
    tasks = tasks.map(task => ({ ...task, runtimeStatus: 'unknown', progress: '状态待同步' }));
    signature = '';
    if (changed) onChange();
  }
  function refresh() {
    if (!active || disposed || work) return work;
    if (now() < nextReadAt) { schedule(); return null; }
    cancelTimer();
    const revision = epoch;
    let timedOut = false;
    const deadline = setTimer(() => {
      if (!active || disposed || revision !== epoch) return;
      timedOut = true;
      recordFailure(new Error('unavailable'));
    }, 12000);
    // A display deadline cannot cancel the host query. Keep the single-flight
    // lock until that query settles, even across panel close/reopen.
    work = Promise.resolve().then(read).then(rows => {
      if (timedOut || !active || disposed || revision !== epoch) return;
      if (!Array.isArray(rows)) throw new Error('unavailable');
      const previous = new Map(tasks.map(task => [task.threadId, task]));
      const next = new Map();
      for (const row of rows.slice(0, 200)) {
        if (!uuid(row?.id)) continue;
        const id = row.id.toLowerCase(), prior = previous.get(id);
        const runtimeStatus = row.status === 'active' ? 'running' : row.status === 'systemError' ? 'failed' : row.status === 'idle' ? 'completed' : 'unknown';
        const date = row.updatedAt == null ? new Date(NaN) : typeof row.updatedAt === 'number' ? new Date(row.updatedAt * 1000) : new Date(row.updatedAt);
        const updatedAt = Number.isFinite(date.getTime()) ? date.toISOString() : '';
        const transition = prior && (prior.runtimeStatus === 'running' || runtimeStatus === 'running') && prior.runtimeStatus !== runtimeStatus;
        next.set(id, { threadId: id, taskKey: `chatgpt:${id}`, hostId: 'chatgpt', source: 'chatgpt',
          title: String(row.title || '未命名聊天').replace(/\s+/g, ' ').trim().slice(0, 160),
          projectId: '__chatgpt__', projectName: 'ChatGPT 聊天', runtimeStatus, updatedAt,
          activityAt: transition ? new Date(now()).toISOString() : prior?.activityAt && prior.updatedAt === updatedAt ? prior.activityAt : updatedAt,
          pinned: row.pinned === true, hasFinalResponse: false,
          progress: runtimeStatus === 'running' ? '正在生成回复…' : runtimeStatus === 'failed' ? '生成遇到问题，打开聊天查看' : runtimeStatus === 'unknown' ? '状态待同步' : '打开聊天查看结果',
        });
      }
      tasks = [...next.values()]; failed = false; hasSnapshot = true; failures = 0; nextReadAt = 0;
      const key = JSON.stringify(tasks);
      if (key !== signature) { signature = key; onChange(); }
    }).catch(error => {
      if (!active || disposed || revision !== epoch) return;
      recordFailure(error);
    }).finally(() => {
      clearTimer(deadline); work = null;
      schedule();
    });
    return work;
  }
  return {
    refresh,
    snapshot: () => tasks.map(task => ({ ...task })),
    syncState: () => failed ? [{ hostId: 'chatgpt', hostName: 'ChatGPT', loading: false, phase: 'retrying', hasSnapshot }] : [],
    setActive(value) { if (disposed || active === !!value) return; active = !!value; epoch++; cancelTimer(); if (active) void refresh(); },
    dispose() { disposed = true; active = false; epoch++; cancelTimer(); tasks = []; },
  };
}
