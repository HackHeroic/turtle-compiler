/* Phase 3 (semantic analysis) and phase 4 (intermediate code) for the explainer page.
   Every fact on screen comes from js/compiler.js through window.TC. This file only draws it. */
(function () {
  'use strict';
  const TC = window.TC, UI = window.TCUI, esc = UI.esc, LIM = TC.LIMITS;

  /* ===================== Shared helpers ===================== */
  const range = lim => `${lim[0]} to ${lim[1]}`;
  const plural = (n, word) => (n === 1 ? word : word + 's');
  // A source line without its comment. In this language # can only start a comment.
  const srcLine = (r, n) => { const t = r.src.split('\n')[n - 1] || ''; return t.replace(/#.*/, '').trim() || t.trim(); };

  // Keep a highlighted row inside its scroll box. Only the box scrolls, never the page.
  function keepVisible(box, row, headPad) {
    if (!box || !row || !box.clientHeight) return;
    const b = box.getBoundingClientRect(), e = row.getBoundingClientRect();
    const top = e.top - b.top + box.scrollTop, bottom = top + e.height, pad = 10;
    if (top - pad - (headPad || 0) < box.scrollTop) box.scrollTop = Math.max(0, top - pad - (headPad || 0));
    else if (bottom + pad > box.scrollTop + box.clientHeight) box.scrollTop = bottom + pad - box.clientHeight;
  }

  // Stat tiles. list: [{ n, label, tone: 'good' | 'bad' | 'warn' | 'hue' | 'none' }]
  const tiles = (list, small) => `<div class="tcm-stats${small ? ' tcm-stats-sm' : ''}">${list.map(t =>
    `<div class="tcm-stat tcm-t-${t.tone}"><b>${t.n}</b><span>${esc(t.label)}</span></div>`).join('')}</div>`;

  /* ===================== Phase 3: semantic analysis ===================== */

  // Rule groups give each rule tag a colour with a meaning.
  const GROUPS = [
    { key: 'name', label: 'Names' },
    { key: 'type', label: 'Types' },
    { key: 'limit', label: 'Limits' },
    { key: 'warn', label: 'Warnings' }
  ];
  // ex: [code, note] pairs for the "Fails on" line. Numbers come from TC.LIMITS.
  const RULES = {
    S1: { group: 'name', name: 'SET before use', what: 'A name must be SET before it is used.', ex: [['MOVE width;', 'width was never SET']] },
    S2: { group: 'name', name: 'SET only once', what: 'A name can be SET only once. It is a constant.', ex: [['SET side = 5;', 'twice']] },
    S3: { group: 'type', name: 'PEN needs a colour', what: 'PEN needs a colour from the colour table. A number name is not a colour, so this is a type check.', ex: [['PEN GOLD;', 'not in the table'], ['PEN side;', 'side holds a number']] },
    S4: { group: 'limit', name: `MOVE distance ${range(LIM.MOVE)}`, what: `A MOVE distance must be ${range(LIM.MOVE)}.`, ex: [[`MOVE ${LIM.MOVE[1] + 100};`]] },
    S5: { group: 'limit', name: `TURN angle ${range(LIM.TURN)}`, what: `A TURN angle must be ${range(LIM.TURN)}.`, ex: [[`TURN ${LIM.TURN[1] + 40};`]] },
    S6: { group: 'limit', name: `REPEAT count ${range(LIM.REPEAT)}`, what: `A REPEAT count must be ${range(LIM.REPEAT)}.`, ex: [[`REPEAT ${LIM.REPEAT[0] - 1} { … }`]] },
    S7: { group: 'limit', name: `REPEAT nests ${LIM.DEPTH} deep at most`, what: `REPEAT nests at most ${LIM.DEPTH} deep, because the target machine has ${LIM.DEPTH} loop registers, R1 to R${LIM.DEPTH}.`, ex: [[null, `a REPEAT nested ${LIM.DEPTH + 1} deep`]] },
    S8: { group: 'name', name: 'Colour names are reserved', what: "A variable name can't be a colour name.", ex: [['SET red = 5;']] },
    W1: { group: 'warn', name: 'Unused name', what: 'Warning: a name is SET but never used.', ex: [['SET size = 60;', 'and no line uses size']] },
    W2: { group: 'warn', name: 'Empty REPEAT', what: 'Warning: a REPEAT has nothing inside.', ex: [['REPEAT 3 { }']] }
  };
  const MARK = { ok: '✓', error: '✗', warn: '!' };
  const VERDICT = { ok: 'pass', error: 'error', warn: 'warning' };
  const ruleTag = id => `<span class="tcm-rule tcm-g-${RULES[id] ? RULES[id].group : 'warn'}">${esc(id)}</span>`;

  function semRules(el) {
    const rows = Object.keys(RULES).map(id => {
      const R = RULES[id], warn = R.group === 'warn';
      const ex = R.ex.map(([code, note]) => `<span class="tcm-ex-item">${code ? `<code class="tcm-badcode${warn ? ' is-warn' : ''}">${esc(code)}</code>` : ''}${note ? `<span>${esc(note)}</span>` : ''}</span>`).join('');
      return `<tr><td>${ruleTag(id)}</td><td><div class="tcm-what">${esc(R.what)}</div>
        <div class="tcm-ex"><span class="tcm-ex-k ${warn ? 'warn-text' : 'bad-text'}">${warn ? 'Warns on' : 'Fails on'}</span>${ex}</div></td></tr>`;
    }).join('');
    const colours = TC.COLOR_NAMES.map((name, code) => `
      <div class="tcm-color" style="--tcm-sw: ${TC.COLORS[name]}">
        <span class="tcm-swatch"></span>
        <span class="tcm-color-name"><b>${esc(name)}</b><small>${esc(TC.COLORS[name])}</small></span>
        <span class="tcm-code" title="Colour code">${code}</span>
      </div>`).join('');
    el.innerHTML = `
      <div class="card">
        <h3 class="card-title">Rules we set</h3>
        <p class="card-sub">The grammar only checks the shape of a program. These rules check its meaning. Most of them need the symbol table, which remembers what earlier lines SET.</p>
        <div class="tcm-legend">${GROUPS.map(g => `<span class="tcm-g-${g.key}">${g.label}</span>`).join('')}</div>
        <div class="scroll-x"><table class="tbl tcm-rules">
          <thead><tr><th>Rule</th><th>What it checks</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
      <div class="card">
        <h3 class="card-title">Colour table</h3>
        <p class="card-sub">PEN accepts these ${TC.COLOR_NAMES.length} names. The code is the colour's place in the list, counting from 0. Phase 6 writes that number into the machine code.</p>
        <div class="tcm-colors">${colours}</div>
      </div>
      <div class="card">
        <h3 class="card-title">How the checker works</h3>
        <ul class="tcm-notes">
          <li><strong>Errors stop the compiler. Warnings don't.</strong> With only warnings, the program still compiles and draws.</li>
          <li><strong>This phase reports every error it finds.</strong> The parser stops at the first one.</li>
          <li><strong>The symbol table</strong> records each SET name with its type (number), its value, the line it was SET on and the lines that use it.</li>
          <li><strong>W1 runs last.</strong> Only after the whole tree is checked can it know that no line uses a name.</li>
          <li><strong>Case:</strong> colour names work in any case, so <code>PEN blue;</code> is fine. Variable names are case-sensitive: <code>side</code> and <code>Side</code> are two names.</li>
        </ul>
      </div>`;
  }

  function semImprove(el) {
    UI.ideas(el, [
      { title: 'Variables that can change', level: 'hard', text: 'Allow <code>SET side = 5;</code> twice. Then a name holds different values on different lines, so the checker needs scopes and data-flow analysis to know which value reaches each use.' },
      { title: 'Procedures with parameters', level: 'hard', text: '<code>TO square size … END</code> needs a new scope for each procedure, parameters in the symbol table, and a check that every call passes the right number of arguments.' },
      { title: 'Warn when the drawing leaves the page', level: 'medium', text: 'Every value is known at compile time. The checker could follow the turtle through each MOVE and TURN and warn when a line crosses the page edge.' },
      { title: 'Colour variables', level: 'medium', text: '<code>SET c = RED;</code> needs a real type system: a colour type next to number, a type for every name in the symbol table, and a check that each command gets the type it expects.' }
    ]);
  }

  // Which symbol a check talks about. The compiler's check text starts with the name.
  function symbolRef(c, symbols) {
    if (c.defines) return { name: c.defines, kind: 'add' };
    const by = tail => { const s = symbols.find(x => c.text.startsWith(x.name + tail)); return s ? s.name : null; };
    let n = null;
    if (c.rule === 'S1' && c.level === 'ok' && (n = by(' is in the symbol table'))) return { name: n, kind: 'use' };
    if (c.rule === 'S1' && c.level === 'error') {
      const m = c.text.indexOf(' is used but was never SET');
      if (m > 0) return { name: c.text.slice(0, m), kind: 'miss' };
    }
    if (c.rule === 'S2' && c.level === 'error' && (n = by(' was already SET'))) return { name: n, kind: 'dup' };
    if (c.rule === 'S3' && c.level === 'error' && (n = by(' is a number'))) return { name: n, kind: 'type' };
    if (c.rule === 'W1' && (n = by(' is SET but never used'))) return { name: n, kind: 'unused' };
    return null;
  }

  function semModel(r) {
    const refs = r.sem.checks.map(c => symbolRef(c, r.sem.symbols));
    const defAt = new Map();
    refs.forEach((f, k) => { if (f && f.kind === 'add' && !defAt.has(f.name)) defAt.set(f.name, k); });
    return { refs, defAt };
  }

  // The symbol table as the checker knows it right after check i.
  function symbolsAt(r, model, i) {
    return r.sem.symbols.filter(s => model.defAt.has(s.name) && model.defAt.get(s.name) <= i).map(s => {
      const uses = [];
      for (let k = 0; k <= i; k++) {
        const f = model.refs[k], line = r.sem.checks[k].line;
        if (f && f.kind === 'use' && f.name === s.name && !uses.includes(line)) uses.push(line);
      }
      return { sym: s, uses };
    });
  }

  function symTableHTML(r, model, i) {
    const total = r.sem.symbols.length, last = i >= r.sem.checks.length - 1;
    const rows = model ? symbolsAt(r, model, i) : [];
    const f = model && i >= 0 ? model.refs[i] : null;
    let html = rows.map(({ sym, uses }) => {
      const on = f && f.name === sym.name ? f.kind : '';
      const cls = { add: 'is-new', use: 'is-use', dup: 'is-bad', type: 'is-bad', unused: 'is-warn' }[on] || '';
      const now = on === 'use' ? r.sem.checks[i].line : null;
      const usesHTML = uses.length
        ? uses.map(n => `<span class="tcm-use${n === now ? ' is-new' : ''}">${n}</span>`).join('')
        : `<span class="tcm-none-yet${last ? ' warn-text' : ''}">${last ? 'none' : 'none yet'}</span>`;
      return `<tr class="${cls}">
        <td><code class="tcm-name">${esc(sym.name)}</code></td>
        <td><span class="tcm-type${on === 'type' ? ' is-clash' : ''}">${esc(sym.type)}</span></td>
        <td><code class="tcm-val">${esc(sym.value)}</code></td>
        <td><span class="tcm-defline${on === 'dup' ? ' is-clash' : ''}">${sym.line}</span></td>
        <td><span class="tcm-uses${on === 'unused' ? ' is-warn' : ''}">${usesHTML}</span></td></tr>`;
    }).join('');
    if (f && f.kind === 'miss') {
      html += `<tr class="tcm-miss"><td><code class="tcm-name">${esc(f.name)}</code></td><td colspan="4">Looked up on line ${r.sem.checks[i].line}: not in the table.</td></tr>`;
    }
    if (!html) html = `<tr class="tcm-empty"><td colspan="5">${total ? 'Empty so far.' : 'This program puts no names in the table.'}</td></tr>`;
    return html;
  }

  function checkRowsHTML(r) {
    return r.sem.checks.map((c, k) => `
      <button type="button" class="tcm-check lv-${c.level}" data-k="${k}" tabindex="-1">${ruleTag(c.rule)}<span class="tcm-ln">line ${c.line}</span><span class="tcm-ctext">${esc(c.text)}</span><span class="tcm-mark" title="${VERDICT[c.level]}">${MARK[c.level]}</span></button>`).join('');
  }

  function semCaption(r, i) {
    const c = r.sem.checks[i], R = RULES[c.rule];
    return `<div class="tcm-cap tcm-cap-sem">
      <div class="tcm-cap-top">${ruleTag(c.rule)}<strong>${esc(R ? R.name : c.rule)}</strong><span class="tcm-verdict v-${c.level}">${MARK[c.level]} ${VERDICT[c.level]}</span></div>
      <div class="tcm-cap-text">${esc(c.text)}</div>
      <div class="tcm-cap-src"><span class="tcm-ln">Line ${c.line}</span><code>${esc(srcLine(r, c.line))}</code></div>
    </div>`;
  }

  const semState = { stepper: null };

  function semRender(el, r) {
    if (semState.stepper) { semState.stepper.stop(); semState.stepper = null; }
    const S = r && r.sem;
    if (!S) { el.innerHTML = ''; return; }
    const oldBox = el.querySelector('.tcm-checks'), oldScroll = oldBox ? oldBox.scrollTop : 0;
    const checks = S.checks, nOk = checks.filter(c => c.level === 'ok').length;
    const nErr = S.errors.length, nWarn = S.warnings.length;
    const hint = e => `Rule ${e.rule}: ${RULES[e.rule] ? RULES[e.rule].name : ''}`;
    const msgs = S.errors.map(e => UI.message({ ...e, hint: hint(e) }, 'bad'))
      .concat(S.warnings.map(w => UI.message({ ...w, hint: hint(w) }, 'warn'))).join('');
    const stop = nErr ? `<p class="tcm-stop"><strong>The compiler stops here.</strong> Fix ${nErr === 1 ? 'this error' : `these ${nErr} errors`} and phases 4 to 6 run.</p>` : '';
    const empty = r.ast && r.ast.body.length ? 'PENUP and PENDOWN take no values, so no rule applies to them.' : 'The program is empty.';

    el.innerHTML = `<div class="tcm-live">
      ${tiles([
        { n: nOk, label: `${plural(nOk, 'check')} passed`, tone: nOk ? 'good' : 'none' },
        { n: nErr, label: plural(nErr, 'error'), tone: nErr ? 'bad' : 'none' },
        { n: nWarn, label: plural(nWarn, 'warning'), tone: nWarn ? 'warn' : 'none' }
      ])}
      ${stop || msgs ? `<div class="tcm-msgs">${stop}${msgs}</div>` : ''}
      ${checks.length ? `
      <div class="card">
        <h3 class="card-title">Every check, in order</h3>
        <p class="card-sub">The checker walks the tree from top to bottom and records each rule it tests. Click a row to jump to it.</p>
        <div class="tcm-step"></div>
        <div class="tcm-checks">${checkRowsHTML(r)}</div>
      </div>` : `
      <div class="tcm-nothing"><strong>Nothing to check</strong><span class="muted">${empty}</span></div>`}
      <div class="card">
        <h3 class="card-title">Symbol table</h3>
        <p class="card-sub">A row appears when a SET passes its checks. Later lines that look the name up fill in the last column.</p>
        <div class="scroll-x"><table class="tbl tcm-sym">
          <thead><tr><th>Name</th><th>Type</th><th>Value</th><th>SET on line</th><th>Used on lines</th></tr></thead>
          <tbody></tbody>
        </table></div>
      </div>
    </div>`;

    const tbody = el.querySelector('.tcm-sym tbody');
    if (!checks.length) { tbody.innerHTML = symTableHTML(r, null, -1); return; }

    const model = semModel(r), box = el.querySelector('.tcm-checks');
    const rows = Array.from(el.querySelectorAll('.tcm-check'));
    let booting = true;
    const st = UI.stepper(el.querySelector('.tcm-step'), {
      count: checks.length,
      speed: 900,
      caption: i => semCaption(r, i),
      onStep: i => {
        rows.forEach((row, k) => { row.classList.toggle('is-future', k > i); row.classList.toggle('is-current', k === i); });
        tbody.innerHTML = symTableHTML(r, model, i);
        if (!booting) keepVisible(box, rows[i]);
      }
    });
    booting = false;
    box.scrollTop = oldScroll;
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-k]');
      if (b) { st.stop(); st.set(Number(b.dataset.k)); }
    });
    semState.stepper = st;
  }

  /* ===================== Phase 4: intermediate code ===================== */

  const LOOP_TINTS = 4;            // tcm-lp-0 .. tcm-lp-3 in the CSS
  const ROW_H = 26;                // must match .tcm-tac-row height in the CSS
  const LANE_X0 = 6, LANE_W = 10;  // jump-arrow lanes in the left gutter
  const gutterW = depth => (depth ? LANE_X0 + depth * 2 * LANE_W + 10 : 0);

  // Rows for the listing: a label sits in the gutter of the instruction after it.
  // Loops: depth, parent and a tint that differs from every loop around it.
  function layout(ir) {
    const rows = [], where = [];
    let pending = null;
    const place = (lbl, ins) => {
      rows.push({ lbl, ins });
      if (lbl !== null) where[lbl] = rows.length - 1;
      if (ins !== null) where[ins] = rows.length - 1;
    };
    ir.forEach((c, i) => {
      if (c.op === 'LABEL') { if (pending !== null) place(pending, null); pending = i; } else { place(pending, i); pending = null; }
    });
    if (pending !== null) place(pending, null);

    const loops = [], byNum = new Map(), open = [];
    let maxDepth = 0;
    ir.forEach((c, i) => {
      if (c.loop === undefined) return;
      let lp = byNum.get(c.loop);
      if (!lp) {
        lp = { n: c.loop, depth: open.length + 1, parent: open.length ? open[open.length - 1] : null, line: c.line, at: {} };
        byNum.set(c.loop, lp); loops.push(lp); open.push(lp);
        maxDepth = Math.max(maxDepth, lp.depth);
      }
      lp.at[c.role] = i;
      if (c.role === 'init') { lp.temp = c.res; lp.count = c.a1; }
      if (c.role === 'head') lp.top = c.res;
      if (c.role === 'exit') { lp.out = c.res; if (open[open.length - 1] === lp) open.pop(); }
    });
    // Avoid the tints of the loops around this one and of the sibling just before it.
    // Depth is at most 3, so at most 3 tints are taken and one of the 4 is always free.
    loops.forEach((lp, k) => {
      const taken = new Set();
      for (let p = lp.parent; p; p = p.parent) taken.add(p.tint);
      const sib = loops.slice(0, k).reverse().find(o => o.parent === lp.parent);
      if (sib) taken.add(sib.tint);
      let t = (lp.n - 1) % LOOP_TINTS;
      while (taken.has(t) && taken.size < LOOP_TINTS) t = (t + 1) % LOOP_TINTS;
      lp.tint = t;
    });
    const loopOf = i => (ir[i] && ir[i].loop !== undefined ? byNum.get(ir[i].loop) || null : null);
    return { rows, where, loops, maxDepth, loopOf };
  }

  // The tree statement behind each instruction, in the same order genIR walks the tree.
  function irStatements(r) {
    if (!r.ast) return null;
    const out = [];
    const walk = list => list.forEach(s => {
      if (s.kind === 'REPEAT') { out.push(s, s, s); walk(s.body); out.push(s, s, s); } else out.push(s);
    });
    walk(r.ast.body);
    out.push(null);
    const KIND = { MOVE: 'MOVE', TURN: 'TURN', COLOR: 'PEN', PENUP: 'PENUP', PENDOWN: 'PENDOWN' };
    const fits = r.ir.length === out.length && r.ir.every((c, i) => {
      const s = out[i];
      if (c.op === 'HALT') return s === null;
      const want = c.role === 'set' ? 'SET' : c.loop !== undefined ? 'REPEAT' : KIND[c.op];
      return !!s && s.kind === want && s.line === c.line;
    });
    return fits ? out : null;
  }

  // The statement's own text, rebuilt from its tokens (a line can hold several statements).
  function stmtText(r, s) {
    if (!s || !r.lex) return null;
    const toks = r.lex.tokens, k = toks.indexOf(s.tok);
    if (k < 0) return null;
    const stop = s.kind === 'REPEAT' ? 'LBRACE' : 'SEMI', out = [];
    for (let j = k; j < toks.length && toks[j].type !== 'EOF'; j++) {
      out.push(toks[j].text);
      if (toks[j].type === stop) {
        const t = out.join(' ').replace(/ ;$/, ';');
        return s.kind === 'REPEAT' ? t + ' … }' : t;
      }
    }
    return null;
  }

  function irModel(r) {
    return Object.assign(layout(r.ir), { stmts: irStatements(r) });
  }

  // Coloured three-address code. The visible text is exactly TC.tacText(c).
  const kw = (cls, t) => `<span class="tcm-k-${cls}">${esc(t)}</span>`;
  const operand = v => (typeof v === 'number' ? kw('num', v) : kw('name', v));
  const colourName = n => `<span class="tcm-k-col" style="--tcm-sw: ${TC.COLORS[n] || 'var(--ink)'}">${esc(n)}</span>`;
  function tacHTML(c) {
    switch (c.op) {
      case 'COPY': return `${c.role === 'init' ? kw('tmp', c.res) : kw('name', c.res)} ${kw('sym', '=')} ${operand(c.a1)}`;
      case 'MOVE': return `${kw('op', 'move')} ${operand(c.a1)}`;
      case 'TURN': return `${kw('op', 'turn')} ${operand(c.a1)}`;
      case 'COLOR': return `${kw('op', 'color')} ${colourName(c.a1)}`;
      case 'PENUP': return kw('op', 'penup');
      case 'PENDOWN': return kw('op', 'pendown');
      case 'LABEL': return `${kw('lab', c.res)}:`;
      case 'IFLE': return `${kw('op', 'if')} ${kw('tmp', c.a1)} ${kw('sym', '<=')} ${kw('num', 0)} ${kw('op', 'goto')} ${kw('lab', c.res)}`;
      case 'DEC': return `${kw('tmp', c.res)} ${kw('sym', '=')} ${kw('tmp', c.a1)} ${kw('sym', '-')} ${kw('num', 1)}`;
      case 'GOTO': return `${kw('op', 'goto')} ${kw('lab', c.res)}`;
      default: return kw('op', 'halt');
    }
  }

  // Quadruple cells [op, arg1, arg2, result]. The visible text is exactly TC.quad(c).
  function quadCells(c) {
    const q = TC.quad(c);
    const kinds = {
      COPY: ['any', 'any', c.role === 'init' ? 'tmp' : 'name'], COLOR: ['col', 'any', 'any'],
      IFLE: ['tmp', 'num', 'lab'], DEC: ['tmp', 'num', 'tmp'], LABEL: ['any', 'any', 'lab'], GOTO: ['any', 'any', 'lab']
    }[c.op] || ['any', 'any', 'any'];
    const cell = (v, kind) => {
      if (v === '' || v === null || v === undefined) return '';
      if (kind === 'col') return colourName(v);
      return kind === 'any' ? operand(v) : kw(kind, v);
    };
    return [kw('op', q[0])].concat(q.slice(1).map((v, j) => cell(v, kinds[j])));
  }

  // Jump arrows: the exit test (dashed, outer lane) and the jump back (solid, inner lane).
  // The exit arrow leaves from the top half of the test row and the back arrow lands on
  // the bottom half, so the two never cross; inner loops use lanes nearer the code.
  function loopArcs(model) {
    const y = row => row * ROW_H + ROW_H / 2, lane = k => LANE_X0 + k * LANE_W, out = [];
    model.loops.forEach(lp => {
      const a = lp.at;
      if ([a.head, a.test, a.back, a.exit].some(v => v === undefined)) return;
      const d = 2 * (lp.depth - 1);
      out.push({ kind: 'exit', tint: lp.tint, from: a.test, to: a.exit, x: lane(d), y0: y(model.where[a.test]) - 4, y1: y(model.where[a.exit]) });
      out.push({ kind: 'back', tint: lp.tint, from: a.back, to: a.head, x: lane(d + 1), y0: y(model.where[a.back]), y1: y(model.where[a.head]) + 4 });
    });
    return out;
  }

  function arcsSVG(arcs, rowCount, depth) {
    if (!arcs.length) return '';
    const G = gutterW(depth), H = rowCount * ROW_H, tip = G - 3, base = tip - 6;
    const paths = arcs.map(a => {
      const dir = a.y1 > a.y0 ? 1 : -1, rad = Math.min(5, Math.abs(a.y1 - a.y0) / 2);
      const line = `M${tip} ${a.y0}H${a.x + rad}Q${a.x} ${a.y0} ${a.x} ${a.y0 + dir * rad}V${a.y1 - dir * rad}Q${a.x} ${a.y1} ${a.x + rad} ${a.y1}H${base}`;
      const head = `M${base} ${a.y1 - 3.5}L${tip} ${a.y1}L${base} ${a.y1 + 3.5}Z`;
      return `<g class="tcm-arc tcm-arc-${a.kind} tcm-lp-${a.tint}" data-from="${a.from}" data-to="${a.to}"><path class="tcm-arc-line" d="${line}"/><path class="tcm-arc-head" d="${head}"/></g>`;
    }).join('');
    return `<svg class="tcm-arcs" width="${G}" height="${H}" viewBox="0 0 ${G} ${H}" aria-hidden="true" focusable="false">${paths}</svg>`;
  }

  // The listing rows. rowText(c, row) can replace the instruction text (the template uses it).
  function tacRowsHTML(ir, model, opts) {
    const o = opts || {}, tag = o.tag || 'button';
    return model.rows.map(row => {
      const c = row.ins !== null ? ir[row.ins] : null;
      const lpIns = c && c.loop !== undefined ? model.loopOf(row.ins) : null;
      const lpLbl = row.lbl !== null ? model.loopOf(row.lbl) : null;
      const note = o.note ? o.note(c, row) : (!c ? '' : c.op === 'HALT' ? 'end' : `line ${c.line}`);
      const attrs = tag === 'button' ? ` type="button" tabindex="-1" data-k="${row.ins !== null ? row.ins : row.lbl}"` : '';
      const lbl = row.lbl !== null ? `<span class="tcm-k-lab"${tag === 'button' ? ` data-k="${row.lbl}"` : ''}>${esc(ir[row.lbl].res)}:</span>` : '';
      const text = c ? (o.text ? o.text(c) : tacHTML(c)) : '';
      return `<${tag} class="tcm-tac-row${lpIns ? ` tcm-scaf tcm-lp-${lpIns.tint}` : ''}${c && c.op === 'BODY' ? ' tcm-body' : ''}"${attrs}><span class="tcm-tac-lbl${lpLbl ? ` tcm-lp-${lpLbl.tint}` : ''}">${lbl}</span><span class="tcm-tac-ins">${text}</span><span class="tcm-tac-ln">${note}</span></${tag}>`;
    }).join('');
  }

  function listingHTML(ir, model, opts) {
    const arcs = loopArcs(model);
    return `<div class="tcm-tac-body" style="--tcm-gutter: ${gutterW(model.maxDepth)}px">${arcsSVG(arcs, model.rows.length, model.maxDepth)}<div class="tcm-tac-rows">${tacRowsHTML(ir, model, opts)}</div></div>`;
  }

  function quadRowsHTML(r, model) {
    return r.ir.map((c, i) => {
      const lp = model.loopOf(i);
      return `<tr class="tcm-q-row${lp ? ` tcm-scaf tcm-lp-${lp.tint}` : ''}" data-k="${i}"><td class="tcm-q-id">${c.id}</td>${quadCells(c).map(x => `<td>${x}</td>`).join('')}</tr>`;
    }).join('');
  }

  // Code words inside caption sentences, in the same colours as the listing.
  const cw = (cls, t) => `<code class="tcm-k-${cls}">${esc(t)}</code>`;
  const cwOperand = v => cw(typeof v === 'number' ? 'num' : 'name', v);
  const ROLE_TEXT = {
    head: c => `Label ${cw('lab', c.res)} marks the top of the loop.`,
    test: c => `Leave the loop when ${cw('tmp', c.a1)} is 0 or less, by jumping to ${cw('lab', c.res)}.`,
    dec: () => 'One lap done, count down.',
    back: c => `Jump back to the top, ${cw('lab', c.res)}, and test again.`,
    exit: c => `Label ${cw('lab', c.res)} marks the way out of the loop.`
  };

  function irExplain(r, c) {
    const sym = name => (r.sem ? r.sem.symbols.find(s => s.name === name) : null);
    const swap = v => { const s = typeof v === 'string' ? sym(v) : null; return s ? ` Phase 5 swaps in its value, ${cw('num', s.value)}.` : ''; };
    if (c.role === 'set') return `SET becomes a copy into the name ${cw('name', c.res)}. Phase 5 later puts ${cw('num', c.a1)} into each use and deletes this line.`;
    if (c.role === 'init') return `The loop counter ${cw('tmp', c.res)} starts at ${cwOperand(c.a1)}.${swap(c.a1)}`;
    if (ROLE_TEXT[c.role]) return ROLE_TEXT[c.role](c);
    switch (c.op) {
      case 'MOVE': case 'TURN':
        return typeof c.a1 === 'string' ? `${cw('name', c.a1)} stays a name here.${swap(c.a1)}` : 'One command becomes one instruction.';
      case 'COLOR': return `PEN becomes color. Phase 6 turns <code class="tcm-k-col" style="--tcm-sw: ${TC.COLORS[c.a1] || 'var(--ink)'}">${esc(c.a1)}</code> into colour code ${TC.COLOR_NAMES.indexOf(c.a1)}.`;
      case 'PENUP': case 'PENDOWN': return 'One command becomes one instruction, with no operands.';
      default: return 'The end of the program becomes halt. The machine stops here.';
    }
  }

  function irCaption(r, model, i) {
    const c = r.ir[i], lp = model.loopOf(i), s = model.stmts ? model.stmts[i] : null;
    const from = c.op === 'HALT'
      ? '<span class="tcm-ln">End of program</span>'
      : `<span class="tcm-ln">Line ${c.line}</span><code class="tcm-src">${esc(stmtText(r, s) || srcLine(r, c.line))}</code>`;
    const role = lp && c.role ? `<span class="tcm-role">loop ${lp.n} · ${esc(c.role)}</span>` : '';
    return `<div class="tcm-cap tcm-cap-ir${lp ? ` tcm-lp-${lp.tint}` : ''}">
      <div class="tcm-cap-top">${from}<span class="tcm-arrow" aria-hidden="true">→</span><code class="tcm-tacc">${tacHTML(c)}</code>${role}</div>
      <div class="tcm-cap-text">${irExplain(r, c)}</div>
    </div>`;
  }

  function loopLegend(model) {
    if (!model.loops.length) return '';
    return `<div class="tcm-loops">${model.loops.map(lp => `
      <span class="tcm-loop tcm-lp-${lp.tint}"><b>Loop ${lp.n}</b><span>line ${lp.line}${lp.parent ? `, inside loop ${lp.parent.n}` : ''}</span><span>counter <code>${esc(lp.temp)}</code></span><span>labels <code>${esc(lp.top)}</code> <code>${esc(lp.out)}</code></span></span>`).join('')}</div>`;
  }

  // The REPEAT pattern, drawn with the same listing code as the live view.
  function templateHTML() {
    const tpl = [
      { op: 'COPY', role: 'init', res: 't', a1: 'x', loop: 1 },
      { op: 'LABEL', role: 'head', res: 'L1', loop: 1 },
      { op: 'IFLE', role: 'test', a1: 't', a2: 0, res: 'L2', loop: 1 },
      { op: 'BODY' },
      { op: 'DEC', role: 'dec', res: 't', a1: 't', a2: 1, loop: 1 },
      { op: 'GOTO', role: 'back', res: 'L1', loop: 1 },
      { op: 'LABEL', role: 'exit', res: 'L2', loop: 1 }
    ];
    const NOTE = { init: 'start the counter', test: 'leave when it runs out', dec: 'one lap done', back: 'back to the top' };
    return listingHTML(tpl, layout(tpl), {
      tag: 'div',
      text: c => (c.op === 'BODY' ? '<span class="tcm-body-box">…body…</span>' : tacHTML(c)),
      note: (c, row) => (c ? (c.op === 'BODY' ? 'the loop body' : NOTE[c.role] || '') : row.lbl !== null ? 'the way out' : '')
    });
  }

  function irRules(el) {
    const dec = { op: 'DEC', a1: 't1', a2: 1, res: 't1' }, q = TC.quad(dec);
    const T = o => esc(TC.tacText(o));
    const scheme = [
      ['SET n = 150;', T({ op: 'COPY', res: 'n', a1: 150 })],
      ['MOVE x;', T({ op: 'MOVE', a1: 'x' })],
      ['TURN x;', T({ op: 'TURN', a1: 'x' })],
      ['PEN c;', T({ op: 'COLOR', a1: 'c' })],
      ['PENUP; / PENDOWN;', `${T({ op: 'PENUP' })} / ${T({ op: 'PENDOWN' })}`]
    ].map(([s, t]) => `<tr><td><code>${esc(s)}</code></td><td><code class="tcm-out">${t}</code></td></tr>`).join('');
    el.innerHTML = `
      <div class="card">
        <h3 class="card-title">Three-address code</h3>
        <p class="card-sub">Each instruction has at most one operator and at most three addresses: two operands and a result.</p>
        <div class="tcm-anat" role="img" aria-label="${esc(TC.tacText(dec))}: result t1, arg1 t1, operator minus, arg2 1">
          <span class="tcm-part tcm-c-res"><code>${esc(dec.res)}</code><small>result</small></span>
          <span class="tcm-part tcm-eq"><code>=</code><small>&nbsp;</small></span>
          <span class="tcm-part tcm-c-a1"><code>${esc(dec.a1)}</code><small>arg1</small></span>
          <span class="tcm-part tcm-c-op"><code>-</code><small>op</small></span>
          <span class="tcm-part tcm-c-a2"><code>${esc(dec.a2)}</code><small>arg2</small></span>
        </div>
        <p class="tcm-quadline"><span class="muted">The same instruction as a quadruple:</span>
          <code>(<span class="tcm-c-op">${esc(q[0])}</span>, <span class="tcm-c-a1">${esc(q[1])}</span>, <span class="tcm-c-a2">${esc(q[2])}</span>, <span class="tcm-c-res">${esc(q[3])}</span>)</code></p>
      </div>
      <div class="card">
        <h3 class="card-title">Translation scheme</h3>
        <p class="card-sub">Each statement has one pattern. The generator walks the tree in order and fills in the patterns.</p>
        <div class="scroll-x"><table class="tbl tcm-scheme">
          <thead><tr><th>Source</th><th>Three-address code</th></tr></thead>
          <tbody>${scheme}
            <tr><td class="muted">end of program</td><td><code class="tcm-out">${T({ op: 'HALT' })}</code></td></tr>
          </tbody>
        </table></div>
        <h4 class="tcm-h4"><code>REPEAT x { body }</code> becomes</h4>
        <div class="tcm-tac tcm-tpl scroll-x">${templateHTML()}</div>
        <p class="tcm-small muted">Each REPEAT gets a fresh temp <code>t</code> and two fresh labels. That is 4 instructions and 2 labels around the body. The test comes first, so after x laps <code>t</code> reaches 0 and the jump to <code>L2</code> leaves the loop.</p>
      </div>
      <div class="card">
        <h3 class="card-title">Good to know</h3>
        <ul class="tcm-notes">
          <li><strong>Names stay names here:</strong> <code>MOVE side;</code> becomes <code>move side</code>. Phase 5 swaps in their values.</li>
          <li><strong>Labels are not instructions.</strong> A label only names a place that a jump can go to, so the instruction count leaves labels out.</li>
          <li><strong>Temps and labels are numbered across the whole program.</strong> Nested loops never share a counter.</li>
          <li><strong>Quadruple format:</strong> (op, arg1, arg2, result). A blank slot means the instruction does not use it.</li>
        </ul>
      </div>`;
  }

  function irImprove(el) {
    UI.ideas(el, [
      { title: 'Triples and indirect triples', level: 'easy', text: 'Triples drop the result field and refer to an earlier instruction by its number. Indirect triples add a list of pointers, so the optimizer can reorder code without renumbering it.' },
      { title: 'A DAG for each basic block', level: 'medium', text: 'Build a directed acyclic graph for each basic block. Two instructions with the same operator and operands share one node, so the repeated work runs once.' },
      { title: 'Syntax-directed translation', level: 'medium', text: 'Attach a semantic action to each grammar rule, so the parser emits three-address code while it parses, with no separate walk over the tree.' },
      { title: 'SSA form', level: 'hard', text: 'Static single assignment gives every assignment a new name: <code>t1 = t1 - 1</code> becomes <code>t1<sub>2</sub> = t1<sub>1</sub> - 1</code>, and a φ-function at <code>L1</code> picks <code>t1<sub>0</sub></code> or <code>t1<sub>2</sub></code>. Many optimizations get simpler in SSA.' }
    ]);
  }

  const irState = { stepper: null, view: 'tac' };

  function irRender(el, r) {
    if (irState.stepper) { irState.stepper.stop(); irState.stepper = null; }
    if (!r || !r.ir) { el.innerHTML = ''; return; }
    const oldTac = el.querySelector('.tcm-tac'), oldQuad = el.querySelector('.tcm-quadbox');
    const keep = { tac: oldTac ? oldTac.scrollTop : 0, quad: oldQuad ? oldQuad.scrollTop : 0 };
    const ir = r.ir, model = irModel(r);
    const nIns = ir.filter(c => c.op !== 'LABEL').length, nLab = ir.length - nIns;
    const nTmp = new Set(ir.filter(c => c.role === 'init').map(c => c.res)).size;
    const hasArcs = model.loops.length > 0;

    el.innerHTML = `<div class="tcm-live">
      ${tiles([
        { n: nIns, label: plural(nIns, 'instruction'), tone: 'hue' },
        { n: nTmp, label: plural(nTmp, 'temp'), tone: 'hue' },
        { n: nLab, label: plural(nLab, 'label'), tone: 'hue' }
      ], true)}
      <div class="card">
        <div class="tcm-cardhead">
          <h3 class="card-title">Generated code</h3>
          <div class="tcm-seg" role="group" aria-label="Show the code as">
            <button type="button" class="btn" data-view="tac" aria-pressed="false">Three-address code</button>
            <button type="button" class="btn" data-view="quad" aria-pressed="false">Quadruples</button>
          </div>
        </div>
        <div class="tcm-step"></div>
        <div class="tcm-view" data-pane="tac">
          <div class="tcm-tac">${listingHTML(ir, model)}</div>
          ${hasArcs ? '<p class="tcm-arrows faint">Arrows show the jumps. Dashed: the test jumps out of the loop. Solid: goto jumps back to the top.</p>' : ''}
        </div>
        <div class="tcm-view" data-pane="quad">
          <div class="tcm-quadbox scroll-x"><table class="tbl tcm-quad">
            <thead><tr><th>#</th><th>op</th><th>arg1</th><th>arg2</th><th>result</th></tr></thead>
            <tbody>${quadRowsHTML(r, model)}</tbody>
          </table></div>
        </div>
        ${loopLegend(model)}
      </div>
    </div>`;

    const tacBox = el.querySelector('.tcm-tac'), quadBox = el.querySelector('.tcm-quadbox');
    const tacRows = Array.from(el.querySelectorAll('.tcm-tac-row')), qRows = Array.from(el.querySelectorAll('.tcm-q-row'));
    const arcs = Array.from(el.querySelectorAll('.tcm-arc'));
    const panes = Array.from(el.querySelectorAll('[data-pane]')), toggles = Array.from(el.querySelectorAll('[data-view]'));
    let booting = true, stepped = false, st = null;

    const follow = i => {
      if (irState.view === 'tac') keepVisible(tacBox, tacRows[model.where[i]]);
      else { const head = quadBox.querySelector('thead'); keepVisible(quadBox, qRows[i], head ? head.offsetHeight : 0); }
    };
    const showView = v => {
      irState.view = v;
      panes.forEach(p => { p.hidden = p.dataset.pane !== v; });
      toggles.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    };
    showView(irState.view);

    st = UI.stepper(el.querySelector('.tcm-step'), {
      count: ir.length,
      speed: 750,
      caption: i => irCaption(r, model, i),
      onStep: i => {
        model.rows.forEach((row, k) => {
          const e = tacRows[k];
          e.classList.toggle('is-lbl-future', row.lbl !== null && row.lbl > i);
          e.classList.toggle('is-future', row.ins !== null ? row.ins > i : row.lbl > i);
          e.classList.toggle('is-cur-lbl', row.lbl === i);
          e.classList.toggle('is-current', row.ins === i);
        });
        arcs.forEach(a => {
          const from = Number(a.dataset.from), to = Number(a.dataset.to);
          a.classList.toggle('is-future', from > i);
          a.classList.toggle('is-on', from <= i && (from === i || to === i));
        });
        qRows.forEach((tr, k) => { tr.classList.toggle('is-future', k > i); tr.classList.toggle('is-current', k === i); });
        if (!booting) { stepped = true; follow(i); }
      }
    });
    booting = false;
    tacBox.scrollTop = keep.tac;
    quadBox.scrollTop = keep.quad;
    irState.stepper = st;

    el.querySelector('.tcm-seg').addEventListener('click', e => {
      const b = e.target.closest('[data-view]');
      if (!b) return;
      showView(b.dataset.view);
      if (stepped) follow(st.get());
    });
    const jump = e => {
      const t = e.target.closest('[data-k]');
      if (t) { st.stop(); st.set(Number(t.dataset.k)); }
    };
    tacBox.addEventListener('click', jump);
    quadBox.addEventListener('click', jump);
  }

  // stop() is optional in the contract: app.js calls it when a phase is skipped.
  const stopper = st => () => { if (st.stepper) { st.stepper.stop(); st.stepper = null; } };
  UI.register('sem', { rules: semRules, improve: semImprove, render: semRender, stop: stopper(semState) });
  UI.register('ir', { rules: irRules, improve: irImprove, render: irRender, stop: stopper(irState) });

  // Node can load this file to test the pure helpers. The page has no `module`, so this never runs there.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RULES, symbolRef, semModel, symbolsAt, symTableHTML, checkRowsHTML, semCaption, layout, irStatements, stmtText, irModel, tacHTML, quadCells, loopArcs, arcsSVG, tacRowsHTML, listingHTML, quadRowsHTML, irExplain, irCaption, loopLegend, templateHTML };
  }
})();
