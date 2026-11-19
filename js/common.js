/* Shared helpers — plain globals so the site works from GitHub Pages or file:// */
const $ = (id) => document.getElementById(id);

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

const { formatBytes, formatTime, baseName, isHeic } = Core;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// yield to the UI (setTimeout, not rAF: rAF stalls in background tabs)
const nextFrame = () => new Promise((r) => setTimeout(r, 16));

/* ---------- image loading (incl. HEIC) ---------- */
function loadImgFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ img, w: img.naturalWidth, h: img.naturalHeight, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh')); };
    img.src = url;
  });
}

async function waitFor(cond, timeout = 15000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeout) return false;
    await sleep(100);
  }
  return true;
}

/** HEIC files from Android/desktop sometimes have no MIME type or extension: sniff the ISO-BMFF brand. */
async function sniffHeic(file) {
  try { return Core.isHeicBrand(new Uint8Array(await file.slice(0, 16).arrayBuffer())); } catch (_) { return false; }
}

async function decodeHeic(file) {
  await waitFor(() => window.heic2any);
  if (!window.heic2any) throw new Error('Không tải được bộ giải mã HEIC');
  let out = await heic2any({ blob: file, toType: 'image/png' });
  if (Array.isArray(out)) out = out[0];
  return loadImgFromBlob(out);
}

/** Returns {img, w, h, url} where img is drawable onto a canvas. */
async function readImage(file) {
  // Safari (macOS/iOS) decodes HEIC natively, so always try the browser first.
  try {
    return await loadImgFromBlob(file);
  } catch (e) {
    if (isHeic(file) || (await sniffHeic(file))) return decodeHeic(file);
    throw e;
  }
}

/* ---------- canvas size limits (iOS Safari: ~16.7 MP per canvas) ---------- */
const PLATFORM = Core.detectPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
const IS_MOBILE = PLATFORM.mobile;
const IS_IOS = PLATFORM.ios;
const MAX_CANVAS_AREA = IS_MOBILE ? 16_000_000 : 64_000_000;
/** Scale factor (≤1) that keeps w×h under the device's canvas limit. */
const safeScale = (w, h) => Core.fitArea(w, h, MAX_CANVAS_AREA);

/* ---------- canvas export ---------- */
const FORMAT_INFO = {
  'image/jpeg': { ext: 'jpg', label: 'JPG' },
  'image/png': { ext: 'png', label: 'PNG' },
  'image/webp': { ext: 'webp', label: 'WebP' },
  'image/avif': { ext: 'avif', label: 'AVIF' },
};

const SUPPORTED_OUT = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  return Object.keys(FORMAT_INFO).filter((t) => c.toDataURL(t).startsWith('data:' + t));
})();

function fillFormatSelect(sel, def = 'image/jpeg') {
  sel.innerHTML = SUPPORTED_OUT.map((t) => `<option value="${t}" ${t === def ? 'selected' : ''}>${FORMAT_INFO[t].label}</option>`).join('');
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Xuất ảnh thất bại'))), type, quality)
  );
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/* ---------- download / share ---------- */
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // iOS asks "Download?" and copies the file afterwards: revoking early makes it fail ("Failed to download").
  // Keep the URL for 10 min (the previous one is released when the next download starts).
  if (download._url) URL.revokeObjectURL(download._url);
  download._url = url;
  setTimeout(() => { URL.revokeObjectURL(url); if (download._url === url) download._url = null; }, 600000);
}

const canShareFiles = (() => {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] }));
  } catch (_) { return false; }
})();

/** On phones, the share sheet is how users save to Photos / send to TikTok. */
async function shareFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  try {
    await navigator.share({ files: [file] });
  } catch (e) {
    if (e.name !== 'AbortError') download(blob, name);
  }
}

/** Phones: one share sheet for many files (save all to Photos). */
async function shareAll(items) {
  const files = items.map(({ blob, name }) => new File([blob], name, { type: blob.type }));
  try {
    if (navigator.canShare && !navigator.canShare({ files })) throw new Error('too many');
    await navigator.share({ files });
  } catch (e) {
    if (e.name !== 'AbortError') toast('Không chia sẻ được nhiều file cùng lúc — hãy tải .zip hoặc chia sẻ từng ảnh');
  }
}

