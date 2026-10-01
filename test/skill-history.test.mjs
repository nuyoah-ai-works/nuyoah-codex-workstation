import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkillHistory } from '../nuyoah/workstation/skill-history.mjs';
import { selectMainCodexTarget } from '../scripts/cdp-client.mjs';
const id = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';
const time = '2026-09-13T07:00:00Z';
const body = name => `---\nname: ${name}\ndescription: Example\n---\n# Example\n## Working methods`;
const call = (key, cmd) => ({ type:'custom_tool_call', name:'functions.exec', call_id:key, input:`text(await tools.exec_command({cmd:${JSON.stringify(cmd)}}));` });
const output = (key, data) => ({type:'custom_tool_call_output',call_id:key,output:data});
const success = name => JSON.stringify({exit_code:0,output:body(name)});
const session = (identity, items) => [JSON.stringify({type:'session_meta',payload:{id:identity}}), ...items.map(payload=>JSON.stringify({type:'response_item',timestamp:time,payload}))].join('\n')+'\n';

test('counts successful paired reads, handles updated headings and bundled outputs, rejects mentions and failures', async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),'skill-history-')); const file=path.join(root,'session');
 const service=new SkillHistory({source:async()=>file});
 try {
  await writeFile(file,session(id,[
   {type:'message',role:'assistant',content:body('fake')},
   call('a','cat /example/token-smart/SKILL.md; cat /example/writer/SKILL.md'),
   output('a',success('token-smart')+success('writer')),
   call('b','cat /example/token-smart/SKILL.md'),output('b',[{text:success('token-smart')}]),
   call('c','cat /example/failed/SKILL.md'),output('c',JSON.stringify({exit_code:1,output:body('failed')})),
   call('d',"echo 'cat /example/quoted/SKILL.md'"),output('d',success('quoted')),
   call('e','rg name /example/searched/SKILL.md'),output('e',success('searched')),
   output('unknown',success('ghost')),
   call('f','cat /example/wrong/SKILL.md'),output('f',success('another')),
   call('g','cat /example/pending/SKILL.md'),
  ]));
  const data=await service.view(id);
  assert.equal(data.status,'ready');
  assert.deepEqual(data.events.map(e=>e.name),['token-smart','writer','token-smart']);
  assert.ok(data.events.every(e=>e.readAt===time));
  assert.deepEqual(data.skills,[{name:'token-smart',count:2,readAt:time},{name:'writer',count:1,readAt:time}]);
  assert.equal((await service.view(other)).status,'unavailable');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('bounded tail does not pair missing calls or claim complete coverage',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'skill-tail-')); const file=path.join(root,'session');
 try{
  await writeFile(file,session(id,[call('old','cat /example/old/SKILL.md'),{type:'message',content:'x'.repeat(6000)},output('old',success('old')),call('new','cat /example/new/SKILL.md'),output('new',success('new'))]));
  const data=await new SkillHistory({source:async()=>file,maxBytes:2048}).view(id);
  assert.equal(data.status,'partial');assert.deepEqual(data.skills.map(x=>x.name),['new']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('project history excludes remote and other projects and reports unreadable records',async()=>{
 const service=new SkillHistory(); const visited=[];
 service.view=async id=>{visited.push(id);return id==='missing'?{status:'unavailable',skills:[]}:{status:'ready',skills:[{name:'writer',count:2,readAt:time}],bytes:10};};
 const data=await service.project('p',[
  {threadId:id,projectId:'p'},{threadId:other,projectId:'p'},{threadId:id,projectId:'p'},
  {threadId:'missing',projectId:'p'},{threadId:'remote',projectId:'p',hostId:'remote'},
  {threadId:'outside',projectId:'q'},
 ]);
 assert.deepEqual(visited,[id,other,'missing']);assert.equal(data.status,'partial');assert.equal(data.checked,2);assert.equal(data.total,3);
 assert.equal(data.skills[0].count,4);assert.equal(data.skills[0].taskCount,2);
});
test('native target survives task-title changes without selecting web pages or frames',()=>{
 const native={type:'page',url:'app://-/index.html',title:'修复显示并增加 Skill 历史',webSocketDebuggerUrl:'ws://127.0.0.1/native'};
 assert.equal(selectMainCodexTarget([{...native,type:'iframe'},{...native,url:'https://example.com'},native]),native);
});

test('timeline keeps repeated skill reads in chronological order while summary keeps the latest time', async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),'skill-order-')); const file=path.join(root,'session');
 try {
  const items=[call('later','cat /example/token-smart/SKILL.md'),output('later',success('token-smart')),call('early','cat /example/token-smart/SKILL.md'),output('early',success('token-smart'))];
  const records=session(id,items).trim().split('\n').map(JSON.parse);
  records[2].timestamp='2026-09-13T08:00:00Z';records[4].timestamp='2026-09-13T06:00:00Z';
  await writeFile(file,records.map(JSON.stringify).join('\n')+'\n');
  const data=await new SkillHistory({source:async()=>file}).view(id);
  assert.deepEqual(data.events.map(x=>x.readAt),['2026-09-13T06:00:00Z','2026-09-13T08:00:00Z']);
  assert.equal(data.skills[0].count,2);assert.equal(data.skills[0].readAt,'2026-09-13T08:00:00Z');
 } finally {await rm(root,{recursive:true,force:true});}
});

