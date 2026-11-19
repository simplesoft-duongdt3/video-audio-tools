/*
 * Video rendering engine.
 *  - Fast path: WebCodecs (VideoEncoder H.264 + AudioEncoder AAC/Opus) + mp4-muxer → MP4, faster than real time.
 *  - Fallback: canvas.captureStream + MediaRecorder (real time) → MP4 on Safari, WebM elsewhere.
 * A "scene" is { width, height, fps, duration, draw(ctx, t), audio: AudioBuffer|null, audioOffset }.
 */
const VideoEngine = (() => {
  const SR = 48000;
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const { bitrateFor } = Core;

  /** Yield to the event loop without setTimeout clamping (background tabs clamp timers to ≥1s). */
  const yieldUI = (() => {
    const ch = new MessageChannel();
    const q = [];
    ch.port1.onmessage = () => q.shift()();
    return () => new Promise((r) => { q.push(r); ch.port2.postMessage(0); });
  })();

  /** Wait until an encoder's queue drains below `max`. */
  async function drain(enc, max) {
    while (enc.encodeQueueSize > max) {
      if ('ondequeue' in enc) await new Promise((r) => enc.addEventListener('dequeue', r, { once: true }));
      else await yieldUI();
    }
  }

  const abortErr = () => new DOMException('Đã huỷ', 'AbortError');
  const closeQuietly = (enc) => { try { if (enc && enc.state !== 'closed') enc.close(); } catch (_) {} };

  async function wakeLock() {
    try { return await navigator.wakeLock.request('screen'); } catch (_) { return null; }
  }

  /** Trim/resample the source audio to 48 kHz stereo with a short fade-out. */
  async function prepareAudio(buffer, offset, duration) {
    const len = Math.max(1, Math.ceil(duration * SR));
    const oac = new OfflineCtx(2, len, SR);
    const src = oac.createBufferSource();
    src.buffer = buffer;
    const g = oac.createGain();
    const end = Math.max(0.05, Math.min(duration, buffer.duration - offset)); // where the audio content ends
    const fade = Math.min(0.4, end / 4);
    g.gain.setValueAtTime(1, Math.max(0, end - fade));
    g.gain.linearRampToValueAtTime(0, end);
    src.connect(g).connect(oac.destination);
    src.start(0, offset, duration);
    return oac.startRendering();
  }

  async function pickVideoConfig(w, h, fps) {
    if (typeof VideoEncoder === 'undefined') return null;
    const bitrate = bitrateFor(w, h, fps);
    for (const codec of Core.H264_CODECS) {
      const cfg = { codec, width: w, height: h, bitrate, framerate: fps, avc: { format: 'avc' } };
      try {
        const s = await VideoEncoder.isConfigSupported(cfg);
        if (s.supported) return cfg;
      } catch (_) { /* try next */ }
    }
    return null;
  }

  async function pickAudioConfig() {
    if (typeof AudioEncoder === 'undefined') return null;
    const cands = [
      { codec: 'mp4a.40.2', mux: 'aac', sampleRate: SR, numberOfChannels: 2, bitrate: 192000 },
      { codec: 'opus', mux: 'opus', sampleRate: SR, numberOfChannels: 2, bitrate: 160000 },
    ];
    for (const c of cands) {
      const { mux, ...cfg } = c;
      try {
        const s = await AudioEncoder.isConfigSupported(cfg);
        if (s.supported) return { cfg, mux };
      } catch (_) { /* next */ }
    }
    return null;
  }

  async function capabilities() {
    const v = await pickVideoConfig(1080, 1920, 30);
    const a = await pickAudioConfig();
    return { webcodecs: !!(v && window.Mp4Muxer), audio: a ? a.mux : null };
  }

  /* ---------------- WebCodecs path ---------------- */
  async function renderWebCodecs(scene, vcfg, acfg, onProgress, signal) {
    const { width: w, height: h, fps, duration, draw } = scene;
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d', { alpha: false });
    const hasAudio = !!(scene.audio && acfg);
    const aborted = () => signal && signal.aborted;

    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: w, height: h, frameRate: fps },
      audio: hasAudio ? { codec: acfg.mux, numberOfChannels: 2, sampleRate: SR } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    let failure = null;
    let venc = null, aenc = null;
    const lock = await wakeLock();
    try {
      venc = new VideoEncoder({
        output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch (e) { failure = e; } },
        error: (e) => (failure = e),
      });
      venc.configure(vcfg);

      // ---- audio first (fast) ----
      if (hasAudio) {
        onProgress(0, 'Đang xử lý audio…');
        const ab = await prepareAudio(scene.audio, scene.audioOffset || 0, duration);
        if (aborted()) throw abortErr();
        aenc = new AudioEncoder({
          output: (chunk, meta) => { try { muxer.addAudioChunk(chunk, meta); } catch (e) { failure = e; } },
          error: (e) => (failure = e),
        });
        aenc.configure(acfg.cfg);
        const L = ab.getChannelData(0);
        const R = ab.numberOfChannels > 1 ? ab.getChannelData(1) : L;
        const N = 1024 * 4;
        for (let i = 0; i < ab.length; i += N) {
          if (aborted()) throw abortErr();
          if (failure) throw failure;
          const n = Math.min(N, ab.length - i);
          const data = new Float32Array(n * 2);
          data.set(L.subarray(i, i + n), 0);
          data.set(R.subarray(i, i + n), n);
          const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i * 1e6) / SR), data });
          aenc.encode(ad);
          ad.close();
          await drain(aenc, 20);
        }
        await aenc.flush();
        aenc.close();
      }
      if (failure) throw failure;

      // ---- video frames ----
      const total = Math.max(1, Math.round(duration * fps));
      const gop = fps * 2;
      const t0 = performance.now();
      for (let i = 0; i < total; i++) {
        if (aborted()) throw abortErr();
        if (failure) throw failure;
        draw(ctx, i / fps);
        const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        venc.encode(frame, { keyFrame: i % gop === 0 });
        frame.close();
        await drain(venc, 6);
        if (i % 10 === 0) {
          const el = (performance.now() - t0) / 1000;
          const eta = i ? (el / i) * (total - i) : 0;
          onProgress(i / total, `Đang mã hoá ${i}/${total} khung · còn ~${Math.ceil(eta)}s`);
          await yieldUI();
        }
      }
      await venc.flush();
      venc.close();
      if (failure) throw failure;
      muxer.finalize();
      onProgress(1, 'Xong!');
      return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4', audioCodec: hasAudio ? acfg.mux : null };
    } finally {
      closeQuietly(aenc);
      closeQuietly(venc);
      if (lock) lock.release().catch(() => {});
    }
  }

  /* ---------------- MediaRecorder path (real time) ---------------- */
  function pickRecorderMime() {
    const list = [
      'video/mp4;codecs="avc1.42E01E, mp4a.40.2"',
      'video/mp4;codecs=avc1,mp4a',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  }

  async function renderRecorder(scene, onProgress, signal) {
    if (!window.MediaRecorder) throw new Error('Trình duyệt không hỗ trợ ghi video. Hãy dùng Chrome / Edge / Safari mới.');
    const { width: w, height: h, fps, duration, draw } = scene;
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    draw(ctx, 0);
    const stream = canvas.captureStream(fps);
    const actx = audioCtx();
    await actx.resume();
    let src = null;
    if (scene.audio) {
      const dest = actx.createMediaStreamDestination();
      src = actx.createBufferSource();
      src.buffer = scene.audio;
      src.connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    }
    const mimeType = pickRecorderMime();
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrateFor(w, h, fps) });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    const lock = await wakeLock();

    // Real-time capture breaks if the page is hidden (frames stop, audio keeps going): abort instead.
    let hiddenAbort = false;
    const onVis = () => { if (document.hidden) hiddenAbort = true; };
    document.addEventListener('visibilitychange', onVis);

    rec.start(1000);
    const start = actx.currentTime + 0.05;
    if (src) src.start(start, scene.audioOffset || 0, duration);

    try {
      // Timer driven by the audio clock (rAF would stall; this keeps the stop time exact).
      await new Promise((resolve) => {
        const iv = setInterval(() => {
          const t = actx.currentTime - start;
          if ((signal && signal.aborted) || hiddenAbort || t >= duration) { clearInterval(iv); return resolve(); }
          draw(ctx, Math.max(0, t));
          onProgress(Math.max(0, t) / duration, `Đang ghi (thời gian thực) ${formatTime(t)} / ${formatTime(duration)} — giữ màn hình này mở`);
        }, 1000 / fps);
      });
    } finally {
      document.removeEventListener('visibilitychange', onVis);
      if (src) try { src.stop(); } catch (_) {}
      if (rec.state !== 'inactive') rec.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());
      if (lock) lock.release().catch(() => {});
    }
    if (signal && signal.aborted) throw abortErr();
    if (hiddenAbort) throw new Error('Đã dừng vì bạn rời khỏi trang. Trình duyệt này ghi video theo thời gian thực — hãy giữ màn hình mở đến khi xong.');
    const type = (rec.mimeType || mimeType || 'video/webm').split(';')[0];
    onProgress(1, 'Xong!');
    return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm', audioCodec: scene.audio ? 'recorder' : null };
  }

  async function render(scene, onProgress = () => {}, signal) {
    scene.width -= scene.width % 2;
    scene.height -= scene.height % 2;
    const vcfg = window.Mp4Muxer ? await pickVideoConfig(scene.width, scene.height, scene.fps) : null;
    const acfg = scene.audio ? await pickAudioConfig() : null;
    if (vcfg && (!scene.audio || acfg)) {
      try {
        return await renderWebCodecs(scene, vcfg, acfg, onProgress, signal);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn('WebCodecs failed, falling back to MediaRecorder', e);
      }
    }
    return renderRecorder(scene, onProgress, signal);
  }

  /* ---------------- live preview player ---------------- */
  class Player {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.playing = false;
    }
    stop() {
      this.playing = false;
      if (this.src) { try { this.src.stop(); } catch (_) {} this.src = null; }
      cancelAnimationFrame(this.raf);
    }
    async play(scene, onTick) {
      this.stop();
      const actx = audioCtx();
      await actx.resume();
      this.playing = true;
      const start = actx.currentTime + 0.05;
      if (scene.audio) {
        this.src = actx.createBufferSource();
        this.src.buffer = scene.audio;
        this.src.connect(actx.destination);
        this.src.start(start, scene.audioOffset || 0, scene.duration);
      }
      const tick = () => {
        if (!this.playing) return;
        const t = actx.currentTime - start;
        if (t >= scene.duration) { this.stop(); onTick && onTick(-1); return; }
        scene.draw(this.ctx, Math.max(0, t));
        onTick && onTick(Math.max(0, t)); // negative = "ended": never send the 50 ms pre-roll

        this.raf = requestAnimationFrame(tick);
      };
      tick();
    }
  }

  /** Shows the rendered video with download / share buttons. */
  function showOutput(container, blob, name, note = '') {
    const old = container.querySelector('video');
    if (old) URL.revokeObjectURL(old.src); // free the previous render
    container.innerHTML = '';
    const url = URL.createObjectURL(blob);
    const box = document.createElement('div');
    box.className = 'outbox';
    box.innerHTML = `<video controls playsinline src="${url}"></video>
      <div class="row"><button class="primary" data-a="dl">Tải video (${formatBytes(blob.size)})</button>
      ${canShareFiles ? '<button data-a="share">Chia sẻ / Lưu vào Ảnh</button>' : ''}</div>
      <div class="hint" data-a="name"></div>${note ? `<div class="hint warn">${note}</div>` : ''}`;
    box.querySelector('[data-a=name]').textContent = name; // file names are user input
    box.querySelector('[data-a=dl]').onclick = () => download(blob, name);
    const sh = box.querySelector('[data-a=share]');
    if (sh) sh.onclick = () => shareFile(blob, name);
    container.appendChild(box);
  }

  return { render, Player, showOutput, capabilities, pickVideoConfig, pickAudioConfig };
})();

