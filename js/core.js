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

  /* ---------------- Audio → Video layout ---------------- */
  /**
   * Where the cover art, title block, visualizer and time bar go, for any frame size (9:16, 4:5, 1:1, 16:9).
   * Zones are STACKED (never overlap): each layout lists its zones top→bottom and the art gets what is left.
   * layout: 'cover' (art, text, visualizer) | 'top' (text first: podcast) | 'minimal' (no art, big visualizer).
   * style 'circle' draws rays around the art: its full drawn size is reserved (1.44·A + 44u).
   * Returns drawing fields + `zones` {art,text,vis,prog: [top, bottom]} used by the tests.
   */
  function avGeometry(W, H, layout = 'cover', style = 'bars') {
    const u = Math.min(W, H) / 1080, fs = 64 * u;
    const TEXT_TOP = 0.95 * fs; // accents above the first baseline
    const TEXT_H = 252 * u; // 2 title lines + subtitle (drawText)
    const PROG_H = 72 * u; // knob (12u above the bar) + bar + time labels
    const rays = style === 'circle';
    const ring = (A) => (rays ? A * 1.44 + 44 * u : A);
    const fromRing = (R) => Math.max(40 * u, rays ? (R - 44 * u) / 1.44 : R);
    const land = W > H * 1.15;
    const z = (a, b) => [Math.round(a), Math.round(b)];

    if (land && layout !== 'minimal') {
      // art on the left, a column with title, visualizer and time bar on the right
      const A = Math.round(fromRing(Math.min(H * (rays ? 0.8 : 0.62), W * (rays ? 0.42 : 0.38))));
      const pad = (ring(A) - A) / 2;
      const ax = Math.round(W * 0.06 + pad), ay = Math.round((H - A) / 2);
      const tx = Math.round(ax + A + pad + W * 0.05), tw = Math.round(W - tx - W * 0.06);
      const gap = H * 0.05, vh = H * 0.22;
      const top = (H - (TEXT_H + gap + vh + gap + PROG_H)) / 2;
      const titleY = top + TEXT_TOP, vy = top + TEXT_H + gap, py = vy + vh + gap;
      return {
        u, A, ax, ay, tx, tw, align: 'left', titleY, vx: tx, vw: tw, vy, vh, py,
        zones: { art: z(ay - pad, ay + A + pad), text: z(top, top + TEXT_H), vis: z(vy, vy + vh), prog: z(py - 12 * u, py + PROG_H), artX: z(ax - pad, ax + A + pad), colX: z(tx, tx + tw) },
      };
    }

    const gap = H * 0.035, margin = H * 0.06;
    const minimal = layout === 'minimal';
    const vh = minimal ? H * (land ? 0.3 : 0.24) : H * (H > W * 1.3 ? 0.12 : 0.14);
    let A, order;
    if (minimal) {
      A = Math.round(fromRing(vh)); // only drawn for the circle style, inside the visualizer zone
      order = ['vis', 'text', 'prog'];
    } else {
      const avail = H - (TEXT_H + vh + PROG_H + 3 * gap + 2 * margin);
      const cap = layout === 'top' ? Math.min(W * 0.5, H * 0.28) : Math.min(W * 0.64, H * 0.33);
      A = Math.round(Math.min(cap, fromRing(Math.min(avail, W * 0.84))));
      order = layout === 'top' ? ['text', 'art', 'vis', 'prog'] : ['art', 'text', 'vis', 'prog'];
    }
    const size = { art: ring(A), text: TEXT_H, vis: vh, prog: PROG_H };
    const total = order.reduce((s, k) => s + size[k], 0) + gap * (order.length - 1);
    let y = Math.max(margin * 0.5, (H - total) * 0.45);
    const zones = {};
    for (const k of order) { zones[k] = z(y, y + size[k]); y += size[k] + gap; }
    const vy = zones.vis[0];
    const pad = (ring(A) - A) / 2;
    const ay = minimal ? Math.round(vy + vh / 2 - A / 2) : Math.round(zones.art[0] + pad);
    if (minimal) zones.art = z(ay - pad, ay + A + pad);
    const ax = Math.round((W - A) / 2);
    zones.artX = z(ax - pad, ax + A + pad);
    return {
      u, A, ax, ay, noArt: minimal, tx: W * 0.08, tw: W * 0.84, align: 'center',
      titleY: zones.text[0] + TEXT_TOP, vx: Math.round(W * 0.08), vw: Math.round(W * 0.84), vy, vh, py: zones.prog[0] + 12 * u,
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

  return {
    audioFade, fadeGain, exportEstimate, friendlyError, FILTERS, applyFilter, avGeometry, trimDrag, findSilences, silenceCuts, removeRanges,
    formatBytes, formatTime, baseName, detectPlatform,
    isHeic, isHeicBrand, looksLikeAudio, AUDIO_EXT, fitArea,
    exifOrientation, orientationApp1, stripJpegBytes,
    graphemes, splitLongWord, wrap, clampLines, splitSlides,
    luminance, colorsFor, slideTiming, clipDuration, checkStart,
    bitrateFor, estimateBytes, AUDIO_BPS, H264_CODECS, even,
    fft, monoWindow, bandEdges, spectrumBands, peaks, smoothBars, rms,
  };
});
