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
    <div class="meta"><b></b><br>${origSize ? formatBytes(origSize) + ' → ' : ''}${formatBytes(blob.size)}${delta}${info ? '<br><span data-a="info"></span>' : ''}</div>
    <div class="actions"><button data-a="dl">Tải</button>${canShareFiles ? '<button data-a="share">Chia sẻ</button>' : ''}</div>`;
  card.querySelector('b').textContent = name;
  if (info) card.querySelector('[data-a=info]').textContent = info; // plain text, never HTML
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

/**
 * Copy text (or a Promise of text) to the clipboard; if the browser refuses, show it in a box to copy by hand.
 * → true if copied. Call it directly from the tap: Safari only allows clipboard writes inside the user gesture,
 * so the write starts at once with a ClipboardItem whose content is still being built.
 */
async function copyText(src) {
  const textP = Promise.resolve(src);
  if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': textP.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      return true;
    } catch (_) {}
  }
  const text = await textP;
  try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length); // iOS ignores select() on a read-only field
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) {}
  ta.remove();
  if (ok && !IS_IOS) return true; // iOS may report success with nothing copied: show the text instead
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

/** Run `fn` at most once per animation frame (a template sets ~6 controls at once → one redraw). */
function oncePerFrame(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(); });
  };
}

/* ---------- file inputs + drag & drop ---------- */
function onFiles(inputId, cb) {
  const input = $(inputId);
  const kind = input.dataset.kind || (input.hasAttribute('data-audio') ? 'audio' : 'image');
  /** Refuse huge files before reading them into memory (a phone tab would reload instead of showing an error). */
  // data-kind="media": photos get the image limit, videos the audio/video limit
  const kindOf = (f) => (kind !== 'media' ? kind : /^(video|audio)\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name) ? 'audio' : 'image');
  const guarded = (files) => {
    const bad = files.map((f) => Core.checkFileSize(f, kindOf(f))).find(Boolean);
    if (bad) { toast(bad, 5000); files = files.filter((f) => !Core.checkFileSize(f, kindOf(f))); }
    if (files.length) cb(files);
  };
  input.addEventListener('change', () => {
    if (input.files.length) guarded([...input.files]);
    input.value = '';
  });
  const drop = document.querySelector(`.drop[data-input="${inputId}"]`);
  if (!drop) return;
  // keyboard: the real input is hidden, so the drop zone itself is the focusable control
  drop.tabIndex = 0;
  drop.setAttribute('role', 'button');
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const files = [...ev.dataTransfer.files];
    if (files.length) guarded(input.multiple ? files : files.slice(0, 1));
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
  { id: '1080x1920', label: '9:16 TikTok · 1080p', w: 1080, h: 1920 },
  { id: '720x1280', label: '9:16 nhẹ · 720p', w: 720, h: 1280 },
  { id: '1080x1350', label: '4:5 Instagram', w: 1080, h: 1350 },
  { id: '1080x1080', label: '1:1 Vuông', w: 1080, h: 1080 },
  { id: '1920x1080', label: '16:9 YouTube', w: 1920, h: 1080 },
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
  el.setAttribute('aria-valuenow', Math.round(frac * 100));
  el.setAttribute('aria-valuetext', text);
  el.querySelector('div').style.width = (frac * 100).toFixed(1) + '%';
  el.querySelector('span').textContent = text;
}

/* ---------- tabs ---------- */
/** Height the tab bar covers at the top of the screen (0 on desktop, where it is a sidebar). */
function tabsCover() {
  const t = $('tabs');
  return t && getComputedStyle(t).flexDirection !== 'column' ? t.getBoundingClientRect().bottom : 0;
}
/** Show one panel (a tool tab, or a footer page like #about / #selftest). */
function showPanel(name) {
  const panel = $('tab-' + name);
  if (!panel) return false;
  $('toast').classList.remove('show'); // a message from the previous tab doesn't belong here
  document.querySelectorAll('#tabs button').forEach((x) => {
    const on = x.dataset.tab === name;
    x.classList.toggle('active', on);
    x.setAttribute('aria-selected', on);
    x.tabIndex = on ? 0 : -1;
    // the chosen tab stays visible in the scrolling bar (scroll the BAR only: scrollIntoView could move the page)
    if (on) { const bar = x.parentElement; bar.scrollLeft = x.offsetLeft - (bar.clientWidth - x.offsetWidth) / 2; }
  });
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p === panel));
  window.dispatchEvent(new CustomEvent('tabshown', { detail: name }));
  return true;
}
const tabButtons = [...document.querySelectorAll('#tabs button')];
tabButtons.forEach((b, i) => {
  b.tabIndex = b.classList.contains('active') ? 0 : -1;
  b.onclick = () => {
    showPanel(b.dataset.tab);
    history.replaceState(null, '', '#' + b.dataset.tab);
    // start the new tab at its top (it kept the previous tab's scroll position, e.g. its bottom)
    const top = $('tab-' + b.dataset.tab).getBoundingClientRect().top + window.scrollY - tabsCover() - 8;
    if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
  };
  // arrow keys move between tabs (ARIA tabs pattern)
  b.onkeydown = (e) => {
    // horizontal bar: ← →; desktop sidebar (vertical): ↑ ↓ too; Home / End jump to the first / last tool
    const n0 = { Home: -i, End: tabButtons.length - 1 - i }[e.key];
    const d = n0 !== undefined ? n0 : { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const n = tabButtons[(i + d + tabButtons.length) % tabButtons.length];
    n.focus();
    n.click();
  };
});
/* the tab bar is a vertical sidebar on desktop: tell screen readers which arrow keys apply */
const tabsOrientation = () => $('tabs').setAttribute('aria-orientation', getComputedStyle($('tabs')).flexDirection === 'column' ? 'vertical' : 'horizontal');
tabsOrientation();
window.addEventListener('resize', tabsOrientation);
/* "Bỏ qua menu": move focus to the tool without putting #main into the address (it is not a tab) */
document.querySelector('.skip').addEventListener('click', (e) => { e.preventDefault(); $('main').focus(); });

const fromHash = () => {
  const h = location.hash.slice(1);
  if (!h || h === 'selftest' || !showPanel(h)) return;
  if (!document.querySelector(`#tabs button[data-tab="${h}"]`)) window.scrollTo(0, 0); // footer pages open at the top
};
window.addEventListener('DOMContentLoaded', fromHash);
window.addEventListener('hashchange', fromHash);

