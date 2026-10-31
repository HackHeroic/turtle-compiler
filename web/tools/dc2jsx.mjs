#!/usr/bin/env node
/* dc2jsx: turns Claude Design (.dc.html) files into React components for the Next.js site.

   Usage: node tools/dc2jsx.mjs [names...]     (default: every .dc.html in ../design except Design System)

   The output must render the same DOM as the design runtime (support.js), so the site matches the
   design pixel for pixel. This file mirrors support.js where it matters:
   - the template is parsed as HTML in a <template> context (parse5 = the browser's HTML parser),
     after the same pre-encoding (camelCase attributes, <helmet>, table tags);
   - text nodes are kept or dropped by the same whitespace rule, and {{ values }} are wrapped the same way;
   - inline styles go through the same css-to-object split; style-hover/style-focus become classes
     whose declarations get !important;
   - the logic class is copied verbatim and run by web/dc/runtime.js. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragment } from 'parse5';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DESIGN = path.join(ROOT, 'design');
const OUT = path.join(ROOT, 'web/dc/generated');
const VENDOR = path.join(ROOT, 'web/dc/vendor');

// Design file → site route. Links between design files are rewritten to these.
const ROUTES = { 'Turtle Compiler': '/', 'Language Reference': '/reference/', 'Team': '/team/', 'Present': '/present/' };

// ---------- pre-encoding, as in support.js ----------
const CAMEL = 'sc-camel-';
const RAW_WRAP = { select: 'sc-raw-select', table: 'sc-raw-table', tbody: 'sc-raw-tbody', thead: 'sc-raw-thead', tfoot: 'sc-raw-tfoot', tr: 'sc-raw-tr', td: 'sc-raw-td', th: 'sc-raw-th', caption: 'sc-raw-caption' };
const RAW_UNWRAP = Object.fromEntries(Object.entries(RAW_WRAP).map(([k, v]) => [v, k]));
const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const IMPORT_SELF_CLOSE_RE = new RegExp('<(x-import|dc-import)(' + ATTRS + ')/>', 'gi');
const CAMEL_ATTR_RE = /(\s)([a-z]+[A-Z][A-Za-z0-9]*)(\s*=)/g;
function encodeCase(html) {
  html = html.replace(IMPORT_SELF_CLOSE_RE, (_, t, a) => '<' + t + a + '></' + t + '>');
  html = html.replace(/<helmet(\s|>)/gi, '<sc-helmet$1').replace(/<\/helmet\s*>/gi, '</sc-helmet>');
  html = html.replace(CAMEL_ATTR_RE, (_, sp, name, eq) => sp + CAMEL + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + eq);
  for (const [real, alias] of Object.entries(RAW_WRAP)) html = html.replace(new RegExp('(</?)' + real + '(?=[\\s>])', 'gi'), '$1' + alias);
  return html;
}
const kebabToCamel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function cssToObj(css) {
  const o = {};
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    o[prop.startsWith('--') ? prop : kebabToCamel(prop)] = decl.slice(i + 1).trim();
  }
  return o;
}
function importantify(css) {
  const out = [];
  let start = 0, depth = 0, quote = '';
  const push = s => { s = s.trim(); if (s) out.push(/!important\s*$/i.test(s) ? s : s + ' !important'); };
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
    else if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) { push(css.slice(start, i)); start = i + 1; }
  }
  push(css.slice(start));
  return out.join(';');
}

const EVENT_MAP = Object.fromEntries('Click Change Input Submit KeyDown KeyUp KeyPress MouseDown MouseUp MouseEnter MouseLeave Focus Blur DoubleClick ContextMenu MouseMove MouseOver MouseOut PointerDown PointerUp PointerMove PointerEnter PointerLeave PointerCancel PointerOver PointerOut GotPointerCapture LostPointerCapture TouchStart TouchEnd TouchMove TouchCancel DragStart DragEnd DragEnter DragLeave DragOver AnimationStart AnimationEnd AnimationIteration TransitionEnd'.split(' ').map(n => ['on' + n.toLowerCase(), 'on' + n]));
// Attribute names React wants in camelCase. The DOM it writes is the same.
const REACT_NAMES = {
  tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength', minlength: 'minLength', colspan: 'colSpan', rowspan: 'rowSpan',
  autocomplete: 'autoComplete', autocapitalize: 'autoCapitalize', autocorrect: 'autoCorrect', autofocus: 'autoFocus', spellcheck: 'spellCheck',
  crossorigin: 'crossOrigin', inputmode: 'inputMode', enterkeyhint: 'enterKeyHint', contenteditable: 'contentEditable', datetime: 'dateTime', accesskey: 'accessKey',
  'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin', 'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset', 'stroke-opacity': 'strokeOpacity', 'stroke-miterlimit': 'strokeMiterlimit', 'fill-opacity': 'fillOpacity',
  'fill-rule': 'fillRule', 'clip-rule': 'clipRule', 'clip-path': 'clipPath', 'font-size': 'fontSize', 'font-family': 'fontFamily', 'font-weight': 'fontWeight',
  'font-style': 'fontStyle', 'text-anchor': 'textAnchor', 'dominant-baseline': 'dominantBaseline', 'alignment-baseline': 'alignmentBaseline',
  'letter-spacing': 'letterSpacing', 'marker-end': 'markerEnd', 'marker-start': 'markerStart', 'marker-mid': 'markerMid', 'stop-color': 'stopColor',
  'stop-opacity': 'stopOpacity', 'pointer-events': 'pointerEvents', 'shape-rendering': 'shapeRendering', 'vector-effect': 'vectorEffect',
  'paint-order': 'paintOrder', 'text-decoration': 'textDecoration', 'xlink:href': 'xlinkHref', 'xml:space': 'xmlSpace'
};
const VOID = new Set('area base br col embed hr img input link meta source track wbr'.split(' '));
const WHOLE_RE = /^\s*\{\{([\s\S]+?)\}\}\s*$/;
const PART_RE = /\{\{([\s\S]+?)\}\}/g;
const J = s => JSON.stringify(s);
const pascal = base => base.split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('');
const slugOf = base => base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function rewriteHref(v) {
  const m = v.match(/^([^#?{}]+)\.dc\.html([#?].*)?$/);
  if (!m) return v;
  const route = ROUTES[decodeURIComponent(m[1])];
  return route === undefined ? v : route + (m[2] && m[2][0] === '#' ? m[2] : '');
}

function convert(base) {
  const file = path.join(DESIGN, base + '.dc.html');
  const src = fs.readFileSync(file, 'utf8');
  const open = /<x-dc(?:\s[^>]*)?>/.exec(src);
  const close = src.lastIndexOf('</x-dc>');
  if (!open || close < open.index) throw new Error(`${base}: no <x-dc> root`);
  const template = src.slice(open.index + open[0].length, close);
  const sm = /<script\b[^>]*\bdata-dc-script\b[^>]*>([\s\S]*?)<\/script>/.exec(src.slice(close));
  const logic = sm ? sm[1].trim() : 'class Component extends DCLogic {}';

  const name = pascal(base), slug = slugOf(base);
  const css = [], pseudo = new Map(), imports = new Set(), helmet = { links: [], scripts: [] };
  let loopDepth = 0;

  const pseudoClass = (kind, value) => {
    const k = kind + '|' + value;
    if (pseudo.has(k)) return pseudo.get(k).cls;
    const cls = `scp-${slug}-${pseudo.size.toString(36)}`;
    const isEl = kind === 'before' || kind === 'after';
    pseudo.set(k, { cls, rule: `.${cls}${isEl ? '::' : ':'}${kind}{${isEl ? value : importantify(value)}}` });
    return cls;
  };

  // A {{ }}-aware attribute value as JSX. `wrap` adapts the resolved value (style, value, checked).
  const valueExpr = (raw, V, wrap) => {
    const whole = raw.match(WHOLE_RE);
    if (whole) return wrap(`resolve(${V}, ${J(whole[1])})`, true);
    if (raw.includes('{{')) {
      const parts = raw.split(PART_RE);
      return wrap(`attr(${V}, ${J(parts)})`, true);
    }
    return wrap(null, false, raw);
  };

  function attrsOf(node, V) {
    const props = [], classes = [];
    let className = null;
    for (const { name: rawName, value } of node.attrs) {
      let key = rawName;
      if (key === 'sc-name' || key === 'data-dc-tpl') continue;
      if (key.startsWith(CAMEL)) key = kebabToCamel(key.slice(CAMEL.length));
      if (key === 'hint-size') continue;
      if (key.startsWith('style-')) { classes.push(pseudoClass(key.slice(6), value)); continue; }
      if (key === 'class') key = 'className';
      else if (key === 'for') key = 'htmlFor';
      else if (key.startsWith('on')) key = EVENT_MAP[key] || 'on' + key[2].toUpperCase() + key.slice(3);
      key = REACT_NAMES[key] || key;
      let jsx;
      if (key === 'style') jsx = valueExpr(value, V, (e, dyn, raw) => dyn ? `{styleOf(${e})}` : `{${J(cssToObj(raw))}}`);
      else if (key === 'value') jsx = valueExpr(value, V, (e, dyn, raw) => dyn ? `{valueOf(${e})}` : `{${J(raw)}}`);
      else if (key === 'checked') jsx = valueExpr(value, V, (e, dyn, raw) => dyn ? `{checkedOf(${e})}` : `{${J(raw)}}`);
      else if (key === 'href') jsx = valueExpr(value, V, (e, dyn, raw) => dyn ? `{${e}}` : `{${J(rewriteHref(raw))}}`);
      else jsx = valueExpr(value, V, (e, dyn, raw) => dyn ? `{${e}}` : `{${J(raw)}}`);
      if (key === 'className') { className = jsx; continue; }
      props.push(`${key}=${jsx}`);
    }
    if (classes.length || className) {
      if (!className) props.push(`className={${J(classes.join(' '))}}`);
      else props.push(`className={[${className.slice(1, -1)}, ${classes.map(J).join(', ')}].filter(Boolean).join(' ')}`);
    }
    return props;
  }

  function kids(node, V) { return node.childNodes.map(c => walk(c, V)).filter(Boolean).join(''); }

  function walk(node, V) {
    if (node.nodeName === '#text') {
      const txt = node.value;
      if (!txt.includes('{{')) {
        if (!txt.trim() && !txt.includes(' ')) return '';
        return `{${J(txt)}}`;
      }
      return txt.split(PART_RE).map((p, i) => (i & 1 ? `<T v={resolve(${V}, ${J(p)})} />` : p ? `{${J(p)}}` : '')).join('');
    }
    if (node.nodeName === '#comment' || !node.tagName) return '';
    const tag = node.tagName;
    const get = n => (node.attrs.find(a => a.name === n) || {}).value;

    if (tag === 'sc-helmet') {
      for (const c of node.childNodes) {
        if (c.tagName === 'style') css.push(c.childNodes.map(t => t.value || '').join(''));
        else if (c.tagName === 'link') helmet.links.push((c.attrs.find(a => a.name === 'href') || {}).value);
        else if (c.tagName === 'script') helmet.scripts.push((c.attrs.find(a => a.name === 'src') || {}).value);
      }
      return '';
    }
    if (tag === 'sc-for') {
      const listRaw = get('list') || '', as = get('as') || 'item';
      const whole = listRaw.match(WHOLE_RE);
      const d = ++loopDepth, V2 = `V${d}`;
      const body = kids(node, V2);
      loopDepth--;
      if (!whole) return '';
      return `{list(${V}, ${J(whole[1])}).map((it${d}, i${d}) => { const ${V2} = { ...${V}, ${J(as)}: it${d}, $index: i${d} }; return (<React.Fragment key={i${d}}>${body}</React.Fragment>); })}`;
    }
    if (tag === 'sc-if') {
      const raw = get('value') || '';
      const whole = raw.match(WHOLE_RE);
      const cond = whole ? `resolve(${V}, ${J(whole[1])})` : raw.includes('{{') ? `attr(${V}, ${J(raw.split(PART_RE))})` : J(raw);
      return `{${cond} ? (<>${kids(node, V)}</>) : null}`;
    }
    if (tag === 'dc-import' || tag === 'x-import') {
      const comp = get('name') || get('component');
      if (!comp) throw new Error(`${base}: <${tag}> without a name`);
      const cname = pascal(comp);
      imports.add(cname);
      const props = [];
      for (const { name: rawName, value } of node.attrs) {
        let key = rawName.startsWith(CAMEL) ? kebabToCamel(rawName.slice(CAMEL.length)) : rawName;
        if (['name', 'component', 'style', 'hint-size', 'data-dc-tpl'].includes(key)) continue;
        if (key.includes('-')) key = kebabToCamel(key);
        props.push(`${key}=${valueExpr(value, V, (e, dyn, r) => dyn ? `{${e}}` : `{${J(r)}}`)}`);
      }
      const inner = kids(node, V);
      return inner ? `<${cname} ${props.join(' ')}>${inner}</${cname}>` : `<${cname} ${props.join(' ')} />`;
    }
    const real = RAW_UNWRAP[tag] || tag;
    const props = attrsOf(node, V);
    const content = node.tagName === 'template' ? '' : kids(node.content || node, V);
    const openTag = `<${real}${props.length ? ' ' + props.join(' ') : ''}`;
    if (VOID.has(real)) return `${openTag} />`;
    return content ? `${openTag}>${content}</${real}>` : `${openTag}></${real}>`;
  }

  const frag = parseFragment(encodeCase(template));
  const body = kids(frag, 'V0');
  const usesCompiler = helmet.scripts.some(s => /compiler\.js$/.test(s || '')) || helmet.scripts.some(s => /tc-view\.js$/.test(s || ''));
  for (const s of helmet.scripts) {
    if (s && /tc-view\.js$/.test(s)) { fs.mkdirSync(VENDOR, { recursive: true }); fs.copyFileSync(path.join(DESIGN, s), path.join(VENDOR, 'tc-view.js')); }
  }

  const jsx = `'use client';
/* GENERATED by web/tools/dc2jsx.mjs from design/${base}.dc.html. Do not edit by hand:
   change the design file and run \`npm run convert\`. */
