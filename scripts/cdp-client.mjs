export async function readTargets(port = 9231) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`);
  return response.json();
}

export function selectMainCodexTarget(targets) {
  return targets.find((target) =>
    target.type === "page"
      && target.url === "app://-/index.html"
      && target.webSocketDebuggerUrl,
  );
}

export class CdpClient {
  constructor(url, { connectTimeoutMs = 3_000, requestTimeoutMs = 5_000 } = {}) {
    this.url = url;
    this.connectTimeoutMs = connectTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async connect() {
    if (typeof globalThis.WebSocket !== "function") {
      throw new Error("This installer requires Node.js 22 or newer with native WebSocket support");
    }
    const socket = new globalThis.WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message.id) {
        if (!message.method) return;
        for (const listener of this.listeners.get(message.method) || []) {
          try { listener(message.params || {}, { sessionId: message.sessionId || null }); } catch {}
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });

    let connectSettled = false;
    let rejectConnect = null;
    socket.addEventListener("close", () => {
      const error = new Error("CDP connection closed");
      if (!connectSettled) {
        connectSettled = true;
        rejectConnect?.(error);
      }
      this.rejectPending(error);
    });
    socket.addEventListener("error", (cause) => {
      const detail = cause?.error?.message || cause?.message || "WebSocket error";
      const error = new Error(`CDP connection error: ${detail}`);
      if (!connectSettled) {
        connectSettled = true;
        rejectConnect?.(error);
      } else {
        this.rejectPending(new Error("CDP connection closed"));
      }
    });

    await new Promise((resolve, reject) => {
      rejectConnect = reject;
      const timer = setTimeout(() => {
        if (connectSettled) return;
        connectSettled = true;
        reject(new Error(`CDP connection timed out after ${this.connectTimeoutMs}ms`));
        try { socket.close(); } catch {}
      }, this.connectTimeoutMs);

      socket.addEventListener("open", () => {
        if (connectSettled) return;
        connectSettled = true;
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("close", () => clearTimeout(timer), { once: true });
      socket.addEventListener("error", () => clearTimeout(timer), { once: true });
    });
  }

  send(method, params = {}, sessionId = null) {
    if (!this.socket || this.socket.readyState !== 1) {
      return Promise.reject(new Error("CDP connection is not open"));
    }

    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`CDP ${method} timed out after ${this.requestTimeoutMs}ms`));
        try { this.socket?.close(); } catch {}
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        const message = { id, method, params };
        if (sessionId) message.sessionId = sessionId;
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(new Error(`CDP send failed: ${error.message}`));
      }
    });
  }

  async evaluate(expression, { awaitPromise = true } = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || "Evaluation failed");
    }
    return result.result?.value;
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(method);
    };
  }

  close() {
    this.rejectPending(new Error("CDP connection closed"));
    this.listeners.clear();
    this.socket?.close();
  }
}

export async function connectMainCodex(port = 9231) {
  const targets = await readTargets(port);
  const target = selectMainCodexTarget(targets);
  if (!target) throw new Error("Main Codex renderer target not found");
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return client;
}
