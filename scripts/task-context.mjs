#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { TaskContextStore } from '../nuyoah/workstation/task-context-store.mjs';
const [action, id = process.env.CODEX_THREAD_ID, section, inputFile, revision] = process.argv.slice(2);
const store = new TaskContextStore();
try {
  let data;
  if (action === 'read') data = await store.read(id);
  else if (action === 'update' && inputFile && revision !== undefined) {
    const value = JSON.parse(await readFile(inputFile, 'utf8'));
    data = await store.update(id, { section, value, revision: Number(revision) });
  } else throw new Error('用法：task-context.mjs read <任务ID>；update <任务ID> <summary|notes|references> <JSON文件> <已读取版本>');
  console.log(JSON.stringify(data, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
