import { open, readdir, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';

const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const threadId = value => UUID.test(text(value, 100)) ? value.trim().toLowerCase() : '';
const hostId = value => !value || value === 'local' ? 'local'
  : typeof value === 'string' && value.length <= 300 && !/[\0\r\n]/.test(value) ? value : '';
const identity = value => {
  const thread = threadId(value?.threadId ?? value?.id), host = hostId(value?.hostId);
  return thread && host ? { hostId: host, threadId: thread } : null;
};
const key = value => JSON.stringify([value.hostId, value.threadId]);
const refLocal = id => ({ hostId: 'local', threadId: id });
const asJSON = value => { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return null; } };
const localHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const recordPosition = Symbol('task relation record position');
const agentPath = value => typeof value === 'string' && value.length <= 500 && /^\/root(?:\/[a-z\d_]+)*$/.test(value) ? value : '';
const observedTime = value => {
  const result = typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : Date.parse(value || '');
  return Number.isFinite(result) ? result : null;
};
const nativeAgentPath = row => {
  const source = asJSON(row.source), spawn = (source?.subagent ?? source?.subAgent)?.thread_spawn;
  return agentPath(row.agent_path ?? row.agentPath ?? spawn?.agent_path);
};
function shortChineseDescription(value) {
  if (typeof value !== 'string') return '';
  let result = value.slice(0, 2000).split(/[。！？!?\r\n]/, 1)[0]
    .replace(/https?:\/\/[^\s，；。]+/gi, '')
    .replace(/`[^`]*`/g, '')
    .replace(/(?:~?\/|[a-z]:[\\/])[^\s，；。！？!?`'"<>（）()]+/gi, '')
    .split(/[；;]|[，,]\s*(?:仅|只(?:改|读|负责)|不要|不得|禁止|先读|独占|文件|范围|必须|验收)/, 1)[0]
    .replace(/^(?:请)?在\s+/, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!/[\u3400-\u9fff]/.test(result) || /(?:api[_ -]?key|token|密码|密钥)\s*[:：=]/i.test(result)) return '';
  return result;
}

// The only filesystem paths admitted by this service originate in the local state DB.
// Neither renderer requests nor task metadata can select files to read.
export async function readLocalTaskMetadata({ codexHome = localHome(), maxRows = 4096, currentThreadId = '' } = {}) {
  const files = (await readdir(codexHome)).filter(name => /^state_\d+\.sqlite$/.test(name))
    .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
  if (!files.length) throw new Error('Local metadata is unavailable');
  const db = new DatabaseSync(path.join(codexHome, files[0]), { readOnly: true });
  try {
    const fields = new Set(db.prepare('PRAGMA table_info(threads)').all().map(row => row.name));
    const select = name => fields.has(name) ? name : `NULL AS ${name}`;
    const rows = db.prepare(`SELECT ${['id', 'rollout_path', 'source', 'thread_source', 'project_id', 'title', 'name', 'agent_path', 'agent_nickname', 'cwd', 'updated_at', 'updated_at_ms', 'archived'].map(select).join(',')}
      FROM threads ORDER BY id = ? DESC, updated_at DESC LIMIT ?`).all(currentThreadId, maxRows + 1);
    return { rows: rows.slice(0, maxRows), partial: rows.length > maxRows };
  } finally { db.close(); }
}

function metadataEdges(row, host = 'local') {
  const to = identity({ hostId: host, threadId: row.threadId ?? row.id });
  if (!to) return [];
  const source = asJSON(row.source);
  const parent = threadId(row.parent_thread_id ?? row.parentThreadId
    ?? (source?.subagent ?? source?.subAgent)?.thread_spawn?.parent_thread_id);
  const fork = threadId(row.forked_from_id ?? row.forkedFromId ?? row.forkedFrom);
  // A spawned agent may carry copied history and both IDs. It is still a child.
  const from = identity({ hostId: host, threadId: parent || fork });
  return from && key(from) !== key(to) ? [{ from, to, kind: parent ? 'parent' : 'fork', source: 'metadata' }] : [];
}

