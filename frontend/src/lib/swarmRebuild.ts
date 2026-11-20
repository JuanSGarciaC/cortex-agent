/**
 * Swarm Rebuild: a swarm of coloured cursors "builds" a page, layer by layer.
 *
 * 1. Scan (~1.8 s): layers are hidden before the first paint, the cursors spin in the centre and a line sweeps the screen.
 * 2. Build: each agent takes the next visible layer in DOM order, flies to its corner, draws a frame with a label and
 *    reveals it. Text is typed without moving the layout (the pending text stays invisible in its place).
 * 3. Controlled scroll at 900 px/s that never goes past the first unbuilt layer (kept at 60 % of the screen).
 * 4. Rest: the cursors follow the mouse as a tail; with the mouse still for 2 s they form a ring pointing at it.
 * 5. End: the bar shows the summary; Esc skips to the end, the close button sends them out, [data-sr-replay] restarts.
 *
 * Only transform and opacity are animated, from one rAF loop. Nothing runs with prefers-reduced-motion, and nothing is
 * hidden until the engine has started; a safety timer reveals everything if the loop never gets going.
 */

const LEAF = 'h1,h2,h3,h4,p,li,img,.btn,.chip,.cover,[data-sr-layer]';
const BOX = '.card,.panel,[data-sr-box]';
const COLORS = ['#c8ff3d', '#5ee6ff', '#b18cff', '#ff8f5e', '#5effb1', '#ffd45e', '#ff5ec8', '#7aa2ff', '#a3ff8f', '#ff7a7a', '#5effe4', '#e48fff', '#ffb35e', '#8fd1ff'];
const SCAN_MS = 1800;
const MAX_SPEED = 1800; // px/s, cursors never move faster than this
const SCROLL_SPEED = 900; // px/s
const FRONTIER = 0.6; // first unbuilt layer is never scrolled above this fraction of the viewport
const STILL_MS = 2000;
const PLAYED_KEY = 'cortex.swarm-rebuild.played';

type Seg = { node: Text; wrap: HTMLSpanElement; shown: Text; hidden: Text; full: string };
type Layer = {
  el: HTMLElement;
  kind: 'text' | 'fade' | 'box';
  label: string;
  state: 0 | 1 | 2; // pending, claimed, done
  segs?: Seg[];
  chars: number;
};
type Phase = 'draw' | 'reveal' | 'fly' | 'wait';
type Agent = {
  el: HTMLDivElement;
  frame: HTMLDivElement;
  edges: HTMLDivElement[];
  tag: HTMLDivElement;
  color: string;
  x: number; y: number; rot: number;
  layer: Layer | null;
  phase: Phase;
  t: number; // ms spent in the current phase
  dur: number;
};

export const prefersReducedMotion = () => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const n = document.createElement(tag);
  n.className = cls;
  parent?.appendChild(n);
  return n;
};

