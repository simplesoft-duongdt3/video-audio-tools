#!/usr/bin/env node
// Builds Help/huong-dan-iphone.html: a Vietnamese, mobile-first user guide for iPhone, ONE self-contained file
// (screenshots embedded as base64 JPEG). Screenshots are taken from the real site in an iPhone 15 viewport with
// an iPhone user agent, so the iPhone-only hints appear exactly as users see them.
// Run after UI changes:  npm run help      (needs Google Chrome + network for fonts / CDN libraries)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { uiHash } from './ui-hash.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium, devices } = require('@playwright/test');
const PORT = 8792;
const URL = `http://127.0.0.1:${PORT}/index.html`;

/** A ~20 s music-like WAV (chords + beat) so the waveform in screenshots looks like a real song. */
function demoSong(seconds = 20, sr = 22050) {
  const n = seconds * sr, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  const chords = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
  for (let i = 0; i < n; i++) {
    const t = i / sr, bar = Math.floor(t / 2) % 4, beat = t % 0.5;
    const env = 0.35 + 0.65 * Math.exp(-beat * 6);
    const swell = 0.6 + 0.4 * Math.sin((t / seconds) * Math.PI * 3);
    let v = 0;
    for (const f of chords[bar]) v += Math.sin(2 * Math.PI * f * t);
    v = (v / 3) * env * swell * 0.55 + (beat < 0.04 ? (Math.random() - 0.5) * 0.5 : 0);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 24000))), 44 + i * 2);
  }
  return { name: 'nhac-cua-toi.wav', mimeType: 'audio/wav', buffer: buf };
}

/** A voice note with silence at the start, a long pause and silence at the end (for the silence-removal step). */
function voiceNote(sr = 22050) {
  const parts = [[1.5, 0], [4, 1], [2.5, 0], [5, 1], [0.4, 0], [3, 1], [1.2, 0]];
  const n = parts.reduce((t, [d]) => t + Math.round(d * sr), 0), buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  let o = 0;
  for (const [d, on] of parts) {
    const m = Math.round(d * sr);
    for (let i = 0; i < m; i++) {
      const t = i / sr, syll = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 3.3); // speech-like loudness
      const v = on ? syll * (Math.sin(2 * Math.PI * 180 * t) * 0.6 + Math.sin(2 * Math.PI * 360 * t) * 0.3) : 0;
      buf.writeInt16LE(Math.round(v * 20000), 44 + (o + i) * 2);
    }
    o += m;
  }
  return { name: 'ghi-am.wav', mimeType: 'audio/wav', buffer: buf };
}

/** Pleasant demo photos drawn in the page (sunset, sea, mountains) → File objects in an <input type=file>. */
async function demoPhotos(page, inputId) {
  await page.evaluate(async (inputId) => {
    const scenes = [
      ['#ff9a8b', '#ff6a88', '#fbd786', '#2d3a4b'],
      ['#56ccf2', '#a1e3ff', '#f6e7b4', '#1e6f8f'],
      ['#7f7fd5', '#86a8e7', '#c7ecee', '#3b5249'],
    ];
    const dt = new DataTransfer();
    for (const [i, [a, b, sun, land]] of scenes.entries()) {
      const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
      const x = c.getContext('2d');
      let g = x.createLinearGradient(0, 0, 0, 800); g.addColorStop(0, a); g.addColorStop(1, b);
      x.fillStyle = g; x.fillRect(0, 0, 900, 1200);
      x.fillStyle = sun; x.beginPath(); x.arc(600 - i * 120, 520, 110, 0, Math.PI * 2); x.fill();
      x.fillStyle = land; x.beginPath(); x.moveTo(0, 820);
      for (let k = 0; k <= 9; k++) x.lineTo(k * 100, 760 + Math.sin(k * 1.3 + i) * 90);
      x.lineTo(900, 1200); x.lineTo(0, 1200); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.18)'; for (let k = 0; k < 14; k++) x.fillRect(80 + k * 55, 980 + (k % 4) * 40, 36, 4);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      dt.items.add(new File([blob], `anh-${i + 1}.jpg`, { type: 'image/jpeg' }));
    }
    const el = document.getElementById(inputId);
    el.files = dt.files;
    el.dispatchEvent(new Event('change'));
  }, inputId);
}

