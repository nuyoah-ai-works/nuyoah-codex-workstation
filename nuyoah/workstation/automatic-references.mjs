import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateColdHistorySource } from './cold-history.mjs';
import { taskId } from './task-context-store.mjs';
import { readNativeHistoryReferences } from './native-history-references.mjs';

function localPath(value, cwd = '') {
  if (typeof value !== 'string') return null;
  let file = value.trim().replace(/^<|>$/g, '').replace(/:\d+(?::\d+)?$/, '');
  try { file = file.startsWith('file:') ? fileURLToPath(file) : decodeURIComponent(file); } catch { return null; }
  if (!file || /[\0\r\n]/.test(file) || /^[a-z]+:\/\//i.test(file)) return null;
  if (!path.isAbsolute(file)) { if (!cwd) return null; file = path.resolve(cwd, file); }
  file = path.normalize(file);
  if (file.length > 4096 || /(?:^|\/)(?:\.git|node_modules|\.runtime)(?:\/|$)/.test(file)
    || /(?:^|\/)(?:\.env(?:\..*)?|credentials[^/]*|auth\.json|[^/]*\.pem|[^/]*\.key)$/.test(file)) return null;
  return file;
}
function textOf(value) {
  if (Array.isArray(value)) return value.map(x => textOf(x.text ?? '')).join('\n');
  return typeof value === 'string' ? value : '';
}
function patchPaths(p, cwd) {
  let patch;
  if (/(?:^|__)apply_patch$/.test(p.name || '')) patch = p.input ?? p.arguments;
  else if (p.name === 'exec' || p.name === 'functions.exec') {
    // Admit only a literal, awaited tool invocation, not quoted examples or shell text.
    const matches = [...(p.input || '').matchAll(/(?:^|\n)text\(await tools\.apply_patch\(("(?:[^"\\]|\\.)*")\)\);/g)];
    if (matches.length !== 1) return [];
    try { patch = JSON.parse(matches[0][1]); } catch { return []; }
  }
  if (typeof patch !== 'string' || !patch.startsWith('*** Begin Patch')) return [];
  return [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm)]
    .map(m => localPath(m[1], cwd)).filter(Boolean);
}
function successfulPatch(output) {
  const text = textOf(output);
  return !/"isError"\s*:\s*true|Error:|Failed to|patch rejected/i.test(text)
    && (/Success\. Updated the following files:/.test(text) || /(?:^|\n)\{\}\s*(?:\n|$)/.test(text));
}

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
// Unwrap protocol envelopes only; never search arbitrary output text for task IDs.
function returnedTasks(value, depth = 0) {
  if (depth > 8 || value == null) return [];
  if (typeof value === 'string') {
    try { return returnedTasks(JSON.parse(value), depth + 1); } catch { return []; }
  }
  if (Array.isArray(value)) return value.flatMap(item => returnedTasks(item, depth + 1));
  if (value.isError === true || value.error) return [];
  if (uuid.test(value.threadId || '') && (!value.hostId || value.hostId === 'local')) return [value.threadId];
  return returnedTasks(value.content ?? value.text ?? null, depth + 1);
}
function taskToolCall(p) {
  const names = '(?:create_thread|fork_thread|send_message_to_thread|read_thread)';
  if (new RegExp(`(?:^|__)${names}$`).test(p.name || '')) return true;
  // The host exec wrapper may pass variables; admit only awaited tool calls,
  // not commands, documentation, or quoted output containing a tool name.
  return ['exec', 'functions.exec'].includes(p.name) && new RegExp(
    `(?:^|\\n)\\s*(?:(?:const|let)\\s+\\w+\\s*=\\s*|text\\(\\s*)?await tools\\.mcp__codex_app__${names}\\(`
  ).test(p.input || '');
}

export class AutomaticReferences {
  constructor({ source = locateColdHistorySource, history = readNativeHistoryReferences, maxBytes = 64 * 1024 * 1024 } = {}) {
    this.source = source; this.history = history; this.maxBytes = maxBytes; this.cache = new Map();
  }
  async view(id) {
    try {
      id = taskId(id);
      const file = await this.source(id), info = await stat(file);
      const key = `${file}:${info.ino}:${info.size}:${info.mtimeMs}`;
      let cached = this.cache.get(id);
      if (cached?.key !== key) {
        if (!info.size) return { status: 'unavailable', references: [], relatedThreads: [] };
        const handle = await open(file, 'r');
        let meta;
        try {
          const head = Buffer.alloc(Math.min(info.size, 1024 * 1024));
          const { bytesRead } = await handle.read(head, 0, head.length, 0);
          const end = head.subarray(0, bytesRead).indexOf(10);
          if (end < 0) throw new Error('header');
          meta = JSON.parse(head.subarray(0, end).toString('utf8'));
          if (meta.type !== 'session_meta' || meta.payload?.id !== id) throw new Error('identity');
        } finally { await handle.close(); }
        const start = Math.max(0, info.size - this.maxBytes);
        const found = new Map(), pending = new Map(), taskCalls = new Set(), related = new Set();
        let first = true, cwd = start ? '' : meta.payload.cwd || '', partial = start > 0;
        const add = (file, relation, label, evidence) => {
          if (!file || (found.get(file)?.relation === 'output' && relation !== 'output')) return;
          if (found.get(file)?.evidence === 'write') evidence = 'write';
          found.set(file, { relation, path: file, label: label?.trim().slice(0, 240) || path.basename(file),
            evidence, sourceThreadId: relation === 'output' ? id : '', automatic: true });
        };
        const message = (role, content, phase) => {
          const delivery = role === 'assistant' && ['final_answer', 'final'].includes(phase);
          for (const match of content.matchAll(/!?\[([^\]\n]*)\]\((<[^>\n]+>|\/[^)\n]+)\)/g)) {
            add(localPath(match[2]), delivery ? 'output' : 'reference', match[1], delivery ? 'delivery' : 'link');
          }
          if (role === 'assistant') for (const match of content.matchAll(/(?:codex:\/\/threads\/|::created-thread\{threadId=")([a-f\d-]{36})/gi)) {
            if (uuid.test(match[1]) && match[1] !== id) related.add(match[1]);
          }
          if (role === 'user') for (const match of content.matchAll(/<image\b[^>]*\bpath="([^"]+)"/g)) add(localPath(match[1]), 'reference');
        };
        const nativeItem = item => {
          if (!item) return;
          if ((item.type === 'Extension' && item.kind === 'image_gen.generation' || item.type === 'imageGeneration')
            && item.status === 'completed' && !item.failure) {
            add(localPath(item.savedPath), 'output', '', 'generated');
          } else if (['FileChange', 'fileChange'].includes(item.type) && item.status === 'completed') {
            const changes = Array.isArray(item.changes) ? item.changes
              : Object.entries(item.changes || {}).map(([file, change]) => ({ path: file, kind: change.type, movePath: change.move_path }));
            for (const change of changes) if (['add', 'update'].includes(change.kind?.type || change.kind)) {
              add(localPath(change.movePath || change.kind?.move_path || change.path, item.type === 'FileChange' ? cwd : ''), 'output', '', 'write');
            }
          } else if (['ImageView', 'imageView'].includes(item.type)) add(localPath(item.path), 'reference', '', 'view');
          else if (item.type === 'agentMessage') message('assistant', item.text || '', item.phase);
          else if (item.type === 'userMessage') {
            message('user', textOf(item.content));
            for (const block of item.content || []) if (block.type === 'localImage') add(localPath(block.path), 'reference');
          }
        };
        const base = meta.payload.history_base;
        let historyPartial = false;
        if (!base && start > 0) {
          // Large, non-resumed tasks also have early outputs outside the tail.
          const history = await this.history(id, null, { rolloutBytes: info.size });
          historyPartial = history.partial;
          history.items.forEach(nativeItem);
        } else if (base) {
          // A fork's parent body is outside the selected task's reference scope.
          if (base.thread_id === id) {
            const history = await this.history(id, base.end_ordinal_exclusive);
            historyPartial = history.partial;
            partial ||= historyPartial;
            history.items.forEach(nativeItem);
          } else partial = true;
        }
        // Start consuming only after the asynchronous history lookup: readline
        // must not emit current records while no iterator is attached yet.
        const stream = createReadStream(file, { start, end: info.size - 1 });
        const lines = createInterface({ input: stream, crlfDelay: Infinity });
        try {
          for await (const line of lines) {
            if (first) { first = false; if (start) continue; }
            let r;
            try { r = JSON.parse(line); } catch { partial = true; continue; }
            if (r.type === 'turn_context' && r.payload?.cwd) cwd = r.payload.cwd;
            if (r.type === 'event_msg' && r.payload?.type === 'item_completed' && r.payload.thread_id === id) nativeItem(r.payload.item);
            if (r.type !== 'response_item') continue;
            const p = r.payload || {};
            if (['function_call', 'custom_tool_call'].includes(p.type)) {
              if (taskToolCall(p)) taskCalls.add(p.call_id);
              const files = patchPaths(p, cwd);
              if (files.length) pending.set(p.call_id, files);
            } else if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
              if (taskCalls.delete(p.call_id)) for (const relatedId of returnedTasks(p.output)) {
                if (relatedId !== id) related.add(relatedId);
              }
              const files = pending.get(p.call_id); pending.delete(p.call_id);
              if (files && successfulPatch(p.output)) files.forEach(f => add(f, 'output', '', 'write'));
            } else if (p.type === 'message' && ['assistant', 'user'].includes(p.role)) {
              message(p.role, textOf(p.content), p.phase);
            }
          }
        } finally { lines.close(); stream.destroy(); }
        if (first) throw new Error('empty');
        cached = { key, status: partial ? 'partial' : 'ready', references: [...found.values()], relatedThreads: [...related].map(threadId => ({ threadId })) };
        if (this.cache.size >= 20) this.cache.delete(this.cache.keys().next().value);
        // Retry incomplete inherited projections when the host finishes indexing.
        if (!historyPartial) this.cache.set(id, cached);
      }
      return { status: cached.status, relatedThreads: cached.relatedThreads, references: await Promise.all(cached.references.map(async ref => {
        const info = await stat(ref.path).catch(() => null);
        return { ...ref, exists: info?.isFile() === true, modifiedAt: info?.mtimeMs || 0 };
      })) };
    } catch { return { status: 'unavailable', references: [] }; }
  }
}
