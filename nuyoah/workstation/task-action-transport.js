(() => {
  // Keep in-flight promises/receipts across reinjection; no command is replayed.
  if (window.__nuyoahTaskActionTransport__) return;
  const queue = [], requests = new Map(), native = new Map();
  const submit = (kind, value) => new Promise(resolve => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      if (!requests.delete(id)) return;
      resolve(kind === 'inspect' ? { available: false, target: value, message: '任务信息读取未完成，请重新选择。' }
        : { status: 'unknown', message: '尚未确认执行结果，请打开对话核对；请勿重复发送。' });
    }, 75000);
    requests.set(id, { resolve, timer }); queue.push({ id, kind, value });
  });
  window.__nuyoahTaskActions__ = { inspect: target => submit('inspect', target), execute: request => submit('execute', request) };
  window.__nuyoahTaskActionTransport__ = {
    takeRequest() { while (queue.length) { const request = queue.shift(); if (requests.has(request.id)) return request; } return null; },
    receive(response) {
      const pending = requests.get(response?.id); if (!pending) return;
      clearTimeout(pending.timer); requests.delete(response.id); pending.resolve(response.result);
    },
    startNative({ id, method, args }) {
      if (!['inspect', 'send', 'create'].includes(method) || !Array.isArray(args) || native.has(id) || native.size >= 128 || !window.__nuyoahNativeTaskAdapter__) return false;
      native.set(id, null);
      setTimeout(() => native.delete(id), 120000);
      Promise.resolve().then(() => window.__nuyoahNativeTaskAdapter__[method](...args)).then(
        result => { if (native.has(id)) native.set(id, { result }); }, error => { if (native.has(id)) native.set(id, { error: true, definite: error?.definite === true, ...(error?.child ? { child: { hostId: error.child.hostId, threadId: error.child.threadId } } : {}) }); });
      return true;
    },
    takeNative(id) { const response = native.get(id); if (response) native.delete(id); return response || null; },
  };
})();
