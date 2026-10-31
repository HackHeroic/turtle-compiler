/* Phase 1 (lexical analysis) and phase 2 (syntax analysis) views.
   Registers 'lex' and 'parse' with TCUI. Every fact on screen comes from js/compiler.js (window.TC);
   this file only draws it. */
(function (root) {
  'use strict';
  const TC = root.TC;
  const UI = root.TCUI || null;
  const esc = UI ? UI.esc : s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Shared helpers ----------
  const KW = new Set(TC.KEYWORDS);
  const NT = new Set(TC.NONTERMS);
  const RULE = {};
  TC.GRAMMAR.forEach(g => { RULE[g.id] = g; });

  // Colour class for a lexer type, and for a grammar symbol. Both map onto the --tok-* colours.
  const TYPE_CLS = { KEYWORD: 'kw', IDENT: 'id', NUMBER: 'num', LBRACE: 'sym', RBRACE: 'sym', SEMI: 'sym', ASSIGN: 'sym', COMMENT: 'com', WS: 'ws', ERROR: 'err', EOF: 'eof' };
  const typeCls = type => TYPE_CLS[type] || 'sym';
  const symCls = s => NT.has(s) ? 'nt' : KW.has(s) ? 'kw' : s === 'NUMBER' ? 'num' : s === 'IDENT' ? 'id' : s === '$' ? 'eof' : s === 'ε' ? 'eps' : 'sym';
  const LIT = { kw: 'var(--tok-keyword)', id: 'var(--tok-ident)', num: 'var(--tok-number)', sym: 'var(--tok-symbol)', err: 'var(--tok-error)' };

  // Every grammar rule gets its own colour, so a rule number looks the same in the grammar, table, trace and tree.
  // Mixing with --lift makes it lighter in the dark theme and deeper in the light one, so --on-hue text stays readable.
  const ruleColor = id => `color-mix(in oklch, oklch(0.7 0.2 ${Math.round(5 + (id - 1) * 360 / TC.GRAMMAR.length)}) 70%, var(--lift))`;
  const ruleBadge = id => `<span class="ps-rn" style="--rc:${ruleColor(id)}">${id}</span>`;
  const symSpan = s => `<span class="ps-s ps-c-${symCls(s)}">${esc(s)}</span>`;
  const rhsText = g => g.rhs.length ? g.rhs.join(' ') : 'ε';
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const r1 = v => Math.round(v * 10) / 10;

  // What the parser's input column shows for a token (same as inputText in compiler.js).
  const inputText = t => (t.type === 'NUMBER' || t.type === 'IDENT') ? t.text : TC.term(t);

  // Characters that would be invisible on screen are shown by their code instead.
  const INVISIBLE = /[\s\u0000-\u001f\u007f-\u00a0\u00ad\u2000-\u200f\u2028-\u202f\u2060\ufeff\ud800-\udfff]/;
  const shown = t => INVISIBLE.test(t) ? [...t].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ') : t;

  const smooth = () => (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth';

  // Scroll only the box (never the page) so that item sits inside it. padTop leaves room for a sticky header;
  // onlyY is for table rows, which are always as wide as the table.
  function keepVisible(box, item, padTop, onlyY) {
    if (!box || !item || !box.isConnected || !box.getBoundingClientRect) return;
    const b = box.getBoundingClientRect(), r = item.getBoundingClientRect();
    const top0 = b.top + (padTop || 0);
    let top = box.scrollTop, left = box.scrollLeft;
    if (box.scrollHeight > box.clientHeight + 1 && (r.top < top0 || r.bottom > b.bottom)) top += (r.top + r.bottom) / 2 - (top0 + b.bottom) / 2;
    if (!onlyY && box.scrollWidth > box.clientWidth + 1 && (r.left < b.left || r.right > b.right)) left += (r.left + r.right) / 2 - (b.left + b.right) / 2;
    if (top !== box.scrollTop || left !== box.scrollLeft) {
      if (box.scrollTo) box.scrollTo({ top, left, behavior: smooth() });
      else { box.scrollTop = top; box.scrollLeft = left; }
    }
  }

  // FIRST of a sequence of grammar symbols, read from TC.ANALYSIS.first.
  function firstOfSeq(seq) {
    const out = new Set();
    for (const s of seq) {
      if (!NT.has(s)) { out.add(s); return out; }
      TC.ANALYSIS.first[s].forEach(x => { if (x !== 'ε') out.add(x); });
      if (!TC.ANALYSIS.first[s].includes('ε')) return out;
    }
    out.add('ε');
    return out;
  }

  // =====================================================================
  // Phase 1: lexical analysis
  // =====================================================================
  const LX = { stepper: null, token: null, rules: null };

  // Rows of the token table. types = the lexer types a row covers (that row lights up while stepping).
  const TOKEN_ROWS = [
    { types: ['KEYWORD'], cls: 'kw', name: 'KEYWORD',
      pat: `a word found in the keyword table<br>${TC.KEYWORDS.map(k => `<code>${k}</code>`).join(' ')}`, ex: [['KEYWORD', 'MOVE'], ['KEYWORD', 'move']] },
    { types: ['IDENT'], cls: 'id', name: 'IDENT', pat: '<code>[A-Za-z_][A-Za-z0-9_]*</code><br>any other word', ex: [['IDENT', 'side'], ['IDENT', 'BLUE']] },
    { types: ['NUMBER'], cls: 'num', name: 'NUMBER', pat: '<code>-?[0-9]+</code>', ex: [['NUMBER', '150'], ['NUMBER', '-90']] },
    { types: ['LBRACE', 'RBRACE', 'SEMI', 'ASSIGN'], cls: 'sym', name: 'symbols', pat: '<code>{</code> <code>}</code> <code>;</code> <code>=</code><br>one rule each', ex: [['LBRACE', '{'], ['RBRACE', '}'], ['SEMI', ';'], ['ASSIGN', '=']] },
    { types: ['WS', 'COMMENT'], cls: 'com', name: 'skipped', pat: '<code>[ \\t\\r\\n]+</code> white space<br><code>#[^\\n]*</code> comment to end of line', ex: [] },
    { types: ['ERROR'], cls: 'err', name: 'ERROR', pat: 'any other character', ex: [['ERROR', '@']] },
    { types: ['EOF'], cls: 'eof', name: 'EOF', pat: 'added once, after the last character', ex: [['EOF', '$']] }
  ];

  const miniChip = (type, text) => `<span class="lx-mini lx-${typeCls(type)}"><span class="lx-ct">${type}</span><span class="lx-cv">${esc(text)}</span></span>`;

  // The scanner drawn as a DFA. Elements carry data-dfa keys so stepping can light the path of a token.
  function dfaSVG() {
    const W = 500, H = 362;
    const SX = 50, SY = 196, SR = 22;          // start state
    const FX = SX + SR;                        // the fan of arrows leaves the start state here
    const BX = 232, BW = 92, BH = 28;          // state boxes
    const Y = { word: 52, num: 112, minus: 154, sym: 196, com: 246, ws: 296, err: 340 };
    const MX = 192, MR = 13;                   // the state after a minus sign
    const OX = 340;                            // the "token out" column
    const ah = (x, y, d) => {
      const v = { r: [-7, -4, -7, 4], u: [-4, 7, 4, 7], d: [-4, -7, 4, -7] }[d];
      return `<path class="lx-ah" d="M${x} ${y}L${x + v[0]} ${y + v[1]}L${x + v[2]} ${y + v[3]}Z"/>`;
    };
    const g = (key, cls, body) => `<g class="${cls}"${key ? ` data-dfa="${key}"` : ''}>${body}</g>`;
    const wire = d => `<path class="lx-wire" d="${d}"/>`;
    const text = (x, y, t, cls) => `<text class="${cls || 'lx-lab'}" x="${x}" y="${y}">${t}</text>`;
    const fan = (key, y, xEnd, t, mono) => g(key, 'lx-e',
      wire(`M${FX} ${SY}C${FX + 40} ${SY} ${FX + 40} ${y} ${FX + 80} ${y}L${xEnd - 7} ${y}`) + ah(xEnd, y, 'r') + text(FX + 84, y - 7, t, mono ? 'lx-lab lx-mono' : 'lx-lab'));
    const state = (key, y, t, cls, accept) => g(key, `lx-s ${cls}`,
      `<rect x="${BX}" y="${y - BH / 2}" width="${BW}" height="${BH}" rx="${BH / 2}"/>` +
      (accept ? `<rect class="lx-ring" x="${BX + 3.5}" y="${y - BH / 2 + 3.5}" width="${BW - 7}" height="${BH - 7}" rx="${BH / 2 - 3.5}"/>` : '') +
      text(BX + BW / 2, y + 4.5, t, 'lx-st'));
    const loop = (key, y, t) => {
      const top = y - BH / 2, a = BX + 12, b = BX + 32;
      return g(key, 'lx-e', wire(`M${a} ${top}C${a - 6} ${top - 24} ${b + 6} ${top - 24} ${b} ${top - 7}`) + ah(b, top, 'd') + text(b + 10, top - 9, t, 'lx-lab lx-mono'));
    };
    const arrow = (key, y, x2) => g(key, 'lx-e', wire(`M${BX + BW} ${y}L${x2 - 7} ${y}`) + ah(x2, y, 'r'));
    const out = (key, y, t, cls, x, w, h) => g(key, `lx-o ${cls}${h < 20 ? ' lx-om' : ''}`,
      `<rect x="${x}" y="${y - h / 2}" width="${w}" height="${h}" rx="${h > 20 ? 7 : 5}"/>` + text(x + w / 2, y + 4, t, 'lx-ot'));

    const parts = [
      text(467, 13, 'token out', 'lx-lab lx-head'),
      // start state and its entry arrow
      g('', 'lx-e lx-entry', wire(`M4 ${SY}L${SX - SR - 7} ${SY}`) + ah(SX - SR, SY, 'r')),
      // one arrow per kind of first character
      fan('e-word', Y.word, BX, 'letter or _'),
      fan('e-num', Y.num, BX, 'digit'),
      fan('e-minus', Y.minus, MX - MR, '-', true),
      fan('e-sym', Y.sym, BX, '{ } ; =', true),
      fan('e-com', Y.com, BX, '#', true),
      fan('e-ws', Y.ws, BX, 'white space'),
      fan('e-err', Y.err, BX, 'any other'),
      g('start', 'lx-s lx-start', `<circle cx="${SX}" cy="${SY}" r="${SR}"/>` + text(SX, SY + 4, 'start', 'lx-st lx-st-small')),
      // WORD, then the keyword table decides
      loop('l-word', Y.word, 'letter, digit, _'),
      state('s-word', Y.word, 'WORD', 'lx-word', true),
      arrow('e-kwt', Y.word, OX),
      g('s-kwt', 'lx-s lx-table', `<rect x="${OX}" y="${Y.word - 17}" width="58" height="34" rx="7"/>` + text(OX + 29, Y.word - 3, 'keyword', 'lx-st lx-st-small') + text(OX + 29, Y.word + 10, 'table?', 'lx-st lx-st-small')),
      g('e-kw', 'lx-e', wire(`M${OX + 58} ${Y.word}L410 ${Y.word}L410 ${Y.word - 16}L427 ${Y.word - 16}`) + ah(434, Y.word - 16, 'r') + text(414, Y.word - 21, 'yes')),
      g('e-id', 'lx-e', wire(`M410 ${Y.word}L410 ${Y.word + 16}L427 ${Y.word + 16}`) + ah(434, Y.word + 16, 'r') + text(414, Y.word + 29, 'no')),
      out('o-kw', Y.word - 16, 'KEYWORD', 'lx-kw', 436, 62, 22),
      out('o-id', Y.word + 16, 'IDENT', 'lx-id', 436, 62, 22),
      // NUMBER, with the minus-sign state feeding it
      loop('l-num', Y.num, 'digit'),
      state('s-num', Y.num, 'NUMBER', 'lx-num', true),
      g('s-minus', 'lx-s lx-num', `<circle cx="${MX}" cy="${Y.minus}" r="${MR}"/>` + text(MX, Y.minus + 4.5, '-', 'lx-st')),
      g('e-mnum', 'lx-e', wire(`M${MX + MR} ${Y.minus}L262 ${Y.minus}Q274 ${Y.minus} 274 ${Y.minus - 12}L274 ${Y.num + BH / 2 + 7}`) + ah(274, Y.num + BH / 2, 'u') + text(281, Y.minus - 6, 'digit', 'lx-lab lx-mono')),
      arrow('e-onum', Y.num, 434),
      out('o-num', Y.num, 'NUMBER', 'lx-num', 436, 62, 22),
      // symbols: each one has its own type
      state('s-sym', Y.sym, 'SYMBOL', 'lx-sym', true),
      arrow('e-osym', Y.sym, 394),
      out('o-LBRACE', Y.sym - 9.5, 'LBRACE', 'lx-sym', 398, 48, 17),
      out('o-RBRACE', Y.sym - 9.5, 'RBRACE', 'lx-sym', 450, 48, 17),
      out('o-SEMI', Y.sym + 9.5, 'SEMI', 'lx-sym', 398, 48, 17),
      out('o-ASSIGN', Y.sym + 9.5, 'ASSIGN', 'lx-sym', 450, 48, 17),
      // skipped pieces
      loop('l-com', Y.com, 'not newline'),
      state('s-com', Y.com, 'COMMENT', 'lx-com', true),
      arrow('e-ocom', Y.com, OX),
      g('o-com', 'lx-skip', text(OX + 4, Y.com + 4, 'skipped')),
      loop('l-ws', Y.ws, 'space, tab, newline'),
      state('s-ws', Y.ws, 'SPACE', 'lx-ws', true),
      arrow('e-ows', Y.ws, OX),
      g('o-ws', 'lx-skip', text(OX + 4, Y.ws + 4, 'skipped')),
      // no rule fits
      state('s-err', Y.err, 'ERROR', 'lx-err lx-errbox', false),
      arrow('e-oerr', Y.err, OX),
      g('o-err', 'lx-errout', text(OX + 4, Y.err + 4, 'report it, skip 1 char'))
    ];
    const label = 'The scanner as a DFA. From start, a letter or underscore goes to WORD, which loops on letters, digits and underscores; then the keyword table decides between KEYWORD and IDENT. ' +
      'A digit goes to NUMBER, which loops on digits. A minus sign goes to a state that needs a digit to reach NUMBER. One of { } ; = goes to SYMBOL. ' +
      'A # goes to COMMENT, which loops until a newline and is skipped. White space loops and is skipped. Any other character is an error.';
    return `<svg class="lx-dfa" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${parts.join('')}</svg>`;
  }

  // Which DFA parts one piece walks through. A key ending in "!" marks the state where it failed.
  function dfaPath(p) {
    if (!p) return [];
    const t = p.text;
    switch (p.type) {
      case 'KEYWORD': case 'IDENT': {
        const k = p.type === 'KEYWORD' ? 'kw' : 'id';
        return ['start', 'e-word', 's-word'].concat(t.length > 1 ? ['l-word'] : [], ['e-kwt', 's-kwt', 'e-' + k, 'o-' + k]);
      }
      case 'NUMBER': {
        const neg = t[0] === '-', digits = t.length - (neg ? 1 : 0);
        return ['start'].concat(neg ? ['e-minus', 's-minus', 'e-mnum'] : ['e-num'], ['s-num'], digits > 1 ? ['l-num'] : [], ['e-onum', 'o-num']);
      }
      case 'LBRACE': case 'RBRACE': case 'SEMI': case 'ASSIGN': return ['start', 'e-sym', 's-sym', 'e-osym', 'o-' + p.type];
      case 'ERROR': return t === '-' ? ['start', 'e-minus', 's-minus!'] : ['start', 'e-err', 's-err', 'e-oerr', 'o-err'];
      default: return [];
    }
  }

  function dfaLight(svg, keys, cls) {
    if (!svg) return;
    const on = new Set(), bad = new Set();
    keys.forEach(k => { if (k.endsWith('!')) bad.add(k.slice(0, -1)); else on.add(k); });
    svg.querySelectorAll('[data-dfa]').forEach(el => {
      const k = el.getAttribute('data-dfa');
      el.classList.toggle('is-on', on.has(k) || bad.has(k));
      el.classList.toggle('is-bad', bad.has(k));
    });
    svg.classList.toggle('is-active', keys.length > 0);
    if (LIT[cls]) svg.style.setProperty('--lit', LIT[cls]);
  }

  function lexRules(el) {
    const rows = TOKEN_ROWS.map(t => `
      <tr class="lx-${t.cls}" data-tt="${t.types.join(' ')}">
        <th scope="row"><span class="lx-type">${t.name}</span></th>
        <td class="lx-pat">${t.pat}</td>
        <td class="lx-ex">${t.ex.map(([ty, tx]) => miniChip(ty, tx)).join('')}</td>
      </tr>`).join('');
    el.innerHTML = `
      <div class="card">
        <h3 class="card-title">Token rules we set</h3>
        <p class="card-sub">The lexer cuts the source into tokens with these patterns. Each token type keeps its colour on the whole page.</p>
        <div class="scroll-x"><table class="tbl lx-tt">
          <thead><tr><th scope="col">Token</th><th scope="col">Pattern</th><th scope="col">Example</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
      <div class="card">
        <h3 class="card-title">How the scanner decides</h3>
        <ul class="lx-notes">
          <li><b>Longest match.</b> The word pattern keeps reading letters, digits and <code>_</code>, so <code>PENUP</code> is one token. The scanner never stops early at <code>PEN</code>.</li>
          <li><b>Keywords ignore case.</b> <code>move</code>, <code>Move</code> and <code>MOVE</code> are all the keyword MOVE. Your own names keep their case, so <code>side</code> and <code>Side</code> are two different names.</li>
          <li><b>Other words are IDENTs.</b> A word that is not in the keyword table becomes an IDENT. Colour names like <code>BLUE</code> are IDENTs too. Phase 3 checks them.</li>
          <li><b>Bad characters.</b> Any other character is a lexical error. The lexer reports it, skips that one character and keeps going, so you see every bad character at once.</li>
          <li><b>A minus sign touches its number.</b> <code>-90</code> is one NUMBER. <code>- 90</code> is an error, because a space splits the minus from the digits.</li>
          <li><b>In the code.</b> <code>lex()</code> tries the patterns in a fixed order at the current position: white space, comment, number, word, then the four symbols. Each pattern is greedy, and no two patterns start with the same character, so the first match is also the longest.</li>
        </ul>
      </div>
      <div class="card">
        <h3 class="card-title">The scanner as a DFA</h3>
        <figure class="lx-fig">
          <div class="scroll-x">${dfaSVG()}</div>
          <figcaption>The first character picks the path from <b>start</b>. Double rings are accepting states. When no arrow fits the next character, the scanner stops. In an accepting state it hands over the token (comments and spaces are dropped) and goes back to start. In any other state it reports an error. While you step, the path of the current token lights up.</figcaption>
        </figure>
      </div>`;
  }

  // One step per real token or bad character, in source order, then EOF. Skipped pieces are counted, not stepped.
  function lexSteps(lx) {
    const steps = [];
    let comments = 0;
    lx.pieces.forEach((p, k) => {
      if (p.type === 'COMMENT') { comments++; return; }
      if (p.type === 'WS') return;
      steps.push({ p, k, comments });
      comments = 0;
    });
    steps.push({ p: lx.tokens[lx.tokens.length - 1], k: lx.pieces.length, comments, eof: true });
    return steps;
  }

  function lexCaption(s) {
    const p = s.p;
    const skipped = s.comments ? `First the scanner skipped ${s.comments === 1 ? 'a comment' : s.comments + ' comments'}. ` : '';
    if (s.eof) return `${skipped}The input is used up, so the lexer adds the end marker <code class="lx-q lx-eof">$</code> (EOF). The parser uses it to know the program is complete.`;
    const at = `<span class="lx-at">line ${p.line}, col ${p.col}</span>`;
    const q = `<code class="lx-q lx-${typeCls(p.type)}">${esc(p.type === 'ERROR' ? shown(p.text) : p.text)}</code>`;
    const up = p.text.toUpperCase();
    const prefix = TC.KEYWORDS.filter(k => k !== up && up.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    let body;
    switch (p.type) {
      case 'KEYWORD':
        body = p.text === p.value
          ? `${q} matched the word pattern. The keyword table lists it, so the token is the keyword <b>${esc(p.value)}</b>.`
          : `${q} matched the word pattern. Keywords ignore case, and ${esc(p.value)} is in the keyword table, so the token is the keyword <b>${esc(p.value)}</b>.`;
        if (prefix) body += ` Longest match: the scanner read the whole word, so it did not stop at ${prefix}.`;
        break;
      case 'IDENT':
        body = `${q} matched the word pattern but is not in the keyword table, so it is an <b>IDENT</b>.`;
        if (TC.COLORS[up]) body += ' Colour names are IDENTs too. Phase 3 checks them.';
        else if (prefix) body += ` It starts with ${prefix}, but longest match reads the whole word.`;
        break;
      case 'NUMBER':
        body = p.text[0] === '-'
          ? `${q} matched NUMBER <code>-?[0-9]+</code>. The minus touches the digits, so it is part of the number. Value ${esc(p.value)}.`
          : `${q} matched NUMBER <code>-?[0-9]+</code>, so the token is a <b>NUMBER</b> with value ${esc(p.value)}.`;
        break;
      case 'ERROR':
        body = p.text === '-'
          ? `${q} is not followed by a digit, so it can't start a NUMBER. That is a <b class="bad-text">lexical error</b>: a minus sign must touch its number. The lexer skips it and keeps going.`
          : `${q} matches no token rule, so it is a <b class="bad-text">lexical error</b>. The lexer reports it, skips this one character and keeps going.`;
        break;
      default:
        body = `${q} matched its own one-character rule, so the token is <b>${esc(p.type)}</b>.`;
    }
    return `${at}${skipped}${body}`;
  }

  // Source view: one row per line, every piece wrapped in a coloured span (white space stays plain text).
  function srcHTML(lx) {
    const lines = [''];
    lx.pieces.forEach((p, k) => {
      p.text.replace(/\r/g, '').split('\n').forEach((part, j) => {
        if (j) lines.push('');
        if (!part) return;
        lines[lines.length - 1] += p.type === 'WS' ? esc(part) : `<span class="lx-p lx-${typeCls(p.type)}" data-k="${k}">${esc(part)}</span>`;
      });
    });
    lines[lines.length - 1] += `<span class="lx-p lx-eofmark lx-eof" data-k="${lx.pieces.length}" title="End of input: the lexer adds EOF here">$</span>`;
    return lines.map((l, i) => `<div class="lx-line"><span class="lx-ln" aria-hidden="true">${i + 1}</span><span class="lx-code">${l}</span></div>`).join('');
  }

  function chipHTML(s, i) {
    const p = s.p, type = s.eof ? 'EOF' : p.type;
    const text = s.eof ? '$' : p.type === 'ERROR' ? shown(p.text) : p.text;
    const val = p.type === 'KEYWORD' && p.text !== p.value ? ` <span class="lx-cvv">= ${esc(p.value)}</span>` : '';
    return `<button type="button" class="lx-chip lx-${typeCls(type)}" data-i="${i}" aria-label="Step ${i + 1}: ${type} ${esc(text)}"><span class="lx-ct">${type}</span><span class="lx-cv">${esc(text)}${val}</span></button>`;
  }

  function streamHTML(steps) {
    const rows = [];
    let cur = null;
    steps.forEach((s, i) => {
      const line = s.eof ? 'end' : s.p.line;
      if (!cur || cur.line !== line) { cur = { line, chips: [] }; rows.push(cur); }
      cur.chips.push(chipHTML(s, i));
    });
    return rows.map(r => `<div class="lx-row"><span class="lx-rowln">${r.line === 'end' ? 'end' : 'line ' + r.line}</span><div class="lx-chips">${r.chips.join('')}</div></div>`).join('');
  }

  function lexCounts(lx) {
    const c = { kw: 0, id: 0, num: 0, sym: 0 };
    lx.tokens.forEach(t => { const k = typeCls(t.type); if (k in c) c[k]++; });
    return c;
  }

  function mixHTML(c, nErr) {
    const parts = [['kw', 'KEYWORD', c.kw], ['id', 'IDENT', c.id], ['num', 'NUMBER', c.num], ['sym', 'symbols', c.sym], ['err', 'ERROR', nErr]].filter(p => p[2] > 0);
    const label = parts.map(p => `${p[2]} ${p[1]}`).join(', ') || 'no tokens';
    return `<div class="lx-mix" role="img" aria-label="Token mix: ${label}">${parts.map(p => `<span class="lx-${p[0]}" style="flex-grow:${p[2]}"></span>`).join('')}</div>
      <div class="lx-legend">${parts.map(p => `<span class="lx-${p[0]}">${p[1]} <b>${p[2]}</b></span>`).join('')}</div>`;
  }

  function lxClearRules() {
    const R = LX.rules;
    if (!R) return;
    R.rows.forEach(tr => tr.classList.remove('is-on'));
    dfaLight(R.dfa, []);
  }
  function lxDispose() {
    if (LX.stepper) LX.stepper.stop();
    LX.stepper = null;
    lxClearRules();
  }

  function lexRender(el, r) {
    lxDispose();
    if (!r.parse) psDispose(); // phase 2 will not render this time, so stop it and clear its marks
    const lx = r.lex, steps = lexSteps(lx);
    const phase = el.closest('.phase');
    const rulesEl = phase ? phase.querySelector('.phase-rules') : null;
    LX.rules = rulesEl ? { rows: [...rulesEl.querySelectorAll('[data-tt]')], dfa: rulesEl.querySelector('.lx-dfa') } : null;
    const nTok = lx.tokens.length - 1;
    const nCom = lx.pieces.filter(p => p.type === 'COMMENT').length;
    const nErr = lx.errors.length;

    el.innerHTML = `
      ${nErr ? `<div class="lx-errs"><p class="lx-errhead">${plural(nErr, 'lexical error')}. The lexer reported each one and kept going.</p>${lx.errors.map(e => UI.message(e)).join('')}</div>` : ''}
      <div class="lx-stats">
        <span class="lx-stat"><b>${r.src.length}</b> characters</span>
        <span class="lx-to" aria-hidden="true">→</span>
        <span class="lx-stat lx-stat-main"><b>${nTok}</b> ${nTok === 1 ? 'token' : 'tokens'}</span>
        <span class="lx-stat lx-stat-com"><b>${nCom}</b> ${nCom === 1 ? 'comment' : 'comments'} skipped</span>
        <span class="lx-stat ${nErr ? 'lx-stat-bad' : 'lx-stat-ok'}"><b>${nErr}</b> ${nErr === 1 ? 'error' : 'errors'}</span>
      </div>
      ${mixHTML(lexCounts(lx), nErr)}
      <div class="lx-step"></div>
      <div class="lx-panel">
        <h4 class="lx-h">Source, piece by piece</h4>
        <div class="lx-src" tabindex="0" role="region" aria-label="Source code coloured by token type">${srcHTML(lx)}</div>
      </div>
      <div class="lx-panel">
        <h4 class="lx-h">Token stream <span class="faint">click a token to see why</span></h4>
        <div class="lx-stream" role="region" aria-label="Token stream grouped by source line">${streamHTML(steps)}</div>
      </div>`;

    const stepBox = el.querySelector('.lx-step'), srcBox = el.querySelector('.lx-src'), streamBox = el.querySelector('.lx-stream');
    const spans = [...srcBox.querySelectorAll('.lx-p')].map(sp => ({ sp, k: +sp.getAttribute('data-k') }));
    const chips = [...streamBox.querySelectorAll('.lx-chip')];
    const me = {};
    LX.token = me;
    const onStep = i => {
      if (!stepBox.isConnected) { if (LX.token === me) lxDispose(); return; }
      const s = steps[i], k = s.k;
      let now = null;
      spans.forEach(o => {
        o.sp.classList.toggle('is-now', o.k === k);
        o.sp.classList.toggle('is-future', o.k > k);
        if (o.k === k && !now) now = o.sp;
      });
      chips.forEach((c, j) => { c.classList.toggle('is-now', j === i); c.classList.toggle('is-future', j > i); });
      keepVisible(srcBox, now);
      keepVisible(streamBox, chips[i]);
      const type = s.eof ? 'EOF' : s.p.type;
      if (LX.rules) {
        LX.rules.rows.forEach(tr => tr.classList.toggle('is-on', tr.getAttribute('data-tt').split(' ').includes(type)));
        dfaLight(LX.rules.dfa, s.eof ? [] : dfaPath(s.p), typeCls(type));
      }
    };
    LX.stepper = UI.stepper(stepBox, { count: steps.length, onStep, caption: i => lexCaption(steps[i]), speed: 600 });
    streamBox.addEventListener('click', e => {
      const c = e.target.closest('.lx-chip');
      if (c && LX.stepper && LX.token === me) { LX.stepper.stop(); LX.stepper.set(+c.getAttribute('data-i')); }
    });
  }

  // =====================================================================
  // Phase 2: syntax analysis
  // =====================================================================
  const PS = { stepper: null, token: null, marks: [], fit: false };

  function grammarHTML() {
    let prev = null;
    return TC.GRAMMAR.map(g => {
      const first = g.lhs !== prev;
      prev = g.lhs;
      return `<div class="ps-prod${first ? ' ps-first' : ''}" data-rule="${g.id}" style="--rc:${ruleColor(g.id)}">
        ${ruleBadge(g.id)}<span class="ps-lhs">${symSpan(g.lhs)}</span><span class="ps-arrow" aria-hidden="true">→</span>
        <span class="ps-rhs">${(g.rhs.length ? g.rhs : ['ε']).map(symSpan).join(' ')}</span>
      </div>`;
    }).join('');
  }

  function ffHTML() {
    const A = TC.ANALYSIS;
    const set = list => `<span class="ps-set">${list.map(symSpan).join('')}</span>`;
    return `<div class="scroll-x"><table class="tbl ps-ff">
      <thead><tr><th scope="col">Non-terminal</th><th scope="col">FIRST</th><th scope="col">FOLLOW</th></tr></thead>
      <tbody>${TC.NONTERMS.map(n => `<tr><th scope="row">${symSpan(n)}</th><td>${set(A.first[n])}</td><td>${set(A.follow[n])}</td></tr>`).join('')}</tbody>
    </table></div>`;
  }

  function ll1HTML() {
    const A = TC.ANALYSIS;
    const head = TC.TERMS.map(t => `<th scope="col" data-col="${esc(t)}"${t.length > 1 ? ' class="ps-rot"' : ''}><span class="ps-s ps-c-${symCls(t)}">${esc(t)}</span></th>`).join('');
    const body = TC.NONTERMS.map(n => `<tr><th scope="row" data-row="${n}">${symSpan(n)}</th>${TC.TERMS.map(t => {
      const ids = (A.table[n] && A.table[n][t]) || [];
      const key = esc(n + '|' + t);
      if (!ids.length) return `<td data-cell="${key}" class="ps-empty"></td>`;
      const viaFollow = ids.some(id => !firstOfSeq(RULE[id].rhs).has(t));
      const cls = [ids.length > 1 ? 'ps-conflict' : '', viaFollow ? 'ps-viaf' : ''].join(' ').trim();
      return `<td data-cell="${key}"${cls ? ` class="${cls}"` : ''} style="--rc:${ruleColor(ids[0])}">${ids.map(ruleBadge).join('')}</td>`;
    }).join('')}</tr>`).join('');
    return `<table class="ps-ll1">
      <thead><tr><th class="ps-corner" scope="col"><span class="ps-cn-t">token →</span><span class="ps-cn-s">top ↓</span></th>${head}</tr></thead>
      <tbody>${body}</tbody></table>`;
  }

  function verdictHTML() {
    const keys = [...new Set(TC.ANALYSIS.conflicts.map(c => c.join('|')))];
    if (!keys.length) return '<p class="ps-verdict ps-ok">No cell holds two rules, so the grammar is LL(1).</p>';
    return `<p class="ps-verdict ps-bad">${plural(keys.length, 'cell holds', 'cells hold')} two rules (${keys.map(k => `[${esc(k.replace('|', ', '))}]`).join(' ')}), so the grammar is not LL(1).</p>`;
  }

  function parseRules(el) {
    const A = TC.ANALYSIS;
    // Rules whose right side can derive ε also go under FOLLOW of their left side (rules 1 and 3 here).
    const epsRules = TC.GRAMMAR.filter(g => firstOfSeq(g.rhs).has('ε'));
    const epsNote = epsRules.map(g => `Rule ${ruleBadge(g.id)} (${symSpan(g.lhs)} → ${(g.rhs.length ? g.rhs : ['ε']).map(symSpan).join(' ')}) can derive ${symSpan('ε')}, so it goes under every token in FOLLOW(${symSpan(g.lhs)}): ${A.follow[g.lhs].map(symSpan).join(' ')}.`).join(' ');
    el.innerHTML = `
      <div class="card">
        <h3 class="card-title">Grammar we set</h3>
        <p class="card-sub">Terminals are tokens from phase 1, in their token colours. Non-terminals are orange and italic. The table, the trace and the tree name rules by these numbers.</p>
        <div class="ps-gram">${grammarHTML()}</div>
        <p class="ps-gstat faint">${TC.GRAMMAR.length} rules · ${TC.NONTERMS.length} non-terminals · ${TC.TERMS.length} terminals, counting the end marker $ · start symbol ${symSpan('program')}</p>
      </div>
      <div class="card">
        <h3 class="card-title">FIRST and FOLLOW</h3>
        <p class="card-sub">FIRST(A) holds the tokens that can start A. FOLLOW(A) holds the tokens that can come right after A. ε in FIRST means A can be empty.</p>
        ${ffHTML()}
      </div>
      <div class="card">
        <h3 class="card-title">LL(1) parsing table</h3>
        <p class="card-sub">Row: the non-terminal on top of the stack. Column: the next token. The cell gives the rule to use.</p>
        <div class="scroll-x ps-ll1wrap">${ll1HTML()}</div>
        ${verdictHTML()}
        <ul class="ps-legend">
          <li><span class="ps-key ps-key-empty" aria-hidden="true"></span><span>An empty cell means no rule fits, so the parser reports a syntax error.</span></li>
          <li><span class="ps-key ps-key-viaf" aria-hidden="true"></span><span>A dashed ring marks a rule placed by FOLLOW. ${epsNote}</span></li>
          <li><span class="ps-key ps-key-blank" aria-hidden="true"></span><span>How the code fills it: for each rule A → α, write the rule under every token in FIRST(α). If α can derive ε, also write it under every token in FOLLOW(A). The code builds FIRST, FOLLOW and this table from the grammar when the page loads.</span></li>
        </ul>
      </div>
      <div class="card">
        <h3 class="card-title">How the parser works</h3>
        <ol class="ps-algo">
          <li><b>Start.</b> The stack holds ${symSpan('$')} ${symSpan('program')}, with ${symSpan('program')} on top. The input ends with ${symSpan('$')}.</li>
          <li><b>Non-terminal on top.</b> Look up the cell [top, next token]. Pop the top and push the rule's right side in reverse, so its first symbol ends up on top. An empty cell is a syntax error.</li>
          <li><b>Terminal on top.</b> If it equals the next token, pop it and read the next token. If not, that is a syntax error.</li>
          <li><b>Accept.</b> When only ${symSpan('$')} is left and the next token is ${symSpan('$')}, the parser accepts. The syntax is correct; phase 3 checks the meaning next.</li>
        </ol>
        <p class="ps-note">Every statement starts with its own keyword, so one token of lookahead picks the rule.</p>
        <p class="ps-note">The same grammar also suits a hand-written recursive-descent parser, with one function per non-terminal. This page runs the table-driven LL(1) parser with a stack, so you can watch every step.</p>
      </div>`;
  }

  // For each trace row: which tree node is on top of the stack, and when each non-terminal was expanded.
  function parseDerived(P) {
    const expandStep = {}, tops = [];
    const stack = [P.tree.id];
    P.trace.forEach((row, k) => {
      tops.push(stack.length ? stack[stack.length - 1] : null);
      if (row.kind === 'expand') {
        expandStep[row.node] = k;
        stack.pop();
        if (RULE[row.prod].rhs.length) {
          const kids = P.nodes[row.node].children;
          for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i].id);
        }
      } else if (row.kind === 'match') stack.pop();
    });
    return { expandStep, tops };
  }

  // ---- Parse tree layout: leaves spaced by label width, each parent centred over its children ----
  const T = { ch: 7.2, chs: 6.6, pad: 9, h: 24, gap: 8, level: 46, mx: 16, mt: 14 };
  const TREE_LIMIT = 1200;

  function nodeWidth(n) {
    if (n.kind === 'eps') return 28;
    if (n.kind === 't') return Math.max(30, (n.tok ? n.tok.text.length : 0) * T.ch + 2 * T.pad, n.sym.length * T.chs + 14);
    return n.sym.length * T.ch + 2 * T.pad + 6;
  }

  function treeLayout(P) {
    const N = P.nodes.length;
    const w = new Array(N), sw = new Array(N), cw = new Array(N), x0 = new Array(N), x = new Array(N), y = new Array(N), depth = new Array(N);
    const order = [], st = [P.tree];
    while (st.length) { // pre-order, without recursion (long programs make deep trees)
      const v = st.pop();
      order.push(v);
      for (let i = v.children.length - 1; i >= 0; i--) st.push(v.children[i]);
    }
    for (let i = order.length - 1; i >= 0; i--) { // children before parents: width of each subtree
      const v = order[i];
      w[v.id] = nodeWidth(v);
      if (!v.children.length) { sw[v.id] = w[v.id]; continue; }
      let s = 0;
      v.children.forEach((c, j) => { s += sw[c.id] + (j ? T.gap : 0); });
      cw[v.id] = s;
      sw[v.id] = Math.max(w[v.id], s);
    }
    x0[P.tree.id] = 0;
    depth[P.tree.id] = 0;
    let maxDepth = 0;
    order.forEach(v => { // parents before children: hand each child its slot
      maxDepth = Math.max(maxDepth, depth[v.id]);
      if (!v.children.length) { x[v.id] = x0[v.id] + sw[v.id] / 2; return; }
      let cx = x0[v.id] + (sw[v.id] - cw[v.id]) / 2;
      v.children.forEach(c => { x0[c.id] = cx; depth[c.id] = depth[v.id] + 1; cx += sw[c.id] + T.gap; });
    });
    for (let i = order.length - 1; i >= 0; i--) {
      const v = order[i];
      if (v.children.length) x[v.id] = (x[v.children[0].id] + x[v.children[v.children.length - 1].id]) / 2;
    }
    let lo = Infinity, hi = -Infinity;
    order.forEach(v => { lo = Math.min(lo, x[v.id] - w[v.id] / 2); hi = Math.max(hi, x[v.id] + w[v.id] / 2); });
    order.forEach(v => { x[v.id] += T.mx - lo; y[v.id] = T.mt + depth[v.id] * T.level; });
    return { x, y, w, depth, order, width: Math.ceil(hi - lo + 2 * T.mx), height: Math.ceil(2 * T.mt + maxDepth * T.level + T.h) };
  }

  function treeSVG(P, L, label) {
    const H = T.h, edges = [], nodes = [];
    L.order.forEach(v => {
      const px = r1(L.x[v.id]), py = L.y[v.id] + H;
      v.children.forEach(c => {
        const cx = r1(L.x[c.id]), cy = L.y[c.id], my = (py + cy) / 2;
        edges.push(`<path class="ps-e" data-c="${c.id}" d="M${px} ${py}C${px} ${my} ${cx} ${my} ${cx} ${cy}"/>`);
      });
      const w = r1(L.w[v.id]), hw = r1(w / 2);
      const kind = v.kind === 'nt' ? 'nt' : v.kind === 't' ? 't' : 'eps';
      const color = v.kind === 'nt' ? 'nt' : v.kind === 'eps' ? 'eps' : symCls(v.sym);
      let inner = `<rect class="ps-halo" x="${r1(-hw - 5)}" y="-5" width="${r1(w + 10)}" height="${H + 10}" rx="${H / 2 + 5}"/>` +
        `<rect class="ps-box" x="${-hw}" y="0" width="${w}" height="${H}" rx="${H / 2}"/>`;
      if (v.kind === 't') inner += `<text class="ps-sym" y="16">${esc(v.sym)}</text>${v.tok ? `<text class="ps-lex" y="16.5">${esc(v.tok.text)}</text>` : ''}`;
      else inner += `<text class="ps-lbl" y="16.5">${esc(v.sym)}</text>`;
      if (v.kind === 'nt' && v.prod) inner += `<g class="ps-badge"><circle cx="${r1(hw - 4)}" cy="0" r="8.5" style="fill:${ruleColor(v.prod)}"/><text x="${r1(hw - 4)}" y="4">${v.prod}</text></g>`;
      nodes.push(`<g class="ps-n ps-${kind} ps-c-${color}" data-n="${v.id}" transform="translate(${r1(L.x[v.id])} ${L.y[v.id]})"><g class="ps-in">${inner}</g></g>`);
    });
    return `<svg class="ps-tree" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" style="--tw:${L.width}px" role="img" aria-label="${esc(label)}">` +
      `<g class="ps-edges">${edges.join('')}</g><g class="ps-nodes">${nodes.join('')}</g></svg>`;
  }

  // Classes for every node and edge at trace step k.
  function treeStep(nodeEls, edgeEls, P, D, k) {
    const row = P.trace[k];
    const cur = (row.kind === 'expand' || row.kind === 'match') ? row.node : null;
    const born = new Set(row.kind === 'expand' ? P.nodes[row.node].children.map(c => c.id) : []);
    const errNode = row.kind === 'error' ? D.tops[k] : null;
    nodeEls.forEach((g, id) => {
      if (!g) return;
      const n = P.nodes[id];
      g.classList.toggle('is-hidden', n.step > k);
      g.classList.toggle('is-new', born.has(id));
      g.classList.toggle('is-now', id === cur);
      g.classList.toggle('is-matched', n.kind === 't' && n.matchStep !== null && n.matchStep <= k);
      g.classList.toggle('is-expanded', n.kind === 'nt' && D.expandStep[id] !== undefined && D.expandStep[id] <= k);
      g.classList.toggle('is-err', id === errNode);
      g.classList.toggle('is-acc', row.kind === 'accept' && id === P.tree.id);
    });
    edgeEls.forEach(e => {
      const c = +e.getAttribute('data-c');
      e.classList.toggle('is-hidden', P.nodes[c].step > k);
      e.classList.toggle('is-hot', born.has(c));
    });
    return row.kind === 'error' ? errNode : cur;
  }

  function machineHTML(row, toks) {
    const st = row.stack.slice(-16), inp = row.input.slice(0, 16);
    const stack = st.map((s, i) => `<span class="ps-mi ps-c-${symCls(s)}${i === st.length - 1 ? ' is-top' : ''}">${esc(s)}</span>`).join('');
    const input = inp.map((s, j) => {
      const t = toks[row.tokIndex + j];
      return `<span class="ps-mi ps-c-${t ? typeCls(t.type) : 'eof'}${j === 0 ? ' is-look' : ''}">${esc(s)}</span>`;
    }).join('');
    const mid = {
      expand: `${ruleBadge(row.prod)}<span class="ps-mword">expand</span>`,
      match: '<span class="ps-mbig ps-mok">=</span><span class="ps-mword">match</span>',
      accept: '<span class="ps-mbig ps-mok">✓</span><span class="ps-mword">accept</span>'
    }[row.kind] || '<span class="ps-mbig ps-mbad">✗</span><span class="ps-mword">error</span>';
    return `<div class="ps-mside ps-mstack"><span class="ps-mlabel">Stack · top at right</span><div class="ps-mitems">${stack}</div></div>
      <div class="ps-mmid ps-m-${row.kind}">${mid}</div>
      <div class="ps-mside ps-minput"><span class="ps-mlabel">Input · next token at left</span><div class="ps-mitems">${input}</div></div>`;
  }

  function actionHTML(row, toks) {
    switch (row.kind) {
      case 'expand': {
        const g = RULE[row.prod];
        return `${ruleBadge(g.id)} <span class="ps-c-nt">${esc(g.lhs)}</span> → ${(g.rhs.length ? g.rhs : ['ε']).map(s => `<span class="ps-c-${symCls(s)}">${esc(s)}</span>`).join(' ')}`;
      }
      case 'match': {
        const t = toks[row.tokIndex];
        return `<span class="ps-act ps-act-m">match</span> <span class="ps-c-${typeCls(t.type)}">${esc(inputText(t))}</span>`;
      }
      case 'accept': return '<span class="ps-act ps-act-ok">accept</span>';
      default: return '<span class="ps-act ps-act-bad">error</span>';
    }
  }

  function traceHTML(P, toks) {
    return P.trace.map((row, k) => {
      const sv = row.stack.slice(-12), iv = row.input.slice(0, 10);
      const stack = (row.stack.length > sv.length ? '<span class="ps-more">…</span>' : '') +
        sv.map((s, i) => `<span class="ps-c-${symCls(s)}${i === sv.length - 1 ? ' is-top' : ''}">${esc(s)}</span>`).join('');
      const input = iv.map((s, j) => {
        const t = toks[row.tokIndex + j];
        return `<span class="ps-c-${t ? typeCls(t.type) : 'eof'}${j === 0 ? ' is-look' : ''}">${esc(s)}</span>`;
      }).join('') + (row.input.length > iv.length ? '<span class="ps-more">…</span>' : '');
      return `<tr class="ps-r ps-r-${row.kind}"><td class="ps-tk"><button type="button" class="ps-jump" data-k="${k}" aria-label="Show step ${k + 1}">${k + 1}</button></td>` +
        `<td><div class="ps-cst">${stack}</div></td><td><div class="ps-cin">${input}</div></td><td class="ps-tac">${actionHTML(row, toks)}</td></tr>`;
    }).join('');
  }

  function parseCaption(P, toks, k) {
    const row = P.trace[k], tok = toks[row.tokIndex], a = TC.term(tok);
    const top = row.stack[row.stack.length - 1];
    const S = symSpan;
    const next = tok.type === 'EOF' ? `${S('$')} (end of input)`
      : (tok.type === 'NUMBER' || tok.type === 'IDENT') ? `${S(a)} <code>${esc(tok.text)}</code>` : S(a);
    switch (row.kind) {
      case 'expand': {
        const g = RULE[row.prod];
        const then = g.rhs.length ? `replace ${S(top)} with ${g.rhs.map(S).join(' ')}` : `pop ${S(top)} and push nothing (${S(top)} → ${S('ε')})`;
        return `Top of stack is ${S(top)}, next token is ${next}: table cell [${S(row.cell[0])}, ${S(row.cell[1])}] says rule ${ruleBadge(g.id)}, so ${then}`;
      }
      case 'match': {
        const leaf = (tok.type === 'NUMBER' || tok.type === 'IDENT') ? ` The leaf now shows <code>${esc(tok.text)}</code>.` : '';
        return `Top of stack is ${S(top)} and the next token is ${next}: they match, so pop it and read the next token.${leaf}`;
      }
      case 'accept':
        return `Only ${S('$')} is left on the stack and the next token is ${S('$')}: every token matched, so the parser <b class="ok-text">accepts</b> the program.`;
      default: {
        const msg = P.errors[0] ? ` ${esc(P.errors[0].msg)}` : '';
        const head = '<b class="bad-text">Syntax error.</b>';
        if (top === '$') return `${head} Only ${S('$')} is left, so the program is complete, but the next token is ${next}.${msg}`;
        if (!NT.has(top)) return `${head} Top of stack is ${S(top)} but the next token is ${next}. They don't match.${msg}`;
        return `${head} Top of stack is ${S(top)}, next token is ${next}: table cell [${S(top)}, ${S(a)}] is empty, so no rule fits.${msg}`;
      }
    }
  }

  // Elements of the rules card that stepping lights up.
  function rulesIndex(phase) {
    const box = phase && phase.querySelector('.phase-rules');
    if (!box) return null;
    const by = (attr) => { const m = new Map(); box.querySelectorAll(`[${attr}]`).forEach(e => m.set(e.getAttribute(attr), e)); return m; };
    return { cells: by('data-cell'), rules: by('data-rule'), rows: by('data-row'), cols: by('data-col'), wrap: box.querySelector('.ps-ll1wrap') };
  }
  function psMark(node, cls) { if (node) { node.classList.add(cls); PS.marks.push([node, cls]); } }
  function psClearRules() { PS.marks.forEach(([node, cls]) => node.classList.remove(cls)); PS.marks = []; }
  function psDispose() {
    if (PS.stepper) PS.stepper.stop();
    PS.stepper = null;
    psClearRules();
  }

  function parseRender(el, r) {
    psDispose();
    const P = r.parse, toks = r.lex.tokens, trace = P.trace;
    const failed = P.errors.length > 0;
    const R = rulesIndex(el.closest('.phase'));
    const D = parseDerived(P);
    const drawTree = P.nodes.length <= TREE_LIMIT; // a huge tree would only slow the page down
    const L = drawTree ? treeLayout(P) : null;
    const nExp = trace.filter(t => t.kind === 'expand').length, nMat = trace.filter(t => t.kind === 'match').length;
    const label = `Parse tree with ${P.nodes.length} nodes${failed ? ', cut short by the syntax error' : ''}. Non-terminals are inner nodes and tokens are the leaves.`;
    const treeHTML = drawTree
      ? `<div class="scroll-x ps-treebox${PS.fit ? ' is-fit' : ''}" tabindex="0" role="region" aria-label="Parse tree, scrolls sideways">${treeSVG(P, L, label)}</div>`
      : `<div class="ps-treebox ps-toobig"><strong>${P.nodes.length} nodes is too many to draw here.</strong><span>The stack, the input and the trace below still show every step. Shorten the program to see its tree.</span></div>`;

    el.innerHTML = `
      ${failed ? `<div class="ps-errs">${UI.message(P.errors[0])}</div>` : ''}
      <div class="ps-stats">
        <span class="ps-stat"><b>${trace.length}</b> steps</span>
        <span class="ps-stat"><b>${nExp}</b> ${nExp === 1 ? 'expansion' : 'expansions'}</span>
        <span class="ps-stat"><b>${nMat}</b> ${nMat === 1 ? 'match' : 'matches'}</span>
        <span class="ps-stat"><b>${P.nodes.length}</b> tree nodes</span>
        <span class="ps-stat ${failed ? 'ps-stat-bad' : 'ps-stat-ok'}">${failed ? 'syntax error' : 'accepted'}</span>
      </div>
      <div class="ps-step"></div>
      <div class="ps-machine" role="group" aria-label="The parser's stack and input at this step"></div>
      <figure class="ps-treefig">
        <div class="ps-bar"><h4 class="ps-h">Parse tree</h4>${drawTree ? `<button type="button" class="btn btn-ghost ps-fit" aria-pressed="${PS.fit}">Fit to width</button>` : ''}</div>
        ${treeHTML}
        <figcaption class="ps-cap">Orange pills are non-terminals. The small coloured number is the rule that expanded the node. Leaves are tokens in their phase 1 colours. A dashed node is still waiting on the stack, and ${symSpan('ε')} marks an empty rule.${failed ? ' The tree stops where the error was found.' : ' In a finished tree, the leaves read left to right give back the token stream.'}</figcaption>
      </figure>
      <div class="ps-bar"><h4 class="ps-h">Parse trace</h4><span class="faint ps-hint">click a step number to jump there</span></div>
      <div class="ps-tracebox" tabindex="0" role="region" aria-label="Parse trace: stack, input and action at every step">
        <table class="ps-trace">
          <colgroup><col class="ps-col-k"><col class="ps-col-st"><col class="ps-col-in"><col class="ps-col-ac"></colgroup>
          <thead><tr><th scope="col">#</th><th scope="col" class="ps-th-st">Stack, top at right</th><th scope="col">Input</th><th scope="col">Action</th></tr></thead>
          <tbody>${traceHTML(P, toks)}</tbody>
        </table>
      </div>`;

    const stepBox = el.querySelector('.ps-step'), machine = el.querySelector('.ps-machine');
    const treeBox = el.querySelector('.ps-treebox'), traceBox = el.querySelector('.ps-tracebox');
    const nodeEls = [], edgeEls = [...treeBox.querySelectorAll('.ps-e')];
    treeBox.querySelectorAll('.ps-n').forEach(g => { nodeEls[+g.getAttribute('data-n')] = g; });
    const rows = [...traceBox.querySelectorAll('.ps-r')];
    const head = traceBox.querySelector('thead');
    const me = {};
    PS.token = me;
    let focus = null;

    const onStep = k => {
      if (!stepBox.isConnected) { if (PS.token === me) psDispose(); return; }
      const row = trace[k];
      focus = treeStep(nodeEls, edgeEls, P, D, k);
      machine.innerHTML = machineHTML(row, toks);
      machine.querySelectorAll('.ps-mitems').forEach(box => {
        const a = box.firstElementChild, b = box.lastElementChild;
        if (!a) return;
        const rb = box.getBoundingClientRect();
        box.classList.toggle('is-clip-l', a.getBoundingClientRect().left < rb.left - 1);
        box.classList.toggle('is-clip-r', b.getBoundingClientRect().right > rb.right + 1);
      });
      rows.forEach((tr, j) => { tr.classList.toggle('is-now', j === k); tr.classList.toggle('is-future', j > k); });
      keepVisible(traceBox, rows[k], head ? head.offsetHeight : 0, true);
      if (focus !== null && nodeEls[focus]) keepVisible(treeBox, nodeEls[focus]);
      psClearRules();
      if (!R) return;
      const top = row.stack[row.stack.length - 1];
      if (row.kind === 'expand') {
        const cell = R.cells.get(row.cell[0] + '|' + row.cell[1]);
        psMark(cell, 'is-hot');
        psMark(R.rows.get(row.cell[0]), 'is-hot');
        psMark(R.cols.get(row.cell[1]), 'is-hot');
        psMark(R.rules.get(String(row.prod)), 'is-hot');
        keepVisible(R.wrap, cell);
      } else if (row.kind === 'error' && NT.has(top)) {
        const a = TC.term(toks[row.tokIndex]);
        const cell = R.cells.get(top + '|' + a);
        psMark(cell, 'is-bad');
        psMark(R.rows.get(top), 'is-bad');
        psMark(R.cols.get(a), 'is-bad');
        keepVisible(R.wrap, cell);
      }
    };
    PS.stepper = UI.stepper(stepBox, { count: trace.length, onStep, caption: k => parseCaption(P, toks, k), speed: 650 });

    traceBox.addEventListener('click', e => {
      const b = e.target.closest('.ps-jump');
      if (b && PS.stepper && PS.token === me) { PS.stepper.stop(); PS.stepper.set(+b.getAttribute('data-k')); }
    });
    const fit = el.querySelector('.ps-fit');
    if (fit) fit.addEventListener('click', () => {
      PS.fit = !PS.fit;
      treeBox.classList.toggle('is-fit', PS.fit);
      fit.setAttribute('aria-pressed', String(PS.fit));
      if (focus !== null && nodeEls[focus]) keepVisible(treeBox, nodeEls[focus]); // back at full size, find the current node again
    });
  }

  // ---------- Room to improve ----------
  const LEX_IDEAS = [
    { title: 'Write the rules as a Flex file', level: 'medium', text: 'Put the same patterns in a Lex/Flex <code>.l</code> file: one regular expression per token, with the keyword lookup in the action of the word pattern. Flex builds the DFA and writes a C scanner for us.' },
    { title: 'Decimal numbers', level: 'easy', text: 'Change NUMBER to <code>-?[0-9]+(\\.[0-9]+)?</code> so <code>12.5</code> is one token, and read it with <code>parseFloat</code>. Phase 6 packs each operand into two bytes, so it would need a new encoding too.' },
    { title: 'Did you mean MOVE?', level: 'medium', text: 'When an IDENT is one or two edits away from a keyword, suggest the keyword. Edit distance (Levenshtein) counts single-letter changes, so <code>MOV</code> to <code>MOVE</code> is 1. Today the parser only knows a fixed list of other names, like FORWARD and LEFT.' }
  ];
  const PARSE_IDEAS = [
    { title: 'Expressions like MOVE side * 2;', level: 'hard', text: 'Let a value be an expression: <code>E → E + T | T</code>, <code>T → T * F | F</code>, <code>F → NUMBER | IDENT | ( E )</code>. The two levels give <code>*</code> a higher precedence than <code>+</code>. LL(1) can\'t use left recursion, so rewrite it as <code>E → T E\'</code> and <code>E\' → + T E\' | ε</code>, and the same for T.' },
    { title: 'Panic-mode error recovery', level: 'medium', text: 'After a syntax error, report it, skip tokens up to the next <code>;</code>, pop the stack back to a <code>stmt_list</code> and carry on. One run can then report more than one syntax error.' },
    { title: 'Generate the parser with Yacc/Bison', level: 'medium', text: 'Give the same grammar to Bison. It builds an LALR(1) table and a shift-reduce parser. LALR(1) also accepts left-recursive rules like <code>stmt_list → stmt_list stmt</code>.' }
  ];

  const lexModule = { rules: lexRules, improve: el => UI.ideas(el, LEX_IDEAS), render: lexRender };
  const parseModule = { rules: parseRules, improve: el => UI.ideas(el, PARSE_IDEAS), render: parseRender };
  if (UI) {
    UI.register('lex', lexModule);
    UI.register('parse', parseModule);
  }

  // Pure helpers, exported for tests under node only.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { lexSteps, lexCaption, dfaPath, dfaSVG, parseDerived, parseCaption, treeLayout, treeSVG, machineHTML, actionHTML, traceHTML, srcHTML, streamHTML, grammarHTML, ffHTML, ll1HTML, verdictHTML, firstOfSeq, ruleColor };
  }
})(typeof window !== 'undefined' ? window : globalThis);
