// Adapted from Codex Workspace Enhancer 8552882 (MIT); see THIRD_PARTY_NOTICES.md.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
const types = {
  image: 'png jpg jpeg webp gif bmp svg avif tif tiff ico heic heif',
  video: 'mp4 mov m4v webm mkv avi', audio: 'mp3 wav m4a aac flac ogg oga opus aiff',
  markdown: 'md markdown mdx', html: 'html htm', pdf: 'pdf',
  office: 'docx xlsx pptx doc xls ppt odt ods odp', archive: 'zip rar 7z tar gz bz2 xz',
  code: 'js mjs cjs ts tsx jsx py ps1 sh bash bat cmd css scss less json jsonl yaml yml toml xml sql java go rs c h cpp cs rb php swift kt vue svelte',
  document: 'txt csv tsv rtf log ini cfg'
};
export function fileType(file) {
  const extension = path.extname(file).slice(1).toLowerCase();
  return Object.entries(types).find(([, value]) => value.split(' ').includes(extension))?.[0] || 'other';
}
const previewLimit = 256 * 1024;
function xmlText(value) {
  return value.replace(/<\/(?:w:p|a:p|text:p|row)>/g,'\n').replace(/<[^>]*>/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/[ \t]+/g,' ').trim();
}
function zipEntries(buffer) {
  let end = buffer.length - 22;
  while (end >= Math.max(0,buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < Math.max(0,buffer.length - 65557)) throw new Error('无法读取文件结构');
  let position = buffer.readUInt32LE(end+16);
  const entries=[];
  for(let index=0;index<buffer.readUInt16LE(end+10);index++) {
    if(buffer.readUInt32LE(position)!==0x02014b50) throw new Error('不支持此文件结构');
    const length=buffer.readUInt16LE(position+28), extra=buffer.readUInt16LE(position+30), comment=buffer.readUInt16LE(position+32);
    entries.push({name:buffer.subarray(position+46,position+46+length).toString('utf8'),method:buffer.readUInt16LE(position+10),size:buffer.readUInt32LE(position+20),offset:buffer.readUInt32LE(position+42)});
    position+=46+length+extra+comment;
  }
  return entries;
}
export async function previewFile(file, { thumbnail = false } = {}) {
  const limit = thumbnail ? 4096 : previewLimit;
  const type=fileType(file), stat=await fs.stat(file);
  if (['markdown','code','document','html'].includes(type)) {
    const handle=await fs.open(file,'r');
    try {const buffer=Buffer.alloc(Math.min(stat.size,limit));const {bytesRead}=await handle.read(buffer,0,buffer.length,0);return {type,text:buffer.subarray(0,bytesRead).toString('utf8'),truncated:stat.size>limit};} finally {await handle.close();}
  }
  if (thumbnail) return {type,text:'点击查看',available:false,truncated:false};
  if (type==='office' || path.extname(file).toLowerCase()==='.zip') {
    if(stat.size>64*1024*1024) return {type,text:'此文件超过 64 MB，请在本机应用打开。',truncated:true};
    if (!/\.(docx|xlsx|pptx|odt|ods|odp|zip)$/i.test(file)) return {type,text:'此格式请在本机应用打开。',truncated:false};
    const buffer=await fs.readFile(file),entries=zipEntries(buffer);
    if(type==='archive') return {type,text:entries.map(item=>item.name).join('\n').slice(0,previewLimit),truncated:entries.map(item=>item.name.length+1).reduce((a,b)=>a+b,0)>previewLimit};
    function readXml(item) {
      const start=item.offset+30+buffer.readUInt16LE(item.offset+26)+buffer.readUInt16LE(item.offset+28);
      const compressed=buffer.subarray(start,start+item.size);
      return (item.method===0?compressed:item.method===8?inflateRawSync(compressed,{maxOutputLength:8*1024*1024}):Buffer.alloc(0)).toString('utf8');
    }
    const shared=entries.find(item=>item.name==='xl/sharedStrings.xml');
    const strings=shared?[...readXml(shared).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(match=>xmlText(match[1])):[];
    const selected=entries.filter(item=>/^(word\/document\.xml|ppt\/slides\/slide\d+\.xml|xl\/worksheets\/sheet\d+\.xml|content\.xml)$/.test(item.name)).sort((a,b)=>a.name.localeCompare(b.name,'en',{numeric:true}));
    let text='';let truncated=false;
    for(const item of selected) {
      if(text.length>=previewLimit){truncated=true;break;}
      const xml=readXml(item);
      if(item.name.startsWith('xl/worksheets/')) {
        const cells=[...xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map(([,attributes,content])=>{
          const location=attributes.match(/\br="([^"]+)"/)?.[1] || '';
          const cellType=attributes.match(/\bt="([^"]+)"/)?.[1] || '';
          const value=content.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1];
          let display=cellType==='s'?(strings[Number(value)] ?? ''):cellType==='inlineStr'?xmlText(content):cellType==='b'?(value==='1'?'TRUE':'FALSE'):value!==undefined?xmlText(value):content.includes('<f>')?'='+xmlText(content):'';
          return location+': '+display;
        });
        text+='工作表 '+item.name.match(/sheet(\d+)/)[1]+'\n'+cells.join('\n')+'\n\n';
      } else if(item.name.startsWith('ppt/')) {
        const paragraphs=[...xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)].map(match=>xmlText(match[1])).filter(Boolean);
        text+='幻灯片 '+item.name.match(/slide(\d+)/)[1]+'\n'+paragraphs.join('\n')+'\n\n';
      } else if(item.name==='word/document.xml') {
        text+=[...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map(match=>xmlText(match[1])).filter(Boolean).join('\n\n');
      } else text+=xmlText(xml)+'\n\n';
    }
    return {type,text:text.slice(0,previewLimit)||'未找到可显示的正文结构。',truncated:truncated||text.length>previewLimit};
  }
  return {type,text:'此文件支持下载或在本机应用打开。',truncated:false};
}