/* eslint-disable */
import React from 'react';
import { DCLogic, dcComponent, resolve, attr, styleOf, valueOf, checkedOf, list, T } from '../runtime';
${usesCompiler ? "import '../globals';\n" : ''}${[...imports].map(c => `import ${c} from './${c}';`).join('\n')}${imports.size ? '\n' : ''}import './${name}.css';

${logic}

function Template(V0) {
  return (<>${body}</>);
}

export default dcComponent(${J(base)}, Component, Template);
`;
  const cssOut = `/* GENERATED from design/${base}.dc.html (its <helmet> styles and style-hover/style-focus rules). */\n${css.join('\n')}\n${[...pseudo.values()].map(p => p.rule).join('\n')}\n`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name + '.jsx'), jsx);
  fs.writeFileSync(path.join(OUT, name + '.css'), cssOut);
  return { base, name, imports: [...imports], fonts: helmet.links, scripts: helmet.scripts, pseudo: pseudo.size, bytes: jsx.length };
}

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(DESIGN).filter(f => f.endsWith('.dc.html') && f !== 'Design System.dc.html').map(f => f.replace(/\.dc\.html$/, ''));
for (const n of names) {
  const r = convert(n);
  console.log(`${r.base} → dc/generated/${r.name}.jsx (${r.bytes} bytes, ${r.pseudo} hover/focus rules${r.imports.length ? ', imports ' + r.imports.join(', ') : ''})`);
}
