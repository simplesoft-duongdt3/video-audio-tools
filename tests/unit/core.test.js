// Unit tests for js/core.js (pure logic). Run: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const C = require('../../js/core.js');

const FIX = join(__dirname, '..', 'fixtures');
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

/** Fake 2D context: every grapheme is 10px wide. */
const fakeCtx = { measureText: (s) => ({ width: C.graphemes(s).length * 10 }) };
const concat = (parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));

test('formatBytes', () => {
  assert.equal(C.formatBytes(0), '0 B');
  assert.equal(C.formatBytes(1023), '1023 B');
  assert.equal(C.formatBytes(1536), '1.5 KB');
  assert.equal(C.formatBytes(5 * 1048576), '5.00 MB');
});

test('formatTime handles negatives, NaN and minutes', () => {
  assert.equal(C.formatTime(0), '0:00');
  assert.equal(C.formatTime(-3), '0:00');
  assert.equal(C.formatTime(NaN), '0:00');
  assert.equal(C.formatTime(59.9), '0:59');
  assert.equal(C.formatTime(125), '2:05');
});

test('baseName strips only the last extension', () => {
  assert.equal(C.baseName('a.b.mp3'), 'a.b');
  assert.equal(C.baseName('noext'), 'noext');
  assert.equal(C.baseName('Bài hát.m4a'), 'Bài hát');
});

test('detectPlatform: iPhone, iPad (desktop mode), Android, desktop', () => {
  assert.deepEqual(C.detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5), { ios: true, android: false, mobile: true });
  assert.equal(C.detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5).ios, true, 'iPadOS pretends to be a Mac');
  assert.equal(C.detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0).ios, false, 'real Mac');
  assert.deepEqual(C.detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Linux armv8l', 5), { ios: false, android: true, mobile: true });
  assert.equal(C.detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0).mobile, false);
});

test('isHeic by MIME or extension', () => {
  assert.ok(C.isHeic({ name: 'IMG_1.HEIC', type: '' }));
  assert.ok(C.isHeic({ name: 'x', type: 'image/heif' }));
  assert.ok(!C.isHeic({ name: 'a.jpg', type: 'image/jpeg' }));
});

test('isHeicBrand sniffs ISO-BMFF brands', () => {
  const box = (brand) => Uint8Array.from(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp' + brand + '\0\0\0\0', 'latin1')]));
  assert.ok(C.isHeicBrand(box('heic')));
  assert.ok(C.isHeicBrand(box('mif1')));
  assert.ok(!C.isHeicBrand(box('isom')), 'mp4 is not heic');
  assert.ok(!C.isHeicBrand(new Uint8Array(4)));
  assert.ok(!C.isHeicBrand(null));
});

test('looksLikeAudio accepts iOS files with empty MIME, rejects obvious non-audio', () => {
  assert.ok(C.looksLikeAudio({ name: 'Voice 001.m4a', type: '' }), 'iOS often gives no type');
  assert.ok(C.looksLikeAudio({ name: 'song.MP3', type: 'audio/mpeg' }));
  assert.ok(C.looksLikeAudio({ name: 'clip.mov', type: 'video/quicktime' }));
  assert.ok(C.looksLikeAudio({ name: 'x.amr', type: 'application/octet-stream' }));
  assert.ok(C.looksLikeAudio({ name: 'mystery', type: '' }), 'no type and no ext: let the decoder decide');
  assert.ok(!C.looksLikeAudio({ name: 'notes.txt', type: 'text/plain' }));
  assert.ok(!C.looksLikeAudio({ name: 'photo.jpg', type: 'image/jpeg' }));
  for (const e of ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'mp4', 'mov']) assert.ok(C.AUDIO_EXT.includes(e), e);
});

test('fitArea keeps w*h under the limit', () => {
  assert.equal(C.fitArea(1000, 1000, 16e6), 1);
  const s = C.fitArea(8000, 6000, 16e6);
  assert.ok(s < 1 && 8000 * s * 6000 * s <= 16e6 + 1);
});

/* ---------------- JPEG ---------------- */
test('orientationApp1 round-trips through exifOrientation (big-endian)', () => {
  for (const o of [1, 3, 6, 8]) {
    const b = Uint8Array.from(concat([[0xff, 0xd8], C.orientationApp1(o)]));
    assert.equal(C.exifOrientation(b, 2), o);
  }
});

test('stripJpegBytes removes EXIF/XMP/comment/trailer but keeps orientation and image data', () => {
  const src = Uint8Array.from(readFileSync(join(FIX, 'photo-exif.jpg')));
  const { parts, removed } = C.stripJpegBytes(src);
  const out = concat(parts);
  assert.ok(out.length < src.length);
  const s = out.toString('latin1');
  assert.ok(!s.includes('secret GPS'), 'XMP removed');
  assert.ok(!s.includes('private comment'), 'comment removed');
  assert.ok(!s.includes('TestCam'), 'EXIF Make removed');
  assert.ok(!s.includes('TRAILING'), 'appended data removed');
  assert.ok(s.includes('JFIF'), 'JFIF kept');
  assert.equal(out[0], 0xff); assert.equal(out[1], 0xd8);
  assert.equal(out[out.length - 2], 0xff); assert.equal(out[out.length - 1], 0xd9);
  // orientation rebuilt (LE source → our BE APP1)
  const app1 = s.indexOf('Exif\0\0') - 4;
  assert.equal(C.exifOrientation(out, app1), 6);
  for (const r of ['EXIF/GPS', 'XMP', 'comment', 'ảnh phụ đính kèm']) assert.ok(removed.includes(r), r);
  // compressed scan data must be byte-identical
  const sos = (b) => Buffer.from(b).indexOf(Buffer.from([0xff, 0xda]));
  const scan = (b) => Buffer.from(b).subarray(sos(b), Buffer.from(b).indexOf(Buffer.from([0xff, 0xd9]), sos(b)) + 2);
  assert.ok(scan(src).equals(scan(out)));
});

test('stripJpegBytes: pixels decode identically (ffmpeg)', { skip: !hasFfmpeg && 'ffmpeg not installed' }, (t) => {
  const src = readFileSync(join(FIX, 'photo-exif.jpg'));
  const out = concat(C.stripJpegBytes(Uint8Array.from(src)).parts);
  const decode = (buf) => execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: buf });
  assert.ok(decode(src).equals(decode(out)));
});

test('stripJpegBytes rejects non-JPEG and truncated files', () => {
  assert.throws(() => C.stripJpegBytes(Uint8Array.from(readFileSync(join(FIX, 'photo.png')))), /JPEG/);
  const src = Uint8Array.from(readFileSync(join(FIX, 'photo-exif.jpg')));
  assert.throws(() => C.stripJpegBytes(src.subarray(0, 30)), /JPEG/);
});

/* ---------------- text ---------------- */
test('graphemes keeps emoji families and Vietnamese letters whole', () => {
  assert.equal(C.graphemes('👨‍👩‍👧').length, 1);
  assert.equal(C.graphemes('Việt'.normalize('NFD')).length, 4);
});

test('wrap fits every line, keeps paragraphs, breaks long words only when asked', () => {
  const lines = C.wrap(fakeCtx, 'một hai ba bốn năm sáu bảy', 100, false);
  assert.ok(lines.every((l) => fakeCtx.measureText(l).width <= 100), lines.join('|'));
  assert.deepEqual(C.wrap(fakeCtx, 'a\n\nb', 100, false), ['a', '', 'b']);
  const url = 'https://example.com/very/long/path';
  assert.deepEqual(C.wrap(fakeCtx, url, 100, false), [url], 'not broken by default');
  const broken = C.wrap(fakeCtx, url, 100, true);
  assert.ok(broken.length > 1 && broken.every((l) => fakeCtx.measureText(l).width <= 100));
  assert.equal(broken.join(''), url);
});

test('clampLines limits lines and adds an ellipsis that still fits', () => {
  const lines = C.clampLines(fakeCtx, 'một hai ba bốn năm sáu bảy tám chín mười', 80, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith('…'));
  assert.ok(lines.every((l) => fakeCtx.measureText(l).width <= 80), lines.join('|'));
  assert.deepEqual(C.clampLines(fakeCtx, 'ngắn', 80, 2), ['ngắn']);
});

test('splitSlides: blank lines (even with spaces) separate slides, NFC normalised', () => {
  const s = C.splitSlides('Một\n  \nHai\nba\n\n\n' + 'Việt'.normalize('NFD'));
  assert.deepEqual(s, ['Một', 'Hai\nba', 'Việt'.normalize('NFC')]);
  assert.deepEqual(C.splitSlides('  \n \n'), []);
});

test('luminance and colorsFor keep text readable on custom backgrounds', () => {
  assert.equal(C.luminance('#000000'), 0);
  assert.ok(Math.abs(C.luminance('#ffffff') - 1) < 1e-9);
  assert.equal(C.luminance('#fff'), C.luminance('#ffffff'));
  const tpl = { color: '#fff', stroke: { color: '#000', w: 0.1 } };
  assert.equal(C.colorsFor(tpl, { bgMode: 'tpl' }).text, '#fff');
  assert.equal(C.colorsFor(tpl, { bgMode: 'color', bgColor: '#ffffff' }).text, '#111');
  assert.equal(C.colorsFor(tpl, { bgMode: 'color', bgColor: '#ffffff' }).stroke.color, '#fff');
  assert.equal(C.colorsFor(tpl, { bgMode: 'color', bgColor: '#101010' }).text, '#fff');
  assert.equal(C.colorsFor(tpl, { bgMode: 'image' }).handle, '#fff');
  assert.equal(C.colorsFor({ color: '#111', box: {} }, { bgMode: 'color', bgColor: '#000' }).text, '#111', 'caption box keeps its own colour');
});

/* ---------------- timing ---------------- */
test('slideTiming', () => {
  assert.deepEqual(C.slideTiming(3, 0, 0), { n: 3, seg: 3, duration: 9 });
  assert.deepEqual(C.slideTiming(4, 0, 20), { n: 4, seg: 5, duration: 20 });
  assert.deepEqual(C.slideTiming(2, 4, 0), { n: 2, seg: 4, duration: 8 });
  assert.deepEqual(C.slideTiming(3, 5, 10), { n: 3, seg: 5, duration: 10 }, 'audio shorter than slides');
  assert.equal(C.slideTiming(0, 0, 0).n, 1);
});