async function zipAndDownload(items, zipName) {
  const zip = new JSZip();
  const used = new Set();
  for (const { blob, name } of items) {
    let n = name, i = 1;
    while (used.has(n)) n = baseName(name) + '-' + i++ + '.' + name.split('.').pop();
    used.add(n);
    zip.file(n, blob);
  }
  download(await zip.generateAsync({ type: 'blob' }), zipName);
}

/* ---------- result cards ---------- */
function clearResults(container) {
  (container._urls || []).forEach((u) => URL.revokeObjectURL(u));
  container._urls = [];
  container.innerHTML = '';
}

function resultCard(container, { blob, name, origSize, info, previewUrl }) {
  const url = previewUrl || URL.createObjectURL(blob);
  (container._urls = container._urls || []).push(url);
  const card = document.createElement('div');
  card.className = 'card';
  let delta = '';
  if (origSize) {
    const pct = ((blob.size - origSize) / origSize) * 100;
    delta = ` <span class="${pct <= 0 ? 'good' : 'bad'}">(${pct <= 0 ? '' : '+'}${pct.toFixed(1)}%)</span>`;
  }
  card.innerHTML = `
    <div class="thumb" style="background-image:url('${url}')"></div>
    <div class="meta"><b></b><br>${origSize ? formatBytes(origSize) + ' → ' : ''}${formatBytes(blob.size)}${delta}${info ? '<br>' + info : ''}</div>
    <div class="actions"><button data-a="dl">Tải</button>${canShareFiles ? '<button data-a="share">Chia sẻ</button>' : ''}</div>`;
  card.querySelector('b').textContent = name;
  card.querySelector('[data-a=dl]').onclick = () => download(blob, name);
  const sh = card.querySelector('[data-a=share]');
  if (sh) sh.onclick = () => shareFile(blob, name);
  container.appendChild(card);
  return card;
}

