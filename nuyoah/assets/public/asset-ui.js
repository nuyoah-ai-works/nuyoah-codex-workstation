// Pure view helpers shared by the browser and regression tests.
export class ThumbnailQueue {
  constructor() { this.running=0;this.pending=[];this.controller=new AbortController(); }
  add(work) { if(this.pending.length>=60)return;this.pending.push({work,signal:this.controller.signal});this.drain(); }
  clear() { this.controller.abort();this.pending=[];this.controller=new AbortController(); }
  drain() {
    while(this.running<2&&this.pending.length) {
      const {work,signal}=this.pending.shift();this.running++;
      Promise.resolve().then(()=>{signal.throwIfAborted();return work(signal);}).catch(()=>{}).finally(()=>{this.running--;this.drain();});
    }
  }
}

export function restoreView(saved = {}, sources = [], context = {}) {
  const selected = sources.find(s => s.id === saved.sourceId);
  const bound = sources.find(s => s.projectId && s.projectId === context.projectId);
  const sameProject = (saved.projectId || '') === (context.projectId || '');
  const task = saved.scope === 'task' && context.threadId && sameProject;
  const source = sameProject ? selected || bound || sources[0] : bound || selected || sources[0];
  return { scope: task ? 'task' : source?.kind || 'folder', sourceId: task ? '' : source?.id || '',
    folder: !task && source?.id === saved.sourceId ? String(saved.folder || '') : '',
    layout: saved.layout === 'list' ? 'list' : 'grid',
    tileSize: Math.max(100, Math.min(220, Number(saved.tileSize) || 140)) };
}

export function buildFolderTree(folders, source) {
  const roots = [], nodes = new Map(), root = (source?.root || '').replace(/\\/g, '/').replace(/\/$/, '');
  for (const raw of folders) {
    const value = raw.replace(/\\/g, '/');
    if (value === root) continue;
    const local = value.startsWith(root + '/');
    const relative = local ? value.slice(root.length + 1) : value;
    if (!local && /^(\/|[A-Za-z]:\/)/.test(relative)) continue;
    let parent = null, prefix = local ? root : '';
    for (const label of relative.split('/').filter(Boolean)) {
      prefix = prefix ? prefix + '/' + label : label;
      let node = nodes.get(prefix);
      if (!node) { node = { label, value: prefix, children: [] }; nodes.set(prefix, node); (parent ? parent.children : roots).push(node); }
      parent = node;
    }
  }
  function sort(nodes) { nodes.sort((a,b)=>a.label.localeCompare(b.label,'zh-CN',{numeric:true}));for (const n of nodes) sort(n.children); }
  sort(roots);return roots;
}

export function buildEagleFolderTree(folders, rootId = '') {
  const roots = [], nodes = new Map();
  for (const folder of folders) nodes.set(folder.id, { label: folder.name, value: folder.id, children: [] });
  for (const folder of folders) {
    if (folder.id === rootId) continue;
    const node = nodes.get(folder.id), parent = nodes.get(folder.parentId);
    if (parent && folder.parentId !== rootId) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

const escape = text => String(text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function inline(text, depth = 0) {
  if (depth > 4) return escape(text);
  const token = /(`+)([\s\S]*?)\1|(!?)\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let result = '', cursor = 0;
  for (const match of text.matchAll(token)) {
    result += escape(text.slice(cursor, match.index));cursor = match.index + match[0].length;
    if (match[1]) result += '<code>' + escape(match[2]) + '</code>';
    else if (match[3] !== undefined) {
      const label = inline(match[4], depth + 1), href = match[5];
      if (match[3] === '!') result += '<span class="md-image-label">图片：' + (label || '未命名') + '</span>';
      else if (/^https?:\/\//i.test(href)) result += '<a href="' + escape(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
      else result += label + ' <code>' + escape(href) + '</code>';
    } else if (match[6] || match[7]) result += '<strong>' + inline(match[6] || match[7], depth + 1) + '</strong>';
    else if (match[8]) result += '<del>' + inline(match[8], depth + 1) + '</del>';
    else result += '<em>' + inline(match[9] || match[10], depth + 1) + '</em>';
  }
  return result + escape(text.slice(cursor));
}
const cells = line => line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(x=>x.trim().replace(/\\\|/g,'|'));
const tableRule = line => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || '');

export function renderMarkdown(value) {
  const lines = String(value).replace(/\r\n?/g,'\n').split('\n'), output = [];
  const block = line => /^(?:\s*$| {0,3}(?:#{1,6}\s|`{3,}|~{3,}|>\s?|[-*+]\s|\d+[.)]\s|(?:[-*_]\s*){3,}$))/.test(line || '');
  for (let i=0;i<lines.length;) {
    const line=lines[i];if(!line.trim()){i++;continue;}
    const fence=/^ {0,3}(`{3,}|~{3,})([^\s`]*)\s*$/.exec(line);
    if(fence){const code=[];i++;while(i<lines.length&&!new RegExp('^ {0,3}'+fence[1][0]+'{'+fence[1].length+',}\\s*$').test(lines[i]))code.push(lines[i++]);if(i<lines.length)i++;output.push('<pre><code>'+escape(code.join('\n'))+'</code></pre>');continue;}
    const heading=/^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
    if(heading){const level=heading[1].length;output.push(`<h${level}>${inline(heading[2])}</h${level}>`);i++;continue;}
    if(/^ {0,3}(?:[-*_]\s*){3,}$/.test(line)){output.push('<hr>');i++;continue;}
    if(i+1<lines.length&&line.includes('|')&&tableRule(lines[i+1])){
      const header=cells(line);i+=2;let rows='';while(i<lines.length&&lines[i].includes('|')&&lines[i].trim())rows+='<tr>'+cells(lines[i++]).map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>';
      output.push('<div class="md-table"><table><thead><tr>'+header.map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>');continue;
    }
    if(/^ {0,3}>/.test(line)){const quote=[];while(i<lines.length&&/^ {0,3}>/.test(lines[i]))quote.push(lines[i++].replace(/^ {0,3}> ?/,''));output.push('<blockquote>'+quote.map(x=>inline(x)).join('<br>')+'</blockquote>');continue;}
    const list=/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/.exec(line);
    if(list){const tag=list[2]?'ol':'ul',items=[];while(i<lines.length){const item=/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/.exec(lines[i]);if(!item||Boolean(item[2])!==Boolean(list[2]))break;let text=item[3];const task=/^\[([ xX])\]\s+(.+)$/.exec(text);items.push('<li>'+(task?'<span class="md-task">'+(task[1]===' '?'☐':'☑')+'</span> '+inline(task[2]):inline(text))+'</li>');i++;}output.push('<'+tag+(list[2]?' start="'+Number(list[2])+'"':'')+'>'+items.join('')+'</'+tag+'>');continue;}
    const paragraph=[line];i++;while(i<lines.length&&!block(lines[i])&&!(lines[i].includes('|')&&tableRule(lines[i+1])))paragraph.push(lines[i++]);output.push('<p>'+inline(paragraph.join('\n')).replace(/ {2}\n/g,'<br>').replace(/\n/g,' ')+'</p>');
  }
  return output.join('\n');
}
