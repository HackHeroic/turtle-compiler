#!/usr/bin/env node
/* turtlec: the Turtle compiler on the command line.
   Every phase is done by compiler/compiler.js; this file only reads files,
   prints what the compiler returns and writes the .svg and .tvm outputs. */
'use strict';

const fs = require('fs');
const path = require('path');
const TC = require('../compiler/compiler.js');
const VERSION = require('./package.json').version;

const PHASES = ['lex', 'parse', 'sem', 'ir', 'opt', 'gen', 'run'];
const TITLES = {
  lex: 'Lexical analysis', parse: 'Syntax analysis', sem: 'Semantic analysis',
  ir: 'Intermediate code', opt: 'Code optimization', gen: 'Code generation', run: 'Run'
};
const PHASE_COLOR = { lex: 205, parse: 208, sem: 220, ir: 114, opt: 80, gen: 141, run: 255 };
const WIDTH = 72;

const HELP = `turtlec ${VERSION}: compiler for the Turtle graphics language

Usage:
  turtlec <file.turtle> [options]   compile and print a report of all six phases
  turtlec run <file.tvm> [options]  run machine code written with --bin

Options:
  --phase <name>     print one phase in full detail:
                     lex, parse, sem, ir, opt, gen or run
  --svg <out.svg>    write the drawing as SVG
  --bin <out.tvm>    write the machine code (4 bytes per instruction)
  --no-color         plain output (also when NO_COLOR is set or not a terminal)
  --color            force coloured output
  -h, --help         show this help
  --version          show the version

Use - as the file name to read the program from standard input.

Exit status: 0 compiled, 1 compile or machine code error, 2 usage or file error.
`;

// ---------- Small helpers ----------

class UsageError extends Error {}

function painter(enabled) {
  const wrap = code => s => enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s);
  return {
    on: enabled,
    c256: n => wrap(`38;5;${n}`),
    bold: wrap('1'), dim: wrap('2'), red: wrap('1;31'), yellow: wrap('1;33'), green: wrap('32'),
    head: n => wrap(`1;38;5;${n}`)
  };
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function num(n) {
  const r = Number(n.toFixed(2));
  return String(Object.is(r, -0) ? 0 : r);
}

function readSource(file) {
  try {
    return file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new UsageError(`cannot read ${file}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`);
  }
}

function writeOut(file, data) {
  try { fs.writeFileSync(file, data); } catch (e) { throw new UsageError(`cannot write ${file}: ${e.message}`); }
}

// Run machine code to the end and return the VM state (position, heading, pen, segments).
function execute(prog) {
  const vm = TC.makeVM(prog);
  while (!vm.state.halted && vm.state.steps < TC.LIMITS.STEPS) vm.step();
  return vm.state;
}

// ---------- Arguments ----------

