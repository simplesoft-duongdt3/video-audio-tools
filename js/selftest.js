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
    ['Xuất nhanh (không phải ghi thời gian thực)', async () => {
      const c = await VideoEngine.capabilities();
      if (!c.webcodecs) throw new Error('KHÔNG — sẽ ghi thời gian thực (chậm, dễ giật). Lý do: ' + c.reason);
      return 'OK — H.264 qua WebCodecs';
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
      const { blob, ext, audioCodec, mode, fallbackReason } = await withTimeout(VideoEngine.render(scene, () => {}), 30000, 'xuất video');
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
      const info = `${mode === 'fast' ? 'xuất nhanh' : 'ghi thời gian thực (' + fallbackReason + ')'}, ${ext.toUpperCase()}, ${formatBytes(blob.size)}, ${Number.isFinite(dur) ? dur.toFixed(2) + 's' : '?s'}, audio ${audioCodec}, mức tiếng ${level}`;
      if (ext !== 'mp4' || (Number.isFinite(dur) && Math.abs(dur - 1) > 0.3)) throw new Error(info);
      return info;
    }, 'required'],
    ['Vẽ được mọi kiểu sóng nhạc và hiệu ứng (Audio → Video)', async () => {
      // every style draws something, styles look different from each other, and a frame is fast enough
      const sig = (c) => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let h = 0, varied = new Set();
        for (let i = 0; i < d.length; i += 4 * 61) { h = (h * 31 + d[i] + 3 * d[i + 1] + 7 * d[i + 2]) >>> 0; varied.add(d[i] >> 5 << 6 | d[i + 1] >> 5 << 3 | d[i + 2] >> 5); }
        return { h, colours: varied.size };
      };
      const seen = new Map(), slow = [];
      let worst = 0;
      for (const s of AVTest.styles()) {
        const { canvas, ms } = AVTest.frame(s);
        const g = sig(canvas);
        if (g.colours < 4) throw new Error(`kiểu "${s}" vẽ ra gần như trống`);
        if (s !== 'none' && [...seen.values()].includes(g.h)) throw new Error(`kiểu "${s}" giống hệt kiểu khác`);
        seen.set(s, g.h);
        worst = Math.max(worst, ms);
        if (ms > 60) slow.push(`${s} ${ms.toFixed(0)}ms`);
      }
      // and every beat effect at its strongest, at once (particles, punch, ripples, sway, moving background, colour flow)
      const ALL = { dust: true, shape: 'star', amount: 160, dir: 'burst', react: 1.4, color: 'mix', punch: true, punchAmt: 0.06, punchTarget: 'both', punchLen: 'long', ripple: true, sway: true, swayAmt: 5, bgMove: true, colorFlow: true };
      for (const s of ['bars', 'vinyl', 'orb']) {
        const { canvas, ms } = AVTest.frame(s, { fx: ALL });
        if (sig(canvas).colours < 4) throw new Error(`hiệu ứng trên kiểu "${s}" vẽ ra gần như trống`);
        worst = Math.max(worst, ms);
        if (ms > 60) slow.push(`${s}+hiệu ứng ${ms.toFixed(0)}ms`);
      }
      const n = seen.size;
      // 360×640 here; a 1080×1920 frame costs ~9× more: > 60 ms here ≈ too slow for smooth export on this device
      if (slow.length) throw new Error(`${n} kiểu · chậm: ${slow.join(', ')}`);
      return `${n} kiểu + 6 hiệu ứng · khung chậm nhất ${worst.toFixed(1)} ms (360×640)`;
    }, 'optional'],
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

/** Plain-text report of this device + recent errors, for users to paste into a message. Nothing is uploaded. */
const DebugInfo = (() => {
  const ICON = { pass: '✅', fail: '❌', run: '⏳' };
  async function report({ error } = {}) {
    const p = Core.detectPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
    let caps = {};
    try { caps = await VideoEngine.capabilities(); } catch (e) { caps = { error: e.message }; }
    const ver = (document.querySelector('script[src*="video-engine"]') || {}).src || '';
    const lines = [
      '— Video & Audio Tools: thông tin lỗi —',
      'Thời gian: ' + new Date().toISOString(),
      'Trang: ' + location.href.split('#')[0] + ' · bản ' + ((ver.match(/v=([\w]+)/) || [])[1] || '?'),
      `Thiết bị: ${p.ios ? 'iOS' : p.android ? 'Android' : 'Desktop'} · ${navigator.userAgent}`,
      `Màn hình: ${screen.width}×${screen.height} @${devicePixelRatio} · RAM: ${navigator.deviceMemory || '?'} GB · CPU: ${navigator.hardwareConcurrency || '?'}`,
      `Xuất nhanh: ${caps.webcodecs ? 'có' : 'không'}${caps.reason ? ' (' + caps.reason + ')' : ''} · AAC: ${caps.aac || '?'}`,
      'Lần chuyển sang ghi thời gian thực gần nhất: ' + (VideoEngine.lastFallbackReason || 'không có'),
    ];
    if (error) lines.push('Lỗi: ' + (error.name || 'Error') + ': ' + (error.message || String(error)));
    if (SelfTest.results.length) {
      lines.push('', 'Tự kiểm tra:');
      for (const r of SelfTest.results) lines.push(`${r.status === 'fail' && r.level !== 'required' ? '⚠️' : ICON[r.status]} ${r.name}: ${r.detail || ''}`);
    }
    if (DebugLog.items.length) lines.push('', 'Nhật ký gần nhất:', ...DebugLog.items.slice(-20));
    return lines.join('\n');
  }
  async function copy(extra) {
    const text = report(extra); // not awaited: the clipboard write must start inside the tap (Safari)
    if (await copyText(text)) toast('Đã sao chép — hãy dán vào tin nhắn gửi cho chúng tôi', 4000);
    return text;
  }
  return { report, copy };
})();

(() => {
  const open = () => { showPanel('selftest'); window.scrollTo(0, 0); };
  $('stRun').onclick = () => SelfTest.run($('stOut'));
  $('stCopy').onclick = () => DebugInfo.copy();
  $('stLink').onclick = (e) => { e.preventDefault(); location.hash = 'selftest'; open(); SelfTest.run($('stOut')); };
  const fromHash = () => {
    if (location.hash === '#selftest' && !$('tab-selftest').classList.contains('active')) { open(); SelfTest.run($('stOut')); }
  };
  window.addEventListener('DOMContentLoaded', fromHash);
  window.addEventListener('hashchange', fromHash);
})();
