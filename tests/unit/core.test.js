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
  for (const [W, H] of sizes) for (const layout of ['cover', 'top', 'minimal']) for (const style of ['bars', 'circle', 'overview']) for (const badge of [false, true]) for (const titleScale of [1, 1.3]) {
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
