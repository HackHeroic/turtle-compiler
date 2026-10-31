/* Shared page helpers. Every phase module uses these. */
(function () {
  'use strict';
  const phases = {};

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // A phase module registers { rules(el), improve(el), render(el, result) }.
  function register(key, mod) { phases[key] = mod; }

  // "Room to improve" cards. ideas: [{ title, level: 'easy'|'medium'|'hard', text }]
  function ideas(el, list) {
    el.innerHTML = `<div class="card"><h3 class="card-title">Room to improve</h3><div class="ideas">${list.map(i => `
      <div class="idea"><h4>${esc(i.title)} <span class="lvl lvl-${i.level}">${i.level}</span></h4><p>${i.text}</p></div>`).join('')}</div></div>`;
  }

  // Error / warning box. err: { msg, hint, line, col }
  function message(err, kind = 'bad') {
    const where = err.line ? `Line ${err.line}${err.col ? ', column ' + err.col : ''}: ` : '';
    return `<div class="msg msg-${kind}"><strong>${esc(where + err.msg)}</strong>${err.hint ? `<span class="muted">${esc(err.hint)}</span>` : ''}</div>`;
  }

  /* Step-through control.
     opts: { count, onStep(i), caption(i) -> html, start (default: last step), speed (ms) }
     Starts on the LAST step so the finished result shows at rest. */
  function stepper(el, opts) {
    const n = Math.max(0, opts.count);
    let i = opts.start === undefined ? n - 1 : opts.start, timer = null;
    el.innerHTML = `
      <div class="stepper" role="group" aria-label="Step through this phase">
        <button class="btn" data-a="first" aria-label="Back to the first step">⏮</button>
        <button class="btn" data-a="prev" aria-label="Previous step">◀</button>
        <button class="btn" data-a="play" aria-pressed="false">▶ Play</button>
        <button class="btn" data-a="next" aria-label="Next step">▶</button>
        <button class="btn btn-ghost" data-a="last">Show all</button>
        <span class="step-count"></span>
      </div>
      <div class="step-caption" aria-live="polite"></div>`;
    const count = el.querySelector('.step-count'), cap = el.querySelector('.step-caption'), play = el.querySelector('[data-a="play"]');
    const stop = () => { clearInterval(timer); timer = null; play.textContent = '▶ Play'; play.setAttribute('aria-pressed', 'false'); };
    const set = k => {
      i = Math.max(0, Math.min(n - 1, k));
      count.textContent = n ? `Step ${i + 1} of ${n}` : 'No steps';
      cap.innerHTML = n && opts.caption ? opts.caption(i) : '';
      if (n) opts.onStep(i);
    };
    el.querySelector('.stepper').addEventListener('click', e => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
      const act = a.dataset.a;
      if (act === 'play') {
        if (timer) return stop();
        if (i >= n - 1) set(0);
        play.textContent = '❚❚ Pause'; play.setAttribute('aria-pressed', 'true');
        timer = setInterval(() => { if (i >= n - 1) stop(); else set(i + 1); }, opts.speed || 650);
        return;
      }
      stop();
      if (act === 'first') set(0);
      if (act === 'prev') set(i - 1);
      if (act === 'next') set(i + 1);
      if (act === 'last') set(n - 1);
    });
    set(i);
    return { set, stop, get: () => i };
  }

  // Bounding box of a drawing, in turtle units (turtle starts at 0,0).
  function bbox(segs) {
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    for (const s of segs) {
      x0 = Math.min(x0, s.x1, s.x2); x1 = Math.max(x1, s.x1, s.x2);
      y0 = Math.min(y0, s.y1, s.y2); y1 = Math.max(y1, s.y1, s.y2);
    }
    return { x0, y0, x1, y1 };
  }

  /* Draw segments on a canvas with a graph-paper grid and a glow.
     opts: { upto: number of segments to draw, turtle: {x, y, h} | null, box: bbox to fit (keeps zoom steady while animating) } */
  function draw(canvas, segs, opts = {}) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 400, h = canvas.clientHeight || 400;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080a17';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120,130,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0.5; x < w; x += 24) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = 0.5; y < h; y += 24) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    const b = opts.box || bbox(segs);
    const pad = 28, bw = Math.max(b.x1 - b.x0, 1), bh = Math.max(b.y1 - b.y0, 1);
    const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, 2.5);
    const ox = w / 2 - ((b.x0 + b.x1) / 2) * scale, oy = h / 2 - ((b.y0 + b.y1) / 2) * scale;
    const X = x => ox + x * scale, Y = y => oy + y * scale;

    const upto = opts.upto === undefined ? segs.length : opts.upto;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;
    ctx.shadowBlur = segs.length > 4000 ? 0 : 9;
    for (let k = 0; k < upto && k < segs.length; k++) {
      const s = segs[k], col = TC.COLORS[s.color] || '#fff';
      ctx.strokeStyle = col; ctx.shadowColor = col;
      ctx.beginPath(); ctx.moveTo(X(s.x1), Y(s.y1)); ctx.lineTo(X(s.x2), Y(s.y2)); ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // start point
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(X(0), Y(0), 3, 0, Math.PI * 2); ctx.fill();

    if (opts.turtle) {
      const t = opts.turtle, r = t.h * Math.PI / 180, cx = X(t.x), cy = Y(t.y), sz = 11;
      const pt = (a, d) => [cx + Math.sin(r + a) * d, cy - Math.cos(r + a) * d];
      ctx.fillStyle = '#3ee08f'; ctx.strokeStyle = '#0b0d1c'; ctx.lineWidth = 2;
      ctx.beginPath();
      const p1 = pt(0, sz), p2 = pt(2.5, sz * 0.8), p3 = pt(-2.5, sz * 0.8);
      ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    return { scale };
  }

  window.TCUI = { phases, esc, register, ideas, message, stepper, bbox, draw };
})();
