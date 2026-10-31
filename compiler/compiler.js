/* Turtle compiler: the six phases as plain functions, with no page code.
   The website can reuse this file as its compiler later. */
(function (root) {
  'use strict';

  // ---------- Language facts (the rule set) ----------
  const KEYWORDS = ['MOVE', 'TURN', 'PEN', 'PENUP', 'PENDOWN', 'REPEAT', 'SET'];
  const COLORS = {
    RED: '#ff5468', ORANGE: '#ff9842', YELLOW: '#ffd84a', GREEN: '#4be38f', CYAN: '#3fe0f0',
    BLUE: '#5b8cff', PURPLE: '#b17cff', PINK: '#ff6ec7', WHITE: '#f3f1ff'
  };
  const COLOR_NAMES = Object.keys(COLORS);
  const LIMITS = { MOVE: [1, 500], TURN: [-360, 360], REPEAT: [1, 100], DEPTH: 3, STEPS: 2000000 };
  const START = { color: 'WHITE', pen: 'PENDOWN' }; // the turtle's state before line 1

  // ---------- Phase 1: lexical analysis ----------
  const LEX_RULES = [
    { type: 'WS', re: /[ \t\r\n]+/y, skip: true },
    { type: 'COMMENT', re: /#[^\n]*/y, skip: true },
    { type: 'NUMBER', re: /-?[0-9]+/y },
    { type: 'WORD', re: /[A-Za-z_][A-Za-z0-9_]*/y }, // becomes KEYWORD or IDENT
    { type: 'LBRACE', re: /\{/y }, { type: 'RBRACE', re: /\}/y },
    { type: 'SEMI', re: /;/y }, { type: 'ASSIGN', re: /=/y }
  ];

  function lex(src) {
    const tokens = [], pieces = [], errors = [];
    let i = 0, line = 1, col = 1;
    const advance = text => { for (const ch of text) { if (ch === '\n') { line++; col = 1; } else col++; } };
    while (i < src.length) {
      let hit = null;
      for (const r of LEX_RULES) {
        r.re.lastIndex = i;
        const m = r.re.exec(src);
        if (m && m[0].length) { hit = { r, text: m[0] }; break; }
      }
      const start = i, sl = line, sc = col;
      if (!hit) {
        const ch = src[i];
        let msg = `The character "${ch}" is not part of this language.`;
        let hint = 'Delete it. Programs use letters, digits, { } ; = - and # comments.';
        if (ch === '-') { msg = 'A minus sign must touch its number.'; hint = 'Write -90, not - 90.'; }
        errors.push({ phase: 'lex', msg, hint, line: sl, col: sc, start, end: i + 1 });
        pieces.push({ type: 'ERROR', text: ch, start, end: i + 1, line: sl, col: sc });
        advance(ch); i++;
        continue;
      }
      let type = hit.r.type, value = hit.text;
      if (type === 'WORD') {
        const up = hit.text.toUpperCase();
        if (KEYWORDS.includes(up)) { type = 'KEYWORD'; value = up; } else type = 'IDENT';
      }
      if (type === 'NUMBER') value = parseInt(hit.text, 10);
      const piece = { type, value, text: hit.text, start, end: i + hit.text.length, line: sl, col: sc };
      pieces.push(piece);
      if (!hit.r.skip) tokens.push(piece);
      advance(hit.text); i += hit.text.length;
    }
    tokens.push({ type: 'EOF', value: '$', text: '', start: src.length, end: src.length, line, col });
    return { tokens, pieces, errors };
  }

  // The grammar symbol a token stands for.
  function term(t) {
    switch (t.type) {
      case 'KEYWORD': return t.value;
      case 'NUMBER': return 'NUMBER';
      case 'IDENT': return 'IDENT';
      case 'LBRACE': return '{';
      case 'RBRACE': return '}';
      case 'SEMI': return ';';
      case 'ASSIGN': return '=';
      default: return '$';
    }
  }

  // ---------- Phase 2: syntax analysis ----------
  const GRAMMAR = [
    { id: 1, lhs: 'program', rhs: ['stmt_list'] },
    { id: 2, lhs: 'stmt_list', rhs: ['stmt', 'stmt_list'] },
    { id: 3, lhs: 'stmt_list', rhs: [] },
    { id: 4, lhs: 'stmt', rhs: ['MOVE', 'value', ';'] },
    { id: 5, lhs: 'stmt', rhs: ['TURN', 'value', ';'] },
    { id: 6, lhs: 'stmt', rhs: ['PEN', 'IDENT', ';'] },
    { id: 7, lhs: 'stmt', rhs: ['PENUP', ';'] },
    { id: 8, lhs: 'stmt', rhs: ['PENDOWN', ';'] },
    { id: 9, lhs: 'stmt', rhs: ['SET', 'IDENT', '=', 'NUMBER', ';'] },
    { id: 10, lhs: 'stmt', rhs: ['REPEAT', 'value', '{', 'stmt_list', '}'] },
    { id: 11, lhs: 'value', rhs: ['NUMBER'] },
    { id: 12, lhs: 'value', rhs: ['IDENT'] }
  ];
  const NONTERMS = ['program', 'stmt_list', 'stmt', 'value'];
  const TERMS = ['MOVE', 'TURN', 'PEN', 'PENUP', 'PENDOWN', 'SET', 'REPEAT', 'NUMBER', 'IDENT', '{', '}', ';', '=', '$'];
  const isNT = s => NONTERMS.includes(s);
  const termOrder = x => { const k = TERMS.indexOf(x); return k < 0 ? 99 : k; };

  // FIRST, FOLLOW and the LL(1) table, computed from GRAMMAR (not typed in by hand).
  function analyse() {
    const first = {}, follow = {};
    NONTERMS.forEach(n => { first[n] = new Set(); follow[n] = new Set(); });
    const firstOf = seq => {
      const out = new Set();
      for (const s of seq) {
        if (!isNT(s)) { out.add(s); return out; }
        first[s].forEach(x => { if (x !== 'ε') out.add(x); });
        if (!first[s].has('ε')) return out;
      }
      out.add('ε');
      return out;
    };
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of GRAMMAR) firstOf(p.rhs).forEach(x => { if (!first[p.lhs].has(x)) { first[p.lhs].add(x); changed = true; } });
    }
    follow.program.add('$');
    changed = true;
    while (changed) {
      changed = false;
      for (const p of GRAMMAR) p.rhs.forEach((s, i) => {
        if (!isNT(s)) return;
        const rest = firstOf(p.rhs.slice(i + 1));
        const add = x => { if (x !== 'ε' && !follow[s].has(x)) { follow[s].add(x); changed = true; } };
        rest.forEach(add);
        if (rest.has('ε')) follow[p.lhs].forEach(add);
      });
    }
    const table = {}, conflicts = [];
    NONTERMS.forEach(n => { table[n] = {}; });
    for (const p of GRAMMAR) {
      const f = firstOf(p.rhs);
      const put = a => {
        const cell = (table[p.lhs][a] = table[p.lhs][a] || []);
        if (!cell.includes(p.id)) cell.push(p.id);
        if (cell.length > 1) conflicts.push([p.lhs, a]);
      };
      f.forEach(a => { if (a !== 'ε') put(a); });
      if (f.has('ε')) follow[p.lhs].forEach(put);
    }
    const sorted = s => [...s].sort((a, b) => termOrder(a) - termOrder(b));
    const F = {}, W = {};
    NONTERMS.forEach(n => { F[n] = sorted(first[n]); W[n] = sorted(follow[n]); });
    return { first: F, follow: W, table, conflicts };
  }
  const ANALYSIS = analyse();

  const HINTS = {
    FORWARD: 'MOVE', FD: 'MOVE', GO: 'MOVE', WALK: 'MOVE', STEP: 'MOVE',
    RIGHT: 'TURN', LEFT: 'TURN', RT: 'TURN', LT: 'TURN', ROTATE: 'TURN',
    COLOR: 'PEN', COLOUR: 'PEN', LOOP: 'REPEAT', FOR: 'REPEAT', TIMES: 'REPEAT', LET: 'SET', VAR: 'SET'
  };
  const said = t => t.type === 'EOF' ? 'the end of the program' : `"${t.text}"`;
  const inputText = t => (t.type === 'NUMBER' || t.type === 'IDENT') ? t.text : term(t);

  // Table-driven LL(1) parser. Builds the parse tree and a stack/input/action trace.
  function parse(tokens) {
    const nodes = [], trace = [];
    const mk = (sym, kind, step) => { const n = { id: nodes.length, sym, kind, step, children: [], tok: null, matchStep: null }; nodes.push(n); return n; };
    const root = mk('program', 'nt', 0);
    const stack = [{ sym: '$' }, { sym: 'program', node: root }];
    let pos = 0;
    for (;;) {
      const top = stack[stack.length - 1], tok = tokens[pos], a = term(tok);
      const row = { stack: stack.map(e => e.sym), input: tokens.slice(pos).map(inputText), tokIndex: pos };
      const prev = tokens[pos - 1];
      const fail = (msg, hint) => {
        trace.push({ ...row, action: 'error', kind: 'error' });
        const at = tok.type === 'EOF' && prev ? prev : tok;
        return { tree: root, nodes, trace, errors: [{ phase: 'parse', msg, hint, line: at.line, col: at.col, start: at.start, end: Math.max(at.end, at.start + 1) }] };
      };
      if (top.sym === '$') {
        if (a === '$') { trace.push({ ...row, action: 'accept', kind: 'accept' }); break; }
        return fail(`Found ${said(tok)} after the program was complete.`, a === '}' ? 'This } has no matching {.' : 'Delete it or finish the command before it.');
      }
      if (!isNT(top.sym)) {
        if (top.sym === a) {
          stack.pop();
          top.node.tok = tok;
          top.node.matchStep = trace.length;
          trace.push({ ...row, action: `match ${inputText(tok)}`, kind: 'match', node: top.node.id });
          pos++;
          continue;
        }
        const after = prev ? ` after "${prev.text}"` : '';
        const want = {
          ';': [`Expected ;${after} but found ${said(tok)}.`, 'Every command ends with a semicolon.'],
          '}': [`Expected } to close the REPEAT block but found ${said(tok)}.`, 'Every { needs a matching }.'],
          '{': [`Expected {${after} but found ${said(tok)}.`, 'Write REPEAT 4 { … }.'],
          '=': [`Expected = after the name in SET but found ${said(tok)}.`, 'Write SET side = 100;'],
          NUMBER: [`Expected a number after = but found ${said(tok)}.`, 'SET only takes a number: SET side = 100;'],
          IDENT: [`Expected a name${after} but found ${said(tok)}.`, prev && prev.value === 'PEN' ? 'Write a colour: PEN BLUE;' : 'Write a name: SET side = 100;']
        }[top.sym] || [`Expected ${top.sym} but found ${said(tok)}.`, ''];
        return fail(want[0], want[1]);
      }
      const cell = ANALYSIS.table[top.sym][a];
      if (!cell) {
        if (top.sym === 'value') return fail(`Expected a number or a name${prev ? ` after "${prev.text}"` : ''} but found ${said(tok)}.`, 'For example MOVE 100; or MOVE side;');
        if (a === 'IDENT' && HINTS[tok.text.toUpperCase()]) return fail(`"${tok.text}" is not a command. Did you mean ${HINTS[tok.text.toUpperCase()]}?`, 'Commands are MOVE, TURN, PEN, PENUP, PENDOWN, REPEAT and SET.');
        return fail(`A command can't start with ${said(tok)}.`, 'Commands are MOVE, TURN, PEN, PENUP, PENDOWN, REPEAT and SET.');
      }
      const p = GRAMMAR.find(g => g.id === cell[0]);
      stack.pop();
      const step = trace.length;
      trace.push({ ...row, action: `${p.lhs} → ${p.rhs.join(' ') || 'ε'}`, kind: 'expand', prod: p.id, cell: [top.sym, a], node: top.node.id });
      top.node.prod = p.id;
      if (!p.rhs.length) top.node.children.push(mk('ε', 'eps', step));
      const kids = p.rhs.map(s => { const k = mk(s, isNT(s) ? 'nt' : 't', step); top.node.children.push(k); return k; });
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ sym: p.rhs[i], node: kids[i] });
    }
    return { tree: root, nodes, trace, errors: [] };
  }

  // A smaller tree for the later phases: one object per statement.
  function buildAST(tree) {
    const value = v => { const t = v.children[0].tok; return t.type === 'NUMBER' ? { num: t.value, tok: t } : { name: t.text, tok: t }; };
    const list = n => {
      const out = [];
      while (n && n.sym === 'stmt_list' && n.children.length && n.children[0].sym === 'stmt') { out.push(stmt(n.children[0])); n = n.children[1]; }
      return out;
    };
    function stmt(s) {
      const k = s.children, kw = k[0].tok, base = { kind: kw.value, line: kw.line, tok: kw };
      switch (kw.value) {
        case 'MOVE': case 'TURN': return { ...base, value: value(k[1]) };
        case 'PEN': return { ...base, name: k[1].tok.text, nameTok: k[1].tok };
        case 'SET': return { ...base, name: k[1].tok.text, nameTok: k[1].tok, num: k[3].tok.value };
        case 'REPEAT': return { ...base, value: value(k[1]), body: list(k[3]) };
        default: return base;
      }
    }
    return { body: list(tree.children[0]) };
  }

  // ---------- Phase 3: semantic analysis ----------
  function check(ast) {
    const table = new Map(), symbols = [], checks = [], errors = [], warnings = [];
    const push = (rule, level, text, tok, extra) => {
      checks.push({ rule, level, text, line: tok.line, ...extra });
      if (level !== 'ok') (level === 'warn' ? warnings : errors).push({ phase: 'sem', rule, msg: text, line: tok.line, col: tok.col, start: tok.start, end: tok.end });
    };
    const resolve = v => {
      if (v.num !== undefined) return v.num;
      const s = table.get(v.name);
      if (!s) { push('S1', 'error', `${v.name} is used but was never SET.`, v.tok); return null; }
      if (!s.uses.includes(v.tok.line)) s.uses.push(v.tok.line);
      push('S1', 'ok', `${v.name} is in the symbol table: ${s.value} (SET on line ${s.line})`, v.tok);
      return s.value;
    };
    const range = (rule, cmd, v, val, lim) => {
      if (val === null) return;
      const [lo, hi] = lim, shown = v.name !== undefined ? `${cmd} ${v.name} (= ${val})` : `${cmd} ${val}`;
      const ok = val >= lo && val <= hi;
      push(rule, ok ? 'ok' : 'error', ok ? `${shown} is inside ${lo} to ${hi}` : `${shown} is outside ${lo} to ${hi}.`, v.tok);
    };
    const walk = (list, depth) => {
      for (const s of list) {
        if (s.kind === 'SET') {
          if (COLORS[s.name.toUpperCase()]) { push('S8', 'error', `${s.name} is a colour name, so it can't be used as a variable name.`, s.nameTok); continue; }
          const prev = table.get(s.name);
          if (prev) { push('S2', 'error', `${s.name} was already SET on line ${prev.line}. A name can be SET only once.`, s.nameTok); continue; }
          const sym = { name: s.name, type: 'number', value: s.num, line: s.line, uses: [], tok: s.nameTok };
          table.set(s.name, sym); symbols.push(sym);
          push('S2', 'ok', `${s.name} = ${s.num} added to the symbol table`, s.nameTok, { defines: s.name });
        } else if (s.kind === 'PEN') {
          const up = s.name.toUpperCase();
          if (COLORS[up]) push('S3', 'ok', `${up} is in the colour table`, s.nameTok);
          else if (table.has(s.name)) push('S3', 'error', `${s.name} is a number, but PEN needs a colour.`, s.nameTok);
          else push('S3', 'error', `${s.name} is not a colour. Use one of ${COLOR_NAMES.join(', ')}.`, s.nameTok);
        } else if (s.kind === 'MOVE') range('S4', 'MOVE', s.value, resolve(s.value), LIMITS.MOVE);
        else if (s.kind === 'TURN') range('S5', 'TURN', s.value, resolve(s.value), LIMITS.TURN);
        else if (s.kind === 'REPEAT') {
          const d = depth + 1;
          if (d > LIMITS.DEPTH) push('S7', 'error', `This REPEAT is nested ${d} deep. The limit is ${LIMITS.DEPTH}, because the machine has 3 loop registers.`, s.tok);
          else push('S7', 'ok', `REPEAT at depth ${d} (limit ${LIMITS.DEPTH})`, s.tok);
          range('S6', 'REPEAT', s.value, resolve(s.value), LIMITS.REPEAT);
          if (!s.body.length) push('W2', 'warn', 'This REPEAT has nothing inside, so it does nothing.', s.tok);
          walk(s.body, d);
        }
      }
    };
    walk(ast.body, 0);
    symbols.forEach(sym => { if (!sym.uses.length) push('W1', 'warn', `${sym.name} is SET but never used.`, sym.tok); });
    return { symbols, checks, errors, warnings };
  }

  // ---------- Phase 4: intermediate code (three-address code) ----------
  function genIR(ast) {
    const code = [];
    let t = 0, l = 0, loops = 0, lastLine = 1;
    const emit = (op, f) => { const ins = { id: code.length + 1, op, a1: null, a2: null, res: null, ...f }; code.push(ins); lastLine = ins.line; return ins; };
    const val = v => v.num !== undefined ? v.num : v.name;
    // newtemp() and newlabel() skip any name the program SETs, so a variable called t1 never clashes with a temp.
    const taken = new Set();
    const collect = list => list.forEach(s => { if (s.kind === 'SET') taken.add(s.name); if (s.body) collect(s.body); });
    collect(ast.body);
    const newTemp = () => { do t++; while (taken.has('t' + t)); return 't' + t; };
    const newLabel = () => { do l++; while (taken.has('L' + l)); return 'L' + l; };
    const gen = list => {
      for (const s of list) {
        const line = s.line;
        switch (s.kind) {
          case 'SET': emit('COPY', { res: s.name, a1: s.num, role: 'set', line }); break;
          case 'MOVE': emit('MOVE', { a1: val(s.value), line }); break;
          case 'TURN': emit('TURN', { a1: val(s.value), line }); break;
          case 'PEN': emit('COLOR', { a1: s.name.toUpperCase(), line }); break;
          case 'PENUP': emit('PENUP', { line }); break;
          case 'PENDOWN': emit('PENDOWN', { line }); break;
          case 'REPEAT': {
            const L = ++loops, tmp = newTemp(), top = newLabel(), out = newLabel();
            emit('COPY', { res: tmp, a1: val(s.value), role: 'init', loop: L, line });
            emit('LABEL', { res: top, role: 'head', loop: L, line });
            emit('IFLE', { a1: tmp, a2: 0, res: out, role: 'test', loop: L, line });
            gen(s.body);
            emit('DEC', { res: tmp, a1: tmp, a2: 1, role: 'dec', loop: L, line });
            emit('GOTO', { res: top, role: 'back', loop: L, line });
            emit('LABEL', { res: out, role: 'exit', loop: L, line });
            break;
          }
        }
      }
    };
    gen(ast.body);
    emit('HALT', { line: lastLine });
    return code;
  }

  function tacText(c) {
    switch (c.op) {
      case 'COPY': return `${c.res} = ${c.a1}`;
      case 'MOVE': return `move ${c.a1}`;
      case 'TURN': return `turn ${c.a1}`;
      case 'COLOR': return `color ${c.a1}`;
      case 'PENUP': return 'penup';
      case 'PENDOWN': return 'pendown';
      case 'LABEL': return `${c.res}:`;
      case 'IFLE': return `if ${c.a1} <= 0 goto ${c.res}`;
      case 'DEC': return `${c.res} = ${c.a1} - 1`;
      case 'GOTO': return `goto ${c.res}`;
      default: return 'halt';
    }
  }

  // Quadruple form: (op, arg1, arg2, result)
  function quad(c) {
    const e = '';
    switch (c.op) {
      case 'COPY': return ['=', c.a1, e, c.res];
      case 'MOVE': return ['move', c.a1, e, e];
      case 'TURN': return ['turn', c.a1, e, e];
      case 'COLOR': return ['color', c.a1, e, e];
      case 'PENUP': return ['penup', e, e, e];
      case 'PENDOWN': return ['pendown', e, e, e];
      case 'LABEL': return ['label', e, e, c.res];
      case 'IFLE': return ['if<=', c.a1, 0, c.res];
      case 'DEC': return ['-', c.a1, 1, c.res];
      case 'GOTO': return ['goto', e, e, c.res];
      default: return ['halt', e, e, e];
    }
  }

  // Leaders: the first line, every label, and every line after a jump.
  function basicBlocks(code) {
    const leaders = new Set([0]);
    code.forEach((c, i) => {
      if (c.op === 'LABEL') leaders.add(i);
      if ((c.op === 'IFLE' || c.op === 'GOTO') && i + 1 < code.length) leaders.add(i + 1);
    });
    const starts = [...leaders].sort((a, b) => a - b);
    const blocks = starts.map((s, k) => ({ name: 'B' + (k + 1), start: s, end: (k + 1 < starts.length ? starts[k + 1] : code.length) - 1, succ: [] }));
    const at = {};
    blocks.forEach(b => { if (code[b.start].op === 'LABEL') at[code[b.start].res] = b.name; });
    blocks.forEach((b, k) => {
      const last = code[b.end], next = blocks[k + 1];
      if (last.op === 'GOTO') b.succ = [at[last.res]];
      else if (last.op === 'IFLE') b.succ = [at[last.res], next && next.name].filter(Boolean);
      else if (last.op !== 'HALT' && next) b.succ = [next.name];
    });
    return blocks;
  }

  // ---------- Phase 5: code optimization ----------
  const OPT_RULES = {
    O1: 'Constant propagation', O2: 'Dead code elimination', O3: 'Redundant code removal',
    O4: 'Peephole merge', O5: 'Loop simplification', O6: 'Code motion'
  };
  const stateKind = c => c.op === 'COLOR' ? 'color' : (c.op === 'PENUP' || c.op === 'PENDOWN') ? 'pen' : null;
  const stateVal = c => c.op === 'COLOR' ? c.a1 : c.op;
  const isJump = c => c.op === 'IFLE' || c.op === 'GOTO';
  const isNum = x => typeof x === 'number';

  function optimize(input) {
    const code = input.map(c => ({ ...c }));
    const log = [];
    const note = (rule, msg, ids, line) => log.push({ rule, msg, ids, line, code: code.map(c => ({ ...c })) });
    const consts = Object.create(null); // no prototype, so names like __proto__ or toString are plain keys
    code.forEach(c => { if (c.op === 'COPY' && c.role === 'set') consts[c.res] = c.a1; });
    const usesName = c => c.op === 'MOVE' || c.op === 'TURN' || (c.op === 'COPY' && c.role === 'init');
    let changed = true, rounds = 0;
    while (changed && rounds < 60) {
      changed = false; rounds++;

      // O1: swap a constant's name for its value
      for (const c of code) {
        if (usesName(c) && typeof c.a1 === 'string' && c.a1 in consts) {
          const was = tacText(c);
          c.a1 = consts[c.a1];
          note('O1', `${was}  →  ${tacText(c)}`, [c.id], c.line); changed = true;
        }
      }

      // O2: a constant nothing reads any more
      for (let i = code.length - 1; i >= 0; i--) {
        const c = code[i];
        if (c.op === 'COPY' && c.role === 'set' && !code.some(d => usesName(d) && d.a1 === c.res)) {
          code.splice(i, 1);
          note('O2', `${tacText(c)} deleted: nothing reads ${c.res} now`, [], c.line); changed = true;
        }
      }

      // O2: colour or pen set, then set again before anything is drawn
      for (let i = 0; i < code.length; i++) {
        const c = code[i], k = stateKind(c);
        if (!k) continue;
        let dead = false, by = null;
        for (let j = i + 1; j < code.length; j++) {
          const d = code[j];
          if (d.op === 'MOVE' || d.op === 'LABEL' || isJump(d)) break;
          if (d.op === 'HALT') { dead = true; break; }
          if (stateKind(d) === k) { dead = true; by = d; break; }
        }
        if (dead) {
          code.splice(i, 1); i--;
          note('O2', by ? `${tacText(c)} deleted: ${tacText(by)} replaces it before anything is drawn` : `${tacText(c)} deleted: nothing is drawn after it`, [], c.line);
          changed = true;
        }
      }

      // O3: setting what is already set; turns that come back to the same heading
      let known = { color: START.color, pen: START.pen };
      for (let i = 0; i < code.length; i++) {
        const c = code[i];
        if (c.op === 'LABEL' || (i > 0 && isJump(code[i - 1]))) known = {};
        const k = stateKind(c);
        if (k) {
          if (known[k] === stateVal(c)) {
            code.splice(i, 1); i--;
            note('O3', `${tacText(c)} deleted: the ${k === 'pen' ? 'pen is already ' + (c.op === 'PENUP' ? 'up' : 'down') : 'colour is already ' + c.a1}`, [], c.line);
            changed = true; continue;
          }
          known[k] = stateVal(c);
        }
        if (c.op === 'TURN' && isNum(c.a1)) {
          let n = ((c.a1 % 360) + 360) % 360;
          if (n > 180) n -= 360;
          if (n === 0) {
            code.splice(i, 1); i--;
            note('O3', `${tacText(c)} deleted: a full turn ends facing the same way`, [], c.line); changed = true;
          } else if (n !== c.a1) {
            const was = tacText(c); c.a1 = n;
            note('O4', `${was}  →  ${tacText(c)} (same heading, shorter turn)`, [c.id], c.line); changed = true;
          }
        }
      }

      // O4: join two neighbouring moves or turns (they are always in the same basic block)
      for (let i = 0; i + 1 < code.length; i++) {
        const c = code[i], d = code[i + 1];
        if (c.op === d.op && (c.op === 'MOVE' || c.op === 'TURN') && isNum(c.a1) && isNum(d.a1) && Math.abs(c.a1 + d.a1) <= 32767) {
          const was = `${tacText(c)}; ${tacText(d)}`;
          c.a1 += d.a1; code.splice(i + 1, 1);
          note('O4', `${was}  →  ${tacText(c)}`, [c.id], c.line); changed = true; i--;
        }
      }

      // O5 and O6 work on whole loops
      const parts = ['init', 'head', 'test', 'dec', 'back', 'exit'];
      const dropLoop = L => { for (let i = code.length - 1; i >= 0; i--) if (code[i].loop === L && parts.includes(code[i].role)) code.splice(i, 1); };
      for (const L of code.filter(c => c.role === 'init').map(c => c.loop)) {
        const idx = r => code.findIndex(c => c.loop === L && c.role === r);
        const iInit = idx('init'), iTest = idx('test'), iDec = idx('dec');
        if (iInit < 0) continue;
        const init = code[iInit];
        if (iDec === iTest + 1) {
          dropLoop(L);
          note('O5', `REPEAT ${init.a1} with nothing inside: whole loop deleted`, [], init.line); changed = true;
        } else if (init.a1 === 1) {
          dropLoop(L);
          note('O5', 'REPEAT 1 runs once: loop deleted, its body kept', [], init.line); changed = true;
        }
      }
      for (const L of code.filter(c => c.role === 'init').map(c => c.loop)) {
        const idx = r => code.findIndex(c => c.loop === L && c.role === r);
        const iInit = idx('init'), iTest = idx('test'), iDec = idx('dec');
        let moved = false;
        for (let j = iTest + 1; j < iDec; j++) {
          const c = code[j];
          if (c.op === 'MOVE' || c.role === 'init' || c.op === 'LABEL' || isJump(c)) break;
          const k = stateKind(c);
          if (!k) continue;
          if (code.slice(iTest + 1, iDec).filter(d => stateKind(d) === k).length === 1) {
            code.splice(j, 1); code.splice(iInit, 0, c);
            const n = code[iInit + 1].a1;
            note('O6', `${tacText(c)} moved out of REPEAT ${n}: it runs once instead of ${n} times`, [c.id], c.line);
            changed = true; moved = true;
          }
          break;
        }
        if (moved) break; // positions shifted; the next round looks again
      }
    }
    return { code, log, rounds };
  }

  // ---------- Phase 6: code generation ----------
  const OPCODES = { FWD: 0x10, RGT: 0x11, LFT: 0x12, COL: 0x20, PUP: 0x21, PDN: 0x22, LDI: 0x30, DEC: 0x31, JLE: 0x40, JMP: 0x41, HLT: 0xFF };
  const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');

  function asmText(p) {
    switch (p.mn) {
      case 'FWD': case 'RGT': case 'LFT': return `${p.mn}  #${p.operand}`;
      case 'COL': return `COL  #${p.color}`;
      case 'LDI': return `LDI  R${p.reg}, #${p.operand}`;
      case 'DEC': return `DEC  R${p.reg}`;
      case 'JLE': return `JLE  R${p.reg}, ${hex(p.operand, 4)}`;
      case 'JMP': return `JMP  ${hex(p.operand, 4)}`;
      default: return p.mn;
    }
  }

  function codegen(code) {
    const consts = Object.create(null); // no prototype, so names like __proto__ or toString are plain keys
    code.forEach(c => { if (c.op === 'COPY' && c.role === 'set') consts[c.res] = c.a1; });
    const val = x => isNum(x) ? x : consts[x];
    const prog = [], labels = {}, regs = [], regOf = {}, active = [];
    for (const c of code) {
      const at = (mn, f) => prog.push({ addr: prog.length, mn, reg: 0, operand: 0, from: c, ...f });
      switch (c.op) {
        case 'LABEL': labels[c.res] = prog.length; if (c.role === 'exit') active.pop(); break;
        case 'COPY':
          if (c.role === 'init') {
            active.push(c.res);
            const r = active.length;
            regOf[c.res] = r;
            regs.push({ temp: c.res, reg: 'R' + r, line: c.line });
            at('LDI', { reg: r, operand: val(c.a1) });
          }
          break;
        case 'MOVE': at('FWD', { operand: val(c.a1) }); break;
        case 'TURN': { const v = val(c.a1); if (v >= 0) at('RGT', { operand: v }); else at('LFT', { operand: -v }); break; }
        case 'COLOR': at('COL', { operand: COLOR_NAMES.indexOf(c.a1), color: c.a1 }); break;
        case 'PENUP': at('PUP'); break;
        case 'PENDOWN': at('PDN'); break;
        case 'DEC': at('DEC', { reg: regOf[c.res] }); break;
        case 'IFLE': at('JLE', { reg: regOf[c.a1], label: c.res }); break;
        case 'GOTO': at('JMP', { label: c.res }); break;
        case 'HALT': at('HLT'); break;
      }
    }
    // Second pass: now every label has an address, so fill in the jumps (backpatching).
    prog.forEach(p => {
      if (p.label) p.operand = labels[p.label];
      p.bytes = [OPCODES[p.mn], p.reg, (p.operand >> 8) & 255, p.operand & 255];
      p.text = asmText(p);
    });
    return { prog, labels, regs };
  }

  // ---------- The Turtle VM: runs the machine code ----------
  function makeVM(prog) {
    const s = { pc: 0, R: [0, 0, 0, 0], x: 0, y: 0, h: 0, pen: true, color: START.color, steps: 0, halted: false, segments: [] };
    function step() {
      const p = prog[s.pc];
      if (!p || s.halted) { s.halted = true; return null; }
      s.steps++;
      let next = s.pc + 1, seg = null;
      switch (p.mn) {
        case 'FWD': {
          const r = s.h * Math.PI / 180, nx = s.x + Math.sin(r) * p.operand, ny = s.y - Math.cos(r) * p.operand;
          if (s.pen) { seg = { x1: s.x, y1: s.y, x2: nx, y2: ny, color: s.color }; s.segments.push(seg); }
          s.x = nx; s.y = ny; break;
        }
        case 'RGT': s.h = (s.h + p.operand) % 360; break;
        case 'LFT': s.h = (((s.h - p.operand) % 360) + 360) % 360; break;
        case 'COL': s.color = p.color; break;
        case 'PUP': s.pen = false; break;
        case 'PDN': s.pen = true; break;
        case 'LDI': s.R[p.reg] = p.operand; break;
        case 'DEC': s.R[p.reg]--; break;
        case 'JLE': if (s.R[p.reg] <= 0) next = p.operand; break;
        case 'JMP': next = p.operand; break;
        case 'HLT': s.halted = true; break;
      }
      const at = s.pc;
      if (!s.halted) s.pc = next;
      return { at, ins: p, seg };
    }
    return { state: s, step };
  }

  function run(prog, limit = LIMITS.STEPS) {
    const vm = makeVM(prog);
    while (!vm.state.halted && vm.state.steps < limit) vm.step();
    return { segments: vm.state.segments, steps: vm.state.steps, limitHit: !vm.state.halted };
  }

  // Two drawings are the same if they match after joining straight runs.
  function normalise(segs) {
    const out = [];
    for (const s of segs) {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const p = out[out.length - 1];
      if (p && p.color === s.color && Math.abs(p.x2 - s.x1) < 1e-6 && Math.abs(p.y2 - s.y1) < 1e-6) {
        const pdx = p.x2 - p.x1, pdy = p.y2 - p.y1;
        if (Math.abs(pdx * dy - pdy * dx) < 1e-6 * Math.hypot(pdx, pdy) * len && pdx * dx + pdy * dy > 0) { p.x2 = s.x2; p.y2 = s.y2; continue; }
      }
      out.push({ ...s });
    }
    return out;
  }
  function sameDrawing(a, b) {
    const A = normalise(a), B = normalise(b);
    if (A.length !== B.length) return false;
    const close = (u, v) => Math.abs(u - v) < 1e-6 * (1 + Math.abs(u));
    return A.every((s, i) => s.color === B[i].color && close(s.x1, B[i].x1) && close(s.y1, B[i].y1) && close(s.x2, B[i].x2) && close(s.y2, B[i].y2));
  }

  // ---------- All six phases, in order ----------
  function compile(src) {
    const out = { src, stopAt: null };
    out.lex = lex(src);
    if (out.lex.errors.length) { out.stopAt = 'lex'; return out; }
    out.parse = parse(out.lex.tokens);
    if (out.parse.errors.length) { out.stopAt = 'parse'; return out; }
    out.ast = buildAST(out.parse.tree);
    out.sem = check(out.ast);
    if (out.sem.errors.length) { out.stopAt = 'sem'; return out; }
    out.ir = genIR(out.ast);
    out.opt = optimize(out.ir);
    out.gen = codegen(out.opt.code);
    out.run = run(out.gen.prog);
    const plain = run(codegen(out.ir).prog);
    const count = code => code.filter(c => c.op !== 'LABEL').length;
    out.opt.stats = {
      before: count(out.ir), after: count(out.opt.code),
      stepsBefore: plain.steps, stepsAfter: out.run.steps,
      limitHit: plain.limitHit || out.run.limitHit,
      same: !(plain.limitHit || out.run.limitHit) && sameDrawing(plain.segments, out.run.segments)
    };
    return out;
  }

  const TC = {
    KEYWORDS, COLORS, COLOR_NAMES, LIMITS, START, GRAMMAR, NONTERMS, TERMS, ANALYSIS, OPT_RULES, OPCODES,
    lex, term, parse, buildAST, check, genIR, tacText, quad, basicBlocks, optimize, codegen, makeVM, run, sameDrawing, compile, hex
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = TC;
  else root.TC = TC;
})(typeof window !== 'undefined' ? window : globalThis);