/* range outputs */
[['convQ', 'convQOut'], ['cmpQ', 'cmpQOut']].forEach(([r, o]) => {
  $(r).addEventListener('input', () => ($(o).textContent = $(r).value));
});

/* ---------- preview size toggle (phones: the preview is a small sticky strip) ---------- */
document.querySelectorAll('.split .preview').forEach((pv) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pv-toggle';
  b.setAttribute('aria-label', 'Phóng to / thu nhỏ khung xem trước');
  b.setAttribute('aria-pressed', 'false');
  b.textContent = '⤢';
  b.onclick = () => { const on = pv.classList.toggle('big'); b.setAttribute('aria-pressed', on); };
  pv.appendChild(b);
});

/* ---------- loudness normalisation (−14 LUFS TikTok / YouTube, −16 LUFS podcast) ---------- */
/**
 * Loudness.mount('avLoud', () => ({ audio, offset, duration })) → { gain(), refresh() }.
 * Measures only the chosen clip (cached per clip), shows "−22,8 LUFS → +8,8 dB" under the select,
 * and gain() is what the export (and the preview player) multiplies the sound by.
 */
const Loudness = (() => {
  /** Yield to the event loop without timer clamping (background tabs clamp setTimeout to ≥ 1 s). */
  const yieldTask = (() => {
    const ch = new MessageChannel(), q = [];
    ch.port1.onmessage = () => q.shift()();
    return () => new Promise((r) => { q.push(r); ch.port2.postMessage(0); });
  })();
  const cache = new WeakMap(); // AudioBuffer → { stereo, mono } index jobs
  const nf = (v) => v.toFixed(1).replace('.', ',').replace('-', '−');
  /**
   * Loudness index of a song, built ONCE in 5-second slices (a 1-hour podcast never freezes the page); every
   * range after that is measured instantly. mono = measure the single channel as written to a mono WAV;
   * otherwise the two channels exactly as exported (mono → both sides, 5.1 / quad down-mixed like Web Audio).
   */
  function job(buf, mono) {
    let e = cache.get(buf);
    if (!e) cache.set(buf, (e = {}));
    const key = mono ? 'mono' : 'stereo';
    if (!e[key]) {
      const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      const idx = Core.loudnessIndex(mono ? [ch[0]] : Core.downmixStereo(ch), buf.sampleRate);
      const slice = buf.sampleRate * 5;
      e[key] = { idx, ready: (async () => { while (!idx.step(slice)) await yieldTask(); return idx; })() };
    }
    return e[key];
  }
  /** → Promise<{ m, target, gain, db, limited }> for a clip, or null without audio. */
  async function compute(mode, c) {
    if (!c || !c.audio) return null;
    const target = Core.LOUDNESS_TARGETS[mode];
    if (!target) return { m: null, target: 0, gain: 1, db: 0, limited: false }; // "off": nothing to measure
    const idx = await job(c.audio, !!c.mono).ready;
    const off = +c.offset || 0, dur = c.duration > 0 ? c.duration : c.audio.duration - off;
    const m = Core.loudnessRange(idx, off, off + dur);
    return { m, target, ...Core.normGain(m, target) };
  }
  function describe(r) {
    if (!r) return '';
    if (!r.target) return 'Giữ nguyên âm lượng như file gốc.';
    if (!isFinite(r.m.lufs)) return 'Đoạn này gần như im lặng — giữ nguyên âm lượng.';
    if (Math.abs(r.db) < 0.5) return `Đoạn đã chọn đã đạt chuẩn (${nf(r.m.lufs)} LUFS).`;
    const dir = r.db > 0 ? `tăng ${nf(r.db)} dB` : `giảm ${nf(-r.db)} dB`;
    return `Đoạn đã chọn ${nf(r.m.lufs)} LUFS → ${dir}` + (r.limited ? ' (dừng sớm để tiếng không bị rè)' : ` (đạt ${nf(r.target)} LUFS)`);
  }
  /**
   * Loudness.mount('avLoud', () => ({ audio, offset, duration, mono? })) → { gain(), text(), refresh() }.
   * gain() / text() are async and always use the CURRENT clip (never a stale debounced value).
   */
  function mount(selId, get) {
    const sel = $(selId);
    const info = document.createElement('div');
    info.className = 'hint';
    info.id = selId + 'Info';
    info.setAttribute('aria-live', 'polite');
    sel.closest('label').after(info);
    const now = () => compute(sel.value, get());
    let tm = 0, seq = 0;
    const refresh = () => {
      clearTimeout(tm);
      tm = setTimeout(async () => {
        const my = ++seq, c = get();
        if (c && c.audio && Core.LOUDNESS_TARGETS[sel.value] && !job(c.audio, !!c.mono).idx.done) info.textContent = 'Đang đo âm lượng…';
        try { const t = describe(await now()); if (my === seq) info.textContent = t; } catch (e) { if (my === seq) info.textContent = ''; }
      }, 200);
    };
    sel.closest('.panel').addEventListener('change', refresh);
    sel.closest('.panel').addEventListener('input', refresh);
    return {
      gain: async () => { const r = await now(); return r ? r.gain : 1; },
      text: async () => describe(await now()),
      refresh,
      get info() { return info.textContent; },
    };
  }
  return { mount, compute, describe, job };
})();

