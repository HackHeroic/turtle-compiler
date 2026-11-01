#!/usr/bin/env node
/* Pixel-diff the built site against the Claude Design files.

   Usage: node tools/pixel-diff.mjs [page ...]    pages: home reference team present (default: all that exist)
   Needs: `npm run build` first (serves ./out), Google Chrome, and Claude Design's runtime at design/support.js
   (not in the repo; it comes with the Claude Design export). Set SITE_URL to diff a deployed site.
   Writes screenshots and diff images to ./.pixel-diff/ and prints the mismatch per page and width. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..');
const DESIGN = path.resolve(WEB, '../design');
const OUTDIR = path.join(WEB, '.pixel-diff');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const PAGES = {
  home: { design: 'Turtle Compiler.dc.html', site: '/', states: [null, 'Lexical error', 'Syntax error', 'Semantic error', 'Optimizer playground', 'Flower', 'Square'] },
  reference: { design: 'Language Reference.dc.html', site: '/reference/' },
  team: { design: 'Team.dc.html', site: '/team/' },
  present: { design: 'Present.dc.html', site: '/present/' }
};
const WIDTHS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
function serve(dir) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = path.join(dir, p);
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const REMOTE = !!process.env.SITE_URL;

// A deployed site behind a CDN can reset a burst of headless loads, so retry with backoff.
async function open(page, url) {
  for (let attempt = 1; ; attempt++) {
    try { return await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); }
    catch (e) {
      if (attempt >= 6 || !/net::ERR_|Timeout/i.test(String(e))) throw e;
      const wait = 5000 * 2 ** (attempt - 1);
      console.warn(`  ${url}: ${String(e).match(/net::ERR_\w+|Timeout/i)?.[0]}, retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

async function shoot(browser, url, vp, file, click) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (REMOTE && !url.startsWith('http://127.0.0.1')) await sleep(2000);
  await open(page, url);
  await page.evaluate(() => document.fonts.ready);
  // Wait until the design components have rendered (both runtimes add .sc-host wrappers).
  await page.waitForFunction(() => document.querySelectorAll('.sc-host').length > 0 && !document.body.innerText.includes('Loading the compiler'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (click) { await page.getByRole('button', { name: click, exact: true }).click(); await page.waitForTimeout(1200); }
  await page.mouse.move(0, 0);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide' });
  await page.close();
  return errors;
}

function compare(a, b, out) {
  const A = PNG.sync.read(fs.readFileSync(a)), B = PNG.sync.read(fs.readFileSync(b));
  const w = Math.min(A.width, B.width), h = Math.min(A.height, B.height);
  const crop = (img) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, 0, 0, w, h, 0, 0); return o; };
  const a2 = crop(A), b2 = crop(B), diff = new PNG({ width: w, height: h });
  const n = pixelmatch(a2.data, b2.data, diff.data, w, h, { threshold: 0.1 });
  fs.writeFileSync(out, PNG.sync.write(diff));
  return { mismatch: n, total: w * h, sizeA: `${A.width}×${A.height}`, sizeB: `${B.width}×${B.height}` };
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PAGES).filter(k => fs.existsSync(path.join(DESIGN, PAGES[k].design)));
if (!fs.existsSync(path.join(DESIGN, 'support.js'))) {
  console.error('design/support.js is missing. It is Claude Design\'s runtime and is not in the repo:\n' +
    'export the project from Claude Design and copy its support.js into design/, then run this again.');
  process.exit(2);
}
fs.mkdirSync(OUTDIR, { recursive: true });
// SITE_URL=https://turtle.muralimadhav.com compares the deployed site instead of ./out.
const d = await serve(DESIGN), s = process.env.SITE_URL ? { base: process.env.SITE_URL.replace(/\/$/, ''), server: { close() {} } } : await serve(path.join(WEB, 'out'));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let worst = 0;
try {
  for (const key of wanted) {
    for (const vp of WIDTHS) for (const click of (PAGES[key].states || [null])) {
      const tag = `${key}-${vp.w}${click ? '-' + click.toLowerCase().replace(/\W+/g, '-') : ''}`;
      const fa = path.join(OUTDIR, `${tag}-design.png`), fb = path.join(OUTDIR, `${tag}-site.png`);
      const ea = await shoot(browser, d.base + '/' + encodeURI(PAGES[key].design), vp, fa, click);
      const eb = await shoot(browser, s.base + PAGES[key].site, vp, fb, click);
      const r = compare(fa, fb, path.join(OUTDIR, `${tag}-diff.png`));
      const pct = (100 * r.mismatch / r.total);
      worst = Math.max(worst, pct);
      console.log(`${tag.padEnd(16)} ${String(r.mismatch).padStart(8)} px differ (${pct.toFixed(3)}%)  design ${r.sizeA}  site ${r.sizeB}${eb.length ? `  site errors: ${eb.slice(0, 2).join(' | ')}` : ''}${ea.length ? `  design errors: ${ea.length}` : ''}`);
    }
  }
} finally {
  await browser.close();
  d.server.close(); s.server.close();
}
process.exitCode = worst > 0.5 ? 1 : 0;
