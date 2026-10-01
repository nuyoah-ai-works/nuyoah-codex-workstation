import assert from "node:assert/strict";
import { createServer as createTcpServer } from "node:net";
import test from "node:test";

import { WebSocketServer } from "ws";

import { CdpClient } from "../scripts/cdp-client.mjs";

test("client uses the Node runtime WebSocket so installed users need no private module path", async () => {
  const NativeWebSocket = globalThis.WebSocket;
  let openedUrl = null;
  class TestWebSocket extends EventTarget {
    static OPEN = 1;
    readyState = 0;

    constructor(url) {
      super();
      openedUrl = url;
      queueMicrotask(() => {
        this.readyState = TestWebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
      });
    }

    send() {}

    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event("close"));
    }
  }

  globalThis.WebSocket = TestWebSocket;
  const client = new CdpClient("ws://127.0.0.1:65534");
  try {
    await client.connect();
    assert.equal(openedUrl, "ws://127.0.0.1:65534");
  } finally {
    client.close();
    globalThis.WebSocket = NativeWebSocket;
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function rejectAfter(milliseconds, label) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} remained pending`)), milliseconds).unref();
  });
}

test("connect rejects when the WebSocket handshake stalls", async () => {
  const sockets = new Set();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const port = await listen(server);
  const client = new CdpClient(`ws://127.0.0.1:${port}`, { connectTimeoutMs: 40 });

  try {
    await assert.rejects(
      Promise.race([client.connect(), rejectAfter(250, "CDP connection")]),
      /CDP connection timed out after 40ms/,
    );
  } finally {
    client.close();
    for (const socket of sockets) socket.destroy();
    await closeServer(server);
  }
});

test("an unanswered CDP request rejects instead of keeping the injector suspended", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  server.on("connection", (socket) => socket.on("message", () => {}));
  const port = server.address().port;
  const client = new CdpClient(`ws://127.0.0.1:${port}`, { requestTimeoutMs: 40 });

  try {
    await client.connect();
    await assert.rejects(
      Promise.race([client.evaluate("1 + 1"), rejectAfter(250, "CDP request")]),
      /CDP Runtime\.evaluate timed out after 40ms/,
    );
  } finally {
    client.close();
    for (const socket of server.clients) socket.terminate();
    await closeServer(server);
  }
});

test("a renderer disconnect rejects every in-flight request", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  server.on("connection", (socket) => {
    socket.once("message", () => socket.terminate());
  });
  const port = server.address().port;
  const client = new CdpClient(`ws://127.0.0.1:${port}`, { requestTimeoutMs: 500 });

  try {
    await client.connect();
    await assert.rejects(client.evaluate("1 + 1"), /CDP connection closed/);
  } finally {
    client.close();
    for (const socket of server.clients) socket.terminate();
    await closeServer(server);
  }
});

test("client delivers and can unsubscribe from CDP events", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  server.on("connection", (socket) => {
    socket.send(JSON.stringify({
      method: "Runtime.bindingCalled",
      params: { name: "testBinding", payload: "first" },
    }));
  });
  const port = server.address().port;
  const client = new CdpClient(`ws://127.0.0.1:${port}`);

  try {
    const payloads = [];
    const unsubscribe = client.on("Runtime.bindingCalled", (params) => payloads.push(params.payload));
    await client.connect();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(payloads, ["first"]);
    unsubscribe();
    assert.equal(client.listeners.has("Runtime.bindingCalled"), false);
  } finally {
    client.close();
    for (const socket of server.clients) socket.terminate();
    await closeServer(server);
  }
});

test("client preserves flattened CDP session ids for commands and events", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  let received = null;
  server.on("connection", (socket) => {
    socket.on("message", (payload) => {
      received = JSON.parse(String(payload));
      socket.send(JSON.stringify({ id: received.id, sessionId: received.sessionId, result: {} }));
      socket.send(JSON.stringify({
        method: "Fetch.requestPaused",
        sessionId: "asset-frame-session",
        params: { requestId: "request-1" },
      }));
    });
  });
  const port = server.address().port;
  const client = new CdpClient(`ws://127.0.0.1:${port}`);

  try {
    let eventMeta = null;
    client.on("Fetch.requestPaused", (_params, meta) => { eventMeta = meta; });
    await client.connect();
    await client.send("Fetch.enable", {}, "asset-frame-session");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(received.sessionId, "asset-frame-session");
    assert.equal(eventMeta.sessionId, "asset-frame-session");
  } finally {
    client.close();
    for (const socket of server.clients) socket.terminate();
    await closeServer(server);
  }
});
