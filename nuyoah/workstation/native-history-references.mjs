import { DatabaseSync } from 'node:sqlite';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The host indexes both long rollouts and pre-resume items here. Select only reference evidence;
// never return image bytes, prompts, file diffs, command output or reasoning.
export async function readNativeHistoryReferences(id, endOrdinal, {
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  maxItems = 2000, maxBytes = 2 * 1024 * 1024, rolloutBytes,
} = {}) {
  let db;
  try {
    const currentRollout = endOrdinal === null;
    if (currentRollout ? !Number.isSafeInteger(rolloutBytes) || rolloutBytes <= 0
      : !Number.isSafeInteger(endOrdinal) || endOrdinal < 0) throw new Error('boundary');
    const names = (await readdir(codexHome)).filter(n => /^thread_history_\d+\.sqlite$/.test(n))
      .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
    if (!names.length) throw new Error('missing');
    db = new DatabaseSync(path.join(codexHome, names[0]), { readOnly: true });
    const projection = db.prepare('SELECT next_rollout_ordinal, next_rollout_byte_offset FROM thread_history_projection_state WHERE thread_id = ?').get(id);
    if (currentRollout) {
      if (!projection || !Number.isSafeInteger(projection.next_rollout_byte_offset)
        || projection.next_rollout_byte_offset > rolloutBytes) throw new Error('projection boundary');
      endOrdinal = projection.next_rollout_ordinal;
      if (!Number.isSafeInteger(endOrdinal) || endOrdinal < 0) throw new Error('projection ordinal');
    }
    let partial = !projection || projection.next_rollout_ordinal < endOrdinal
      || currentRollout && projection.next_rollout_byte_offset < rolloutBytes;
    const rows = db.prepare(`SELECT CASE item_type
      WHEN 'imageGeneration' THEN json_object('type', 'imageGeneration',
        'status', json_extract(item_json, '$.status'), 'failure', json_extract(item_json, '$.failure'),
        'savedPath', json_extract(item_json, '$.savedPath'))
      WHEN 'imageView' THEN json_object('type', 'imageView', 'path', json_extract(item_json, '$.path'))
      WHEN 'fileChange' THEN json_object('type', 'fileChange', 'status', json_extract(item_json, '$.status'),
        'changes', (SELECT json_group_array(json_object('path', json_extract(value, '$.path'),
          'kind', json_extract(value, '$.kind.type'), 'movePath', json_extract(value, '$.kind.move_path')))
          FROM json_each(item_json, '$.changes')))
      WHEN 'agentMessage' THEN json_object('type', 'agentMessage', 'phase', json_extract(item_json, '$.phase'),
        'text', substr(json_extract(item_json, '$.text'), 1, 65536),
        'truncated', length(json_extract(item_json, '$.text')) > 65536)
      WHEN 'userMessage' THEN json_object('type', 'userMessage', 'content',
        (SELECT json_group_array(json_object('type', json_extract(value, '$.type'),
          'path', json_extract(value, '$.path'), 'text', substr(json_extract(value, '$.text'), 1, 65536),
          'truncated', length(json_extract(value, '$.text')) > 65536))
          FROM json_each(item_json, '$.content') WHERE json_extract(value, '$.type') IN ('text', 'localImage')))
      END AS evidence FROM thread_items
      WHERE thread_id = ? AND rollout_ordinal < ? AND updated_at_ordinal < ?
        AND item_type IN ('imageGeneration', 'imageView', 'fileChange', 'agentMessage', 'userMessage')
      ORDER BY rollout_ordinal DESC, item_id DESC LIMIT ?`).iterate(id, endOrdinal, endOrdinal, maxItems + 1);
    const items = []; let bytes = 0;
    for (const row of rows) {
      bytes += Buffer.byteLength(row.evidence);
      if (items.length >= maxItems || bytes > maxBytes) { partial = true; break; }
      const item = JSON.parse(row.evidence);
      partial ||= Boolean(item.truncated || item.content?.some(block => block.truncated));
      items.push(item);
    }
    return { items: items.reverse(), partial };
  } catch { return { items: [], partial: true }; }
  finally { db?.close(); }
}
