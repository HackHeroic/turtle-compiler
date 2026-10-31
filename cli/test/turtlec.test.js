'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(ROOT, 'cli', 'turtlec.js');
const TC = require(path.join(ROOT, 'compiler', 'compiler.js'));
const ex = name => path.join('examples', name + '.turtle');
const compiled = name => TC.compile(fs.readFileSync(path.join(ROOT, ex(name)), 'utf8'));

function turtlec(args, opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  delete env.FORCE_COLOR;
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', input: opts.input, env });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'turtlec-'));
const tmpFile = name => path.join(tmp, name);

test('full report on star shows all six phases and the run', () => {
  const r = turtlec([ex('star')]);
  assert.strictEqual(r.code, 0, r.err);
  const c = compiled('star');
  for (const h of ['1  Lexical analysis', '2  Syntax analysis', '3  Semantic analysis',
    '4  Intermediate code', '5  Code optimization', '6  Code generation', 'Run']) {
    assert.match(r.out, new RegExp('^' + h, 'm'), h);
  }
  assert.match(r.out, /KEYWORD\(SET\) IDENT\(side\) ASSIGN\(=\) NUMBER\(150\) SEMI\(;\)/);
  assert.match(r.out, new RegExp(`accepted, ${c.parse.nodes.length} nodes`));
  assert.match(r.out, /✓ S2 +line 3 +side = 150 added to the symbol table/);
  assert.match(r.out, /L1:/);
  for (const l of c.opt.log) assert.ok(r.out.includes(`${l.rule}  `) && r.out.includes(l.msg), l.msg);
  assert.match(r.out, new RegExp(`Instructions  ${c.opt.stats.before} -> ${c.opt.stats.after}`));
  for (const p of c.gen.prog) {
    assert.ok(r.out.includes(p.bytes.map(b => TC.hex(b, 2)).join(' ') + '  ' + p.text), p.text);
  }
  assert.match(r.out, new RegExp(`Steps +${c.run.steps}\\n`));
  assert.match(r.out, new RegExp(`Lines drawn +${c.run.segments.length}\\n`));
  assert.match(r.out, /Final position +x 0, y 0/);
});

test('error examples exit 1 with file:line:col headers', () => {
  const cases = [
    ['synerr', ['examples/synerr.turtle:4:3: syntax error: Expected ; after "100" but found "TURN".']],
    ['lexerr', ['examples/lexerr.turtle:2:8: lexical error:', 'examples/lexerr.turtle:3:6: lexical error:']],
    ['semerr', ['examples/semerr.turtle:2:5: semantic error:', 'examples/semerr.turtle:3:8: semantic error:',
      'examples/semerr.turtle:4:8: semantic error:', 'examples/semerr.turtle:6:6: semantic error:']]
  ];
  for (const [name, heads] of cases) {
    const r = turtlec([ex(name)]);
    assert.strictEqual(r.code, 1, name);
    assert.strictEqual(r.out, '', name);
    for (const h of heads) assert.ok(r.err.includes(h), `${name}: ${h}`);
  }
  const s = turtlec([ex('synerr')]).err.split('\n');
  assert.strictEqual(s[1], '    4 |   TURN 90;');
  assert.strictEqual(s[2], '      |   ^~~~');
  assert.strictEqual(s[3], '      = hint: Every command ends with a semicolon.');
});

test('warnings do not fail the compile', () => {
  const r = turtlec([ex('play')]);
  assert.strictEqual(r.code, 0);
  assert.match(r.err, /examples\/play\.turtle:17:1: warning: This REPEAT has nothing inside/);
});

test('every --phase prints only that phase in full detail', () => {
  const c = compiled('play');
  const expect = {
    lex: [/^1  Lexical analysis/m, /Line:Col Type/],
    parse: [/^2  Syntax analysis/m, /#  Stack +Input +Action/, /accept$/m],
    sem: [/^3  Semantic analysis/m, /Symbol table/],
    ir: [/^4  Intermediate code/m, /Quadruples/, /if<= +t1 +0 +L2/],
    opt: [/^5  Code optimization/m, /Basic blocks before/, /Basic blocks after/],
    gen: [/^6  Code generation/m, /Loop registers/],
    run: [/^Run/m, new RegExp(`Steps +${c.run.steps}\\n`), /Lines\n/]
  };
  const all = ['1  Lexical', '2  Syntax', '3  Semantic', '4  Intermediate', '5  Code opt', '6  Code gen', 'Run '];
  Object.keys(expect).forEach((phase, k) => {
    const r = turtlec(['--phase', phase, ex('play')]);
    assert.strictEqual(r.code, 0, phase);
    for (const re of expect[phase]) assert.match(r.out, re, phase);
    all.forEach((h, j) => { if (j !== k) assert.ok(!r.out.includes(h), `${phase} should not include ${h}`); });
  });
});

test('--phase parse on a syntax error shows the trace up to the error', () => {
  const r = turtlec(['--phase', 'parse', ex('synerr')]);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /error$/m);
  assert.match(r.err, /synerr\.turtle:4:3: syntax error/);
});

test('--svg writes one line per segment', () => {
  for (const name of ['star', 'flower', 'play']) {
    const out = tmpFile(name + '.svg');
    const r = turtlec([ex(name), '--svg', out, '--phase', 'run']);
    assert.strictEqual(r.code, 0);
    const svg = fs.readFileSync(out, 'utf8');
    assert.strictEqual((svg.match(/<line /g) || []).length, compiled(name).run.segments.length, name);
    assert.match(svg, /stroke-linecap="round"/);
    assert.match(svg, /viewBox="[-\d.]+ [-\d.]+ [\d.]+ [\d.]+"/);
  }
});

test('--bin and run round-trip', () => {
  for (const name of ['square', 'star', 'flower', 'play']) {
    const bin = tmpFile(name + '.tvm');
    assert.strictEqual(turtlec([ex(name), '--bin', bin, '--phase', 'gen']).code, 0);
    const c = compiled(name);
    const bytes = fs.readFileSync(bin);
    assert.deepStrictEqual([...bytes], c.gen.prog.flatMap(p => p.bytes));
    const svg = tmpFile(name + '-run.svg');
    const r = turtlec(['run', bin, '--svg', svg]);
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`Steps +${c.run.steps}\\n`));
    assert.match(r.out, new RegExp(`Lines drawn +${c.run.segments.length}\\n`));
    const fromSource = tmpFile(name + '-src.svg');
    turtlec([ex(name), '--svg', fromSource, '--phase', 'run']);
    assert.strictEqual(fs.readFileSync(svg, 'utf8'), fs.readFileSync(fromSource, 'utf8'));
  }
  const { decode } = require(CLI);
  const c = compiled('flower');
  const prog = decode(Buffer.from(c.gen.prog.flatMap(p => p.bytes)));
  const back = TC.run(prog);
  assert.strictEqual(back.steps, c.run.steps);
  assert.deepStrictEqual(back.segments, c.run.segments);
});

