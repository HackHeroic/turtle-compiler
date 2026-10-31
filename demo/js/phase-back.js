/* Phase 5 (code optimization) and Phase 6 (code generation).
   Every fact on screen comes from window.TC (js/compiler.js). Page helpers come from window.TCUI. */
(function () {
  'use strict';
  const TC = window.TC, UI = window.TCUI, esc = UI.esc;

  // ---------- Shared helpers ----------
  const fmt = n => Number(n).toLocaleString('en-US');
  const cd = s => `<code>${esc(s)}</code>`;
  const ROUND_CAP = 60; // optimize() in compiler.js runs at most 60 rounds

  // Keep a row in view by scrolling its own box. The page itself never scrolls.
  function keepVisible(box, row, topPad) {
    if (!box || !row) return;
    const pad = topPad || 0, h = row.offsetHeight;
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientTop + box.scrollTop;
    if (top - pad < box.scrollTop || top + h > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, top - pad - Math.max(0, (box.clientHeight - pad - h) / 2));
    }
  }

  // =====================================================================
  // Phase 5: code optimization
  // =====================================================================
  const OPT = { stepper: null };

  // What each log entry did. Deletions carry no ids in the log, so compare each snapshot with the one before it.
  function optSteps(ir, log) {
    return log.map((e, k) => {
      const prev = k ? log[k - 1].code : ir;
      const now = new Set(e.code.map(c => c.id));
      return {
        rule: e.rule,
        ids: e.ids.slice(),
        removed: prev.filter(c => !now.has(c.id)),
        moved: e.rule === 'O6' ? e.ids.slice() : []
      };
    });
  }

  // For each instruction id: the steps that changed, moved or removed it.
  function optTouches(steps) {
    const map = new Map();
    const add = (id, k) => {
      if (!map.has(id)) map.set(id, []);
      if (!map.get(id).includes(k)) map.get(id).push(k);
    };
    steps.forEach((s, k) => {
      s.ids.forEach(id => add(id, k));
      s.removed.forEach(c => add(c.id, k));
    });
    return map;
  }

  // How each original instruction ended up: removed, changed (same id, new text), moved, or kept.
  function optMarks(ir, after, log) {
    const fin = new Map(after.map(c => [c.id, TC.tacText(c)]));
    const moved = new Set(log.filter(e => e.rule === 'O6').flatMap(e => e.ids));
    const out = new Map();
    ir.forEach(c => {
      const now = fin.get(c.id);
      if (now === undefined) out.set(c.id, { kind: 'removed' });
      else if (now !== TC.tacText(c)) out.set(c.id, { kind: 'changed', now });
      else out.set(c.id, { kind: moved.has(c.id) ? 'moved' : '' });
    });
    return out;
  }

  // Rows that left in one step, shown as ghosts where they used to be. A ghost sits after the
  // row it used to follow, or before the row it used to precede, whichever shared its basic block.
  function optGhosts(prev, cur, movedIds) {
    const keep = new Set(cur.map(c => c.id)), moved = new Set(movedIds || []);
    const blockOf = [];
    TC.basicBlocks(prev).forEach((b, k) => { for (let j = b.start; j <= b.end; j++) blockOf[j] = k; });
    const stays = i => keep.has(prev[i].id) && !moved.has(prev[i].id);
    const after = new Map(), before = new Map();
    const put = (map, id, g) => { if (!map.has(id)) map.set(id, []); map.get(id).push(g); };
    prev.forEach((c, i) => {
      if (stays(i)) return;
      const g = { ins: c, kind: moved.has(c.id) ? 'moved' : 'removed' };
      let p = i - 1, n = i + 1;
      while (p >= 0 && !stays(p)) p--;
      while (n < prev.length && !stays(n)) n++;
      if (p >= 0 && blockOf[p] === blockOf[i]) put(after, prev[p].id, g);
      else if (n < prev.length && blockOf[n] === blockOf[i]) put(before, prev[n].id, g);
      else if (p >= 0) put(after, prev[p].id, g);
      else if (n < prev.length) put(before, prev[n].id, g);
    });
    return { after, before };
  }

  function tacRow(c, cls, extra) {
    return `<div class="pb-row${cls ? ' ' + cls : ''}" data-id="${c.id}" title="From line ${c.line} of your program">` +
      `<span class="pb-id">${c.id}</span><span class="pb-tac${c.op === 'LABEL' ? ' is-label' : ''}">${esc(TC.tacText(c))}</span>${extra || ''}</div>`;
  }

  function ghostRow(g) {
    const from = g.kind === 'moved';
    return `<div class="pb-row pb-ghost ${from ? 'is-from' : 'is-gone'}">` +
      `<span class="pb-id">${g.ins.id}</span><span class="pb-tac${g.ins.op === 'LABEL' ? ' is-label' : ''}">${esc(TC.tacText(g.ins))}</span>` +
      `<span class="pb-flag">${from ? 'moved from here' : 'removed'}</span></div>`;
  }

  // A listing with one shaded group per basic block: block name, successors, rows.
  function tacListing(code, row, ghosts) {
    const extra = (side, id) => (ghosts && ghosts[side].has(id) ? ghosts[side].get(id).map(ghostRow).join('') : '');
    return TC.basicBlocks(code).map((b, i) => {
      let rows = '';
      for (let j = b.start; j <= b.end; j++) rows += extra('before', code[j].id) + row(code[j]) + extra('after', code[j].id);
      const succ = b.succ.length ? '→ ' + b.succ.join(', ') : 'no successor';
      return `<div class="pb-blk${i % 2 ? ' is-alt' : ''}"><div class="pb-blk-head"><b>${b.name}</b><span>${succ}</span></div>${rows}</div>`;
    }).join('');
  }

  // Log messages are plain text. Put the code parts in <code> without changing a word.
  function optMsg(msg) {
    let m = msg.match(/^(.+?) {2}→ {2}(.+?)( \(.+\))?$/);
    if (m) return `${cd(m[1])} → ${cd(m[2])}${m[3] ? esc(m[3]) : ''}`;
    m = msg.match(/^(.+?) (deleted: |moved out of )(.*)$/);
    if (m) return `${cd(m[1])} ${esc(m[2] + m[3])}`;
    m = msg.match(/^(REPEAT \S+)(.*)$/);
    if (m) return `${cd(m[1])}${esc(m[2])}`;
    return esc(msg);
  }

  function optCaption(e) {
    return `<span class="tag">${e.rule}</span> <b>${esc(TC.OPT_RULES[e.rule])}</b>: ${optMsg(e.msg)} <span class="faint">(line ${e.line})</span>`;
  }

  function optStats(r) {
    const s = r.opt.stats, lim = TC.LIMITS.STEPS, rounds = r.opt.rounds;
    const num = (v, capped) => fmt(v) + (capped && v >= lim ? '+' : '');
    const pair = (a, b, capped) => {
      const w = a > 0 ? Math.max(3, Math.min(100, Math.round(b / a * 100))) : 100;
      const d = a - b;
      const delta = capped ? `A run stopped at ${fmt(lim)} steps`
        : d > 0 ? `${fmt(d)} fewer · ${Math.round(d / a * 100)}% less`
        : d < 0 ? `${fmt(-d)} more` : 'No change';
      const len = Math.max(num(a, capped).length, num(b, capped).length);
      const size = len > 7 ? ' is-long' : len > 5 ? ' is-mid' : '';
      return `<div class="pb-big${size}"><span class="pb-was">${num(a, capped)}</span><span class="pb-to" aria-label="becomes">→</span><span class="pb-now">${num(b, capped)}</span></div>` +
        `<div class="pb-bars" aria-hidden="true"><i></i><i class="is-now" style="width:${w}%"></i></div><div class="pb-delta">${delta}</div>`;
    };
    const tile = (cls, label, body, sub) =>
      `<div class="pb-tile ${cls}"><div class="pb-tile-k">${label}</div>${body}<p class="pb-tile-sub">${sub}</p></div>`;
    const same = s.limitHit
      ? ['is-warn', '?', 'Too big to compare', `A run reached the ${fmt(lim)}-step limit, so the two drawings were not compared.`]
      : s.same ? ['is-good', '✓', 'Same drawing', 'Both versions ran on the VM and drew the same lines.']
        : ['is-bad', '✗', 'Different drawing', 'The two versions drew different lines.'];
    const capped = rounds >= ROUND_CAP;
    const dots = rounds <= 12
      ? Array.from({ length: rounds }, (_, i) => `<i${!capped && i === rounds - 1 ? ' class="is-last"' : ''}></i>`).join('') : '';
    return `<div class="pb-stats">
      ${tile('is-code', 'Instructions', pair(s.before, s.after, false), 'Three-address instructions. Labels are not counted.')}
      ${tile('is-steps', 'Machine steps', pair(s.stepsBefore, s.stepsAfter, s.limitHit), 'Instructions the VM runs to finish the drawing.')}
      ${tile('is-check ' + same[0], 'Check', `<div class="pb-big"><span class="pb-mark" aria-hidden="true">${same[1]}</span><span class="pb-same-t">${same[2]}</span></div>`, same[3])}
      ${tile('is-rounds', 'Rounds', `<div class="pb-big"><span class="pb-now">${rounds}</span><span class="pb-dots" aria-hidden="true">${dots}</span></div>`,
        capped ? `Stopped at the safety cap of ${ROUND_CAP} rounds.` : `Round ${rounds} changed nothing, so the optimizer stopped.`)}
    </div>`;
  }

  // The "Optimizer playground" sample button, if app.js put one in #samples.
  function playgroundButton() {
    const box = document.getElementById('samples');
    if (!box) return null;
    return [...box.querySelectorAll('button, [role="button"], a')].find(b => /playground/i.test(b.textContent || '')) || null;
  }

  function optEmpty(r) {
    const btn = playgroundButton() ? '<button type="button" class="btn pb-try">Load the Optimizer playground</button>' : '';
    return `<div class="card pb-work">
      <h3 class="card-title">The optimizer at work</h3>
      <div class="msg msg-good pb-none"><strong>Nothing to optimize in this program.</strong>
        <span class="muted">None of the six rules applies, so phase 6 gets this code unchanged. Try the "Optimizer playground" example: it uses all six rules.</span>${btn}</div>
      <h4 class="pb-side-t">Code and basic blocks <span>${r.opt.stats.after} instructions · ${TC.basicBlocks(r.opt.code).length} blocks</span></h4>
      <div class="pb-lst scroll-y">${tacListing(r.opt.code, c => tacRow(c, ''))}</div>
    </div>`;
  }

  function optRender(el, r) {
    if (OPT.stepper) { OPT.stepper.stop(); OPT.stepper = null; }
    const ir = r.ir, after = r.opt.code, log = r.opt.log;

    if (!log.length) {
      el.innerHTML = optStats(r) + optEmpty(r);
      const t = el.querySelector('.pb-try');
      if (t) t.addEventListener('click', () => { const b = playgroundButton(); if (b) b.click(); });
      return;
    }

    const steps = optSteps(ir, log), touches = optTouches(steps), marks = optMarks(ir, after, log);
    const orig = new Map(ir.map(c => [c.id, TC.tacText(c)]));
    const used = {};
    log.forEach(e => { used[e.rule] = (used[e.rule] || 0) + 1; });

    // Before: the phase 4 code, marked with what finally happened to each line and the rules that touched it.
    const before = tacListing(ir, c => {
      const m = marks.get(c.id), seen = new Set();
      const tags = (touches.get(c.id) || [])
        .filter(k => !seen.has(steps[k].rule) && seen.add(steps[k].rule))
        .map(k => `<button type="button" class="pb-rtag" data-step="${k}" title="Step ${k + 1}: ${esc(log[k].msg)}">${steps[k].rule}</button>`).join('');
      const now = m.kind === 'changed' ? `<span class="pb-new">→ ${esc(m.now)}</span>` : '';
      return tacRow(c, m.kind ? 'is-' + m.kind : '', `${now}${tags ? `<span class="pb-tags">${tags}</span>` : ''}`);
    });

    el.innerHTML = `${optStats(r)}
      <div class="card pb-work">
        <h3 class="card-title">The optimizer at work</h3>
        <p class="card-sub">Each step is one entry from the optimizer's log. Go back to step 1 and play it through.</p>
        <div class="pb-chips" role="group" aria-label="Rules used. Pick one to jump to its steps.">
          <span class="pb-chips-k">Rules used</span>
          ${Object.keys(TC.OPT_RULES).map(k => `<button type="button" class="pb-rchip" data-rule="${k}" title="${esc(TC.OPT_RULES[k])}"${used[k] ? '' : ' disabled'}><b>${k}</b> ×${used[k] || 0}</button>`).join('')}
        </div>
        <div class="pb-step"></div>
        <div class="pb-cmp">
          <div class="pb-side">
            <h4 class="pb-side-t">Before <span>Phase 4 output · ${r.opt.stats.before} instructions · ${TC.basicBlocks(ir).length} blocks</span></h4>
            <div class="pb-lst scroll-y" data-side="before">${before}</div>
          </div>
          <div class="pb-side">
            <h4 class="pb-side-t" data-t="after">After</h4>
            <div class="pb-lst scroll-y" data-side="after"></div>
          </div>
        </div>
        <div class="pb-legend">
          <span class="pb-key k-gone">removed</span><span class="pb-key k-changed">changed</span>
          <span class="pb-key k-moved">moved</span><span class="pb-key k-step">this step</span>
          <span>Numbers are instruction ids from phase 4, so a row keeps its number when it changes or moves. Click a rule tag to jump to that step.</span>
        </div>
      </div>`;

    const beforeBox = el.querySelector('[data-side="before"]'), afterBox = el.querySelector('[data-side="after"]');
    const afterT = el.querySelector('[data-t="after"]'), chips = [...el.querySelectorAll('.pb-rchip')];
    const beforeRows = [...beforeBox.querySelectorAll('.pb-row')];

    // After: the snapshot from log entry k, with this step's rows lit and the rows it removed shown as ghosts.
    const show = k => {
      const e = log[k], s = steps[k], prev = k ? log[k - 1].code : ir;
      const hot = new Set(e.ids), movedSoFar = new Set();
      for (let j = 0; j <= k; j++) steps[j].moved.forEach(id => movedSoFar.add(id));
      afterBox.innerHTML = tacListing(e.code, c => {
        const changed = orig.get(c.id) !== TC.tacText(c), moved = movedSoFar.has(c.id);
        const cls = [hot.has(c.id) && 'is-step', changed && 'is-changed', moved && 'is-moved'].filter(Boolean).join(' ');
        const flag = changed ? '<span class="pb-flag">changed</span>' : moved ? '<span class="pb-flag">moved</span>' : '';
        return tacRow(c, cls, flag);
      }, optGhosts(prev, e.code, s.moved));
      const n = e.code.filter(c => c.op !== 'LABEL').length;
      afterT.innerHTML = `After <span>${k === log.length - 1 ? 'Final code' : `Step ${k + 1} of ${log.length}`} · ${n} instructions · ${TC.basicBlocks(e.code).length} blocks</span>`;
      const touched = new Set([...s.ids, ...s.removed.map(c => c.id)]);
      beforeRows.forEach(row => row.classList.toggle('is-focus', touched.has(+row.dataset.id)));
      chips.forEach(c => c.classList.toggle('is-on', c.dataset.rule === e.rule));
      keepVisible(afterBox, afterBox.querySelector('.is-step') || afterBox.querySelector('.pb-ghost'));
      keepVisible(beforeBox, beforeBox.querySelector('.is-focus'));
    };

    const stepper = UI.stepper(el.querySelector('.pb-step'), { count: log.length, speed: 1100, caption: k => optCaption(log[k]), onStep: show });
    OPT.stepper = stepper;
    const go = k => { stepper.stop(); stepper.set(k); };

    beforeBox.addEventListener('click', e => {
      const b = e.target.closest('[data-step]');
      if (b) go(+b.dataset.step);
    });
    // A rule chip jumps to that rule's first step; pressing it again walks through its other steps.
    el.querySelector('.pb-chips').addEventListener('click', e => {
      const b = e.target.closest('[data-rule]');
      if (!b || b.disabled) return;
      const rule = b.dataset.rule, cur = stepper.get();
      const ks = steps.map((s, k) => (s.rule === rule ? k : -1)).filter(k => k >= 0);
      const later = ks.find(k => k > cur);
      go(steps[cur].rule === rule && later !== undefined ? later : ks[0]);
    });
  }

  function optRules(el) {
    const R = TC.OPT_RULES, pen0 = TC.START.pen === 'PENDOWN' ? 'down' : 'up';
    const ex = (a, b, why) => `<div class="pb-ex"><code class="pb-ex-a">${esc(a)}</code><span class="pb-ex-to" aria-hidden="true">→</span>` +
      (b === null ? '<span class="pb-ex-del">deleted</span>' : `<code class="pb-ex-b">${esc(b)}</code>`) +
      (why ? `<span class="pb-ex-why">${why}</span>` : '') + '</div>';
    const rule = (k, what, body) =>
      `<li class="pb-rule"><div class="pb-rule-h"><span class="tag">${k}</span><b>${esc(R[k])}</b></div><p>${what}</p>${body}</li>`;

    // The O6 picture comes from the real compiler, so it always matches what the code does.
    const demo = TC.compile('REPEAT 6 {\n  PEN YELLOW;\n  TURN 60;\n  MOVE 60;\n}');
    const lines = list => list.slice(0, 5).map(c => `<div${c.op === 'COLOR' ? ' class="pb-hl"' : ''}>${esc(TC.tacText(c))}</div>`).join('');
    const o6 = demo.ir
      ? `<div class="pb-mini"><div class="pb-mini-code" aria-label="Before O6">${lines(demo.ir)}</div><span class="pb-ex-to" aria-hidden="true">→</span><div class="pb-mini-code" aria-label="After O6">${lines(demo.opt.code)}</div></div>`
      : '';

    el.innerHTML = `<div class="card pb-rules">
      <h3 class="card-title">Rules we set</h3>
      <p class="card-sub">Six rules make the code shorter or faster. None of them changes the drawing.</p>
      <ol class="pb-rule-list">
        ${rule('O1', `A name made with ${cd('SET')} never changes, so its value replaces the name in moves, turns and loop counts.`,
          `<div class="pb-exs">${ex('move side', 'move 150')}</div>`)}
        ${rule('O2', 'Deletes code whose result is never used.',
          `<div class="pb-exs">${ex('side = 150', null, 'once nothing reads side')}${ex('color BLUE', null, `when ${cd('color PINK')} replaces it before anything is drawn`)}</div>
          <p class="pb-note">A colour or pen command also goes when nothing is drawn after it: the program reaches ${cd('halt')} with no move, label or jump in between.</p>`)}
        ${rule('O3', `Deletes code that changes nothing: setting what is already set, or turning a full circle. The turtle starts with the pen ${pen0} and the colour ${esc(TC.START.color)}.`,
          `<div class="pb-exs">${ex('pendown', null, 'when the pen is already down')}${ex('turn 360', null, 'a full turn faces the same way')}</div>`)}
        ${rule('O4', 'Joins neighbouring instructions, looking through a small window.',
          `<div class="pb-exs">${ex('move 60; move 60', 'move 120')}${ex('turn 100; turn 44', 'turn 144')}${ex('turn 270', 'turn -90', 'same heading, shorter turn')}</div>
          <p class="pb-note">A merge only happens if the total stays within 32767, so it fits the 16-bit operand. Every turn ends up between -179 and 180 degrees.</p>`)}
        ${rule('O5', 'Removes loop code that does no useful work.',
          `<div class="pb-exs">${ex('REPEAT 1 { body }', 'body', 'the counter, labels, test and jumps go')}${ex('REPEAT 3 { }', null, 'the whole loop goes')}</div>`)}
        ${rule('O6', 'Moves a colour or pen command out in front of its loop, so it runs once instead of every time round.',
          `${o6}<p class="pb-note">It must be the only command of its kind in the loop body (the only colour command, or the only pen command) and come before any move or inner loop. This is safe because rule S6 makes every loop run at least once.</p>`)}
      </ol>

      <h4 class="pb-h">Basic blocks</h4>
      <p class="pb-p">A basic block is a straight run of code. Control enters at its first instruction and leaves at its last. Each block starts at a leader:</p>
      <ul class="pb-leaders"><li>the first instruction</li><li>every label</li><li>every instruction right after a jump</li></ul>
      <p class="pb-p">The colour and pen check in O2, plus O3 and O4, only look inside one block. A label can be reached from more than one place, so at a label the optimizer forgets the pen and colour. O1 and the unused-SET check in O2 look at the whole program. That is safe because a name is SET only once (rule S2). O5 and O6 work on whole loops.</p>

      <h4 class="pb-h">Rounds until nothing changes</h4>
      <p class="pb-p">One round runs O1 to O6 in order. One change can open the door for another. In ${cd('MOVE 10; REPEAT 1 { MOVE 20; }')}, round 1 removes the loop (O5), round 2 merges the two moves into ${cd('move 30')} (O4), and round 3 finds nothing. The optimizer stops after a round that changes nothing, or after ${ROUND_CAP} rounds as a safety cap.</p>

      <h4 class="pb-h">We check our work</h4>
      <p class="pb-p">${cd('compile()')} also makes machine code from the unoptimized code. Both versions run on the VM and we compare the lines they draw. Touching lines of the same colour that carry on in the same direction are joined first, so ${cd('move 120')} counts the same as ${cd('move 60; move 60')}.</p>
    </div>`;
  }

  function optImprove(el) {
    UI.ideas(el, [
      { title: 'Loop unrolling', level: 'medium', text: `Copy the body of a short loop out n times and drop the loop. The code gets longer, but the machine skips the ${cd('LDI')}, ${cd('JLE')}, ${cd('DEC')} and ${cd('JMP')} steps. It trades code size for speed.` },
      { title: 'Spot loops that draw nothing', level: 'medium', text: `${cd('REPEAT 4 { TURN 90; }')} turns a full circle and draws nothing, but it still runs 4 times. Add up the turns in the body, multiply by the count, and keep one turn (here, none).` },
      { title: 'Data-flow analysis across blocks', level: 'hard', text: 'Reaching definitions and liveness analysis follow values across labels and jumps. With them, dead code elimination could work across loops, not just inside one basic block.' }
    ]);
  }

  // =====================================================================
  // Phase 6: code generation
  // =====================================================================
  const GEN = { raf: 0, ro: null, token: 0, speed: null };
  const FAMILY = { FWD: 'move', RGT: 'move', LFT: 'move', COL: 'pen', PUP: 'pen', PDN: 'pen', LDI: 'reg', DEC: 'reg', JLE: 'jump', JMP: 'jump', HLT: 'halt' };
  const FAMILY_NAMES = { move: 'movement', pen: 'pen and colour', reg: 'registers', jump: 'jumps', halt: 'halt' };
  const SPEEDS = [1, 2, 4, 8, 15, 30, 60, 120, 250, 500, 1000, 2500, 10000, 50000, 250000]; // steps per second
  const ROW_H = 26; // listing row height in px, passed to the CSS as --pb-rh
  const LANE = 8;   // px between jump-arrow lanes

  // Stop the animation and observers from the previous render.
  function genStop() {
    GEN.token++;
    if (GEN.raf) cancelAnimationFrame(GEN.raf);
    GEN.raf = 0;
    if (GEN.ro) GEN.ro.disconnect();
    GEN.ro = null;
  }

  const short = n => (n < 10000 ? fmt(n) : n < 1e6 ? Math.round(n / 1000) + 'k' : (n / 1e6).toFixed(1) + 'M');
  const f1 = v => { const s = (Math.round(v * 10) / 10).toFixed(1); return s === '-0.0' ? '0.0' : s; };
  const famVar = mn => `var(--pb-${FAMILY[mn] || 'halt'})`;

  function labelsAt(labels) {
    const at = {};
    Object.keys(labels).forEach(L => { (at[labels[L]] = at[labels[L]] || []).push(L); });
    return at;
  }

  // One arrow per jump. Shorter jumps take the inner lanes so arrows never cross.
  function jumpArrows(prog) {
    const arrows = prog.filter(p => p.mn === 'JLE' || p.mn === 'JMP')
      .map(p => ({ from: p.addr, to: p.operand, mn: p.mn, lo: Math.min(p.addr, p.operand), hi: Math.max(p.addr, p.operand) }))
      .sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo) || a.lo - b.lo);
    const lanes = [];
    arrows.forEach(a => {
      let k = 0;
      while (lanes[k] && lanes[k].some(o => a.lo <= o.hi && o.lo <= a.hi)) k++;
      (lanes[k] = lanes[k] || []).push(a);
      a.lane = k;
    });
    return { arrows, lanes: lanes.length };
  }

  function arrowsSVG(prog) {
    const { arrows, lanes } = jumpArrows(prog);
    const W = lanes ? lanes * LANE + 14 : 8, H = prog.length * ROW_H, x0 = W - 3;
    const y = i => i * ROW_H + ROW_H / 2;
    const g = arrows.map(a => {
      const x = W - 10 - a.lane * LANE, y1 = y(a.from), y2 = y(a.to), d = y2 > y1 ? 1 : -1, r = 4;
      return `<g class="pb-jmp${a.mn === 'JLE' ? ' is-cond' : ''}" data-from="${a.from}">` +
        `<path class="pb-jmp-line" d="M${x0} ${y1}H${x + r}Q${x} ${y1} ${x} ${y1 + d * r}V${y2 - d * r}Q${x} ${y2} ${x + r} ${y2}H${x0 - 4}"/>` +
        `<path class="pb-jmp-head" d="M${x0 - 5} ${y2 - 3.5}L${x0} ${y2}L${x0 - 5} ${y2 + 3.5}Z"/></g>`;
    }).join('');
    return { W, svg: `<svg class="pb-jumps" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${g}</svg>` };
  }

  // "LDI  R1, #5" -> mnemonic + operands, with a swatch for COL.
  function insHTML(p) {
    const i = p.text.indexOf(' ');
    const mn = i < 0 ? p.text : p.text.slice(0, i), rest = i < 0 ? '' : p.text.slice(i).trim();
    const sw = p.mn === 'COL' ? `<i class="pb-sw" style="--sw:${TC.COLORS[p.color]}"></i>` : '';
    return `<b class="pb-mn">${esc(mn)}</b>${rest ? ' ' + esc(rest) : ''}${sw}`;
  }

  function asmRow(p, at) {
    const [op, reg, hi, lo] = p.bytes;
    const byte = (b, cls) => `<span class="${b ? cls : 'by-z'}">${TC.hex(b, 2)}</span>`;
    const bytes = `<b class="by-op">${TC.hex(op, 2)}</b> ${byte(reg, 'by-reg')} ${byte(hi, 'by-v')} ${byte(lo, 'by-v')}`;
    const cmt = '; ' + TC.tacText(p.from);
    return `<div class="pb-arow f-${FAMILY[p.mn] || 'halt'}" role="row" data-addr="${p.addr}">` +
      `<span class="pb-gut" aria-hidden="true"></span><span class="pb-addr" role="cell">${TC.hex(p.addr, 4)}</span>` +
      `<span class="pb-lab" role="cell">${(at[p.addr] || []).join(' ')}</span><span class="pb-bytes" role="cell">${bytes}</span>` +
      `<span class="pb-ins" role="cell">${insHTML(p)}</span><span class="pb-cmt" role="cell" title="${esc(cmt)}">${esc(cmt)}</span>` +
      `<span class="pb-runs" role="cell"></span></div>`;
  }

  function asmListing(r) {
    const at = labelsAt(r.gen.labels), { W, svg } = arrowsSVG(r.gen.prog);
    const h = s => `<span role="columnheader"><i>${s}</i></span>`;
    const head = `<div class="pb-arow pb-ahead" role="row"><span class="pb-gut" aria-hidden="true"></span>${['Addr', 'Label', 'Bytes', 'Assembly', 'From TAC', 'Runs'].map(h).join('')}</div>`;
    return `<div class="pb-asm scroll-x" role="table" aria-label="Machine code listing" style="--pb-rh:${ROW_H}px;--pb-gut:${W}px">` +
      `<div class="pb-atable">${head}<div class="pb-abody" role="rowgroup">${svg}${r.gen.prog.map(p => asmRow(p, at)).join('')}</div></div></div>`;
  }

  function cpuHTML(used) {
    const cell = (k, label, span, extra) =>
      `<div class="pb-cell s${span}${/^r\d$/.test(k) && !used.has(+k[1]) ? ' is-idle' : ''}" data-c="${k}"><span class="pb-ck">${label}</span><b class="pb-cv" data-v="${k}"></b>${extra || ''}</div>`;
    const reg = n => cell('r' + n, 'R' + n, 2, used.has(n) ? '' : '<span class="pb-idle" title="This program does not use it">unused</span>');
    return `<div class="pb-cpu">
      <div class="pb-now" data-c="now"><span class="pb-ck">Just ran</span><b class="pb-cv" data-v="now"></b></div>
      <div class="pb-cells">
        ${cell('pc', 'PC', 3)}${cell('steps', 'Steps', 3, '<i class="pb-prog" aria-hidden="true"><i></i></i>')}
        ${reg(1)}${reg(2)}${reg(3)}
        ${cell('x', 'X', 3)}${cell('y', 'Y', 3)}
        ${cell('h', 'Heading', 2, '<i class="pb-dial" aria-hidden="true"><i></i></i>')}${cell('pen', 'Pen', 2)}${cell('col', 'Colour', 2)}
      </div>
      <p class="pb-cpu-note">Heading 0 points up. Y grows downward, like screen pixels.</p>
    </div>`;
  }

  function tablesHTML(r) {
    const regs = r.gen.regs.length
      ? `<table class="tbl pb-small"><thead><tr><th>Counter</th><th>Register</th><th>REPEAT on line</th></tr></thead><tbody>${r.gen.regs.map(g =>
        `<tr><td><code>${esc(g.temp)}</code></td><td><b class="pb-reg">${g.reg}</b> <span class="faint">depth ${g.reg.slice(1)}</span></td><td>${g.line}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No loops, so no registers are needed.</p>';
    const names = Object.keys(r.gen.labels);
    const usedBy = L => r.gen.prog.filter(p => p.label === L).map(p => `${p.mn} at ${TC.hex(p.addr, 4)}`).join(', ');
    const labels = names.length
      ? `<table class="tbl pb-small"><thead><tr><th>Label</th><th>Address</th><th>Filled into</th></tr></thead><tbody>${names.map(L =>
        `<tr><td><code>${esc(L)}</code></td><td class="mono">${TC.hex(r.gen.labels[L], 4)}</td><td class="mono">${usedBy(L) || '<span class="faint">no jump</span>'}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No labels, so pass 2 has no jumps to fill in.</p>';
    return `<div class="card pb-tables"><div class="pb-two">
      <div><h4 class="pb-h">Register allocation</h4><p class="pb-hint">A loop at depth d gets register Rd.</p><div class="scroll-x">${regs}</div></div>
      <div><h4 class="pb-h">Labels and backpatching</h4><p class="pb-hint">Pass 1 notes each label's address. Pass 2 writes it into the jumps.</p><div class="scroll-x">${labels}</div></div>
    </div></div>`;
  }

  // Run the machine to the end once, like TC.run, but also count how often each instruction ran.
  function runAll(prog) {
    const vm = TC.makeVM(prog), counts = new Uint32Array(prog.length);
    let last = null;
    while (!vm.state.halted && vm.state.steps < TC.LIMITS.STEPS) {
      const s = vm.step();
      if (!s) break;
      counts[s.at]++;
      last = s;
    }
    return { vm, counts, last };
  }

  // Which readout cells the last instruction changed (or read, for JLE).
  function hitCells(last, st) {
    const p = last.ins;
    switch (p.mn) {
      case 'FWD': return ['x', 'y'];
      case 'RGT': case 'LFT': return ['h'];
      case 'COL': return ['col'];
      case 'PUP': case 'PDN': return ['pen'];
      case 'LDI': case 'DEC': return ['r' + p.reg];
      case 'JLE': return st.pc === p.operand ? ['r' + p.reg, 'pc'] : ['r' + p.reg];
      case 'JMP': return ['pc'];
      default: return [];
    }
  }

  // Default speed: the whole run takes about 6 seconds.
  function autoSpeed(total) {
    let i = 2;
    while (i < SPEEDS.length - 1 && total / SPEEDS[i] > 6) i++;
    return i;
  }

  function genRender(el, r) {
    genStop();
    const token = GEN.token;
    const prog = r.gen.prog, total = r.run.steps, lim = TC.LIMITS.STEPS;
    const box = UI.bbox(r.run.segments); // fixed zoom, so the picture does not jump while it grows
    const used = new Set(r.gen.regs.map(g => +g.reg.slice(1)));
    const fin = runAll(prog);
    const speedIdx = GEN.speed !== null ? GEN.speed : autoSpeed(total);
    const fams = Object.keys(FAMILY_NAMES).map(f => `<span class="pb-fam" style="--fc:var(--pb-${f})">${FAMILY_NAMES[f]}</span>`).join('');

    el.innerHTML = `
      <div class="card pb-vm">
        <h3 class="card-title">Turtle VM</h3>
        <p class="card-sub">The machine code below runs here, one instruction at a time. The row that just ran lights up.</p>
        ${r.run.limitHit ? `<div class="msg msg-warn pb-limit"><strong>The machine stopped after ${fmt(lim)} steps.</strong><span class="muted">That is the step limit (TC.LIMITS.STEPS), so this drawing is cut short.</span></div>` : ''}
        <div class="pb-ctl" role="group" aria-label="Turtle VM controls">
          <button type="button" class="btn pb-run" data-a="run" aria-pressed="false">▶ Run</button>
          <button type="button" class="btn" data-a="step">Step</button>
          <button type="button" class="btn btn-ghost" data-a="reset">Reset</button>
          <span class="pb-speed"><label for="pb-speed">Speed</label><input id="pb-speed" type="range" min="0" max="${SPEEDS.length - 1}" step="1" value="${speedIdx}"><output for="pb-speed"></output></span>
        </div>
        <div class="pb-vm-grid">
          <div class="pb-stage"><canvas class="pb-canvas" role="img" aria-label="The Turtle VM's drawing"></canvas><span class="pb-status"></span></div>
          ${cpuHTML(used)}
        </div>
        <div class="pb-asm-top"><h4 class="pb-h">Machine code</h4><span class="pb-fams">${fams}</span></div>
        ${asmListing(r)}
        <p class="pb-hint pb-asm-note">Arrows show where each jump goes: dashed for JLE, solid for JMP. Runs counts how many times each instruction ran.</p>
      </div>
      ${tablesHTML(r)}`;

    const q = s => el.querySelector(s);
    const canvas = q('.pb-canvas'), status = q('.pb-status'), runBtn = q('[data-a="run"]');
    const speed = q('#pb-speed'), speedOut = q('output[for="pb-speed"]'), asm = q('.pb-asm'), head = q('.pb-ahead');
    const rows = [...el.querySelectorAll('.pb-arow[data-addr]')], runs = rows.map(row => row.querySelector('.pb-runs'));
    const jumps = {}, V = {}, C = {};
    el.querySelectorAll('.pb-jmp').forEach(g => { jumps[g.dataset.from] = g; });
    el.querySelectorAll('[data-v]').forEach(n => { V[n.dataset.v] = n; });
    el.querySelectorAll('[data-c]').forEach(n => { C[n.dataset.c] = n; });
    const prog1 = C.steps.querySelector('.pb-prog i'), needle = C.h.querySelector('.pb-dial i');

    // mode: 'rest' (finished view after render), 'running', 'paused', 'done'
    const S = { vm: fin.vm, counts: fin.counts, last: fin.last, mode: 'rest', acc: 0, lastT: 0,
      drawCost: 0, lastDraw: 0, exec: null, next: null, hot: null, hits: [], dirty: new Set(), allDirty: true };

    const done = () => S.vm.state.halted || S.vm.state.steps >= lim;
    const fresh = () => {
      S.vm = TC.makeVM(prog);
      S.counts = new Uint32Array(prog.length);
      S.last = null; S.allDirty = true; S.mode = 'paused';
    };
    const stepOnce = () => {
      const s = S.vm.step();
      if (s) { S.counts[s.at]++; S.dirty.add(s.at); S.last = s; }
      return s;
    };
    const setRuns = i => {
      const n = S.counts[i];
      runs[i].textContent = n ? '×' + short(n) : '';
      runs[i].title = n ? `Ran ${fmt(n)} time${n === 1 ? '' : 's'}` : '';
    };
    const toggle = (key, node, cls) => {
      if (S[key] === node) return;
      if (S[key]) S[key].classList.remove(cls);
      if (node) node.classList.add(cls);
      S[key] = node;
    };

    function drawCanvas() {
      const st = S.vm.state, t0 = performance.now();
      UI.draw(canvas, S.mode === 'rest' ? r.run.segments : st.segments, { turtle: { x: st.x, y: st.y, h: st.h }, box });
      S.lastDraw = performance.now();
      S.drawCost = S.lastDraw - t0;
    }

    function paint(forceDraw, follow) {
      const st = S.vm.state, last = S.last;
      V.pc.textContent = TC.hex(st.pc, 4);
      V.steps.innerHTML = `${fmt(st.steps)} <small>of ${fmt(total)}</small>`;
      prog1.style.width = (total ? Math.min(100, st.steps / total * 100) : 0) + '%';
      [1, 2, 3].forEach(n => { V['r' + n].textContent = st.R[n]; });
      V.x.textContent = f1(st.x);
      V.y.textContent = f1(st.y);
      V.h.textContent = st.h + '°';
      needle.style.transform = `rotate(${st.h}deg)`;
      V.pen.textContent = st.pen ? 'down' : 'up';
      V.col.innerHTML = `<i class="pb-sw" style="--sw:${TC.COLORS[st.color]}"></i>${esc(st.color)}`;
      if (last) {
        C.now.style.setProperty('--fc', famVar(last.ins.mn));
        V.now.innerHTML = `<span class="pb-now-l"><span class="pb-now-a">${TC.hex(last.at, 4)}</span> ${insHTML(last.ins)}</span><span class="pb-now-c">; ${esc(TC.tacText(last.ins.from))}</span>`;
      } else {
        C.now.style.removeProperty('--fc');
        V.now.innerHTML = '<span class="pb-now-l faint">nothing yet</span><span class="pb-now-c">Press Run or Step</span>';
      }

      S.hits.forEach(n => n.classList.remove('is-hit'));
      S.hits = last ? hitCells(last, st).map(k => C[k]).filter(Boolean) : [];
      S.hits.forEach(n => { n.style.setProperty('--fc', famVar(last.ins.mn)); n.classList.add('is-hit'); });

      const execRow = last ? rows[last.at] : null;
      toggle('exec', execRow, 'is-exec');
      toggle('next', st.halted ? null : rows[st.pc] || null, 'is-next');
      const taken = last && (last.ins.mn === 'JMP' || (last.ins.mn === 'JLE' && st.pc === last.ins.operand));
      toggle('hot', taken ? jumps[last.at] || null : null, 'is-hot');

      if (S.allDirty) { runs.forEach((_, i) => setRuns(i)); S.allDirty = false; } else S.dirty.forEach(setRuns);
      S.dirty.clear();

      if (follow) keepVisible(asm, execRow || S.next, head.offsetHeight);
      // Big drawings are slow to redraw: then spend at most about a quarter of the time drawing.
      if (forceDraw || performance.now() - S.lastDraw >= S.drawCost * 3) drawCanvas();

      const finished = st.halted ? 'Finished' : 'Step limit reached';
      status.textContent = S.mode === 'running' ? 'Running' : S.mode === 'paused' ? (st.steps ? 'Paused' : 'Ready') : finished;
      status.dataset.s = S.mode === 'running' ? 'run' : S.mode === 'paused' ? 'pause' : st.halted ? 'done' : 'limit';
      runBtn.textContent = S.mode === 'running' ? '❚❚ Pause' : '▶ Run';
      runBtn.setAttribute('aria-pressed', String(S.mode === 'running'));
    }

    function frame(t) {
      GEN.raf = 0;
      if (token !== GEN.token || S.mode !== 'running') return;
      const dt = S.lastT ? Math.min(100, t - S.lastT) : 0;
      S.lastT = t;
      S.acc += SPEEDS[+speed.value] * dt / 1000;
      let n = Math.floor(S.acc);
      S.acc -= n;
      while (n-- > 0 && !done()) stepOnce();
      if (done()) S.mode = 'done';
      paint(S.mode === 'done', true);
      if (S.mode === 'running') GEN.raf = requestAnimationFrame(frame);
    }

    const halt = () => { if (GEN.raf && token === GEN.token) cancelAnimationFrame(GEN.raf); GEN.raf = 0; };
    function play() {
      if (S.mode === 'rest' || done()) fresh();
      S.mode = 'running';
      S.acc = 1; // the first instruction runs straight away
      S.lastT = 0;
      paint(false, false);
      GEN.raf = requestAnimationFrame(frame);
    }
    function pause() { halt(); S.mode = 'paused'; paint(true, false); }
    function step() {
      halt();
      if (S.mode === 'rest' || done()) fresh();
      stepOnce();
      S.mode = done() ? 'done' : 'paused';
      paint(true, true);
    }
    function reset() { halt(); fresh(); asm.scrollTop = 0; paint(true, false); }

    q('.pb-ctl').addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'run') { if (S.mode === 'running') pause(); else play(); }
      else if (b.dataset.a === 'step') step();
      else reset();
    });
    const speedText = () => { speedOut.textContent = `${fmt(SPEEDS[+speed.value])} steps/s`; };
    speed.addEventListener('input', () => { GEN.speed = +speed.value; speedText(); });
    speedText();

    if (typeof ResizeObserver === 'function') {
      GEN.ro = new ResizeObserver(() => { if (token === GEN.token) drawCanvas(); });
      GEN.ro.observe(canvas);
    }
    paint(true, false);
  }

  function genRules(el) {
    const op = mn => '0x' + TC.hex(TC.OPCODES[mn], 2);
    const s0 = TC.makeVM([]).state; // the machine's real starting state
    const ISA = [
      ['FWD', '#n', 'Move forward n steps. Draws a line if the pen is down.', 'move n', ''],
      ['RGT', '#a', 'Turn right (clockwise) by a degrees.', 'turn a', 'a ≥ 0'],
      ['LFT', '#a', 'Turn left by a degrees.', 'turn a', 'a < 0, minus sign dropped'],
      ['COL', '#c', 'Set the colour to colour code c.', 'color C', ''],
      ['PUP', '', 'Pen up: moves stop drawing.', 'penup', ''],
      ['PDN', '', 'Pen down: moves draw again.', 'pendown', ''],
      ['LDI', 'Rr, #n', 'Load the number n into register Rr.', 't = n', ''],
      ['DEC', 'Rr', 'Subtract 1 from register Rr.', 't = t - 1', ''],
      ['JLE', 'Rr, addr', 'Jump to addr if Rr ≤ 0.', 'if t <= 0 goto L', ''],
      ['JMP', 'addr', 'Jump to addr.', 'goto L', ''],
      ['HLT', '', 'Stop the machine.', 'halt', '']
    ];
    const isa = ISA.map(([mn, opd, meaning, from, when]) =>
      `<tr class="f-${FAMILY[mn]}"><td><b class="pb-mn">${mn}</b>${opd ? ` <span class="pb-opd">${esc(opd)}</span>` : ''}</td><td class="mono">${op(mn)}</td>` +
      `<td>${esc(meaning)}</td><td>${cd(from)}${when ? `<br><span class="faint">${esc(when)}</span>` : ''}</td></tr>`).join('');

    // Examples built by the real code generator.
    const demo = TC.compile('REPEAT 5 { MOVE 300; }');
    const pick = mn => demo.gen.prog.find(p => p.mn === mn);
    const fwd = pick('FWD'), ldi = pick('LDI'), jle = pick('JLE');
    const parts = ['opcode', 'register', 'operand high', 'operand low'];
    const enc = p => `<div class="pb-enc f-${FAMILY[p.mn]}"><code class="pb-enc-asm">${esc(p.text)}</code>` +
      `<div class="pb-enc-row">${p.bytes.map((b, i) => `<div class="pb-byte b${i}"><b>${TC.hex(b, 2)}</b><span>${parts[i]}</span></div>`).join('')}</div></div>`;
    const L = jle.label, La = TC.hex(demo.gen.labels[L], 4);

    const cells = list => list.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    el.innerHTML = `<div class="card pb-rules">
      <h3 class="card-title">Rules we set</h3>
      <p class="card-sub">The back end turns optimized three-address code into 4-byte instructions for our own virtual machine, the Turtle VM.</p>

      <h4 class="pb-h">Target machine</h4>
      <div class="pb-mach">
        <div class="pb-mach-g g-ctl"><span class="pb-mach-k">Control</span><div class="pb-mach-cells">${cells([['PC', TC.hex(s0.pc, 4)]])}</div></div>
        <div class="pb-mach-g g-reg"><span class="pb-mach-k">Loop registers</span><div class="pb-mach-cells">${cells([1, 2, 3].map(n => ['R' + n, s0.R[n]]))}</div></div>
        <div class="pb-mach-g g-tur"><span class="pb-mach-k">Turtle</span><div class="pb-mach-cells">${cells([['X', s0.x], ['Y', s0.y], ['Heading', s0.h + '°'], ['Pen', s0.pen ? 'down' : 'up'],
          ['Colour', `<i class="pb-sw" style="--sw:${TC.COLORS[s0.color]}"></i>${esc(s0.color)}`]])}</div></div>
      </div>
      <p class="pb-p">The program counter (PC) holds the address of the next instruction. Registers R1 to R3 hold loop counters and nothing else. The rest is the turtle's state: x, y, heading, pen and colour.</p>
      <p class="pb-p">The turtle starts at (0, 0) facing up, with the pen ${s0.pen ? 'down' : 'up'} and the colour ${esc(s0.color)}. Heading 0 points up and turning right adds degrees. Y grows downward, like screen pixels, so moving up makes y negative.</p>

      <h4 class="pb-h">Instruction set</h4>
      <div class="scroll-x"><table class="tbl pb-isa">
        <thead><tr><th>Instruction</th><th>Opcode</th><th>Meaning</th><th>Made from</th></tr></thead>
        <tbody>${isa}</tbody>
      </table></div>
      <p class="pb-p pb-gap">Every three-address instruction except a label (or a SET line) becomes exactly one machine instruction. A label only marks an address. Picking the machine instruction is called instruction selection: ${cd('turn a')} becomes RGT when a ≥ 0, and LFT without the minus sign when a &lt; 0.</p>

      <h4 class="pb-h">Encoding</h4>
      <p class="pb-p">Every instruction is 4 bytes: the opcode, the register number, and a 16-bit operand split into a high byte and a low byte.</p>
      <div class="pb-encs">${enc(fwd)}${enc(ldi)}</div>
      <p class="pb-p">${fwd.operand} = 0x${TC.hex(fwd.operand, 4)} = ${fwd.operand >> 8} × 256 + ${fwd.operand & 255}, so its operand bytes are ${TC.hex(fwd.bytes[2], 2)} and ${TC.hex(fwd.bytes[3], 2)}. The first hex digit of an opcode gives the family: 1 for movement, 2 for pen and colour, 3 for registers, 4 for jumps. HLT is FF.</p>
      <p class="pb-p">COL's operand is a colour code: the colour's position in this table.</p>
      <div class="pb-ccs">${TC.COLOR_NAMES.map((n, i) => `<span class="pb-cc"><i style="--sw:${TC.COLORS[n]}"></i>${i} ${n}</span>`).join('')}</div>

      <h4 class="pb-h">Register allocation</h4>
      <p class="pb-p">A loop at nesting depth d uses register Rd. Loops side by side reuse the same register, because the first loop is over before the next one starts. Rule S7 limits nesting to ${TC.LIMITS.DEPTH}, so three registers are always enough.</p>

      <h4 class="pb-h">Two passes</h4>
      <p class="pb-p">Pass 1 walks the code, gives each instruction the next address and writes down the address of every label. A jump can point forward to a label that has no address yet. So pass 2 goes back and fills in every jump target. This is backpatching.</p>
      <div class="pb-patch">
        <span class="pb-patch-k">Pass 1</span><code>${TC.hex(jle.addr, 4)}  JLE  R${jle.reg}, <b>${esc(L)}</b></code><span>${esc(L)} has no address yet</span>
        <span class="pb-patch-k">Pass 1</span><code>${La}  ${esc(L)}:</code><span>now ${esc(L)} = ${La}</span>
        <span class="pb-patch-k is-2">Pass 2</span><code>${TC.hex(jle.addr, 4)}  JLE  R${jle.reg}, <b>${La}</b></code><span>target filled in</span>
      </div>
      <p class="pb-hint">From ${cd('REPEAT 5 { MOVE 300; }')}.</p>
    </div>`;
  }

  function genImprove(el) {
    UI.ideas(el, [
      { title: 'A second target', level: 'easy', text: 'Generate an SVG file or JavaScript canvas code from the same optimized code. Only this last phase changes. The front end stays the same.' },
      { title: 'Peephole pass on machine code', level: 'easy', text: 'Slide a small window over the final instructions and swap patterns for cheaper ones, now that real addresses are known. Our TAC optimizer already removes most waste, so this pays off once the language grows, for example with IF statements that jump to jumps.' },
      { title: 'Save a .tvm file', level: 'medium', text: `Write the bytes to a ${cd('.tvm')} file and run them in a separate VM program, for example in C or Python. Every instruction is 4 bytes, so the VM reads 4 at a time.` },
      { title: 'Graph-colouring register allocation', level: 'hard', text: 'Today a loop at depth d simply gets Rd. If variables could change, many values would compete for 3 registers. Liveness analysis plus graph colouring would decide which values can share a register.' }
    ]);
  }

  // helpers: pure functions, exposed so they can be checked in node.
  UI.register('opt', {
    rules: optRules, improve: optImprove, render: optRender,
    helpers: { optSteps, optTouches, optMarks, optGhosts, tacRow, tacListing, optMsg, optCaption, optStats }
  });
  UI.register('gen', {
    rules: genRules, improve: genImprove, render: genRender,
    helpers: { labelsAt, jumpArrows, arrowsSVG, insHTML, asmRow, asmListing, cpuHTML, tablesHTML, runAll, hitCells, autoSpeed }
  });
})();
