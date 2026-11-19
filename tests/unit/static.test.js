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
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
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
