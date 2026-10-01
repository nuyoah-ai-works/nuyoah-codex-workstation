import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillTimeline } from '../nuyoah/workstation/skill-timeline-ui.mjs';

// A DOM contract fixture; this checks state transitions, not native GUI appearance.
function setup() {
 let document;
 class Element {
  constructor(tag, text='') { this.tag=tag; this.textContent=text; this.children=[]; this.hidden=false; this.attrs={}; this.style={}; this.scrollHeight=300; this.scrollTop=0; this.writes=0; }
  append(...elements) { for(const el of elements) { el.parent=this;this.children.push(el); } }
  replaceChildren(...elements) {this.children=[];this.append(...elements);}
  setAttribute(k,v) { this.attrs[k]=v;this.writes++; }
  getAttribute(k) {return this.attrs[k];}
  remove() {if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
  contains(el) {return this===el||this.children.some(c=>c.contains(el));}
  focus() {document.activeElement=this;}
  closest() {return null;}
  getBoundingClientRect() {return this.rect||{left:0,right:0,top:0,bottom:0,width:0,height:0};}
  querySelectorAll() {return this.children;}
 }
 const handlers=new Map(), windowHandlers=new Map();let next=0;
 const title=new Element('button','Task A');title.rect={left:380,right:620,top:8,bottom:36,width:240,height:28};
 const header=new Element('header');header.rect={left:370,right:1200,top:0,bottom:46,width:830,height:46};header.append(title);
 document={head:new Element('head'),body:new Element('body'),createElement:tag=>new Element(tag),querySelectorAll:()=>[header],addEventListener:(k,v)=>handlers.set(k,v),removeEventListener:k=>handlers.delete(k)};
 const window={innerWidth:1200,innerHeight:800,crypto:{randomUUID:()=>`request-${++next}`},addEventListener:(k,v)=>windowHandlers.set(k,v),removeEventListener:k=>windowHandlers.delete(k)};
 const api=createSkillTimeline({window,document});const [button,panel]=document.body.children;
 return {api,button,panel,title,header,document,window,handlers,windowHandlers};
}
const context={hostId:'local',threadId:'a',threadTitle:'Task A'};
test('title control loads only on click; stale responses cannot cross a conversation switch',()=>{
 const f=setup();try{
  f.api.sync(context);assert.equal(f.button.hidden,false);assert.equal(f.api.takeRequest(),null);
  f.button.onclick();const a=f.api.takeRequest();assert.equal(a.threadId,'a');assert.equal(a.consumer,'timeline');assert.equal(f.panel.hidden,false);
  f.api.sync({...context,threadId:'b'});assert.equal(f.panel.hidden,true);
  f.button.onclick();const b=f.api.takeRequest();
  f.api.receive({id:a.id,skillHistory:{status:'ready',events:[{name:'wrong',readAt:'2026-09-13T06:00:00Z'}]}});
  assert.equal(f.panel.children.at(-1).children.length,0);
  f.api.receive({id:b.id,skillHistory:{status:'ready',events:[{name:'right',readAt:'2026-09-13T06:00:00Z'}]}});
  assert.equal(f.panel.children.at(-1).children[0].children[0].textContent,'right');
  f.windowHandlers.get('keydown')({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});
  assert.equal(f.panel.hidden,true);assert.equal(f.document.activeElement,f.button);
 }finally{f.api.destroy();}
});
test('repeated sync is idempotent; missing titles and native action collisions hide the control',()=>{
 const f=setup();try{
  f.api.sync(context);const writes=f.button.writes;
  for(let i=0;i<5;i++)f.api.sync(context);
  assert.equal(f.button.writes,writes);
  f.title.textContent='Something else';f.api.sync(context);assert.equal(f.button.hidden,true);
  const hiddenWrites=f.button.writes;f.api.sync(context);assert.equal(f.button.writes,hiddenWrites);
  f.title.textContent='Task A';const obstacle=f.document.createElement('button');obstacle.rect={left:625,right:655,width:30};f.header.append(obstacle);
  f.api.sync(context);assert.equal(f.button.hidden,true);
 }finally{f.api.destroy();}
});
test('remote scope stays read-free and outside click closes the panel',()=>{
 const f=setup();try{
  f.api.sync({...context,hostId:'remote'});f.button.onclick();assert.equal(f.api.takeRequest(),null);
  assert.match(f.panel.children[2].textContent,/远程/);
  f.handlers.get('pointerdown')({target:f.document.body});assert.equal(f.panel.hidden,true);
 }finally{f.api.destroy();}
});
test('timeline preserves repeated entries and reveals earlier records without requesting another scope',()=>{
 const f=setup();try{
  f.api.sync(context);f.button.onclick();const request=f.api.takeRequest();
  const events=Array.from({length:101},(_,i)=>({name:`read-${i}`,readAt:'2026-09-13T06:00:00Z'}));
  f.api.receive({id:request.id,skillHistory:{status:'partial',events}});
  const list=f.panel.children.at(-1),more=f.panel.children[3];
  assert.equal(list.children.length,100);assert.equal(list.children[0].children[0].textContent,'read-1');assert.equal(more.hidden,false);
  more.onclick();assert.equal(list.children.length,101);assert.equal(more.hidden,true);assert.equal(f.api.takeRequest(),null);
 }finally{f.api.destroy();}
});
