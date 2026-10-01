(() => {
  let sequence = 0;
  const MIN_ZOOM = .08, MAX_ZOOM = 2.4, MAX_COORDINATE = 1_000_000;
  const finite = (value, limit = MAX_COORDINATE) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const text = value => typeof value === 'string' ? value : '';
  const point = value => value && finite(value.x) && finite(value.y);
  const activityLabels = { running: '进行中', waiting: '等待中', completed: '已完成', failed: '失败', unknown: '状态未知', idle: '' };
  const css = `
.nuyoah-work-canvas{height:100%;min-height:300px;display:flex;flex-direction:column;position:relative;container-type:inline-size;min-width:0;font:inherit;color:var(--nuyoah-text,inherit);--work-canvas-bg:var(--nuyoah-surface,var(--color-token-bg-primary,Canvas));--work-canvas-line:var(--nuyoah-border,color-mix(in srgb,currentColor 12%,transparent));--work-canvas-accent:var(--nuyoah-accent,var(--text-link,#2878c8))}
.nuyoah-work-canvas *{box-sizing:border-box}.nuyoah-work-canvas [hidden]{display:none!important}
.nuyoah-work-canvas-toolbar{position:absolute;bottom:16px;right:16px;z-index:5;display:flex;align-items:center;gap:2px;padding:4px;background:var(--work-canvas-bg);border:1px solid var(--work-canvas-line);border-radius:12px;box-shadow:0 4px 12px -8px #00000030;max-width:calc(100% - 24px)}
.nuyoah-work-canvas .nuyoah-work-canvas-toolbar button{font:inherit;color:inherit;background:transparent;border:0;border-radius:7px;padding:0;width:28px;height:28px;cursor:pointer;line-height:1.45;font-size:18px}
.nuyoah-work-canvas-toolbar button:hover{background:color-mix(in srgb,currentColor 6%,var(--work-canvas-bg))}
.nuyoah-work-canvas-toolbar output{font-variant-numeric:tabular-nums;font-size:.7em;min-width:36px;text-align:center}
.nuyoah-work-canvas-viewport{position:relative;isolation:isolate;flex:1;min-height:230px;overflow:hidden;touch-action:none;cursor:grab;border:0;border-radius:0;background:var(--nuyoah-canvas-bg,var(--color-token-bg-secondary,color-mix(in srgb,currentColor 3%,var(--work-canvas-bg))));overscroll-behavior:contain}
.nuyoah-work-canvas-viewport[data-dragging="true"],.nuyoah-work-canvas-viewport[data-dragging="true"] .nuyoah-work-canvas-node{cursor:grabbing}
.nuyoah-work-canvas-world{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0}
.nuyoah-work-canvas-edges{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.nuyoah-work-canvas-edges path{fill:none;stroke:color-mix(in srgb,var(--nuyoah-muted,currentColor) 36%,var(--work-canvas-bg));stroke-width:1.5;vector-effect:non-scaling-stroke;stroke-linecap:round}
.nuyoah-work-canvas-edges path[data-kind="fork"]{stroke:color-mix(in srgb,var(--nuyoah-muted,currentColor) 45%,var(--work-canvas-bg));stroke-dasharray:9 4}
.nuyoah-work-canvas-edges path[data-kind="related"]{stroke-dasharray:3 6}
.nuyoah-work-canvas-edges path[data-kind="membership"]{stroke-width:1;stroke-dasharray:2 7;opacity:.65}
.nuyoah-work-canvas-edge-label{font:11px system-ui,sans-serif;fill:currentColor;stroke:var(--work-canvas-bg);stroke-width:4;paint-order:stroke;text-anchor:middle;stroke-linejoin:round}
.nuyoah-work-canvas-node{position:absolute!important;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:7px;max-width:none!important;padding:17px 19px!important;overflow:hidden;text-align:left;white-space:normal;user-select:none;touch-action:none;cursor:grab;font:inherit!important;color:inherit!important;line-height:1.35!important;border:1px solid var(--work-canvas-line)!important;border-radius:17px!important;background:var(--work-canvas-bg)!important;box-shadow:0 5px 16px -9px #00000025;--work-accent:#91b69d}
.nuyoah-work-canvas-node[data-tone="blue"]{--work-accent:#91b2d1}.nuyoah-work-canvas-node[data-tone="peach"]{--work-accent:#d8ae91}.nuyoah-work-canvas-node[data-tone="lilac"]{--work-accent:#b8a6d0}
.nuyoah-work-canvas-node[data-kind="root"],.nuyoah-work-canvas-node[data-kind="direction"]{background:var(--nuyoah-subtle,color-mix(in srgb,currentColor 4%,var(--work-canvas-bg)))!important;box-shadow:none}
.nuyoah-work-canvas-node:hover{box-shadow:0 4px 16px color-mix(in srgb,currentColor 11%,transparent)}
.nuyoah-work-canvas-node[data-selected="true"]{outline:2px solid color-mix(in srgb,var(--work-canvas-accent) 45%,transparent);outline-offset:2px;border-color:var(--work-canvas-accent)!important}
.nuyoah-work-canvas-node[data-current="true"]{border-color:color-mix(in srgb,var(--work-canvas-accent) 38%,var(--work-canvas-line))!important}
.nuyoah-work-canvas-node-signal{position:absolute;right:12px;top:10px;display:flex;align-items:center;gap:6px;pointer-events:none}
.nuyoah-work-canvas-node-current{font-size:10px;line-height:1.3;font-weight:500;padding:2px 5px;border-radius:4px;color:var(--work-canvas-accent);background:var(--nuyoah-accent-soft,color-mix(in srgb,var(--work-canvas-accent) 8%,var(--work-canvas-bg)))}
.nuyoah-work-canvas-node-dot{width:9px;height:9px;border-radius:50%;background:color-mix(in srgb,currentColor 40%,var(--work-canvas-bg));flex:none}
.nuyoah-work-canvas-node[data-activity="running"]{border-color:#3caa72!important;box-shadow:0 3px 12px color-mix(in srgb,currentColor 5%,transparent),0 0 0 2px #4bb58055,0 0 20px #50c88b33;animation:nuyoah-work-canvas-glow 2.8s ease-in-out infinite}
.nuyoah-work-canvas-node[data-activity="running"]::after{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:linear-gradient(110deg,transparent 36%,#55d99118 47%,#8eebaf33 51%,transparent 64%);background-size:260% 100%;background-position:100% 0;animation:nuyoah-work-canvas-sweep 2.8s linear infinite}
.nuyoah-work-canvas-node[data-activity="running"] .nuyoah-work-canvas-node-dot{background:#278c53;box-shadow:0 0 0 3px #57ca8a33,0 0 9px #4bb580aa;animation:nuyoah-work-canvas-pulse 2.8s ease-in-out infinite}
.nuyoah-work-canvas-node[data-activity="completed"] .nuyoah-work-canvas-node-dot{display:grid;place-items:center;width:15px;height:15px;background:#358657;color:white;font:600 11px/1 system-ui,sans-serif}
.nuyoah-work-canvas-node[data-activity="waiting"] .nuyoah-work-canvas-node-dot{background:#c99b4a}
.nuyoah-work-canvas-node[data-activity="failed"] .nuyoah-work-canvas-node-dot{background:#c37676}
.nuyoah-work-canvas[data-motion-paused="true"] .nuyoah-work-canvas-node,.nuyoah-work-canvas[data-motion-paused="true"] .nuyoah-work-canvas-node-dot,.nuyoah-work-canvas[data-motion-paused="true"] .nuyoah-work-canvas-node::after,.nuyoah-work-canvas-viewport[data-dragging="true"] .nuyoah-work-canvas-node,.nuyoah-work-canvas-viewport[data-dragging="true"] .nuyoah-work-canvas-node-dot,.nuyoah-work-canvas-viewport[data-dragging="true"] .nuyoah-work-canvas-node::after,[hidden] .nuyoah-work-canvas-node,[hidden] .nuyoah-work-canvas-node-dot,[hidden] .nuyoah-work-canvas-node::after{animation:none!important}
@keyframes nuyoah-work-canvas-glow{0%,100%{box-shadow:0 3px 12px color-mix(in srgb,currentColor 5%,transparent),0 0 0 1px #4bb58055,0 0 12px #50c88b22}50%{box-shadow:0 3px 12px color-mix(in srgb,currentColor 5%,transparent),0 0 0 3px #3eb57766,0 0 24px #50c88b44}}
@keyframes nuyoah-work-canvas-pulse{0%,100%{opacity:.7;transform:scale(.88)}50%{opacity:1;transform:scale(1.2)}}
@keyframes nuyoah-work-canvas-sweep{from{background-position:100% 0}to{background-position:-100% 0}}
@media(prefers-reduced-motion:reduce){.nuyoah-work-canvas .nuyoah-work-canvas-node,.nuyoah-work-canvas .nuyoah-work-canvas-node-dot,.nuyoah-work-canvas .nuyoah-work-canvas-node::after{animation:none!important}}
.nuyoah-work-canvas :is(button,.nuyoah-work-canvas-viewport):focus-visible{outline:3px solid currentColor!important;outline-offset:3px}
.nuyoah-work-canvas-node-title{font-weight:600;font-size:1em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;max-width:100%}
.nuyoah-work-canvas-node-subtitle{font-size:.78em;color:var(--nuyoah-muted,var(--color-token-text-secondary,GrayText));display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;max-width:100%}
.nuyoah-work-canvas-node-badge{font-size:.68em;border:0;border-radius:0;padding:0;color:var(--nuyoah-muted,var(--color-token-text-secondary,GrayText));line-height:1.35;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nuyoah-work-canvas-node[data-current="true"] .nuyoah-work-canvas-node-badge{max-width:calc(100% - 54px)}
.nuyoah-work-canvas-node-title,.nuyoah-work-canvas-node-subtitle,.nuyoah-work-canvas-node-badge{flex-shrink:0}
.nuyoah-work-canvas-footer{position:absolute;left:16px;right:16px;bottom:60px;pointer-events:none;font-size:.72em;line-height:1.45;color:var(--nuyoah-muted,var(--color-token-text-secondary,GrayText))}.nuyoah-work-canvas-footer p{margin:0}.nuyoah-work-canvas-footer p:first-child{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}@container (max-width:480px){.nuyoah-work-canvas-toolbar output{display:none}.nuyoah-work-canvas-toolbar{right:12px}}
`;

  function create({ container, storageKey = '', onActivate = () => {} } = {}) {
    if (!container?.append) throw new Error('画布需要可用的容器。');
    const owner = container.ownerDocument || document;
    const make = (tag, className, content) => { const element = owner.createElement(tag); if (className) element.className = className; if (content !== undefined) element.textContent = content; return element; };
    const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
    const attr = (element, name, value) => { value = String(value); if (element.getAttribute(name) !== value) element.setAttribute(name, value); };
    const styleValue = (element, name, value) => { if (element.style[name] !== value) element.style[name] = value; };
    const root = make('section', 'nuyoah-work-canvas');
    const style = make('style', '', css), toolbar = make('div', 'nuyoah-work-canvas-toolbar');
    attr(toolbar, 'role', 'toolbar'); attr(toolbar, 'aria-label', '画布工具栏');
    const viewport = make('div', 'nuyoah-work-canvas-viewport'); viewport.tabIndex = 0;
    attr(viewport, 'role', 'region'); attr(viewport, 'aria-label', '工作画布');
    const world = make('div', 'nuyoah-work-canvas-world');
    const svg = owner.createElementNS('http://www.w3.org/2000/svg', 'svg'); attr(svg, 'class', 'nuyoah-work-canvas-edges'); attr(svg, 'aria-hidden', 'true');
    world.append(svg); viewport.append(world);
    const footer = make('div', 'nuyoah-work-canvas-footer');
    const help = make('p', '', '拖动节点或空白处；按住 ⌘ / Ctrl 滚轮缩放。'); help.id = `nuyoah-canvas-help-${++sequence}`;
    attr(viewport, 'aria-describedby', help.id);
    const notice = make('p', '', ''); attr(notice, 'role', 'status'); footer.append(help, notice);
    const zoomOutput = make('output', '', '100%'); attr(zoomOutput, 'aria-label', '画布缩放比例');
    root.append(style, toolbar, viewport, footer); container.append(root);

    let destroyed = false, drag = null, suppressedClick = null, saveTimer = null, layoutDirty = false;
    let selectedId = null, signature = null, needsFit = true, view = { x: 0, y: 0, zoom: 1 };
    const records = new Map(), edges = new Map(), positions = new Map(), listeners = [];
    const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); listeners.push(() => target.removeEventListener(type, fn, options)); };
    const nowSize = () => { const rect = viewport.getBoundingClientRect(); return { width: viewport.clientWidth || rect.width, height: viewport.clientHeight || rect.height }; };
    const localPoint = event => {
      const rect = viewport.getBoundingClientRect();
      const scaleX = rect.width / (viewport.offsetWidth || viewport.clientWidth || rect.width) || 1;
      const scaleY = rect.height / (viewport.offsetHeight || viewport.clientHeight || rect.height) || 1;
      return { x: (event.clientX - rect.left) / scaleX - (viewport.clientLeft || 0), y: (event.clientY - rect.top) / scaleY - (viewport.clientTop || 0) };
    };
    const bounded = value => clamp(value, -MAX_COORDINATE, MAX_COORDINATE);
    const targetNode = target => {
      const element = target?.closest?.('[data-node-id]');
      const record = element && records.get(element.getAttribute('data-node-id'));
      return record?.element === element ? record : null;
    };
    if (storageKey) {
      try {
        const saved = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
        if (saved?.schemaVersion === 1) {
          if (saved.positions && typeof saved.positions === 'object' && !Array.isArray(saved.positions)) {
            for (const [id, position] of Object.entries(saved.positions).slice(0, 10000)) if (point(position)) positions.set(id, { x: position.x, y: position.y });
          }
          if (point(saved.viewport) && finite(saved.viewport.zoom, MAX_ZOOM) && saved.viewport.zoom >= MIN_ZOOM) {
            view = { x: saved.viewport.x, y: saved.viewport.y, zoom: saved.viewport.zoom }; needsFit = false;
          }
        }
      } catch { /* A missing or blocked preference store does not block the canvas. */ }
    }
    function getLayout() {
      return { schemaVersion: 1, viewport: { ...view }, positions: Object.fromEntries([...positions].map(([id, position]) => [id, { ...position }])) };
    }
    function saveNow() {
      clearTimeout(saveTimer); saveTimer = null;
      if (!layoutDirty || !storageKey) return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(getLayout())); layoutDirty = false; setText(notice, '');
      } catch { setText(notice, '布局暂未保存'); }
    }
    function saveSoon() {
      layoutDirty = true; clearTimeout(saveTimer);
      if (storageKey) saveTimer = setTimeout(() => { if (!destroyed) saveNow(); }, 180);
    }
    function paintView() {
      styleValue(world, 'transform', `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`);
      styleValue(viewport, 'backgroundPosition', `${view.x}px ${view.y}px`);
      const grid = Math.max(8, 24 * view.zoom); styleValue(viewport, 'backgroundSize', `${grid}px ${grid}px`);
      attr(viewport, 'data-zoom', view.zoom); attr(viewport, 'data-pan-x', view.x); attr(viewport, 'data-pan-y', view.y);
      setText(zoomOutput, `${Math.round(view.zoom * 100)}%`);
    }
    function edgePath(a, b) {
      const acx = a.x + a.width / 2, acy = a.y + a.height / 2, bcx = b.x + b.width / 2, bcy = b.y + b.height / 2;
      if (Math.abs(bcx - acx) < Math.max(a.width, b.width) * .6) {
        const side = bcy >= acy ? 1 : -1, y1 = acy + side * a.height / 2, y2 = bcy - side * b.height / 2;
        const bend = Math.max(35, Math.abs(y2 - y1) * .5);
        return { d: `M ${acx} ${y1} C ${acx} ${y1 + side * bend}, ${bcx} ${y2 - side * bend}, ${bcx} ${y2}`, x: (acx + bcx) / 2, y: (y1 + y2) / 2 };
      }
      const side = bcx >= acx ? 1 : -1, x1 = acx + side * a.width / 2, x2 = bcx - side * b.width / 2;
      const bend = Math.max(45, Math.abs(x2 - x1) * .5);
      return { d: `M ${x1} ${acy} C ${x1 + side * bend} ${acy}, ${x2 - side * bend} ${bcy}, ${x2} ${bcy}`, x: (x1 + x2) / 2, y: (acy + bcy) / 2 };
    }
    function paintEdges(id) {
      for (const edge of edges.values()) if (!id || edge.from === id || edge.to === id) {
        const geometry = edgePath(records.get(edge.from), records.get(edge.to));
        attr(edge.element, 'd', geometry.d); attr(edge.label, 'x', geometry.x); attr(edge.label, 'y', geometry.y - 8);
      }
    }
    function paintPosition(record) {
      styleValue(record.element, 'left', `${record.x}px`); styleValue(record.element, 'top', `${record.y}px`);
      positions.set(record.id, { x: record.x, y: record.y });
    }
    function selection(id) {
      const next = records.has(id) ? id : null;
      if (selectedId === next) return;
      const previous = records.get(selectedId); selectedId = next;
      if (previous) { attr(previous.element, 'aria-pressed', false); attr(previous.element, 'data-selected', false); }
      const current = records.get(selectedId);
      if (current) { attr(current.element, 'aria-pressed', true); attr(current.element, 'data-selected', true); }
    }
    function zoomAt(factor, anchor) {
      if (destroyed || !finite(factor, 1e6) || factor <= 0) return;
      const next = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (next === view.zoom) return;
      view = { x: bounded(anchor.x - (anchor.x - view.x) * next / view.zoom), y: bounded(anchor.y - (anchor.y - view.y) * next / view.zoom), zoom: next };
      needsFit = false; paintView(); saveSoon();
    }
    function zoomCenter(factor) { const size = nowSize(); zoomAt(factor, { x: size.width / 2, y: size.height / 2 }); }
    function fitToBounds(initial = false) {
      if (destroyed) return;
      const size = nowSize();
      if (size.width < 1 || size.height < 1 || !records.size) { needsFit = !records.size || size.width < 1 || size.height < 1; return; }
      const nodes = [...records.values()];
      const left = Math.min(...nodes.map(n => n.x)), top = Math.min(...nodes.map(n => n.y));
      const right = Math.max(...nodes.map(n => n.x + n.width)), bottom = Math.max(...nodes.map(n => n.y + n.height));
      const zoom = clamp(Math.min(1, Math.max(1, size.width - 64) / (right - left), Math.max(1, size.height - 64) / (bottom - top)), initial ? .75 : MIN_ZOOM, MAX_ZOOM);
      view = { x: bounded(size.width / 2 - (left + right) / 2 * zoom), y: bounded(size.height / 2 - (top + bottom) / 2 * zoom), zoom };
      needsFit = false; paintView(); saveSoon();
    }
    function fit() { fitToBounds(false); }
    function arrange() {
      if (destroyed) return;
      for (const record of records.values()) { record.x = record.initial.x; record.y = record.initial.y; paintPosition(record); }
      paintEdges(); fit(); saveSoon();
    }
    function focus(id, { bottomInset = 0 } = {}) {
      if (destroyed) return;
      const record = records.get(id); if (!record) return;
      selection(id); record.element.focus({ preventScroll: true });
      const size = nowSize(), left = record.x * view.zoom + view.x, top = record.y * view.zoom + view.y;
      if (finite(bottomInset) && bottomInset > 0) size.height = Math.max(80, size.height - bottomInset);
      if (left < 12 || top < 12 || left + record.width * view.zoom > size.width - 12 || top + record.height * view.zoom > size.height - 12) {
        view.x = bounded(size.width / 2 - (record.x + record.width / 2) * view.zoom);
        view.y = bounded(size.height / 2 - (record.y + record.height / 2) * view.zoom);
        paintView(); saveSoon();
      }
    }
    function activate(record) {
      if (destroyed || !record) return;
      selection(record.id); onActivate(record.id);
    }
    function finishPointer(event, cancel = false) {
      if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      const gesture = drag; drag = null;
      attr(viewport, 'data-dragging', false);
      if (cancel) {
        const record = records.get(gesture.nodeId);
        if (record) { record.x = gesture.nodeX; record.y = gesture.nodeY; paintPosition(record); paintEdges(record.id); }
        else if (!gesture.nodeId) { view.x = gesture.panX; view.y = gesture.panY; paintView(); }
      }
      try { if (viewport.hasPointerCapture?.(gesture.pointerId)) viewport.releasePointerCapture(gesture.pointerId); } catch {}
      if (gesture.moved) { layoutDirty = true; saveNow(); }
      suppressedClick = gesture.nodeId;
      if (!cancel && !gesture.moved && gesture.nodeId) activate(records.get(gesture.nodeId));
    }
    function freePosition(raw, reserved) {
      const gap = 18;
      const intersections = y => reserved.filter(rect => raw.x < rect.x + rect.width + gap && raw.x + raw.width + gap > rect.x &&
        y < rect.y + rect.height + gap && y + raw.height + gap > rect.y);
      let y = raw.y;
      for (let step = 0; step <= reserved.length; step++) {
        const overlaps = intersections(y);
        if (!overlaps.length) return { x: raw.x, y };
        y = Math.max(...overlaps.map(rect => rect.y + rect.height + gap));
        if (y > MAX_COORDINATE) break;
      }
      // Near the coordinate bound, find room above without moving any saved node.
      y = raw.y;
      for (let step = 0; step <= reserved.length; step++) {
        const overlaps = intersections(y);
        if (!overlaps.length) return { x: raw.x, y };
        y = Math.min(...overlaps.map(rect => rect.y - raw.height - gap));
        if (y < -MAX_COORDINATE) break;
      }
      return { x: raw.x, y: raw.y };
    }
    function update(data = {}) {
      if (destroyed) return;
      const fontSize = clamp(parseFloat(window.getComputedStyle?.(root)?.fontSize) || 16, 10, 40);
      const normalized = [], admitted = new Set();
      for (const raw of Array.isArray(data.nodes) ? data.nodes : []) {
        if (!raw || typeof raw.id !== 'string' || !raw.id || admitted.has(raw.id)) continue;
        admitted.add(raw.id);
        normalized.push({ id: raw.id, title: text(raw.title), subtitle: text(raw.subtitle), sourceTitle: text(raw.sourceTitle), badge: text(raw.badge),
          kind: ['root', 'direction', 'item', 'plan', 'task'].includes(raw.kind) ? raw.kind : 'item',
          tone: ['sage', 'blue', 'peach', 'lilac'].includes(raw.tone) ? raw.tone : 'sage',
          activity: Object.hasOwn(activityLabels, raw.activity) ? raw.activity : 'idle', current: raw.current === true,
          x: finite(raw.x) ? raw.x : 0, y: finite(raw.y) ? raw.y : 0,
          width: finite(raw.width) && raw.width > 0 ? clamp(raw.width, 96, 560) : 216,
          // Reserve complete text lines. Fixed legacy heights must not squeeze
          // a two-line Chinese title or summary into a clipped half-line.
          height: Math.max(finite(raw.height) && raw.height > 0 ? clamp(raw.height, 60, 360) : 106,
            Math.ceil(36 + fontSize * (2.7 + (raw.subtitle ? 2 * .78 * 1.35 : 0) + (raw.badge ? .68 * 1.35 : 0)) + 7 * (Number(Boolean(raw.subtitle)) + Number(Boolean(raw.badge))))) });
      }
      const edgeData = [...new Map((Array.isArray(data.edges) ? data.edges : []).filter(edge => edge && admitted.has(edge.from) && admitted.has(edge.to) && edge.from !== edge.to).map(edge => [JSON.stringify([edge.from, edge.to]), {
        from: edge.from, to: edge.to, kind: ['parent', 'fork', 'related', 'membership'].includes(edge.kind) ? edge.kind : '', label: text(edge.label).slice(0, 80),
      }])).values()];
      const nextSignature = JSON.stringify([normalized, edgeData, Object.hasOwn(data, 'selectedId') ? data.selectedId : undefined]);
      if (nextSignature === signature) return;
      signature = nextSignature;
      if (drag?.nodeId && !admitted.has(drag.nodeId)) finishPointer({ pointerId: drag.pointerId }, true);
      for (const [id, record] of records) if (!admitted.has(id)) { record.element.remove(); records.delete(id); }
      // Reserve all admitted saved positions before placing new nodes, including
      // when a priority change puts a new item before an existing one in the input.
      const reserved = [], newPositions = new Map();
      for (const raw of normalized) {
        const known = records.get(raw.id) || positions.get(raw.id);
        if (known) reserved.push({ x: known.x, y: known.y, width: raw.width, height: raw.height });
      }
      for (const raw of normalized) if (!records.has(raw.id) && !positions.has(raw.id)) {
        const placed = freePosition(raw, reserved); newPositions.set(raw.id, placed);
        reserved.push({ ...placed, width: raw.width, height: raw.height });
      }
      for (const raw of normalized) {
        let record = records.get(raw.id);
        if (!record) {
          const element = make('button', 'nuyoah-work-canvas-node'); element.type = 'button';
          const title = make('span', 'nuyoah-work-canvas-node-title'), subtitle = make('span', 'nuyoah-work-canvas-node-subtitle'), badge = make('span', 'nuyoah-work-canvas-node-badge');
          const signal = make('span', 'nuyoah-work-canvas-node-signal'), current = make('span', 'nuyoah-work-canvas-node-current', '当前'), dot = make('span', 'nuyoah-work-canvas-node-dot');
          attr(signal, 'aria-hidden', true); signal.append(current, dot);
          element.append(badge, title, subtitle, signal); attr(element, 'data-node-id', raw.id); attr(element, 'aria-pressed', false); attr(element, 'data-selected', false);
          const stored = positions.get(raw.id) || newPositions.get(raw.id); record = { id: raw.id, element, title, subtitle, badge, signal, current, dot, x: stored?.x ?? raw.x, y: stored?.y ?? raw.y };
          records.set(raw.id, record); world.append(element); paintPosition(record); saveSoon();
        }
        record.initial = { x: raw.x, y: raw.y }; record.width = raw.width; record.height = raw.height;
        setText(record.title, raw.title); setText(record.subtitle, raw.subtitle); setText(record.badge, raw.badge);
        if (record.subtitle.hidden !== !raw.subtitle) record.subtitle.hidden = !raw.subtitle;
        if (record.badge.hidden !== !raw.badge) record.badge.hidden = !raw.badge;
        if (record.current.hidden !== !raw.current) record.current.hidden = !raw.current;
        setText(record.dot, raw.activity === 'completed' ? '✓' : '');
        if (record.dot.hidden !== (raw.activity === 'idle')) record.dot.hidden = raw.activity === 'idle';
        if (record.signal.hidden !== (!raw.current && raw.activity === 'idle')) record.signal.hidden = !raw.current && raw.activity === 'idle';
        attr(record.element, 'aria-label', [...new Set([raw.title, raw.badge, activityLabels[raw.activity], raw.current ? '当前对话' : '', raw.subtitle].filter(Boolean))].join('，'));
        attr(record.element, 'title', raw.sourceTitle || raw.title);
        attr(record.element, 'data-activity', raw.activity); attr(record.element, 'data-current', raw.current); attr(record.element, 'aria-current', raw.current ? 'true' : 'false');
        attr(record.element, 'data-kind', raw.kind); attr(record.element, 'data-tone', raw.tone);
        styleValue(record.element, 'width', `${raw.width}px`); styleValue(record.element, 'height', `${raw.height}px`);
      }
      const wantedEdges = new Set(edgeData.map(edge => JSON.stringify([edge.from, edge.to])));
      for (const [key, edge] of edges) if (!wantedEdges.has(key)) { edge.element.remove(); edge.label.remove(); edges.delete(key); }
      for (const raw of edgeData) {
        const key = JSON.stringify([raw.from, raw.to]); let edge = edges.get(key);
        if (!edge) {
          const element = owner.createElementNS('http://www.w3.org/2000/svg', 'path'), label = owner.createElementNS('http://www.w3.org/2000/svg', 'text');
          attr(element, 'data-edge-from', raw.from); attr(element, 'data-edge-to', raw.to); attr(label, 'class', 'nuyoah-work-canvas-edge-label');
          svg.append(element, label); edge = { from: raw.from, to: raw.to, element, label }; edges.set(key, edge);
        }
        attr(edge.element, 'data-kind', raw.kind); setText(edge.label, raw.label); attr(edge.label, 'display', raw.label ? 'inline' : 'none');
      }
      paintEdges();
      selection(Object.hasOwn(data, 'selectedId') ? data.selectedId : selectedId);
      if (needsFit) fitToBounds(true);
    }
    function addButton(label, accessible, action) {
      const button = make('button', '', label); button.type = 'button'; attr(button, 'aria-label', accessible); button.title = accessible;
      listen(button, 'click', action); toolbar.append(button);
    }
    addButton('−', '缩小画布', () => zoomCenter(1 / 1.2)); toolbar.append(zoomOutput);
    addButton('+', '放大画布', () => zoomCenter(1.2)); addButton('⤢', '适应全部节点', fit); addButton('↺', '整理节点布局', arrange);
    listen(viewport, 'pointerdown', event => {
      if (destroyed || drag || event.button !== 0 || event.isPrimary === false) return;
      const record = targetNode(event.target); suppressedClick = null;
      const anchor = localPoint(event);
      drag = { pointerId: event.pointerId, nodeId: record?.id || null, x: anchor.x, y: anchor.y, nodeX: record?.x, nodeY: record?.y, panX: view.x, panY: view.y, zoom: view.zoom, moved: false };
      if (record) { selection(record.id); record.element.focus({ preventScroll: true }); } else { selection(null); viewport.focus({ preventScroll: true }); }
      event.preventDefault(); event.stopPropagation();
      try { viewport.setPointerCapture(event.pointerId); } catch {}
    });
    listen(viewport, 'pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const current = localPoint(event), dx = current.x - drag.x, dy = current.y - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true; needsFit = false; attr(viewport, 'data-dragging', true);
      if (drag.nodeId) {
        const record = records.get(drag.nodeId); if (!record) return;
        record.x = bounded(drag.nodeX + dx / drag.zoom); record.y = bounded(drag.nodeY + dy / drag.zoom); paintPosition(record); paintEdges(record.id);
      } else { view.x = bounded(drag.panX + dx); view.y = bounded(drag.panY + dy); paintView(); }
      event.preventDefault(); event.stopPropagation();
    });
    listen(viewport, 'pointerup', event => finishPointer(event));
    listen(viewport, 'pointercancel', event => finishPointer(event, true));
    listen(viewport, 'lostpointercapture', event => finishPointer(event, true));
    listen(viewport, 'click', event => {
      const record = targetNode(event.target); if (!record) return;
      event.preventDefault(); event.stopPropagation();
      if (suppressedClick === record.id) { suppressedClick = null; return; }
      activate(record);
    });
    listen(viewport, 'wheel', event => {
      if (destroyed || drag) return;
      event.preventDefault(); event.stopPropagation();
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? nowSize().height : 1;
      const dx = finite(event.deltaX) ? event.deltaX * factor : 0, dy = finite(event.deltaY) ? event.deltaY * factor : 0;
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(clamp(-dy * .002, -6, 6)), localPoint(event));
      else { view.x = bounded(view.x - (event.shiftKey && !dx ? dy : dx)); view.y = bounded(view.y - (event.shiftKey && !dx ? 0 : dy)); needsFit = false; paintView(); saveSoon(); }
    }, { passive: false });
    listen(viewport, 'keydown', event => {
      const record = targetNode(event.target);
      if (destroyed || (!record && event.target !== viewport)) return;
      if (event.key === 'Escape' && drag) { finishPointer({ pointerId: drag.pointerId }, true); event.preventDefault(); return; }
      if (drag) return;
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (delta) {
        const step = event.shiftKey ? 50 : 10;
        if (record) { selection(record.id); record.x = bounded(record.x + delta[0] * step / view.zoom); record.y = bounded(record.y + delta[1] * step / view.zoom); paintPosition(record); paintEdges(record.id); }
        else { view.x = bounded(view.x - delta[0] * step); view.y = bounded(view.y - delta[1] * step); paintView(); }
        needsFit = false; saveSoon();
      } else if (event.key === '+' || event.key === '=') zoomCenter(1.2);
      else if (event.key === '-' || event.key === '_') zoomCenter(1 / 1.2);
      else if (event.key === '0' || event.key === 'Home') fit();
      else if (event.key === 'Enter' && record) { suppressedClick = null; activate(record); }
      else return;
      event.preventDefault(); event.stopPropagation();
    });
    listen(window, 'pagehide', saveNow);
    const syncVisibility = () => {
      const hidden = owner.visibilityState === 'hidden'; attr(root, 'data-motion-paused', hidden);
      if (hidden) saveNow();
    };
    listen(owner, 'visibilitychange', syncVisibility); syncVisibility();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!destroyed && needsFit) fitToBounds(true); }) : null;
    observer?.observe(viewport); paintView();
    function destroy() {
      if (destroyed) return;
      if (drag) finishPointer({ pointerId: drag.pointerId }, true);
      saveNow(); destroyed = true; clearTimeout(saveTimer); observer?.disconnect();
      for (const remove of listeners) remove();
      root.remove(); records.clear(); edges.clear();
    }
    return { update, fit, arrange, focus, destroy, getLayout };
  }
  window.__nuyoahWorkCanvas__ = { create };
})();
