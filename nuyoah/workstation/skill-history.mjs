import { open, stat } from 'node:fs/promises';
import { locateColdHistorySource } from './cold-history.mjs';
import { taskId } from './task-context-store.mjs';

const MiB = 1024 * 1024;
// Decode successful result envelopes; never retain their text in the cache.
function outputs(value, searchMiss = false) {
  if (Array.isArray(value)) return value.flatMap(item => outputs(item, searchMiss));
  if (value && typeof value === 'object') {
    if (value.isError || value.error || value.status === 'rejected') return [];
    // A failed overall shell batch is not a failed read when the only trailing
    // operation is a no-match search. Keep other failed reads fail-closed.
    if (value.exit_code !== undefined && value.exit_code !== 0 && !(searchMiss && value.exit_code === 1)) return [];
    if (value.status === 'fulfilled') return outputs(value.value, searchMiss);
    if (value.result?.status) return outputs(value.result, searchMiss);
    return outputs(value.output ?? value.content ?? value.text, searchMiss);
  }
  if (typeof value !== 'string') return [];
  // The host can prefix a batch of JSON envelopes with a truncation notice.
  // Strip only that known transport prefix, never arbitrary prose.
  value = value.replace(/^Warning: truncated output[^\n]*\n(?:Total output lines:[^\n]*\n)?\s*/, '');
  try { return outputs(JSON.parse(value), searchMiss); } catch {}
  // functions.exec can emit several independent JSON envelopes in one result.
  if (/^\s*\{/.test(value)) {
    const parts = []; let start = -1, depth = 0, quoted = false, escaped = false;
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
      if (c === '"') quoted = true;
      else if (c === '{') { if (!depth) start = i; depth++; }
      else if (c === '}' && depth && !--depth) { try { parts.push(...outputs(JSON.parse(value.slice(start, i + 1)), searchMiss)); } catch {} }
    }
    return parts;
  }
  if (/Process exited with code [1-9]|Exit code: [1-9]/.test(value)) return [];
  return [value];
}
// Read literal JavaScript strings without evaluating recorded code. Skipping
// strings/comments prevents example calls from becoming read requests.
function literal(code, start) {
  const quote = code[start]; let value = '', dynamic = false, i = start + 1;
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === quote) return { value: dynamic ? null : value, end: i + 1 };
    if (quote === '`' && c === '$' && code[i + 1] === '{') dynamic = true;
    if (c !== '\\') { value += c; continue; }
    const next = code[++i];
    if (next === undefined) break;
    if (next === '\n') continue;
    if (next === 'u' || next === 'x') {
      const length = next === 'u' ? 4 : 2, hex = code.slice(i + 1, i + 1 + length);
      if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) dynamic = true;
      else { value += String.fromCharCode(parseInt(hex, 16)); i += length; }
    } else value += ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v'}[next] ?? next);
  }
  return { value: null, end: code.length };
}
function shellCommands(code) {
  const commands = [];
  for (let i = 0; i < code.length;) {
    if (code.startsWith('//', i)) { const end = code.indexOf('\n', i); i = end < 0 ? code.length : end + 1; continue; }
    if (code.startsWith('/*', i)) { const end = code.indexOf('*/', i + 2); i = end < 0 ? code.length : end + 2; continue; }
    if ('\"\'`'.includes(code[i])) { i = literal(code, i).end; continue; }
    const match = /^(?:tools\.)?exec_command\s*\(\s*\{\s*(?:cmd|"cmd"|'cmd')\s*:\s*/.exec(code.slice(i));
    if (match && !/[\w.$]/.test(code[i - 1] || '')) {
      const start = i + match[0].length;
      if ('\"\'`'.includes(code[start])) {
        const result = literal(code, start);
        if (result.value !== null && /^\s*[,}]/.test(code.slice(result.end))) commands.push(result.value);
        i = result.end; continue;
      }
    }
    i++;
  }
  return commands;
}
// Split shell control operators only outside quoted arguments (rg patterns
// commonly contain pipes). Unsupported shell expansion remains fail-closed.
function shellParts(command) {
  const parts = []; let start = 0;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'" || c === '"') {
      const quote = c; let closed = false;
      while (++i < command.length) {
        if (quote === '"' && (command[i] === '`' || command.slice(i, i + 2) === '$(')) return null;
        if (quote === '"' && command[i] === '\\') { i++; continue; }
        if (command[i] === quote) { closed = true; break; }
      }
      if (!closed) return null;
      continue;
    }
    if ('<>`'.includes(c) || command.slice(i, i + 2) === '$(') return null;
    const op = /^(?:&&|\|\||[;\n|&])/.exec(command.slice(i))?.[0];
    if (op) { parts.push({text:command.slice(start,i),op}); i += op.length - 1; start = i + 1; }
  }
  parts.push({text:command.slice(start),op:null});
  return parts;
}
function requestedSkills(p) {
  let commands = [];
  if (/^(?:functions\.)?exec$/.test(p.name || '')) {
    const code = p.input ?? p.arguments ?? '';
    commands.push(...shellCommands(code));
    // Legacy direct shell exec calls.
    if (!commands.length && !/tools\.|[{}]/.test(code)) commands.push(code);
  } else if (/(?:^|[._])(?:exec_command|read_file|read_text)$/.test(p.name || '')) {
    try { const args = JSON.parse(p.arguments); commands.push(args.cmd || `cat ${args.path || args.file_path || ''}`); } catch {}
  }
  const names = new Map();
  for (const command of commands) {
    // Only literal read commands. Echoed examples and search matches are not reads.
    const parts = shellParts(command);
    if (!parts) continue;
    const chain = parts[0]?.text.trim() === 'pwd' ? parts.slice(1) : parts;
    const searchMiss = chain.length === 2 && parts.slice(0, -1).every(part => part.op === '&&')
      && /^(?:cat|head|sed)\s/.test(chain[0].text.trim()) && /^rg\s/.test(chain[1].text.trim());
    for (const {text: segment} of parts) {
      if (!/^\s*(?:cat|head|sed)\s/.test(segment) || /[<>`]|\$\(/.test(segment)) continue;
      for (const match of segment.matchAll(/(?:^|[\/\\])([\w.-]+)[\/\\]SKILL\.md(?=["'\s]|$)/g)) {
        // Narrow recovery for cat/head/sed followed by rg. No pipes, fallback,
        // redirection or arbitrary later commands can manufacture this evidence.
        names.set(match[1], (names.get(match[1]) || false) || searchMiss);
      }
    }
  }
  return names;
}
export class SkillHistory {
  constructor({ source = locateColdHistorySource, maxBytes = 64 * MiB } = {}) {
    this.source = source; this.maxBytes = maxBytes; this.cache = new Map();
  }
  async view(id, budget = this.maxBytes) {
    try {
      id = taskId(id);
      const file = await this.source(id), info = await stat(file);
      const limit = Math.min(this.maxBytes, budget), key = `${info.ino}:${info.size}:${info.mtimeMs}:${limit}`;
      if (this.cache.get(id)?.key === key) return this.cache.get(id).value;
      if (!info.size || limit < 1024) return { status: 'unavailable', skills: [], bytes: 0 };
      const handle = await open(file, 'r'); let text, start;
      try {
        const head = Buffer.alloc(Math.min(info.size, MiB));
        const { bytesRead } = await handle.read(head, 0, head.length, 0);
        const end = head.subarray(0, bytesRead).indexOf(10);
        const meta = JSON.parse(head.subarray(0, end < 0 ? bytesRead : end).toString());
        if (meta.type !== 'session_meta' || meta.payload?.id !== id) throw new Error('identity');
        start = Math.max(0, info.size - limit);
        const buffer = Buffer.alloc(info.size - start);
        const result = await handle.read(buffer, 0, buffer.length, start);
        text = buffer.subarray(0, result.bytesRead).toString('utf8');
      } finally { await handle.close(); }
      let partial = start > 0;
      const pending = new Map(), found = new Map(), events = [];
      const lines = text.split('\n'); if (start) lines.shift();
      for (const line of lines) {
        if (!line.trim()) continue;
        let r; try { r = JSON.parse(line); } catch { partial = true; continue; }
        if (r.type !== 'response_item') continue;
        const p = r.payload || {};
        if (['function_call','custom_tool_call'].includes(p.type)) {
          const names = requestedSkills(p); if (names.size && p.call_id) pending.set(p.call_id, names);
        } else if (['function_call_output','custom_tool_call_output'].includes(p.type) && pending.has(p.call_id)) {
          const names = pending.get(p.call_id); pending.delete(p.call_id);
          if (!Number.isFinite(Date.parse(r.timestamp))) continue;
          const returned = new Set(), decoded = new Map();
          for (const searchMiss of new Set(names.values())) decoded.set(searchMiss, outputs(p.output, searchMiss));
          for (const [requested, searchMiss] of names) for (const body of decoded.get(searchMiss)) {
            if (searchMiss && /(?:^|\n)(?:cat|head|sed|rg):/.test(body)) continue;
            for (const match of body.matchAll(/(?:^|\n)name:\s*["']?([\w.:-]+)["']?\s*(?:\r?\n|$)/g)) {
              const name = match[1];
              if (name === requested && /(?:^|\n)#\s+\S/.test(body)) returned.add(name);
            }
          }
          for (const name of returned) {
            events.push({ name, readAt: r.timestamp });
            const prior = found.get(name);
            found.set(name, { name, count: (prior?.count || 0) + 1,
              readAt: !prior || Date.parse(r.timestamp) > Date.parse(prior.readAt) ? r.timestamp : prior.readAt });
          }
        }
      }
      const value = { status: partial ? 'partial' : 'ready', events: events.sort((a,b) => Date.parse(a.readAt)-Date.parse(b.readAt)), skills: [...found.values()].sort((a,b) => Date.parse(b.readAt)-Date.parse(a.readAt)), bytes: Math.min(info.size, limit) };
      if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(id, { key, value }); return value;
    } catch { return { status: 'unavailable', skills: [], bytes: 0 }; }
  }
  async project(projectId, catalog) {
    if (!projectId || projectId === '__unassigned__') return { status: 'unavailable', skills: [], checked: 0, total: 0 };
    const tasks = [...new Map(catalog.filter(t => t.projectId === projectId && (!t.hostId || t.hostId === 'local')).map(t=>[t.threadId,t])).values()]
      .sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0));
    let budget = 64 * MiB, checked = 0, partial = false;
    const found = new Map();
    for (const task of tasks.slice(0, 100)) {
      if (budget < 1024) break;
      const result = await this.view(task.threadId, Math.min(8 * MiB, budget));
      budget -= result.bytes || 0; if (result.status !== 'unavailable') checked++;
      if (result.status !== 'ready') partial = true;
      for (const skill of result.skills) {
        const prior = found.get(skill.name);
        found.set(skill.name, { ...skill, count: (prior?.count || 0) + skill.count, taskCount: (prior?.taskCount || 0) + 1,
          readAt: prior && Date.parse(prior.readAt) > Date.parse(skill.readAt) ? prior.readAt : skill.readAt });
      }
    }
    return { status: partial || checked < tasks.length ? 'partial' : 'ready', checked, total: tasks.length,
      skills: [...found.values()].sort((a,b)=>Date.parse(b.readAt)-Date.parse(a.readAt)) };
  }
}