const CURSOR_SVG = (c: string) =>
  `<svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true"><path d="M1 1 L1 17.5 L5.4 13.6 L8.4 20.4 L11.3 19.1 L8.4 12.5 L14.4 12.3 Z" fill="${c}" stroke="#07080b" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

export type SwarmHandle = { destroy: () => void };

export function startSwarmRebuild(root: HTMLElement, scroller: HTMLElement): SwarmHandle | null {
  if (prefersReducedMotion()) return null;

  let destroyed = false;
  let run: ReturnType<typeof createRun> | null = null;

  const begin = () => {
    run?.destroy();
    run = createRun(root, scroller);
  };

  const onReplay = (e: MouseEvent) => {
    const t = (e.target as HTMLElement | null)?.closest('[data-sr-replay]');
    if (!t || !root.contains(t)) return;
    e.preventDefault();
    scroller.scrollTop = 0;
    begin();
  };
  root.addEventListener('click', onReplay);

  let played = false;
  try { played = sessionStorage.getItem(PLAYED_KEY) === '1'; } catch { /* storage blocked */ }
  if (!played) {
    try { sessionStorage.setItem(PLAYED_KEY, '1'); } catch { /* storage blocked */ }
    begin();
  }

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.removeEventListener('click', onReplay);
      run?.destroy();
      run = null;
    },
  };
}

function createRun(root: HTMLElement, scroller: HTMLElement) {
  const small = window.innerWidth < 600;
  const N = small ? 8 : 14;
  const canHover = window.matchMedia?.('(hover: hover)').matches ?? true;

  // ---------- layers ----------
  const layers: Layer[] = [];
  const tracked = new WeakSet<Element>();

  const classify = (node: HTMLElement): Layer | null => {
    if (tracked.has(node) || node.closest('[data-sr-skip]')) return null;
    const isBox = node.matches(BOX);
    if (!isBox && node.parentElement?.closest(LEAF) && root.contains(node.parentElement.closest(LEAF))) return null;
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    tracked.add(node);
    if (isBox) return { el: node, kind: 'box', label: 'frame', state: 0, chars: 0 };
    const text = node.matches('.cover') ? '' : (node.textContent ?? '').trim();
    return { el: node, kind: text ? 'text' : 'fade', label: node.matches('.cover') ? 'frame' : node.tagName.toLowerCase(), state: 0, chars: text.length };
  };

  const hide = (l: Layer) => {
    if (l.kind === 'box') {
      l.el.style.setProperty('--sr-bg', getComputedStyle(l.el).backgroundColor);
      l.el.classList.add('sr-box-wait');
    } else l.el.setAttribute('data-sr', 'wait');
  };

  const collect = (scope: Element) => {
    const found: Layer[] = [];
    const nodes = [scope, ...scope.querySelectorAll(`${BOX},${LEAF}`)];
    for (const n of nodes) {
      if (!(n instanceof HTMLElement) || !n.matches(`${BOX},${LEAF}`) || !root.contains(n)) continue;
      const l = classify(n);
      if (l) found.push(l);
    }
    return found;
  };

  const sortLayers = () => layers.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

  for (const l of collect(root)) layers.push(l);
  if (!layers.length) return { destroy() {} };

  // ---------- typing (text stays in place, the rest is invisible) ----------
  const prepareText = (l: Layer) => {
    const walker = document.createTreeWalker(l.el, NodeFilter.SHOW_TEXT);
    const segs: Seg[] = [];
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      if (t.nodeValue && t.nodeValue.trim()) nodes.push(t);
    }
    for (const node of nodes) {
      const full = node.nodeValue ?? '';
      const wrap = document.createElement('span');
      wrap.className = 'sr-type';
      const shown = document.createTextNode('');
      const hiddenSpan = document.createElement('span');
      hiddenSpan.className = 'sr-pending';
      const hidden = document.createTextNode(full);
      hiddenSpan.appendChild(hidden);
      wrap.append(shown, hiddenSpan);
      node.replaceWith(wrap);
      segs.push({ node, wrap, shown, hidden, full });
    }
    l.segs = segs;
    l.chars = segs.reduce((s, g) => s + g.full.length, 0);
  };

  const typeTo = (l: Layer, k: number) => {
    let left = k;
    for (const s of l.segs ?? []) {
      const n = Math.max(0, Math.min(s.full.length, left));
      left -= s.full.length;
      if (s.shown.nodeValue!.length !== n) {
        s.shown.nodeValue = s.full.slice(0, n);
        s.hidden.nodeValue = s.full.slice(n);
      }
    }
  };

  const restoreText = (l: Layer) => {
    for (const s of l.segs ?? []) if (s.wrap.isConnected) s.wrap.replaceWith(s.node);
    l.segs = undefined;
  };

  const boxTimers = new Set<number>();
  const finish = (l: Layer, instant = false) => {
    if (l.state === 2) return;
    l.state = 2;
    if (l.kind === 'box') {
      if (instant) l.el.classList.remove('sr-box-wait', 'sr-box-in');
      else {
        l.el.classList.add('sr-box-in');
        const id = window.setTimeout(() => { l.el.classList.remove('sr-box-wait', 'sr-box-in'); boxTimers.delete(id); }, 460);
        boxTimers.add(id);
      }
    } else {
      restoreText(l);
      l.el.removeAttribute('data-sr');
    }
  };

  // Hide everything now, before the first paint (this runs from a layout effect).
  layers.forEach(hide);

  // Layers inserted later (e.g. stats that arrive from the API) are hidden before they paint: observers run as microtasks.
  let phase: 'scan' | 'build' | 'rest' | 'leave' = 'scan';
  const mo = new MutationObserver((records) => {
    if (phase !== 'scan' && phase !== 'build') return;
    let added = false;
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement) || n.classList.contains('sr-type')) return;
        for (const l of collect(n)) { hide(l); layers.push(l); added = true; }
      });
      r.removedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        for (const l of layers) if (l.state !== 2 && !l.el.isConnected) l.state = 2;
      });
    }
    if (added) sortLayers();
  });
  mo.observe(root, { childList: true, subtree: true });

  // ---------- overlay ----------
  const overlay = el('div', 'sr-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  const scan = el('div', 'sr-scan', overlay);
  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;

  const agents: Agent[] = Array.from({ length: N }, (_, i) => {
    const color = COLORS[i % COLORS.length];
    const frame = el('div', 'sr-frame', overlay);
    frame.style.setProperty('--c', color);
    const edges = [0, 1, 2, 3].map((k) => el('div', `sr-edge ${k % 2 ? 'v' : 'h'}`, frame));
    const tag = el('div', 'sr-tag', frame);
    const a = el('div', 'sr-agent', overlay);
    a.innerHTML = CURSOR_SVG(color);
    return { el: a, frame, edges, tag, color, x: vw() / 2, y: vh() / 2, rot: 0, layer: null, phase: 'wait', t: 0, dur: 0 };
  });

  // ---------- bottom bar ----------
  const bar = el('div', 'sr-bar');
  bar.setAttribute('role', 'status');
  bar.innerHTML = `
    <span class="sr-dot"></span><span class="sr-agents">${N} agentes</span>
    <span class="sr-count">0/${layers.length} capas</span>
    <span class="sr-track"><i></i></span>
    <button type="button" class="sr-tour" aria-pressed="true" title="Desplazar la página mientras construyen">Tour</button>
    <button type="button" class="sr-speed" title="Velocidad">1×</button>
    <button type="button" class="sr-close" aria-label="Cerrar el enjambre">✕</button>`;
  const countEl = bar.querySelector('.sr-count') as HTMLElement;
  const fillEl = bar.querySelector('.sr-track i') as HTMLElement;
  const tourBtn = bar.querySelector('.sr-tour') as HTMLButtonElement;
  const speedBtn = bar.querySelector('.sr-speed') as HTMLButtonElement;
  const closeBtn = bar.querySelector('.sr-close') as HTMLButtonElement;
  document.body.append(overlay, bar);

  let tour = true;
  let speed = 1;
  tourBtn.onclick = () => { tour = !tour; tourBtn.setAttribute('aria-pressed', String(tour)); };
  speedBtn.onclick = () => { speed = speed === 1 ? 4 : 1; speedBtn.textContent = `${speed}×`; };
  closeBtn.onclick = () => leave();

  // ---------- input ----------
  const mouse = { x: vw() / 2, y: vh() / 2, seen: false, movedAt: performance.now() };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.seen = true; mouse.movedAt = performance.now();
  };
  let userScrollUntil = 0;
  const onUserScroll = () => { userScrollUntil = performance.now() + 1500; };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { if (phase === 'scan' || phase === 'build') skip(); }
    else if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) onUserScroll();
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  scroller.addEventListener('wheel', onUserScroll, { passive: true });
  scroller.addEventListener('touchstart', onUserScroll, { passive: true });
  scroller.addEventListener('pointerdown', onUserScroll, { passive: true });
  window.addEventListener('keydown', onKey);

  // ---------- loop ----------
  let raf = 0;
  let last = 0;
  let active = 0; // ms of visible running time
  let frames = 0;
  let done = 0;
  let ended = false;
  let killed = false;

  const total = () => layers.filter((l) => l.el.isConnected).length;
  const updateBar = () => {
    const n = total();
    countEl.textContent = `${done}/${n} capas`;
    fillEl.style.transform = `scaleX(${n ? done / n : 1})`;
  };

  const move = (a: Agent, tx: number, ty: number, dt: number, ease = 9) => {
    const dx = tx - a.x, dy = ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) { a.x = tx; a.y = ty; return 0; }
    const step = Math.min(d * (1 - Math.exp(-dt * ease)) + 40 * dt, MAX_SPEED * dt, d);
    a.x += (dx / d) * step; a.y += (dy / d) * step;
    return d - step;
  };

  const turn = (a: Agent, target: number, dt: number) => {
    const diff = ((target - a.rot + 540) % 360) - 180;
    a.rot += diff * (1 - Math.exp(-dt * 10));
  };

  const paintAgent = (a: Agent) => { a.el.style.transform = `translate3d(${a.x}px,${a.y}px,0) rotate(${a.rot}deg)`; };

  const paintFrame = (a: Agent, r: DOMRect, p: number) => {
    // Top and left grow from the corner in the first half, right and bottom in the second.
    const p1 = Math.min(1, p * 2), p2 = Math.max(0, Math.min(1, p * 2 - 1));
    const [top, right, bottom, left] = a.edges;
    top.style.transform = `translate3d(${r.left}px,${r.top}px,0) scaleX(${r.width * p1})`;
    left.style.transform = `translate3d(${r.left}px,${r.top}px,0) scaleY(${r.height * p1})`;
    right.style.transform = `translate3d(${r.right}px,${r.top}px,0) scaleY(${r.height * p2})`;
    bottom.style.transform = `translate3d(${r.left}px,${r.bottom}px,0) scaleX(${r.width * p2})`;
    a.tag.style.transform = `translate3d(${r.left}px,${Math.max(0, r.top - 17)}px,0)`;
  };

  const claimNext = (): Layer | null => {
    const h = vh();
    for (const l of layers) {
      if (l.state !== 0 || !l.el.isConnected) continue;
      const r = l.el.getBoundingClientRect();
      if (r.top < h - 8) return l;
      return null; // DOM order: wait for the scroll to bring the next one in
    }
    return null;
  };

  const release = (a: Agent) => {
    a.layer = null;
    a.phase = 'wait';
    a.frame.classList.remove('on', 'tagged');
  };

  function tick(now: number) {
    raf = requestAnimationFrame(tick);
    if (killed) return;
    try {
      const dtMs = Math.min(50, last ? now - last : 16);
      last = now;
      frames++;
      active += dtMs;
      const dt = dtMs / 1000;
      if (active > 45000 && (phase === 'scan' || phase === 'build')) skip();

      if (phase === 'scan') stepScan(dtMs);
      else if (phase === 'build') stepBuild(dt, now);
      else if (phase === 'rest') stepRest(dt, now);
      else if (phase === 'leave') stepLeave(dt);
      agents.forEach(paintAgent);
    } catch (err) {
      console.error('swarm rebuild', err);
      destroy();
    }
  }

  function stepScan(dtMs: number) {
    const p = Math.min(1, active / SCAN_MS);
    scan.style.transform = `translate3d(0,${p * vh()}px,0)`;
    scan.style.opacity = String(p < 0.9 ? 1 : (1 - p) * 10);
    const cx = vw() / 2, cy = vh() / 2;
    agents.forEach((a, i) => {
      const ang = active / 260 + (i / N) * Math.PI * 2;
      move(a, cx + Math.cos(ang) * 46, cy + Math.sin(ang) * 46, dtMs / 1000, 14);
      turn(a, (ang * 180) / Math.PI + 45, dtMs / 1000);
    });
    if (p >= 1) {
      phase = 'build';
      scan.remove();
    }
  }

  function stepBuild(dt: number, now: number) {
    const sdt = dt * speed;
    for (const a of agents) {
      if (!a.layer) {
        const l = claimNext();
        if (l) {
          l.state = 1;
          a.layer = l;
          a.phase = 'fly';
          a.t = 0;
          a.tag.textContent = l.label;
          a.frame.classList.add('on');
          paintFrame(a, l.el.getBoundingClientRect(), 0);
        }
      }
      const l = a.layer;
      if (!l) {
        // Idle: drift loosely near the bottom of the screen, where the next layers will come from.
        const i = agents.indexOf(a);
        const ang = active / 900 + i;
        move(a, vw() * (0.2 + 0.6 * (i / N)) + Math.cos(ang) * 18, vh() * 0.82 + Math.sin(ang) * 14, dt, 3);
        turn(a, 0, dt);
        continue;
      }
      if (!l.el.isConnected) { release(a); continue; }
      const r = l.el.getBoundingClientRect();
      a.t += sdt * 1000;
      turn(a, 0, dt);
      if (a.phase === 'fly') {
        paintFrame(a, r, 0);
        if (move(a, r.left, r.top, dt * Math.min(speed, 2)) < 2) { a.phase = 'draw'; a.t = 0; a.dur = 300; a.frame.classList.add('tagged'); }
      } else if (a.phase === 'draw') {
        const p = Math.min(1, a.t / a.dur);
        paintFrame(a, r, p);
        a.x = r.left + r.width * Math.min(1, p * 2); a.y = r.top + r.height * Math.max(0, p * 2 - 1);
        if (p >= 1) {
          a.phase = 'reveal'; a.t = 0;
          if (l.kind === 'text') {
            prepareText(l);
            l.el.setAttribute('data-sr', 'type');
            a.dur = Math.max(260, Math.min(1100, l.chars * 16));
          } else if (l.kind === 'fade') {
            l.el.setAttribute('data-sr', 'fade');
            a.dur = 420;
          } else {
            l.el.classList.add('sr-box-in');
            a.dur = 460;
          }
        }
      } else if (a.phase === 'reveal') {
        const p = Math.min(1, a.t / a.dur);
        paintFrame(a, r, 1);
        if (l.kind === 'text') typeTo(l, Math.round(l.chars * p));
        move(a, r.left + r.width * p, r.top + r.height * (0.35 + 0.5 * p), dt, 16);
        if (p >= 1) {
          finish(l);
          done++;
          release(a);
        }
      }
    }

    // Controlled scroll: bring the first unfinished layer up to the frontier line, never past it.
    const front = layers.find((l) => l.state !== 2 && l.el.isConnected);
    if (front && tour && now > userScrollUntil) {
      const top = front.el.getBoundingClientRect().top;
      const line = vh() * FRONTIER;
      const room = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      if (top > line && room > 0.5) scroller.scrollTop += Math.min(SCROLL_SPEED * dt, top - line, room);
    }

    updateBar();
    if (layers.every((l) => l.state === 2 || !l.el.isConnected) && agents.every((a) => !a.layer)) end();
  }

  function stepRest(dt: number, now: number) {
    const still = now - mouse.movedAt > STILL_MS;
    agents.forEach((a, i) => {
      if (still) {
        const ang = (i / N) * Math.PI * 2 + active / 4000;
        const R = N * 4.4;
        move(a, mouse.x + Math.cos(ang) * R, mouse.y + Math.sin(ang) * R, dt, 6);
        // The tip of the cursor is at its origin and points to -135°: rotate it to face the mouse.
        turn(a, ((ang + Math.PI) * 180) / Math.PI + 135, dt);
      } else {
        const lead = i === 0 ? { x: mouse.x + 10, y: mouse.y + 14 } : agents[i - 1];
        move(a, lead.x + (i === 0 ? 0 : 6), lead.y + (i === 0 ? 0 : 8), dt, 12);
        turn(a, 0, dt);
      }
    });
  }

  function stepLeave(dt: number) {
    let out = 0;
    const w = vw(), h = vh();
    agents.forEach((a) => {
      const d = [a.x, w - a.x, a.y, h - a.y];
      const k = d.indexOf(Math.min(...d));
      const tx = k === 0 ? -60 : k === 1 ? w + 60 : a.x;
      const ty = k === 2 ? -60 : k === 3 ? h + 60 : a.y;
      if (move(a, tx, ty, dt, 5) < 2) out++;
    });
    if (out === agents.length) destroy();
  }

  function end() {
    if (ended) return;
    ended = true;
    const secs = (active / 1000).toFixed(1);
    countEl.textContent = `Reconstruidas ${done} capas en ${secs} s`;
    fillEl.style.transform = 'scaleX(1)';
    bar.classList.add('done');
    agents.forEach((a) => a.frame.classList.remove('on'));
    mo.disconnect();
    if (!canHover || !mouse.seen) {
      // Touch screens have no pointer to follow: the swarm leaves on its own.
      phase = 'rest';
      window.setTimeout(() => { if (!killed) leave(); }, canHover ? 6000 : 1600);
    } else phase = 'rest';
  }

  function skip() {
    for (const l of layers) {
      if (l.state !== 2) { finish(l, true); done++; }
    }
    agents.forEach(release);
    scan.remove();
    phase = 'build';
    end();
  }

  function leave() {
    if (phase === 'scan' || phase === 'build') skip();
    phase = 'leave';
    bar.classList.add('out');
  }

  function destroy() {
    if (killed) return;
    killed = true;
    cancelAnimationFrame(raf);
    clearTimeout(safety);
    mo.disconnect();
    boxTimers.forEach((id) => clearTimeout(id));
    for (const l of layers) {
      if (l.kind === 'box') l.el.classList.remove('sr-box-wait', 'sr-box-in');
      else { restoreText(l); l.el.removeAttribute('data-sr'); }
    }
    overlay.remove();
    bar.remove();
    window.removeEventListener('pointermove', onMove);
    scroller.removeEventListener('wheel', onUserScroll);
    scroller.removeEventListener('touchstart', onUserScroll);
    scroller.removeEventListener('pointerdown', onUserScroll);
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
  }

  // Pause while the tab is hidden; resume without a time jump.
  const onVis = () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!killed && !raf) { last = 0; raf = requestAnimationFrame(tick); }
  };
  document.addEventListener('visibilitychange', onVis);

  // Safety: if the loop has not produced frames shortly after starting, reveal everything.
  const safety = window.setTimeout(() => { if (frames < 3 && !killed) destroy(); }, 2500);
  if (!document.hidden) raf = requestAnimationFrame(tick);
  updateBar();

  return { destroy };
}