/* ---------- safe-zone overlay: where TikTok / Reels / Shorts buttons and captions cover a 9:16 video ---------- */
/**
 * A row of chips under every preview: Tắt / TikTok / Reels / Shorts. The overlay is HTML on top of the canvas,
 * so it is never drawn into the exported video. One choice for all tabs (kept in memory only).
 */
const SafeZone = (() => {
  let current = 'off';
  const views = [];
  function layout(v) {
    const c = v.canvas, r = Core.containRect(c.width, c.height, c.clientWidth, c.clientHeight);
    const safe = Core.safeRect(current, c.width, c.height);
    v.pv.classList.toggle('sz-na', !Core.safeRect('tiktok', c.width, c.height)); // phones hide the chips for 16:9
    v.ov.hidden = current === 'off' || !safe || !c.clientWidth;
    v.note.hidden = !(current !== 'off' && !safe);
    if (v.ov.hidden) return;
    const k = r.w / c.width;
    Object.assign(v.ov.style, { left: c.offsetLeft + c.clientLeft + r.x + 'px', top: c.offsetTop + c.clientTop + r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    Object.assign(v.safe.style, { left: safe.x * k + 'px', top: safe.y * k + 'px', width: safe.w * k + 'px', height: safe.h * k + 'px' });
    v.tag.textContent = Core.SAFE_ZONES[current].label;
  }
  const relayout = () => views.forEach(layout);
  function set(name) {
    current = Core.SAFE_ZONES[name] ? name : 'off';
    views.forEach((v) => v.chips.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.sz === current;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    }));
    relayout();
  }
  document.querySelectorAll('.split .preview').forEach((pv) => {
    const canvas = pv.querySelector('canvas');
    if (!canvas) return;
    const ov = document.createElement('div');
    ov.className = 'sz-overlay';
    ov.hidden = true;
    ov.setAttribute('aria-hidden', 'true');
    ov.innerHTML = '<div class="sz-safe"><span class="sz-tag"></span></div>';
    canvas.after(ov);
    const chips = document.createElement('div');
    chips.className = 'chips sz-chips';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Hiện vùng bị giao diện ứng dụng che');
    chips.innerHTML = '<span class="sz-label">Vùng bị che:</span>' +
      [['off', 'Tắt'], ...Object.entries(Core.SAFE_ZONES).map(([k, z]) => [k, z.label])]
        .map(([k, l]) => `<button type="button" data-sz="${k}" aria-pressed="${k === 'off'}"${k === 'off' ? ' class="active"' : ''}>${l}</button>`).join('');
    const note = document.createElement('p');
    note.className = 'hint sz-note';
    note.hidden = true;
    note.textContent = 'Vùng bị che chỉ áp dụng cho khung dọc 9:16 (TikTok, Reels, Shorts).';
    const anchor = pv.querySelector('.scrub') || canvas;
    (anchor === canvas ? ov : anchor).after(chips);
    chips.after(note);
    chips.addEventListener('click', (e) => { const b = e.target.closest('button[data-sz]'); if (b) set(b.dataset.sz); });
    const v = { pv, canvas, ov, chips, note, safe: ov.firstChild, tag: ov.querySelector('.sz-tag') };
    views.push(v);
    if (window.ResizeObserver) new ResizeObserver(() => layout(v)).observe(canvas);
    // the canvas resolution changes when the frame size changes (its CSS box may not)
    new MutationObserver(() => layout(v)).observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
  });
  window.addEventListener('resize', relayout);
  window.addEventListener('tabshown', () => requestAnimationFrame(relayout));
  return { set, get current() { return current; }, relayout };
})();
