import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import { resolveLoopbackPort } from "../lib/runtime-port.mjs";

test("runtime moves to the next loopback port when the preferred Taskboard port is occupied", async () => {
  const occupied = net.createServer();
  await new Promise((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const preferred = occupied.address().port;
  try {
    const resolved = await resolveLoopbackPort(preferred, { attempts: 20 });
    assert.ok(resolved > preferred);
    assert.ok(resolved < preferred + 20);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});
