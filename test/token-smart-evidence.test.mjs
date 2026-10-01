import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TokenSmartEvidence } from '../nuyoah/workstation/token-smart-evidence.mjs';
const id = '11111111-1111-1111-1111-111111111111';
const timestamp = '2026-09-09T06:00:00Z';
const body = 'name: token-smart\n# Token Smart\n## Working rules';
const call = { type: 'custom_tool_call', name: 'exec', call_id: 'read1', input: 'cat /example/token-smart/SKILL.md' };
const result = (output, call_id = 'read1') => ({ type: 'custom_tool_call_output', call_id, output });
test('requires matching read call, successful returned skill body and task identity', async () => {
 const root = await mkdtemp(path.join(os.tmpdir(), 'skill-evidence-'));
 const file = path.join(root, 'session.jsonl');
 const service = new TokenSmartEvidence({ source: async () => file });
 async function check(items, expected, identity = id) {
  await writeFile(file, [JSON.stringify({type:'session_meta',payload:{id:identity}}), ...items.map(payload => JSON.stringify({type:'response_item',timestamp,payload}))].join('\n')+'\n');
  assert.equal((await service.view(id)).status, expected);
 }
 try {
  await check([{type:'message', role:'assistant', content:body}], 'not_observed');
  await check([call], 'not_observed');
  await check([call, result(body, 'other')], 'not_observed');
  await check([call, result(JSON.stringify({exit_code:1,output:body}))], 'not_observed');
  await check([call, result('file missing')], 'not_observed');
  await check([call, result([{type:'input_text',text:JSON.stringify({exit_code:0,output:body})}])], 'read');
  assert.deepEqual(await service.view(id), {status:'read',readAt:timestamp});
  await check([call, result(body)], 'unavailable', '22222222-2222-2222-2222-222222222222');
  await rm(file);
  assert.equal((await service.view(id)).status,'unavailable');
 } finally { await rm(root,{recursive:true,force:true}); }
});
