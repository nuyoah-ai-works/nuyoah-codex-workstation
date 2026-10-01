import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  parseCodexThreadListPage,
  readUnarchivedCodexThreads,
} from "../lib/codex-thread-catalog.mjs";

const ids = [
  "00000000-0000-4000-8000-3355e6f79a0d",
  "00000000-0000-4000-8000-146693936106",
];

test("Codex thread pages retain identity, title, activity, and execution folder", () => {
  assert.deepEqual(parseCodexThreadListPage({
    result: {
      data: [{
        id: ids[0],
        name: "  修复任务面板\n扫描  ",
        updatedAt: 1788418669,
        cwd: "/Users/test/Documents/workstation",
      }],
      nextCursor: "page-2",
    },
  }), {
    nextCursor: "page-2",
    threads: [{
      threadId: ids[0],
      title: "修复任务面板 扫描",
      updatedAt: "2026-09-03T06:57:49.000Z",
      workspacePath: "/Users/test/Documents/workstation",
    }],
  });
});

test("unarchived Codex discovery follows every native pagination cursor", async () => {
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
        if (request.method === "initialize") {
          child.stdout.write(`${JSON.stringify({ id: request.id, result: { codexHome: "/fixture/.codex" } })}\n`);
        }
        if (request.method === "thread/list") {
          const second = request.params.cursor === "page-2";
          child.stdout.write(`${JSON.stringify({
            id: request.id,
            result: {
              data: [{
                id: second ? ids[1] : ids[0],
                name: second ? "第二项" : "第一项",
                updatedAt: second ? 1788418600 : 1788418669,
                cwd: second ? "/work/two" : "/work/one",
              }],
              nextCursor: second ? null : "page-2",
            },
          })}\n`);
        }
        callback?.();
      },
      end: () => {},
    };
    return child;
  };

  const threads = await readUnarchivedCodexThreads({ codexPath: "/fixture/codex", spawnImpl });
  assert.deepEqual(threads.map((thread) => thread.threadId), ids);
  const listRequests = requests.filter((request) => request.method === "thread/list");
  assert.equal(listRequests.length, 2);
  assert.equal(listRequests[0].params.archived, false);
  assert.equal(listRequests[0].params.limit, 100);
  assert.equal(listRequests[1].params.cursor, "page-2");
});
