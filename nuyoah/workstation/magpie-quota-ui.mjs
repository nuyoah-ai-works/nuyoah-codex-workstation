// Serialized into the renderer; no network or native account writes here.
export function createMagpieQuotaUI({ window: host, selectCodex }) {
  const doc = host.document, id = 'nuyoah-magpie-quota';
  let disposed = false, snapshot = { status: 'loading', accounts: [] }, selected = '';
  let queued = null, pending = null, nextRead = 0, sequence = 0, deadline = 0;
  let expanded = false, motion = null, motionVersion = 0;
  const reduced = host.matchMedia('(prefers-reduced-motion: reduce)');
  const el = (tag, cls, text) => { const n = doc.createElement(tag); n.className = cls || ''; if (text) n.textContent = text; return n; };
  const button = (text, cls, label = text) => { const n = el('button', `${cls || ''} cursor-interaction`, text); n.type = 'button'; n.setAttribute('aria-label', label); return n; };
  const style = el('style');
  style.textContent = `
    #${id},#${id}-panel{--mq-bg:light-dark(#ffffff,#252527);--mq-soft:light-dark(#f5f5f7,#303033);--mq-line:light-dark(#e8e8ed,#3d3d42);--mq-ink:light-dark(#242428,#ededf0);--mq-muted:light-dark(#696970,#b0b0b8);--mq-ease:cubic-bezier(.16,1,.3,1);--mq-green:light-dark(#518363,#88b599);--mq-warn:light-dark(#a16d29,#d2a457);--mq-red:light-dark(#bc4a4a,#ec8989);color:var(--mq-ink);font-family:inherit;font-size:12px;box-sizing:border-box;-webkit-app-region:no-drag}
    #${id}{flex:1 1 160px;min-width:56px;max-width:290px;margin:0 8px;padding:6px 8px;border:1px solid transparent;border-radius:9px;background:transparent;display:flex;align-items:center;gap:6px;text-align:left;line-height:1.25}
    #${id}{transition:background-color 140ms ease,border-color 140ms ease,transform 140ms var(--mq-ease)}
    #${id}:hover,#${id}[aria-expanded=true]{background:var(--mq-soft);border-color:var(--mq-line)}
    #${id}:active{transform:scale(.97)}
    #${id} .mq-chevron{width:12px;height:12px;flex:none;color:var(--mq-muted);transition:transform 240ms var(--mq-ease)}
    #${id}[aria-expanded=true] .mq-chevron{transform:rotate(180deg)}
    #${id}:focus-visible,#${id}-panel button:focus-visible{outline:2px solid var(--mq-green);outline-offset:3px}
    #${id} .mq-lines{display:grid;gap:5px;min-width:0;flex:1}
    #${id} .mq-inline{display:grid;grid-template-columns:minmax(22px,max-content) minmax(12px,1fr) max-content;align-items:center;gap:7px;font-size:11px}
    #${id} .mq-period{max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #${id} .mq-number{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--mq-muted)}
    #${id} .mq-track,#${id}-panel .mq-track{display:block;height:4px;border-radius:4px;background:var(--mq-line);overflow:hidden}
    #${id} .mq-fill,#${id}-panel .mq-fill{display:block;height:100%;border-radius:4px;background:var(--mq-green);transition:width 420ms var(--mq-ease)}
    #${id} .mq-warning,#${id}-panel .mq-warning{background:var(--mq-warn)}
    #${id} .mq-critical,#${id}-panel .mq-critical{background:var(--mq-red)}
    #${id} .mq-status{font-size:11px;color:var(--mq-muted)}
    #${id}[data-narrow=true] .mq-inline{grid-template-columns:1fr max-content;gap:3px}#${id}[data-narrow=true] .mq-track{grid-column:1/-1;grid-row:2}#${id}[data-narrow=true] .mq-prefix{display:none}
    #${id}-panel{position:fixed;inset:auto;margin:0;width:352px;max-width:calc(100vw - 24px);max-height:calc(100vh - 80px);overflow:auto;padding:0;border:1px solid var(--mq-line);border-radius:18px;background:var(--mq-bg);box-shadow:0 16px 44px light-dark(#14161e24,#00000070),0 2px 8px light-dark(#14161e0d,#00000030);transform-origin:top center;z-index:2147483000}
    #${id}-panel::backdrop{background:transparent}#${id}-panel[hidden]{display:none}
    #${id}-panel *{box-sizing:border-box}#${id}-panel button{font:inherit;color:inherit;border:0;background:transparent;cursor:var(--cursor-interaction,pointer);transition:background-color 140ms ease,transform 140ms var(--mq-ease),color 140ms ease}#${id}-panel button:active{transform:scale(.96)}#${id}-panel button[aria-disabled=true]{cursor:default;opacity:.55}
    #${id}-panel .mq-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:16px 16px 14px}#${id}-panel .mq-heading{font-size:14px;font-weight:600}#${id}-panel .mq-actions{display:flex;gap:4px}#${id}-panel .mq-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:8px}#${id}-panel button:hover{background:var(--mq-soft)}
    #${id}-panel .mq-accounts{display:grid;gap:0;padding:0 16px}#${id}-panel .mq-card{padding:14px 0;border-top:1px solid var(--mq-line);background:transparent}
    #${id}-panel .mq-identity{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:12px}#${id}-panel .mq-name{font-size:13px;font-weight:600}#${id}-panel .mq-label{color:var(--mq-muted);font-size:11px;overflow-wrap:anywhere}
    #${id}-panel .mq-select{font-size:11px;border:1px solid var(--mq-line);border-radius:6px;padding:3px 6px;white-space:nowrap}#${id}-panel .mq-selected{color:var(--mq-green);font-size:11px}
    #${id}-panel .mq-quota+.mq-quota{margin-top:12px}#${id}-panel .mq-row{display:flex;justify-content:space-between;gap:12px;margin-bottom:5px}#${id}-panel .mq-row span{overflow-wrap:anywhere}#${id}-panel .mq-row .mq-value{white-space:nowrap;font-variant-numeric:tabular-nums}
    #${id}-panel .mq-reset{font-size:11px;color:var(--mq-muted);margin-top:5px}#${id}-panel .mq-balance{margin-top:10px;font-size:12px}#${id}-panel .mq-status{color:var(--mq-muted);font-size:11px;padding:10px 16px;overflow-wrap:anywhere}#${id}-panel .mq-manage{display:flex;align-items:center;justify-content:space-between;width:calc(100% - 16px);margin:0 8px 8px;padding:11px 8px;border-radius:9px;text-align:left}
    #${id}-panel .mq-symbol{display:block;width:15px;height:15px;flex:none}
    #${id}-panel .mq-icon[data-busy=true] .mq-symbol{animation:mq-spin 800ms linear infinite}
    @keyframes mq-spin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){#${id},#${id} *,#${id}-panel *{transition:none!important;animation:none!important}}
  `;
  doc.head.append(style);
  const trigger = button('', '', 'Codex 额度'); trigger.id = id;
  trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', `${id}-panel`);
  const panel = el('section'); panel.id = `${id}-panel`; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Magpie 额度');
  if (typeof panel.showPopover === 'function') panel.setAttribute('popover', 'manual');
  const header = el('div', 'mq-head'); header.append(el('strong', 'mq-heading', 'Magpie 额度'));
  function icon(path, cls = 'mq-symbol') {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', cls); svg.setAttribute('aria-hidden', 'true');
    const line = doc.createElementNS(svg.namespaceURI, 'path'); line.setAttribute('d', path);
    for (const [key, value] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) line.setAttribute(key, value);
    svg.append(line); return svg;
  }
  const actions = el('div', 'mq-actions'), refresh = button('', 'mq-icon', '刷新额度'), close = button('', 'mq-icon', '关闭额度面板');
  refresh.append(icon('M20 7v5h-5M19 12a7 7 0 1 0-2 5M20 12l-3-5')); close.append(icon('m6 6 12 12M6 18 18 6'));
  actions.append(refresh, close); header.append(actions);
  const cards = el('div', 'mq-accounts'), status = el('div', 'mq-status'), manage = button('账号管理 ↗', 'mq-manage');
  manage.replaceChildren(el('span', '', '账号管理'), icon('M7 17 17 7M7 7h10v10'));
  status.setAttribute('aria-live', 'polite'); panel.append(header, cards, status, manage); doc.body.append(panel);
  function visible(n) { const r = n?.getBoundingClientRect(); return r?.width > 0 && r.height > 0 && host.getComputedStyle(n).visibility !== 'hidden'; }
  function mount() {
    if (disposed) return;
    const mode = [...doc.querySelectorAll('aside button[aria-haspopup="menu"]')].find(n => n.textContent.trim() === 'Codex' && visible(n));
    if (!mode) { trigger.remove(); hide(false, true); return; }
    if (trigger.parentElement !== mode.parentElement) mode.after(trigger);
    const narrow = String(trigger.getBoundingClientRect().width < 145);
    if (trigger.dataset.narrow !== narrow) trigger.dataset.narrow = narrow;
    if (!panel.hidden) position();
  }
  function position() {
    const r = trigger.getBoundingClientRect(), width = Math.min(352, host.innerWidth - 24);
    const left = Math.max(12, Math.min(r.right - width, host.innerWidth - width - 12));
    const top = Math.max(12, Math.min(r.bottom + 9, host.innerHeight - 100));
    panel.style.left = `${left}px`; panel.style.top = `${top}px`;
    panel.style.maxHeight = `${Math.max(60, host.innerHeight - top - 12)}px`;
    panel.style.transformOrigin = `${Math.max(16, Math.min(width - 16, r.left + r.width / 2 - left))}px top`;
  }
  function finishHide() { if (panel.matches(':popover-open')) panel.hidePopover(); panel.hidden = true; panel.inert = false; }
  function animatePanel(opening, immediate = false) {
    const version = ++motionVersion, computed = host.getComputedStyle(panel);
    const from = { opacity: computed.opacity, transform: computed.transform };
    motion?.cancel(); motion = null;
    if (immediate || reduced.matches || !panel.animate) { if (!opening) finishHide(); return; }
    motion = panel.animate([from, { opacity: opening ? 1 : 0, transform: opening ? 'translateY(0) scale(1)' : 'translateY(-4px) scale(.98)' }],
      { duration: opening ? 320 : 140, easing: opening ? 'cubic-bezier(.16,1,.3,1)' : 'ease-in', fill: 'both' });
    motion.finished.then(() => { if (version !== motionVersion) return; if (!opening) finishHide(); motion.cancel(); motion = null; }).catch(() => {});
  }
  function hide(focus = false, immediate = false) {
    if (panel.hidden) return;
    expanded = false; trigger.setAttribute('aria-expanded', 'false'); panel.inert = true;
    if (focus) trigger.focus({ preventScroll: true });
    animatePanel(false, immediate);
  }
  function open() {
    const fresh = panel.hidden; expanded = true; panel.hidden = false; panel.inert = false;
    position(); if (panel.hasAttribute('popover') && !panel.matches(':popover-open')) panel.showPopover();
    if (fresh) { panel.style.opacity = '0'; panel.style.transform = 'translateY(-6px) scale(.96)'; }
    trigger.setAttribute('aria-expanded', 'true'); animatePanel(true);
    panel.style.opacity = ''; panel.style.transform = ''; close.focus({ preventScroll: true });
  }
  function busy(value, action) {
    refresh.setAttribute('aria-disabled', String(value)); manage.setAttribute('aria-disabled', String(value));
    refresh.dataset.busy = String(value && action === 'read');
    cards.setAttribute('aria-busy', String(value && action === 'read'));
  }
  function request(action) {
    if (pending || queued) return;
    queued = { id: ++sequence, action }; deadline = Date.now() + 15_000;
    busy(true, action);
    if (action === 'read') { status.textContent = '正在读取额度…'; }
    else { status.textContent = '正在打开 Magpie…'; }
  }
  function track(used) {
    const bar = el('span', 'mq-track'), fill = el('span', `mq-fill${used >= 95 ? ' mq-critical' : used >= 80 ? ' mq-warning' : ''}`);
    fill.style.width = `${used}%`; bar.append(fill); return bar;
  }
  function reconcile(parent, fresh) {
    const old = [...parent.childNodes], used = new Set();
    let cursor = parent.firstChild;
    for (const node of [...fresh.childNodes]) {
      const key = node.nodeType === 1 ? node.getAttribute('data-key') : null;
      const match = old.find(n => !used.has(n) && n.nodeType === node.nodeType && n.nodeName === node.nodeName &&
        (n.nodeType !== 1 || n.getAttribute('data-key') === key));
      const target = match || node;
      if (match) {
        used.add(match);
        if (node.nodeType === 3) { if (match.data !== node.data) match.data = node.data; }
        else {
          for (const a of [...match.attributes]) if (!node.hasAttribute(a.name)) match.removeAttribute(a.name);
          for (const a of node.attributes) if (match.getAttribute(a.name) !== a.value) match.setAttribute(a.name, a.value);
          match.onclick = node.onclick; reconcile(match, node);
        }
      }
      if (target !== cursor) parent.insertBefore(target, cursor); else cursor = cursor.nextSibling;
    }
    for (const n of old) if (!used.has(n) && n.parentNode === parent) n.remove();
  }
  function render() {
    const current = selectCodex(snapshot.accounts, selected), lines = el('span', 'mq-lines'), triggerContent = el('span');
    triggerContent.append(lines);
    const available = snapshot.status === 'ok' && current && !current.unavailable;
    const windows = available ? current.windows.filter(w => w.used !== null) : [];
    if (windows.length) {
      for (const w of windows.slice(0, 2)) {
        const row = el('span', 'mq-inline'), value = el('span', 'mq-number'); value.append(el('span', 'mq-prefix', '已用 '), `${Math.round(w.used)}%`);
        row.append(el('span', 'mq-period', w.name), track(w.used), value); lines.append(row);
      }
      if (windows.length > 2) triggerContent.append(el('span', 'mq-number', `+${windows.length - 2}`));
      trigger.setAttribute('aria-label', `Codex ${current.label}，${windows.map(w => `${w.name}已用 ${Math.round(w.used)}%`).join('，')}，查看 Magpie 额度`);
    } else {
      const text = snapshot.status === 'loading' ? '额度读取中…' : snapshot.status !== 'ok' || current?.unavailable ? '额度暂不可用' : !current ? snapshot.accounts.some(a => a.provider === 'codex') ? '选择 Codex 账号' : 'Codex 未连接' : '无周期额度数据';
      lines.append(el('span', 'mq-status', text)); trigger.setAttribute('aria-label', `${text}，查看 Magpie 额度`);
    }
    triggerContent.append(icon('m6 9 6 6 6-6', 'mq-chevron')); reconcile(trigger, triggerContent);
    const nextCards = el('div');
    for (const a of snapshot.accounts) {
      const card = el('div', 'mq-card'), identity = el('div', 'mq-identity'), name = el('div');
      card.setAttribute('data-key', a.id);
      name.append(el('div', 'mq-name', a.provider === 'codex' ? 'Codex' : a.name), el('div', 'mq-label', [a.label, a.plan].filter(Boolean).join(' · '))); identity.append(name);
      if (a.provider === 'codex') {
        const chosen = a.id === current?.id, choose = button(chosen ? '已显示' : '顶部显示', 'mq-select');
        choose.setAttribute('aria-pressed', String(chosen)); choose.onclick = () => { selected = a.id; render(); }; identity.append(choose);
      }
      card.append(identity);
      if (a.unavailable) card.append(el('div', 'mq-label', '额度暂不可用'));
      else for (const w of a.windows) {
        const quota = el('div', 'mq-quota'), row = el('div', 'mq-row');
        row.append(el('span', '', w.name), el('span', 'mq-value', w.used === null ? w.display || '暂不可用' : `已用 ${Math.round(w.used)}%`)); quota.append(row);
        if (w.used !== null) quota.append(track(w.used));
        if (w.resetsAt) quota.append(el('div', 'mq-reset', `${new Date(w.resetsAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} 重置`));
        card.append(quota);
      }
      if (a.balance && !a.unavailable) card.append(el('div', 'mq-balance', `余额 ${a.balance}`));
      if (!a.windows.length && !a.balance && !a.unavailable) card.append(el('div', 'mq-label', '暂无额度数据'));
      if (a.readAt) card.append(el('div', 'mq-reset', `数据读取于 ${new Date(a.readAt).toLocaleString('zh-CN')}`));
      nextCards.append(card);
    }
    reconcile(cards, nextCards);
    status.textContent = snapshot.status === 'loading' ? '正在读取额度…' : snapshot.status !== 'ok' ? '无法连接 Magpie，请确认应用已启动。已有数据可能过期。' : !snapshot.accounts.length ? 'Magpie 暂无账号额度' : '由 Magpie 提供 · 每分钟更新';
  }
  trigger.onclick = () => { if (!expanded) open(); else hide(true); };
  close.onclick = () => hide(true); refresh.onclick = () => request('read'); manage.onclick = () => request('open');
  const outside = e => { if (expanded && !panel.contains(e.target) && !trigger.contains(e.target)) hide(); };
  const keydown = e => { if (!expanded) return; if (e.key === 'Escape') { hide(true); e.stopPropagation(); e.preventDefault(); }
    if (e.key === 'Tab') { const focusable = [...panel.querySelectorAll('button:not(:disabled)')]; const first = focusable[0], last = focusable.at(-1); if (e.shiftKey && doc.activeElement === first) { last.focus(); e.preventDefault(); } else if (!e.shiftKey && doc.activeElement === last) { first.focus(); e.preventDefault(); } }
  };
  doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', keydown, true);
  render(); mount(); const timer = host.setInterval(mount, 1000);
  return {
    takeRequest() {
      if (disposed) return null;
      if ((pending || queued) && Date.now() > deadline) { pending = queued = null; nextRead = Date.now() + 60_000; snapshot = { ...snapshot, status: 'unavailable' }; busy(false); render(); }
      if (doc.visibilityState === 'hidden' || !visible(trigger) || !trigger.isConnected) return null;
      if (!pending && !queued && Date.now() >= nextRead) request('read');
      if (!queued || pending) return null;
      pending = queued; queued = null; return pending;
    },
    receive(response) {
      if (disposed || response.id !== pending?.id) return;
      const action = pending.action; pending = null; busy(false);
      if (action === 'read') { snapshot = response.data; nextRead = Date.now() + 60_000; render(); }
      else status.textContent = response.data.status === 'opened' ? '已打开 Magpie' : '无法打开 Magpie，请确认已安装。';
    },
    destroy() { disposed = true; host.clearInterval(timer); hide(false, true); trigger.remove(); panel.remove(); style.remove(); doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', keydown, true); },
  };
}
