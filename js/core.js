/*
 * Pure logic (no DOM) shared by the pages and the unit tests.
 * Loaded as a plain <script> in the browser (global `Core`) and via require() in Node.
 */
(function (root, factory) {
  const C = factory();
  if (typeof module === 'object' && module.exports) module.exports = C;
  root.Core = C;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  /* ---------------- formatting ---------------- */
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function formatTime(s) {
    s = Math.max(0, s || 0);
    const m = Math.floor(s / 60);
    return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  const baseName = (name) => String(name).replace(/\.[^.]+$/, '');

  /* ---------------- platform ---------------- */
  function detectPlatform(ua = '', platform = '', maxTouchPoints = 0) {
    // iPadOS reports itself as "Macintosh" but has touch points.
    const iPadOS = maxTouchPoints > 1 && /Mac/.test(platform);
    const ios = /iPhone|iPad|iPod/i.test(ua) || iPadOS;
    const android = /Android/i.test(ua);
    return { ios, android, mobile: ios || android };
  }

  /* ---------------- file type detection ---------------- */
  const isHeic = (f) => /image\/hei[cf]/i.test(f.type || '') || /\.hei[cf]$/i.test(f.name || '');

  /** HEIC files sometimes have no MIME type or extension: check the ISO-BMFF brand. */
  function isHeicBrand(bytes) {
    if (!bytes || bytes.length < 12) return false;
    const str = String.fromCharCode(...bytes.slice(4, 12));
    return /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(str);
  }

  const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'caf', 'aif', 'aiff', 'amr', 'weba', 'mp4', 'm4v', 'mov', 'webm', '3gp'];
  /** Whether a picked file is worth trying to decode as audio (iOS often reports an empty MIME type). */
  function looksLikeAudio(f) {
    if (/^(audio|video)\//i.test(f.type || '')) return true;
    const ext = (String(f.name || '').split('.').pop() || '').toLowerCase();
    return AUDIO_EXT.includes(ext) || !f.type;
  }

  /* ---------------- canvas limits ---------------- */
  /** Scale factor (≤1) that keeps w×h under maxArea pixels. */
  const fitArea = (w, h, maxArea) => Math.min(1, Math.sqrt(maxArea / (w * h)));

  /* ---------------- lossless JPEG metadata strip ---------------- */
  const startsWith = (b, at, str) => [...str].every((c, i) => b[at + i] === c.charCodeAt(0));

  /** EXIF orientation from an APP1 segment starting at `seg` (pointing at FF E1). */
  function exifOrientation(b, seg) {
    const t = seg + 10; // "Exif\0\0" at +4, TIFF header at +10
    const le = b[t] === 0x49; // 'II'
    const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
    const u32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216 : b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]));
    try {
      const ifd = t + u32(t + 4);
      const n = u16(ifd);
      if (!(n >= 0 && n < 1000) || ifd + 2 + n * 12 > b.length) return 1;
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (u16(e) === 0x0112) return u16(e + 8);
      }
    } catch (_) {}
    return 1;
  }

  /** Minimal APP1 holding only the Orientation tag, so stripped photos still display upright. */
  function orientationApp1(o) {
    return new Uint8Array([
      0xff, 0xe1, 0x00, 0x22,
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, IFD0 at 8
      0x00, 0x01, // 1 entry
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, o, 0x00, 0x00, // Orientation = o
      0x00, 0x00, 0x00, 0x00, // no next IFD
    ]);
  }

  /**
   * Remove metadata segments from a JPEG without touching the compressed image data.
   * Keeps JFIF, Adobe (CMYK), ICC profile, all tables/frame headers; rebuilds EXIF orientation.
   * Returns { parts: Uint8Array[], removed: string[] }.
   */
  function stripJpegBytes(b) {
    if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('Không phải JPEG hợp lệ');
    const parts = [b.subarray(0, 2)];
    const removed = new Set();
    let p = 2;
    while (p < b.length) {
      if (b[p] !== 0xff) throw new Error('JPEG lỗi cấu trúc');
      while (b[p + 1] === 0xff) p++; // fill bytes
      const m = b[p + 1];
      if (m === 0xda) {
        // Start of scan: keep everything up to the primary image's EOI (drops appended thumbnails / MPF extras).
        let end = b.length;
        for (let i = p + 2; i < b.length - 1; i++) if (b[i] === 0xff && b[i + 1] === 0xd9) { end = i + 2; break; }
        parts.push(b.subarray(p, end));
        if (end < b.length) removed.add('ảnh phụ đính kèm');
        break;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { parts.push(b.subarray(p, p + 2)); p += 2; continue; }
      if (p + 3 >= b.length) throw new Error('JPEG lỗi cấu trúc');
      const len = (b[p + 2] << 8) | b[p + 3];
      if (len < 2 || p + 2 + len > b.length) throw new Error('JPEG lỗi cấu trúc');
      const seg = b.subarray(p, p + 2 + len);
      const isApp = m >= 0xe0 && m <= 0xef;
      let keep = !isApp && m !== 0xfe; // tables, frame headers, restart interval… always kept
      if (m === 0xe0) keep = true; // JFIF
      if (m === 0xee) keep = true; // Adobe: needed to decode CMYK/YCCK colours correctly
      if (m === 0xe2 && startsWith(b, p + 4, 'ICC_PROFILE')) keep = true; // colour profile (Display P3…)
      if (m === 0xe1 && startsWith(b, p + 4, 'Exif')) {
        const o = exifOrientation(b, p);
        if (o > 1 && o <= 8) parts.push(orientationApp1(o));
        removed.add('EXIF/GPS');
      } else if (!keep) {
        removed.add(m === 0xfe ? 'comment' : m === 0xe1 ? 'XMP' : 'APP' + (m - 0xe0));
      }
      if (keep) parts.push(seg);
      p += 2 + len;
    }
    return { parts, removed: [...removed] };
  }

  /* ---------------- text layout ---------------- */
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('vi', { granularity: 'grapheme' }) : null;
  /** User-perceived characters (keeps 👨‍👩‍👧 and Vietnamese accents intact). */
  const graphemes = (s) => (segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s));

  /** Break a single word wider than maxW (URLs, hashtags…) into pieces. `ctx` only needs measureText. */
  function splitLongWord(ctx, word, maxW) {
    const parts = [];
    let cur = '';
    for (const g of graphemes(word)) {
      if (cur && ctx.measureText(cur + g).width > maxW) { parts.push(cur); cur = g; } else cur += g;
    }
    if (cur) parts.push(cur);
    return parts;
  }

  function wrap(ctx, text, maxW, breakWords) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let words = para.split(/\s+/).filter(Boolean);
      if (breakWords) words = words.flatMap((w) => (ctx.measureText(w).width > maxW ? splitLongWord(ctx, w, maxW) : [w]));
      if (!words.length) { out.push(''); continue; }
      let line = words[0];
      for (let i = 1; i < words.length; i++) {
        const test = line + ' ' + words[i];
        if (ctx.measureText(test).width <= maxW) line = test;
        else { out.push(line); line = words[i]; }
      }
      out.push(line);
    }
    return out;
  }

  /** Wrap to at most maxLines, ending the last line with "…" when text was cut. */
  function clampLines(ctx, text, maxW, maxLines) {
    const lines = wrap(ctx, text, maxW, true).filter((l, i, a) => l || a.length === 1);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    const g = graphemes(last);
    while (g.length && ctx.measureText(g.join('') + '…').width > maxW) g.pop();
    kept[maxLines - 1] = g.join('').trimEnd() + '…';
    return kept;
  }

  /** Split text-to-video input into slides: blank line = new slide. */
  const splitSlides = (text) => String(text).normalize('NFC').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

  /* ---------------- colours ---------------- */
  function luminance(hex) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16) || 0;
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /** Text / handle colours that stay readable when the user replaces the template background. */
  function colorsFor(t, o) {
    if (o.bgMode === 'tpl') return { text: t.color, handle: t.handleColor || '#fff', stroke: t.stroke };
    const darkBg = o.bgMode === 'image' || luminance(o.bgColor) < 0.4;
    const text = t.box || t.note ? t.color : darkBg ? '#fff' : '#111'; // own backing (box / sticky note): keep its ink
    const stroke = t.stroke ? { ...t.stroke, color: darkBg ? '#000' : '#fff' } : null;
    return { text, handle: darkBg ? '#fff' : '#222', stroke };
  }

  /* ---------------- timing ---------------- */
  /** Text video: seconds per slide and total duration. */
  function slideTiming(n, fixedSeg, audioDur) {
    n = Math.max(1, n);
    let seg, duration;
    if (fixedSeg > 0) { seg = fixedSeg; duration = fixedSeg * n; }
    else if (audioDur > 0) { duration = audioDur; seg = duration / n; }
    else { seg = 3; duration = 3 * n; }
    if (audioDur > 0) duration = Math.min(duration, audioDur);
    return { n, seg, duration };
  }

  /**
   * Video length from an audio track: start offset + optional fixed duration, never past the audio end.
   * Without audio: `fallback` seconds.
   */
  function clipDuration({ start = 0, dur = 0, audioDur = 0, fallback = 4 }) {
    start = Math.max(0, +start || 0);
    dur = Math.max(0, +dur || 0);
    if (!audioDur) return dur || fallback;
    const left = Math.max(0.5, audioDur - start);
    return Math.min(dur || left, left);
  }

  /** Error message when the audio start offset is invalid, else null. */
  function checkStart(start, audioDur) {
    if (audioDur && (+start || 0) >= audioDur - 0.1) return `"Bắt đầu audio từ" phải nhỏ hơn độ dài bài (${audioDur.toFixed(1)}s)`;
    return null;
  }

  /* ---------------- video ---------------- */
  const AUDIO_BPS = 192000;
  /**
   * Video bitrate. ~0.05 bits per pixel (≈3.1 Mbps at 1080×1920@30) — TikTok/Reels re-encode to ~2–3 Mbps anyway.
   * With `maxBytes`, the bitrate is lowered so a `duration`-second file (video + AAC audio) stays under that size
   * (iPhone Safari fails to save very large in-memory downloads). Never below 0.8 Mbps.
   */
  function bitrateFor(w, h, fps, duration = 0, maxBytes = 0) {
    let b = Math.min(8e6, Math.round(w * h * fps * 0.05));
    if (duration > 0 && maxBytes > 0) b = Math.min(b, Math.floor((maxBytes * 8 * 0.9) / duration - AUDIO_BPS));
    return Math.max(800e3, b);
  }
  /** Rough output size in bytes for a duration (video + audio + ~1% container overhead). */
  const estimateBytes = (videoBps, duration, audio = true) => Math.round(((videoBps + (audio ? AUDIO_BPS : 0)) * duration / 8) * 1.01);
  const H264_CODECS = ['avc1.64002a', 'avc1.640028', 'avc1.4d002a', 'avc1.42e02a', 'avc1.640033', 'avc1.42e01f'];
  const even = (n) => Math.max(2, Math.round(n) - (Math.round(n) % 2));

  /* ---------------- audio analysis (visualizer) ---------------- */
  /** In-place iterative radix-2 FFT. re/im lengths must be a power of two. */
  function fft(re, im) {
    const n = re.length;
    if (n & (n - 1)) throw new Error('FFT size must be a power of two');
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        const half = len >> 1;
        for (let k = 0; k < half; k++) {
          const a = i + k, b = a + half;
          const xr = re[b] * cr - im[b] * ci;
          const xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  /** Mono window of `size` samples centred on `center` (zero-padded outside the buffer). */
  function monoWindow(channels, center, size, out) {
    const a = out || new Float32Array(size);
    const s0 = Math.round(center - size / 2);
    const nc = channels.length;
    const len = channels[0].length;
    for (let i = 0; i < size; i++) {
      const k = s0 + i;
      let v = 0;
      if (k >= 0 && k < len) { for (let c = 0; c < nc; c++) v += channels[c][k]; v /= nc; }
      a[i] = v;
    }
    return a;
  }

  /** Log-spaced band edges (Hz) between fMin and fMax. */
  function bandEdges(nBands, fMin = 40, fMax = 16000) {
    const e = [];
    for (let i = 0; i <= nBands; i++) e.push(fMin * Math.pow(fMax / fMin, i / nBands));
    return e;
  }

  /**
   * Spectrum of `samples` (mono, power-of-two length) in nBands log-spaced bands, each 0..1.
   * Range: -75 dBFS → 0, -15 dBFS → 1.
   */
  function spectrumBands(samples, sampleRate, nBands, opts = {}) {
    const N = samples.length;
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < N; i++) re[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))); // Hann
    fft(re, im);
    const half = N / 2;
    const mag = new Float32Array(half);
    for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]) / (N / 4); // full-scale sine ≈ 1
    const edges = bandEdges(nBands, opts.fMin, Math.min(opts.fMax || 16000, sampleRate / 2));
    const lo = opts.minDb ?? -75, hi = opts.maxDb ?? -15;
    const out = new Float32Array(nBands);
    const binHz = sampleRate / N;
    for (let b = 0; b < nBands; b++) {
      const i0 = Math.max(1, Math.floor(edges[b] / binHz));
      const i1 = Math.min(half - 1, Math.max(i0, Math.ceil(edges[b + 1] / binHz)));
      let m = 0;
      for (let i = i0; i <= i1; i++) if (mag[i] > m) m = mag[i];
      const db = 20 * Math.log10(m + 1e-12);
      out[b] = Math.min(1, Math.max(0, (db - lo) / (hi - lo)));
    }
    return out;
  }

  /** Peak amplitude (0..1) of `n` equal buckets across the whole buffer, for an overview waveform. */
  function peaks(channels, n, from = 0, to = channels[0].length) {
    const out = new Float32Array(n);
    const span = Math.max(1, (to - from) / n);
    const step = Math.max(1, Math.floor(span / 256)); // sampling is enough for a picture
    for (let b = 0; b < n; b++) {
      const s0 = Math.floor(from + b * span), s1 = Math.min(to, Math.floor(from + (b + 1) * span));
      let m = 0;
      for (const ch of channels) for (let i = s0; i < s1; i += step) { const v = Math.abs(ch[i]); if (v > m) m = v; }
      out[b] = Math.min(1, m);
    }
    return out;
  }

  /** Bars fall at `fallPerSec` (fraction of full height) but rise instantly. Returns new array. */
  function smoothBars(prev, next, dt, fallPerSec = 1.6) {
    if (!prev || prev.length !== next.length || !(dt > 0) || dt > 0.25) return Float32Array.from(next);
    const out = new Float32Array(next.length);
    for (let i = 0; i < next.length; i++) out[i] = Math.max(next[i], prev[i] - fallPerSec * dt);
    return out;
  }

  /** RMS loudness (0..1) of a window. */
  function rms(samples) {
    let s = 0;
    for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
    return Math.sqrt(s / Math.max(1, samples.length));
  }

  /* ---------------- audio trimming (waveform handles) ---------------- */
  /**
   * New selection while dragging on the waveform. Times in seconds; d = song length.
   * mode 'start' | 'end' moves one edge (kept ≥ min apart), 'move' slides the whole window (grab = where in it).
   */
  function trimDrag({ s, e, d, mode, t, grab = 0, min = 0.5 }) {
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    min = Math.min(min, d);
    if (mode === 'start') return { s: clamp(t, 0, e - min), e };
    if (mode === 'end') return { s, e: clamp(t, s + min, d) };
    const len = Math.min(e - s, d);
    const ns = clamp(t - grab, 0, d - len);
    return { s: ns, e: ns + len };
  }

  /* ---------------- colour sets (for non-designers) ---------------- */
  /** WCAG contrast ratio between two #rrggbb colours (1…21). */
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /**
   * Named, harmonious colour sets: c1 / c2 = visualizer colours, bg = background (gradient stops; the first is
   * used as the solid colour), ink = text. Every set is checked by a unit test: ink vs background ≥ 4.5:1,
   * c1 ≥ 3:1, c2 ≥ 2:1 — so whatever a non-designer picks stays readable.
   */
  const P = (id, name, mood, c1, c2, bg, ink) => ({ id, name, mood, c1, c2, bg, ink, light: luminance(bg[0]) > 0.4 });
  const PALETTES = [
    // dark & elegant
    P('dem-saigon', 'Đêm Sài Gòn', 'Tối', '#ff4d8d', '#ffb84d', ['#1a1033', '#0b0618'], '#fff7fb'),
    P('neon', 'Neon', 'Tối', '#25f4ee', '#fe2c55', ['#0f0f14', '#050507'], '#ffffff'),
    P('cuc-quang', 'Cực quang', 'Tối', '#5eead4', '#a78bfa', ['#0b1d2e', '#061018'], '#f0fdfa'),
    P('ruou-vang', 'Rượu vang', 'Tối', '#f9a8b8', '#e9c46a', ['#3b0a1a', '#16040a'], '#fff1f2'),
    P('rung-thong', 'Rừng thông', 'Tối', '#86efac', '#facc15', ['#0f2a1d', '#07150e'], '#f0fdf4'),
    P('dai-duong', 'Đại dương sâu', 'Tối', '#7dd3fc', '#fde68a', ['#0c2d48', '#051726'], '#f0f9ff'),
    P('ca-phe', 'Cà phê', 'Tối', '#e7c9a9', '#c08552', ['#3b2618', '#1e130c'], '#fbf3ea'),
    P('hoang-kim', 'Hoàng kim', 'Tối', '#fcd34d', '#f59e0b', ['#1c1917', '#0c0a09'], '#fef3c7'),
    P('mong-mo', 'Tím mộng mơ', 'Tối', '#f0abfc', '#c4b5fd', ['#2e1065', '#4c1d95'], '#faf5ff'),
    P('dem-trang', 'Đêm trăng', 'Tối', '#e5e7eb', '#93c5fd', ['#111827', '#030712'], '#f9fafb'),
    P('do-den', 'Đỏ đen', 'Tối', '#ef4444', '#fca5a5', ['#140404', '#000000'], '#fafafa'),
    // light & soft
    P('tra-sua', 'Trà sữa', 'Sáng & Pastel', '#8b5e3c', '#9a6a3f', ['#f5e6d3', '#e8d2b8'], '#3e2a1c'),
    P('bac-ha', 'Bạc hà', 'Sáng & Pastel', '#0f766e', '#0d9488', ['#e6f7f1', '#cdeee2'], '#134e4a'),
    P('hong-dao', 'Hồng đào', 'Sáng & Pastel', '#be123c', '#e11d48', ['#ffe4e6', '#fecdd3'], '#4c0519'),
    P('oai-huong', 'Oải hương', 'Sáng & Pastel', '#6d28d9', '#8b5cf6', ['#ede9fe', '#ddd6fe'], '#2e1065'),
    P('bau-troi', 'Bầu trời', 'Sáng & Pastel', '#0369a1', '#0284c7', ['#e0f2fe', '#bae6fd'], '#082f49'),
    P('chanh-vang', 'Chanh vàng', 'Sáng & Pastel', '#a16207', '#4d7c0f', ['#fef9c3', '#fde68a'], '#422006'),
    P('giay-cu', 'Giấy cũ', 'Sáng & Pastel', '#7c5a3a', '#8a6440', ['#f3ead8', '#e7dcc4'], '#3b2f2f'),
    P('trang-den', 'Trắng đen', 'Sáng & Pastel', '#111111', '#6b7280', ['#fafafa', '#ececec'], '#111111'),
    // vivid
    P('cam-chay', 'Cam cháy', 'Rực rỡ', '#fff7ed', '#fde68a', ['#c2410c', '#7c2d12'], '#ffffff'),
    P('xanh-ngoc', 'Xanh ngọc', 'Rực rỡ', '#ccfbf1', '#fde68a', ['#0f766e', '#134e4a'], '#ffffff'),
    P('xanh-duong', 'Xanh dương', 'Rực rỡ', '#bfdbfe', '#fde047', ['#1d4ed8', '#1e3a8a'], '#ffffff'),
    P('hong-neon', 'Hồng rực', 'Rực rỡ', '#fbcfe8', '#67e8f9', ['#9d174d', '#500724'], '#ffffff'),
    P('hoang-hon', 'Hoàng hôn', 'Rực rỡ', '#fde047', '#fb7185', ['#7c2d12', '#3b0764'], '#fff7ed'),
    // seasonal
    P('tet', 'Tết', 'Lễ hội', '#fcd34d', '#fef3c7', ['#991b1b', '#450a0a'], '#fffbeb'),
    P('giang-sinh', 'Giáng sinh', 'Lễ hội', '#fde68a', '#f87171', ['#14532d', '#052e16'], '#f0fdf4'),
    P('trung-thu', 'Trung thu', 'Lễ hội', '#fbbf24', '#fb923c', ['#1e1b4b', '#0f0a2e'], '#fef3c7'),
    P('valentine', 'Valentine', 'Lễ hội', '#fecdd3', '#fb7185', ['#881337', '#4c0519'], '#fff1f2'),
  ];

  /* ---------------- silence detection / removal ---------------- */
  /**
   * Find silent stretches (start, end, long pauses) in decoded audio.
   * channels: Float32Array[]; sr: sample rate. minGap = shortest pause in the MIDDLE worth reporting (s);
   * edges (lead / tail) are reported from minEdge. The threshold adapts to the recording: 32 dB under its
   * loud level (90th percentile of 20 ms windows), clamped to −58…−34 dBFS, so quiet voice notes and loud
   * songs both work. → [{ start, end, kind: 'lead' | 'gap' | 'tail' }] in seconds.
   */
  function findSilences(channels, sr, { minGap = 0.8, minEdge = 0.2, win = 0.02 } = {}) {
    const n = channels[0].length, w = Math.max(1, Math.round(win * sr)), nw = Math.floor(n / w);
    if (nw < 2) return [];
    const db = new Float32Array(nw);
    for (let k = 0; k < nw; k++) {
      let e = 0;
      for (const ch of channels) for (let i = k * w, end = i + w; i < end; i++) e += ch[i] * ch[i];
      const r = Math.sqrt(e / (w * channels.length));
      db[k] = r > 1e-9 ? 20 * Math.log10(r) : -120;
    }
    const sorted = Float32Array.from(db).sort();
    const loud = sorted[Math.floor(sorted.length * 0.9)];
    const thr = Math.min(-34, Math.max(-58, loud - 32));
    const out = [];
    let k = 0;
    while (k < nw) {
      if (db[k] >= thr) { k++; continue; }
      const a = k;
      while (k < nw && db[k] < thr) k++;
      const start = (a * w) / sr, end = k >= nw ? n / sr : (k * w) / sr;
      const kind = a === 0 ? 'lead' : k >= nw ? 'tail' : 'gap';
      if (kind === 'lead' && k >= nw) continue; // the whole file is silent: nothing sensible to cut
      // measured in 20 ms windows, a pause comes out up to ~2 windows short: allow for it so "≥ 0,4 s" finds a 0.4 s pause
      if (end - start >= (kind === 'gap' ? minGap : minEdge) - 1.5 * win) out.push({ start, end, kind });
    }
    return out;
  }

  /**
   * What will actually be cut for each silence: a short pause is KEPT around speech so it still sounds
   * natural (pad, at the start/end only `edgePad`). → [{ from, to }] in seconds, sorted, non-empty.
   */
  function silenceCuts(segments, { pad = 0.15, edgePad = 0.08 } = {}) {
    return segments
      .map((g) => ({ from: g.kind === 'lead' ? g.start : g.start + (g.kind === 'tail' ? edgePad : pad), to: g.kind === 'tail' ? g.end : g.end - (g.kind === 'lead' ? edgePad : pad) }))
      .filter((c) => c.to - c.from > 0.02)
      .sort((x, y) => x.from - y.from);
  }

  /**
   * Remove [from, to) ranges (seconds) from every channel; a short fade (ms) on each side of every join
   * avoids clicks. → Float32Array[] (new arrays; the input is untouched).
   */
  function removeRanges(channels, sr, cuts, fadeMs = 8) {
    const n = channels[0].length;
    const keep = [];
    let pos = 0;
    for (const c of cuts) {
      const a = Math.max(pos, Math.round(c.from * sr)), b = Math.min(n, Math.round(c.to * sr));
      if (a > pos) keep.push([pos, a]);
      pos = Math.max(pos, b);
    }
    if (pos < n) keep.push([pos, n]);
    const total = keep.reduce((s, [a, b]) => s + (b - a), 0);
    const f = Math.max(1, Math.round((fadeMs / 1000) * sr));
    return channels.map((ch) => {
      const out = new Float32Array(Math.max(1, total));
      let o = 0;
      keep.forEach(([a, b], i) => {
        out.set(ch.subarray(a, b), o);
        const len = b - a, fi = Math.min(f, Math.floor(len / 2));
        if (i > 0) for (let j = 0; j < fi; j++) out[o + j] *= j / fi; // fade in after a join
        if (i < keep.length - 1) for (let j = 0; j < fi; j++) out[o + len - 1 - j] *= j / fi; // fade out before a join
        o += len;
      });
      return out;
    });
  }

  /* ---------------- beat-reactive visuals (deterministic: pure functions of time) ---------------- */
  /**
   * Loudness envelope of a clip, `rate` values per second, normalised so the loudest point is 1.
   * channels: Float32Array[]; from/len in samples. → Float32Array
   */
  function envelope(channels, sr, from = 0, len = channels[0].length - from, rate = 50) {
    const hop = Math.max(1, Math.round(sr / rate)), n = Math.max(1, Math.ceil(len / hop));
    const out = new Float32Array(n);
    let max = 1e-9;
    for (let k = 0; k < n; k++) {
      let e = 0, c = 0;
      const a = from + k * hop, b = Math.min(from + len, a + hop, channels[0].length);
      for (const ch of channels) for (let i = a; i < b; i += 2) { e += ch[i] * ch[i]; c++; }
      out[k] = c ? Math.sqrt(e / c) : 0;
      if (out[k] > max) max = out[k];
    }
    for (let k = 0; k < n; k++) out[k] /= max;
    return out;
  }
  /** Linear interpolation into an envelope at time t (seconds from the clip start). */
  const envAt = (env, t, rate = 50) => {
    if (!env || !env.length) return 0;
    const x = Math.max(0, Math.min(env.length - 1, t * rate)), i = Math.floor(x), f = x - i;
    return env[i] * (1 - f) + (env[Math.min(env.length - 1, i + 1)] || 0) * f;
  };

  /**
   * Bass hits (kick drum / beat) of a clip: low-pass (~150 Hz, two one-pole stages) → energy per 1024-sample
   * hop (log-compressed) → positive flux above an adaptive threshold (1.5 × mean + 0.5 × std of the last
   * 0.75 s, and a floor) that is a local maximum; at most one hit per 0.25 s (≤ 4/s).
   * → [{ t: seconds from the clip start, s: strength 0.4–1 }]
   */
  function bassOnsets(channels, sr, from = 0, len = channels[0].length - from) {
    const hop = 1024, n = Math.floor(len / hop);
    if (n < 4) return [];
    // 4-pole low-pass at 100 Hz: kick drums live below ~100 Hz; voices (85–255 Hz fundamentals) mostly don't
    const a = 1 - Math.exp((-2 * Math.PI * 100) / sr);
    let y1 = 0, y2 = 0, y3 = 0, y4 = 0;
    const E = new Float32Array(n), share = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let e = 0, ef = 0;
      for (let i = from + k * hop, end = i + hop; i < end; i++) {
        let x = 0;
        for (const ch of channels) x += ch[i] || 0;
        x /= channels.length;
        y1 += a * (x - y1); y2 += a * (y1 - y2); y3 += a * (y2 - y3); y4 += a * (y3 - y4);
        e += y4 * y4; ef += x * x;
      }
      E[k] = Math.log1p(Math.sqrt(e / hop) * 10);
      share[k] = ef > 0 ? Math.sqrt(e / ef) : 0; // how much of the sound is bass right now
    }
    const flux = new Float32Array(n);
    for (let k = 1; k < n; k++) flux[k] = Math.max(0, E[k] - E[k - 1]);
    // ≥ 0.24 s between hits (≤ ~4/s): 0.25 s missed real 4 Hz kicks that land 10 or 11 hops apart
    const win = Math.max(2, Math.round((0.75 * sr) / hop)), gap = Math.floor((0.24 * sr) / hop);
    const floor = Math.log1p(Math.pow(10, -50 / 20) * 10) * 0.5;
    const ABS_FLOOR = 0.12; // ambient pads / noise never exceed ~0.07 (measured); real kicks ≥ 0.45
    const out = [];
    let last = -Infinity;
    for (let k = 1; k < n - 2; k++) {
      let m = 0, v = 0, c = 0;
      for (let j = Math.max(0, k - win); j < k; j++) { m += flux[j]; c++; }
      m = c ? m / c : 0;
      for (let j = Math.max(0, k - win); j < k; j++) v += (flux[j] - m) ** 2;
      const sd = c ? Math.sqrt(v / c) : 0;
      const f = flux[k];
      const peak = f >= flux[k - 1] && f >= flux[k + 1] && f >= (flux[k - 2] || 0) && f >= flux[k + 2];
      // a drum hit rises SHARPLY: most of the rise happens within one hop (46 ms at 22 kHz). A spoken
      // syllable or a swelling pad rises over several hops → not a beat (QC: ambient / speech gave fake hits)
      const before = Math.min(E[Math.max(0, k - 3)], E[Math.max(0, k - 2)], E[k - 1]);
      const after = Math.max(E[k], E[k + 1] || 0, E[k + 2] || 0);
      const sharp = after - before > 0 ? f / (after - before) : 0;
      const bassy = Math.max(share[k], share[k + 1] || 0) >= 0.35; // the hit itself is mostly bass
      if (f > Math.max(floor, ABS_FLOOR, 1.5 * m + 0.5 * sd) && sharp >= 0.55 && bassy && peak && k - last >= gap) {
        // strength on a fixed scale (not relative to the clip's loudest moment): a soft kick stays soft
        out.push({ t: (k * hop) / sr, s: Math.max(0.4, Math.min(1, f / 1.0)) });
        last = k;
      }
    }
    return out;
  }

  /** Index of the last onset at or before t (binary search), or −1. */
  function lastOnset(onsets, t) {
    let lo = 0, hi = onsets.length - 1, r = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (onsets[mid].t <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }
  /** "Punch" 0..1 at time t: 40 ms attack, exponential decay (tau s). Depends only on t → seekable. */
  function punchAt(onsets, t, tau = 0.15) {
    let p = 0;
    for (let i = lastOnset(onsets, t); i >= 0 && t - onsets[i].t < tau * 6; i--) {
      const d = t - onsets[i].t;
      p = Math.max(p, onsets[i].s * (d < 0.04 ? d / 0.04 : Math.exp(-(d - 0.04) / tau)));
    }
    return Math.min(1, p);
  }
  /** Cumulative bass "push" (monotonic in t): each hit adds its strength, eased over 0.4 s. */
  function bassPush(onsets, t) {
    let b = 0;
    for (let i = lastOnset(onsets, t); i >= 0; i--) b += onsets[i].s * (1 - Math.exp(-(t - onsets[i].t) / 0.8));
    return b;
  }
  /** Small seeded PRNG (mulberry32): the same "random" particles in every preview and export. */
  function prng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  /**
   * Where a particle is at "effect time" T (seconds, already sped up by bass hits). Pure: same T → same place.
   * p = { x, y, a (heading), v (speed, screen fractions / s), spin } from a seeded PRNG.
   * dir: 'up' | 'down' | 'drift' | 'burst' (out of the centre). → { x, y (0..1 frame fractions), rot (rad), life 0..1 }
   */
  function particleAt(p, T, dir = 'drift') {
    const wrap = (v) => ((v % 1) + 1) % 1;
    const rot = p.a + (p.spin || 0) * T;
    if (dir === 'up') return { x: wrap(p.x + 0.03 * Math.sin(T * 0.8 + p.a * 3)), y: wrap(p.y - p.v * 1.6 * T), rot, life: 1 };
    if (dir === 'down') return { x: wrap(p.x + 0.04 * Math.sin(T * 0.6 + p.a * 5)), y: wrap(p.y + p.v * 1.6 * T), rot, life: 1 };
    if (dir === 'burst') {
      // each particle flies out of the centre and starts again; life fades it in and out (no popping)
      const life = wrap(p.y + p.v * 3.6 * T); // QC: at 0.9 a burst looked frozen (one life took 30–110 s)
      const r = 0.06 + 0.6 * life;
      return { x: 0.5 + Math.cos(p.a * 6.283) * r * 0.75, y: 0.5 + Math.sin(p.a * 6.283) * r, rot, life };
    }
    return { x: wrap(p.x + Math.cos(p.a) * p.v * T), y: wrap(p.y + Math.sin(p.a) * p.v * T - 0.02 * T), rot, life: 1 };
  }

  /** Gentle fade-in/out over a particle's life (0 at birth and death, 1 in the middle): no sudden pops. */
  const lifeAlpha = (life) => Math.min(1, life / 0.15, (1 - life) / 0.15);

  /** Ripple rings from bass hits: [{ r (0..1 of max radius), a (alpha) }], ring lives `span` s, fades linearly. */
  function ripples(onsets, t, span = 1.2) {
    const out = [];
    for (let i = lastOnset(onsets, t); i >= 0 && t - onsets[i].t < span; i--) {
      const f = (t - onsets[i].t) / span;
      out.push({ r: f, a: 0.45 * onsets[i].s * (1 - f) });
    }
    return out;
  }

  /** Slowly varying 0..1 (cosine, `period` s): for slow background motion and colour flow — never fast. */
  const slowWave = (t, period = 8) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);

  /** Mix two #rrggbb colours → #rrggbb. */
  function mixHex(a, b, f) {
    const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    const ch = (s) => Math.round(((x >> s) & 255) * (1 - f) + ((y >> s) & 255) * f);
    return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
  }

  /** Mean of band groups: k groups over the band array (low → high). */
  function bandGroups(bands, k) {
    const out = new Float32Array(k), n = bands.length;
    for (let g = 0; g < k; g++) {
      const a = Math.floor((g * n) / k), b = Math.max(a + 1, Math.floor(((g + 1) * n) / k));
      let s = 0; for (let i = a; i < b; i++) s += bands[i]; out[g] = s / (b - a);
    }
    return out;
  }

  /* ---------------- Audio → Video layout ---------------- */
  /**
   * Where the cover art, title block, visualizer and time bar go, for any frame size (9:16, 4:5, 1:1, 16:9).
   * Zones are STACKED (never overlap): each layout lists its zones top→bottom and the art gets what is left.
   * layout: 'cover' (art, text, visualizer) | 'top' (text first: podcast) | 'minimal' (no art, big visualizer).
   * style 'circle' draws rays around the art: its full drawn size is reserved (1.44·A + 44u).
   * badge: reserve a band at the top for a small label ("SÁCH NÓI", "● ON AIR").
   * 9:16 (TikTok / Reels / Shorts): everything sits between 6 % and 78 % of the height — the app's own
   * caption, buttons and progress cover the bottom ~22 % (safe-zone guides: Revid, Ignite, aiCarousels).
   * Returns drawing fields + `zones` {badge?,art,text,vis,prog: [top, bottom]} used by the tests.
   */
  function avGeometry(W, H, layout = 'cover', style = 'bars', { badge = false, titleScale = 1 } = {}) {
    const u = Math.min(W, H) / 1080, fs = 64 * u * titleScale;
    const TEXT_TOP = 0.95 * fs; // accents above the first baseline
    const TEXT_H = 252 * u * titleScale; // 2 title lines + subtitle (drawText); script fonts are drawn larger
    const PROG_H = 76 * u; // knob (12u above the bar) + bar + time labels (34u)
    const BADGE_H = 72 * u;
    const rays = style === 'circle', vinyl = style === 'vinyl';
    // record / orb ARE the visual: no separate visualizer band (it was ~300 px of empty space)
    const artOnly = (vinyl || style === 'orb') && layout !== 'minimal';
    // full drawn size of the art: circle rays reach 0.72·A + 22u out, a record is 1.18·A with its tonearm
    const ring = (A) => (rays ? A * 1.44 + 44 * u : vinyl ? A * 1.18 : A);
    const fromRing = (R) => Math.max(40 * u, rays ? (R - 44 * u) / 1.44 : vinyl ? R / 1.18 : R);
    const land = W > H * 1.15;
    const z = (a, b) => [Math.round(a), Math.round(b)];

    if (land && layout !== 'minimal') {
      // art on the left, a column with title, visualizer and time bar on the right
      const A = Math.round(fromRing(Math.min(H * (rays ? 0.8 : 0.62), W * (rays ? 0.42 : 0.38))));
      const pad = (ring(A) - A) / 2;
      const ax = Math.round(W * 0.06 + pad), ay = Math.round((H - A) / 2);
      const tx = Math.round(ax + A + pad + W * 0.05), tw = Math.round(W - tx - W * 0.06);
      const gap = H * 0.05, vh = artOnly ? 0 : H * 0.22, bh = badge ? BADGE_H + gap * 0.6 : 0;
      const top0 = (H - (bh + TEXT_H + gap + vh + gap + PROG_H)) / 2, top = top0 + bh;
      const titleY = top + TEXT_TOP, vy = top + TEXT_H + gap, py = vy + vh + gap;
      const zones = { art: z(ay - pad, ay + A + pad), text: z(top, top + TEXT_H), vis: z(vy, vy + vh), prog: z(py - 12 * u, py + PROG_H), artX: z(ax - pad, ax + A + pad), colX: z(tx, tx + tw) };
      if (badge) zones.badge = z(top0, top0 + BADGE_H);
      return {
        u, A, ax, ay, tx, tw, align: 'left', titleY, vx: tx, vw: tw, vy, vh, py,
        badgeY: badge ? top0 + BADGE_H / 2 : null, badgeX: tx,
        zones,
      };
    }

    const gap = H * 0.035, margin = H * 0.06;
    const minimal = layout === 'minimal';
    const tall = H > W * 1.6; // 9:16
    // 9:16: TikTok's top bar covers ~6–10 %, so a label starts at 10 %; its right-hand icons cover x > 86 %
    const regionTop = tall ? H * (badge ? 0.1 : 0.06) : margin * 0.5, regionBottom = tall ? H * 0.78 : H - margin * 0.5;
    const side = tall ? 0.14 : 0.08; // symmetric inset keeps the centred design and clears the icon column
    const extra = badge ? BADGE_H + gap : 0;
    const vh = artOnly ? 0 : minimal ? H * (land ? 0.3 : 0.24) : H * (H > W * 1.3 ? 0.12 : 0.14);
    let A, order;
    if (minimal) {
      A = Math.round(fromRing(vh)); // only drawn for the circle style, inside the visualizer zone
      order = ['vis', 'text', 'prog'];
    } else {
      const nGap = artOnly ? 2 : 3;
      const avail = tall ? regionBottom - regionTop - (TEXT_H + vh + PROG_H + nGap * gap) - extra : H - (TEXT_H + vh + PROG_H + nGap * gap + 2 * margin) - extra;
      const cap = artOnly ? Math.min(W * 0.7, H * 0.48) : layout === 'top' ? Math.min(W * 0.5, H * 0.28) : Math.min(W * 0.64, H * 0.33);
      A = Math.round(Math.min(cap, fromRing(Math.min(avail, W * 0.84))));
      order = layout === 'top' ? ['text', 'art', 'vis', 'prog'] : ['art', 'text', 'vis', 'prog'];
      if (artOnly) order = order.filter((k) => k !== 'vis');
    }
    if (badge) order.unshift('badge');
    const size = { badge: BADGE_H, art: ring(A), text: TEXT_H, vis: vh, prog: PROG_H };
    const total = order.reduce((s, k) => s + size[k], 0) + gap * (order.length - 1);
    let y = tall ? regionTop + Math.max(0, (regionBottom - regionTop - total) * 0.45) : Math.max(margin * 0.5, (H - total) * 0.45);
    const zones = {};
    for (const k of order) { zones[k] = z(y, y + size[k]); y += size[k] + gap; }
    if (!zones.vis) zones.vis = z(zones.prog[0], zones.prog[0]); // art-only: an empty band just above the time bar
    const vy = zones.vis[0];
    const pad = (ring(A) - A) / 2;
    const ay = minimal ? Math.round(vy + vh / 2 - A / 2) : Math.round(zones.art[0] + pad);
    if (minimal) zones.art = z(ay - pad, ay + A + pad);
    const ax = Math.round((W - A) / 2);
    zones.artX = z(ax - pad, ax + A + pad);
    return {
      u, A, ax, ay, noArt: minimal, tx: W * side, tw: W * (1 - 2 * side), align: 'center',
      titleY: zones.text[0] + TEXT_TOP, vx: Math.round(W * side), vw: Math.round(W * (1 - 2 * side)), vy, vh, py: zones.prog[0] + 12 * u,
      badgeY: badge ? (zones.badge[0] + zones.badge[1]) / 2 : null, badgeX: W / 2,
      zones,
    };
  }

  /* ---------------- photo colour filters (slideshow templates) ---------------- */
  const FILTERS = ['none', 'bw', 'warm', 'cool', 'vintage'];
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  /** In-place colour filter on RGBA pixel data (alpha untouched). */
  function applyFilter(d, kind) {
    if (!kind || kind === 'none') return d;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      if (kind === 'bw') {
        const v = clamp255((y - 128) * 1.12 + 128); // a little extra contrast, like B&W film
        d[i] = d[i + 1] = d[i + 2] = v;
      } else if (kind === 'warm') {
        d[i] = clamp255(r * 1.08 + 10); d[i + 1] = clamp255(g * 1.02 + 4); d[i + 2] = clamp255(b * 0.88);
      } else if (kind === 'cool') {
        d[i] = clamp255(r * 0.9); d[i + 1] = clamp255(g * 1.0 + 2); d[i + 2] = clamp255(b * 1.08 + 10);
      } else if (kind === 'vintage') {
        // sepia mixed with the original, lifted blacks and softened whites (faded print)
        const sr = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b;
        d[i] = clamp255(20 + 0.82 * (0.6 * sr + 0.4 * r));
        d[i + 1] = clamp255(18 + 0.8 * (0.6 * sg + 0.4 * g));
        d[i + 2] = clamp255(16 + 0.76 * (0.6 * sb + 0.4 * b));
      }
    }
    return d;
  }

  /* ---------------- export helpers ---------------- */
  /**
   * Where the sound of a clip ends and how long its fade-out is (same rule on every export path).
   * srcDur = whole audio length, offset = clip start in it, duration = video length (seconds).
   */
  function audioFade(srcDur, offset, duration) {
    const end = Math.max(0.05, Math.min(duration, srcDur - offset));
    return { end, fade: Math.min(0.4, end / 4) };
  }
  /** Gain (0..1) at clip time t for a fade-out ending at `end`. */
  const fadeGain = (t, end, fade) => (t >= end ? 0 : t <= end - fade ? 1 : (end - t) / fade);

  /**
   * What the user will get before pressing "export".
   * speed = frames encoded per second measured on this device (0 = unknown), realtime = no fast encoder.
   * → { bytes, seconds (null = unknown), capped (bitrate lowered to fit maxBytes) }
   */
  function exportEstimate({ w, h, fps, duration, audio = true, maxBytes = 0, speed = 0, realtime = false }) {
    const full = bitrateFor(w, h, fps);
    const bps = bitrateFor(w, h, fps, duration, maxBytes);
    const frames = Math.max(1, Math.round(duration * fps));
    return {
      bytes: estimateBytes(bps, duration, audio),
      seconds: realtime ? duration : speed > 0 ? Math.max(1, Math.round(frames / speed)) : null,
      capped: bps < full,
    };
  }

  /**
   * Turns a raw browser error into a short Vietnamese explanation + what to do.
   * → { title, hint }
   */
  function friendlyError(message = '', name = '') {
    const m = String(message) + ' ' + String(name);
    if (/memory|allocation|RangeError|QuotaExceeded|Array buffer/i.test(m))
      return { title: 'Thiết bị hết bộ nhớ khi xuất video', hint: 'Thử chọn khung 720×1280, giảm “Thời lượng”, đóng bớt tab khác, hoặc xuất trên máy tính.' };
    if (/import|dynamically imported|Failed to fetch|NetworkError|Load failed|network/i.test(m))
      return { title: 'Không tải được thư viện xuất video', hint: 'Kiểm tra kết nối mạng rồi bấm “Thử lại”.' };
    if (/NotSupported|not supported|codec|encoder|configure|EncodingError/i.test(m))
      return { title: 'Trình duyệt không mã hoá được video với cài đặt này', hint: 'Thử khung 720×1280 hoặc 30 fps, hoặc dùng Chrome / Safari bản mới.' };
    if (/rời khỏi trang|hidden/i.test(m))
      return { title: 'Đã dừng vì trang bị ẩn', hint: 'Giữ màn hình mở và ở lại trang này đến khi xuất xong.' };
    if (/decode|giải mã/i.test(String(message)))
      return { title: 'Không đọc được file audio', hint: 'Thử đổi file sang MP3 / M4A / WAV.' };
    return { title: 'Xuất video bị lỗi', hint: 'Bấm “Thử lại”. Nếu vẫn lỗi, bấm “Sao chép thông tin lỗi” và gửi cho chúng tôi.' };
  }

  /* ---------------- creator tools: loudness (ITU-R BS.1770-4 / EBU R128) ---------------- */
  /** K-weighting biquads for a sample rate (libebur128 design: exact BS.1770 values at 48 kHz): [shelf, highpass]. */
  function kWeighting(sr) {
    let K = Math.tan((Math.PI * 1681.974450955533) / sr), Q = 0.7071752369554196;
    const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const shelf = { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
    K = Math.tan((Math.PI * 38.13547087602444) / sr); Q = 0.5003270373238773;
    a0 = 1 + K / Q + K * K;
    const hp = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
    return [shelf, hp];
  }

  /**
   * Integrated loudness (LUFS, gated) and sample peak of channels[*][from, to).
   * Pass the channels exactly as they will be heard (a mono song exported as stereo → [ch0, ch0]).
   * → { lufs (-Infinity for silence), peak (linear 0..1+) }. One pass, 100 ms segments, no copies of the audio.
   */
  function loudness(channels, sr, from = 0, to) {
    const len = channels[0] ? channels[0].length : 0;
    from = Math.max(0, Math.floor(from)); to = Math.min(len, to == null ? len : Math.floor(to));
    const seg = Math.max(1, Math.round(sr * 0.1)), nSeg = Math.max(1, Math.ceil((to - from) / seg));
    const segSum = new Float64Array(nSeg), segLen = new Float64Array(nSeg);
    const [f1, f2] = kWeighting(sr);
    let peak = 0;
    for (const x of channels) {
      let a1 = 0, a2 = 0, b1 = 0, b2 = 0; // filter states (direct form I)
      let c1 = 0, c2 = 0, d1 = 0, d2 = 0;
      for (let i = from; i < to; i++) {
        const v = x[i];
        const av = v < 0 ? -v : v; if (av > peak) peak = av;
        const y = f1.b[0] * v + f1.b[1] * a1 + f1.b[2] * a2 - f1.a[0] * b1 - f1.a[1] * b2;
        a2 = a1; a1 = v; b2 = b1; b1 = y;
        const z = f2.b[0] * y + f2.b[1] * c1 + f2.b[2] * c2 - f2.a[0] * d1 - f2.a[1] * d2;
        c2 = c1; c1 = y; d2 = d1; d1 = z;
        segSum[((i - from) / seg) | 0] += z * z;
      }
    }
    for (let s = 0; s < nSeg; s++) segLen[s] = Math.min(seg, to - from - s * seg);
    // 400 ms blocks (4 segments) with 75 % overlap; a clip shorter than one block is one block
    const blocks = [];
    const nb = nSeg >= 4 ? nSeg - 3 : 1;
    for (let j = 0; j < nb; j++) {
      let s = 0, n = 0;
      for (let k = j; k < Math.min(nSeg, j + 4); k++) { s += segSum[k]; n += segLen[k]; }
      if (n > 0) blocks.push(s / n);
    }
    const L = (z) => -0.691 + 10 * Math.log10(z);
    const abs = blocks.filter((z) => z > 0 && L(z) > -70);
    if (!abs.length) return { lufs: -Infinity, peak };
    const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const kept = abs.filter((z) => L(z) > rel);
    return { lufs: L(kept.reduce((a, b) => a + b, 0) / kept.length), peak };
  }

  /**
   * Incremental loudness index of a whole track: K-weighted energy and sample peak per 100 ms segment, built
   * once (in slices, so a 1-hour podcast never freezes the page) — then any range is measured instantly.
   * idx.step(maxFrames) → true when done. loudnessRange(idx, fromSec, toSec) → { lufs, peak }.
   */
  function loudnessIndex(channels, sr) {
    const len = channels[0] ? channels[0].length : 0;
    const seg = Math.max(1, Math.round(sr * 0.1)), nSeg = Math.max(1, Math.ceil(len / seg));
    const sum = new Float64Array(nSeg), peak = new Float32Array(nSeg);
    const [f1, f2] = kWeighting(sr);
    const st = channels.map(() => new Float64Array(8)); // filter states per channel
    let pos = 0;
    function step(maxFrames = Infinity) {
      const end = Math.min(len, pos + maxFrames);
      channels.forEach((x, c) => {
        const S = st[c];
        let a1 = S[0], a2 = S[1], b1 = S[2], b2 = S[3], c1 = S[4], c2 = S[5], d1 = S[6], d2 = S[7];
        for (let i = pos; i < end; i++) {
          const v = x[i], k = (i / seg) | 0;
          const av = v < 0 ? -v : v; if (av > peak[k]) peak[k] = av;
          const y = f1.b[0] * v + f1.b[1] * a1 + f1.b[2] * a2 - f1.a[0] * b1 - f1.a[1] * b2;
          a2 = a1; a1 = v; b2 = b1; b1 = y;
          const z = f2.b[0] * y + f2.b[1] * c1 + f2.b[2] * c2 - f2.a[0] * d1 - f2.a[1] * d2;
          c2 = c1; c1 = y; d2 = d1; d1 = z;
          sum[k] += z * z;
        }
        S[0] = a1; S[1] = a2; S[2] = b1; S[3] = b2; S[4] = c1; S[5] = c2; S[6] = d1; S[7] = d2;
      });
      pos = end;
      return pos >= len;
    }
    return { step, sr, seg, len, sum, peak, get done() { return pos >= len; }, get progress() { return len ? pos / len : 1; } };
  }

  /**
   * The same index built from a STREAM of chunks (no whole-song buffer): push(channels) as decoded slices arrive.
   * A 40-minute soundtrack costs ~300 KB instead of ~1 GB of samples. → { push, sr, seg, len, sum, peak }
   */
  function loudnessStream(sr, nCh = 2) {
    const seg = Math.max(1, Math.round(sr * 0.1));
    const [f1, f2] = kWeighting(sr);
    const st = Array.from({ length: nCh }, () => new Float64Array(8));
    const out = { sr, seg, len: 0, sum: new Float64Array(64), peak: new Float32Array(64) };
    const grow = (n) => {
      if (n <= out.sum.length) return;
      let m = out.sum.length; while (m < n) m *= 2;
      const s2 = new Float64Array(m); s2.set(out.sum); out.sum = s2;
      const p2 = new Float32Array(m); p2.set(out.peak); out.peak = p2;
    };
    out.push = (channels) => {
      const n = channels[0] ? channels[0].length : 0, pos = out.len;
      grow(Math.ceil((pos + n) / seg) + 1);
      const sum = out.sum, peak = out.peak;
      channels.slice(0, nCh).forEach((x, c) => {
        const S = st[c];
        let a1 = S[0], a2 = S[1], b1 = S[2], b2 = S[3], c1 = S[4], c2 = S[5], d1 = S[6], d2 = S[7];
        for (let j = 0; j < n; j++) {
          const v = x[j], k = ((pos + j) / seg) | 0;
          const av = v < 0 ? -v : v; if (av > peak[k]) peak[k] = av;
          const y = f1.b[0] * v + f1.b[1] * a1 + f1.b[2] * a2 - f1.a[0] * b1 - f1.a[1] * b2;
          a2 = a1; a1 = v; b2 = b1; b1 = y;
          const z = f2.b[0] * y + f2.b[1] * c1 + f2.b[2] * c2 - f2.a[0] * d1 - f2.a[1] * d2;
          c2 = c1; c1 = y; d2 = d1; d1 = z;
          sum[k] += z * z;
        }
        S[0] = a1; S[1] = a2; S[2] = b1; S[3] = b2; S[4] = c1; S[5] = c2; S[6] = d1; S[7] = d2;
      });
      out.len = pos + n;
    };
    return out;
  }

  /** Gated loudness of [fromSec, toSec) from an index (segment resolution: 100 ms). */
  function loudnessRange(idx, fromSec = 0, toSec) {
    const n = idx.sum.length;
    const a = Math.max(0, Math.min(n - 1, Math.floor((fromSec * idx.sr) / idx.seg)));
    const b = Math.max(a + 1, Math.min(n, Math.ceil(((toSec == null ? idx.len / idx.sr : toSec) * idx.sr) / idx.seg)));
    let peak = 0;
    for (let k = a; k < b; k++) if (idx.peak[k] > peak) peak = idx.peak[k];
    const segLen = (k) => Math.min(idx.seg, idx.len - k * idx.seg);
    const blocks = [];
    const nb = b - a >= 4 ? b - a - 3 : 1;
    for (let j = 0; j < nb; j++) {
      let s = 0, m = 0;
      for (let k = a + j; k < Math.min(b, a + j + 4); k++) { s += idx.sum[k]; m += segLen(k); }
      if (m > 0) blocks.push(s / m);
    }
    const L = (z) => -0.691 + 10 * Math.log10(z);
    const abs = blocks.filter((z) => z > 0 && L(z) > -70);
    if (!abs.length) return { lufs: -Infinity, peak };
    const rel = L(abs.reduce((x, y) => x + y, 0) / abs.length) - 10;
    const kept = abs.filter((z) => L(z) > rel);
    return { lufs: L(kept.reduce((x, y) => x + y, 0) / kept.length), peak };
  }

  /**
   * The two channels a listener hears, as the export mixes them (Web Audio "speakers" down-mix):
   * mono → [m, m]; stereo as is; quad → 0.5·(L+SL), 0.5·(R+SR); 5.1 → L + 0.7071·(C+SL), R + 0.7071·(C+SR)
   * (LFE dropped); other counts → the first two ("discrete"). Only >2 channels allocate new arrays.
   */
  function downmixStereo(ch) {
    const n = ch.length;
    if (n === 1) return [ch[0], ch[0]];
    if (n === 2 || (n !== 4 && n !== 6)) return [ch[0], ch[1]];
    const len = ch[0].length, L = new Float32Array(len), R = new Float32Array(len);
    if (n === 4) for (let i = 0; i < len; i++) { L[i] = 0.5 * (ch[0][i] + ch[2][i]); R[i] = 0.5 * (ch[1][i] + ch[3][i]); }
    else { const k = Math.SQRT1_2; for (let i = 0; i < len; i++) { L[i] = ch[0][i] + k * (ch[2][i] + ch[4][i]); R[i] = ch[1][i] + k * (ch[2][i] + ch[5][i]); } }
    return [L, R];
  }

  /** Loudness targets (integrated LUFS) the creator can pick. */
  const LOUDNESS_TARGETS = { social: -14, podcast: -16 };

  /**
   * Gain that brings {lufs, peak} to `target` LUFS without the sample peak going over `ceilingDb` (dBFS).
   * Silence / unmeasurable audio → gain 1. Never boosts more than +20 dB (it would only raise the noise).
   * → { gain, db, limited }  (limited = the peak ceiling, not the target, decided the gain)
   */
  function normGain(m, target = -14, ceilingDb = -1.5) {
    if (!m || !isFinite(m.lufs) || !(m.peak > 0)) return { gain: 1, db: 0, limited: false };
    const want = Math.min(Math.pow(10, (target - m.lufs) / 20), 10);
    const cap = Math.pow(10, ceilingDb / 20) / m.peak;
    const gain = Math.min(want, cap);
    return { gain, db: 20 * Math.log10(gain), limited: cap < want };
  }

  /* ---------------- creator tools: platform safe zones (1080×1920 vertical) ---------------- */
  /**
   * Parts of a vertical video covered by each app's buttons / caption / username, as fractions of the frame.
   * No platform publishes these for organic posts: values are the conservative end of measured guides (2025–26).
   */
  const SAFE_ZONES = {
    tiktok: { label: 'TikTok', top: 0.068, bottom: 0.25, left: 0.056, right: 0.14 },
    reels: { label: 'Reels', top: 0.14, bottom: 0.35, left: 0.056, right: 0.11 },
    shorts: { label: 'Shorts', top: 0.0625, bottom: 0.3, left: 0.056, right: 0.18 },
  };
  /** Safe rectangle (px) of a W×H frame for a platform, or null (unknown platform / not a vertical frame). */
  function safeRect(platform, W, H) {
    const z = SAFE_ZONES[platform];
    if (!z || !(W > 0 && H > 0) || W / H > 0.8) return null;
    const x = Math.round(W * z.left), y = Math.round(H * z.top);
    return { x, y, w: Math.round(W * (1 - z.right)) - x, h: Math.round(H * (1 - z.bottom)) - y };
  }

  /** Where an iw×ih picture is drawn inside a bw×bh box with object-fit: contain → {x, y, w, h}. */
  function containRect(iw, ih, bw, bh) {
    if (!(iw > 0 && ih > 0 && bw > 0 && bh > 0)) return { x: 0, y: 0, w: 0, h: 0 };
    const s = Math.min(bw / iw, bh / ih), w = iw * s, h = ih * s;
    return { x: (bw - w) / 2, y: (bh - h) / 2, w, h };
  }

  /* ---------------- creator tools: WAV ---------------- */
  /** 16-bit PCM WAV of channels[*][from, to) × gain (clipped, rounded). → Uint8Array */
  function encodeWav(channels, sr, from = 0, to, gain = 1) {
    const nch = channels.length, len = channels[0].length;
    from = Math.max(0, Math.floor(from)); to = Math.min(len, to == null ? len : Math.floor(to));
    const n = Math.max(0, to - from), bytes = n * nch * 2;
    const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, bytes, true);
    const out = new Int16Array(buf, 44, n * nch);
    for (let c = 0; c < nch; c++) {
      const x = channels[c];
      for (let i = 0, o = c; i < n; i++, o += nch) {
        let s = x[from + i] * gain;
        s = s > 1 ? 1 : s < -1 ? -1 : s;
        out[o] = Math.round(s < 0 ? s * 32768 : s * 32767);
      }
    }
    return new Uint8Array(buf);
  }

  /**
   * The same WAV as encodeWav, as a list of parts (header + ~10-second PCM chunks): a Blob made from them never
   * needs one huge contiguous copy of a long recording in memory.
   */
  function wavParts(channels, sr, from = 0, to, gain = 1, chunkSec = 10) {
    const nch = channels.length, len = channels[0].length;
    from = Math.max(0, Math.floor(from)); to = Math.min(len, to == null ? len : Math.floor(to));
    const n = Math.max(0, to - from);
    const head = encodeWav(channels.map(() => new Float32Array(0)), sr).slice(0, 44);
    const v = new DataView(head.buffer);
    v.setUint32(4, 36 + n * nch * 2, true); v.setUint32(40, n * nch * 2, true);
    const parts = [head], step = Math.max(1, Math.round(chunkSec * sr));
    for (let p = from; p < to; p += step) parts.push(encodeWav(channels, sr, p, Math.min(to, p + step), gain).subarray(44));
    return parts;
  }

  /* ---------------- creator tools: thumbnails & captions ---------------- */
  /** "Cách *kiếm tiền* online" → [{t:'Cách ', hi:false}, {t:'kiếm tiền', hi:true}, {t:' online', hi:false}] */
  function parseHighlight(text) {
    const out = [];
    const re = /\*([^*\n]+)\*/g;
    let last = 0, m;
    const s = String(text);
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ t: s.slice(last, m.index), hi: false });
      out.push({ t: m[1], hi: true });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ t: s.slice(last), hi: false });
    return out;
  }

  /**
   * Binary-search the encoder quality so the file stays ≤ maxBytes. encode(q) → Promise<Blob-like {size}>.
   * → { blob, q, fits } (the smallest attempt when even the lowest quality is too big). At most ~7 encodes.
   */
  async function fitQuality(encode, maxBytes, lo = 0.5, hi = 0.95) {
    let best = await encode(hi);
    if (best.size <= maxBytes) return { blob: best, q: hi, fits: true };
    let smallest = { blob: best, q: hi }, okBlob = null, okQ = 0;
    for (let i = 0; i < 6; i++) {
      const q = Math.round(((lo + hi) / 2) * 1000) / 1000;
      const b = await encode(q);
      if (b.size < smallest.blob.size) smallest = { blob: b, q };
      if (b.size <= maxBytes) { okBlob = b; okQ = q; lo = q; } else hi = q;
    }
    if (!okBlob) {
      const b = await encode(lo);
      if (b.size <= maxBytes) return { blob: b, q: lo, fits: true };
      return { blob: b.size < smallest.blob.size ? b : smallest.blob, q: b.size < smallest.blob.size ? lo : smallest.q, fits: false };
    }
    return { blob: okBlob, q: okQ, fits: true };
  }

  /** Character limits of the places creators type text (2026). */
  const TEXT_LIMITS = {
    ytTitle: { label: 'Tiêu đề YouTube', max: 100 },
    ytDesc: { label: 'Mô tả YouTube', max: 5000 },
    tiktok: { label: 'Caption TikTok', max: 4000 },
    reels: { label: 'Caption Reels', max: 2200 },
  };
  /**
   * Counts for a caption: characters as people see them (emoji = 1), #hashtags (unique, case-insensitive)
   * and the warnings that matter. → { chars, hashtags: [...], over: {key: n}, warnings: [...] }
   */
  function captionStats(text) {
    const s = String(text || '');
    const chars = graphemes(s).length;
    const tags = [];
    const seen = new Set();
    for (const m of s.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
      const k = m[1].toLowerCase();
      if (!seen.has(k)) { seen.add(k); tags.push('#' + m[1]); }
    }
    const over = {};
    for (const [k, l] of Object.entries(TEXT_LIMITS)) if (chars > l.max) over[k] = chars - l.max;
    const warnings = [];
    if (tags.length > 60) warnings.push('YouTube bỏ qua TẤT CẢ hashtag khi có hơn 60 hashtag.');
    else if (tags.length > 15) warnings.push('Nhiều hashtag quá dễ bị xem là spam — nên dùng 3–5 hashtag sát nội dung.');
    if (/(^|\s)#(\s|$)/u.test(s)) warnings.push('Có dấu # đứng một mình hoặc hashtag bị cách — hashtag không được có dấu cách.');
    return { chars, hashtags: tags, over, warnings };
  }

  /* ---------------- captions (burned-in subtitles) ---------------- */
  /** "01:02:03,450" / "02:03.45" / "1:02" / "62.5" → seconds (NaN if not a time). */
  function parseCueTime(s) {
    const m = String(s).trim().match(/^(?:(\d+):)?(?:(\d{1,2}):)?(\d+(?:[.,]\d+)?)$/);
    if (!m) return NaN;
    const [h, mm] = m[2] !== undefined ? [+m[1] || 0, +m[2]] : [0, +m[1] || 0];
    return h * 3600 + mm * 60 + parseFloat(m[3].replace(',', '.'));
  }
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  /** Cue text without markup: <i>, <c.x>, <v Name>, <00:01.000> karaoke stamps, {\an8} ASS tags, entities. */
  /** &#…; / &#x…; → the character, only for real code points (a bad one stays as written instead of throwing). */
  const decodeNum = (x, e) => {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : x;
  };
  // only real tags: "I <3 you, 5 > 3" keeps its text (a catch-all <…> pattern ate it)
  const CUE_TAG = /<\/?(?:b|i|u|c|v|ruby|rt|lang|font|span)(?:[.\s][^<>]*)?>|<\d+:\d{2}(?::\d{2})?[.,]\d{1,3}>/gi;
  const cleanCueText = (s) => String(s)
    .replace(CUE_TAG, '').replace(/\{\\[^}]*\}/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (x, e) => (e[0] === '#' ? decodeNum(x, e) : ENTITIES[e.toLowerCase()] ?? x))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ').normalize('NFC');

  /**
   * SRT or WebVTT text → [{start, end, text}] (seconds, sorted by start; empty / reversed cues dropped).
   * Read line by line: a "-->" line always starts a new cue, so a hand-edited file that lost the blank line
   * between two cues still gives two captions (the index number left on the previous cue is dropped).
   */
  function parseSubtitles(src) {
    const lines = String(src).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const body = cleanCueText(cur.body.join('\n'));
      if (cur.end > cur.start && body) out.push({ start: cur.start, end: cur.end, text: body });
      cur = null;
    };
    for (const l of lines) {
      if (l.includes('-->')) {
        if (cur && cur.body.length && /^\s*\d+\s*$/.test(cur.body[cur.body.length - 1])) cur.body.pop();
        flush();
        const [a, b] = l.split('-->');
        cur = { start: parseCueTime(a), end: parseCueTime(String(b).trim().split(/\s+/)[0]), body: [] }; // VTT cue settings after the time
      } else if (!l.trim()) flush(); // end of a cue; NOTE / STYLE blocks and identifiers outside cues are skipped
      else if (cur) cur.body.push(l);
    }
    flush();
    return out.sort((x, y) => x.start - y.start);
  }

  /**
   * Is this file timed from the start of the chosen clip (like the .srt this app downloads) rather than from
   * the start of the song? Only decidable when the clip does not start at 0: every cue fits inside the clip
   * length, and the file would otherwise put (some of) its captions before the clip.
   */
  function srtLooksClipRelative(cues, clipStart, clipDur) {
    if (!(clipStart > 0) || !cues.length) return false;
    return cues.every((c) => c.end <= clipDur + 0.5) && cues[0].start < clipStart;
  }

  /** 3723.45 → "01:02:03,450" (SRT). */
  function srtTime(t) {
    const ms = Math.max(0, Math.round(t * 1000));
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  }
  /** Cues → SRT file text (for YouTube / CapCut). */
  const toSRT = (cues) => cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');

  /** Pasted lyrics / script → one caption per non-empty line. */
  const captionLines = (text) => String(text).normalize('NFC').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  /**
   * Untimed lines spread over [from, to): each line gets time in proportion to its length (people read / speak
   * long lines longer), at least 0.6 s of weight so "Ừ." still shows.
   */
  function spreadCues(lines, from, to) {
    if (!lines.length || !(to > from)) return [];
    const w = lines.map((l) => Math.max(6, graphemes(l).length));
    const total = w.reduce((a, b) => a + b, 0);
    let t = from;
    return lines.map((text, i) => { const start = t; t = i === lines.length - 1 ? to : t + ((to - from) * w[i]) / total; return { start, end: t, text }; });
  }

  /** Move every cue by dt seconds (sync fix); cues pushed fully before 0 are dropped, the rest clamped at 0. */
  const shiftCues = (cues, dt) => cues.map((c) => ({ ...c, start: Math.max(0, c.start + dt), end: c.end + dt })).filter((c) => c.end > c.start);

  /**
   * Silences removed from the song (cuts = [{from, to}] in the original timeline, sorted, not overlapping):
   * an original time → its time in the shortened song (inside a cut → where the cut was).
   */
  function mapTime(t, cuts) {
    let removed = 0;
    for (const c of cuts || []) {
      if (t <= c.from) break;
      removed += Math.min(t, c.to) - c.from;
    }
    return t - removed;
  }
  /** Inverse of mapTime: a time in the shortened song → the original time (cut-out parts are skipped). */
  function unmapTime(t, cuts) {
    let o = t;
    for (const c of cuts || []) { if (o < c.from) break; o += c.to - c.from; }
    return o;
  }
  /** Cues (original timeline) → cues on the shortened song; captions that fell inside a cut are dropped. */
  const remapCues = (cues, cuts) => (cuts && cuts.length
    ? cues.map((c) => ({ ...c, start: mapTime(c.start, cuts), end: mapTime(c.end, cuts) })).filter((c) => c.end - c.start >= 0.05)
    : cues);

  /** Index of the cue showing at time t (cues sorted by start), or -1. On overlap the later cue wins. */
  const maxEnds = new WeakMap();
  function cueAt(cues, t) {
    let lo = 0, hi = cues.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].start <= t) { k = m; lo = m + 1; } else hi = m - 1; }
    // running max of the ends: a long cue under several short ones is still found (only 4 back were checked)
    let me = maxEnds.get(cues);
    if (!me || me.length !== cues.length) {
      me = new Float64Array(cues.length);
      cues.forEach((c, i) => { me[i] = Math.max(c.end, i ? me[i - 1] : -Infinity); });
      maxEnds.set(cues, me);
    }
    for (let i = k; i >= 0 && me[i] > t; i--) if (t < cues[i].end) return i;
    return -1;
  }

  /**
   * Word-by-word highlight: which word of the cue is being said at t (−1 before the cue). Words get time in
   * proportion to their length; the last word stays lit until the cue ends.
   */
  function activeWord(text, start, end, t) {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (!words.length || t < start) return -1;
    const w = words.map((x) => graphemes(x).length + 1), total = w.reduce((a, b) => a + b, 0);
    let acc = 0;
    const f = ((Math.min(t, end) - start) / Math.max(1e-6, end - start)) * total;
    for (let i = 0; i < words.length; i++) { acc += w[i]; if (f < acc) return i; }
    return words.length - 1;
  }

  /**
   * Where captions may be drawn (px): on a vertical frame, the part safe on TikTok AND Reels AND Shorts
   * (the strictest edges of all three); on other frames, a 5 % side margin and the bottom 10 % kept clear.
   */
  function captionRect(W, H) {
    const rs = ['tiktok', 'reels', 'shorts'].map((p) => safeRect(p, W, H));
    if (rs.every(Boolean)) {
      const x = Math.max(...rs.map((r) => r.x)), y = Math.max(...rs.map((r) => r.y));
      const x2 = Math.min(...rs.map((r) => r.x + r.w)), y2 = Math.min(...rs.map((r) => r.y + r.h));
      return { x, y, w: x2 - x, h: y2 - y };
    }
    const x = Math.round(W * 0.05), y = Math.round(H * 0.05);
    return { x, y, w: W - 2 * x, h: Math.round(H * 0.9) - y };
  }

  /**
   * Top y of an h-tall caption block in `rect`: as low as possible (bottom of the safe box, where viewers expect
   * subtitles) but never over the video's own title / text (avoid = [[y0, y1], …]). If no free spot fits, the bottom.
   */
  function captionTop(rect, h, avoid = [], gap = 0) {
    const y = captionSpot(rect, h, avoid, gap);
    return y === null ? rect.y + rect.h - h : y;
  }
  /** Lowest free top y for an h-tall block, or null when nothing fits. */
  function captionSpot(rect, h, avoid = [], gap = 0) {
    const lo = rect.y, hi = rect.y + rect.h - h;
    const free = (y) => y >= lo - 0.5 && y <= hi + 0.5 && avoid.every(([a, b]) => y + h + gap <= a || y >= b + gap);
    const cands = [hi, ...avoid.flatMap(([a, b]) => [a - gap - h, b + gap])].filter(free);
    return cands.length ? Math.max(...cands) : null;
  }
  /**
   * avoid given as LAYERS (most to least protected sets of rows): the first layer that leaves room wins.
   * E.g. [[title, art, visualizer, bar], [title, art, bar], [title]] → over the visualizer before the cover art.
   */
  function captionTopLayers(rect, h, layers, gap = 0) {
    for (const avoid of layers) { const y = captionSpot(rect, h, avoid, gap); if (y !== null) return y; }
    return rect.y + rect.h - h;
  }

  /* ---------------- reframe a video (“Cắt & đổi khung video”) ---------------- */
  /** 75.25 → "1:15,3": a time to a tenth of a second (formatTime would round 0,5 s away). */
  function formatTenths(v) {
    const x = Math.round((+v || 0) * 10) / 10, m = Math.floor(x / 60);
    return `${m}:${(x - m * 60).toFixed(1).padStart(4, '0').replace('.', ',')}`;
  }
  /** Output frames at 1080 px wide (what TikTok / Reels / Shorts / Instagram recommend). */
  const REFRAME_FRAMES = { '9:16': { w: 1080, h: 1920 }, '1:1': { w: 1080, h: 1080 }, '4:5': { w: 1080, h: 1350 } };
  /** Output size: a named frame, or "keep" = the source's own shape with the long side ≤ 1920 (even numbers). */
  function reframeSize(frame, sw, sh) {
    const f = REFRAME_FRAMES[frame];
    if (f) return { w: f.w, h: f.h };
    if (!(sw > 0 && sh > 0)) return { w: 0, h: 0 };
    const s = Math.min(1, 1920 / Math.max(sw, sh));
    return { w: even(sw * s), h: even(sh * s) };
  }
  /**
   * "Cắt cho đầy khung": the largest rectangle of the output's shape inside the source. pos (0..1) slides it along
   * the axis that has room — 0 = left (top), 0.5 = centre, 1 = right (bottom). → { left, top, width, height, axis }
   * in source pixels, even sizes, always inside the source; axis = 'x' | 'y' | null (same shape: nothing to slide).
   */
  function reframeCrop(sw, sh, ow, oh, pos = 0.5) {
    const p = Number.isFinite(+pos) ? Math.min(1, Math.max(0, +pos)) : 0.5;
    const a = ow / oh;
    let width = even(sw), height = even(sh);
    if (sw / sh > a) width = Math.min(width, even(sh * a));
    else height = Math.min(height, even(sw / a));
    const axis = sw - width >= 2 ? 'x' : sh - height >= 2 ? 'y' : null;
    return { left: Math.round((sw - width) * p), top: Math.round((sh - height) * p), width, height, axis };
  }
  /**
   * Dragging the picture in the preview by `d` output pixels (right / down = positive) moves the crop the other
   * way, like sliding a photo under a frame. slack = the room left over, in output pixels.
   */
  function reframeDrag(pos, d, slack) {
    if (!(slack > 0)) return pos;
    return Math.min(1, Math.max(0, pos - d / slack));
  }
  /** Room (output pixels) the crop can slide by: what to divide a drag by. */
  function reframeSlack(sw, sh, ow, oh) {
    const c = reframeCrop(sw, sh, ow, oh);
    return c.axis === 'x' ? (sw - c.width) * (ow / c.width) : c.axis === 'y' ? (sh - c.height) * (oh / c.height) : 0;
  }
  /** "Thu nhỏ" (nền mờ / nền màu): where the whole picture goes inside the output, whole pixels. */
  function reframeFit(sw, sh, ow, oh) {
    const r = containRect(sw, sh, ow, oh);
    const w = Math.round(r.w), h = Math.round(r.h);
    return { x: Math.round((ow - w) / 2), y: Math.round((oh - h) / 2), w, h };
  }
  /**
   * The part of the video to keep. end empty / 0 = to the end. → { start, end, error } (error in Vietnamese or null).
   */
  /**
   * What a person types for a time: "2,5" / "2.5" (Vietnamese decimal comma) / "1:15,3" / "75". → seconds, or NaN.
   * (type=number in Chrome with a Vietnamese locale turned "2,5" into 25.)
   */
  function parseSeconds(v) {
    const s = String(v == null ? '' : v).trim().replace(/,/g, '.');
    if (!s) return NaN;
    const m = s.match(/^(?:(\d+):)?(\d+(?:\.\d*)?|\.\d+)$/);
    return m ? (+m[1] || 0) * 60 + parseFloat(m[2]) : NaN;
  }

  function reframeSegment(start, end, dur) {
    const s = Math.max(0, parseSeconds(start) || 0), en = parseSeconds(end);
    const e = !(en > 0) ? dur : Math.min(dur, en);
    if (!(dur > 0)) return { start: 0, end: 0, error: 'Chưa có video' };
    if (s >= dur) return { start: s, end: e, error: `Điểm bắt đầu (${formatTime(s)}) phải trước khi video hết (${formatTime(dur)})` };
    if (e - s < 0.5) return { start: s, end: e, error: 'Đoạn cần dài ít nhất 0,5 giây — điểm kết thúc phải sau điểm bắt đầu' };
    return { start: s, end: e, error: null };
  }

  /** Files bigger than this are refused before reading them into memory (a phone tab would crash instead). */
  const MAX_FILE_BYTES = { image: 150 * 1048576, audio: 1024 * 1048576, subtitle: 2 * 1048576 };
  /** → error message (Vietnamese) or null. */
  function checkFileSize(file, kind) {
    const max = MAX_FILE_BYTES[kind];
    if (!max || !file || !(file.size > max)) return null;
    return `"${file.name}" quá lớn (${formatBytes(file.size)}) — tối đa ${formatBytes(max)} cho ${kind === 'image' ? 'ảnh' : kind === 'subtitle' ? 'file phụ đề' : 'audio/video'}.`;
  }

  /* ---------------- text video: when slides change, keyword highlight, reading time ---------------- */
  const MIN_SLIDE = 0.5; // no slide shorter than this (s): a flash nobody can read

  /**
   * When each slide starts (seconds from the start of the video).
   *  mode 'even' — equal parts (or `fixedSeg` each);
   *  mode 'beat' — each change moves to the nearest drum hit (`onsets`, [{t}], from bassOnsets) within half a slide;
   *  mode 'tap'  — the moments the user tapped while listening (`taps`); slides without a tap share what is left.
   * `audioDur` = usable music length (after the chosen start). → { starts, duration, snapped }
   */
  function slidePlan({ n, mode = 'even', fixedSeg = 0, audioDur = 0, onsets = [], taps = [] }) {
    n = Math.max(1, n | 0);
    const base = slideTiming(n, fixedSeg, audioDur);
    const even = (from, k, end) => Array.from({ length: k }, (_, i) => from + ((end - from) * i) / k);
    if (mode === 'tap' && taps.length) {
      const seg = fixedSeg > 0 ? fixedSeg : 3;
      const kept = [];
      let prev = 0;
      for (const t of [...taps].sort((a, b) => a - b)) {
        if (kept.length >= n - 1) break;
        if (t - prev < MIN_SLIDE || (audioDur > 0 && t > audioDur - MIN_SLIDE)) continue; // double tap / too late
        kept.push(t);
        prev = t;
      }
      const left = n - 1 - kept.length; // slides that got no tap
      let duration;
      if (audioDur > 0) duration = audioDur;
      else duration = prev + seg * (left + 1);
      const tail = even(prev, left + 1, duration).slice(1);
      return { starts: [0, ...kept, ...tail], duration, snapped: 0 };
    }
    const starts = even(0, n, base.duration);
    if (fixedSeg > 0) for (let i = 0; i < n; i++) starts[i] = i * base.seg; // slides past the music end stay hidden
    let snapped = 0;
    // slides under 1 s each: moving a change by up to half a slide would push the last slides past the end
    const tooShort = mode === 'beat' && base.seg < 2 * MIN_SLIDE;
    if (mode === 'beat' && !tooShort && onsets.length && audioDur > 0) {
      const win = base.seg / 2;
      for (let i = 1; i < n; i++) {
        const target = starts[i], lo = starts[i - 1] + MIN_SLIDE, hi = base.duration - MIN_SLIDE;
        let best = null;
        for (let j = Math.max(0, lastOnset(onsets, target - win)); j < onsets.length && onsets[j].t <= target + win; j++) {
          const t = onsets[j].t;
          if (t < lo || t > hi || Math.abs(t - target) > win) continue;
          if (best === null || Math.abs(t - target) < Math.abs(best - target)) best = t;
        }
        if (best !== null) { starts[i] = best; snapped++; } else starts[i] = Math.max(target, lo);
      }
    }
    return { starts, duration: base.duration, snapped, tooShort };
  }

  /** Index of the slide shown at time t (last start ≤ t). */
  function slideAt(starts, t) {
    let lo = 0, hi = starts.length - 1, r = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (starts[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  }

  /**
   * "Mẹo *tiết kiệm* tiền" → { plain: 'Mẹo tiết kiệm tiền', words: [{w:'Mẹo',hi:false},{w:'tiết',hi:true},…] }.
   * A word is highlighted when any part of it is inside *stars*.
   */
  function highlightWords(text) {
    const segs = parseHighlight(text);
    const plain = segs.map((s) => s.t).join('');
    const flag = new Uint8Array(plain.length);
    let p = 0;
    for (const s of segs) { if (s.hi) flag.fill(1, p, p + s.t.length); p += s.t.length; }
    const words = [];
    for (const m of plain.matchAll(/\S+/g)) {
      const f = flag.subarray(m.index, m.index + m[0].length);
      const a = f.indexOf(1), b = f.lastIndexOf(1) + 1;
      // a / b: the highlighted part of the word ("*sách*," → the comma stays outside the box)
      words.push(a < 0 ? { w: m[0], hi: false } : { w: m[0], hi: true, a, b });
    }
    return { plain, words };
  }

  /**
   * Split wrapped lines (from `wrap` of the plain text — words in order, long words maybe broken in pieces)
   * into runs [{t, hi}] whose texts join back to exactly the line. The space between two highlighted
   * words is highlighted too (one box), any other space is not.
   */
  function lineHighlights(lines, words) {
    let wi = 0, rem = '', hi = false;
    return lines.map((line) => {
      const toks = line ? line.split(' ') : [];
      // each token → parts [{t, hi}]; a whole (unbroken) word keeps punctuation outside its *stars* unboxed
      const parts = toks.map((tok) => {
        let whole = false, w = null;
        if (!rem) { w = words[wi++] || { w: tok, hi: false }; rem = w.w; hi = w.hi; whole = tok === w.w; }
        rem = rem.startsWith(tok) ? rem.slice(tok.length) : '';
        if (whole && hi && (w.a > 0 || w.b < tok.length)) {
          return [{ t: tok.slice(0, w.a), hi: false }, { t: tok.slice(w.a, w.b), hi: true }, { t: tok.slice(w.b), hi: false }].filter((x) => x.t);
        }
        return [{ t: tok, hi }];
      });
      const runs = [];
      const push = (t, h) => { const last = runs[runs.length - 1]; if (last && last.hi === h) last.t += t; else runs.push({ t, hi: h }); };
      parts.forEach((ps, i) => {
        if (i > 0) push(' ', parts[i - 1][parts[i - 1].length - 1].hi && ps[0].hi);
        ps.forEach((x) => push(x.t, x.hi));
      });
      return runs.length ? runs : [{ t: line, hi: false }];
    });
  }

  /**
   * Word-by-word reveal at progress a (0..1) over lines with `counts` words each.
   * → { shown: words visible, cur: global index of the word appearing now (-1 = none), p: its own progress 0..1 }
   */
  function wordReveal(counts, a) {
    const N = counts.reduce((s, c) => s + c, 0);
    if (!N) return { shown: 0, cur: -1, p: 1 };
    if (a >= 1) return { shown: N, cur: N - 1, p: 1 };
    const f = Math.max(0, a) * N, shown = Math.ceil(f);
    return { shown, cur: shown - 1, p: shown ? f - (shown - 1) : 0 };
  }

  /** Progress 0..1 of line i of n when lines enter one after another (each starts 0.35 of a line later). */
  function lineStagger(i, n, a) {
    const step = 0.35, span = 1 + (Math.max(1, n) - 1) * step;
    return Math.max(0, Math.min(1, a * span - i * step));
  }

  /** Seconds a viewer needs to read a slide on a phone (~3 words/s, at least 1 s). Stars don't count. */
  function readTime(text) {
    const n = (String(text).replace(/\*/g, '').match(/\S+/g) || []).length;
    return Math.max(1, 0.4 + n / 3);
  }

  /** Slides shown too briefly to read, or never shown (start past the end). → [{ i, have, need, hidden }] */
  function readWarnings(slides, starts, duration) {
    const out = [];
    slides.forEach((s, i) => {
      const end = Math.min(duration, i + 1 < starts.length ? starts[i + 1] : duration);
      const have = Math.max(0, end - starts[i]);
      const need = readTime(s);
      if (starts[i] >= duration - 0.01) out.push({ i, have: 0, need, hidden: true });
      else if (have + 0.05 < need) out.push({ i, have, need, hidden: false });
    });
    return out;
  }

  return {
    slidePlan, slideAt, highlightWords, lineHighlights, readTime, readWarnings, MIN_SLIDE, wordReveal, lineStagger,
    parseCueTime, cleanCueText, parseSubtitles, srtTime, toSRT, captionLines, spreadCues, shiftCues, mapTime, unmapTime, remapCues, cueAt, activeWord, captionRect, captionTop, captionSpot, captionTopLayers, srtLooksClipRelative,
    REFRAME_FRAMES, formatTenths, parseSeconds, loudnessStream, reframeSize, reframeCrop, reframeDrag, reframeSlack, reframeFit, reframeSegment,
    kWeighting, loudness, loudnessIndex, loudnessRange, downmixStereo, wavParts, LOUDNESS_TARGETS, normGain, SAFE_ZONES, safeRect, containRect, encodeWav, parseHighlight, fitQuality, TEXT_LIMITS, captionStats, MAX_FILE_BYTES, checkFileSize,
    audioFade, fadeGain, exportEstimate, friendlyError, FILTERS, applyFilter, avGeometry, trimDrag, findSilences, silenceCuts, removeRanges, envelope, envAt, bassOnsets, punchAt, bassPush, prng, bandGroups, particleAt, lifeAlpha, ripples, slowWave, mixHex,
    formatBytes, formatTime, baseName, detectPlatform,
    isHeic, isHeicBrand, looksLikeAudio, AUDIO_EXT, fitArea,
    exifOrientation, orientationApp1, stripJpegBytes,
    graphemes, splitLongWord, wrap, clampLines, splitSlides,
    luminance, contrast, PALETTES, colorsFor, slideTiming, clipDuration, checkStart,
    bitrateFor, estimateBytes, AUDIO_BPS, H264_CODECS, even,
    fft, monoWindow, bandEdges, spectrumBands, peaks, smoothBars, rms,
  };
});