function parseArgs(argv) {
  const o = { files: [], phase: null, svg: null, bin: null, color: null, help: false, version: false };
  const value = (i, name) => {
    if (i >= argv.length || (argv[i].startsWith('-') && argv[i] !== '-')) throw new UsageError(`${name} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i], inline = null;
    if (a.startsWith('--') && a.includes('=')) { inline = a.slice(a.indexOf('=') + 1); a = a.slice(0, a.indexOf('=')); }
    const take = name => inline !== null ? inline : value(++i, name);
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--version') o.version = true;
    else if (a === '--no-color') o.color = false;
    else if (a === '--color') o.color = true;
    else if (a === '--phase') {
      o.phase = take('--phase');
      if (!PHASES.includes(o.phase)) throw new UsageError(`unknown phase "${o.phase}". Use one of ${PHASES.join(', ')}`);
    } else if (a === '--svg') o.svg = take('--svg');
    else if (a === '--bin') o.bin = take('--bin');
    else if (a.startsWith('-') && a !== '-') throw new UsageError(`unknown option ${a}`);
    else o.files.push(a);
  }
  return o;
}

function colorEnabled(flag, stream) {
  if (flag !== null) return flag;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  return Boolean(stream.isTTY);
}

// ---------- Diagnostics ----------

const KIND = { lex: 'lexical error', parse: 'syntax error', sem: 'semantic error' };

function diagnostics(r, name, P) {
  const errs = [...r.lex.errors, ...(r.parse ? r.parse.errors : []), ...(r.sem ? r.sem.errors : [])]
    .map(e => ({ ...e, level: 'error' }));
  const warns = r.sem ? r.sem.warnings.map(e => ({ ...e, level: 'warning' })) : [];
  const all = [...errs, ...warns].sort((a, b) => a.line - b.line || a.col - b.col);
  const lines = r.src.split('\n');
  const out = [];
  for (const d of all) {
    const label = d.level === 'error' ? P.red(KIND[d.phase] + ':') : P.yellow('warning:');
    const rule = d.rule ? ` [${d.rule}]` : '';
    out.push(`${P.bold(`${name}:${d.line}:${d.col}:`)} ${label} ${P.bold(d.msg + rule)}`);
    const text = (lines[d.line - 1] || '').replace(/\r$/, '');
    const gutter = lpad(d.line, 5);
    const lead = text.slice(0, d.col - 1).replace(/[^\t]/g, ' ');
    const width = Math.max(1, Math.min(d.end - d.start, text.length - (d.col - 1)));
    out.push(`${P.dim(gutter + ' |')} ${text}`);
    out.push(`${P.dim(' '.repeat(5) + ' |')} ${lead}${(d.level === 'error' ? P.red : P.yellow)('^' + '~'.repeat(width - 1))}`);
    if (d.hint) out.push(`${P.dim(' '.repeat(5) + ' =')} hint: ${d.hint}`);
  }
  const counts = [errs.length && plural(errs.length, 'error'), warns.length && plural(warns.length, 'warning')].filter(Boolean);
  if (counts.length) out.push(counts.join(', ') + '.');
  return { text: out.join('\n'), errors: errs.length };
}

// ---------- Report sections ----------

function heading(P, key, right) {
  const n = PHASES.indexOf(key) + 1;
  const left = key === 'run' ? TITLES.run : `${n}  ${TITLES[key]}`;
  const gap = Math.max(2, WIDTH - left.length - right.length);
  return `\n${P.head(PHASE_COLOR[key])(left)}${' '.repeat(gap)}${P.dim(right)}\n${P.dim('-'.repeat(WIDTH))}`;
}

function tokenColor(P, t) {
  switch (t.type) {
    case 'KEYWORD': return P.c256(175);
    case 'NUMBER': return P.c256(215);
    case 'IDENT': return TC.COLORS[t.text.toUpperCase()] ? P.c256(114) : P.c256(117);
    case 'ERROR': return P.red;
    default: return P.dim;
  }
}

function tokenLabel(t) { return t.type === 'EOF' ? 'EOF' : `${t.type}(${t.text})`; }

function secLex(r, P, full) {
  const toks = r.lex.tokens;
  const out = [heading(P, 'lex', `${plural(toks.length, 'token')} (with EOF)`)];
  if (!full) {
    const byLine = new Map();
    for (const t of toks) { if (!byLine.has(t.line)) byLine.set(t.line, []); byLine.get(t.line).push(t); }
    for (const [line, ts] of byLine) {
      const prefix = `  ${lpad(line, 3)}  `;
      let row = prefix, plain = prefix.length;
      for (const t of ts) {
        const s = tokenLabel(t);
        if (plain > prefix.length && plain + 1 + s.length > WIDTH) { out.push(row); row = ' '.repeat(prefix.length); plain = prefix.length; }
        if (plain > prefix.length) { row += ' '; plain++; }
        row += tokenColor(P, t)(s); plain += s.length;
      }
      out.push(row);
    }
  } else {
    out.push(P.dim(`  ${lpad('#', 3)}  ${pad('Line:Col', 9)}${pad('Type', 9)}${pad('Text', 12)}Value`));
    toks.forEach((t, i) => {
      const value = t.type === 'EOF' ? '$' : String(t.value);
      out.push(`  ${lpad(i + 1, 3)}  ${pad(`${t.line}:${t.col}`, 9)}${tokenColor(P, t)(pad(t.type, 9))}${pad(t.text, 12)}${value}`);
    });
    const skipped = r.lex.pieces.filter(p => p.type === 'WS' || p.type === 'COMMENT');
    const comments = skipped.filter(p => p.type === 'COMMENT').length;
    out.push('', `  Skipped: ${plural(skipped.length - comments, 'whitespace run')}, ${plural(comments, 'comment')}.`);
  }
  return out.join('\n');
}

function treeLabel(n) {
  if (n.kind === 'eps') return 'ε';
  if (n.kind === 'nt') return n.sym;
  if (!n.tok) return `${n.sym}  (missing)`;
  if (n.sym === 'NUMBER' || n.sym === 'IDENT') return `${n.sym} ${n.tok.text}`;
  return n.tok.text === n.sym ? n.sym : `${n.sym} (${n.tok.text})`;
}

function secParse(r, P, full) {
  const p = r.parse, ok = !p.errors.length;
  const out = [heading(P, 'parse', `${ok ? 'accepted' : 'rejected'}, ${plural(p.nodes.length, 'node')}`)];
  out.push(`  LL(1) parse ${ok ? P.green('accepted') : P.red('rejected')} in ${plural(p.trace.length, 'step')}. Parse tree:`);
  const walk = (n, depth) => {
    const s = treeLabel(n);
    out.push('    ' + '  '.repeat(depth) + (n.kind === 'nt' ? P.c256(208)(s) : n.kind === 't' ? s : P.dim(s)));
    n.children.forEach(k => walk(k, depth + 1));
  };
  walk(p.tree, 0);
  if (full) {
    const rows = p.trace.map((t, i) => [String(i + 1), t.stack.join(' '), t.input.join(' '), t.action, t.kind]);
    const w = [3, ...[1, 2].map(k => Math.max(5, ...rows.map(r => r[k].length)))];
    out.push('', `  ${lpad('#', w[0])}  ${pad('Stack', w[1])}  ${pad('Input', w[2])}  Action`);
    for (const r of rows) {
      const act = r[4] === 'error' ? P.red(r[3]) : r[4] === 'accept' ? P.green(r[3]) : r[4] === 'match' ? P.dim(r[3]) : r[3];
      out.push(`  ${lpad(r[0], w[0])}  ${pad(r[1], w[1])}  ${pad(r[2], w[2])}  ${act}`);
    }
  }
  return out.join('\n');
}

function secSem(r, P) {
  const s = r.sem;
  const out = [heading(P, 'sem', `${plural(s.checks.length, 'check')}, ${plural(s.errors.length, 'error')}, ${plural(s.warnings.length, 'warning')}`)];
  for (const c of s.checks) {
    const mark = c.level === 'ok' ? P.green('✓') : c.level === 'warn' ? P.yellow('!') : P.red('✗');
    out.push(`  ${mark} ${pad(c.rule, 3)} ${P.dim(pad('line ' + c.line, 8))} ${c.text}`);
  }
  out.push('', '  Symbol table');
  if (!s.symbols.length) out.push(P.dim('    (empty)'));
  else {
    out.push(P.dim(`    ${pad('Name', 12)}${pad('Type', 8)}${pad('Value', 7)}${pad('Line', 6)}Used on`));
    for (const y of s.symbols) {
      out.push(`    ${pad(y.name, 12)}${pad(y.type, 8)}${pad(y.value, 7)}${pad(y.line, 6)}${y.uses.length ? y.uses.join(', ') : '-'}`);
    }
  }
  return out.join('\n');
}

function tacLine(c, P) {
  const text = TC.tacText(c);
  return c.op === 'LABEL' ? P.c256(114)(pad(text, 30)) : '    ' + pad(text, 26);
}

function secIR(r, P, full) {
  const code = r.ir;
  const out = [heading(P, 'ir', `${plural(code.length, 'line')} of three-address code`)];
  for (const c of code) out.push(`  ${lpad(c.id, 3)}  ${tacLine(c, P)}${P.dim('; line ' + c.line)}`);
  if (full) {
    const q = code.map(c => TC.quad(c).map(x => String(x)));
    out.push('', '  Quadruples');
    out.push(P.dim(`  ${lpad('#', 3)}  ${pad('op', 9)}${pad('arg1', 10)}${pad('arg2', 6)}result`));
    code.forEach((c, i) => out.push(`  ${lpad(c.id, 3)}  ${pad(q[i][0], 9)}${pad(q[i][1], 10)}${pad(q[i][2], 6)}${q[i][3]}`.trimEnd()));
  }
  return out.join('\n');
}

function blocks(code, P) {
  const out = [];
  for (const b of TC.basicBlocks(code)) {
    out.push(`    ${P.bold(pad(b.name, 4))} ${P.dim('-> ' + (b.succ.length ? b.succ.join(', ') : 'end'))}`);
    for (let i = b.start; i <= b.end; i++) out.push(`      ${lpad(code[i].id, 3)}  ${tacLine(code[i], P).trimEnd()}`);
  }
  return out;
}

function secOpt(r, P, full) {
  const o = r.opt, st = o.stats;
  const out = [heading(P, 'opt', `${plural(o.log.length, 'change')} in ${plural(o.rounds, 'round')}`)];
  if (!o.log.length) out.push(P.dim('  Nothing to optimize.'));
  for (const l of o.log) out.push(`  ${P.c256(80)(l.rule)}  ${P.dim(pad('line ' + l.line, 8))} ${l.msg}`);
  out.push('');
  out.push(`  Instructions  ${st.before} -> ${st.after}   (labels not counted)`);
  out.push(`  Steps run     ${st.stepsBefore} -> ${st.stepsAfter}`);
  out.push(`  Same drawing  ${st.limitHit ? 'not checked: step limit reached' : st.same ? 'yes' : P.red('no')}`);
  if (full) {
    const used = [...new Set(o.log.map(l => l.rule))];
    if (used.length) out.push('', '  Rules used: ' + used.map(k => `${k} ${TC.OPT_RULES[k]}`).join(', '));
    out.push('', '  Basic blocks before', ...blocks(r.ir, P));
    out.push('', '  Basic blocks after', ...blocks(o.code, P));
  }
  return out.join('\n');
}

function secGen(r, P, full) {
  const g = r.gen;
  const out = [heading(P, 'gen', `${plural(g.prog.length, 'instruction')}, ${encode(g.prog).length} bytes`)];
  for (const p of g.prog) {
    const bytes = p.bytes.map(b => TC.hex(b, 2)).join(' ');
    out.push(`  ${P.dim(TC.hex(p.addr, 4))}  ${P.c256(141)(bytes)}  ${pad(p.text, 18)}${P.dim('; ' + TC.tacText(p.from))}`);
  }
  if (full) {
    out.push('', '  Labels');
    const labels = Object.entries(g.labels);
    if (!labels.length) out.push(P.dim('    (none)'));
    for (const [k, v] of labels) out.push(`    ${pad(k, 6)}${TC.hex(v, 4)}`);
    out.push('', '  Loop registers');
    if (!g.regs.length) out.push(P.dim('    (none)'));
    for (const x of g.regs) out.push(`    ${pad(x.temp, 6)}${pad(x.reg, 4)}${P.dim('REPEAT on line ' + x.line)}`);
    out.push('', '  Opcodes  ' + Object.entries(TC.OPCODES).map(([k, v]) => `${k} ${TC.hex(v, 2)}`).join('  '));
  }
  return out.join('\n');
}

function secRun(state, P, full, steps, segments, limitHit) {
  const out = [heading(P, 'run', plural(steps, 'step'))];
  out.push(`  Steps           ${steps}${limitHit ? P.red(`  (stopped at the ${TC.LIMITS.STEPS} step limit)`) : ''}`);
  out.push(`  Lines drawn     ${segments.length}`);
  out.push(`  Final position  x ${num(state.x)}, y ${num(state.y)}`);
  out.push(`  Heading         ${state.h}°`);
  out.push(`  Pen             ${state.pen ? 'down' : 'up'}, ${state.color}`);
  if (full) {
    out.push('', '  Lines');
    if (!segments.length) out.push(P.dim('    (none)'));
    segments.forEach((s, i) => out.push(`    ${lpad(i + 1, 4)}  (${num(s.x1)}, ${num(s.y1)}) -> (${num(s.x2)}, ${num(s.y2)})  ${s.color}`));
  }
  return out.join('\n');
}

// ---------- Outputs ----------

function svg(segments) {
  const xs = segments.flatMap(s => [s.x1, s.x2]), ys = segments.flatMap(s => [s.y1, s.y2]);
  const minX = xs.length ? Math.min(...xs) : 0, maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0, maxY = ys.length ? Math.max(...ys) : 0;
  const padding = 20, stroke = 3;
  const vx = minX - padding, vy = minY - padding, vw = maxX - minX + 2 * padding, vh = maxY - minY + 2 * padding;
  const f = n => num(n);
  const lines = segments.map(s =>
    `  <line x1="${f(s.x1)}" y1="${f(s.y1)}" x2="${f(s.x2)}" y2="${f(s.y2)}" stroke="${TC.COLORS[s.color]}"/>`);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(vx)} ${f(vy)} ${f(vw)} ${f(vh)}" width="${Math.ceil(vw)}" height="${Math.ceil(vh)}">`,
    `<rect x="${f(vx)}" y="${f(vy)}" width="${f(vw)}" height="${f(vh)}" fill="#14121f"/>`,
    `<g fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">`,
    ...lines,
    '</g>',
    '</svg>',
    ''
  ].join('\n');
}

function encode(prog) {
  return Buffer.from(prog.flatMap(p => p.bytes));
}

// Turn .tvm bytes back into the instruction objects makeVM runs.
function decode(buf) {
  if (!buf.length) throw new Error('the file is empty');
  if (buf.length % 4) throw new Error(`the file is ${buf.length} bytes long, which is not a multiple of 4`);
  const names = {};
  for (const [k, v] of Object.entries(TC.OPCODES)) names[v] = k;
  const n = buf.length / 4, prog = [];
  for (let addr = 0; addr < n; addr++) {
    const [op, reg, hi, lo] = buf.subarray(addr * 4, addr * 4 + 4);
    const at = `instruction ${TC.hex(addr, 4)}`;
    const mn = names[op];
    if (!mn) throw new Error(`${at}: unknown opcode 0x${TC.hex(op, 2)}`);
    const operand = (hi << 8) | lo;
    const p = { addr, mn, reg, operand, bytes: [op, reg, hi, lo] };
    if (mn === 'COL') {
      if (operand >= TC.COLOR_NAMES.length) throw new Error(`${at}: colour number ${operand} is not in the colour table`);
      p.color = TC.COLOR_NAMES[operand];
    }
    if ((mn === 'LDI' || mn === 'DEC' || mn === 'JLE') && (reg < 1 || reg > TC.LIMITS.DEPTH)) {
      throw new Error(`${at}: register R${reg} does not exist (R1 to R${TC.LIMITS.DEPTH})`);
    }
    if ((mn === 'JLE' || mn === 'JMP') && operand >= n) throw new Error(`${at}: jump to ${TC.hex(operand, 4)} is past the end of the program`);
    prog.push(p);
  }
  return prog;
}

// ---------- Commands ----------

function compileCommand(o, P, E) {
  if (o.files.length !== 1) throw new UsageError(o.files.length ? 'give one file at a time' : 'no input file');
  const file = o.files[0], name = file === '-' ? '<stdin>' : file;
  const r = TC.compile(readSource(file));
  const d = diagnostics(r, name, E);
  const show = k => o.phase === null || o.phase === k;
  const out = [];
  if (o.phase === null && !r.stopAt) out.push(P.bold(`turtlec ${VERSION}  ${name}`));
  if (o.phase !== null || !r.stopAt) {
    if (show('lex')) out.push(secLex(r, P, o.phase === 'lex'));
    if (r.parse && show('parse') && (o.phase === 'parse' || !r.stopAt)) out.push(secParse(r, P, o.phase === 'parse'));
    if (r.sem && show('sem')) out.push(secSem(r, P));
    if (!r.stopAt) {
      if (show('ir')) out.push(secIR(r, P, o.phase === 'ir'));
      if (show('opt')) out.push(secOpt(r, P, o.phase === 'opt'));
      if (show('gen')) out.push(secGen(r, P, o.phase === 'gen'));
      if (show('run')) out.push(secRun(execute(r.gen.prog), P, o.phase === 'run', r.run.steps, r.run.segments, r.run.limitHit));
    }
  }
  if (out.length) process.stdout.write(out.join('\n') + '\n\n');
  if (d.text) process.stderr.write(d.text + '\n');
  if (r.stopAt) return 1;
  if (o.svg) writeOut(o.svg, svg(r.run.segments));
  if (o.bin) writeOut(o.bin, encode(r.gen.prog));
  return 0;
}

function runCommand(o, P, E) {
  if (o.files.length !== 1) throw new UsageError(o.files.length ? 'give one file at a time' : 'no .tvm file to run');
  if (o.phase || o.bin) throw new UsageError('run takes only --svg and --no-color');
  const file = o.files[0], name = file === '-' ? '<stdin>' : file;
  let buf;
  try { buf = file === '-' ? fs.readFileSync(0) : fs.readFileSync(file); } catch (e) {
    throw new UsageError(`cannot read ${file}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`);
  }
  let prog;
  try { prog = decode(buf); } catch (e) {
    process.stderr.write(`${E.bold(name + ':')} ${E.red('machine code error:')} ${e.message}\n`);
    return 1;
  }
  const s = execute(prog);
  const limitHit = !s.halted;
  process.stdout.write(P.bold(`turtlec ${VERSION}  ${name}  (${plural(prog.length, 'instruction')})`) + '\n');
  process.stdout.write(secRun(s, P, false, s.steps, s.segments, limitHit) + '\n\n');
  if (o.svg) writeOut(o.svg, svg(s.segments));
  return 0;
}

function main(argv) {
  let E = painter(colorEnabled(null, process.stderr));
  try {
    const o = parseArgs(argv);
    E = painter(colorEnabled(o.color, process.stderr));
    const P = painter(colorEnabled(o.color, process.stdout));
    if (o.help) { process.stdout.write(HELP); return 0; }
    if (o.version) { process.stdout.write(`turtlec ${VERSION}\n`); return 0; }
    if (o.files[0] === 'run' && o.files.length > 1) { o.files.shift(); return runCommand(o, P, E); }
    return compileCommand(o, P, E);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    process.stderr.write(`${E.red('turtlec:')} ${e.message}\nTry turtlec --help.\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, decode, encode, svg, VERSION, path: path.resolve(__filename) };
