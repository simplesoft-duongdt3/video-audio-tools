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
  assert.equal(C.bitrateFor(1080, 1920, 30), Math.round(1080 * 1920 * 30 * 0.07));
  assert.equal(C.bitrateFor(3840, 2160, 60), 10e6);
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