test('clipDuration never runs past the end of the audio', () => {
  assert.equal(C.clipDuration({ audioDur: 0, fallback: 8 }), 8);
  assert.equal(C.clipDuration({ dur: 5, audioDur: 0 }), 5);
  assert.equal(C.clipDuration({ audioDur: 30 }), 30);
  assert.equal(C.clipDuration({ start: 10, audioDur: 30 }), 20);
  assert.equal(C.clipDuration({ start: 10, dur: 50, audioDur: 30 }), 20);
  assert.equal(C.clipDuration({ start: 10, dur: 5, audioDur: 30 }), 5);
  assert.equal(C.clipDuration({ start: -4, dur: '', audioDur: 30 }), 30);
  assert.equal(C.clipDuration({ start: 29.9, audioDur: 30 }), 0.5, 'minimum length');
});

test('checkStart', () => {
  assert.equal(C.checkStart(0, 10), null);
  assert.equal(C.checkStart('9.8', 10), null);
  assert.match(C.checkStart(9.95, 10), /phải nhỏ hơn/);
  assert.equal(C.checkStart(100, 0), null, 'no audio');
});

test('bitrateFor and even', () => {
  assert.equal(C.bitrateFor(1080, 1920, 30), Math.round(1080 * 1920 * 30 * 0.05));
  assert.equal(C.bitrateFor(3840, 2160, 60), 8e6, 'capped');
  assert.equal(C.bitrateFor(64, 64, 24), 800e3, 'floor');
  // iPhone size cap: a 3-minute and a 10-minute 1080×1920 video must fit in 80 MB
  for (const dur of [180, 600]) {
    const b = C.bitrateFor(1080, 1920, 30, dur, 80e6);
    if (b > 800e3) assert.ok(C.estimateBytes(b, dur) <= 80e6, `${dur}s → ${C.estimateBytes(b, dur)} bytes`);
  }
  assert.equal(C.bitrateFor(1080, 1920, 30, 30, 80e6), C.bitrateFor(1080, 1920, 30), 'short videos keep full quality');
  // the old default made 3 min ≈ 98 MB: the new default must stay under 80 MB even without the cap
  assert.ok(C.estimateBytes(C.bitrateFor(1080, 1920, 30), 180) < 80e6);
  assert.equal(C.even(1081), 1080);
  assert.equal(C.even(1), 2);
  assert.ok(C.H264_CODECS.length >= 3 && C.H264_CODECS.every((c) => c.startsWith('avc1.')));
});

/* ---------------- audio analysis ---------------- */
test('fft matches a naive DFT', () => {
  const N = 64;
  const x = Float32Array.from({ length: N }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1) + ((i * 7919) % 13) / 13);
  const re = Float32Array.from(x), im = new Float32Array(N);
  C.fft(re, im);
  for (let k = 0; k < N; k++) {
    let r = 0, m = 0;
    for (let n = 0; n < N; n++) { r += x[n] * Math.cos((-2 * Math.PI * k * n) / N); m += x[n] * Math.sin((-2 * Math.PI * k * n) / N); }
    assert.ok(Math.abs(re[k] - r) < 1e-3 && Math.abs(im[k] - m) < 1e-3, `bin ${k}`);
  }
  assert.throws(() => C.fft(new Float32Array(48), new Float32Array(48)), /power of two/);
});

test('spectrumBands: a 1 kHz tone peaks in the band containing 1 kHz', () => {
  const sr = 48000, N = 2048, nb = 40;
  const x = Float32Array.from({ length: N }, (_, i) => 0.8 * Math.sin((2 * Math.PI * 1000 * i) / sr));
  const b = C.spectrumBands(x, sr, nb);
  const edges = C.bandEdges(nb);
  const want = edges.findIndex((e, i) => e <= 1000 && edges[i + 1] > 1000);
  const got = b.indexOf(Math.max(...b));
  assert.ok(Math.abs(got - want) <= 1, `peak band ${got}, expected ~${want}`);
  assert.ok(b[got] > 0.9, 'loud tone ≈ full scale');
  assert.ok(b[0] < 0.2 && b[nb - 1] < 0.2, 'far bands quiet');
  assert.ok(C.spectrumBands(new Float32Array(N), sr, nb).every((v) => v === 0), 'silence is 0');
});