VideoEngine.capabilities().then((c) => {
  $('caps').textContent = c.webcodecs
    ? ` · Trình duyệt này: xuất nhanh MP4 (H.264${c.audio ? ' + ' + c.audio.toUpperCase() : ''}).` +
      (c.audio === 'opus' ? ' ⚠️ Không có AAC: nên dùng Chrome/Edge trên Windows/macOS/Android hoặc Safari để video có tiếng chuẩn TikTok.' : '')
    : ' · Trình duyệt này: ghi thời gian thực (MediaRecorder).';
});

/** Wires a "render video" button with progress + cancel. */
function wireRender({ btn, prog, out, buildScene, fileName }) {
  let ctrl = null;
  const label = btn.textContent;
  btn.onclick = async () => {
    if (ctrl) { ctrl.abort(); return; }
    audioCtx().resume(); // must happen inside the tap on iOS
    let scene;
    try { scene = await buildScene(); } catch (e) { return toast(e.message); }
    if (!scene) return;
    ctrl = new AbortController();
    btn.textContent = 'Huỷ';
    out.innerHTML = '';
    try {
      const { blob, ext, audioCodec } = await VideoEngine.render(scene, (f, txt) => setProgress(prog, f, txt), ctrl.signal);
      let note = '';
      if (audioCodec === 'opus') note = '⚠️ Âm thanh là Opus (trình duyệt này không có AAC). Một số app (QuickTime, iPhone cũ, vài trình upload) có thể không phát được tiếng — nên xuất bằng Chrome/Edge trên Windows/macOS/Android hoặc Safari.';
      if (ext === 'webm') note = '⚠️ File WebM: TikTok/iPhone có thể không nhận. Nên xuất bằng Chrome/Edge/Safari mới để có MP4.';
      VideoEngine.showOutput(out, blob, `${fileName()}.${ext}`, note);
      toast('Đã tạo video!');
    } catch (e) {
      if (e.name !== 'AbortError') { console.error(e); toast('Lỗi: ' + e.message, 5000); }
      prog.hidden = true;
    } finally {
      ctrl = null;
      btn.textContent = label;
    }
  };
}