function returnedTasks(value, depth = 0) {
  if (depth > 10 || value == null) return [];
  if (typeof value === 'string') return returnedTasks(asJSON(value), depth + 1);
  if (Array.isArray(value)) return value.slice(0, 256).flatMap(item => returnedTasks(item, depth + 1));
  if (typeof value !== 'object' || value.isError === true || value.error || value.success === false) return [];
  const found = identity(value);
  if (found) return [found];
  return returnedTasks(value.structuredContent ?? value.content ?? value.text ?? null, depth + 1);
}

// A small lexer admits only the two wrappers that forward one actual result:
// text(await tools.method(args)); or const result = await ...; text(result).
// Strings and comments remain opaque; conditional/quoted/example code is rejected.
function wrapperTokens(source) {
  const tokens = [];
  for (let i = 0; i < source.length;) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source.startsWith('//', i)) { const end = source.indexOf('\n', i + 2); i = end < 0 ? source.length : end + 1; continue; }
    if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); if (end < 0) return null; i = end + 2; continue; }
    const start = i, quote = source[i];
    if (['"', "'", '`'].includes(quote)) {
      i++;
      while (i < source.length && source[i] !== quote) {
        if (quote === '`' && source.startsWith('${', i)) return null; // Do not interpret template expressions.
        i += source[i] === '\\' ? 2 : 1;
      }
      if (i >= source.length) return null;
      tokens.push({ value: source.slice(start, ++i), start, end: i }); continue;
    }
    if (quote === '/') return null; // Regex/division expressions are outside the admitted wrapper grammar.
    const word = source.slice(i).match(/^[$A-Z_a-z][$\w]*/)?.[0];
    i += word?.length || 1;
    tokens.push({ value: word || quote, start, end: i });
  }
  return tokens;
}

function taskCall(payload) {
  const names = '(create_thread|fork_thread|send_message_to_thread|read_thread)';
  const direct = String(payload.name || '').match(new RegExp(`(?:^|__)${names}$`));
  if (direct) return { method: direct[1], args: asJSON(payload.arguments ?? payload.input), direct: true };
  if (!['exec', 'functions.exec'].includes(payload.name) || typeof payload.input !== 'string') return null;
  const tokens = wrapperTokens(payload.input); if (!tokens) return null;
  const values = tokens.map(token => token.value);
  let start, resultName = '';
  if (values[0] === 'text' && values[1] === '(') start = 2;
  else if (['const', 'let'].includes(values[0]) && /^[$A-Z_a-z][$\w]*$/.test(values[1] || '') && values[2] === '=') {
    start = 3; resultName = values[1];
  } else return null;
  const method = values[start + 3]?.match(new RegExp(`^mcp__codex_app__${names}$`))?.[1];
  if (!method || values[start] !== 'await' || values[start + 1] !== 'tools' || values[start + 2] !== '.' || values[start + 4] !== '(') return null;
  const opening = start + 4;
  let closing = opening, depth = 0;
  for (; closing < values.length; closing++) {
    if (values[closing] === '(') depth++;
    if (values[closing] === ')' && --depth === 0) break;
  }
  if (closing >= values.length) return null;
  let cursor = closing + 1;
  if (resultName) {
    if (values[cursor] === ';') cursor++;
    if (values.slice(cursor, cursor + 4).join(' ') !== `text ( ${resultName} )`) return null;
    cursor += 4;
  } else if (values[cursor++] !== ')') return null;
  if (values[cursor] === ';') cursor++;
  if (cursor !== values.length) return null;
  return { method, args: asJSON(payload.input.slice(tokens[opening].end, tokens[closing].start)), direct: false };
}

