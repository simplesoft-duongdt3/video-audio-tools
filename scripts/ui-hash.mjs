// Fingerprint of everything users see (page, scripts, styles). The iPhone guide stores the fingerprint it was
// generated from; a unit test fails when the UI changed but `npm run help` was not run (project rule).
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function uiHash() {
  const h = createHash('sha1');
  // ?v= cache-busting stamps change with every file edit; the files themselves are hashed below
  h.update(readFileSync(join(ROOT, 'index.html'), 'utf8').replace(/\?v=[0-9a-f]+/g, ''));
  for (const f of readdirSync(join(ROOT, 'js')).filter((n) => n.endsWith('.js')).sort()) h.update(f + '\0' + readFileSync(join(ROOT, 'js', f)));
  h.update(readFileSync(join(ROOT, 'assets', 'style.css')));
  return h.digest('hex').slice(0, 12);
}

/** Fingerprint recorded in the guide, or null. */
export function guideHash() {
  try {
    const g = readFileSync(join(ROOT, 'Help', 'huong-dan-iphone.html'), 'utf8');
    const m = g.match(/<meta name="ui-hash" content="([0-9a-f]+)">/);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(uiHash(), guideHash());