test('monoWindow averages channels and zero-pads', () => {
  const L = Float32Array.from([1, 1, 1, 1]), R = Float32Array.from([0, 0, 0, 0]);
  assert.deepEqual([...C.monoWindow([L, R], 2, 4)], [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual([...C.monoWindow([L], 0, 4)], [0, 0, 1, 1], 'before start is silent');
  assert.deepEqual([...C.monoWindow([L], 10, 4)], [0, 0, 0, 0], 'after end is silent');
});

test('peaks, smoothBars and rms', () => {
  const ch = Float32Array.from({ length: 1000 }, (_, i) => (i < 500 ? 0.2 : -0.9));
  const p = C.peaks([ch], 2);
  assert.ok(Math.abs(p[0] - 0.2) < 1e-6 && Math.abs(p[1] - 0.9) < 1e-6);
  const prev = Float32Array.from([1, 0]), next = Float32Array.from([0, 0.5]);
  const s = C.smoothBars(prev, next, 0.1, 2);
  assert.ok(Math.abs(s[0] - 0.8) < 1e-6, 'falls slowly');
  assert.ok(Math.abs(s[1] - 0.5) < 1e-6, 'rises instantly');
  assert.deepEqual([...C.smoothBars(prev, next, 5)], [...next], 'seek resets');
  assert.deepEqual([...C.smoothBars(prev, next, -1)], [...next], 'going back resets');
  const sine = Float32Array.from({ length: 4800 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 100 * i) / 48000));
  assert.ok(Math.abs(C.rms(sine) - 0.5 / Math.SQRT2) < 1e-3);
  assert.equal(C.rms(new Float32Array(0)), 0);
});

test('audioFade: fade ends where the sound ends, never longer than 0.4 s', () => {
  assert.deepEqual(C.audioFade(100, 10, 30), { end: 30, fade: 0.4 });
  // audio runs out before the video: fade at the audio end
  const f = C.audioFade(20, 15, 30);
  assert.equal(f.end, 5); assert.equal(f.fade, 0.4);
  // very short clip: fade is a quarter of it
  assert.equal(C.audioFade(1, 0, 1).fade, 0.25);
  // start past the end: still a valid (tiny) window, no NaN / negative
  const g = C.audioFade(10, 12, 5);
  assert.ok(g.end > 0 && g.fade > 0 && g.fade <= g.end);
});

test('fadeGain: 1 before the fade, linear ramp, 0 after the end', () => {
  assert.equal(C.fadeGain(0, 10, 0.4), 1);
  assert.equal(C.fadeGain(9.6, 10, 0.4), 1);
  assert.ok(Math.abs(C.fadeGain(9.8, 10, 0.4) - 0.5) < 1e-9);
  assert.equal(C.fadeGain(10, 10, 0.4), 0);
  assert.equal(C.fadeGain(11, 10, 0.4), 0);
});

test('exportEstimate: size matches bitrate × time, iOS cap is flagged, time from measured speed', () => {
  const base = { w: 1080, h: 1920, fps: 30, duration: 60 };
  const e = C.exportEstimate(base);
  const bps = C.bitrateFor(1080, 1920, 30);
  assert.equal(e.bytes, C.estimateBytes(bps, 60, true));
  assert.equal(e.seconds, null, 'unknown speed → no made-up time');
  assert.equal(e.capped, false);
  // 3 minutes on iPhone (80 MB cap) at full quality would be ~98 MB → capped below 80 MB
  const ios = C.exportEstimate({ ...base, duration: 180, maxBytes: 80e6 });
  assert.equal(ios.capped, true);
  assert.ok(ios.bytes <= 80e6, `${ios.bytes} ≤ 80 MB`);
  assert.equal(C.exportEstimate({ ...base, speed: 180 }).seconds, 10, '1800 frames at 180 fps');
  assert.equal(C.exportEstimate({ ...base, realtime: true }).seconds, 60, 'real-time recording takes the video length');
  assert.ok(C.exportEstimate({ ...base, audio: false }).bytes < e.bytes);
});

test('friendlyError: common browser failures map to an actionable Vietnamese message', () => {
  assert.match(C.friendlyError('Array buffer allocation failed', 'RangeError').title, /bộ nhớ/);
  assert.match(C.friendlyError('Failed to fetch dynamically imported module: https://cdn…').title, /thư viện/);
  assert.match(C.friendlyError('Unsupported configuration', 'NotSupportedError').title, /mã hoá/);
  assert.match(C.friendlyError('Đã dừng vì bạn rời khỏi trang.').title, /trang bị ẩn/);
  const other = C.friendlyError('weird');
  assert.match(other.hint, /Sao chép thông tin lỗi/);
  for (const m of ['', undefined]) assert.ok(C.friendlyError(m).title);
});

test('applyFilter: bw is grey, warm/cool shift red vs blue, vintage lifts blacks, alpha untouched, none is a no-op', () => {
  const px = () => new Uint8ClampedArray([200, 100, 50, 255, 0, 0, 0, 128, 255, 255, 255, 7]);
  const bw = C.applyFilter(px(), 'bw');
  for (let i = 0; i < bw.length; i += 4) { assert.equal(bw[i], bw[i + 1]); assert.equal(bw[i + 1], bw[i + 2]); }
  const warm = C.applyFilter(px(), 'warm'), cool = C.applyFilter(px(), 'cool');
  assert.ok(warm[0] - warm[2] > 200 - 50, 'warm: more red than blue than before');
  assert.ok(cool[2] - cool[0] > 50 - 200, 'cool: bluer');
  const v = C.applyFilter(px(), 'vintage');
  assert.ok(v[4] >= 15 && v[5] >= 15, 'black becomes faded');
  assert.ok(v[8] < 255 || v[10] < 255, 'white is softened');
  for (const f of ['bw', 'warm', 'cool', 'vintage']) {
    const d = C.applyFilter(px(), f);
    assert.deepEqual([d[3], d[7], d[11]], [255, 128, 7], f + ' keeps alpha');
  }
  assert.deepEqual([...C.applyFilter(px(), 'none')], [...px()]);
  assert.deepEqual(C.FILTERS, ['none', 'bw', 'warm', 'cool', 'vintage']);
});

test('every slideshow filter option in index.html is implemented by Core.applyFilter', () => {
  const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
  const sel = html.match(/<select id="ivFilter">([\s\S]*?)<\/select>/)[1];
  const opts = [...sel.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(opts.sort(), [...C.FILTERS].sort());
});

test('avGeometry: art, title block, visualizer and time bar never overlap, at every size × layout × style', () => {
  const sizes = [[1080, 1920], [720, 1280], [1080, 1350], [1080, 1080], [1920, 1080], [1280, 720]];
  for (const [W, H] of sizes) for (const layout of ['cover', 'top', 'minimal']) for (const style of ['bars', 'circle', 'overview', 'vinyl']) for (const badge of [false, true]) for (const titleScale of [1, 1.3]) {
    const g = C.avGeometry(W, H, layout, style, { badge, titleScale });
    const id = `${W}×${H} ${layout} ${style}${badge ? ' +badge' : ''} ×${titleScale}`;
    if (badge) {
      assert.ok(g.zones.badge, id);
      assert.ok(g.zones.badge[1] <= g.zones.text[0] && (!g.zones.art || g.noArt || g.zones.colX || g.zones.badge[1] <= g.zones.art[0]) && g.zones.badge[1] <= g.zones.vis[0], `${id}: badge on top ${g.zones.badge}`);
    }
    if (H > W * 1.6) {
      // TikTok safe zone: nothing important in the bottom 22 % or the top 6 %
      for (const k of ['text', 'vis', 'prog', ...(badge ? ['badge'] : [])]) {
        assert.ok(g.zones[k][1] <= H * 0.78 + 1 && g.zones[k][0] >= H * 0.06 - 1, `${id}: ${k} ${g.zones[k]} inside the safe zone`);
      }
      if (badge) assert.ok(g.zones.badge[0] >= H * 0.1 - 1, `${id}: label below TikTok's top bar`);
      assert.ok(g.vx + g.vw <= W * 0.86 + 1 && g.tx + g.tw <= W * 0.86 + 1, `${id}: clear of TikTok's right-hand icons`);
    }
    const z = g.zones;
    for (const k of ['text', 'vis', 'prog', 'art']) {
      assert.ok(z[k][0] >= 0 && z[k][1] <= H, `${id}: ${k} ${z[k]} inside 0..${H}`);
    }
    assert.ok(z.artX[0] >= 0 && z.artX[1] <= W, `${id}: art (with rays) inside the width ${z.artX}`);
    if (z.colX) {
      // landscape: art on the left, the column on the right
      assert.ok(z.artX[1] <= z.colX[0], `${id}: art ${z.artX} left of column ${z.colX}`);
      assert.ok(z.colX[1] <= W);
      for (const [a, b] of [['text', 'vis'], ['vis', 'prog']]) assert.ok(z[a][1] <= z[b][0], `${id}: ${a} ${z[a]} above ${b} ${z[b]}`);
    } else {
      // stacked: sort by top, each zone ends before the next starts (minimal: the disc lives inside the visualizer)
      const keys = ['text', 'vis', 'prog', ...(g.noArt ? [] : ['art'])].sort((a, b) => z[a][0] - z[b][0]);
      for (let i = 1; i < keys.length; i++) assert.ok(z[keys[i - 1]][1] <= z[keys[i]][0], `${id}: ${keys[i - 1]} ${z[keys[i - 1]]} overlaps ${keys[i]} ${z[keys[i]]}`);
      if (g.noArt) assert.ok(z.art[0] >= z.vis[0] - 1 && z.art[1] <= z.vis[1] + 1, `${id}: disc inside the visualizer zone`);
    }
    assert.ok(g.A >= 40 * g.u, `${id}: art not degenerate (${g.A})`);
  }
  // the 9:16 cover layout keeps its big art (even inside the safe zone)
  assert.ok(C.avGeometry(1080, 1920, 'cover', 'bars').A >= 600);
  // deliberate trade-offs of the TikTok safe zone (content 6/10 %–78 % high, 14 %–86 % wide):
  // a top label and the circle style's rays (1.44·A) leave a smaller cover — still clearly visible
  assert.ok(C.avGeometry(1080, 1920, 'cover', 'bars', { badge: true }).A >= 400);
  assert.ok(C.avGeometry(1080, 1920, 'cover', 'circle').A >= 400);
  assert.ok(C.avGeometry(1080, 1920, 'cover', 'circle', { badge: true }).A >= 240);
  // record / orb: no empty visualizer band — the art gets that space (QC: ~300 px gap before)
  for (const style of ['vinyl', 'orb']) for (const [W, H] of [[1080, 1920], [1080, 1080], [1920, 1080]]) {
    const g = C.avGeometry(W, H, 'cover', style), b = C.avGeometry(W, H, 'cover', 'bars');
    assert.equal(g.vh, 0, `${style} ${W}×${H}: no visualizer band`);
    if (H >= W) assert.ok(g.zones.prog[0] - g.zones.text[1] <= H * 0.035 * 2 + 1, `${style} ${W}×${H}: title → time bar gap ${g.zones.prog[0] - g.zones.text[1]}`);
    if (style === 'orb' && H >= W) assert.ok(g.A > b.A, `${style} ${W}×${H}: bigger art (${g.A} > ${b.A})`);
  }
});

test('friendlyError: decode failures vs encoder failures are told apart', () => {
  assert.match(C.friendlyError('Không giải mã được "a.mp3"').title, /audio/);
  assert.match(C.friendlyError('Unable to decode audio data').title, /audio/);
  // VideoEncoder raises EncodingError: that is the video encoder, not the user's audio file
  assert.match(C.friendlyError('Encoding error.', 'EncodingError').title, /mã hoá/);
  assert.doesNotMatch(C.friendlyError('x', 'EncodingError').title, /audio/);
});

test('trimDrag: handles keep ≥ min apart and inside the song; moving keeps the length', () => {
  const base = { s: 10, e: 40, d: 100 };
  assert.deepEqual(C.trimDrag({ ...base, mode: 'start', t: 5 }), { s: 5, e: 40 });
  assert.deepEqual(C.trimDrag({ ...base, mode: 'start', t: 60 }), { s: 39.5, e: 40 }, 'start cannot pass the end');
  assert.deepEqual(C.trimDrag({ ...base, mode: 'start', t: -3 }), { s: 0, e: 40 });
  assert.deepEqual(C.trimDrag({ ...base, mode: 'end', t: 120 }), { s: 10, e: 100 });
  assert.deepEqual(C.trimDrag({ ...base, mode: 'end', t: 2 }), { s: 10, e: 10.5 }, 'end cannot pass the start');
  assert.deepEqual(C.trimDrag({ ...base, mode: 'move', t: 50, grab: 5 }), { s: 45, e: 75 });
  assert.deepEqual(C.trimDrag({ ...base, mode: 'move', t: 99, grab: 0 }), { s: 70, e: 100 }, 'window stops at the song end');
  assert.deepEqual(C.trimDrag({ ...base, mode: 'move', t: -9, grab: 0 }), { s: 0, e: 30 });
  // song shorter than the minimum: still a valid window
  const tiny = C.trimDrag({ s: 0, e: 0.3, d: 0.3, mode: 'end', t: 0 });
  assert.ok(tiny.e >= tiny.s);
});

/** tone/silence pattern: [[seconds, amplitude], …] → Float32Array at sr */
function pattern(parts, sr = 8000) {
  const n = parts.reduce((s, [d]) => s + Math.round(d * sr), 0), x = new Float32Array(n);
  let o = 0;
  for (const [d, a] of parts) { const m = Math.round(d * sr); for (let i = 0; i < m; i++) x[o + i] = a * Math.sin((2 * Math.PI * 220 * i) / sr); o += m; }
  return x;
}

test('findSilences: lead, long pause, tail found; short breaths and the music itself are not', () => {
  const sr = 8000;
  const x = pattern([[1, 0], [2, 0.5], [0.3, 0], [1, 0.5], [1.5, 0.0005], [2, 0.4], [0.5, 0]], sr);
  const s = C.findSilences([x], sr);
  assert.deepEqual(s.map((g) => g.kind), ['lead', 'gap', 'tail']);
  const near = (a, b) => Math.abs(a - b) < 0.05;
  assert.ok(near(s[0].start, 0) && near(s[0].end, 1), JSON.stringify(s[0]));
  assert.ok(near(s[1].start, 4.3) && near(s[1].end, 5.8), 'the 1.5 s near-silent pause (−66 dB) ' + JSON.stringify(s[1]));
  assert.ok(near(s[2].start, 7.8) && near(s[2].end, 8.3), JSON.stringify(s[2]));
  // the 0.3 s breath is kept at the default sensitivity, found with minGap 0.25
  assert.equal(C.findSilences([x], sr, { minGap: 0.25 }).filter((g) => g.kind === 'gap').length, 2);
  assert.equal(C.findSilences([x], sr, { minGap: 0.3 }).filter((g) => g.kind === 'gap').length, 2, 'a 0.3 s pause counts at "≥ 0.3 s"');
  // continuous music: nothing; all-silent file: nothing
  assert.deepEqual(C.findSilences([pattern([[5, 0.3]], sr)], sr), []);
  assert.deepEqual(C.findSilences([new Float32Array(sr * 3)], sr), []);
  // a quiet voice note (peaks −30 dBFS) still has its pause found: threshold adapts
  const quiet = pattern([[2, 0.03], [1.2, 0], [2, 0.03]], sr);
  assert.equal(C.findSilences([quiet], sr).length, 1);
});

test('silenceCuts keeps a natural pause around speech; removeRanges shortens without clicks', () => {
  const cuts = C.silenceCuts([{ start: 0, end: 1, kind: 'lead' }, { start: 4.3, end: 5.8, kind: 'gap' }, { start: 7.8, end: 8.3, kind: 'tail' }]);
  assert.deepEqual(cuts.map((c) => [+c.from.toFixed(2), +c.to.toFixed(2)]), [[0, 0.92], [4.45, 5.65], [7.88, 8.3]]);
  const sr = 8000, x = pattern([[1, 0.5], [1, 0], [1, 0.5]], sr);
  const [y] = C.removeRanges([x], sr, [{ from: 1.15, to: 1.85 }]);
  assert.equal(y.length, x.length - Math.round(0.7 * sr));
  // around the join the signal is faded to ~0: no jump bigger than a normal sine step
  const j = Math.round(1.15 * sr);
  let maxJump = 0;
  for (let i = j - 50; i < j + 50; i++) maxJump = Math.max(maxJump, Math.abs(y[i + 1] - y[i]));
  assert.ok(maxJump < 0.1, `jump ${maxJump}`);
  assert.equal(x[0], C.removeRanges([x], sr, [])[0][0], 'no cuts = same samples');
  // overlapping / out-of-range cuts are tolerated
  assert.equal(C.removeRanges([x], sr, [{ from: -1, to: 0.5 }, { from: 0.4, to: 0.6 }, { from: 2.9, to: 9 }])[0].length, Math.round(2.3 * sr));
});

test('colour sets: every one is readable (WCAG) and well-formed', () => {
  assert.ok(C.PALETTES.length >= 24);
  const ids = new Set();
  for (const p of C.PALETTES) {
    assert.ok(!ids.has(p.id), 'unique id ' + p.id); ids.add(p.id);
    for (const c of [p.c1, p.c2, p.ink, ...p.bg]) assert.match(c, /^#[0-9a-f]{6}$/, `${p.id}: ${c}`);
    for (const b of p.bg) {
      assert.ok(C.contrast(p.ink, b) >= 4.5, `${p.name}: text ${p.ink} on ${b} = ${C.contrast(p.ink, b).toFixed(2)} (needs 4.5)`);
      assert.ok(C.contrast(p.c1, b) >= 3, `${p.name}: colour 1 ${p.c1} on ${b} = ${C.contrast(p.c1, b).toFixed(2)} (needs 3)`);
      assert.ok(C.contrast(p.c2, b) >= 3, `${p.name}: colour 2 ${p.c2} on ${b} = ${C.contrast(p.c2, b).toFixed(2)} (needs 3)`);
    }
    assert.ok(p.name && p.mood);
  }
  assert.ok(new Set(C.PALETTES.map((p) => p.mood)).size >= 4);
  assert.equal(C.contrast('#000000', '#ffffff').toFixed(0), '21');
});

/** n seconds of a 120 BPM kick (60 Hz thump, 0.12 s) over an optional sine pad */
function kicks(seconds, sr, bpm = 120, pad = 0) {
  const x = new Float32Array(seconds * sr), period = 60 / bpm;
  for (let i = 0; i < x.length; i++) {
    const t = i / sr, d = t % period;
    x[i] = (d < 0.12 ? Math.sin(2 * Math.PI * 60 * d) * Math.exp(-d * 25) * 0.9 : 0) + pad * Math.sin(2 * Math.PI * 440 * t);
  }
  return x;
}

test('bassOnsets: a 120 BPM kick gives ~2 hits/s on the beat; a steady pad or silence gives none; ≤ 4/s', () => {
  const sr = 22050;
  const on = C.bassOnsets([kicks(6, sr, 120, 0.2)], sr);
  assert.ok(on.length >= 10 && on.length <= 13, `${on.length} hits in 6 s`);
  for (const o of on) {
    const phase = o.t % 0.5;
    assert.ok(phase < 0.08 || phase > 0.46, `hit at ${o.t.toFixed(3)} s is on a beat`);
    assert.ok(o.s >= 0.4 && o.s <= 1);
  }
  const pad = new Float32Array(6 * sr).map((_, i) => 0.4 * Math.sin((2 * Math.PI * 440 * i) / sr));
  assert.equal(C.bassOnsets([pad], sr).length, 0, 'sine pad: no beats');
  assert.equal(C.bassOnsets([new Float32Array(6 * sr)], sr).length, 0, 'silence: no beats');
  // QC: music without drums and speech used to give "kicks" (ambient: 28 in 12 s)
  const rnd = C.prng(3);
  const amb = new Float32Array(12 * sr).map((_, i) => { const t = i / sr; return 0.25 * Math.sin(2 * Math.PI * 110 * t) * (0.6 + 0.4 * Math.sin(t * 0.9)) + 0.2 * Math.sin(2 * Math.PI * 165 * t) + 0.03 * (rnd() - 0.5); });
  assert.equal(C.bassOnsets([amb], sr).length, 0, 'ambient pad + noise: no beats');
  const voice = new Float32Array(12 * sr).map((_, i) => { const t = i / sr, env = Math.max(0, Math.sin(2 * Math.PI * 3.1 * t)) ** 2; return 0.5 * env * (Math.sin(2 * Math.PI * 170 * t) * 0.6 + Math.sin(2 * Math.PI * 520 * t) * 0.4); });
  assert.ok(C.bassOnsets([voice], sr).length <= 2, `speech syllables are not drum hits (${C.bassOnsets([voice], sr).length})`);
  const soft = C.bassOnsets([kicks(6, sr, 120, 0.2).map((v) => v * 0.25)], sr);
  assert.ok(soft.length >= 10, `a soft (−12 dB) kick is still found (${soft.length})`);
  assert.ok(soft.every((o) => o.s < 0.75), 'and stays a soft hit (fixed scale)');
  const four = C.bassOnsets([kicks(8, sr, 240)], sr); // 4 kicks/s: all of them (QC found 25 % dropped)
  assert.ok(four.length >= 30, `${four.length} of 32 hits at 4/s`);
  const fast = C.bassOnsets([kicks(4, sr, 480)], sr); // 8 kicks/s
  for (let i = 1; i < fast.length; i++) assert.ok(fast[i].t - fast[i - 1].t >= 0.23, 'refractory ~0.24 s');
  assert.ok(fast.length <= 4 * 4 + 1, '≤ ~4 hits/s even for 8 kicks/s');
});

test('punchAt / bassPush: depend only on t (seekable), attack + decay, monotonic push', () => {
  const on = [{ t: 1, s: 1 }, { t: 2, s: 0.5 }];
  assert.equal(C.punchAt(on, 0.5), 0);
  assert.ok(Math.abs(C.punchAt(on, 1.02) - 0.5) < 1e-9, 'half-way up the 40 ms attack');
  assert.ok(Math.abs(C.punchAt(on, 1.04) - 1) < 1e-9);
  assert.ok(C.punchAt(on, 1.3) < 0.2, 'decays');
  assert.ok(C.punchAt(on, 2.04) <= 0.5 + 1e-9, 'scaled by strength');
  assert.equal(C.punchAt(on, 1.7), C.punchAt(on, 1.7), 'same t → same value');
  let prev = -1;
  for (let t = 0; t < 4; t += 0.05) { const b = C.bassPush(on, t); assert.ok(b >= prev - 1e-12); prev = b; }
  assert.equal(C.bassPush([], 3), 0);
});

test('envelope / envAt / prng / bandGroups', () => {
  const sr = 8000, x = new Float32Array(sr * 2);
  for (let i = sr; i < 2 * sr; i++) x[i] = 0.5 * Math.sin(i);
  const env = C.envelope([x], sr);
  assert.equal(env.length, 100);
  assert.ok(env[10] < 0.01 && env[80] > 0.9, 'quiet first second, loud (normalised) second');
  assert.ok(Math.abs(C.envAt(env, 1.6) - env[80]) < 1e-6);
  const a = C.prng(42), b = C.prng(42);
  const xs = Array.from({ length: 5 }, a);
  assert.deepEqual(xs, Array.from({ length: 5 }, b), 'same seed, same sequence');
  assert.ok(xs.every((v) => v >= 0 && v < 1) && new Set(xs).size === 5);
  assert.deepEqual([...C.bandGroups(Float32Array.from([1, 1, 0, 0, 0.5, 0.5, 1, 0]), 4)], [1, 0, 0.5, 0.5]);
});

test('particleAt: deterministic, stays in the frame, moves the way its direction says', () => {
  const rnd = C.prng(7);
  const ps = Array.from({ length: 50 }, () => ({ x: rnd(), y: rnd(), a: rnd() * Math.PI * 2, v: 0.01 + rnd() * 0.03, spin: rnd() - 0.5 }));
  for (const dir of ['up', 'down', 'drift', 'burst']) for (const p of ps) for (const T of [0, 1.3, 7.7, 120]) {
    const q = C.particleAt(p, T, dir);
    assert.deepEqual(q, C.particleAt(p, T, dir), 'same T → same place');
    assert.ok(q.x >= -0.2 && q.x <= 1.2 && q.y >= -0.2 && q.y <= 1.2, `${dir} inside (${q.x}, ${q.y})`);
    assert.ok(q.life >= 0 && q.life <= 1);
  }
  const p = { x: 0.5, y: 0.5, a: 1, v: 0.02, spin: 0 };
  assert.ok(C.particleAt(p, 1, 'up').y < 0.5, 'up goes up');
  assert.ok(C.particleAt(p, 1, 'down').y > 0.5, 'down goes down');
  const b0 = C.particleAt(p, 0, 'burst'), b1 = C.particleAt(p, 2, 'burst');
  assert.ok(Math.hypot(b1.x - 0.5, b1.y - 0.5) > Math.hypot(b0.x - 0.5, b0.y - 0.5), 'burst flies outwards');
  assert.equal(C.lifeAlpha(0), 0); assert.equal(C.lifeAlpha(1), 0); assert.equal(C.lifeAlpha(0.5), 1);
});

test('ripples / slowWave / mixHex', () => {
  const on = [{ t: 1, s: 1 }, { t: 1.5, s: 0.5 }];
  assert.deepEqual(C.ripples(on, 0.5), []);
  const r = C.ripples(on, 1.6);
  assert.equal(r.length, 2);
  assert.ok(r.every((x) => x.r >= 0 && x.r < 1 && x.a > 0 && x.a <= 0.45), 'thin, faint, short-lived rings');
  assert.equal(C.ripples(on, 3).length, 0, 'gone after 1.2 s');
  assert.equal(C.slowWave(0), 0); assert.ok(Math.abs(C.slowWave(4) - 1) < 1e-9);
  let maxStep = 0; for (let t = 0; t < 16; t += 1 / 30) maxStep = Math.max(maxStep, Math.abs(C.slowWave(t + 1 / 30) - C.slowWave(t)));
  assert.ok(maxStep < 0.02, 'never changes fast (≤ 2 % per frame)');
  assert.equal(C.mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(C.mixHex('#ff0000', '#0000ff', 0), '#ff0000');
});

test('colour flow (≤ 30 % mix) never makes the two visualizer colours meet (QC: complementary pairs went grey)', () => {
  for (const [a, b] of [['#25f4ee', '#fe2c55'], ['#ffffff', '#000000'], ['#a3e635', '#22d3ee']]) {
    const x = C.mixHex(a, b, 0.3 * C.slowWave(5, 10)), y = C.mixHex(b, a, 0.3 * C.slowWave(5, 10));
    assert.notEqual(x, y);
    assert.ok(C.contrast(x, y) > 1.3 || C.contrast(a, b) < 1.6, `${a}/${b} still distinct at the peak: ${x} vs ${y}`);
  }
});

/* ---------------- creator tools ---------------- */
const sine = (sr, sec, amp, f = 997) => { const n = Math.round(sr * sec), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / sr); return x; };

test('loudness: BS.1770 reference — 997 Hz full-scale sine is −3.01 LUFS on one channel, 0 on two', () => {
  for (const sr of [44100, 48000]) {
    const x = sine(sr, 5, 1);
    assert.ok(Math.abs(C.loudness([x], sr).lufs + 3.01) < 0.05, `${sr} mono`);
    assert.ok(Math.abs(C.loudness([x, x], sr).lufs) < 0.05, `${sr} stereo`);
  }
  const k = C.kWeighting(48000); // published 48 kHz coefficients (ITU-R BS.1770-4 table 1 / 2)
  assert.ok(Math.abs(k[0].b[0] - 1.53512485958697) < 1e-9 && Math.abs(k[0].a[0] + 1.69065929318241) < 1e-9);
  assert.ok(Math.abs(k[1].a[0] + 1.99004745483398) < 1e-9 && Math.abs(k[1].a[1] - 0.99007225036621) < 1e-9);
});

test('loudness: −20 dB tone is −20 LUFS; a range is measured, silence is −Infinity, gating ignores silent parts', () => {
  const sr = 48000, x = sine(sr, 4, 0.1);
  assert.ok(Math.abs(C.loudness([x, x], sr).lufs + 20) < 0.05);
  const half = new Float32Array(sr * 8); half.set(x, sr * 4); // 4 s silence + 4 s tone
  // the 3 blocks straddling the silence→tone edge are partly quiet but pass the relative gate (as in BS.1770 / ffmpeg)
  assert.ok(Math.abs(C.loudness([half, half], sr).lufs + 20) < 0.4, 'absolute gate drops the silence');
  assert.ok(C.loudness([half, half], sr).lufs > C.loudness([x, x], sr).lufs - 0.4 && C.loudness([half, half], sr).lufs < -20 + 1e-9, 'never louder than the tone');
  assert.ok(Math.abs(C.loudness([half, half], sr, sr * 4, sr * 8).lufs + 20) < 0.1, 'range');
  assert.equal(C.loudness([new Float32Array(sr)], sr).lufs, -Infinity);
  assert.equal(C.loudness([x], sr, 0, sr).peak.toFixed(3), '0.100');
  assert.ok(isFinite(C.loudness([sine(sr, 0.2, 0.5)], sr).lufs), 'a clip shorter than one 400 ms block is still measured');
});

test('loudness matches ffmpeg ebur128 on a real fixture', () => {
  const b = readFileSync(join(FIX, 'tone.wav'));
  let o = 12, fmt, data;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12) };
    if (id === 'data') { data = b.subarray(o + 8, o + 8 + sz); break; }
    o += 8 + sz;
  }
  const n = data.length / 2 / fmt.ch, ch = Array.from({ length: fmt.ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) ch[c][i] = data.readInt16LE((i * fmt.ch + c) * 2) / 32768;
  const ours = C.loudness(ch, fmt.sr).lufs;
  if (hasFfmpeg) {
    const r = require('node:child_process').spawnSync('ffmpeg', ['-hide_banner', '-i', join(FIX, 'tone.wav'), '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
    const ref = +[...r.stderr.matchAll(/I:\s+(-?[0-9.]+) LUFS/g)].pop()[1]; // the last one is the summary
    assert.ok(Math.abs(ours - ref) < 0.15, `ours ${ours} vs ffmpeg ${ref}`);
  } else assert.ok(Math.abs(ours + 22.8) < 0.15);
});

test('normGain: reaches the target, never clips past the ceiling, never boosts > 20 dB, leaves silence alone', () => {
  const g = C.normGain({ lufs: -20, peak: 0.1 }, -14);
  assert.ok(Math.abs(g.db - 6) < 1e-9 && !g.limited);
  const capped = C.normGain({ lufs: -20, peak: 0.9 }, -14, -1.5); // +6 dB would push the peak to 1.8
  assert.ok(capped.limited && capped.gain * 0.9 <= Math.pow(10, -1.5 / 20) + 1e-12);
  assert.ok(C.normGain({ lufs: -9, peak: 0.5 }, -14).db < 0, 'too loud → turned down');
  assert.equal(C.normGain({ lufs: -60, peak: 0.001 }, -14).gain, 10, '+20 dB max');
  assert.deepEqual(C.normGain({ lufs: -Infinity, peak: 0 }), { gain: 1, db: 0, limited: false });
  assert.equal(C.LOUDNESS_TARGETS.social, -14);
  assert.equal(C.LOUDNESS_TARGETS.podcast, -16);
});

test('safe zones: vertical frames only; the safe box is inside the frame and clear of the buttons on the right', () => {
  for (const p of Object.keys(C.SAFE_ZONES)) {
    const r = C.safeRect(p, 1080, 1920);
    assert.ok(r.x > 0 && r.y > 0 && r.x + r.w < 1080 && r.y + r.h < 1920, p);
    assert.ok(1080 - (r.x + r.w) >= 110, `${p}: right-side buttons (≥ 110 px)`);
    assert.ok(1920 - (r.y + r.h) >= 470, `${p}: caption + username (≥ 470 px)`);
  }
  assert.ok(C.safeRect('reels', 1080, 1920).h < C.safeRect('tiktok', 1080, 1920).h, 'Reels covers more at the bottom');
  assert.equal(C.safeRect('tiktok', 1920, 1080), null, '16:9 has no app overlay');
  assert.equal(C.safeRect('nope', 1080, 1920), null);
  assert.deepEqual(C.safeRect('tiktok', 540, 960), { x: 30, y: 65, w: 434, h: 655 }, 'scales with the frame');
});

test('containRect = CSS object-fit: contain', () => {
  assert.deepEqual(C.containRect(1080, 1920, 300, 300), { x: 65.625, y: 0, w: 168.75, h: 300 });
  assert.deepEqual(C.containRect(1920, 1080, 320, 400), { x: 0, y: 110, w: 320, h: 180 });
  assert.deepEqual(C.containRect(0, 0, 10, 10), { x: 0, y: 0, w: 0, h: 0 });
});

test('encodeWav: valid header, interleaved 16-bit samples, range + gain + clipping; ffmpeg reads it', (t) => {
  const L = Float32Array.from([0, 0.5, -0.5, 1, -1]), R = Float32Array.from([0.25, 0.25, 0.25, 0.25, 0.25]);
  const w = Buffer.from(C.encodeWav([L, R], 44100, 1, 4, 2));
  assert.equal(w.toString('ascii', 0, 4), 'RIFF');
  assert.equal(w.toString('ascii', 8, 12), 'WAVE');
  assert.equal(w.readUInt16LE(22), 2);
  assert.equal(w.readUInt32LE(24), 44100);
  assert.equal(w.readUInt32LE(28), 44100 * 4, 'byte rate');
  assert.equal(w.readUInt32LE(40), 3 * 2 * 2, '3 frames × 2 ch × 2 bytes');
  assert.equal(w.readUInt32LE(4), w.length - 8);
  const s = [...Array(6)].map((_, i) => w.readInt16LE(44 + i * 2));
  assert.deepEqual(s, [32767, 16384, -32768, 16384, 32767, 16384], 'gain 2, clipped at ±1, interleaved L R');
  if (hasFfmpeg) {
    const f = join(require('node:os').tmpdir(), `wav-${process.pid}.wav`);
    require('node:fs').writeFileSync(f, C.encodeWav([sine(48000, 1, 0.5)], 48000));
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,channels,sample_rate', '-of', 'csv=p=0', f]).toString().trim();
    require('node:fs').unlinkSync(f);
    assert.equal(out, 'pcm_s16le,48000,1');
  }
});

test('parseHighlight: *stars* mark keywords; unmatched stars stay text', () => {
  assert.deepEqual(C.parseHighlight('Kiếm *10 triệu* đầu tiên'), [{ t: 'Kiếm ', hi: false }, { t: '10 triệu', hi: true }, { t: ' đầu tiên', hi: false }]);
  assert.deepEqual(C.parseHighlight('*A**B*'), [{ t: 'A', hi: true }, { t: 'B', hi: true }]);
  assert.deepEqual(C.parseHighlight('giá 5* sao'), [{ t: 'giá 5* sao', hi: false }]);
  assert.deepEqual(C.parseHighlight(''), []);
});

test('fitQuality: best quality under the limit; falls back to the smallest when nothing fits; ≤ 8 encodes', async () => {
  let calls = 0;
  const enc = async (q) => { calls++; return { size: Math.round(q * 1000) }; }; // size grows with quality
  const r = await C.fitQuality(enc, 700);
  assert.ok(r.fits && r.blob.size <= 700 && r.blob.size > 680, JSON.stringify(r));
  assert.ok(calls <= 8, `${calls} encodes`);
  const big = await C.fitQuality(async (q) => ({ size: 5000 + q }), 100);
  assert.equal(big.fits, false);
  assert.equal(big.q, 0.5, 'smallest attempt');
  assert.deepEqual(await C.fitQuality(async () => ({ size: 1 }), 10), { blob: { size: 1 }, q: 0.95, fits: true });
});

test('captionStats: emoji count once, unique hashtags (Vietnamese letters), limits, spam + broken-hashtag warnings', () => {
  const s = C.captionStats('Học tiếng Anh 👨‍👩‍👧 #HọcTập #họctập #tiktokvn');
  assert.equal(s.chars, 'Học tiếng Anh X #HọcTập #họctập #tiktokvn'.length);
  assert.deepEqual(s.hashtags, ['#HọcTập', '#tiktokvn']);
  assert.deepEqual(s.over, {});
  assert.deepEqual(s.warnings, []);
  assert.equal(C.captionStats('x'.repeat(101)).over.ytTitle, 1);
  assert.ok(C.captionStats('x'.repeat(4001)).over.tiktok === 1);
  const many = Array.from({ length: 61 }, (_, i) => '#t' + i).join(' ');
  assert.match(C.captionStats(many).warnings[0], /hơn 60/);
  assert.match(C.captionStats(Array.from({ length: 20 }, (_, i) => '#t' + i).join(' ')).warnings[0], /spam/);
  assert.equal(C.captionStats('#a #b').warnings.length, 0, 'normal hashtags are fine');
  assert.match(C.captionStats('vui # quá').warnings[0], /dấu #/);
});

test('checkFileSize: refuses only files over the limit, with a readable message', () => {
  assert.equal(C.checkFileSize({ name: 'a.jpg', size: 10 }, 'image'), null);
  assert.match(C.checkFileSize({ name: 'a.jpg', size: 151 * 1048576 }, 'image'), /quá lớn .* tối đa 150\.00 MB cho ảnh/);
  assert.equal(C.checkFileSize({ name: 'a.mp4', size: 500 * 1048576 }, 'audio'), null);
  assert.match(C.checkFileSize({ name: 'a.mp4', size: 2e9 }, 'audio'), /audio\/video/);
});

test('loudness index: identical to the one-shot measurement, whole track or any range, in any slice size', () => {
  const sr = 44100, x = sine(sr, 12, 0.2), y = sine(sr, 12, 0.05, 220);
  const one = C.loudnessIndex([x, y], sr);
  assert.equal(one.step(), true);
  const sliced = C.loudnessIndex([x, y], sr);
  let steps = 0; while (!sliced.step(sr * 0.37)) steps++; // slice sizes that do not line up with 100 ms segments
  assert.ok(steps > 20);
  for (const [a, b] of [[0, 12], [2, 7.5], [0.3, 0.6], [11, 12]]) {
    const ref = C.loudness([x, y], sr, a * sr, b * sr);
    for (const idx of [one, sliced]) {
      const r = C.loudnessRange(idx, a, b);
      assert.ok(Math.abs(r.lufs - ref.lufs) < 0.05, `${a}-${b}: ${r.lufs} vs ${ref.lufs}`);
      assert.ok(Math.abs(r.peak - ref.peak) < 1e-6);
    }
  }
});

test('loudness index: built once, then a range costs < 5 ms even for a 1-hour stereo podcast', () => {
  const sr = 48000, x = new Float32Array(sr * 3600);
  for (let i = 0; i < x.length; i += 7) x[i] = ((i * 2654435761) % 1000) / 4000 - 0.125;
  const idx = C.loudnessIndex([x, x], sr);
  let t = performance.now();
  while (!idx.step(sr * 5)) {}
  const build = performance.now() - t;
  t = performance.now();
  for (let k = 0; k < 20; k++) C.loudnessRange(idx, k * 60, k * 60 + 900);
  const per = (performance.now() - t) / 20;
  assert.ok(per < 5, `range query ${per.toFixed(2)} ms`);
  assert.ok(build < 30000, `index build ${build | 0} ms`);
});

test('downmixStereo: mono doubled, stereo as is, quad and 5.1 like the Web Audio speaker down-mix (voice on C kept)', () => {
  const v = (a) => Float32Array.from(a);
  const m = v([0.5]);
  assert.deepEqual(C.downmixStereo([m]), [m, m]);
  const L = v([0.1]), R = v([0.2]);
  assert.deepEqual(C.downmixStereo([L, R]), [L, R]);
  const q = C.downmixStereo([v([0.2]), v([0.4]), v([0.6]), v([0.8])]);
  assert.ok(Math.abs(q[0][0] - 0.4) < 1e-6 && Math.abs(q[1][0] - 0.6) < 1e-6);
  const s = C.downmixStereo([v([0]), v([0]), v([0.3]), v([0.9]), v([0]), v([0])]); // L R C LFE SL SR: voice on C only
  assert.ok(Math.abs(s[0][0] - 0.3 * Math.SQRT1_2) < 1e-6 && Math.abs(s[1][0] - 0.3 * Math.SQRT1_2) < 1e-6, 'centre to both sides, LFE dropped');
  const three = [v([1]), v([2]), v([3])];
  assert.deepEqual(C.downmixStereo(three), [three[0], three[1]], 'discrete: first two');
});

test('wavParts: byte-identical to encodeWav, in chunks (no single huge buffer)', () => {
  const sr = 8000, a = sine(sr, 7.3, 0.4), b = sine(sr, 7.3, 0.2, 300);
  const parts = C.wavParts([a, b], sr, 123, sr * 7 + 5, 1.7, 2);
  assert.ok(parts.length >= 4);
  assert.ok(parts.slice(1).every((p) => p.length <= 2 * sr * 2 * 2));
  assert.equal(Buffer.compare(Buffer.concat(parts.map((p) => Buffer.from(p))), Buffer.from(C.encodeWav([a, b], sr, 123, sr * 7 + 5, 1.7))), 0);
  assert.equal(C.wavParts([a], sr, 0, 0).length, 1, 'empty range → header only');
});

/* ---------------- text video: slide plans, highlight, reading time ---------------- */
test('slidePlan even: equal parts of the music; fixed seconds keep their length (extra slides hidden past the end)', () => {
  assert.deepEqual(C.slidePlan({ n: 4, audioDur: 20 }), { starts: [0, 5, 10, 15], duration: 20, snapped: 0, tooShort: false });
  const p = C.slidePlan({ n: 4, fixedSeg: 8, audioDur: 20 });
  assert.deepEqual(p.starts, [0, 8, 16, 24]);
  assert.equal(p.duration, 20);
  assert.deepEqual(C.slidePlan({ n: 3 }).starts, [0, 3, 6]); // no music: 3 s each
});

test('slidePlan beat: slide changes land ON a drum hit near the even point, never closer than 0.5 s', () => {
  const onsets = [0.5, 4.9, 5.4, 9.8, 10.9, 15.2].map((t) => ({ t, s: 1 }));
  const p = C.slidePlan({ n: 4, mode: 'beat', audioDur: 20, onsets });
  assert.deepEqual(p.starts, [0, 4.9, 9.8, 15.2]);
  assert.equal(p.tooShort, false);
  assert.equal(p.snapped, 3);
  // no hit near a change → that change stays on the even point
  const q = C.slidePlan({ n: 2, mode: 'beat', audioDur: 20, onsets: [{ t: 1, s: 1 }] });
  assert.deepEqual(q.starts, [0, 10]);
  assert.equal(q.snapped, 0);
  // no beats at all = even
  assert.deepEqual(C.slidePlan({ n: 2, mode: 'beat', audioDur: 10, onsets: [] }).starts, [0, 5]);
  // dense hits: starts strictly increasing with ≥ MIN_SLIDE gaps
  const dense = Array.from({ length: 200 }, (_, i) => ({ t: i * 0.25, s: 1 }));
  const d = C.slidePlan({ n: 30, mode: 'beat', audioDur: 40, onsets: dense });
  for (let i = 1; i < d.starts.length; i++) assert.ok(d.starts[i] - d.starts[i - 1] >= C.MIN_SLIDE - 1e-9);
  // review: 30 slides on 10 s with few hits — beat mode used to push 10 slides past the end (hidden)
  const many = C.slidePlan({ n: 30, mode: 'beat', audioDur: 10, onsets: [{ t: 2, s: 1 }, { t: 4, s: 1 }] });
  assert.equal(many.tooShort, true);
  assert.deepEqual(C.readWarnings(Array(30).fill('a'), many.starts, many.duration).filter((w) => w.hidden), []);
  assert.deepEqual(many.starts, C.slidePlan({ n: 30, audioDur: 10 }).starts);
});

test('slidePlan tap: tapped moments are the changes; double taps and too-late taps ignored; untapped slides share the rest', () => {
  assert.deepEqual(C.slidePlan({ n: 3, mode: 'tap', audioDur: 30, taps: [7, 18] }).starts, [0, 7, 18]);
  assert.deepEqual(C.slidePlan({ n: 3, mode: 'tap', audioDur: 30, taps: [7, 7.2, 18, 29.9] }).starts, [0, 7, 18]);
  const p = C.slidePlan({ n: 4, mode: 'tap', audioDur: 30, taps: [10] }); // slides 2–4 share 10…30
  assert.deepEqual(p.starts.map((x) => +x.toFixed(2)), [0, 10, 16.67, 23.33]);
  assert.equal(p.duration, 30);
  const q = C.slidePlan({ n: 3, mode: 'tap', taps: [2] }); // no music: tail slides 3 s each
  assert.deepEqual(q.starts, [0, 2, 5]);
  assert.equal(q.duration, 8);
  assert.deepEqual(C.slidePlan({ n: 2, mode: 'tap', audioDur: 10, taps: [] }).starts, [0, 5]); // nothing tapped = even
});

test('slideAt: the slide on screen at any time', () => {
  const s = [0, 4.6, 9.8];
  assert.deepEqual([0, 4.59, 4.6, 9.7, 9.8, 99].map((t) => C.slideAt(s, t)), [0, 0, 1, 1, 2, 2]);
});

test('highlightWords + lineHighlights: *keyword* boxes survive wrapping and broken long words, runs rebuild the line exactly', () => {
  const { plain, words } = C.highlightWords('Cách *kiếm tiền* online\nngay *hôm*nay');
  assert.equal(plain, 'Cách kiếm tiền online\nngay hômnay');
  assert.deepEqual(words.map((w) => w.hi), [false, true, true, false, false, true]);
  assert.deepEqual([words[5].a, words[5].b], [0, 3]); // 'hômnay': only 'hôm' is starred
  const lines = ['Cách kiếm', 'tiền online', 'ngay hôm', 'nay'.length ? 'nay' : '']; // "hômnay" broken in two pieces
  const runs = C.lineHighlights(['Cách kiếm', 'tiền online', 'ngay hôm', 'nay'], words);
  runs.forEach((r, i) => assert.equal(r.map((x) => x.t).join(''), lines[i]));
  assert.deepEqual(runs[0], [{ t: 'Cách ', hi: false }, { t: 'kiếm', hi: true }]);
  assert.deepEqual(runs[1], [{ t: 'tiền', hi: true }, { t: ' online', hi: false }]);
  assert.deepEqual(runs[2], [{ t: 'ngay ', hi: false }, { t: 'hôm', hi: true }]);
  assert.deepEqual(runs[3], [{ t: 'nay', hi: true }]);
  const two = C.lineHighlights(['a b c'], C.highlightWords('a *b c*').words)[0];
  assert.deepEqual(two, [{ t: 'a ', hi: false }, { t: 'b c', hi: true }]); // one box over both words
  assert.deepEqual(C.lineHighlights([''], [])[0], [{ t: '', hi: false }]);
  // punctuation outside the stars stays outside the box
  const p2 = C.lineHighlights(['đọc 10 trang sách, mỗi (ngày)'], C.highlightWords('đọc *10 trang sách*, mỗi (*ngày*)').words)[0];
  assert.deepEqual(p2, [{ t: 'đọc ', hi: false }, { t: '10 trang sách', hi: true }, { t: ', mỗi (', hi: false }, { t: 'ngày', hi: true }, { t: ')', hi: false }]);
});

test('readTime / readWarnings: a slide shown shorter than it takes to read (or never shown) is reported', () => {
  assert.equal(C.readTime('Chào'), 1);
  assert.ok(C.readTime('Xin chào') > 1 && C.readTime('Xin chào') < 1.1);
  assert.ok(Math.abs(C.readTime('một hai ba bốn năm sáu bảy tám chín mười mười một mười hai') - (0.4 + 14 / 3)) < 1e-9);
  assert.equal(C.readTime('*một* hai'), C.readTime('một hai'));
  const sl = ['ngắn', 'một hai ba bốn năm sáu bảy tám chín mười mười một mười hai', 'ẩn'];
  const w = C.readWarnings(sl, [0, 2, 10], 8);
  assert.deepEqual(w.map((x) => [x.i, x.hidden]), [[2, true]]);
  const w2 = C.readWarnings(sl, [0, 2, 4], 8);
  assert.deepEqual(w2.map((x) => x.i), [1]);
  assert.equal(w2[0].have, 2);
});

/* ---------------- captions ---------------- */
test('parseCueTime: SRT, VTT, short and plain-second times', () => {
  assert.equal(C.parseCueTime('01:02:03,450'), 3723.45);
  assert.equal(C.parseCueTime('00:00:05.000'), 5);
  assert.equal(C.parseCueTime('02:03.25'), 123.25);
  assert.equal(C.parseCueTime(' 1:02 '), 62);
  assert.equal(C.parseCueTime('62.5'), 62.5);
  assert.ok(Number.isNaN(C.parseCueTime('abc')));
});

test('parseSubtitles: SRT with CRLF, BOM, 2-line cues and markup', () => {
  const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Xin chào</i>\r\ncác bạn\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n{\\an8}Tôi là &amp; AI\r\n\r\n';
  assert.deepEqual(C.parseSubtitles(srt), [
    { start: 1, end: 2.5, text: 'Xin chào các bạn' },
    { start: 3, end: 4, text: 'Tôi là & AI' },
  ]);
});

test('parseSubtitles: WebVTT header, NOTE / STYLE blocks, cue ids, settings, voice tags; sorted; bad cues dropped', () => {
  const vtt = 'WEBVTT - demo\n\nNOTE a comment\n--> not a cue\n\nSTYLE\n::cue { color: red }\n\nb\n00:05.000 --> 00:06.000 align:start line:0\n<v Lan>Thứ hai</v>\n\na\n00:01.000 --> 00:02.000\n<c.yellow>Thứ <00:01.500>nhất</c>\n\n00:03.000 --> 00:02.000\nngược\n\n00:07.000 --> 00:08.000\n\n';
  assert.deepEqual(C.parseSubtitles(vtt), [
    { start: 1, end: 2, text: 'Thứ nhất' },
    { start: 5, end: 6, text: 'Thứ hai' },
  ]);
  assert.deepEqual(C.parseSubtitles('not subtitles at all'), []);
});

test('toSRT round-trips through parseSubtitles', () => {
  const cues = [{ start: 0.5, end: 2, text: 'Một' }, { start: 3723.45, end: 3725, text: 'Hai' }];
  const srt = C.toSRT(cues);
  assert.match(srt, /^1\n00:00:00,500 --> 00:00:02,000\nMột\n\n2\n01:02:03,450 --> 01:02:05,000\nHai\n$/);
  assert.deepEqual(C.parseSubtitles(srt), cues);
});

test('captionLines + spreadCues: one caption per line, time in proportion to length, covers the whole clip', () => {
  const lines = C.captionLines('  Dòng   một \n\n Một dòng dài hơn hẳn nhiều chữ \r\nỪ');
  assert.deepEqual(lines, ['Dòng một', 'Một dòng dài hơn hẳn nhiều chữ', 'Ừ']);
  const cues = C.spreadCues(lines, 10, 20);
  assert.equal(cues[0].start, 10);
  assert.equal(cues[2].end, 20);
  for (let i = 1; i < cues.length; i++) assert.equal(cues[i].start, cues[i - 1].end);
  assert.ok(cues[1].end - cues[1].start > cues[0].end - cues[0].start, 'long line shows longer');
  assert.ok(cues[2].end - cues[2].start > 1, 'a 1-word line still gets readable time');
  assert.deepEqual(C.spreadCues([], 0, 5), []);
});

test('shiftCues: sync fix, never negative', () => {
  const cues = [{ start: 0.2, end: 1, text: 'a' }, { start: 2, end: 3, text: 'b' }];
  assert.deepEqual(C.shiftCues(cues, 0.5), [{ start: 0.7, end: 1.5, text: 'a' }, { start: 2.5, end: 3.5, text: 'b' }]);
  assert.deepEqual(C.shiftCues(cues, -1.5), [{ start: 0.5, end: 1.5, text: 'b' }]);
});

test('mapTime / unmapTime / remapCues: captions follow the song after silences are removed', () => {
  const cuts = [{ from: 2, to: 4 }, { from: 10, to: 11 }];
  assert.equal(C.mapTime(1, cuts), 1);
  assert.equal(C.mapTime(3, cuts), 2); // inside a cut → where it was
  assert.equal(C.mapTime(5, cuts), 3);
  assert.equal(C.mapTime(12, cuts), 9);
  for (const t of [0, 1.5, 2.5, 6, 8.9, 9.5]) assert.equal(C.mapTime(C.unmapTime(t, cuts), cuts), t);
  assert.equal(C.unmapTime(2, cuts), 4);
  const cues = [{ start: 5, end: 6, text: 'after' }, { start: 2.5, end: 3.5, text: 'inside' }, { start: 1, end: 3, text: 'across' }];
  assert.deepEqual(C.remapCues(cues, cuts), [{ start: 3, end: 4, text: 'after' }, { start: 1, end: 2, text: 'across' }]);
  assert.equal(C.remapCues(cues, null), cues);
});

test('cueAt: the caption on screen at t (gaps → none, overlap → the later one)', () => {
  const cues = [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 3, end: 5 }, { start: 4, end: 4.5 }];
  assert.equal(C.cueAt(cues, -0.1), -1);
  assert.equal(C.cueAt(cues, 0.5), 0);
  assert.equal(C.cueAt(cues, 1), 1); // end is exclusive
  assert.equal(C.cueAt(cues, 2.5), -1);
  assert.equal(C.cueAt(cues, 4.2), 3);
  assert.equal(C.cueAt(cues, 4.7), 2);
  assert.equal(C.cueAt([], 1), -1);
});

test('activeWord: word-by-word highlight moves through the cue, weighted by word length', () => {
  assert.equal(C.activeWord('a bb ccc', 0, 3, -1), -1);
  assert.equal(C.activeWord('a bb ccc', 0, 3, 0), 0);
  assert.equal(C.activeWord('a bb ccc', 0, 3, 0.9), 1); // weights 2,3,4 of 9 → word 2 from 0.67 s
  assert.equal(C.activeWord('a bb ccc', 0, 3, 2), 2);
  assert.equal(C.activeWord('a bb ccc', 0, 3, 9), 2);
  assert.equal(C.activeWord('', 0, 3, 1), -1);
});

test('captionRect: inside the TikTok, Reels AND Shorts safe zones on 9:16; a margin elsewhere', () => {
  for (const [W, H] of [[1080, 1920], [720, 1280], [1080, 1350]]) {
    const r = C.captionRect(W, H);
    for (const p of ['tiktok', 'reels', 'shorts']) {
      const s = C.safeRect(p, W, H);
      assert.ok(r.x >= s.x && r.y >= s.y && r.x + r.w <= s.x + s.w && r.y + r.h <= s.y + s.h, `${W}x${H} inside ${p}`);
    }
    assert.ok(r.y >= H * 0.06 && r.y + r.h <= H * 0.78, `${W}x${H}: within the project's 6 %–78 % band`);
  }
  assert.deepEqual(C.captionRect(1920, 1080), { x: 96, y: 54, w: 1728, h: 918 });
});

test('caption colours: white text and the yellow highlight have ≥ 4.5:1 contrast on the black outline', () => {
  assert.ok(C.contrast('#ffffff', '#000000') >= 4.5);
  assert.ok(C.contrast('#ffe14d', '#000000') >= 4.5);
});

test('captionTop: lowest free spot in the safe box, never over the title', () => {
  const r = { x: 0, y: 100, w: 500, h: 900 }; // rows 100..1000
  assert.equal(C.captionTop(r, 80), 920); // nothing to avoid: bottom
  assert.equal(C.captionTop(r, 80, [[300, 500]]), 920); // title far above: still bottom
  assert.equal(C.captionTop(r, 80, [[900, 1100]], 10), 810); // title at the bottom: just above it
  assert.equal(C.captionTop(r, 80, [[700, 850]], 10), 920); // room below the title: still the bottom
  assert.equal(C.captionTop(r, 80, [[650, 960]], 10), 560); // no room below: above
  assert.equal(C.captionTop(r, 80, [[50, 1100]]), 920); // nowhere free: bottom (readable outline anyway)
  for (const y of [C.captionTop(r, 80, [[900, 1100]]), C.captionTop(r, 80, [[650, 960]])]) assert.ok(y >= 100 && y + 80 <= 1000);
});

/* ---------------- Cắt & đổi khung video ---------------- */
test('reframeSize: 9:16 / 1:1 / 4:5 at 1080 wide; "keep" = source shape, long side ≤ 1920, even sizes', () => {
  assert.deepEqual(C.reframeSize('9:16', 1920, 1080), { w: 1080, h: 1920 });
  assert.deepEqual(C.reframeSize('1:1', 1920, 1080), { w: 1080, h: 1080 });
  assert.deepEqual(C.reframeSize('4:5', 1920, 1080), { w: 1080, h: 1350 });
  assert.deepEqual(C.reframeSize('keep', 3840, 2160), { w: 1920, h: 1080 }); // 4K: lighter for phones
  assert.deepEqual(C.reframeSize('keep', 1080, 1920), { w: 1080, h: 1920 });
  assert.deepEqual(C.reframeSize('keep', 721, 405), { w: 720, h: 404 }); // H.264 needs even sizes
  assert.deepEqual(C.reframeSize('keep', 0, 0), { w: 0, h: 0 });
});

test('reframeCrop: 16:9 → 9:16 keeps the full height; position 0 / 0.5 / 1 = left / centre / right', () => {
  const l = C.reframeCrop(1920, 1080, 1080, 1920, 0), m = C.reframeCrop(1920, 1080, 1080, 1920, 0.5), r = C.reframeCrop(1920, 1080, 1080, 1920, 1);
  assert.deepEqual(l, { left: 0, top: 0, width: 608, height: 1080, axis: 'x' });
  assert.equal(m.left, 656);
  assert.equal(r.left + r.width, 1920); // flush right, never outside the source
  assert.ok(Math.abs(608 / 1080 - 9 / 16) < 0.005);
  // a tall phone video into a square: slides vertically
  assert.deepEqual(C.reframeCrop(1080, 1920, 1080, 1080, 0.5), { left: 0, top: 420, width: 1080, height: 1080, axis: 'y' });
  // same shape: nothing to slide, the whole picture
  assert.deepEqual(C.reframeCrop(320, 240, 320, 240, 1), { left: 0, top: 0, width: 320, height: 240, axis: null });
  // bad positions are clamped / defaulted, odd sources give even sizes inside the source
  assert.equal(C.reframeCrop(1920, 1080, 1080, 1920, 7).left, 1312);
  assert.equal(C.reframeCrop(1920, 1080, 1080, 1920, -1).left, 0);
  assert.equal(C.reframeCrop(1920, 1080, 1080, 1920, NaN).left, 656);
  const o = C.reframeCrop(1279, 719, 1080, 1920, 1);
  assert.ok(o.width % 2 === 0 && o.height % 2 === 0 && o.left + o.width <= 1279 && o.height <= 719);
});

test('reframeDrag: dragging the picture right shows more of its left side; clamped to 0..1', () => {
  const slack = C.reframeSlack(1920, 1080, 1080, 1920);
  assert.ok(Math.abs(slack - (1312 * 1080) / 608) < 1e-6);
  assert.ok(C.reframeDrag(0.5, 100, slack) < 0.5);
  assert.ok(C.reframeDrag(0.5, -100, slack) > 0.5);
  assert.equal(C.reframeDrag(0.5, -1e6, slack), 1);
  assert.equal(C.reframeDrag(0.5, 1e6, slack), 0);
  assert.equal(C.reframeDrag(0.3, 50, 0), 0.3); // nothing to slide
  assert.equal(C.reframeSlack(320, 240, 320, 240), 0);
});

test('reframeFit: the whole 16:9 picture centred in 9:16 (room above and below for the blurred / coloured background)', () => {
  assert.deepEqual(C.reframeFit(1920, 1080, 1080, 1920), { x: 0, y: 656, w: 1080, h: 608 });
  assert.deepEqual(C.reframeFit(1080, 1920, 1080, 1080), { x: 236, y: 0, w: 608, h: 1080 });
});

test('reframeSegment: empty end = to the end; too short / past the end gives a message', () => {
  assert.deepEqual(C.reframeSegment(2, '', 10), { start: 2, end: 10, error: null });
  assert.deepEqual(C.reframeSegment('1.5', '4', 10), { start: 1.5, end: 4, error: null });
  assert.equal(C.reframeSegment(0, 99, 10).end, 10);
  assert.match(C.reframeSegment(12, '', 10).error, /bắt đầu/);
  assert.match(C.reframeSegment(4, 4.2, 10).error, /0,5 giây/);
  assert.match(C.reframeSegment(0, '', 0).error, /Chưa có video/);
});

test('formatTenths: the chosen part to a tenth of a second, Vietnamese decimal comma', () => {
  assert.equal(C.formatTenths(0.5), '0:00,5');
  assert.equal(C.formatTenths(75.25), '1:15,3');
  assert.equal(C.formatTenths(59.96), '1:00,0'); // not "0:60,0"
  assert.equal(C.formatTenths(''), '0:00,0');
});

test('wordReveal: words appear one by one; the newest word has its own progress (word-pop / karaoke)', () => {
  assert.deepEqual(C.wordReveal([2, 2], 0), { shown: 0, cur: -1, p: 0 });
  assert.deepEqual(C.wordReveal([2, 2], 1), { shown: 4, cur: 3, p: 1 });
  const h = C.wordReveal([2, 2], 0.375); // 1.5 words
  assert.equal(h.shown, 2);
  assert.equal(h.cur, 1);
  assert.ok(Math.abs(h.p - 0.5) < 1e-9);
  assert.deepEqual(C.wordReveal([], 0.5), { shown: 0, cur: -1, p: 1 });
});

test('lineStagger: lines enter one after another and all are in place at the end', () => {
  assert.equal(C.lineStagger(0, 3, 0), 0);
  assert.ok(C.lineStagger(0, 3, 0.3) > C.lineStagger(1, 3, 0.3));
  assert.equal(C.lineStagger(2, 3, 0.3), 0);
  for (let i = 0; i < 3; i++) assert.equal(C.lineStagger(i, 3, 1), 1);
});

/* ---------------- captions: review fixes ---------------- */
test('parseSubtitles: a bad numeric entity never breaks the import; hex entities decode; lone < > survive', () => {
  assert.doesNotThrow(() => C.parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nA &#99999999; B &#55357; C\n'));
  assert.equal(C.parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nA &#99999999; B\n')[0].text, 'A &#99999999; B');
  assert.equal(C.cleanCueText('Cười &#x1F600; &#128512;'), 'Cười 😀 😀');
  assert.equal(C.cleanCueText('I <3 you, 5 > 3'), 'I <3 you, 5 > 3');
  assert.equal(C.cleanCueText('<i>nghiêng</i> <c.vang>màu</c> <v Lan>Lan nói</v> <00:00:01.500>tiếp'), 'nghiêng màu Lan nói tiếp');
});

test('parseSubtitles: a hand-edited .srt that lost the blank line between cues still gives two captions', () => {
  const cs = C.parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nHello\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n');
  assert.deepEqual(cs, [{ start: 1, end: 2, text: 'Hello' }, { start: 3, end: 4, text: 'World' }]);
  // VTT: NOTE blocks and cue identifiers are not caption text
  assert.deepEqual(C.parseSubtitles('WEBVTT\n\nNOTE ghi chú\nnhiều dòng\n\nmo-dau\n00:01.000 --> 00:02.000 align:start\n<v Bob>Hi</v>\n'), [{ start: 1, end: 2, text: 'Hi' }]);
});

test('cueAt: a long caption under several short ones keeps showing until it ends', () => {
  const cs = [{ start: 0, end: 10 }, ...[1, 2, 3, 4, 5].map((t) => ({ start: t, end: t + 0.5 }))];
  assert.equal(C.cueAt(cs, 5.2), 5); // the newest wins while it shows
  assert.equal(C.cueAt(cs, 5.7), 0); // then the long one again (it vanished before)
  assert.equal(C.cueAt(cs, 9.9), 0);
  assert.equal(C.cueAt(cs, 10.1), -1);
});

test('captionTopLayers: off the art / visualizer / bar when there is room, else over the visualizer, never over the title', () => {
  const r = { x: 0, y: 100, w: 600, h: 900 }; // safe box 100…1000
  const title = [700, 780], vis = [800, 900], bar = [960, 1000];
  const L = (art) => [[title, art, vis, bar], [title, art, bar], [title, bar], [title]];
  // room between the art and the title (600…700): the first layer wins — nothing is covered
  assert.equal(C.captionTopLayers(r, 80, L([100, 600]), 0), 620);
  // no gap anywhere for 80 px → the 2nd layer lets it sit over the visualizer, just above the time bar
  assert.equal(C.captionTopLayers(r, 80, L([100, 650]), 0), 880);
  // with room under the visualizer, the first layer wins
  assert.equal(C.captionTopLayers(r, 40, [[title, [100, 650], vis, bar], [title]], 0), 920); // 40 px fits under the visualizer
  assert.equal(C.captionSpot(r, 2000, []), null);
});

test('srtLooksClipRelative: the app\'s own .srt (times from the clip start) is recognised when the clip starts later', () => {
  assert.equal(C.srtLooksClipRelative([{ start: 0.5, end: 1.5 }], 1, 10), true);
  assert.equal(C.srtLooksClipRelative([{ start: 0.5, end: 1.5 }], 0, 10), false); // same thing either way
  assert.equal(C.srtLooksClipRelative([{ start: 12, end: 14 }], 10, 20), false); // song times inside the clip
  assert.equal(C.srtLooksClipRelative([{ start: 0.5, end: 30 }], 1, 10), false); // longer than the clip: a song file
});

test('checkFileSize: subtitles are limited to 2 MB, and the message says "phụ đề"', () => {
  assert.equal(C.checkFileSize({ name: 'a.srt', size: 1e6 }, 'subtitle'), null);
  assert.match(C.checkFileSize({ name: 'a.srt', size: 3e6 }, 'subtitle'), /phụ đề/);
});

test('parseSeconds: "2,5" is 2.5 s (Vietnamese comma), also "2.5", "1:15,3", "75"; junk → NaN', () => {
  assert.equal(C.parseSeconds('2,5'), 2.5);
  assert.equal(C.parseSeconds('2.5'), 2.5);
  assert.equal(C.parseSeconds('1:15,3'), 75.3);
  assert.equal(C.parseSeconds(' 75 '), 75);
  assert.ok(Number.isNaN(C.parseSeconds('')));
  assert.ok(Number.isNaN(C.parseSeconds('abc')));
  assert.deepEqual(C.reframeSegment('1,5', '2,5', 10), { start: 1.5, end: 2.5, error: null }); // not 15 → 25
});

test('loudnessStream: chunk by chunk gives exactly the whole-buffer index (no big buffer needed)', () => {
  const sr = 8000, n = sr * 7, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = 0.3 * Math.sin(i / 7) * (i > sr * 2 ? 1 : 0.2); R[i] = 0.25 * Math.sin(i / 11); }
  const whole = C.loudnessIndex([L, R], sr); whole.step();
  const st = C.loudnessStream(sr, 2);
  for (let p = 0; p < n; p += 1237) st.push([L.subarray(p, Math.min(n, p + 1237)), R.subarray(p, Math.min(n, p + 1237))]);
  const a = C.loudnessRange(whole, 0.5, 6.5), b = C.loudnessRange(st, 0.5, 6.5);
  assert.ok(Math.abs(a.lufs - b.lufs) < 1e-6, `${a.lufs} vs ${b.lufs}`);
  assert.equal(a.peak, b.peak);
  assert.equal(st.len, n);
});
