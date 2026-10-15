import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
const execute = promisify(execFile);

export async function readGrokBotIcon() {
  try {
    const file = '/Applications/Grok Bot.app/Contents/Resources/icon.icns';
    if ((await stat(file)).size > 1024 * 1024) return '';
    const bytes = await readFile(file);
    if (bytes.toString('ascii', 0, 4) !== 'icns') return '';
    for (let i = 8; i + 8 <= bytes.length;) {
      const length = bytes.readUInt32BE(i + 4);
      if (length < 8 || i + length > bytes.length) return '';
      if (bytes.toString('ascii', i, i + 4) === 'ic11' && length < 32768 && bytes.subarray(i + 8, i + 16).toString('hex') === '89504e470d0a1a0a') {
        return `data:image/png;base64,${bytes.subarray(i + 8, i + length).toString('base64')}`;
      }
      i += length;
    }
  } catch {}
  return '';
}

export async function openGrokBot(executeImpl = execute) {
  try {
    await executeImpl('/usr/bin/open', ['-b', 'com.anysphere.sand'], { timeout: 5000, maxBuffer: 4096 });
    return { ok: true };
  } catch { return { ok: false }; }
}

// Serialized into the renderer. Leave React-owned nodes in their original parent.
export function createAppShortcuts({ window: host, iconUrl = '' }) {
  const doc = host.document, id = 'nuyoah-grok-shortcut';
  let parent, orbit, queued = null, pending = null, sequence = 0, deadline = 0, disposed = false;
  const style = doc.createElement('style');
  style.textContent = `
    [data-nuyoah-app-shortcuts]{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:8px!important}
    [data-nuyoah-app-shortcuts]>:not([data-nuyoah-orbit-shortcut]):not(#${id}){grid-column:1/-1}
    [data-nuyoah-app-shortcuts]>[data-nuyoah-orbit-shortcut],#${id}{grid-column:auto;min-width:0;width:100%;height:44px!important;margin:5px 0 8px;padding:0 12px!important;border:1px solid light-dark(#e0e5e480,#ffffff10)!important;border-radius:13px!important;background:light-dark(#ffffffa6,#ffffff07)!important;box-shadow:0 1px 2px light-dark(#1e302908,#00000010);transition:background .15s,border-color .15s;box-sizing:border-box}
    [data-nuyoah-app-shortcuts]>[data-nuyoah-orbit-shortcut]:hover,#${id}:hover{background:light-dark(#ffffff,#ffffff10)!important;border-color:light-dark(#d6dedb,#ffffff20)!important}
    [data-nuyoah-orbit-shortcut]>div{font-size:14px!important;gap:9px!important;font-weight:500}
    [data-nuyoah-orbit-shortcut] .icon-leading-slot{width:24px;min-width:24px}
    [data-nuyoah-orbit-shortcut]>span:last-child span{font-size:11px!important}
    #${id}{-webkit-app-region:no-drag;display:flex;align-items:center;gap:9px;font:inherit;font-size:14px;font-weight:500;color:inherit;text-align:left;cursor:var(--cursor-interaction,default)}
    #${id} .grok-icon{display:inline-grid;place-items:center;width:24px;height:24px;flex:none;font-size:17px;font-weight:400;object-fit:contain;border-radius:6px}
    #${id} .grok-arrow{margin-left:auto;color:light-dark(#8d9792,#98a49c);font-size:13px;font-weight:400}
    #${id} .grok-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #${id}[data-error=true]{color:light-dark(#aa3636,#ed9696)}
    @media(prefers-reduced-motion:reduce){[data-nuyoah-orbit-shortcut],#${id}{transition:none!important}}
  `;
  const button = doc.createElement('button'); button.id = id; button.type = 'button'; button.setAttribute('aria-label', '打开 Grok Bot');
  const hasIcon = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(iconUrl) && iconUrl.length < 45000;
  const icon = doc.createElement(hasIcon ? 'img' : 'span'); icon.className = 'grok-icon'; icon.setAttribute('aria-hidden','true');
  if (hasIcon) { icon.src = iconUrl; icon.alt = ''; } else icon.textContent = '↗';
  const label = doc.createElement('span'); label.className = 'grok-label'; label.textContent = 'Grok Bot';
  const arrow = doc.createElement('span'); arrow.className = 'grok-arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden','true');
  button.append(icon, label, arrow);
  function restore() { parent?.removeAttribute('data-nuyoah-app-shortcuts'); orbit?.removeAttribute('data-nuyoah-orbit-shortcut'); button.remove(); parent = orbit = null; }
  function sync() {
    if (disposed) return;
    const next = [...doc.querySelectorAll('aside button[data-sidebar-destination="builtin:orbit"]')].find(n => !n.closest('[data-app-navigation-rail]') && n.getBoundingClientRect().width > 0);
    if (!next) { restore(); return; }
    if (next !== orbit || next.parentElement !== parent) {
      restore(); orbit = next; parent = next.parentElement;
      button.className = `${next.className} cursor-interaction`;
      parent.setAttribute('data-nuyoah-app-shortcuts',''); orbit.setAttribute('data-nuyoah-orbit-shortcut','');
    }
    if (button.previousElementSibling !== orbit) orbit.after(button);
    if (pending && Date.now() > deadline) receive({ id: pending.id, ok: false });
  }
  function receive(response) {
    if (disposed || response.id !== pending?.id) return;
    pending = null; button.disabled = false; label.textContent = 'Grok Bot';
    button.dataset.error = String(!response.ok);
    button.setAttribute('aria-label', response.ok ? '打开 Grok Bot' : '未能打开 Grok Bot，请确认已安装，点击重试');
    button.title = response.ok ? '打开 Grok Bot' : '未能打开，请确认已安装';
    if (!response.ok) label.textContent = 'Grok Bot · 打开失败';
  }
  button.onclick = () => { if (pending || queued) return; queued = { id: ++sequence }; button.disabled = true; label.textContent = '正在打开…'; };
  doc.head.append(style); sync(); const timer = host.setInterval(sync, 1000);
  return {
    takeRequest() { if (disposed || !queued || pending) return null; pending = queued; queued = null; deadline = Date.now() + 10000; return pending; },
    receive,
    destroy() { disposed = true; host.clearInterval(timer); restore(); style.remove(); },
  };
}