function errorCard(container, name, err) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="meta"><b></b><br><span class="bad"></span></div>`;
  card.querySelector('b').textContent = name;
  card.querySelector('.bad').textContent = err.message || String(err);
  container.appendChild(card);
}

/* ---------- debug log (for "Sao chép thông tin lỗi") ---------- */
/** Last 40 warnings/errors of this page, kept in memory only (never sent anywhere). */
const DebugLog = (() => {
  const items = [];
  const str = (a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'object' ? (() => { try { return JSON.stringify(a); } catch (_) { return String(a); } })() : String(a));
  const push = (lvl, args) => {
    items.push(`${new Date().toISOString().slice(11, 19)} ${lvl} ${args.map(str).join(' ')}`.slice(0, 400));
    if (items.length > 40) items.shift();
  };
  ['error', 'warn'].forEach((l) => {
    const orig = console[l].bind(console);
    console[l] = (...a) => { push(l, a); orig(...a); };
  });
  window.addEventListener('error', (e) => push('error', [`${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`]));
  window.addEventListener('unhandledrejection', (e) => push('error', ['unhandled: ' + str(e.reason)]));
  return { items, push };
})();

/** Copy text to the clipboard; if the browser refuses, show it in a box to copy by hand. → true if copied */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) {}
  ta.remove();
  if (ok) return true;
  const d = document.createElement('dialog');
  d.className = 'copybox';
  d.innerHTML = '<p>Trình duyệt không cho tự sao chép. Hãy chọn hết đoạn dưới đây và sao chép:</p><textarea readonly rows="12"></textarea><div class="row"><button class="primary">Đóng</button></div>';
  d.querySelector('textarea').value = text;
  d.querySelector('button').onclick = () => { d.close(); d.remove(); };
  document.body.appendChild(d);
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  d.querySelector('textarea').select();
  return false;
}

/* ---------- file inputs + drag & drop ---------- */
function onFiles(inputId, cb) {
  const input = $(inputId);
  input.addEventListener('change', () => {
    if (input.files.length) cb([...input.files]);
    input.value = '';
  });
  const drop = document.querySelector(`.drop[data-input="${inputId}"]`);
  if (!drop) return;
  ['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const files = [...ev.dataTransfer.files];
    if (files.length) cb(input.multiple ? files : files.slice(0, 1));
  });
}

/* ---------- audio ---------- */
let _audioCtx;
function audioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

async function decodeAudioFile(file) {
  if (!Core.looksLikeAudio(file)) throw new Error(`"${file.name}" không phải file audio/video`);
  const buf = await file.arrayBuffer();
  const ctx = audioCtx();
  return new Promise((resolve, reject) => {
    // callback form for older Safari
    const fail = () => reject(new Error(`Không giải mã được "${file.name}" — trình duyệt này không đọc được định dạng này (thử đổi sang mp3 hoặc wav)`));
    const p = ctx.decodeAudioData(buf, (b) => (b && b.duration > 0 ? resolve(b) : fail()), fail);
    if (p && p.catch) p.catch(() => {});
  });
}

/*
 * iPhone/iPad: accept="audio/*" makes iOS grey out many audio files in the Files app
 * (m4a, mp3 without a registered type, Voice Memos exports…). Remove the filter on iOS
 * and validate by decoding instead.
 */
document.querySelectorAll('.ios-only').forEach((e) => (e.hidden = !IS_IOS));
document.querySelectorAll('input[type=file][data-audio]').forEach((inp) => {
  if (IS_IOS) inp.removeAttribute('accept');
  else inp.accept = 'audio/*,video/*,' + Core.AUDIO_EXT.map((e) => '.' + e).join(',');
});

/** Cheap, cross-browser blur (Safari has no ctx.filter): downscale then upscale. */
function makeBlur(img, iw, ih, W, H, darken = 0.35) {
  const small = makeCanvas(Math.max(8, W / 24), Math.max(8, H / 24));
  drawImageFit(small.getContext('2d'), img, iw, ih, 0, 0, small.width, small.height, 'cover');
  const mid = makeCanvas(W / 6, H / 6);
  const m = mid.getContext('2d');
  m.imageSmoothingQuality = 'high';
  m.drawImage(small, 0, 0, mid.width, mid.height);
  m.fillStyle = `rgba(0,0,0,${darken})`;
  m.fillRect(0, 0, mid.width, mid.height);
  small.width = small.height = 0;
  return mid;
}

/* ---------- video output sizes (TikTok first) ---------- */
const VIDEO_SIZES = [
  { id: '1080x1920', label: '9:16 TikTok / Reels 1080×1920', w: 1080, h: 1920 },
  { id: '720x1280', label: '9:16 TikTok nhẹ 720×1280', w: 720, h: 1280 },
  { id: '1080x1350', label: '4:5 Instagram 1080×1350', w: 1080, h: 1350 },
  { id: '1080x1080', label: '1:1 Vuông 1080×1080', w: 1080, h: 1080 },
  { id: '1920x1080', label: '16:9 YouTube 1920×1080', w: 1920, h: 1080 },
];
document.querySelectorAll('.size-select').forEach((sel) => {
  sel.innerHTML = VIDEO_SIZES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
});
const getSize = (sel) => VIDEO_SIZES.find((s) => s.id === sel.value) || VIDEO_SIZES[0];

/* ---------- drawing helpers ---------- */
function drawImageFit(ctx, img, iw, ih, x, y, w, h, mode = 'cover', zoom = 1, ox = 0.5, oy = 0.5) {
  const s = (mode === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih)) * zoom;
  const dw = iw * s, dh = ih * s;
  ctx.drawImage(img, x + (w - dw) * ox, y + (h - dh) * oy, dw, dh);
}

function setProgress(el, frac, text) {
  el.hidden = false;
  el.querySelector('div').style.width = (frac * 100).toFixed(1) + '%';
  el.querySelector('span').textContent = text;
}

/* ---------- tabs ---------- */
document.querySelectorAll('#tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
    location.hash = b.dataset.tab;
    window.dispatchEvent(new CustomEvent('tabshown', { detail: b.dataset.tab }));
  };
});
window.addEventListener('DOMContentLoaded', () => {
  const h = location.hash.slice(1);
  const b = document.querySelector(`#tabs button[data-tab="${h}"]`);
  if (b) b.click();
});

/* range outputs */
[['convQ', 'convQOut'], ['cmpQ', 'cmpQOut']].forEach(([r, o]) => {
  $(r).addEventListener('input', () => ($(o).textContent = $(r).value));
});
