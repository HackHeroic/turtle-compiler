/* Workbench: editor, examples, drawing, and wiring the six phase modules. */
(function () {
  'use strict';
  const { esc } = TCUI;

  const SAMPLES = [
    { id: 'star', label: 'Star', kind: 'demo', src: '# A pink star. Two lines here are wasteful on purpose:\n# phase 5 cleans them up.\nSET side = 150;\nPEN BLUE;\nPEN PINK;\nREPEAT 5 {\n  MOVE side;\n  TURN 100;\n  TURN 44;\n}\n' },
    { id: 'square', label: 'Square', kind: 'demo', src: '# The example from the project sheet\nPEN BLUE;\nREPEAT 4 { MOVE 100; TURN 90; }\n' },
    { id: 'flower', label: 'Flower', kind: 'demo', src: '# 12 squares turned around one corner\nSET petals = 12;\nPEN PURPLE;\nREPEAT petals {\n  REPEAT 4 {\n    MOVE 90;\n    TURN 90;\n  }\n  TURN 30;\n}\n' },
    { id: 'play', label: 'Optimizer playground', kind: 'demo', src: '# Every line here can be simplified. Watch phase 5.\nSET size = 60;\nPENDOWN;            # the pen already starts down\nPEN RED;            # replaced before anything is drawn\nPEN ORANGE;\nREPEAT 1 {          # a loop that runs once\n  MOVE size;\n  MOVE size;        # two moves in a row\n}\nTURN 360;           # a full turn changes nothing\nREPEAT 6 {\n  PEN YELLOW;       # the same colour on every lap\n  TURN 100;\n  TURN -40;         # 100 - 40 = 60\n  MOVE size;\n}\nREPEAT 3 { }        # an empty loop\n' },
    { id: 'lexerr', label: 'Lexical error', kind: 'error', src: 'PEN GREEN;\nMOVE 10@0;          # @ is not in the language\nTURN - 90;          # the minus must touch the number\n' },
    { id: 'synerr', label: 'Syntax error', kind: 'error', src: 'PEN CYAN;\nREPEAT 4 {\n  MOVE 100          # the ; is missing\n  TURN 90;\n}\n' },
    { id: 'semerr', label: 'Semantic error', kind: 'error', src: 'SET side = 900;\nPEN GOLD;           # not a colour\nREPEAT 0 {          # must run at least once\n  MOVE side;        # 900 is more than 500\n}\nMOVE width;         # width was never SET\n' }
  ];

  const PHASES = [
    { key: 'lex', id: 'lexer', n: 1, name: 'Lexical analysis', short: 'Lexer' },
    { key: 'parse', id: 'parser', n: 2, name: 'Syntax analysis', short: 'Parser' },
    { key: 'sem', id: 'semantic', n: 3, name: 'Semantic analysis', short: 'Semantic' },
    { key: 'ir', id: 'intermediate', n: 4, name: 'Intermediate code', short: 'IR' },
    { key: 'opt', id: 'optimizer', n: 5, name: 'Code optimization', short: 'Optimizer' },
    { key: 'gen', id: 'codegen', n: 6, name: 'Code generation', short: 'Code gen' }
  ];

  const $ = id => document.getElementById(id);
  const ta = $('src'), hl = $('hl'), gutter = $('gutter'), statusEl = $('status');
  const canvas = $('out'), outMeta = $('outMeta'), flow = $('flow'), samplesEl = $('samples');
  let last = null, lastGood = null, timer = null, activeSample = null;

  // ---------- Editor with live colouring ----------
  function paint(src, errs) {
    const pieces = TC.lex(src).pieces;
    const bad = p => errs.some(e => p.start < e.end && p.end > e.start);
    let html = '', at = 0;
    for (const p of pieces) {
      if (p.start > at) html += esc(src.slice(at, p.start));
      const cls = 't-' + p.type + (p.type !== 'WS' && bad(p) ? ' t-bad' : '');
      html += p.type === 'WS' ? esc(p.text) : `<span class="${cls}">${esc(p.text)}</span>`;
      at = p.end;
    }
    html += esc(src.slice(at));
    hl.innerHTML = html + '\n ';
    const lines = src.split('\n').length, errLines = new Set(errs.map(e => e.line));
    let g = '';
    for (let i = 1; i <= lines; i++) g += `<span class="${errLines.has(i) ? 'g-bad' : ''}">${i}</span>`;
    gutter.innerHTML = g;
    syncScroll();
  }
  function syncScroll() { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; }
  ta.addEventListener('scroll', syncScroll);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 2;
      onEdit();
    }
  });
  ta.addEventListener('input', onEdit);
  function onEdit() {
    paint(ta.value, last ? errorsOf(last) : []);
    markSample(null);
    clearTimeout(timer);
    timer = setTimeout(run, 220);
  }

  // ---------- Examples ----------
  samplesEl.innerHTML = SAMPLES.map(s => `<button class="btn sample sample-${s.kind}" data-id="${s.id}">${esc(s.label)}</button>`).join('');
  samplesEl.addEventListener('click', e => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    const s = SAMPLES.find(x => x.id === b.dataset.id);
    ta.value = s.src; ta.scrollTop = 0;
    markSample(s.id);
    run();
  });
  function markSample(id) {
    activeSample = id;
    samplesEl.querySelectorAll('[data-id]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
  }

  // ---------- Results ----------
  function errorsOf(r) {
    if (r.stopAt === 'lex') return r.lex.errors;
    if (r.stopAt === 'parse') return r.parse.errors;
    if (r.stopAt === 'sem') return r.sem.errors;
    return [];
  }
  const order = ['lex', 'parse', 'sem'];
  function stateOf(r, key) {
    const failed = r.stopAt ? order.indexOf(r.stopAt) : 99;
    const idx = PHASES.findIndex(p => p.key === key);
    if (idx > failed) return 'skipped';
    if (key === r.stopAt) return 'error';
    if (key === 'sem' && r.sem.warnings.length) return 'warn';
    return 'ok';
  }
  function summary(r, key, state) {
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
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

  function run() {
    clearTimeout(timer);
    const src = ta.value;
    let r;
    try { r = TC.compile(src); } catch (err) { console.error(err); statusEl.innerHTML = TCUI.message({ msg: 'The compiler crashed on this program: ' + err.message }); return; }
    last = r;
    if (!r.stopAt) lastGood = r;
    paint(src, errorsOf(r));
    saveDraft(src);

    const failed = PHASES.find(p => p.key === r.stopAt);
    flow.innerHTML = PHASES.map(p => {
      const st = stateOf(r, p.key);
      return `<a class="flow-step" href="#${p.id}" data-state="${st}" style="--hue: var(--p${p.n})"><b>0${p.n}</b><span>${p.short}</span><em>${esc(summary(r, p.key, st))}</em></a>`;
    }).join('');

    for (const p of PHASES) {
      const sec = $(p.id), st = stateOf(r, p.key);
      const badge = sec.querySelector('[data-status]');
      badge.dataset.state = st;
      badge.textContent = st === 'ok' ? '✓ ' + summary(r, p.key, st) : st === 'error' ? '✗ ' + summary(r, p.key, st) : st === 'warn' ? '! ' + summary(r, p.key, st) : 'Skipped';
      const pill = document.querySelector(`#pipe [data-phase="${p.key}"]`);
      if (pill) pill.dataset.state = st;
      const live = sec.querySelector('.phase-live');
      sec.classList.toggle('is-skipped', st === 'skipped');
      if (st === 'skipped') {
        stopModule(p.key);
        live.innerHTML = `<div class="skipped-note"><strong>Skipped</strong><p>Phase ${failed.n} (${failed.name}) found an error, so this phase did not run.<br>Fix the error in your program to see it.</p></div>`;
        continue;
      }
      const mod = TCUI.phases[p.key];
      if (!mod) { live.innerHTML = `<div class="skipped-note"><strong>Loading…</strong></div>`; continue; }
      try { mod.render(live, r); } catch (err) { console.error(err); live.innerHTML = TCUI.message({ msg: `This panel failed to draw: ${err.message}` }); }
    }

    if (r.stopAt) {
      const e = errorsOf(r)[0];
      statusEl.innerHTML = `<div class="stop-line"><span class="stop-tag" style="--hue: var(--p${failed.n})">Stopped in phase ${failed.n} · ${failed.name}</span></div>` + TCUI.message(e) + (errorsOf(r).length > 1 ? `<p class="faint more">+ ${errorsOf(r).length - 1} more. See phase ${failed.n} below.</p>` : '');
    } else {
      const w = r.sem.warnings.length;
      statusEl.innerHTML = `<div class="msg msg-good"><strong>Compiled through all six phases.</strong><span class="muted">${r.gen.prog.length} machine instructions ran in ${r.run.steps} steps and drew ${r.run.segments.length} line${r.run.segments.length === 1 ? '' : 's'}.${w ? ` ${w} warning${w === 1 ? '' : 's'} in phase 3.` : ''}${r.run.limitHit ? ' The machine stopped at the step limit.' : ''}</span></div>`;
    }
    drawOut();
  }

  function stopModule(key) { const m = TCUI.phases[key]; if (m && m.stop) try { m.stop(); } catch (e) { /* ignore */ } }

  function drawOut() {
    const r = lastGood;
    const stale = !!(last && last.stopAt);
    canvas.classList.toggle('is-stale', stale);
    if (!r) { TCUI.draw(canvas, []); outMeta.textContent = 'nothing drawn yet'; return; }
    const segs = r.run.segments;
    const vm = TC.makeVM(r.gen.prog);
    while (!vm.state.halted && vm.state.steps < TC.LIMITS.STEPS) vm.step();
    const s = vm.state;
    TCUI.draw(canvas, segs, { turtle: { x: s.x, y: s.y, h: s.h } });
    outMeta.textContent = stale ? 'last drawing that compiled' : `${segs.length} line${segs.length === 1 ? '' : 's'} · turtle ends at (${Math.round(s.x)}, ${Math.round(-s.y)}) facing ${s.h}°`;
  }
  new ResizeObserver(() => drawOut()).observe(canvas);

  // ---------- Light / dark ----------
  // The viewer may set data-theme on <html>; the button overrides it for this browser.
  const themeBtn = $('themeBtn'), THEME_KEY = 'turtle-compiler-theme';
  const effective = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const showTheme = () => {
    const dark = effective() === 'dark';
    themeBtn.textContent = dark ? '☀ Light' : '☾ Dark';
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  };
  try { const saved = localStorage.getItem(THEME_KEY); if (saved) document.documentElement.dataset.theme = saved; } catch (e) { /* storage may be blocked */ }
  themeBtn.addEventListener('click', () => {
    const next = effective() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* storage may be blocked */ }
    showTheme();
  });
  new MutationObserver(showTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', showTheme);
  showTheme();

  // ---------- Drafts survive a reload in this browser ----------
  const KEY = 'turtle-compiler-draft';
  function saveDraft(src) { try { localStorage.setItem(KEY, src); } catch (e) { /* storage may be blocked */ } }
  function loadDraft() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }

  // ---------- Boot ----------
  function start(data) {
    for (const p of PHASES) {
      const sec = $(p.id), mod = TCUI.phases[p.key];
      if (!mod) continue;
      try { mod.rules(sec.querySelector('.phase-rules')); } catch (err) { console.error(err); }
      try { mod.improve(sec.querySelector('.phase-improve')); } catch (err) { console.error(err); }
    }
    const draft = (data && data.src) || loadDraft();
    ta.value = draft || SAMPLES[0].src;
    markSample(draft ? (SAMPLES.find(s => s.src === draft) || {}).id || null : 'star');
    run();
  }
  if (window.claude && window.claude.hot) window.claude.hot.snapshot(() => ({ src: ta.value }));
  if (window.claude && window.claude.hot && window.claude.hot.ready) window.claude.hot.ready(start);
  else start((window.claude && window.claude.hot && window.claude.hot.data) || {});
})();
