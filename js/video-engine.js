/*
 * Video rendering engine.
 *  - Fast path: Mediabunny (WebCodecs H.264 video + AAC audio) → MP4, faster than real time.
 *    AAC is ALWAYS used: the browser's own encoder when it has one, otherwise a WASM AAC encoder
 *    (@mediabunny/aac-encoder). Never Opus — Opus-in-MP4 is silent on iPhone Photos, QuickTime,
 *    Windows Films & TV and some upload pipelines.
 *  - Fallback: canvas.captureStream + MediaRecorder (real time), only when there is no H.264 encoder.
 * A "scene" is { width, height, fps, duration, draw(ctx, t), audio: AudioBuffer|null, audioOffset }.
 * Mediabunny is loaded as an ES module via the import map in index.html (dynamic import works from classic scripts).
 */
const VideoEngine = (() => {
  const SR = 48000;
  const AUDIO_BITRATE = 192000;
  const AAC_ENCODER_URL = 'https://cdn.jsdelivr.net/npm/@mediabunny/aac-encoder@1.65.2/dist/bundles/mediabunny-aac-encoder.min.mjs';
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const { bitrateFor } = Core;

  /** Yield to the event loop without setTimeout clamping (background tabs clamp timers to ≥1s). */
  const yieldUI = (() => {
    const ch = new MessageChannel();
    const q = [];
    ch.port1.onmessage = () => q.shift()();
    return () => new Promise((r) => { q.push(r); ch.port2.postMessage(0); });
  })();

  const abortErr = () => new DOMException('Đã huỷ', 'AbortError');

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

  /** Copy [from, to) frames of an AudioBuffer into a new AudioBuffer (for feeding audio in step with video). */
  function sliceAudio(ab, from, to) {
    const n = Math.max(1, to - from);
    const out = new AudioBuffer({ length: n, numberOfChannels: ab.numberOfChannels, sampleRate: ab.sampleRate });
    for (let c = 0; c < ab.numberOfChannels; c++) out.copyToChannel(ab.getChannelData(c).subarray(from, from + n), c);
    return out;
  }

  /* ---------------- Mediabunny loading ---------------- */
  let mbPromise = null;
  /** → { MB, aac: 'native' | 'wasm' } */
  function loadMediabunny() {
    if (!mbPromise) {
      mbPromise = (async () => {
        const MB = await import('mediabunny');
        let aac = 'native';
        const native = await MB.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: SR, bitrate: AUDIO_BITRATE }).catch(() => false);
        if (!native) {
          const { registerAacEncoder } = await import(AAC_ENCODER_URL);
          registerAacEncoder();
          aac = 'wasm';
        }
        return { MB, aac };
      })();
      mbPromise.catch(() => { mbPromise = null; }); // allow a retry after a network error
    }
    return mbPromise;
  }

  async function canFast(w, h, fps) {
    try {
      const { MB } = await loadMediabunny();
      return await MB.canEncodeVideo('avc', { width: w, height: h, bitrate: bitrateFor(w, h, fps), frameRate: fps });
    } catch (e) {
      console.warn('Mediabunny unavailable', e);
      return false;
    }
  }

  async function capabilities() {
    const fast = await canFast(1080, 1920, 30);
    let aac = null;
    try { aac = (await loadMediabunny()).aac; } catch (_) {}
    return { webcodecs: fast, audio: fast && aac ? 'aac' : null, aac };
  }

  /* ---------------- fast path ---------------- */
  async function renderFast(scene, onProgress, signal) {
    const { MB } = await loadMediabunny();
    const { width: w, height: h, fps, duration, draw } = scene;
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d', { alpha: false });
    const aborted = () => signal && signal.aborted;

    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
    const video = new MB.CanvasSource(canvas, { codec: 'avc', bitrate: bitrateFor(w, h, fps), keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: fps });
    const audioSrc = scene.audio ? new MB.AudioBufferSource({ codec: 'aac', bitrate: AUDIO_BITRATE }) : null;
    if (audioSrc) output.addAudioTrack(audioSrc);

    const lock = await wakeLock();
    let done = false;
    try {
      let ab = null;
      if (audioSrc) {
        onProgress(0, 'Đang xử lý audio…');
        ab = await prepareAudio(scene.audio, scene.audioOffset || 0, duration);
        if (aborted()) throw abortErr();
      }
      await output.start();

      // Audio is added in 1-second slices just ahead of the video, so the muxer can interleave as it goes.
      let audioPos = 0;
      const feedAudioUntil = async (sec) => {
        if (!ab) return;
        const target = Math.min(ab.length, Math.ceil(sec * SR));
        while (audioPos < target) {
          const next = Math.min(target, audioPos + SR);
          await audioSrc.add(sliceAudio(ab, audioPos, next));
          audioPos = next;
        }
      };

      const total = Math.max(1, Math.round(duration * fps));
      const t0 = performance.now();
      for (let i = 0; i < total; i++) {
        if (aborted()) throw abortErr();
        await feedAudioUntil((i + fps) / fps); // ≈1 s ahead
        draw(ctx, i / fps);
        await video.add(i / fps, 1 / fps);
        if (i % 10 === 0) {
          const el = (performance.now() - t0) / 1000;
          const eta = i ? (el / i) * (total - i) : 0;
          onProgress(i / total, `Đang mã hoá ${i}/${total} khung · còn ~${Math.ceil(eta)}s`);
          await yieldUI();
        }
      }
      await feedAudioUntil(Infinity);
      if (aborted()) throw abortErr();
      video.close();
      if (audioSrc) audioSrc.close();
      onProgress(1, 'Đang hoàn tất file…');
      await output.finalize();
      done = true;
      onProgress(1, 'Xong!');
      return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }), ext: 'mp4', audioCodec: audioSrc ? 'aac' : null };
    } finally {
      if (!done) await output.cancel().catch(() => {});
      canvas.width = canvas.height = 0;
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
    if (await canFast(scene.width, scene.height, scene.fps)) {
      try {
        return await renderFast(scene, onProgress, signal);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn('Fast export failed, falling back to MediaRecorder', e);
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

  return { render, Player, showOutput, capabilities, loadMediabunny };
})();

VideoEngine.capabilities().then((c) => {
  $('caps').textContent = c.webcodecs
    ? ` · Trình duyệt này: xuất nhanh MP4 (H.264 + AAC${c.aac === 'wasm' ? ' qua WASM' : ''}).`
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
