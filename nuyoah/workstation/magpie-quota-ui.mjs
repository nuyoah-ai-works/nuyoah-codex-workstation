// Serialized into the renderer; no network or native account writes here.
export function createMagpieQuotaUI({ window: host, selectCodex }) {
  const doc = host.document, id = 'nuyoah-magpie-quota';
  let disposed = false, snapshot = { status: 'loading', accounts: [] }, selected = '';
  let queued = null, pending = null, nextRead = 0, sequence = 0, deadline = 0;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); n.className = cls || ''; if (text) n.textContent = text; return n; };
  const button = (text, cls, label = text) => { const n = el('button', `${cls || ''} cursor-interaction`, text); n.type = 'button'; n.setAttribute('aria-label', label); return n; };
  const style = el('style');
  style.textContent = `
    #${id},#${id}-panel{--mq-bg:light-dark(#ffffff,#272a28);--mq-soft:light-dark(#f3f5f3,#303531);--mq-line:light-dark(#e4e9e5,#434b45);--mq-ink:light-dark(#27312b,#e5ece7);--mq-muted:light-dark(#67756c,#afbbb2);--mq-green:light-dark(#518363,#88b599);--mq-warn:light-dark(#a16d29,#d2a457);--mq-red:light-dark(#bc4a4a,#ec8989);color:var(--mq-ink);font-family:inherit;font-size:12px;box-sizing:border-box;-webkit-app-region:no-drag}
    #${id}{flex:1 1 160px;min-width:56px;max-width:290px;margin:0 8px;padding:4px 6px;border:0;border-radius:7px;background:transparent;display:flex;align-items:center;gap:6px;text-align:left;line-height:1.25}
    #${id}:hover{background:var(--mq-soft)}
    #${id} .mq-lines{display:grid;gap:5px;min-width:0;flex:1}
    #${id} .mq-inline{display:grid;grid-template-columns:minmax(22px,max-content) minmax(12px,1fr) max-content;align-items:center;gap:7px;font-size:11px}
    #${id} .mq-period{max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #${id} .mq-number{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--mq-muted)}
    #${id} .mq-track,#${id}-panel .mq-track{display:block;height:4px;border-radius:4px;background:var(--mq-line);overflow:hidden}
    #${id} .mq-fill,#${id}-panel .mq-fill{display:block;height:100%;border-radius:4px;background:var(--mq-green)}
    #${id} .mq-warning,#${id}-panel .mq-warning{background:var(--mq-warn)}
    #${id} .mq-critical,#${id}-panel .mq-critical{background:var(--mq-red)}
    #${id} .mq-status{font-size:11px;color:var(--mq-muted)}
    #${id}[data-narrow=true] .mq-inline{grid-template-columns:1fr max-content;gap:3px}#${id}[data-narrow=true] .mq-track{grid-column:1/-1;grid-row:2}#${id}[data-narrow=true] .mq-prefix{display:none}
    #${id}-panel{position:fixed;inset:auto;margin:0;width:350px;max-width:calc(100vw - 24px);max-height:calc(100vh - 80px);overflow:auto;padding:0;border:1px solid var(--mq-line);border-radius:18px;background:var(--mq-bg);box-shadow:0 14px 45px light-dark(#20342a26,#00000060);z-index:2147483000}
    #${id}-panel::backdrop{background:transparent}#${id}-panel[hidden]{display:none}
    #${id}-panel *{box-sizing:border-box}#${id}-panel button{font:inherit;color:inherit;border:0;background:transparent;cursor:var(--cursor-interaction,default)}
    #${id}-panel .mq-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px 10px}#${id}-panel .mq-heading{font-size:14px;font-weight:600}#${id}-panel .mq-actions{display:flex;gap:4px}#${id}-panel .mq-icon{min-width:28px;min-height:28px;border-radius:6px}#${id}-panel button:hover{background:var(--mq-soft)}
    #${id}-panel .mq-accounts{display:grid;gap:8px;padding:0 12px}#${id}-panel .mq-card{padding:12px;border:1px solid var(--mq-line);border-radius:12px;background:var(--mq-soft)}
    #${id}-panel .mq-identity{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:12px}#${id}-panel .mq-name{font-size:13px;font-weight:500}#${id}-panel .mq-label{color:var(--mq-muted);font-size:11px;overflow-wrap:anywhere}
    #${id}-panel .mq-select{font-size:11px;border:1px solid var(--mq-line);border-radius:6px;padding:3px 6px;white-space:nowrap}#${id}-panel .mq-selected{color:var(--mq-green);font-size:11px}
    #${id}-panel .mq-quota+.mq-quota{margin-top:12px}#${id}-panel .mq-row{display:flex;justify-content:space-between;gap:12px;margin-bottom:5px}#${id}-panel .mq-row span{overflow-wrap:anywhere}#${id}-panel .mq-row .mq-value{white-space:nowrap;font-variant-numeric:tabular-nums}
    #${id}-panel .mq-reset{font-size:11px;color:var(--mq-muted);margin-top:5px}#${id}-panel .mq-balance{margin-top:10px;font-size:12px}#${id}-panel .mq-status{color:var(--mq-muted);font-size:11px;padding:10px 16px;overflow-wrap:anywhere}#${id}-panel .mq-manage{display:flex;justify-content:space-between;width:100%;padding:13px 16px;border-top:1px solid var(--mq-line);text-align:left}
  `;
  doc.head.append(style);
  const trigger = button('', '', 'Codex 额度'); trigger.id = id;
  trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', `${id}-panel`);
  const panel = el('section'); panel.id = `${id}-panel`; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Magpie 额度');
  if (typeof panel.showPopover === 'function') panel.setAttribute('popover', 'manual');
  const header = el('div', 'mq-head'); header.append(el('strong', 'mq-heading', 'Magpie 额度'));
  const actions = el('div', 'mq-actions'), refresh = button('↻', 'mq-icon', '刷新额度'), close = button('×', 'mq-icon', '关闭额度面板');
  actions.append(refresh, close); header.append(actions);
  const cards = el('div', 'mq-accounts'), status = el('div', 'mq-status'), manage = button('账号管理 ↗', 'mq-manage');
  status.setAttribute('aria-live', 'polite'); panel.append(header, cards, status, manage); doc.body.append(panel);
  function visible(n) { const r = n?.getBoundingClientRect(); return r?.width > 0 && r.height > 0 && host.getComputedStyle(n).visibility !== 'hidden'; }
  function mount() {
    if (disposed) return;
    const mode = [...doc.querySelectorAll('aside button[aria-haspopup="menu"]')].find(n => n.textContent.trim() === 'Codex' && visible(n));
    if (!mode) { trigger.remove(); hide(false); return; }
    if (trigger.parentElement !== mode.parentElement) mode.after(trigger);
    const narrow = String(trigger.getBoundingClientRect().width < 145);
    if (trigger.dataset.narrow !== narrow) trigger.dataset.narrow = narrow;
    if (!panel.hidden) position();
  }
  function position() { const r = trigger.getBoundingClientRect(); panel.style.left = `${Math.max(12, Math.min(r.right - Math.min(350, host.innerWidth - 24), host.innerWidth - 362))}px`; panel.style.top = `${Math.min(r.bottom + 9, host.innerHeight - 120)}px`; }
  function hide(focus = false) { if (!panel.hidden) { if (panel.matches(':popover-open')) panel.hidePopover(); panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (focus) trigger.focus(); } }
  function open() { panel.hidden = false; position(); if (panel.hasAttribute('popover')) panel.showPopover(); trigger.setAttribute('aria-expanded', 'true'); close.focus(); }
  function request(action) {
    if (pending || queued) return;
    queued = { id: ++sequence, action }; deadline = Date.now() + 15_000;
    refresh.disabled = manage.disabled = true;
    if (action === 'read') { refresh.disabled = true; status.textContent = '正在读取额度…'; }
    else { manage.disabled = true; status.textContent = '正在打开 Magpie…'; }
  }
  function track(used) {
    const bar = el('span', 'mq-track'), fill = el('span', `mq-fill${used >= 95 ? ' mq-critical' : used >= 80 ? ' mq-warning' : ''}`);
    fill.style.width = `${used}%`; bar.append(fill); return bar;
  }
  function render() {
    const current = selectCodex(snapshot.accounts, selected), lines = el('span', 'mq-lines');
    trigger.replaceChildren(lines);
    const available = snapshot.status === 'ok' && current && !current.unavailable;
    const windows = available ? current.windows.filter(w => w.used !== null) : [];
    if (windows.length) {
      for (const w of windows.slice(0, 2)) {
        const row = el('span', 'mq-inline'), value = el('span', 'mq-number'); value.append(el('span', 'mq-prefix', '已用 '), `${Math.round(w.used)}%`);
        row.append(el('span', 'mq-period', w.name), track(w.used), value); lines.append(row);
      }
      trigger.append(el('span', '', windows.length > 2 ? `+${windows.length - 2} ▾` : '▾'));
      trigger.setAttribute('aria-label', `Codex ${current.label}，${windows.map(w => `${w.name}已用 ${Math.round(w.used)}%`).join('，')}，查看 Magpie 额度`);
    } else {
      const text = snapshot.status === 'loading' ? '额度读取中…' : snapshot.status !== 'ok' || current?.unavailable ? '额度暂不可用' : !current ? snapshot.accounts.some(a => a.provider === 'codex') ? '选择 Codex 账号' : 'Codex 未连接' : '无周期额度数据';
      lines.append(el('span', 'mq-status', text)); trigger.setAttribute('aria-label', `${text}，查看 Magpie 额度`);
    }
    cards.replaceChildren();
    for (const a of snapshot.accounts) {
      const card = el('div', 'mq-card'), identity = el('div', 'mq-identity'), name = el('div');
      name.append(el('div', 'mq-name', a.provider === 'codex' ? 'Codex' : a.name), el('div', 'mq-label', [a.label, a.plan].filter(Boolean).join(' · '))); identity.append(name);
      if (a.provider === 'codex') {
        if (a.id === current?.id) identity.append(el('span', 'mq-selected', '顶部显示'));
        else { const choose = button('顶部显示', 'mq-select'); choose.onclick = () => { selected = a.id; render(); }; identity.append(choose); }
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
      cards.append(card);
    }
    status.textContent = snapshot.status === 'loading' ? '正在读取额度…' : snapshot.status !== 'ok' ? '无法连接 Magpie，请确认应用已启动。已有数据可能过期。' : !snapshot.accounts.length ? 'Magpie 暂无账号额度' : '由 Magpie 提供 · 每分钟更新';
  }
  trigger.onclick = () => { if (panel.hidden) open(); else hide(); };
  close.onclick = () => hide(true); refresh.onclick = () => request('read'); manage.onclick = () => request('open');
  const outside = e => { if (!panel.hidden && !panel.contains(e.target) && !trigger.contains(e.target)) hide(); };
  const keydown = e => { if (panel.hidden) return; if (e.key === 'Escape') { hide(true); e.stopPropagation(); e.preventDefault(); }
    if (e.key === 'Tab') { const focusable = [...panel.querySelectorAll('button:not(:disabled)')]; const first = focusable[0], last = focusable.at(-1); if (e.shiftKey && doc.activeElement === first) { last.focus(); e.preventDefault(); } else if (!e.shiftKey && doc.activeElement === last) { first.focus(); e.preventDefault(); } }
  };
  doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', keydown, true);
  render(); mount(); const timer = host.setInterval(mount, 1000);
  return {
    takeRequest() {
      if (disposed) return null;
      if ((pending || queued) && Date.now() > deadline) { pending = queued = null; nextRead = Date.now() + 60_000; snapshot = { ...snapshot, status: 'unavailable' }; refresh.disabled = manage.disabled = false; render(); }
      if (doc.visibilityState === 'hidden' || !visible(trigger) || !trigger.isConnected) return null;
      if (!pending && !queued && Date.now() >= nextRead) request('read');
      if (!queued || pending) return null;
      pending = queued; queued = null; return pending;
    },
    receive(response) {
      if (disposed || response.id !== pending?.id) return;
      const action = pending.action; pending = null; refresh.disabled = manage.disabled = false;
      if (action === 'read') { snapshot = response.data; nextRead = Date.now() + 60_000; render(); }
      else status.textContent = response.data.status === 'opened' ? '已打开 Magpie' : '无法打开 Magpie，请确认已安装。';
    },
    destroy() { disposed = true; host.clearInterval(timer); hide(); trigger.remove(); panel.remove(); style.remove(); doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', keydown, true); },
  };
}
