/*
 * In-browser self test: open index.html#selftest on any device (iPhone, Android…) to check
 * what that browser supports, end to end, with real encoders. Also run by the e2e suite.
 */
const SelfTest = (() => {
  const results = [];

  /** 16-bit PCM WAV with a sine tone, built in memory (no network). */
  function makeWav(seconds = 1, sr = 44100, freq = 440) {
    const n = Math.round(seconds * sr);
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 12000), true);
    return new File([buf], 'selftest.wav', { type: 'audio/wav' });
  }

  async function fixture(name, type) {
    const r = await fetch('tests/fixtures/' + name, { cache: 'no-store' });
    if (!r.ok) throw new Error('không tải được fixture ' + name);
    return new File([await r.blob()], name, { type });
  }

  const withTimeout = (p, ms, what) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`quá ${ms / 1000}s: ${what}`)), ms))]);

  /** Checks: [name, fn, level]. level 'required' = the site is broken without it; 'optional' = degraded. */
  const CHECKS = [
    ['Thư viện CDN đã tải (Cropper, JSZip, UPNG, Mediabunny)', async () => {
      const miss = ['Cropper', 'JSZip', 'UPNG'].filter((k) => !window[k]);
      try { await VideoEngine.loadMediabunny(); } catch (e) { miss.push('Mediabunny (' + e.message + ')'); }
      if (miss.length) throw new Error('thiếu ' + miss.join(', '));
      return 'OK';
    }, 'required'],
    ['Xuất ảnh JPG / PNG từ canvas', async () => {
      if (!SUPPORTED_OUT.includes('image/jpeg') || !SUPPORTED_OUT.includes('image/png')) throw new Error(SUPPORTED_OUT.join(', '));
      return SUPPORTED_OUT.map((t) => FORMAT_INFO[t].label).join(', ');
    }, 'required'],
    ['Nén lossless JPG (bỏ EXIF, giữ hướng xoay)', async () => {
      const f = await fixture('photo-exif.jpg', 'image/jpeg');
      const { parts } = Core.stripJpegBytes(new Uint8Array(await f.arrayBuffer()));
      const blob = new Blob(parts, { type: 'image/jpeg' });
      const { w, h, url } = await loadImgFromBlob(blob);
      URL.revokeObjectURL(url);
      if (blob.size >= f.size) throw new Error('không nhỏ hơn');
      // orientation 6 = rotate 90°: a 400×300 photo must display as 300×400
      if (!(w === 300 && h === 400)) throw new Error(`hiển thị ${w}×${h}, mong đợi 300×400`);
      return `${formatBytes(f.size)} → ${formatBytes(blob.size)}, ${w}×${h}`;
    }, 'required'],
    ['Giải mã HEIC', async () => {
      const native = await new Promise((r) => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = 'data:image/heic;base64,AAAA'; });
      await waitFor(() => window.heic2any, 8000);
      if (window.heic2any) return native ? 'native' : 'heic2any (WASM)';
      throw new Error('không có heic2any');
    }, 'optional'],
    ['Giải mã audio WAV', async () => {
      const b = await decodeAudioFile(makeWav());
      if (Math.abs(b.duration - 1) > 0.05) throw new Error('độ dài ' + b.duration);
      return `${b.sampleRate} Hz`;
    }, 'required'],
    ['Giải mã audio M4A (AAC)', async () => {
      const b = await decodeAudioFile(await fixture('tone.m4a', ''));
      return `${b.duration.toFixed(2)}s`;
    }, 'required'],
    ['Giải mã audio MP3', async () => {
      const b = await decodeAudioFile(await fixture('tone.mp3', 'audio/mpeg'));
      return `${b.duration.toFixed(2)}s`;
    }, 'required'],
    ['Lấy tiếng từ video MP4', async () => {
      const b = await decodeAudioFile(await fixture('clip.mp4', 'video/mp4'));
      return `${b.duration.toFixed(2)}s`;
    }, 'optional'],
    ['Ô chọn audio cho phép chọn mọi file trên iPhone', async () => {
      const a = $('avAudio').getAttribute('accept');
      if (IS_IOS && a) throw new Error('accept=' + a);
      return IS_IOS ? 'iOS: không giới hạn loại file' : 'accept=' + (a || '').slice(0, 40) + '…';
    }, 'required'],
    ['WebCodecs H.264 (xuất nhanh)', async () => {
      const c = await VideoEngine.capabilities();
      if (!c.webcodecs) throw new Error('không có — sẽ ghi thời gian thực');
      return 'OK';
    }, 'optional'],
    ['Mã hoá âm thanh AAC (để video có tiếng trên mọi app)', async () => {
      const { aac } = await VideoEngine.loadMediabunny();
      return aac === 'native' ? 'AAC của trình duyệt' : 'AAC qua WASM (trình duyệt không có sẵn)';
    }, 'required'],
    ['Xuất video có tiếng (1 giây) và nghe lại được', async () => {
      const audio = await decodeAudioFile(makeWav(1.2));
      const scene = {
        width: 360, height: 640, fps: 30, duration: 1, audio, audioOffset: 0,
        draw: (ctx, t) => { ctx.fillStyle = `hsl(${t * 360},80%,50%)`; ctx.fillRect(0, 0, 360, 640); },
      };
      const { blob, ext, audioCodec } = await withTimeout(VideoEngine.render(scene, () => {}), 30000, 'xuất video');
      if (!blob.size) throw new Error('file rỗng');
      const url = URL.createObjectURL(blob);
      const dur = await withTimeout(new Promise((res, rej) => {
        const v = document.createElement('video');
        v.muted = true; v.preload = 'metadata';
        v.onloadedmetadata = () => res(v.duration);
        v.onerror = () => rej(new Error('trình duyệt không đọc lại được video vừa xuất'));
        v.src = url;
      }), 10000, 'đọc video').finally(() => URL.revokeObjectURL(url));
      // Decode the sound track of the file we just made: catches "plays in preview, silent after download".
      let level = '?';
      if (document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"')) {
        const back = await decodeAudioFile(new File([blob], 'out.mp4', { type: 'video/mp4' }));
        const r = Core.rms(back.getChannelData(0).subarray(0, Math.floor(back.sampleRate * 0.8)));
        if (r < 0.05) throw new Error(`video xuất ra KHÔNG có tiếng (mức ${r.toFixed(3)})`);
        level = r.toFixed(2);
      }
      const info = `${ext.toUpperCase()}, ${formatBytes(blob.size)}, ${Number.isFinite(dur) ? dur.toFixed(2) + 's' : '?s'}, audio ${audioCodec}, mức tiếng ${level}`;
      if (ext !== 'mp4' || (Number.isFinite(dur) && Math.abs(dur - 1) > 0.3)) throw new Error(info);
      return info;
    }, 'required'],
    ['Chia sẻ file (lưu vào Ảnh / gửi TikTok)', async () => {
      if (!canShareFiles) throw new Error('không có — dùng nút Tải');
      return 'OK';
    }, 'optional'],
  ];

  function renderTable(box) {
    box.innerHTML = '';
    const t = document.createElement('table');
    t.className = 'selftest';
    for (const r of results) {
      const tr = t.insertRow();
      tr.dataset.status = r.status;
      const icon = { pass: '✅', fail: r.level === 'required' ? '❌' : '⚠️', run: '⏳' }[r.status];
      tr.insertCell().textContent = icon;
      tr.insertCell().textContent = r.name;
      tr.insertCell().textContent = r.detail || '';
    }
    box.appendChild(t);
  }

  async function run(box) {
    results.length = 0;
    const p = Core.detectPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
    box.dataset.done = '';
    for (const [name, fn, level] of CHECKS) {
      const r = { name, level, status: 'run' };
      results.push(r);
      renderTable(box);
      try { r.detail = await withTimeout(fn(), 45000, name); r.status = 'pass'; }
      catch (e) { r.detail = e.message || String(e); r.status = 'fail'; }
      renderTable(box);
    }
    const failed = results.filter((r) => r.status === 'fail' && r.level === 'required');
    const sum = document.createElement('p');
    sum.className = 'hint';
    sum.textContent = `${failed.length ? '❌ ' + failed.length + ' lỗi bắt buộc' : '✅ Thiết bị dùng được đầy đủ'} · ${p.ios ? 'iOS' : p.android ? 'Android' : 'Desktop'} · ${navigator.userAgent}`;
    box.prepend(sum);
    box.dataset.done = failed.length ? 'fail' : 'pass';
    return results.map(({ name, level, status, detail }) => ({ name, level, status, detail }));
  }

  return { run, results, makeWav };
})();

(() => {
  const open = () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-selftest'));
  };
  $('stRun').onclick = () => SelfTest.run($('stOut'));
  $('stLink').onclick = (e) => { e.preventDefault(); location.hash = 'selftest'; open(); SelfTest.run($('stOut')); };
  window.addEventListener('DOMContentLoaded', () => {
    if (location.hash === '#selftest') { open(); SelfTest.run($('stOut')); }
  });
})();
