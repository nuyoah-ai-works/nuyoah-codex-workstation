// Serialized into the renderer. Only names and read timestamps cross the bridge.
export function createSkillTimeline({ window, document }) {
  const queue = [];
  let context = {}, key = '', pending = null, timer = null, lastRead = 0, data = null, count = 100, disposed = false;
  const node = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; return el; };
  const button = node('button', '⋯'); button.type = 'button'; button.id = 'nuyoah-skill-timeline-trigger';
  button.title = '当前会话的 Skill 调用记录'; button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'nuyoah-skill-timeline'); button.hidden = true;
  const panel = node('section'); panel.id = 'nuyoah-skill-timeline'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'nuyoah-skill-timeline-title');
  const heading = node('div'); heading.className = 'nuyoah-timeline-heading';
  const title = node('strong', 'Skill 调用记录'); title.id = 'nuyoah-skill-timeline-title';
  const refresh = node('button', '刷新'); refresh.type = 'button';
  const closeButton = node('button', '×'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', '关闭 Skill 调用记录');
  heading.append(title, refresh, closeButton);
  const subtitle = node('p'); subtitle.className = 'nuyoah-timeline-subtitle';
  const status = node('p'); status.setAttribute('role', 'status');
  const more = node('button', '显示更早记录'); more.type = 'button'; more.hidden = true;
  const list = node('ol'); list.setAttribute('aria-label', 'Skill 读取时间线，按时间顺序');
  panel.append(heading, subtitle, status, more, list);
  const style = node('style'); style.id = 'nuyoah-skill-timeline-style';
  style.textContent = `
#nuyoah-skill-timeline-trigger[hidden],#nuyoah-skill-timeline[hidden],#nuyoah-skill-timeline [hidden]{display:none!important}
#nuyoah-skill-timeline-trigger{position:fixed;z-index:50;width:30px;height:28px;display:flex;align-items:center;justify-content:center;border:0;border-radius:7px;background:transparent;color:var(--color-token-text-primary,CanvasText);font:22px/1 system-ui;cursor:pointer;-webkit-app-region:no-drag}
#nuyoah-skill-timeline-trigger:hover,#nuyoah-skill-timeline-trigger[aria-expanded=true]{background:color-mix(in srgb,currentColor 8%,transparent)}
#nuyoah-skill-timeline{position:fixed;z-index:10000;box-sizing:border-box;width:360px;overflow:auto;padding:14px 16px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:12px;background:var(--color-token-main-surface-primary,Canvas);color:var(--color-token-text-primary,CanvasText);box-shadow:0 10px 35px #0002;font:13px/1.5 system-ui;-webkit-app-region:no-drag;color-scheme:light dark}
#nuyoah-skill-timeline .nuyoah-timeline-heading{display:flex;align-items:center;gap:6px}
#nuyoah-skill-timeline .nuyoah-timeline-heading strong{margin-right:auto;font-size:14px;font-weight:600}
#nuyoah-skill-timeline button{border:0;border-radius:6px;background:transparent;color:inherit;padding:5px 8px;font:inherit;cursor:pointer}
#nuyoah-skill-timeline button:hover{background:color-mix(in srgb,currentColor 7%,transparent)}
#nuyoah-skill-timeline button:focus-visible,#nuyoah-skill-timeline-trigger:focus-visible{outline:2px solid var(--color-token-accent-foreground,Highlight);outline-offset:2px}
#nuyoah-skill-timeline .nuyoah-timeline-subtitle{margin:4px 0 10px;overflow-wrap:anywhere;color:var(--color-token-text-secondary,GrayText)}
#nuyoah-skill-timeline [role=status]{margin:6px 0 16px;color:var(--color-token-text-secondary,GrayText);font-size:12px}
#nuyoah-skill-timeline ol{margin:10px 0 0 5px;padding:0;list-style:none}
#nuyoah-skill-timeline li{position:relative;margin:0;padding:0 0 20px 19px;border-left:1px solid color-mix(in srgb,currentColor 22%,transparent)}
#nuyoah-skill-timeline li:last-child{padding-bottom:3px;border-left-color:transparent}
#nuyoah-skill-timeline li:before{content:'';position:absolute;left:-4px;top:6px;width:7px;height:7px;border-radius:50%;background:var(--color-token-text-secondary,GrayText)}
#nuyoah-skill-timeline li strong{display:block;font-weight:550;overflow-wrap:anywhere}
#nuyoah-skill-timeline time{display:block;margin-top:3px;font-size:12px;color:var(--color-token-text-secondary,GrayText)}
`;
  document.head.append(style); document.body.append(button, panel);
  function close(restoreFocus = false) {
    if (!panel.hidden) panel.hidden = true;
    if (button.getAttribute('aria-expanded') !== 'false') button.setAttribute('aria-expanded', 'false');
    pending = null; clearTimeout(timer); queue.length = 0;
    if (restoreFocus && !button.hidden) button.focus({ preventScroll: true });
  }
  function anchor() {
    const title = String(context.threadTitle || '').trim(); if (!context.threadId || !title) return null;
    for (const header of document.querySelectorAll('header')) {
      if (header.closest('[data-nuyoah-workstation-frame], [data-nuyoah-workstation-header], aside')) continue;
      const rect = header.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.top < -1 || rect.top > 100) continue;
      const candidates = [...header.querySelectorAll('button, [role="button"], span, h1, h2')].filter(el =>
        el.textContent.trim() === title && el.getBoundingClientRect().width > 0);
      const el = candidates.sort((a,b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
      if (el) return { el, header };
    }
    return null;
  }
  function position() {
    const target = anchor();
    if (!target) { if (!button.hidden) button.hidden = true; close(); return; }
    const r = target.el.getBoundingClientRect(), h = target.header.getBoundingClientRect();
    const left = r.right + 6;
    // Never put this control over an existing native action.
    const collision = [...target.header.querySelectorAll('button,[role="button"]')].some(el => {
      if (el.contains(target.el)) return false;
      const b = el.getBoundingClientRect(); return b.width > 0 && b.left < left + 30 && b.right > left;
    });
    if (collision || left + 30 > h.right || left + 30 > window.innerWidth) { if (!button.hidden) button.hidden = true; close(); return; }
    if (button.hidden) button.hidden = false;
    const set = (el, name, value) => { if (el.style[name] !== value) el.style[name] = value; };
    set(button, 'left', `${left}px`); set(button, 'top', `${Math.max(h.top, r.top + (r.height - 28) / 2)}px`);
    if (!panel.hidden) {
      const width = Math.min(360, window.innerWidth - 24), top = h.bottom + 6;
      set(panel, 'width', `${width}px`); set(panel, 'left', `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`);
      set(panel, 'top', `${top}px`); set(panel, 'maxHeight', `${Math.max(100, window.innerHeight - top - 12)}px`);
    }
  }
  function request() {
    if (panel.hidden || pending) return;
    if (context.hostId !== 'local') { lastRead = Date.now(); status.textContent = '远程会话的 Skill 记录暂不可核对。'; return; }
    const id = window.crypto.randomUUID(); pending = id; lastRead = Date.now();
    status.textContent = data ? '正在更新…' : '正在核对读取记录…';
    queue.push({ id, action: 'skills:history', scope: 'task', threadId: context.threadId, hostId: context.hostId, consumer: 'timeline' });
    timer = setTimeout(() => { if (pending === id) { pending = null; status.textContent = '核对超时，请刷新重试。'; } }, 18000);
  }
  function render() {
    const events = data?.events || [], visible = events.slice(-count);
    status.textContent = data?.status === 'unavailable' ? '暂时无法核对，请刷新重试。'
      : `${data?.status === 'partial' ? '部分记录 · ' : ''}${events.length} 次读取${events.length > count ? ` · 当前显示最近 ${visible.length} 条` : ''}`;
    more.hidden = events.length <= count;
    list.replaceChildren(...visible.map(event => {
      const li = node('li'); li.append(node('strong', event.name));
      const time = node('time', `${new Date(event.readAt).toLocaleString('zh-CN', { hour12: false })} · 已读取`); time.dateTime = event.readAt;
      li.append(time); return li;
    }));
    if (!events.length && data?.status !== 'unavailable') status.textContent = data?.status === 'partial' ? '已核对的部分记录中未发现 Skill 读取。' : '本会话尚未发现 Skill 读取记录。';
  }
  button.onclick = () => {
    if (!panel.hidden) { close(); return; }
    panel.hidden = false; button.setAttribute('aria-expanded', 'true');
    subtitle.textContent = context.threadTitle; position();
    if (panel.hidden) return;
    if (data) render(); request(); closeButton.focus({ preventScroll: true });
  };
  closeButton.onclick = () => close(true); refresh.onclick = request;
  more.onclick = () => { const before = panel.scrollHeight; count += 100; render(); panel.scrollTop += panel.scrollHeight - before; };
  const outside = event => { if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) close(); };
  const keyboard = event => {
    if (panel.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); }
    else if (event.key === 'Tab') {
      const controls = [refresh, closeButton, ...(!more.hidden ? [more] : [])];
      const i = controls.indexOf(document.activeElement);
      if (event.shiftKey && i <= 0) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && (i < 0 || i === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
    }
  };
  document.addEventListener('pointerdown', outside, true); window.addEventListener('keydown', keyboard, true);
  window.addEventListener('resize', position);
  const poll = setInterval(() => { if (!panel.hidden && !pending && Date.now() - lastRead >= 10000) request(); }, 1500);
  return {
    sync(next) {
      if (disposed) return;
      const nextKey = `${next.hostId || 'local'}/${next.threadId || ''}`;
      if (nextKey !== key) { close(); data = null; list.replaceChildren(); count = 100; key = nextKey; }
      context = { ...next, hostId: next.hostId || 'local' };
      if (!panel.hidden && subtitle.textContent !== context.threadTitle) subtitle.textContent = context.threadTitle;
      position();
    },
    takeRequest: () => queue.shift() || null,
    receive(result) {
      if (!pending || pending !== result.id || panel.hidden) return;
      clearTimeout(timer); pending = null; lastRead = Date.now(); data = result.skillHistory;
      render();
    },
    destroy() {
      disposed = true; close(); clearInterval(poll);
      document.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', keyboard, true); window.removeEventListener('resize', position);
      button.remove(); panel.remove(); style.remove();
    },
  };
}