test('recognizes parallel literal reads and fulfilled envelopes behind host truncation notices', async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),'skill-parallel-')), file=path.join(root,'session');
 try {
  const parallel={type:'custom_tool_call',name:'exec',call_id:'parallel',input:`const results = await Promise.allSettled([tools.exec_command({cmd:'cat /example/token-smart/SKILL.md'}), tools.exec_command({"cmd":\`cat /example/writer/SKILL.md\`})]); results.forEach((r,i)=>text({i,...r}));`};
  const envelope=(i,name)=>JSON.stringify({i,status:'fulfilled',value:{exit_code:0,output:body(name)}});
  await writeFile(file,session(id,[parallel,output('parallel',[
   {type:'input_text',text:'Script completed\nOutput:\n'},
   {type:'input_text',text:'Warning: truncated output (original token count: 18000)\nTotal output lines: 3\n\n'+JSON.stringify({i:0,result:JSON.parse(envelope(0,'token-smart'))})+'\n'+envelope(1,'writer')+'\n{"unfinished":'},
  ])]));
  const data=await new SkillHistory({source:async()=>file}).view(id);
  assert.deepEqual(data.skills.map(s=>s.name),['token-smart','writer']);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('recovers returned read content before a trailing no-match search, but rejects actual failures and fallback output', async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),'skill-search-')), file=path.join(root,'session');
 try {
  const items=[];
  const cases=[
   ['observed','pwd && cat /example/observed/SKILL.md && rg \"needle|other needle\" /example/index',1,body('observed')],
   ['single','cat /example/single/SKILL.md',1,body('single')],
   ['io','cat /example/io/SKILL.md && rg needle /example/index',1,body('io')+'\ncat: /example/io/SKILL.md: Input/output error'],
   ['searcherror','cat /example/searcherror/SKILL.md && rg needle /example/index',2,body('searcherror')],
   ['fallback','cat /example/fallback/SKILL.md || echo fallback',1,body('fallback')],
   ['otherfailure','cat /example/otherfailure/SKILL.md && false',1,body('otherfailure')],
  ];
  for(const [key,cmd,exit_code,text] of cases)items.push(call(key,cmd),output(key,JSON.stringify({exit_code,output:text})));
  await writeFile(file,session(id,items));
  const data=await new SkillHistory({source:async()=>file}).view(id);
  assert.deepEqual(data.skills.map(s=>s.name),['observed']);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('does not execute or recognize quoted examples, comments, dynamic commands, rejected results or arbitrary prefixed JSON', async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),'skill-literals-')), file=path.join(root,'session');
 try {
  const snippets=[
   `text("tools.exec_command({cmd:'cat /example/fake/SKILL.md'})")`,
   `// tools.exec_command({cmd:'cat /example/fake/SKILL.md'})`,
   `/* tools.exec_command({cmd:'cat /example/fake/SKILL.md'}) */`,
   'await tools.exec_command({cmd:`cat ${root}/fake/SKILL.md`})',
   `await tools.exec_command({cmd:'cat /example/fake/SKILL.md' + extra})`,
  ];
  const items=snippets.flatMap((input,i)=>[{type:'custom_tool_call',name:'exec',call_id:String(i),input},output(String(i),success('fake'))]);
  items.push(call('reject','cat /example/reject/SKILL.md'),output('reject',JSON.stringify({status:'rejected',value:{exit_code:0,output:body('reject')}})));
  items.push(call('prose','cat /example/prose/SKILL.md'),output('prose','Example output:\n'+success('prose')));
  await writeFile(file,session(id,items));
  assert.deepEqual((await new SkillHistory({source:async()=>file}).view(id)).skills,[]);
 } finally {await rm(root,{recursive:true,force:true});}
});
