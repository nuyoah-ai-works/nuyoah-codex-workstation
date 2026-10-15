// Presentation only: no navigation, task reads, requests or saved preferences.
export function createInteractionTheme({ window: host, css = '', frame = false }) {
  const doc = host.document, reduced = host.matchMedia('(prefers-reduced-motion: reduce)');
  const tabsSelector = '.nc-tabs,.nuyoah-workstation-tabs,.codex-live-view-tabs';
  const pageSelector = '#nuyoah-workstation-project-page,#codex-skill-organizer,#codex-taskboard-page,#codex-asset-console-page';
  const tabGroups = new Set(), queued = new Set(), last = new Map(), motions = new Map(), folds = new Map();
  let disposed = false, frameId = 0;
  const style = css ? doc.createElement('style') : null;
  if (style) { style.id = 'nuyoah-interaction-theme'; style.textContent = css; doc.head.append(style); }
  if (frame) doc.body.classList.add('nw-frame');
  function animate(node, keyframes, options, finish = () => {}) {
    motions.get(node)?.animation.cancel(); motions.delete(node);
    if (disposed || reduced.matches || !node.animate) { finish(); return; }
    const animation = node.animate(keyframes, options), entry = { animation, finish };
    motions.set(node, entry);
    animation.finished.then(() => {
      if (motions.get(node) !== entry) return;
      motions.delete(node); finish(); animation.cancel();
    }).catch(() => {});
  }
  function indicator(group) {
    if (!group.isConnected) { tabGroups.delete(group); resize.unobserve(group); return; }
    if (!group.getClientRects().length) return;
    const selected = group.querySelector(':scope > button[aria-pressed="true"],:scope > button[aria-selected="true"]');
    if (!selected) return;
    group.setAttribute('data-nw-indicator', 'true');
    const next = { x: selected.offsetLeft, y: selected.offsetTop, width: selected.offsetWidth, height: selected.offsetHeight };
    if (!next.width) return;
    const kind = group.classList.contains('nuyoah-workstation-tabs') ? 'workstation' : group;
    const prior = last.get(kind);
    const apply = (values) => { for (const [key, value] of Object.entries(values)) {
      const name = `--nw-tab-${key}`, text = `${value}px`;
      if (group.style.getPropertyValue(name) !== text) group.style.setProperty(name, text);
    } };
    // Separate module headers share the same selection position. Animate only the
    // pseudo-element, never transform the live page or its native mount contexts.
    if (prior && prior.group !== group && !reduced.matches) {
      apply(prior.value); group.getBoundingClientRect();
    }
    apply(next); last.set(kind, { group, value: next });
  }
  function queue(group) {
    if (!group || disposed) return; queued.add(group);
    if (!frameId) frameId = host.requestAnimationFrame(() => { frameId = 0; for (const item of queued) indicator(item); queued.clear(); });
  }
  const resize = new host.ResizeObserver(entries => { for (const e of entries) queue(e.target); });
  function register(group) {
    if (!tabGroups.has(group)) { tabGroups.add(group); resize.observe(group); }
    queue(group);
  }
  function enter(page) {
    if (page.hidden || !page.getClientRects().length) return;
    const content = page.querySelector('.nuyoah-project-overview-body,.codex-skill-grid');
    if (content) animate(content, [{ opacity: .5, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' });
    page.querySelectorAll(tabsSelector).forEach(register);
  }
  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches(tabsSelector)) register(node);
    node.querySelectorAll(tabsSelector).forEach(register);
    if (node.matches(pageSelector)) enter(node);
  }
  const observer = new host.MutationObserver(records => {
    if (disposed) return;
    for (const record of records) {
      if (record.type === 'attributes') {
        const group = record.target.closest(tabsSelector); if (group) queue(group);
        if (record.attributeName === 'hidden' && record.target.matches(pageSelector)) enter(record.target);
      } else {
        const group = record.target.closest?.(tabsSelector); if (group) queue(group);
        for (const node of record.addedNodes) scan(node);
      }
    }
    for (const group of tabGroups) if (!group.isConnected) { resize.unobserve(group); tabGroups.delete(group); last.delete(group); }
    for (const [node, record] of motions) if (!node.isConnected) { record.animation.cancel(); record.finish(); motions.delete(node); }
    for (const node of folds.keys()) if (!node.isConnected) folds.delete(node);
  });
  doc.querySelectorAll(tabsSelector).forEach(register);
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden','aria-pressed','aria-selected'] });
  const settle = () => {
    if (!reduced.matches) return;
    for (const { animation, finish } of motions.values()) { animation.cancel(); finish(); }
    motions.clear();
  };
  reduced.addEventListener('change', settle);
  return {
    // Fold only an owned sidebar group. Inert while closing prevents invisible
    // actions receiving focus; a new click reverses from the currently drawn size.
    setVisible(node, visible) {
      if (disposed) return false;
      let record = folds.get(node);
      if (!record) { record = { visible: !node.hidden, overflow: node.style.overflow, inert: node.inert }; folds.set(node, record); }
      if (record.visible === visible) return true;
      record.visible = visible;
      const fromHeight = node.getBoundingClientRect().height, opacity = node.hidden ? 0 : host.getComputedStyle(node).opacity;
      motions.get(node)?.animation.cancel(); motions.delete(node);
      node.hidden = false; node.inert = !visible; node.style.overflow = 'hidden';
      const height = node.getBoundingClientRect().height;
      const finish = () => { node.hidden = !record.visible; node.inert = record.inert; node.style.overflow = record.overflow; };
      animate(node, [{ height: `${fromHeight}px`, opacity }, { height: `${visible ? height : 0}px`, opacity: visible ? 1 : 0 }],
        { duration: visible ? 260 : 180, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }, finish);
      return true;
    },
    destroy() {
      disposed = true; observer.disconnect(); resize.disconnect(); host.cancelAnimationFrame(frameId);
      reduced.removeEventListener('change', settle);
      for (const { animation, finish } of motions.values()) { animation.cancel(); finish(); }
      motions.clear(); folds.clear();
      for (const group of tabGroups) { group.removeAttribute('data-nw-indicator'); for (const key of ['x','y','width','height']) group.style.removeProperty(`--nw-tab-${key}`); }
      tabGroups.clear(); queued.clear(); last.clear(); style?.remove(); if (frame) doc.body.classList.remove('nw-frame');
    },
  };
}
