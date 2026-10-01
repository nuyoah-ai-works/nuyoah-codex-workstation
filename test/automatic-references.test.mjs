import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AutomaticReferences} from '../nuyoah/workstation/automatic-references.mjs';
import {TaskContextStore,handleTaskContextRequest} from '../nuyoah/workstation/task-context-store.mjs';
const id='11111111-1111-1111-1111-111111111111';
const other='22222222-2222-2222-2222-222222222222';
test('automatic task files require evidence, stay isolated, refresh and preserve manual state',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'auto-references-'));
 try {
  const file=path.join(root,'session.jsonl'), artifact=path.join(root,'result.md');
  await writeFile(artifact,'test');
  const service=new AutomaticReferences({source:async()=>file});
  const message=(role,content)=>({type:'message',role,content:[{type:'output_text',text:content}]});
  const patch='*** Begin Patch\n*** Add File: result.md\n+test\n*** End Patch';
  const call={type:'custom_tool_call',name:'exec',call_id:'call',input:`text(await tools.apply_patch(${JSON.stringify(patch)}));`};
  const output=(text,call_id='call')=>({type:'custom_tool_call_output',call_id,output:[{type:'input_text',text}]});
  async function records(items,identity=id){
   await writeFile(file,[JSON.stringify({type:'session_meta',payload:{id:identity,cwd:root}}),...items.map(payload=>JSON.stringify({type:'response_item',payload}))].join('\n')+'\n');
  }
  await records([message('assistant',`[file](<${artifact}:3>)`),call,output('{}','wrong')]);
  let r=await service.view(id); assert.equal(r.references[0].relation,'reference');
  await records([call,output('Error: failed\n{}')]); assert.equal((await service.view(id)).references.length,0);
  await records([call,output('{}\n{"output":"later check passed"}'),message('assistant',`[file](${artifact})\n[secret](${root}/.env)`)]);
  r=await service.view(id); assert.equal(r.references.length,1); assert.equal(r.references[0].relation,'output'); assert.equal(r.references[0].exists,true);
  assert.equal((await service.view(other)).status,'unavailable');
  const store=new TaskContextStore(path.join(root,'store'));
  let response=await handleTaskContextRequest(store,{action:'read',threadId:id},null,null,service);
  assert.equal(response.data.automaticReferences.references.length,1);
  await store.update(id,{section:'notes',value:'keep my note',revision:0});
  await store.update(id,{section:'excludedReferencePaths',value:[artifact],revision:1});
  response=await handleTaskContextRequest(store,{action:'read',threadId:id},null,null,service);
  assert.equal(response.data.automaticReferences.references.length,0);
  assert.equal(response.data.notes,'keep my note');
  assert.equal((await store.read(other)).excludedReferencePaths.length,0);
  await store.update(id,{section:'excludedReferencePaths',value:[],revision:2});
  await store.update(id,{section:'references',value:[{relation:'reference',path:artifact,label:'manual'}],revision:3});
  response=await handleTaskContextRequest(store,{action:'read',threadId:id},null,null,service);
  assert.equal(response.data.references[0].label,'manual'); assert.equal(response.data.automaticReferences.references.length,0);
  await rm(artifact); assert.equal((await service.view(id)).references[0].exists,false);
  await records([message('user',`<image name="test" path="${artifact}">`)]);
  assert.equal((await service.view(id)).references[0].relation,'reference');
  await records([call,output('{}')],other); assert.equal((await service.view(id)).status,'unavailable');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('large sessions keep recent deliveries and tool-backed local task links without changing source', async () => {
 const root = await mkdtemp(path.join(os.tmpdir(), 'auto-recent-'));
 try {
  const file = path.join(root, 'session.jsonl'), artifact = path.join(root, 'result.md');
  await writeFile(artifact, 'result');
  const item = payload => JSON.stringify({ type: 'response_item', payload });
  const toolResult = value => JSON.stringify([{ type: 'input_text', text: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }) }]);
  const lines = [JSON.stringify({ type: 'session_meta', payload: { id, cwd: root } }),
   item({ type: 'message', role: 'user', content: [{text: 'padding'.repeat(1500)}] }),
   item({ type: 'custom_tool_call', name: 'exec', call_id: 'task', input: 'const result = await tools.mcp__codex_app__create_thread(args);\ntext(result);' }),
   item({ type: 'custom_tool_call_output', call_id: 'task', output: toolResult({threadId: other, hostId: 'local'}) }),
   item({ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ text: `[First](<${artifact}:5>)` }] }),
   item({ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ text: `[Latest](<${artifact}>)` }] }),
   item({ type: 'message', role: 'user', content: [{ text: `[Input](${artifact})` }] })];
  const original = lines.join('\n') + '\n'; await writeFile(file, original);
  const service = new AutomaticReferences({ source: async () => file, maxBytes: 2500 });
  const r = await service.view(id);
  assert.equal(r.status, 'partial'); assert.deepEqual(r.relatedThreads, [{threadId: other}]);
  assert.equal(r.references.length, 1); assert.equal(r.references[0].label, 'Latest');
  assert.equal(r.references[0].relation, 'output'); assert.equal(r.references[0].evidence, 'delivery');
  assert.equal(r.references[0].exists, true);
  const { readFile } = await import('node:fs/promises'); assert.equal(await readFile(file, 'utf8'), original);
  await writeFile(file, original.replace(id, other)); assert.equal((await service.view(id)).status, 'unavailable');
 } finally { await rm(root, { recursive: true, force: true }); }
});

test('unmatched, failed, remote and quoted tool results never become related tasks', async () => {
 const root = await mkdtemp(path.join(os.tmpdir(), 'auto-task-links-'));
 try {
  const file = path.join(root, 'session.jsonl');
  const call = (call_id, input) => ({ type: 'custom_tool_call', name: 'exec', call_id, input });
  const output = (call_id, value) => ({ type: 'custom_tool_call_output', call_id, output: JSON.stringify(value) });
  const input = 'text(await tools.mcp__codex_app__create_thread(args));';
  const records = [output('unmatched', {threadId: other}),
   call('failed', input), output('failed', {isError: true, threadId: other}),
   call('remote', input), output('remote', {threadId: other, hostId: 'remote:example'}),
   call('quoted', `text(${JSON.stringify(input)});`), output('quoted', {threadId: other}),
   call('list', 'text(await tools.mcp__codex_app__list_threads({}));'), output('list', {threadId: other}),
   call('arbitrary', input), output('arbitrary', {content:[{type:'text',text:`Example: ${JSON.stringify({threadId:other})}`}]})];
  await writeFile(file, [JSON.stringify({type:'session_meta',payload:{id,cwd:root}}), ...records.map(payload=>JSON.stringify({type:'response_item',payload}))].join('\n')+'\n');
  const r = await new AutomaticReferences({source:async()=>file}).view(id);
  assert.deepEqual(r.relatedThreads, []); assert.equal(r.status, 'ready');
 } finally { await rm(root, {recursive:true,force:true}); }
});