function collectTaskRelationRecords(records, current) {
  current = identity(current);
  if (!current) return { edges: [], links: [] };
  const calls = new Map(), edges = [], links = [];
  const add = (from, to, kind, source) => {
    if (from && to && key(from) !== key(to)) edges.push({ from, to, kind, source });
  };
  for (const record of records) {
    if (record?.type !== 'response_item') continue;
    const p = record.payload || {};
    if (['function_call', 'custom_tool_call'].includes(p.type)) {
      const call = taskCall(p);
      if (call && typeof p.call_id === 'string' && calls.size < 2048) calls.set(p.call_id, call);
    } else if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
      const call = calls.get(p.call_id); calls.delete(p.call_id);
      if (!call) continue;
      for (const to of returnedTasks(p.output)) {
        let from = current, kind = call.method === 'create_thread' ? 'parent' : 'related';
        if (call.method === 'fork_thread' && call.args && typeof call.args === 'object') {
          from = call.args.threadId ? identity({ hostId: call.args.hostId || current.hostId, threadId: call.args.threadId }) : current;
          kind = 'fork';
        }
        add(from, to, kind, 'tool');
      }
    } else if (p.type === 'message' && ['assistant', 'user'].includes(p.role)) {
      const content = Array.isArray(p.content) ? p.content.map(part => typeof part?.text === 'string' ? part.text : '').join('\n') : '';
      for (const match of content.matchAll(/(?:codex:\/\/threads\/|::created-thread\{threadId=")([a-f\d-]{36})/gi)) {
        const id = threadId(match[1]); if (id) links.push({ from: current, threadId: id });
      }
    }
  }
  return { edges, links, agentMetadata: collectAgentMetadata(records) };
}

// Only native collaboration records in the selected parent's already bounded
// tail are admitted. Retain short metadata, never prompts or final answer bodies.
function collectAgentMetadata(records) {
  const calls = new Map(), observations = new Map(); let sequence = 0;
  const save = (target, fields) => {
    if (!target) return;
    const previous = observations.get(target);
    observations.delete(target);
    if (observations.size >= 2048) observations.delete(observations.keys().next().value);
    observations.set(target, { ...previous, target, ...fields, order: sequence++ });
  };
  const successful = value => value && typeof value === 'object' && !Array.isArray(value)
    && value.isError !== true && value.error == null && value.success !== false;
  for (const record of records) {
    if (record?.type !== 'response_item') continue;
    const p = record.payload || {}, at = observedTime(record.timestamp);
    const position = Number.isSafeInteger(record[recordPosition]) ? record[recordPosition]
      : Number.isSafeInteger(record.ordinal) ? record.ordinal : null;
    if (p.type === 'function_call') {
      const method = String(p.name || '').match(/^(?:collaboration\.)?(spawn_agent|list_agents|followup_task)$/)?.[1];
      const args = asJSON(p.arguments);
      if (method && args && typeof args === 'object' && !Array.isArray(args) && typeof p.call_id === 'string' && calls.size < 2048) {
        // Reduce admitted arguments immediately; do not retain the complete prompt.
        calls.set(p.call_id, { method, taskName: text(args.task_name, 160), target: text(args.target, 500),
          description: method === 'spawn_agent' ? shortChineseDescription(args.message) : '' });
      }
    } else if (p.type === 'function_call_output') {
      const call = calls.get(p.call_id); calls.delete(p.call_id);
      if (!call || p.isError === true || p.success === false) continue;
      const value = asJSON(p.output);
      if (call.method === 'followup_task') {
        if (p.output !== '' && !(successful(value) && (value.success === true || agentPath(value.task_name)))) continue;
        const returned = agentPath(value?.task_name);
        if (returned && (call.target.startsWith('/') ? returned !== call.target : returned.split('/').at(-1) !== call.target)) continue;
        const target = returned || agentPath(call.target)
          || (/^[a-z\d_]+$/.test(call.target) ? call.target : '');
        if (target) save(target, { hasFinalResponse: false, finalAt: null, observedAt: at, position });
      } else if (!successful(value)) continue;
      else if (call.method === 'spawn_agent') {
        const target = agentPath(value.task_name);
        if (target && target.split('/').at(-1) === call.taskName && /^[a-z\d_]+$/.test(call.taskName)) {
          save(target, { ...(call.description ? { description: call.description } : {}), hasFinalResponse: false, finalAt: null, observedAt: at, position });
        }
      } else if (Array.isArray(value.agents)) {
        for (const agent of value.agents.slice(0, 2048)) {
          const target = agentPath(agent?.agent_name), status = agent?.agent_status;
          if (!target) continue;
          // Do not read the completed property: its value is the final answer.
          if (status && typeof status === 'object' && !Array.isArray(status) && Object.hasOwn(status, 'completed') && at !== null) {
            save(target, { hasFinalResponse: true, finalAt: at, observedAt: at, position });
          } else if (['running', 'pending', 'failed', 'interrupted'].includes(status)) {
            save(target, { hasFinalResponse: false, finalAt: null, observedAt: at, position });
          }
        }
      }
    } else if (p.type === 'agent_message' && at !== null) {
      const author = agentPath(p.author), recipient = agentPath(p.recipient);
      if (!author || !recipient || author.slice(0, author.lastIndexOf('/')) !== recipient || !Array.isArray(p.content)) continue;
      const part = p.content.find(item => item?.type === 'input_text');
      if (typeof part?.text !== 'string') continue;
      const header = part.text.split(/\r?\n/, 4);
      if (header[0] === 'Message Type: FINAL_ANSWER' && header[1] === `Task name: ${recipient}`
        && header[2] === `Sender: ${author}` && header[3] === 'Payload:') {
        save(author, { hasFinalResponse: true, finalAt: at, observedAt: at, position });
      }
    }
  }
  return [...observations.values()].sort((a, b) => a.order - b.order).map(({ order, ...value }) => value);
}

function mergeAgentMetadata(previous = [], next = []) {
  const entries = new Map();
  const order = value => value.position ?? value.observedAt ?? -1;
  for (const value of [...previous, ...next]) {
    const old = entries.get(value.target);
    if (!old || order(value) >= order(old)) entries.set(value.target, { ...old, ...value });
  }
  return [...entries.values()].sort((a, b) => order(a) - order(b)).slice(-2048);
}

function resolveTaskRelationEvidence(evidence, { catalog = [], onUnresolved = () => {} } = {}) {
  const edges = [...evidence.edges], toolTargets = new Map(), known = new Map();
  const admit = (map, value) => {
    const id = identity(value); if (!id) return;
    if (!map.has(id.threadId)) map.set(id.threadId, new Map());
    map.get(id.threadId).set(key(id), id);
  };
  for (const edge of edges) if (edge.source === 'tool') admit(toolTargets, edge.to);
  for (const value of catalog) admit(known, value);
  const seen = new Set();
  for (const link of evidence.links) {
    const linkKey = `${key(link.from)}:${link.threadId}`;
    if (seen.has(linkKey)) continue; seen.add(linkKey);
    const candidates = toolTargets.get(link.threadId) || known.get(link.threadId);
    if (candidates?.size !== 1) { onUnresolved(link); continue; }
    const to = candidates.values().next().value;
    if (key(link.from) !== key(to)) edges.push({ from: link.from, to, kind: 'related', source: 'link' });
  }
  return edges;
}

export function parseTaskRelationRecords(records, current, options = {}) {
  return resolveTaskRelationEvidence(collectTaskRelationRecords(records, current), {
    ...options, catalog: [current, ...(options.catalog || [])],
  });
}

function safeNode(value, catalogKnown = false) {
  const id = identity(value);
  if (!id) return null;
  const source = asJSON(value.source), spawn = (source?.subagent ?? source?.subAgent)?.thread_spawn;
  const agentPath = text(value.agent_path ?? value.agentPath ?? spawn?.agent_path, 500).replace(/\/+$/, '');
  const agentName = text(agentPath.split('/').at(-1), 160)
    || text(value.agent_nickname ?? value.agentNickname ?? spawn?.agent_nickname, 160);
  const description = shortChineseDescription(value.description), finalAt = observedTime(value.finalAt);
  return { ...id, title: text(value.title) || text(value.name) || agentName || '未命名任务',
    projectId: text(value.projectId ?? value.project_id, 300), projectName: text(value.projectName),
    runtimeStatus: ['running', 'idle', 'waiting', 'completed', 'failed', 'interrupted'].includes(value.runtimeStatus) ? value.runtimeStatus : 'unknown',
    ...(description ? { description } : {}),
    ...(typeof value.hasFinalResponse === 'boolean' ? { hasFinalResponse: value.hasFinalResponse,
      finalAt: value.hasFinalResponse ? finalAt : null } : {}),
    catalogKnown, resolved: true, archived: value.archived === true || value.archived === 1 };
}

export class TaskRelationsService {
  constructor({ metadata = readLocalTaskMetadata, maxRows = 4096, maxHeaders = 128,
    maxHeaderBytes = 64 * 1024, maxTotalHeaderBytes = 4 * 1024 * 1024, maxBodyBytes = 2 * 1024 * 1024,
    maxInitialBodyBytes = maxBodyBytes, explicitRelations = () => [] } = {}) {
    this.metadata = metadata; this.maxRows = maxRows; this.maxHeaders = maxHeaders;
    this.maxHeaderBytes = maxHeaderBytes; this.maxTotalHeaderBytes = maxTotalHeaderBytes; this.maxBodyBytes = maxBodyBytes;
    this.maxInitialBodyBytes = maxInitialBodyBytes;
    this.explicitRelations = explicitRelations;
    this.headerCache = new Map(); this.bodyCache = new Map();
  }

  async readHeader(row, coverage) {
    if (!row.rollout_path || !path.isAbsolute(row.rollout_path)) throw new Error('Missing local source');
    const info = await stat(row.rollout_path);
    if (!info.isFile() || !info.size) throw new Error('Invalid local source');
    const signature = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
    const cached = this.headerCache.get(row.id);
    if (cached?.signature === signature) return { ...cached, info };
    const limit = Math.min(info.size, this.maxHeaderBytes, this.maxTotalHeaderBytes - coverage.headerBytes);
    if (limit <= 0) throw new Error('Header budget');
    const handle = await open(row.rollout_path, 'r');
    try {
      const buffer = Buffer.alloc(limit), { bytesRead } = await handle.read(buffer, 0, limit, 0);
      coverage.headerBytes += bytesRead;
      const end = buffer.subarray(0, bytesRead).indexOf(10);
      if (end < 0) throw new Error('Incomplete header');
      const meta = JSON.parse(buffer.subarray(0, end).toString('utf8'));
      if (meta.type !== 'session_meta' || threadId(meta.payload?.id) !== row.id) throw new Error('Identity mismatch');
      // Retain only relation IDs, never base instructions or other header content.
      const result = { signature, edges: metadataEdges(meta.payload), headerLength: end + 1,
        inherited: Boolean(meta.payload.forked_from_id), historyStartOrdinal: Number.isSafeInteger(meta.payload.subagent_history_start_ordinal)
          ? meta.payload.subagent_history_start_ordinal : null };
      result.sourceIdentity = JSON.stringify([info.dev, info.ino, row.id, result.headerLength,
        result.inherited, result.historyStartOrdinal, result.edges]);
      this.headerCache.delete(row.id); this.headerCache.set(row.id, result);
      if (this.headerCache.size > this.maxHeaders * 2) this.headerCache.delete(this.headerCache.keys().next().value);
      return { ...result, info };
    } finally { await handle.close(); }
  }

  async readCurrentRelations(row, header, coverage) {
    // Forked history may contain the parent's tool results. Without an explicit
    // boundary, metadata remains usable but copied calls cannot establish ownership.
    if (header.inherited && header.historyStartOrdinal === null) { coverage.bodyPartial = true; this.bodyCache.delete(row.id); return; }
    let cached = this.bodyCache.get(row.id);
    if (cached && (cached.sourceIdentity !== header.sourceIdentity || cached.sourceSize > header.info.size)) {
      this.bodyCache.delete(row.id); cached = null;
    }
    if (cached?.signature === header.signature) {
      coverage.bodyPartial ||= cached.partial;
      return;
    }
    const limit = cached ? this.maxBodyBytes : this.maxInitialBodyBytes;
    const start = Math.max(header.headerLength, header.info.size - limit);
    const size = Math.max(0, header.info.size - start), handle = await open(row.rollout_path, 'r');
    let evidence;
    try {
      const buffer = Buffer.alloc(size), { bytesRead } = await handle.read(buffer, 0, size, start);
      coverage.bodyBytes += bytesRead;
      let body = buffer.subarray(0, bytesRead), position = start;
      if (start > header.headerLength) {
        const newline = body.indexOf(10), skip = newline < 0 ? body.length : newline + 1;
        position += skip; body = body.subarray(skip);
      }
      const lines = body.toString('utf8').split('\n');
      const records = [];
      for (const line of lines) {
        if (line) try {
          const record = JSON.parse(line); record[recordPosition] = position; records.push(record);
        } catch { coverage.bodyPartial = true; }
        position += Buffer.byteLength(line) + 1;
      }
      evidence = collectTaskRelationRecords(header.historyStartOrdinal === null ? records
        : records.filter(record => Number.isSafeInteger(record.ordinal) && record.ordinal >= header.historyStartOrdinal),
      { hostId: 'local', threadId: row.id });
      const after = await handle.stat();
      if (after.ino !== header.info.ino || after.size < header.info.size) throw new Error('Source changed');
      if (after.size !== header.info.size || after.mtimeMs !== header.info.mtimeMs) coverage.bodyPartial = true;
    } finally { await handle.close(); }
    const partial = start > header.headerLength || coverage.bodyPartial;
    coverage.bodyPartial ||= partial;
    evidence.agentMetadata = mergeAgentMetadata(cached?.agentMetadata, evidence.agentMetadata);
    this.bodyCache.delete(row.id); this.bodyCache.set(row.id, { signature: header.signature, sourceIdentity: header.sourceIdentity,
      sourceSize: header.info.size, ...evidence, partial });
    if (this.bodyCache.size > 20) this.bodyCache.delete(this.bodyCache.keys().next().value);
  }

  async view({ scope = 'conversation', hostId: selectedHost = 'local', threadId: selectedThread = '', projectId = '', tasks = [] } = {}) {
    if (!['conversation', 'project', 'global'].includes(scope)) throw new Error('Invalid task map scope');
    const current = identity({ hostId: selectedHost, threadId: selectedThread });
    const selectedHostId = hostId(selectedHost), selectedProjectId = text(projectId, 300);
    if (scope === 'conversation' && !current || scope === 'project' && (!selectedHostId || !current && !selectedProjectId)) {
      return { status: 'unavailable', nodes: [], edges: [], coverage: { status: 'unavailable' } };
    }
    const coverage = { status: 'ready', metadataCount: 0, metadataPartial: false, headerCount: 0, headerBytes: 0,
      headerPartial: false, bodyBytes: 0, bodyPartial: false, unresolvedRelations: 0, unresolvedLinks: 0, unresolvedCreatedThreads: 0, remoteMetadataOnly: false };
    const nodes = new Map(), allEdges = [], byId = new Map();
    try {
      for (const edge of await this.explicitRelations()) {
        const from = identity(edge?.from), to = identity(edge?.to);
        if (from && to && from.hostId === 'local' && to.hostId === 'local' && key(from) !== key(to) && edge.kind === 'parent') {
          allEdges.push({ from, to, kind: 'parent', source: 'canvas-command' });
        }
      }
    } catch { coverage.metadataPartial = true; }
    let available = false;
    try {
      const result = await this.metadata({ maxRows: this.maxRows, currentThreadId: current?.hostId === 'local' ? current.threadId : '' });
      coverage.metadataPartial = result.partial === true || result.rows.length > this.maxRows;
      for (const row of result.rows.slice(0, this.maxRows)) {
        const id = threadId(row?.id); if (!id) { coverage.metadataPartial = true; continue; }
        const admitted = { ...row, id }, node = safeNode({ ...admitted, title: row.name || row.title, hostId: 'local' });
        byId.set(id, admitted); nodes.set(key(node), node); allEdges.push(...metadataEdges(admitted));
      }
      coverage.metadataCount = byId.size; available = true;
    } catch { coverage.metadataPartial = true; }
    if (!Array.isArray(tasks)) tasks = [];
    if (tasks.length > this.maxRows) coverage.metadataPartial = true;
    for (const task of tasks.slice(0, this.maxRows)) {
      const node = safeNode(task, true); if (!node) continue;
      const old = nodes.get(key(node));
      nodes.set(key(node), { ...old, ...node, projectId: node.projectId || old?.projectId || '', title: node.title === '未命名任务' ? old?.title || node.title : node.title });
      allEdges.push(...metadataEdges(task, node.hostId));
      if (node.hostId !== 'local') coverage.remoteMetadataOnly = true;
    }
    const headerCandidates = [...byId.values()].filter(row => row.id === current?.threadId && current.hostId === 'local'
      || row.thread_source === 'agent_forked_thread' || row.thread_source === 'subagent' && !metadataEdges(row).length);
    headerCandidates.sort((a, b) => Number(b.id === current?.threadId) - Number(a.id === current?.threadId));
    if (headerCandidates.length > this.maxHeaders) coverage.headerPartial = true;
    for (const row of headerCandidates.slice(0, this.maxHeaders)) {
      try {
        coverage.headerCount++;
        const header = await this.readHeader(row, coverage); allEdges.push(...header.edges);
        if (current?.hostId === 'local' && row.id === current.threadId) await this.readCurrentRelations(row, header, coverage);
      } catch { coverage.headerPartial = true; this.bodyCache.delete(row.id); }
    }
    // Previously observed successful task links remain useful across scope switches.
    for (const [parentId, cached] of this.bodyCache) {
      allEdges.push(...resolveTaskRelationEvidence(cached, {
        catalog: nodes.values(), onUnresolved: () => { coverage.unresolvedLinks++; },
      }));
      // A canonical agent name is meaningful only among this verified parent's
      // native direct children. Same names elsewhere never grant ownership.
      const children = [...byId.values()].filter(row => nativeAgentPath(row) && metadataEdges(row)
        .some(edge => edge.kind === 'parent' && edge.from.threadId === parentId));
      for (const evidence of cached.agentMetadata || []) {
        const matches = children.filter(row => evidence.target.startsWith('/') ? nativeAgentPath(row) === evidence.target
          : nativeAgentPath(row).split('/').at(-1) === evidence.target);
        if (matches.length !== 1) continue;
        const row = matches[0], node = nodes.get(key(refLocal(row.id)));
        if (!node) continue;
        if (evidence.description && !node.description) node.description = evidence.description;
        const updateTimes = [observedTime(row.updated_at_ms), observedTime(row.updated_at)].filter(value => value !== null);
        const updatedAt = updateTimes.length ? Math.max(...updateTimes) : null;
        if (evidence.hasFinalResponse === false) { node.hasFinalResponse = false; node.finalAt = null; node.agentCompletion = false; }
        else if (evidence.hasFinalResponse === true && updatedAt !== null && updatedAt <= evidence.finalAt) {
          node.hasFinalResponse = true; node.finalAt = evidence.finalAt; node.agentCompletion = true;
        }
      }
    }
    const edges = new Map();
    for (const edge of allEdges.slice(0, this.maxRows * 8)) {
      const fromKnown = nodes.has(key(edge.from)), toKnown = nodes.has(key(edge.to));
      if (!fromKnown || !toKnown) {
        coverage.unresolvedRelations++;
        if (!fromKnown && !toKnown) continue;
        for (const endpoint of [edge.from, edge.to]) if (!nodes.has(key(endpoint))) {
          nodes.set(key(endpoint), { ...endpoint, title: '待同步任务', projectId: '', projectName: '',
            runtimeStatus: 'unknown', resolved: false, catalogKnown: false, archived: false });
        }
      }
      const pair = `${key(edge.from)}:${key(edge.to)}`;
      const old = edges.get(pair), weight = kind => ({ related: 0, fork: 1, parent: 2 })[kind];
      if (!old || weight(edge.kind) > weight(old.kind)) edges.set(pair, edge);
    }
    // A real child without its own binding belongs with its parent's project.
    for (let pass = 0; pass < 20; pass++) {
      let changed = false;
      for (const edge of edges.values()) {
        if (edge.kind !== 'parent' || edge.from.hostId !== edge.to.hostId) continue;
        const parent = nodes.get(key(edge.from)), child = nodes.get(key(edge.to));
        if ((!child.projectId || child.projectId === '__unassigned__') && parent.projectId && parent.projectId !== '__unassigned__') {
          child.projectId = parent.projectId; child.projectName ||= parent.projectName; changed = true;
        }
      }
      if (!changed) break;
    }
    let selected = new Set([...nodes].filter(([, node]) => !node.archived).map(([k]) => k));
    if (scope === 'conversation') {
      selected = new Set(current && nodes.has(key(current)) ? [key(current)] : []);
      const adjacent = new Map();
      for (const edge of edges.values()) for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
        const k = key(from); if (!adjacent.has(k)) adjacent.set(k, []); adjacent.get(k).push(key(to));
      }
      const queue = [...selected];
      for (let index = 0; index < queue.length; index++) for (const next of adjacent.get(queue[index]) || []) {
        if (!selected.has(next)) { selected.add(next); queue.push(next); }
      }
    } else if (scope === 'project') {
      const project = selectedProjectId || (current ? nodes.get(key(current))?.projectId : '');
      selected = new Set([...nodes].filter(([, node]) => !node.archived && node.hostId === selectedHostId
        && project && project !== '__unassigned__' && node.projectId === project).map(([k]) => k));
      if (!project || project === '__unassigned__') coverage.metadataPartial = true;
    }
    const knownChildren = new Set([...edges.values()].filter(edge => edge.kind === 'parent').map(edge => key(edge.to)));
    coverage.unresolvedCreatedThreads = [...byId.values()].filter(row => row.thread_source === 'agent_created_thread'
      && selected.has(key(refLocal(row.id))) && !knownChildren.has(key(refLocal(row.id)))).length;
    const status = !available && !nodes.size || scope === 'conversation' && !selected.size ? 'unavailable'
      : coverage.metadataPartial || coverage.headerPartial || coverage.bodyPartial || coverage.unresolvedRelations || coverage.unresolvedLinks
        || coverage.unresolvedCreatedThreads || coverage.remoteMetadataOnly ? 'partial' : 'ready';
    coverage.status = status;
    return { status, nodes: [...nodes].filter(([k]) => selected.has(k)).map(([, node]) => node),
      edges: [...edges.values()].filter(edge => selected.has(key(edge.from)) && selected.has(key(edge.to))), coverage };
  }
}
