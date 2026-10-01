import net from "node:net";

function canListen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function resolveLoopbackPort(preferredPort, { attempts = 20 } = {}) {
  const start = Number(preferredPort);
  if (!Number.isInteger(start) || start < 1 || start > 65535) throw new Error("Invalid preferred port");
  for (let offset = 0; offset < attempts && start + offset <= 65535; offset += 1) {
    const candidate = start + offset;
    if (await canListen(candidate)) return candidate;
  }
  throw new Error(`No free loopback port from ${start} through ${Math.min(65535, start + attempts - 1)}`);
}
