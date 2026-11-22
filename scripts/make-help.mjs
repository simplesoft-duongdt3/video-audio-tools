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
  await shot('tv-options', [['.drop[data-input=tvAudio]', 1], ['#tvRender', 2], ['#tvZip', 3]]);

  // --- music → video ---
  await go('audiovideo');
  await page.setInputFiles('#avAudio', song);
  await page.waitForSelector('#avTrim:not([hidden])');
  await page.fill('#avTitle', 'Chiều mưa Sài Gòn');
  await page.fill('#avSub', '@kenh.cua.ban');
  await page.click('#avTemplates [data-tpl=vinyl]');
  await page.waitForTimeout(500);
  await scrollTo('#avTemplates');
  await shot('av-template', [['#avTemplates .templates', 1], ['#avTitle', 2], ['#avSub', 3]]);
  await scrollTo('#avStyle');
  await shot('av-style', [['#avStyle', 1], ['.drop[data-input=avImg]', 2], ['#avTrim .trim-wave', 3]]);

  // --- my templates ---
  page.once('dialog', (d) => d.accept('Kênh của tôi'));
  await page.click('#avTemplates [data-role=save-template]');
  await page.waitForTimeout(300);
  await scrollTo('#avTemplates');
  await shot('mine', [['#avTemplates [data-role=save-template]', 1], ['#avTemplates .tcard:has([data-tpl^="my-"])', 2]]);

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
  <a href="#bat-dau">1. Bắt đầu</a><a href="#nhac">2. Chuẩn bị nhạc</a><a href="#anh-video">3. Ảnh + nhạc</a><a href="#chu-video">4. Chữ + nhạc</a><a href="#nhac-video">5. Chỉ có nhạc</a><a href="#luu">6. Lưu &amp; đăng TikTok</a><a href="#mau">7. Mẫu của tôi</a><a href="#anh">8. Sửa ảnh</a><a href="#loi">9. Gặp lỗi?</a>
</nav>

<main>
<section id="bat-dau">
  <h2>1. Bắt đầu</h2>
  <ol>
    <li>Mở trang bằng <b>Safari</b> (Chrome trên iPhone cũng dùng được).</li>
    <li>Để mở nhanh như một app: bấm nút <b>Chia sẻ</b> <kbd>⬆︎</kbd> ở thanh dưới Safari → <b>Thêm vào MH chính</b> → <b>Thêm</b>.</li>
    <li>Chọn công cụ ở thanh trên cùng <span class="n">1</span> — vuốt ngang để thấy hết 6 công cụ.</li>
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
  <ol start="3">
    <li>Chọn nhạc <span class="n">1</span> (không bắt buộc) — thời lượng nhạc được chia đều cho các slide.</li>
    <li>Bấm <b>Xuất video</b> <span class="n">2</span>, hoặc tải từng slide thành <b>ảnh PNG / .zip</b> <span class="n">3</span> để đăng dạng ảnh.</li>
  </ol>
  ${fig(s['tv-options'], 'Chọn nhạc (1), xuất video (2), tải ảnh slide (3)')}
</section>

<section id="nhac-video">
  <h2>5. Chỉ có nhạc → video</h2>
  <p>Tab <b>🎧 Audio → Video</b>. Biến bài hát, podcast, ghi âm thành video có sóng nhạc chuyển động.</p>
  <ol>
    <li>Chọn file nhạc, rồi chọn mẫu <span class="n">1</span>: TikTok Neon, Lo-fi, Podcast, Đĩa than, Karaoke…</li>
    <li>Gõ <b>Tên bài</b> <span class="n">2</span> và <b>dòng phụ</b> (ca sĩ / @kênh) <span class="n">3</span>.</li>
  </ol>
  ${fig(s['av-template'], 'Mẫu (1), tên bài (2), dòng phụ (3)')}
  <ol start="3">
    <li>Đổi <b>kiểu sóng nhạc</b> <span class="n">1</span> nếu muốn, thêm <b>ảnh bìa</b> <span class="n">2</span> (không bắt buộc).</li>
    <li>Chọn <b>đoạn nhạc</b> <span class="n">3</span> — bài dài trên 5 phút nên chọn đoạn ngắn để iPhone không bị thiếu bộ nhớ.</li>
  </ol>
  ${fig(s['av-style'], 'Kiểu sóng nhạc (1), ảnh bìa (2), đoạn nhạc (3)')}
</section>

<section id="luu">
  <h2>6. Lưu video vào Ảnh &amp; đăng TikTok</h2>
  ${fig(s['iv-done'], 'Video đã xong: Chia sẻ / Lưu vào Ảnh (1) hoặc Tải video (2)')}
  <ol>
    <li>Khi video xong, trang tự cuộn tới kết quả. Bấm <b>Chia sẻ / Lưu vào Ảnh</b> <span class="n">1</span> → chọn <b>Lưu video</b> — video vào thẳng app Ảnh.</li>
    <li>Hoặc chọn <b>TikTok</b> trong bảng chia sẻ để đăng luôn.</li>
    <li>Nút <b>Tải video</b> <span class="n">2</span> lưu vào <b>Tệp › Tải về</b>.</li>
  </ol>
  <div class="tip">💡 <b>Lưu video</b> qua nút Chia sẻ ổn định hơn nút Tải với video dài. Trên iPhone, video tự được giữ dưới 80 MB để Safari lưu được.</div>
</section>

<section id="mau">
  <h2>7. Mẫu của tôi</h2>
  <p>Đã chỉnh màu, font, @kênh vừa ý? Bấm <b>＋ Lưu thành mẫu của tôi</b> <span class="n">1</span>, đặt tên. Lần sau chỉ cần chạm vào mẫu đó <span class="n">2</span> (nhóm <b>Mẫu của tôi</b>). Bấm <kbd>×</kbd> để xoá.</p>
  ${fig(s.mine, 'Lưu mẫu (1), mẫu đã lưu (2)')}
  <div class="warn">Mẫu được lưu trong Safari trên chính iPhone này. Nếu xoá dữ liệu Safari hoặc lâu không mở trang, mẫu có thể mất. Thêm trang vào Màn hình chính giúp giữ lâu hơn.</div>
</section>

<section id="anh">
  <h2>8. Sửa ảnh</h2>
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
  <h2>9. Gặp lỗi?</h2>
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
