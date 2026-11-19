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
  /** Encoder hints (tuned by benchmark, see tests). */
  const tuning = {};
  const AAC_ENCODER_URL = 'https://cdn.jsdelivr.net/npm/@mediabunny/aac-encoder@1.65.2/dist/bundles/mediabunny-aac-encoder.min.mjs';
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  /** iPhone Safari fails to save very large in-memory downloads ("Failed to download" around 100 MB). */
  const maxBytes = () => (tuning.maxBytes != null ? tuning.maxBytes : IS_IOS ? 80e6 : 0);
  const bitrateFor = (w, h, fps, duration = 0) => Core.bitrateFor(w, h, fps, duration, maxBytes());

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

  /** → { ok: boolean, reason: string|null } — why the fast path can't be used, in plain words. */
  async function fastSupport(w, h, fps) {
    if (typeof VideoEncoder === 'undefined') return { ok: false, reason: 'trình duyệt không có WebCodecs (cần iOS/Safari 16.4+, Chrome/Edge 94+, Firefox 130+)' };
    let MB;
    try { ({ MB } = await loadMediabunny()); } catch (e) {
      console.warn('Mediabunny unavailable', e);
      return { ok: false, reason: 'không tải được thư viện xuất video (' + (e.message || e) + ')' };
    }
    const sizes = [{ bitrate: bitrateFor(w, h, fps), frameRate: fps }, {}]; // some Safari builds reject the bitrate hint
    for (const extra of sizes) {
      try { if (await MB.canEncodeVideo('avc', { width: w, height: h, ...extra })) return { ok: true, reason: null }; } catch (_) {}
    }
    return { ok: false, reason: `trình duyệt không mã hoá được H.264 ${w}×${h}` };
  }
  const canFast = async (w, h, fps) => (await fastSupport(w, h, fps)).ok;

  async function capabilities() {
    const fs = await fastSupport(1080, 1920, 30);
    let aac = null;
    try { aac = (await loadMediabunny()).aac; } catch (_) {}
    return { webcodecs: fs.ok, reason: fs.reason, audio: fs.ok && aac ? 'aac' : null, aac };
  }

  /* ---------------- fast path ---------------- */
  async function renderFast(scene, onProgress, signal, hints = {}) {
    const { MB } = await loadMediabunny();
    const { width: w, height: h, fps, duration, draw } = scene;
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d', { alpha: false });
    const aborted = () => signal && signal.aborted;

    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
    const video = new MB.CanvasSource(canvas, { codec: 'avc', bitrate: bitrateFor(w, h, fps, duration), keyFrameInterval: 2, ...tuning, ...hints });
    output.addVideoTrack(video, { frameRate: fps });
    const audioSrc = scene.audio ? new MB.AudioBufferSource({ codec: 'aac', bitrate: AUDIO_BITRATE }) : null;
    if (audioSrc) output.addAudioTrack(audioSrc);

    const lock = await wakeLock();
    let done = false, framesDone = 0;
    try {
      let ab = null;
      if (audioSrc) {
        onProgress(0, 'Đang xử lý audio…');
        ab = await prepareAudio(scene.audio, scene.audioOffset || 0, duration);
        if (aborted()) throw abortErr();
      }
      await output.start();

      // Audio (WASM AAC can take a few seconds) is encoded IN PARALLEL with the video, in 1-second slices.
      let audioFailure = null;
      const audioJob = (async () => {
        if (!ab) return;
        for (let pos = 0; pos < ab.length && !aborted(); pos += SR) {
          const m = performance.now();
          await audioSrc.add(sliceAudio(ab, pos, Math.min(ab.length, pos + SR)));
          timing.audio += performance.now() - m;
        }
      })().catch((e) => { audioFailure = e; });

      const total = Math.max(1, Math.round(duration * fps));
      const t0 = performance.now();
      for (let i = 0; i < total; i++) {
        if (aborted()) throw abortErr();
        if (audioFailure) throw audioFailure;
        let m = performance.now();
        draw(ctx, i / fps);
        timing.draw += performance.now() - m; m = performance.now();
        await video.add(i / fps, 1 / fps);
        timing.encode += performance.now() - m;
        framesDone = i + 1;
        if (i % 10 === 0) {
          const el = (performance.now() - t0) / 1000;
          const eta = i ? (el / i) * (total - i) : 0;
          onProgress(i / total, `Đang mã hoá ${i}/${total} khung · còn ~${Math.ceil(eta)}s`);
          await yieldUI();
        }
      }
      await audioJob;
      if (audioFailure) throw audioFailure;
      if (aborted()) throw abortErr();
      video.close();
      if (audioSrc) audioSrc.close();
      onProgress(1, 'Đang hoàn tất file…');
      await output.finalize();
      done = true;
      onProgress(1, 'Xong!');
      return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }), ext: 'mp4', audioCodec: audioSrc ? 'aac' : null, mode: 'fast' };
    } catch (e) {
      e.framesDone = framesDone;
      throw e;
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
    // captureStream(0) + requestFrame(): exactly one captured frame per drawn frame (no duplicated/skipped frames).
    let stream = canvas.captureStream(0);
    let vtrack = stream.getVideoTracks()[0];
    const manual = vtrack && typeof vtrack.requestFrame === 'function';
    if (!manual) { stream.getTracks().forEach((t) => t.stop()); stream = canvas.captureStream(fps); vtrack = stream.getVideoTracks()[0]; }
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
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrateFor(w, h, fps, duration) });
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
      // Driven by the audio clock. Each frame shows the picture for its exact slot (k / fps), so motion stays
      // even even when the timer fires late; rAF (synced to the display) + a timer backup for robustness.
      await new Promise((resolve) => {
        let last = -1, raf = 0, iv = 0;
        const step = () => {
          const t = actx.currentTime - start;
          if ((signal && signal.aborted) || hiddenAbort || t >= duration) {
            cancelAnimationFrame(raf); clearInterval(iv); return resolve();
          }
          const k = Math.max(0, Math.floor(t * fps));
          if (k !== last) {
            last = k;
            draw(ctx, k / fps);
            if (manual) vtrack.requestFrame();
            if (k % 5 === 0) onProgress(t / duration, `Đang ghi (thời gian thực) ${formatTime(t)} / ${formatTime(duration)} — giữ màn hình này mở`);
          }
        };
        const loop = () => { step(); raf = requestAnimationFrame(loop); };
        raf = requestAnimationFrame(loop);
        iv = setInterval(step, 1000 / (fps * 2));
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
    return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm', audioCodec: scene.audio ? 'recorder' : null, mode: 'realtime' };
  }

  let lastFallbackReason = null;
  const timing = { draw: 0, encode: 0, audio: 0 };
  async function render(scene, onProgress = () => {}, signal) {
    scene.width -= scene.width % 2;
    scene.height -= scene.height % 2;
    const fs = await fastSupport(scene.width, scene.height, scene.fps);
    let reason = fs.reason;
    if (fs.ok) {
      // Some devices reject one encoder setup but accept another: retry the FAST path with other
      // settings before falling back to slow real-time recording — but only if it failed early.
      const ladder = [{}, { hardwareAcceleration: 'prefer-hardware' }, { hardwareAcceleration: 'prefer-software' }, { latencyMode: 'realtime', bitrateMode: 'variable' }];
      const errors = [];
      for (const hints of ladder) {
        try {
          const r = await renderFast(scene, onProgress, signal, hints);
          if (errors.length) r.retried = errors;
          return r;
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          console.warn('Fast export failed with', hints, e);
          errors.push(e.message || String(e));
          if ((e.framesDone || 0) > scene.fps * 3) break; // failed late (e.g. out of memory): don't redo a long render 4×
        }
      }
      reason = 'xuất nhanh bị lỗi: ' + errors[errors.length - 1];
    }
    lastFallbackReason = reason;
    const r = await renderRecorder(scene, onProgress, signal);
    r.fallbackReason = reason;
    return r;
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
    if (IS_IOS) {
      // iPhone: the share sheet's "Save Video" writes straight to Photos and copes better with big files than downloads.
      const tip = document.createElement('div');
      tip.className = 'hint' + (blob.size > 80e6 ? ' warn' : '');
      tip.textContent = (blob.size > 80e6 ? `⚠️ File lớn (${formatBytes(blob.size)}): Safari có thể báo "Không tải được". ` : '') +
        'iPhone: bấm "Chia sẻ / Lưu vào Ảnh" → "Lưu video" để lưu thẳng vào Ảnh (ổn định hơn nút Tải).';
      box.appendChild(tip);
    }
    box.querySelector('[data-a=dl]').onclick = () => download(blob, name);
    const sh = box.querySelector('[data-a=share]');
    if (sh) sh.onclick = () => shareFile(blob, name);
    container.appendChild(box);
  }

  return { render, Player, showOutput, capabilities, loadMediabunny, get lastFallbackReason() { return lastFallbackReason; }, tuning, timing };
})();

VideoEngine.capabilities().then((c) => {
  $('caps').textContent = c.webcodecs
    ? ` · Trình duyệt này: xuất nhanh MP4 (H.264 + AAC${c.aac === 'wasm' ? ' qua WASM' : ''}).`
    : ` · ⚠️ Trình duyệt này: ghi thời gian thực (chậm, có thể giật) — lý do: ${c.reason}.`;
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
      const { blob, ext, mode, fallbackReason } = await VideoEngine.render(scene, (f, txt) => setProgress(prog, f, txt), ctrl.signal);
      let note = '';
      if (mode === 'realtime') note = `⚠️ Video được ghi theo thời gian thực (chậm và có thể bị giật khi đăng TikTok) vì ${fallbackReason || 'trình duyệt không hỗ trợ xuất nhanh'}. Nên dùng Chrome/Edge/Safari bản mới, hoặc mở “🩺 Tự kiểm tra thiết bị” ở chân trang và gửi kết quả.`;
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
