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
    const text = t.box ? t.color : darkBg ? '#fff' : '#111';
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
    if (/NotSupported|not supported|codec|encoder|configure/i.test(m))
      return { title: 'Trình duyệt không mã hoá được video với cài đặt này', hint: 'Thử khung 720×1280 hoặc 30 fps, hoặc dùng Chrome / Safari bản mới.' };
    if (/rời khỏi trang|hidden/i.test(m))
      return { title: 'Đã dừng vì trang bị ẩn', hint: 'Giữ màn hình mở và ở lại trang này đến khi xuất xong.' };
    if (/decode|giải mã|EncodingError/i.test(m))
      return { title: 'Không đọc được file audio', hint: 'Thử đổi file sang MP3 / M4A / WAV.' };
    return { title: 'Xuất video bị lỗi', hint: 'Bấm “Thử lại”. Nếu vẫn lỗi, bấm “Sao chép thông tin lỗi” và gửi cho chúng tôi.' };
  }

  return {
    audioFade, fadeGain, exportEstimate, friendlyError,
    formatBytes, formatTime, baseName, detectPlatform,
    isHeic, isHeicBrand, looksLikeAudio, AUDIO_EXT, fitArea,
    exifOrientation, orientationApp1, stripJpegBytes,
    graphemes, splitLongWord, wrap, clampLines, splitSlides,
    luminance, colorsFor, slideTiming, clipDuration, checkStart,
    bitrateFor, estimateBytes, AUDIO_BPS, H264_CODECS, even,
    fft, monoWindow, bandEdges, spectrumBands, peaks, smoothBars, rms,
  };
});
