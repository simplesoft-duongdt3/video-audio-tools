#!/usr/bin/env node
// Cache-busting for GitHub Pages (no build step): adds ?v=<content hash> to every local <script>/<link>
// in index.html, so a returning visitor never runs old JS/CSS against new HTML.
// Run after editing js/ or assets/:  npm run stamp      (a unit test fails if you forget)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const hashOf = (rel) => createHash('sha1').update(readFileSync(join(ROOT, rel))).digest('hex').slice(0, 10);
export const ASSET_RE = /(<(?:script|link)\b[^>]*\b(?:src|href)=")((?:js|assets)\/[^"?]+)(?:\?v=[^"]*)?(")/g;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = join(ROOT, 'index.html');
  const html = readFileSync(file, 'utf8');
  let n = 0;
  const out = html.replace(ASSET_RE, (_, a, path, z) => { n++; return `${a}${path}?v=${hashOf(path)}${z}`; });
  if (out !== html) writeFileSync(file, out);
  console.log(`stamped ${n} assets${out === html ? ' (no change)' : ''}`);
}
