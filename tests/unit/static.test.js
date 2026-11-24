// Static integrity checks: wiring between index.html and the scripts. Run: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const jsFiles = readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js'));
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

test('every $("id") used by the scripts exists in index.html', () => {
  const missing = [];
  for (const f of jsFiles) {
    const src = readFileSync(join(ROOT, 'js', f), 'utf8');
    for (const m of src.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)) if (!ids.has(m[1])) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('ids are unique', () => {
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(all.filter((x, i) => all.indexOf(x) !== i), []);
});

test('every local script exists, every js file is loaded, core.js loads before the others', () => {
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1].split('?')[0]);
  const local = srcs.filter((s) => !/^https?:/.test(s));
  for (const s of local) assert.ok(existsSync(join(ROOT, s)), s);
  for (const f of jsFiles) assert.ok(local.includes('js/' + f), `js/${f} not loaded`);
  assert.equal(local[0], 'js/core.js');
});

test('CDN scripts, import map and dynamic imports are pinned to exact versions', () => {
  const engine = readFileSync(join(ROOT, 'js', 'video-engine.js'), 'utf8');
  const cdn = [
    ...[...html.matchAll(/<script src="(https?:[^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/"(https:\/\/cdn\.jsdelivr\.net[^"]+)"/g)].map((m) => m[1]),
    ...[...engine.matchAll(/'(https:\/\/cdn[^']+)'/g)].map((m) => m[1]),
  ];
  assert.ok(cdn.some((u) => u.includes('mediabunny@')) && cdn.some((u) => u.includes('aac-encoder@')));
  assert.ok(cdn.length >= 5);
  for (const u of cdn) assert.match(u, /\d+\.\d+\.\d+/, u);
});

test('every tab button has a panel and every drop zone points at a file input', () => {
  for (const m of html.matchAll(/data-tab="([^"]+)"/g)) assert.ok(ids.has('tab-' + m[1]), m[1]);
  for (const m of html.matchAll(/data-input="([^"]+)"/g)) {
    assert.ok(ids.has(m[1]), m[1]);
    assert.match(html, new RegExp(`<input type="file" id="${m[1]}"`));
  }
});

test('audio pickers are marked data-audio (iOS accept workaround)', () => {
  for (const id of ['ivAudio', 'tvAudio', 'avAudio']) assert.match(html, new RegExp(`id="${id}"[^>]*data-audio`), id);
});

test('GitHub Pages: .nojekyll present, no absolute local paths', () => {
  assert.ok(existsSync(join(ROOT, '.nojekyll')));
  assert.doesNotMatch(html, /(src|href)="\/(?!\/)/, 'root-relative paths break on project pages');
});

test('cache-busting: every local js/css carries ?v=<hash of its current content> (run `npm run stamp`)', async () => {
  const { hashOf, ASSET_RE } = await import('../../scripts/stamp.mjs');
  const tags = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="((?:js|assets)\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(tags.length >= 11, 'all local assets found');
  const stale = tags.filter((t) => { const [path, q] = t.split('?v='); return q !== hashOf(path); });
  assert.deepEqual(stale, [], 'index.html is stale: run `npm run stamp`');
  assert.ok(ASSET_RE instanceof RegExp);
});

test('CI workflow runs unit + e2e tests and gates the Pages deploy on them', () => {
  const wf = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(wf, /npm run test:unit/);
  assert.match(wf, /playwright test/);
  assert.match(wf, /needs:\s*\[?\s*test/);
});

test('local links in index.html point at files that exist (iPhone guide, …)', () => {
  const hrefs = [...html.matchAll(/<a [^>]*href="([^"#:]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.includes('Help/huong-dan-iphone.html'));
  for (const h of hrefs) assert.ok(existsSync(join(ROOT, h)), h);
});

test('iPhone guide is one self-contained file: images embedded, no external resources', () => {
  const g = readFileSync(join(ROOT, 'Help', 'huong-dan-iphone.html'), 'utf8');
  const imgs = [...g.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(imgs.length >= 12, `${imgs.length} screenshots`);
  for (const s of imgs) assert.match(s.slice(0, 30), /^data:image\/jpeg;base64,/);
  assert.doesNotMatch(g, /<(script|link)\b[^>]*(src|href)="https?:/, 'no CDN scripts / stylesheets');
  assert.match(g, /<html lang="vi">/);
  assert.match(g, /name="viewport"/);
  assert.match(g, /href="\.\.\/index\.html"/, 'links back to the app');
});

test('PROJECT RULE: when the UI changes, the iPhone guide must be regenerated (`npm run help`)', async () => {
  const { uiHash, guideHash } = await import('../../scripts/ui-hash.mjs');
  const g = guideHash();
  assert.ok(g, 'Help/huong-dan-iphone.html has no ui-hash: run `npm run help`');
  assert.equal(g, uiHash(), 'index.html / js / css changed since Help/huong-dan-iphone.html was generated → update the guide text in scripts/make-help.mjs if a feature changed, then run `npm run help`');
});

/* ---------------- security (Tech Lead review) ---------------- */
const { createHash } = require('node:crypto');
const cspMeta = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1] || '';
const csp = Object.fromEntries(cspMeta.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));

test('security: every CDN script and stylesheet is pinned with Subresource Integrity (a hacked CDN cannot swap the code)', () => {
  const tags = [...html.matchAll(/<(script|link)\b[^>]*\b(?:src|href)="(https:\/\/(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)[^"]+)"[^>]*>/g)];
  assert.ok(tags.length >= 6, 'CDN tags found');
  for (const [tag, , url] of tags) {
    assert.match(tag, /integrity="sha(256|384|512)-[A-Za-z0-9+/=]+"/, url);
    assert.match(tag, /crossorigin="anonymous"/, url);
    assert.match(url, /@\d+\.\d+\.\d+|\/\d+\.\d+\.\d+\//, `${url}: pinned version`);
  }
});

test('security: dynamically imported modules (Mediabunny, AAC encoder) have integrity in the import map', () => {
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  const engine = readFileSync(join(ROOT, 'js', 'video-engine.js'), 'utf8');
  const aac = engine.match(/AAC_ENCODER_URL = '([^']+)'/)[1];
  for (const url of [map.imports.mediabunny, aac]) assert.match(map.integrity[url] || '', /^sha384-/, url);
});

test('security: CSP is the first thing in <head> and only allows our CDNs (files can never be sent elsewhere)', () => {
  assert.ok(cspMeta, 'CSP meta present');
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<link'), 'CSP before any resource');
  assert.deepEqual(csp['default-src'], ["'self'"]);
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['base-uri'], ["'none'"]);
  assert.deepEqual(csp['form-action'], ["'none'"]);
  // where data could leave the page: nowhere but this site (fetch / XHR / beacons / images / media)
  for (const d of ['connect-src', 'img-src', 'media-src']) {
    for (const v of csp[d]) assert.ok(/^'self'$|^(blob|data):$/.test(v), `${d} must not allow another host: ${v}`);
  }
  // code: only the exact pinned library folders (anyone can publish other files on these CDNs)
  for (const v of csp['script-src']) assert.ok(/^'/.test(v) || /^https:\/\/(cdn\.jsdelivr\.net\/npm|cdnjs\.cloudflare\.com\/ajax\/libs)\/.+@?\d+\.\d+\.\d+\/$/.test(v), `script-src too wide: ${v}`);
  assert.ok(!csp['script-src'].includes("'unsafe-inline'"), 'no inline scripts allowed');
  // …and every library the page loads is inside one of them (else it would be blocked)
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  const engine = readFileSync(join(ROOT, 'js', 'video-engine.js'), 'utf8');
  const urls = [...html.matchAll(/<script src="(https:[^"]+)"/g)].map((m) => m[1]).concat(Object.values(map.imports), engine.match(/AAC_ENCODER_URL = '([^']+)'/)[1]);
  for (const u of urls) assert.ok(csp['script-src'].some((p) => p.startsWith('https://') && u.startsWith(p)), `not allowed by script-src: ${u}`);
});

test('security: the CSP hash matches the inline import map (else Mediabunny would be blocked)', () => {
  const body = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
  const h = createHash('sha256').update(body).digest('base64');
  assert.ok(csp['script-src'].includes(`'sha256-${h}'`), 'update the sha256 in the CSP after editing the import map');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)].filter((m) => !/type="importmap"/.test(m[1]));
  assert.deepEqual(inline, [], 'no other inline <script>');
  assert.doesNotMatch(html, /\son[a-z]+="/i, 'no inline event handlers');
});

test('security: no referrer leaks to the CDNs, external links open with rel="noopener"', () => {
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  for (const [a] of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) assert.match(a, /rel="noopener"/, a);
});

test('security: user text never goes into innerHTML in the new creator tools', () => {
  const src = readFileSync(join(ROOT, 'js', 'creator.js'), 'utf8');
  // the only template literals in innerHTML are static markup + an object URL; names/titles use textContent
  for (const m of src.matchAll(/innerHTML\s*=\s*`([\s\S]*?)`/g)) assert.doesNotMatch(m[1], /\$\{(?!url\}|canShareFiles \?)/, m[1].slice(0, 60));
});
