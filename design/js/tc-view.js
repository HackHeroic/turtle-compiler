/* View helpers shared by the design components. No language rules live here: they all come from compiler.js (window.TC). */
(function () {
  'use strict';
  const SAMPLES = [
    { id: 'star', label: 'Star', kind: 'demo', src: '# A pink star. Two lines here are wasteful on purpose:\n# phase 5 cleans them up.\nSET side = 150;\nPEN BLUE;\nPEN PINK;\nREPEAT 5 {\n  MOVE side;\n  TURN 100;\n  TURN 44;\n}\n' },
    { id: 'square', label: 'Square', kind: 'demo', src: '# The example from the project sheet\nPEN BLUE;\nREPEAT 4 { MOVE 100; TURN 90; }\n' },
    { id: 'flower', label: 'Flower', kind: 'demo', src: '# 12 squares turned around one corner\nSET petals = 12;\nPEN PURPLE;\nREPEAT petals {\n  REPEAT 4 {\n    MOVE 90;\n    TURN 90;\n  }\n  TURN 30;\n}\n' },
    { id: 'play', label: 'Optimizer playground', kind: 'demo', src: '# Every line here can be simplified. Watch phase 5.\nSET size = 60;\nPENDOWN;            # the pen already starts down\nPEN RED;            # replaced before anything is drawn\nPEN ORANGE;\nREPEAT 1 {          # a loop that runs once\n  MOVE size;\n  MOVE size;        # two moves in a row\n}\nTURN 360;           # a full turn changes nothing\nREPEAT 6 {\n  PEN YELLOW;       # the same colour on every lap\n  TURN 100;\n  TURN -40;         # 100 - 40 = 60\n  MOVE size;\n}\nREPEAT 3 { }        # an empty loop\n' },
    { id: 'lexerr', label: 'Lexical error', kind: 'error', src: 'PEN GREEN;\nMOVE 10@0;          # @ is not in the language\nTURN - 90;          # the minus must touch the number\n' },
    { id: 'synerr', label: 'Syntax error', kind: 'error', src: 'PEN CYAN;\nREPEAT 4 {\n  MOVE 100          # the ; is missing\n  TURN 90;\n}\n' },
    { id: 'semerr', label: 'Semantic error', kind: 'error', src: 'SET side = 900;\nPEN GOLD;           # not a colour\nREPEAT 0 {          # must run at least once\n  MOVE side;        # 900 is more than 500\n}\nMOVE width;         # width was never SET\n' },
    { id: 'empty', label: 'Empty', kind: 'hidden', src: '' }
  ];

  const PHASES = [
    { key: 'lex', id: 'lexer', n: 1, name: 'Lexical analysis', short: 'Lexer', takes: 'your source text', gives: 'tokens' },
    { key: 'parse', id: 'parser', n: 2, name: 'Syntax analysis', short: 'Parser', takes: 'tokens', gives: 'a parse tree' },
    { key: 'sem', id: 'semantic', n: 3, name: 'Semantic analysis', short: 'Semantic', takes: 'the parse tree', gives: 'a checked tree + symbol table' },
    { key: 'ir', id: 'intermediate', n: 4, name: 'Intermediate code generation', short: 'IR', takes: 'the checked tree', gives: 'three-address code' },
    { key: 'opt', id: 'optimizer', n: 5, name: 'Code optimization', short: 'Optimizer', takes: 'three-address code', gives: 'shorter three-address code' },
    { key: 'gen', id: 'codegen', n: 6, name: 'Code generation', short: 'Code gen', takes: 'optimized code', gives: 'machine code for the Turtle VM' }
  ];

  const order = ['lex', 'parse', 'sem'];
  function errorsOf(r) {
    if (!r) return [];
    if (r.stopAt === 'lex') return r.lex.errors;
    if (r.stopAt === 'parse') return r.parse.errors;
    if (r.stopAt === 'sem') return r.sem.errors;
    return [];
  }
  function stateOf(r, key) {
    const failed = r.stopAt ? order.indexOf(r.stopAt) : 99;
    const idx = PHASES.findIndex(p => p.key === key);
    if (idx > failed) return 'skipped';
    if (key === r.stopAt) return 'error';
    if (key === 'sem' && r.sem.warnings.length) return 'warn';
    return 'ok';
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function summary(r, key, state) {
    if (state === 'skipped') return 'skipped';
    switch (key) {
      case 'lex': return state === 'error' ? plural(r.lex.errors.length, 'bad character') : plural(r.lex.tokens.length - 1, 'token');
      case 'parse': return state === 'error' ? 'syntax error' : plural(r.parse.nodes.length, 'tree node');
      case 'sem': {
        if (state === 'error') return plural(r.sem.errors.length, 'error');
        const ok = r.sem.checks.filter(c => c.level === 'ok').length;
        return plural(ok, 'check') + ' passed' + (r.sem.warnings.length ? ` · ${plural(r.sem.warnings.length, 'warning')}` : '');
      }
      case 'ir': return plural(r.ir.filter(c => c.op !== 'LABEL').length, 'instruction');
      case 'opt': return `${r.opt.stats.before} → ${r.opt.stats.after} instructions`;
      case 'gen': return plural(r.gen.prog.length, 'machine instruction');
    }
    return '';
  }
  const where = e => e.line ? `Line ${e.line}${e.col ? ', column ' + e.col : ''}: ` : '';

  // Status look, shared by pills, strip cards and nav dots.
  const STATUS = {
    ok: { glyph: '✓', bg: 'var(--goodbg)', dot: 'var(--good)', border: 'var(--good)', style: 'solid' },
    warn: { glyph: '!', bg: 'var(--warnbg)', dot: 'var(--warn)', border: 'var(--warn)', style: 'solid' },
    error: { glyph: '✕', bg: 'var(--badbg)', dot: 'var(--bad)', border: 'var(--bad)', style: 'solid' },
    skipped: { glyph: '–', bg: 'transparent', dot: 'var(--ink3)', border: 'var(--line2)', style: 'dashed' }
  };

  // Turtle ink on each theme. Dark uses compiler.js colours as-is; light darkens them so they read on paper.
  const LIGHT_INK = { RED: '#d0243c', ORANGE: '#c4510b', YELLOW: '#a87a00', GREEN: '#13894c', CYAN: '#0a8fb0', BLUE: '#2d58d6', PURPLE: '#7a3fd6', PINK: '#cc2a8a', WHITE: '#15172b' };
  const ink = (name, theme) => theme !== 'dark' ? (LIGHT_INK[name] || '#15172b') : ((window.TC && TC.COLORS[name]) || '#fff');

  function bbox(segs) {
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    for (const s of segs) { x0 = Math.min(x0, s.x1, s.x2); x1 = Math.max(x1, s.x1, s.x2); y0 = Math.min(y0, s.y1, s.y2); y1 = Math.max(y1, s.y1, s.y2); }
    return { x0, y0, x1, y1 };
  }

  // opts: { theme, turtle:{x,y,h}|null, box, lastGlow }
  function draw(canvas, segs, opts = {}) {
    if (!canvas) return;
    const light = opts.theme !== 'dark';
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 400, h = canvas.clientHeight || 400;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = light ? '#fdfcf8' : '#080a17';
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = light ? 'rgba(35,40,75,0.07)' : 'rgba(120,130,255,0.08)';
    ctx.beginPath();
    for (let x = 0.5; x < w; x += 24) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = 0.5; y < h; y += 24) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    const b = opts.box || bbox(segs);
    const pad = 32, bw = Math.max(b.x1 - b.x0, 1), bh = Math.max(b.y1 - b.y0, 1);
    const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, 2.5);
    const ox = w / 2 - ((b.x0 + b.x1) / 2) * scale, oy = h / 2 - ((b.y0 + b.y1) / 2) * scale;
    const X = x => ox + x * scale, Y = y => oy + y * scale;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (opts.ghost) {
      ctx.globalAlpha = light ? 0.16 : 0.14; ctx.lineWidth = 2.6;
      for (const s of opts.ghost) { ctx.strokeStyle = ink(s.color, opts.theme); ctx.beginPath(); ctx.moveTo(X(s.x1), Y(s.y1)); ctx.lineTo(X(s.x2), Y(s.y2)); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 2.6;
    const glow = !light && segs.length < 4000;
    segs.forEach((s, k) => {
      const col = ink(s.color, opts.theme);
      const isLast = opts.lastGlow && k === segs.length - 1;
      ctx.strokeStyle = col; ctx.shadowColor = col;
      ctx.shadowBlur = glow ? (isLast ? 18 : 9) : 0;
      ctx.lineWidth = isLast ? 3.4 : 2.6;
      ctx.beginPath(); ctx.moveTo(X(s.x1), Y(s.y1)); ctx.lineTo(X(s.x2), Y(s.y2)); ctx.stroke();
    });
    ctx.shadowBlur = 0;
    ctx.fillStyle = light ? 'rgba(21,23,43,0.35)' : 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(X(0), Y(0), 3, 0, Math.PI * 2); ctx.fill();
    if (opts.turtle) {
      const t = opts.turtle, r = t.h * Math.PI / 180, cx = X(t.x), cy = Y(t.y), sz = 12;
      const pt = (a, d) => [cx + Math.sin(r + a) * d, cy - Math.cos(r + a) * d];
      ctx.fillStyle = light ? '#1f2440' : '#3ee08f';
      ctx.strokeStyle = light ? '#fdfcf8' : '#0b0d1c'; ctx.lineWidth = 2;
      const p1 = pt(0, sz), p2 = pt(2.5, sz * 0.8), p3 = pt(-2.5, sz * 0.8);
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  }

  function finalTurtle(prog) {
    const vm = TC.makeVM(prog);
    while (!vm.state.halted && vm.state.steps < TC.LIMITS.STEPS) vm.step();
    return vm.state;
  }

  window.TCV = { SAMPLES, PHASES, errorsOf, stateOf, summary, where, plural, STATUS, ink, bbox, draw, finalTurtle };
})();