test('run rejects bad machine code', () => {
  const bad = (name, bytes) => { const f = tmpFile(name); fs.writeFileSync(f, Buffer.from(bytes)); return turtlec(['run', f]); };
  let r = bad('short.tvm', [0x10, 0, 0]);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /not a multiple of 4/);
  r = bad('op.tvm', [0x99, 0, 0, 0]);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /unknown opcode 0x99/);
  r = bad('col.tvm', [0x20, 0, 0, 42, 0xFF, 0, 0, 0]);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /colour number 42/);
});

test('--no-color, NO_COLOR and pipes give plain output; --color forces colour', () => {
  for (const args of [['--no-color', '--color'], ['--color', '--no-color']]) {
    const r = turtlec([ex('star'), ...args]);
    const hasEsc = r.out.includes('\x1b');
    assert.strictEqual(hasEsc, args[args.length - 1] === '--color', args.join(' '));
  }
  assert.ok(!turtlec([ex('star')]).out.includes('\x1b'));
  assert.ok(!turtlec([ex('semerr'), '--no-color']).err.includes('\x1b'));
  assert.ok(!turtlec([ex('star')], { env: { NO_COLOR: '1' } }).out.includes('\x1b'));
});

test('stdin, help, version and usage errors', () => {
  const r = turtlec(['-', '--phase', 'run'], { input: 'MOVE 50;\n' });
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /Final position +x 0, y -50/);
  const e = turtlec(['-'], { input: 'MOVE 50' });
  assert.strictEqual(e.code, 1);
  assert.match(e.err, /^<stdin>:1:6: syntax error:/);
  assert.strictEqual(turtlec(['--version']).out, '0.1.0\n'.replace(/^/, 'turtlec '));
  assert.match(turtlec(['--help']).out, /Usage:/);
  assert.strictEqual(turtlec([]).code, 2);
  assert.strictEqual(turtlec(['--phase', 'nope', ex('star')]).code, 2);
  assert.strictEqual(turtlec(['--bogus', ex('star')]).code, 2);
  assert.strictEqual(turtlec(['missing.turtle']).code, 2);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
