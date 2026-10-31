'use client';
/* A small runtime for components converted from Claude Design (.dc.html) files.
   It mirrors the design runtime (support.js) exactly where it changes what renders:
   how {{ expressions }} resolve, how text values are wrapped, how styles are parsed,
   and the logic-class lifecycle. Keep it in step with tools/dc2jsx.mjs. */
import React from 'react';

// ---------- {{ expression }} rules: paths, !, ===/!==/==/!=, literals ----------
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

function parensWrapWhole(expr) {
  let depth = 0;
  for (let i = 0; i < expr.length - 1; i++) {
    if (expr[i] === '(') depth++;
    else if (expr[i] === ')') { depth--; if (depth === 0) return false; }
  }
  return true;
}

function findTopLevelEquality(expr) {
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (depth === 0 && (c === '=' || c === '!') && expr[i + 1] === '=') {
      if (i > 0 && (expr[i - 1] === '=' || expr[i - 1] === '!')) continue;
      if (!expr.slice(0, i).trim()) continue;
      const op = expr[i + 2] === '=' ? c + '==' : c + '=';
      return { index: i, op };
    }
  }
  return null;
}

function resolvePath(vals, expr) {
  const head = expr.match(IDENT_RE);
  if (!head) return undefined;
  let cur = vals == null ? undefined : vals[head[0]];
  let i = head[0].length;
  while (i < expr.length) {
    if (expr[i] === '.') {
      const m = expr.slice(i + 1).match(IDENT_RE) || expr.slice(i + 1).match(/^\d+/);
      if (!m) return undefined;
      cur = cur == null ? undefined : cur[m[0]];
      i += 1 + m[0].length;
    } else if (expr[i] === '[') {
      let depth = 1, j = i + 1;
      while (j < expr.length && depth > 0) {
        if (expr[j] === '[') depth++;
        else if (expr[j] === ']') { depth--; if (depth === 0) break; }
        j++;
      }
      if (depth !== 0) return undefined;
      const key = resolve(vals, expr.slice(i + 1, j));
      cur = cur == null ? undefined : cur[key];
      i = j + 1;
    } else {
      return undefined;
    }
  }
  return cur;
}

export function resolve(vals, src) {
  const expr = String(src).trim();
  if (!expr) return undefined;
  if (expr[0] === '(' && expr[expr.length - 1] === ')' && parensWrapWhole(expr)) return resolve(vals, expr.slice(1, -1));
  const eq = findTopLevelEquality(expr);
  if (eq) {
    const lv = resolve(vals, expr.slice(0, eq.index));
    const rv = resolve(vals, expr.slice(eq.index + eq.op.length));
    switch (eq.op) {
      case '===': return lv === rv;
      case '!==': return lv !== rv;
      case '==': return lv == rv; // eslint-disable-line eqeqeq
      default: return lv != rv; // eslint-disable-line eqeqeq
    }
  }
  if (expr[0] === '!') return !resolve(vals, expr.slice(1));
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (expr === 'null') return null;
  if (expr === 'undefined') return undefined;
  if (NUMBER_RE.test(expr)) return Number(expr);
  if (expr.length >= 2 && (expr[0] === '"' || expr[0] === "'") && expr[expr.length - 1] === expr[0]) return expr.slice(1, -1);
  return resolvePath(vals, expr);
}

// An attribute made of text and {{ }} parts: ["text", "expr", "text", ...]
export function attr(vals, parts) {
  return parts.map((s, i) => (i & 1 ? resolve(vals, s) ?? '' : s)).join('');
}

const kebabToCamel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
export function cssToObj(css) {
  const o = {};
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    o[prop.startsWith('--') ? prop : kebabToCamel(prop)] = decl.slice(i + 1).trim();
  }
  return o;
}
export const styleOf = v => (typeof v === 'string' ? cssToObj(v) : v);
export const valueOf = v => (v === undefined ? '' : v);
export const checkedOf = v => (v === undefined ? false : v);

export function list(vals, expr) {
  const l = resolve(vals, expr);
  return Array.isArray(l) ? l : [];
}

// A {{ value }} inside text: elements and arrays render as-is, null/booleans render nothing,
// everything else becomes <span class="sc-interp">, exactly like the design runtime.
export function T({ v }) {
  if (v === undefined || v === null || typeof v === 'boolean') return null;
  if (React.isValidElement(v) || Array.isArray(v)) return <>{v}</>;
  return <span className="sc-interp">{String(v)}</span>;
}

// ---------- Logic classes ----------
export class DCLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
    this.__host = undefined;
  }
  setState(update, cb) { if (this.__host) this.__host.__setLogicState(update, cb); }
  forceUpdate() { if (this.__host) this.__host.forceUpdate(); }
  componentDidMount() {}
  componentDidUpdate() {}
  componentWillUnmount() {}
  renderVals() { return {}; }
}

// Wraps a logic class and a template the way the design runtime does:
// one <div class="sc-host" data-sc-name="..."> around the template, values = props + renderVals().
export function dcComponent(name, Logic, Template) {
  class Host extends React.Component {
    constructor(props) {
      super(props);
      this.state = { v: 0 };
      this.logic = new Logic(props);
      this.logic.__host = this;
    }
    __setLogicState(update, cb) {
      const prev = this.logic.state;
      const patch = typeof update === 'function' ? update(prev) : update;
      this.logic.state = { ...prev, ...patch };
      this.setState(s => ({ v: s.v + 1 }), cb);
    }
    componentDidMount() { try { this.logic.componentDidMount(); } catch (e) { console.error(e); } }
    componentDidUpdate(prevProps) {
      this.logic.props = this.props;
      try { this.logic.componentDidUpdate(prevProps); } catch (e) { console.error(e); }
    }
    componentWillUnmount() { try { this.logic.componentWillUnmount(); } catch (e) { console.error(e); } }
    render() {
      this.logic.props = this.props;
      let vals = this.props;
      try { vals = { ...this.props, ...(this.logic.renderVals() || {}) }; } catch (e) { console.error(e); }
      return <div className="sc-host" data-sc-name={name}>{Template(vals)}</div>;
    }
  }
  Host.displayName = name.replace(/\s+/g, '');
  return Host;
}