/** Numbered yellow rings around elements, removed after the screenshot. */
async function mark(page, items) {
  return page.evaluate((items) => {
    const off = [];
    // sticky things that can hide an element: the tab bar and (phones) the preview strip
    const stickies = [document.getElementById('tabs'), document.querySelector('.panel.active .split .preview')].filter(Boolean);
    const hidden = (el, r) => stickies.some((st) => {
      if (st.contains(el) || el.contains(st)) return false;
      const q = st.getBoundingClientRect();
      return r.top < q.bottom - 2 && r.bottom > q.top + 2 && getComputedStyle(st).position === 'sticky';
    });
    for (const [sel, n] of items) {
      const el = document.querySelector(sel);
      if (!el) { off.push(`${n}: ${sel} (missing)`); continue; }
      const r = el.getBoundingClientRect();
      if (!r.height || r.top < 0 || r.bottom > innerHeight + 2 || hidden(el, r)) off.push(`${n}: ${sel} (${Math.round(r.top)}..${Math.round(r.bottom)} of ${innerHeight})`);
      const ring = document.createElement('div');
      ring.className = '__mark';
      ring.style.cssText = `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:3px solid #ffd400;border-radius:12px;z-index:9999;pointer-events:none;box-shadow:0 0 0 3px rgba(0,0,0,.35)`;
      const badge = document.createElement('div');
      badge.className = '__mark';
      badge.textContent = n;
      badge.style.cssText = `position:fixed;left:${Math.max(2, r.left - 14)}px;top:${Math.max(2, r.top - 14)}px;width:26px;height:26px;border-radius:50%;background:#ffd400;color:#000;font:800 15px/26px sans-serif;text-align:center;z-index:10000;pointer-events:none`;
      document.body.append(ring, badge);
    }
    return off;
  }, items);
}
const unmark = (page) => page.evaluate(() => document.querySelectorAll('.__mark').forEach((e) => e.remove()));

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ channel: 'chrome' });
  // iPhone 15 Pro Max full screen (Safari hides its toolbars while you scroll): room for a step + its controls
  const ctx = await browser.newContext({ ...devices['iPhone 15 Pro Max'], viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  // headless Chrome can't share files: pretend it can, so the "Chia sẻ / Lưu vào Ảnh" button appears as on iPhone
  await ctx.addInitScript(() => { navigator.canShare = () => true; navigator.share = async () => {}; });
  const page = await ctx.newPage();
  const shots = {};
  const problems = [];
  const shot = async (key, marks = []) => {
    await page.waitForTimeout(250);
    if (marks.length) {
      const off = await mark(page, marks);
      if (off.length) { console.warn(`⚠️ ${key}: marked but not fully visible →`, off.join('; ')); problems.push(key); }
    }
    shots[key] = 'data:image/jpeg;base64,' + (await page.screenshot({ type: 'jpeg', quality: 72 })).toString('base64');
    await unmark(page);
  };
  const go = async (tab) => {
    await page.goto(`${URL}#${tab}`);
    await page.waitForFunction(() => typeof AudioTrim !== 'undefined' && typeof Templates !== 'undefined');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
  };
  /** Scroll so `sel` sits just below the tab bar and the sticky preview strip (their real heights). */
  const scrollTo = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    const pv = document.querySelector('.panel.active .split .preview');
    const cover = document.getElementById('tabs').offsetHeight + (pv && pv.offsetWidth > innerWidth * 0.8 ? pv.offsetHeight + 12 : 0) + 18;
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - cover);
  }, sel);
  const song = demoSong();

  // --- overview ---
  await go('imgvideo');
  await shot('overview', [['#tabs', 1], ['#tab-imgvideo .preview', 2], ['.drop[data-input=ivImages]', 3]]);

  // --- photos + music → video ---
  await demoPhotos(page, 'ivImages');
  await page.waitForSelector('#ivThumbs .t');
  await scrollTo('.drop[data-input=ivImages]');
  await shot('iv-photos', [['.drop[data-input=ivImages]', 1], ['#ivThumbs', 2]]);
  await page.setInputFiles('#ivAudio', song);
  await page.waitForSelector('#ivTrim:not([hidden])');
  await page.evaluate(() => { const d = document.querySelector('#tab-imgvideo details.ios-only'); if (d) d.open = true; });
  await scrollTo('.drop[data-input=ivAudio]');
  await shot('iv-music', [['.drop[data-input=ivAudio]', 1], ['#tab-imgvideo details.ios-only', 2]]);
  await page.evaluate(() => { const d = document.querySelector('#tab-imgvideo details.ios-only'); if (d) d.open = false; });
  await page.click('#ivTemplates [data-tpl=polaroid]');
  await page.fill('#ivTitle', 'Đà Lạt 2026');
  await page.waitForTimeout(400);
  await scrollTo('#ivTemplates');
  await shot('iv-template', [['#ivTemplates .templates', 1], ['#ivTitle', 2]]);
  // the exact-seconds fields live in the collapsed "Nâng cao" section: set them directly, as the trimmer does
  await page.evaluate(() => {
    for (const [id, v] of [['ivDur', '12'], ['ivStart', '4']]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await scrollTo('#ivTrim');
  await shot('iv-trim', [['#ivTrim .trim-wave', 1], ['#ivTrim [data-a=play]', 2]]);
  await page.evaluate(() => { const el = document.getElementById('ivDur'); el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await scrollTo('#ivRender');
  await shot('iv-export', [['#ivPlay', 1], ['#ivRender', 2], ['#tab-imgvideo [data-role=estimate]', 3]]);
  await page.click('#ivRender');
  await page.waitForSelector('#ivOut video', { timeout: 120000 });
  await page.waitForTimeout(1200);
  await shot('iv-done', [['#ivOut [data-a=share]', 1], ['#ivOut [data-a=dl]', 2]]);

  // --- text + music → video ---
  await go('textvideo');
  await scrollTo('#tvTemplates');
  await shot('tv-text', [['#tvTemplates .chips', 1], ['#tvTemplates .templates', 2]]);
  await page.click('#tvTemplates [data-tpl=romance]');
  await page.locator('#tvScrub').evaluate((el) => { el.value = 1; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await scrollTo('.drop[data-input=tvAudio]');
  await shot('tv-options', [['.drop[data-input=tvAudio]', 1], ['#tvRender', 2], ['#tvLoud', 3]]);

  // --- music → video ---
  await go('audiovideo');
  await page.setInputFiles('#avAudio', song);
  await page.waitForSelector('#avTrim:not([hidden])');
  await page.fill('#avTitle', 'Chiều mưa Sài Gòn');
  await page.fill('#avSub', '@kenh.cua.ban');
  await page.click('#avTemplates .chips button:text-is("Sách & Thơ")');
  await page.click('#avTemplates [data-tpl=sachnoi]');
  await page.fill('#avTitle', 'Đắc Nhân Tâm');
  await page.fill('#avSub', 'Chương 1 · Dale Carnegie');
  await page.waitForTimeout(600);
  await scrollTo('#avTemplates');
  await shot('av-template', [['#avTemplates .chips', 1], ['#avTemplates .templates', 2]]);
  await scrollTo('#avTitle');
  await shot('av-text', [['#avTitle', 1], ['#avSub', 2], ['#avBadge', 3]]);
  await page.click('#avPalettes [data-pal=tra-sua]');
  await page.waitForTimeout(400);
  await scrollTo('#avPalettes');
  await shot('av-colors', [['#avPalettes .chips', 1], ['#avPalettes .pal-row', 2]]);
  await page.click('#avTemplates .chips button:text-is("Tất cả")');
  await page.click('#avTemplates [data-tpl=vinyl]');
  await page.fill('#avTitle', 'Chiều mưa Sài Gòn');
  await page.fill('#avSub', '@kenh.cua.ban');
  await page.waitForTimeout(400);
  await scrollTo('#avStyle');
  await shot('av-style', [['#avStyle', 1], ['#avBgMode', 2]]);
  await page.check('#avDust');
  await page.selectOption('#avDustShape', 'petal');
  await page.selectOption('#avDustDir', 'down');
  await page.check('#avPunch');
  await page.waitForTimeout(300);
  await scrollTo('#avFx');
  await shot('av-fx', [['#avFx .fx:nth-child(1)', 1], ['#avFx .fx:nth-child(2)', 2]]);
  await scrollTo('.drop[data-input=avImg]');
  await shot('av-cover', [['.drop[data-input=avImg]', 1], ['#avTrim .trim-wave', 2]]);

  // --- remove silences (voice recording with pauses) ---
  await page.setInputFiles('#avAudio', voiceNote());
  await page.waitForSelector('#avTrim:not([hidden])');
  await page.click('#avTrim [data-a=scan]');
  await page.waitForSelector('#avTrim .sil-res:not([hidden])');
  await scrollTo('#avTrim .trim-wave');
  await shot('silence', [['#avTrim .trim-wave', 1], ['#avTrim .sil-list', 2], ['#avTrim [data-a=cut]', 3]]);
  await page.setInputFiles('#avAudio', song);
  await page.waitForTimeout(300);

  // --- my templates ---
  page.once('dialog', (d) => d.accept('Kênh của tôi'));
  await page.click('#avTemplates [data-role=save-template]');
  await page.waitForTimeout(300);
  await scrollTo('#avTemplates');
  await shot('mine', [['#avTemplates [data-role=save-template]', 1], ['#avTemplates .tcard:has([data-tpl^="my-"])', 2]]);

  // --- loudness + safe zones (Audio → Video) ---
  await go('audiovideo');
  await page.setInputFiles('#avAudio', song);
  await page.waitForSelector('#avTrim:not([hidden])');
  await page.waitForFunction(() => /LUFS/.test(document.getElementById('avLoudInfo').textContent));
  await scrollTo('#avLoud');
  await shot('loud', [['#avLoud', 1], ['#avLoudInfo', 2]]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#tab-audiovideo .sz-chips button[data-sz=tiktok]');
  await page.waitForTimeout(300);
  await shot('safezone', [['#tab-audiovideo .sz-chips', 1], ['#tab-audiovideo .sz-safe', 2]]);
  await page.click('#tab-audiovideo .sz-chips button[data-sz=off]');

  // --- thumbnail + caption ---
  await go('thumb');
  await demoPhotos(page, 'thImg');
  await page.waitForFunction(() => /anh-1/.test(document.getElementById('thImgInfo').textContent));
  await page.fill('#thTitle', 'Đà Lạt *3 ngày 2 đêm* chỉ 2 triệu');
  await page.fill('#thBadge', 'MỚI');
  await page.waitForTimeout(400);
  await scrollTo('#thStyles');
  await shot('thumb', [['#thStyles', 1], ['#thTitle', 2]]);
  await page.click('#thExport');
  await page.waitForSelector('#thOut .card');
  await scrollTo('#thExport');
  await shot('thumb-done', [['#thExport', 1], ['#thOut .card', 2]]);
  await page.fill('#thCaption', 'Review Đà Lạt 3 ngày 2 đêm chỉ 2 triệu 🌲 Lưu lại cho chuyến đi tới nhé! #dalat #dulich #reviewdulich');
  await scrollTo('#thCaption');
  await shot('caption', [['#thCaption', 1], ['#thCounts', 2]]);

  // --- extract audio ---
  await go('extract');
  await page.setInputFiles('#exFile', song);
  await page.waitForSelector('#exTrim:not([hidden])');
  await page.waitForFunction(() => /LUFS/.test(document.getElementById('exLoudInfo').textContent));
  await scrollTo('.drop[data-input=exFile]');
  await shot('extract', [['.drop[data-input=exFile]', 1], ['#exTrim .trim-wave', 2], ['#exLoud', 3], ['#exRun', 4]]);

  // --- photo tools ---
  await go('convert');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('convert', [['.drop[data-input=convFiles]', 1], ['#tab-convert select', 2]]);
  await go('edit');
  await demoPhotos(page, 'edFile');
  await page.waitForTimeout(1200);
  await page.click('#edRatios [data-r="0.5625"]');
  await page.waitForTimeout(400);
  await shot('edit', [['#edRatios', 1], ['#edExport', 2]]);

  // --- help pages ---
  await go('about');
  await shot('about');
  await page.goto(`${URL}#selftest`);
  await page.waitForSelector('#stOut[data-done]', { timeout: 120000 }).catch(() => {});
  await page.waitForFunction(() => /pass|fail/.test(document.getElementById('stOut').dataset.done || ''), null, { timeout: 120000 }).catch(() => {});
  await shot('selftest', [['#stCopy', 1]]);

  await browser.close();
  server.kill();
  if (problems.length) { console.error('Screenshots with hidden marks:', problems.join(', ')); process.exitCode = 1; }

  mkdirSync(join(ROOT, 'Help'), { recursive: true });
  const out = join(ROOT, 'Help', 'huong-dan-iphone.html');
  writeFileSync(out, page_(shots));
  console.log('wrote', out, Math.round(Buffer.byteLength(page_(shots)) / 1024) + ' KB', Object.keys(shots).length + ' screenshots');
}

const fig = (src, alt) => `<figure><img src="${src}" alt="${alt}" loading="lazy" width="430" height="932"><figcaption>${alt}</figcaption></figure>`;

function page_(s) {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="ui-hash" content="${uiHash()}">
<title>Hướng dẫn dùng Media Toolbox trên iPhone</title>
<meta name="description" content="Hướng dẫn từng bước làm video TikTok / Reels từ ảnh, chữ và nhạc ngay trên iPhone với Media Toolbox.">
<style>
  :root { --bg:#0e0f13; --panel:#171920; --line:#2c303b; --text:#e9eaee; --muted:#a3a9b6; --accent:#fe2c55; --accent2:#25f4ee; --warn:#ffcf66; }
  @media (prefers-color-scheme: light) { :root { --bg:#f6f6f8; --panel:#fff; --line:#e1e3e8; --text:#17181c; --muted:#5b6170; --warn:#8a5a00; } }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.6 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; padding: env(safe-area-inset-top) 0 calc(24px + env(safe-area-inset-bottom)); }
  header { padding: 20px 16px 8px; max-width: 720px; margin: 0 auto; }
  h1 { font-size: 1.55rem; line-height: 1.25; margin: 0 0 6px; }
  .lead { color: var(--muted); margin: 0 0 14px; }
  .open { display: block; text-align: center; background: var(--accent); color: #fff; text-decoration: none; font-weight: 700; padding: 14px; border-radius: 14px; min-height: 48px; }
  nav.toc { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); overflow-x: auto; white-space: nowrap; padding: 8px 12px; scrollbar-width: none; }
  nav.toc::-webkit-scrollbar { display: none; }
  nav.toc a { display: inline-block; color: var(--text); text-decoration: none; padding: 10px 12px; margin-right: 4px; border: 1px solid var(--line); border-radius: 999px; font-size: 0.9rem; min-height: 44px; }
  main { max-width: 720px; margin: 0 auto; padding: 0 16px; }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin: 16px 0; scroll-margin-top: 70px; }
  h2 { font-size: 1.25rem; margin: 0 0 10px; }
  h3 { font-size: 1.05rem; margin: 18px 0 6px; }
  ol, ul { padding-left: 1.3em; margin: 8px 0; }
  li { margin: 6px 0; }
  .n { display: inline-block; min-width: 22px; height: 22px; border-radius: 50%; background: #ffd400; color: #000; font-weight: 800; font-size: 13px; line-height: 22px; text-align: center; margin-right: 4px; }
  figure { margin: 12px auto; max-width: 340px; }
  figure img { display: block; width: 100%; height: auto; border-radius: 22px; border: 1px solid var(--line); box-shadow: 0 6px 24px rgba(0,0,0,.35); background: #000; }
  figcaption { color: var(--muted); font-size: 0.85rem; text-align: center; margin-top: 6px; }
  .tip, .warn { border-radius: 12px; padding: 10px 12px; margin: 10px 0; font-size: 0.95rem; }
  .tip { background: rgba(37,244,238,.1); border: 1px solid rgba(37,244,238,.35); }
  .warn { background: rgba(255,207,102,.1); border: 1px solid rgba(255,207,102,.4); color: var(--text); }
  details { border: 1px solid var(--line); border-radius: 12px; padding: 0 12px; margin: 8px 0; }
  summary { min-height: 48px; display: flex; align-items: center; font-weight: 600; cursor: pointer; }
  details[open] { padding-bottom: 10px; }
  kbd { font: inherit; font-weight: 700; background: rgba(127,127,127,.18); border-radius: 6px; padding: 1px 6px; }
  a { color: var(--accent2); }
  @media (prefers-color-scheme: light) { a { color: #0a7f86; } }
  footer { text-align: center; color: var(--muted); font-size: 0.85rem; padding: 10px 16px; }
  @media (min-width: 760px) { .two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; } }
</style>
</head>
<body>
<header>
  <h1>📱 Hướng dẫn dùng Media Toolbox trên iPhone</h1>
  <p class="lead">Làm video TikTok / Reels / Shorts từ <b>ảnh</b>, <b>chữ</b> và <b>nhạc</b> ngay trên Safari — miễn phí, không cần cài app, ảnh và nhạc của bạn không bị tải lên đâu cả.</p>
  <a class="open" href="../index.html">Mở Media Toolbox ↗</a>
</header>

<nav class="toc" aria-label="Mục lục">
  <a href="#bat-dau">1. Bắt đầu</a><a href="#nhac">2. Chuẩn bị nhạc</a><a href="#anh-video">3. Ảnh + nhạc</a><a href="#chu-video">4. Chữ + nhạc</a><a href="#nhac-video">5. Chỉ có nhạc</a><a href="#am-luong">6. Âm lượng &amp; vùng bị che</a><a href="#anh-bia">7. Ảnh bìa &amp; caption</a><a href="#tach-am">8. Tách âm thanh</a><a href="#luu">9. Lưu &amp; đăng TikTok</a><a href="#mau">10. Mẫu của tôi</a><a href="#anh">11. Sửa ảnh</a><a href="#loi">12. Gặp lỗi?</a>
</nav>

<main>
<section id="bat-dau">
  <h2>1. Bắt đầu</h2>
  <ol>
    <li>Mở trang bằng <b>Safari</b> (Chrome trên iPhone cũng dùng được).</li>
    <li>Để mở nhanh như một app: bấm nút <b>Chia sẻ</b> <kbd>⬆︎</kbd> ở thanh dưới Safari → <b>Thêm vào MH chính</b> → <b>Thêm</b>.</li>
    <li>Chọn công cụ ở thanh trên cùng <span class="n">1</span> — vuốt ngang để thấy hết 8 công cụ, xếp theo nhóm: <b>Làm video</b>, <b>Đăng bài</b> (ảnh bìa, caption, tách âm thanh), <b>Ảnh</b>. Trên máy tính, các công cụ nằm ở cột bên trái.</li>
    <li>Nút <b>Xem thử</b> / <b>Xuất video</b> luôn nằm ở đáy màn hình khi bạn cuộn xuống chỉnh — không cần cuộn tìm.</li>
    <li>Khung <b>xem trước</b> <span class="n">2</span> luôn nằm phía trên khi bạn cuộn xuống chỉnh, để thấy ngay thay đổi. Bấm <kbd>⤢</kbd> ở góc để phóng to.</li>
  </ol>
  ${fig(s.overview, 'Màn hình chính: thanh công cụ (1), xem trước (2), chọn ảnh (3)')}
  <div class="tip">💡 Khi tạo video, hãy <b>giữ màn hình mở</b> và ở lại trang cho đến khi xong. iPhone đời mới tạo video 1 phút chỉ mất vài giây đến chục giây.</div>
</section>

<section id="nhac">
  <h2>2. Chuẩn bị nhạc trên iPhone</h2>
  <p>iPhone <b>không cho trang web</b> mở bài hát trong app <b>Nhạc (Apple Music)</b>. Bạn chọn nhạc từ app <b>Tệp (Files)</b>, hoặc chọn một <b>video</b> trong app Ảnh (trang sẽ lấy tiếng của video).</p>
  <h3>Cách đưa nhạc vào app Tệp</h3>
  <ul>
    <li><b>Tải từ web:</b> mở link mp3 bằng Safari → tải về → file nằm trong <b>Tệp › Tải về</b>.</li>
    <li><b>Zalo / Messenger / Telegram:</b> giữ vào file nhạc → <b>Chia sẻ</b> → <b>Lưu vào Tệp</b>.</li>
    <li><b>Ghi âm:</b> trong app Ghi âm, bấm <kbd>•••</kbd> ở bản ghi → <b>Lưu vào Tệp</b>.</li>
    <li><b>Từ máy tính:</b> AirDrop file sang iPhone → chọn <b>Lưu vào Tệp</b>.</li>
  </ul>
  <div class="warn">⚠️ Bài hát mua / tải trong Apple Music có bản quyền (DRM) nên không dùng được. Nhạc có bản quyền đăng lên TikTok cũng có thể bị tắt tiếng — nên dùng nhạc của bạn hoặc nhạc miễn phí bản quyền.</div>
  ${fig(s['iv-music'], 'Ô chọn nhạc (1) và hướng dẫn ngay trong trang (2)')}
</section>

<section id="anh-video">
  <h2>3. Ảnh + nhạc → video</h2>
  <p>Tab <b>🖼️ Ảnh + Audio → Video</b>. Làm video slideshow từ 1 hoặc nhiều ảnh.</p>
  <div class="two">
    <div>
      <h3>Bước 1 — Chọn ảnh</h3>
      <p>Bấm <b>Chọn ảnh</b> <span class="n">1</span> → chọn nhiều ảnh trong thư viện → <b>Thêm</b>. Ảnh HEIC của iPhone dùng được luôn. Bấm <kbd>×</kbd> trên ảnh nhỏ <span class="n">2</span> để bỏ.</p>
      ${fig(s['iv-photos'], 'Chọn ảnh (1), các ảnh đã chọn (2)')}
    </div>
    <div>
      <h3>Bước 2 — Chọn mẫu và tiêu đề</h3>
      <p>Vuốt hàng <b>Mẫu</b> <span class="n">1</span> và chạm để chọn: Kỷ niệm, Du lịch, Polaroid, Điện ảnh, Đen trắng… Mẫu chỉ <b>điền sẵn cài đặt</b> — bạn vẫn đổi được mọi thứ. Gõ <b>Tiêu đề</b> <span class="n">2</span> nếu muốn có chữ trên video.</p>
      ${fig(s['iv-template'], 'Hàng mẫu (1) và tiêu đề (2)')}
    </div>
  </div>
  <h3>Bước 3 — Chọn đoạn nhạc</h3>
  <p>Sau khi chọn nhạc, sóng nhạc hiện ra <span class="n">1</span>: <b>kéo 2 tay cầm</b> để chọn đoạn, hoặc <b>chạm</b> vào chỗ khác để dời đoạn tới đó. Bấm <b>Nghe đoạn này</b> <span class="n">2</span> để nghe thử.</p>
  ${fig(s['iv-trim'], 'Chọn đoạn nhạc bằng sóng nhạc (1), nghe thử (2)')}
  <h3>Bước 4 — Xem thử và tạo video</h3>
  <p>Bấm <b>Xem thử</b> <span class="n">1</span> để xem kèm nhạc, rồi <b>Xuất video</b> <span class="n">2</span>. Dòng <b>Ước tính</b> <span class="n">3</span> cho biết dung lượng và thời gian. Đang xuất có thể bấm <b>Huỷ</b>.</p>
  ${fig(s['iv-export'], 'Xem thử (1), xuất video (2), ước tính (3)')}
</section>

<section id="chu-video">
  <h2>4. Chữ + nhạc → video</h2>
  <p>Tab <b>🔤 Text + Audio → Video</b>. Mỗi đoạn văn (cách nhau bởi <b>một dòng trống</b>) là một slide.</p>
  <ol>
    <li>Gõ hoặc dán nội dung vào ô <b>Nội dung</b> ở đầu trang.</li>
    <li>Lọc mẫu theo nhóm <span class="n">1</span> (Trích dẫn, Bài học, Tin tức, Bán hàng…) rồi vuốt hàng mẫu và chạm để chọn <span class="n">2</span>. Kéo thanh <b>Xem slide</b> dưới khung xem trước để xem từng slide.</li>
  </ol>
  ${fig(s['tv-text'], 'Nhóm mẫu (1) và hàng mẫu (2)')}
  <ol>
    <li>Chọn nhạc <span class="n">1</span> (không bắt buộc) — thời lượng nhạc được chia đều cho các slide.</li>
    <li>Chọn mức <b>Âm lượng</b> <span class="n">3</span> (xem mục 6), rồi bấm <b>Xuất video</b> <span class="n">2</span> — nút này luôn nằm ở đáy màn hình.</li>
    <li>Muốn đăng dạng ảnh (carousel): bấm <b>Tải ảnh slide này (PNG)</b> hoặc <b>Tải tất cả slide (.zip)</b> ngay dưới nút xuất.</li>
  </ol>
  ${fig(s['tv-options'], 'Chọn nhạc (1), xuất video (2), âm lượng (3)')}
</section>

<section id="nhac-video">
  <h2>5. Chỉ có nhạc → video</h2>
  <p>Tab <b>🎧 Audio → Video</b>. Biến bài hát, podcast, ghi âm thành video có sóng nhạc chuyển động.</p>
  <h3>Chọn mẫu theo thể loại</h3>
  <p>Chọn nhóm <span class="n">1</span> rồi chọn mẫu <span class="n">2</span>. Có 26 mẫu theo thể loại:</p>
  <ul>
    <li><b>Sách &amp; Thơ:</b> Sách nói (bìa sách), Bài học từ sách, Đọc thơ (nền giấy, chữ viết tay).</li>
    <li><b>Podcast &amp; Radio:</b> Podcast, Podcast sáng (dạng tin nhắn thoại), Radio đêm (● ON AIR), Bản tin, Quả cầu.</li>
    <li><b>Chữa lành &amp; Thư giãn:</b> Chữa lành, Ngủ ngon, ASMR — sóng nhạc chuyển động chậm, êm.</li>
    <li><b>Học tập:</b> Lofi học bài, Học tiếng Anh. <b>Kể chuyện:</b> Truyện ma, Bé nghe truyện. <b>Tâm linh:</b> Pháp thoại.</li>
    <li><b>Âm nhạc:</b> Neon, Đường neon, Sàn nhảy (đèn LED), Đĩa than (đĩa quay), Lo-fi, Karaoke…</li>
  </ul>
  ${fig(s['av-template'], 'Nhóm thể loại (1) và mẫu (2)')}
  <p>Gõ <b>Tên bài</b> <span class="n">1</span> và <b>dòng phụ</b> <span class="n">2</span> (ô trống sẽ gợi ý theo thể loại, ví dụ “Chương 1 · Tên tác giả”). <b>Nhãn trên cùng</b> <span class="n">3</span> như “SÁCH NÓI”, “TẬP 12” được điền sẵn theo mẫu — sửa hoặc xoá tuỳ ý.</p>
  ${fig(s['av-text'], 'Tên bài (1), dòng phụ (2), nhãn trên cùng (3)')}
  <h3>Chọn bộ màu</h3>
  <p>Không cần biết mã màu: chọn tâm trạng <span class="n">1</span> (Tối, Sáng &amp; Pastel, Rực rỡ, Lễ hội) rồi chạm vào một <b>bộ màu</b> <span class="n">2</span> như Trà sữa, Bạc hà, Đêm Sài Gòn, Tết… Bộ màu chỉ đổi màu, giữ nguyên kiểu của mẫu, và luôn đảm bảo chữ dễ đọc. Muốn tự chọn mã màu thì mở <b>Tự chọn mã màu</b>.</p>
  ${fig(s['av-colors'], 'Tâm trạng (1) và bộ màu (2)')}
  <h3>Sóng nhạc, nền, ảnh bìa, đoạn nhạc</h3>
  <p>Đổi <b>kiểu sóng nhạc</b> <span class="n">1</span> — có 12 kiểu, gồm các kiểu đang thịnh hành:</p>
  <ul>
    <li><b>Đường neon</b> (đường phát sáng), <b>Đèn LED</b> (lưới đèn kiểu dàn âm thanh), <b>Cột phổ</b> / <b>Cột đối xứng</b> — hợp nhạc sôi động.</li>
    <li><b>Đĩa quay</b> — đĩa than quay, ảnh bìa nằm giữa đĩa. <b>Vòng tròn</b> — tia sáng quanh ảnh bìa.</li>
    <li><b>Tin nhắn thoại</b> — các vạch như tin nhắn giọng nói, hợp podcast, sách nói, bài giảng.</li>
    <li><b>Sóng mềm nhiều lớp</b> và <b>Quả cầu</b> — chuyển động êm, hợp chữa lành, thiền, ASMR.</li>
    <li><b>Sóng âm</b>, <b>Dạng sóng cả bài</b> (sóng của cả bài, tô màu dần khi phát).</li>
  </ul>
  <p>Chọn kiểu <b>nền</b> <span class="n">2</span> (chuyển màu, một màu, hoặc ảnh bìa làm nền mờ).</p>
  ${fig(s['av-style'], 'Kiểu sóng nhạc (1) và nền (2)')}
  <h3>Hiệu ứng theo nhạc</h3>
  <p>Bật hiệu ứng nào thì phần <b>tuỳ chỉnh</b> của hiệu ứng đó hiện ra ngay bên dưới. Mẫu đã bật sẵn hiệu ứng hợp thể loại (ví dụ Đọc thơ có cánh hoa rơi, Ngủ ngon có tuyết, ASMR có bong bóng).</p>
  <ul>
    <li><b>✨ Hạt bay theo nhịp</b> <span class="n">1</span>: chọn <b>kiểu hạt</b> (đốm sáng, bông tuyết, cánh hoa, trái tim, ngôi sao, nốt nhạc, bong bóng), <b>số lượng</b>, <b>hướng bay</b> (trôi, bay lên, rơi xuống, toả từ giữa), mức <b>theo nhịp trống</b> và <b>màu hạt</b>.</li>
    <li><b>💥 Nhún theo nhịp trống</b> <span class="n">2</span>: <b>mức nhún</b> (nhẹ / vừa / mạnh), <b>nhún phần</b> nào (ảnh &amp; sóng nhạc, tên bài, hoặc cả hai), <b>độ dài nhịp</b> (ngắn dứt khoát / dài mềm).</li>
    <li><b>🌊 Vòng sóng lan</b> từ ảnh bìa mỗi khi có tiếng trống. <b>🎐 Lắc lư nhẹ</b> ảnh bìa theo nhạc. <b>🎞️ Nền chuyển động chậm</b> (đẹp nhất khi dùng ảnh bìa làm nền). <b>🌈 Màu sóng chảy dần</b> giữa hai màu.</li>
  </ul>
  <div class="tip">💡 Mọi hiệu ứng chỉ là <b>chuyển động</b>, không nhấp nháy sáng–tối — an toàn cho người nhạy cảm với ánh sáng. Bản xem thử và video xuất ra giống hệt nhau.</div>
  ${fig(s['av-fx'], 'Hạt bay với tuỳ chỉnh (1) và Nhún theo nhịp (2)')}
  <p>Thêm <b>ảnh bìa</b> <span class="n">1</span> (không bắt buộc — mẫu Sách nói hiện ảnh thành bìa sách). Chọn <b>đoạn nhạc</b> <span class="n">2</span> — bài dài trên 5 phút nên chọn đoạn ngắn để iPhone không bị thiếu bộ nhớ.</p>
  ${fig(s['av-cover'], 'Ảnh bìa (1) và đoạn nhạc (2)')}
  <h3>Bỏ đoạn im lặng thừa (ghi âm, podcast, bài giảng)</h3>
  <ol>
    <li>Dưới sóng nhạc, bấm <b>✂️ Tìm đoạn im lặng thừa</b>. Các đoạn im lặng ở <b>đầu bài</b>, <b>cuối bài</b> và các <b>khoảng lặng dài</b> được tô đỏ trên sóng nhạc <span class="n">1</span>.</li>
    <li>Bỏ chọn đoạn nào bạn muốn giữ <span class="n">2</span>. Đổi <b>Độ nhạy</b> nếu muốn bỏ cả những khoảng lặng ngắn.</li>
    <li>Bấm <b>Bỏ … đoạn đã chọn</b> <span class="n">3</span> — hoặc <b>Không bỏ</b>. Trang giữ lại một nhịp ngắn quanh lời nói để nghe vẫn tự nhiên. Đổi ý thì bấm <b>↩︎ Hoàn tác</b>.</li>
  </ol>
  ${fig(s.silence, 'Đoạn im lặng tô đỏ (1), danh sách để chọn (2), nút bỏ (3)')}
  <div class="tip">💡 Không có gì bị cắt nếu bạn không bấm nút bỏ. Bài hát liền mạch thường không có đoạn im lặng nào — trang sẽ báo “Không thấy”.</div>
</section>

<section id="am-luong">
  <h2>6. Âm lượng chuẩn &amp; vùng bị che</h2>
  <h3>🔊 Âm lượng chuẩn TikTok / YouTube</h3>
  <p>Ghi âm bằng điện thoại thường <b>nhỏ hơn</b> các video khác trên TikTok. Ô <b>Âm lượng</b> <span class="n">1</span> (có ở cả 3 tab làm video và tab Tách âm thanh) tự đưa tiếng về mức chuẩn:</p>
  <ul>
    <li><b>Chuẩn TikTok / YouTube (−14 LUFS)</b> — mặc định, hợp nhạc và video ngắn.</li>
    <li><b>Podcast (−16 LUFS)</b> — hợp sách nói, podcast, bài giảng.</li>
    <li><b>Giữ nguyên như file gốc</b> — không đổi gì.</li>
  </ul>
  <p>Dòng bên dưới <span class="n">2</span> cho biết đoạn bạn chọn đang to bao nhiêu và sẽ được tăng / giảm bao nhiêu dB. Trang không bao giờ tăng tới mức làm tiếng bị rè. Nút <b>Xem thử</b> phát đúng mức âm lượng sẽ xuất.</p>
  ${fig(s.loud, 'Chọn mức âm lượng (1) và kết quả đo (2)')}
  <h3>Vùng bị che (TikTok, Reels, Shorts)</h3>
  <p>Nút thả tim, bình luận, tên kênh và caption của app che mất một phần video. Dưới khung xem trước, chọn <b>TikTok</b>, <b>Reels</b> hoặc <b>Shorts</b> <span class="n">1</span>: phần bị che được tô đỏ, khung nét đứt <span class="n">2</span> là vùng an toàn để đặt chữ quan trọng. Lớp tô chỉ để xem — <b>không có trong video</b> xuất ra.</p>
  ${fig(s.safezone, 'Chọn ứng dụng (1) và vùng an toàn (2)')}
  <div class="tip">💡 Reels che phía dưới nhiều nhất. Nếu đăng cả 3 nơi, hãy giữ chữ trong khung của <b>Reels</b>.</div>
</section>

<section id="anh-bia">
  <h2>7. Ảnh bìa (thumbnail) &amp; caption</h2>
  <p>Tab <b>🪧 Ảnh bìa &amp; caption</b>. Ảnh bìa đẹp giúp video được bấm xem nhiều hơn.</p>
  <ol>
    <li>Chọn <b>ảnh nền</b> — hoặc chọn một <b>video</b> rồi kéo thanh <b>Khung hình trong video</b> để lấy khoảnh khắc đẹp nhất.</li>
    <li>Chọn <b>Khung</b>: YouTube 16:9 (có bản 4K), bìa TikTok / Shorts / Reels 9:16, Instagram 4:5, vuông.</li>
    <li>Chọn <b>kiểu chữ</b> <span class="n">1</span>: Nổi bật, Tin nóng, Tối giản, Sang trọng, Dễ thương.</li>
    <li>Gõ <b>tiêu đề</b> <span class="n">2</span>. Đặt từ khoá trong <b>*dấu sao*</b> để tô màu nổi bật, ví dụ <kbd>Đà Lạt *3 ngày 2 đêm*</kbd>. Có thể thêm dòng phụ và nhãn góc như “MỚI”, “PHẦN 2”.</li>
  </ol>
  ${fig(s.thumb, 'Kiểu chữ (1) và tiêu đề có từ khoá tô màu (2)')}
  <p>Bấm <b>Tạo ảnh bìa</b> <span class="n">1</span> rồi <b>Tải</b> hoặc <b>Chia sẻ</b> <span class="n">2</span>. Ảnh JPG được giữ <b>dưới 2 MB</b> (chọn ≤ 50 MB nếu chỉ đăng YouTube). Bìa 9:16 tự đặt chữ trong vùng không bị nút của app che.</p>
  ${fig(s['thumb-done'], 'Tạo ảnh bìa (1) và ảnh đã xong (2)')}
  <h3>📝 Kiểm tra tiêu đề / caption</h3>
  <p>Dán tiêu đề hoặc caption vào ô <span class="n">1</span>: trang đếm ký tự (emoji tính là 1) so với giới hạn của YouTube (tiêu đề 100, mô tả 5.000), TikTok (4.000), Reels (2.200), đếm hashtag và cảnh báo khi dùng quá nhiều <span class="n">2</span>.</p>
  ${fig(s.caption, 'Ô caption (1) và kết quả kiểm tra (2)')}
</section>

<section id="tach-am">
  <h2>8. Tách âm thanh từ video</h2>
  <p>Tab <b>🎵 Tách âm thanh</b>: lấy nhạc / giọng nói từ video trong app Ảnh, hoặc cắt một đoạn bài hát.</p>
  <ol>
    <li>Chọn video hoặc audio <span class="n">1</span>.</li>
    <li>Kéo 2 tay cầm trên sóng nhạc <span class="n">2</span> để chọn đoạn (có cả <b>✂️ Tìm đoạn im lặng thừa</b>).</li>
    <li>Chọn mức <b>Âm lượng</b> <span class="n">3</span> và định dạng: <b>M4A</b> (nhỏ, nghe được trên iPhone) hoặc <b>WAV</b> (nguyên chất lượng).</li>
    <li>Bấm <b>Tách &amp; lưu âm thanh</b> <span class="n">4</span>, nghe thử rồi tải hoặc chia sẻ.</li>
  </ol>
  ${fig(s.extract, 'Chọn file (1), chọn đoạn (2), âm lượng (3), tách (4)')}
</section>

<section id="luu">
  <h2>9. Lưu video vào Ảnh &amp; đăng TikTok</h2>
  ${fig(s['iv-done'], 'Video đã xong: Chia sẻ / Lưu vào Ảnh (1) hoặc Tải video (2)')}
  <ol>
    <li>Khi video xong, trang tự cuộn tới kết quả. Bấm <b>Chia sẻ / Lưu vào Ảnh</b> <span class="n">1</span> → chọn <b>Lưu video</b> — video vào thẳng app Ảnh.</li>
    <li>Hoặc chọn <b>TikTok</b> trong bảng chia sẻ để đăng luôn.</li>
    <li>Nút <b>Tải video</b> <span class="n">2</span> lưu vào <b>Tệp › Tải về</b>.</li>
  </ol>
  <div class="tip">💡 <b>Lưu video</b> qua nút Chia sẻ ổn định hơn nút Tải với video dài. Trên iPhone, video tự được giữ dưới 80 MB để Safari lưu được.</div>
</section>

<section id="mau">
  <h2>10. Mẫu của tôi</h2>
  <p>Đã chỉnh màu, font, @kênh vừa ý? Bấm <b>＋ Lưu thành mẫu của tôi</b> <span class="n">1</span>, đặt tên. Lần sau chỉ cần chạm vào mẫu đó <span class="n">2</span> (nhóm <b>Mẫu của tôi</b>). Bấm <kbd>×</kbd> để xoá.</p>
  ${fig(s.mine, 'Lưu mẫu (1), mẫu đã lưu (2)')}
  <div class="warn">Mẫu được lưu trong Safari trên chính iPhone này. Nếu xoá dữ liệu Safari hoặc lâu không mở trang, mẫu có thể mất. Thêm trang vào Màn hình chính giúp giữ lâu hơn.</div>
</section>

<section id="anh">
  <h2>11. Sửa ảnh</h2>
  <div class="two">
    <div>
      <h3>Chuyển định dạng &amp; nén</h3>
      <p>Tab <b>🔁 Chuyển định dạng</b>: chọn nhiều ảnh <span class="n">1</span> (kể cả HEIC) → chọn định dạng <span class="n">2</span> (JPG, PNG, WebP) → tải từng ảnh hoặc cả .zip. Tab <b>🗜️ Nén ảnh</b> giảm dung lượng để gửi Zalo, email.</p>
      ${fig(s.convert, 'Chọn ảnh (1) và định dạng (2)')}
    </div>
    <div>
      <h3>Cắt &amp; đổi kích thước</h3>
      <p>Tab <b>✂️ Cắt &amp; Resize</b>: chọn ảnh, chọn tỉ lệ <span class="n">1</span> (9:16 cho TikTok, 1:1, 4:5…), kéo khung cắt, xoay / lật rồi bấm <b>Xuất &amp; tải ảnh</b> <span class="n">2</span>.</p>
      ${fig(s.edit, 'Tỉ lệ khung (1) và nút xuất (2)')}
    </div>
  </div>
</section>

<section id="loi">
  <h2>12. Gặp lỗi?</h2>
  <details><summary>Không chọn được bài hát</summary><p>Xem mục <a href="#nhac">2. Chuẩn bị nhạc</a>: lưu bài vào app Tệp trước. Bài trong Apple Music không dùng được.</p></details>
  <details><summary>Video tải về không có tiếng</summary><p>Video luôn được xuất với âm thanh AAC (nghe được trên mọi app). Kiểm tra nút gạt im lặng của iPhone. Nếu vẫn không có tiếng, chạy <b>Tự kiểm tra thiết bị</b> bên dưới và gửi kết quả cho chúng tôi.</p></details>
  <details><summary>Báo "Không tải được" / "Failed to download"</summary><p>Dùng <b>Chia sẻ → Lưu video</b> thay vì nút Tải. Với bài dài, chọn đoạn ngắn hơn hoặc khung 720p.</p></details>
  <details><summary>Trang tự tải lại / bị đóng khi đang làm</summary><p>iPhone thiếu bộ nhớ. Đóng bớt tab và app khác, chọn đoạn nhạc ngắn hơn, khung <b>9:16 nhẹ · 720p</b>, hoặc làm trên máy tính.</p></details>
  <details><summary>Xuất video lâu hoặc video bị giật</summary><p>Cập nhật iOS mới nhất (cần iOS 16.4 trở lên để xuất nhanh). Giữ màn hình mở, không chuyển app khi đang xuất.</p></details>
  <h3>Tự kiểm tra thiết bị</h3>
  <p>Ở cuối trang Media Toolbox, bấm <b>🩺 Tự kiểm tra thiết bị</b>: trang chạy thử thật các bước trên iPhone của bạn. Bấm <b>📋 Sao chép kết quả</b> <span class="n">1</span> rồi dán vào tin nhắn / góp ý gửi chúng tôi.</p>
  ${fig(s.selftest, 'Kết quả tự kiểm tra và nút sao chép (1)')}
  <h3>Quyền riêng tư</h3>
  <p>Ảnh, nhạc, video của bạn được xử lý ngay trên iPhone và <b>không bị tải lên</b> máy chủ nào. Xem chi tiết ở mục <b>🔒 Quyền riêng tư</b> cuối trang.</p>
  ${fig(s.about, 'Trang Quyền riêng tư')}
  <p><a href="https://github.com/simplesoft-duongdt3/video-audio-tools/issues/new" target="_blank" rel="noopener">💬 Gửi góp ý / báo lỗi</a></p>
</section>
</main>
<footer>Media Toolbox · <a href="../index.html">Mở công cụ</a> · Hướng dẫn được tạo tự động từ giao diện thật (npm run help)</footer>
</body>
</html>
`;
}

main().catch((e) => { console.error(e); process.exit(1); });
