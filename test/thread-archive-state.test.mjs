import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  parseArchivedThreadListResponse,
  readArchivedThreadIds,
} from "../lib/thread-archive-state.mjs";

const archivedIds = [
  "00000000-0000-4000-8000-0ac18c6ec86a",
  "00000000-0000-4000-8000-e1d0cf1fe321",
];

test("archived thread/list responses are reduced to stable thread ids", () => {
  assert.deepEqual(parseArchivedThreadListResponse({
    id: 2,
    result: { data: archivedIds.map((id) => ({ id })) },
  }), archivedIds);
  assert.throws(() => parseArchivedThreadListResponse({
    id: 2,
    result: { data: [{ id: "not-a-thread" }] },
  }), /Invalid archived thread id/);
});

test("archive discovery uses the read-only app-server list filter", async () => {
  const requests = [];
  const spawnImpl = (executable, args, options) => {
    assert.equal(executable, "/fixture/codex");
    assert.deepEqual(args, ["app-server", "--stdio"]);
    assert.deepEqual(options.stdio, ["pipe", "pipe", "pipe"]);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdout.setEncoding("utf8");
    child.kill = () => {};
    child.stdin = {
      write: (source, callback) => {
        const request = JSON.parse(source);
        requests.push(request);
        if (request.id === 1) child.stdout.write(`${JSON.stringify({ id: 1, result: { codexHome: "/fixture/.codex" } })}\n`);
        if (request.id === 2) child.stdout.write(`${JSON.stringify({ id: 2, result: { data: archivedIds.map((id) => ({ id })), nextCursor: null } })}\n`);
        callback?.();
      },
      end: () => {},
    };
    return child;
  };

  assert.deepEqual(await readArchivedThreadIds({ codexPath: "/fixture/codex", spawnImpl }), archivedIds);
  assert.equal(requests[1].method, "initialized");
  assert.deepEqual(requests[2], {
    id: 2,
    method: "thread/list",
    params: {
      archived: true,
      limit: 4096,
      sortKey: "updated_at",
      sortDirection: "desc",
      useStateDbOnly: true,
    },
  });
});
