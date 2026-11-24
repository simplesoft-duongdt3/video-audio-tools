/*
 * "Cắt & đổi khung video": a long 16:9 clip → vertical 9:16 (or 1:1 / 4:5) for TikTok / Reels / Shorts.
 * Export = Mediabunny's Conversion API: the file is read in slices (BlobSource) and decoded, placed and re-encoded
 * frame by frame, so minutes of 1080p never sit in memory at once (only the finished MP4 does).
 *  - "Cắt đầy khung": Mediabunny's own crop + resize (fast, no canvas).
 *  - "Nền mờ" / "Nền màu": video.process draws each frame with paint() — the same function the preview uses.
 * Sound stays AAC: copied untouched (no bitrate given — a bitrate forces a re-encode), or re-encoded with the gain.
 * Loudness is measured on the chosen part only, streamed slice by slice into a small index (no sample buffer).
 */
const Reframe = (() => {
  const video = $('rfVideo'), canvas = $('rfCanvas'), ctx = canvas.getContext('2d');
  let file = null, name = '', info = null, pos = 0.5;
  const previewBlur = {};

  const opts = () => ({ frame: $('rfFrame').value, fit: $('rfFit').value, pos, bg: $('rfBg').value });
  const outSize = (o = opts()) => (info ? Core.reframeSize(o.frame, info.sw, info.sh) : Core.reframeSize(o.frame, 1920, 1080));
  const segment = () => Core.reframeSegment($('rfStart').value, $('rfEnd').value, info ? info.duration : 0);

  /**
   * One frame of `src` (sw×sh) into c (W×H), exactly as exported. The geometry is computed for the real output
   * size (ow×oh), so the small preview and the 1080p file show the same part of the picture.
   */
  function paint(c, src, sw, sh, W, H, o, ow, oh, cache) {
    if (o.frame === 'keep') { c.drawImage(src, 0, 0, W, H); return; }
    if (o.fit === 'crop') {
      const k = Core.reframeCrop(sw, sh, ow, oh, o.pos);
      c.drawImage(src, k.left, k.top, k.width, k.height, 0, 0, W, H);
      return;
    }
    if (o.fit === 'blur') c.drawImage(makeBlur(src, sw, sh, W, H, 0.35, cache), 0, 0, W, H);
    else { c.fillStyle = o.bg; c.fillRect(0, 0, W, H); }
    const r = Core.reframeFit(sw, sh, W, H);
    c.drawImage(src, r.x, r.y, r.w, r.h);
  }

  /* ---------------- preview ---------------- */
  function sizeCanvas() {
    const { w, h } = outSize();
    const s = Math.min(480 / h, 360 / w);
    const W = Math.max(2, Math.round(w * s)), H = Math.max(2, Math.round(h * s));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  }
  function draw() {
    sizeCanvas();
    const W = canvas.width, H = canvas.height;
    if (!info || video.readyState < 2 || !video.videoWidth) {
      ctx.fillStyle = '#16181d';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#c9ced8';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(info ? 'Đang tải hình…' : 'Chọn video để xem trước', W / 2, H / 2);
      return;
    }
    const { w, h } = outSize();
    paint(ctx, video, video.videoWidth, video.videoHeight, W, H, opts(), w, h, previewBlur);
  }
  const redraw = oncePerFrame(draw);

  function posLabel(v, axis) {
    if (v === 50) return 'Giữa';
    if (v === 0) return axis === 'y' ? 'Trên cùng' : 'Trái';
    if (v === 100) return axis === 'y' ? 'Dưới cùng' : 'Phải';
    return v + '%';
  }
  /** Show only the settings that matter for the chosen frame / fit. */
  function syncControls() {
    const o = opts(), keep = o.frame === 'keep';
    const { w, h } = outSize(o);
    const axis = info ? Core.reframeCrop(info.sw, info.sh, w, h).axis : 'x';
    $('rfFitWrap').hidden = keep;
    $('rfPosWrap').hidden = $('rfPosHint').hidden = keep || o.fit !== 'crop' || !axis;
    $('rfPosHint').textContent = axis === 'y' ? 'Hoặc kéo hình trong khung xem trước lên / xuống.' : 'Hoặc kéo hình trong khung xem trước sang trái / phải.';
    $('rfBgWrap').hidden = keep || o.fit !== 'color';
    $('rfPosOut').textContent = posLabel(Math.round(pos * 100), axis);
    canvas.classList.toggle('rf-drag', !keep && o.fit === 'crop' && !!axis && !!info);
    // touch: keep the OTHER direction for scrolling the page (touch-action: none froze vertical swipes)
    canvas.style.touchAction = canvas.classList.contains('rf-drag') ? (axis === 'y' ? 'pan-x' : 'pan-y') : '';
    const s = segment();
    $('rfSegInfo').textContent = !info ? '' : s.error ? '⚠️ ' + s.error : `Đoạn đã chọn: ${Core.formatTenths(s.start)} → ${Core.formatTenths(s.end)} (${(s.end - s.start).toFixed(1).replace('.', ',')} giây)`;
    $('rfEst').textContent = info && !s.error ? `${w}×${h} · ` + estimateText(VideoEngine.estimate({ width: w, height: h, fps: Math.min(60, info.fps), duration: s.end - s.start, audio: !!info.audio })) : '';
    redraw();
  }

  $('rfPos').addEventListener('input', () => { pos = $('rfPos').value / 100; syncControls(); });
  ['rfFrame', 'rfFit', 'rfBg'].forEach((id) => $(id).addEventListener('input', syncControls));
  ['rfFrame', 'rfFit'].forEach((id) => $(id).addEventListener('change', syncControls));

  // drag the picture under the frame (crop mode): pointer events cover mouse, touch and pen
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!canvas.classList.contains('rf-drag')) return;
    const { w, h } = outSize();
    const c = Core.reframeCrop(info.sw, info.sh, w, h);
    const shown = Core.containRect(canvas.width, canvas.height, canvas.clientWidth, canvas.clientHeight);
    drag = { x: e.clientX, y: e.clientY, pos, axis: c.axis, slack: Core.reframeSlack(info.sw, info.sh, w, h), k: w / Math.max(1, shown.w) };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const d = (drag.axis === 'y' ? e.clientY - drag.y : e.clientX - drag.x) * drag.k;
    pos = Core.reframeDrag(drag.pos, d, drag.slack);
    $('rfPos').value = Math.round(pos * 100);
    syncControls();
  });
  const endDrag = () => { if (drag) { drag = null; $('rfPos').dispatchEvent(new Event('change', { bubbles: true })); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // the source <video>: seeking / playing redraws the preview
  let playing = false;
  const scrub = $('rfScrub');
  const showTime = () => { $('rfTimeOut').textContent = formatTime(video.currentTime || 0); };
  ['loadeddata', 'seeked'].forEach((ev) => video.addEventListener(ev, () => { showTime(); redraw(); }));
  scrub.addEventListener('input', () => { stopPlay(); video.currentTime = +scrub.value; showTime(); });
  function tick() {
    if (!playing) return;
    const s = segment();
    if (video.currentTime >= s.end - 0.02 || video.ended) { stopPlay(); video.currentTime = s.start; return; }
    scrub.value = video.currentTime;
    showTime();
    draw();
    requestAnimationFrame(tick);
  }
  function stopPlay() {
    if (!playing) return;
    playing = false;
    video.pause();
    $('rfPlay').textContent = '▶ Xem thử đoạn này';
  }
  $('rfPlay').onclick = async () => {
    if (playing) return stopPlay();
    const s = segment();
    if (s.error) return toast(s.error);
    if (video.currentTime < s.start || video.currentTime >= s.end - 0.05) video.currentTime = s.start;
    video.muted = false;
    try { await video.play(); } catch (e) { return toast('Trình duyệt không phát được video này'); }
    playing = true;
    $('rfPlay').textContent = '⏸ Dừng';
    requestAnimationFrame(tick);
  };
  const round1 = (v) => Math.round(v * 10) / 10;
  const setField = (id, v) => { $(id).value = v; $(id).dispatchEvent(new Event('input', { bubbles: true })); $(id).dispatchEvent(new Event('change', { bubbles: true })); };
  $('rfSetStart').onclick = () => info && setField('rfStart', String(round1(video.currentTime || 0)).replace('.', ','));
  $('rfSetEnd').onclick = () => info && setField('rfEnd', String(round1(video.currentTime || 0)).replace('.', ','));
  ['rfStart', 'rfEnd'].forEach((id) => $(id).addEventListener('input', () => { syncControls(); scheduleAudio(); }));

  /* ---------------- loudness of the chosen part ---------------- */
  let segAudio = null, segJob = null;
  const loud = Loudness.mount('rfLoud', () => (segAudio ? { index: segAudio.index, offset: 0, duration: segAudio.duration } : null));
  /**
   * Loudness index of the chosen part (stereo as exported), streamed from the file slice by slice: only ~12 bytes
   * per 100 ms are kept. (A whole-part AudioBuffer was ~1 GB for 40 minutes and reloaded iPhone tabs on open.)
   */
  async function measureSegment(f, s, e) {
    const { MB } = await VideoEngine.loadMediabunny();
    const input = new MB.Input({ source: new MB.BlobSource(f), formats: MB.ALL_FORMATS });
    try {
      const at = await input.getPrimaryAudioTrack();
      const sr = at.sampleRate, idx = Core.loudnessStream(sr, 2);
      for await (const { buffer, timestamp } of new MB.AudioBufferSink(at).buffers(s, e)) {
        if (f !== file) break;
        let [a, b] = Core.downmixStereo(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)));
        const skip = Math.max(0, Math.round((s - timestamp) * sr)); // first slice may start before the part
        const keep = Math.max(0, Math.min(a.length, Math.round((e - timestamp) * sr)));
        if (keep > skip) idx.push([a.subarray(skip, keep), b.subarray(skip, keep)]);
        buffer.close && buffer.close();
      }
      return idx;
    } finally {
      input.dispose();
    }
  }
  /** → Promise of the current part's audio ({ key, buffer }), or null when loudness cannot be measured. */
  function ensureAudio() {
    const s = segment();
    if (!info || !info.audio || !info.audio.canDecode || s.error) return Promise.resolve(null);
    const key = `${s.start}-${s.end}`;
    if (segJob && segJob.key === key && segJob.file === file) return segJob.promise;
    const f = file;
    const job = { key, file: f };
    job.promise = measureSegment(f, s.start, s.end).then((index) => {
      if (f === file && segJob === job) { segAudio = { key, index, duration: s.end - s.start }; loud.refresh(); }
      return { key, index };
    });
    // a failed measurement is not cached: the next change or the export tries again
    job.promise.catch((e) => { console.warn('loudness: could not decode the sound', e); if (segJob === job) segJob = null; });
    segJob = job;
    return job.promise;
  }
  let audioTimer = 0;
  function scheduleAudio() {
    clearTimeout(audioTimer);
    // the old part's value must not be shown as "Đoạn đã chọn" while the new part is measured
    if (segAudio && segAudio.key !== `${segment().start}-${segment().end}`) { segAudio = null; loud.refresh(); }
    audioTimer = setTimeout(() => ensureAudio().catch(() => {}), 400);
  }

  /* ---------------- open a video ---------------- */
  function resetFile() {
    if (ctrl) ctrl.abort(); // a running export belongs to the old file (it came out under the new file's name)
    stopPlay();
    info = null; segAudio = null; segJob = null;
    if (video.src) URL.revokeObjectURL(video.src);
    video.removeAttribute('src');
    video.load();
    $('rfRender').disabled = $('rfPlay').disabled = true;
    // the previous video had no usable sound: give the next one the default again (a user's own choice is kept)
    if ($('rfLoud').disabled) { $('rfLoud').disabled = false; $('rfLoud').value = 'social'; }
    clearOut($('rfOut'));
    $('rfProg').hidden = true;
  }
  onFiles('rfFile', async ([f]) => {
    resetFile();
    file = f;
    name = Core.baseName(f.name) || 'video';
    $('rfInfo').textContent = 'Đang đọc video…';
    syncControls();
    let input;
    try {
      const { MB } = await VideoEngine.loadMediabunny();
      input = new MB.Input({ source: new MB.BlobSource(f), formats: MB.ALL_FORMATS });
      let vt;
      try { vt = await input.getPrimaryVideoTrack(); } catch (_) { throw new Error(`"${f.name}" không phải video mà trình duyệt đọc được — hãy chọn file mp4 hoặc mov`); }
      if (!vt) throw new Error(`"${f.name}" không có hình — hãy chọn một file video (mp4, mov)`);
      if (!(await vt.canDecode())) throw new Error(`Trình duyệt này không giải mã được hình của video (${vt.codec || 'không rõ codec'}). Video HEVC của iPhone: mở trang bằng Safari, hoặc chọn Cài đặt › Camera › Định dạng › Tương thích nhất.`);
      const at = await input.getPrimaryAudioTrack();
      const duration = await input.computeDuration();
      const stats = await vt.computePacketStats(120).catch(() => null);
      const fps = stats && stats.averagePacketRate > 1 ? stats.averagePacketRate : 30;
      if (f !== file) return; // another file was chosen meanwhile
      info = {
        sw: vt.displayWidth, sh: vt.displayHeight, duration, fps,
        audio: at ? { codec: at.codec, canDecode: await at.canDecode() } : null,
      };
      let txt = `🎬 ${f.name} — ${formatTime(duration)} · ${info.sw}×${info.sh} · ${Math.round(fps)} fps` + (at ? '' : ' · không có tiếng');
      if (info.audio && !info.audio.canDecode) {
        // AAC can be copied without decoding; anything else needs decoding to become AAC → the export is silent
        txt += info.audio.codec === 'aac'
          ? ' · Trình duyệt này không chỉnh được âm lượng của video: tiếng được giữ nguyên.'
          : ` · ⚠️ Video xuất ra sẽ KHÔNG có tiếng: trình duyệt này không đọc được tiếng của video (${info.audio.codec || 'không rõ'}).`;
        $('rfLoud').value = 'off';
        $('rfLoud').disabled = true;
      }
      if (!at) { $('rfLoud').disabled = true; }
      $('rfInfo').textContent = txt;
      $('rfStart').value = 0;
      $('rfEnd').value = '';
      $('rfEnd').placeholder = String(round1(duration)).replace('.', ','); // the UI writes times with a comma
      scrub.max = duration;
      scrub.value = 0;
      video.src = URL.createObjectURL(f);
      video.muted = true;
      video.load();
      video.addEventListener('loadeddata', () => { if (video.currentTime === 0) video.currentTime = Math.min(0.05, duration / 2); }, { once: true });
      // a wide video goes to 9:16 by default; a video that already has the chosen shape doesn't need moving
      $('rfRender').disabled = $('rfPlay').disabled = false;
      syncControls();
      scheduleAudio();
      loud.refresh();
    } catch (e) {
      if (f !== file) return;
      info = null;
      $('rfInfo').textContent = '⚠️ ' + (e.message || e);
      syncControls();
    } finally {
      if (input) input.dispose();
    }
  });

  /* ---------------- export ---------------- */
  /** Multiply an AudioSample by the loudness gain (normGain keeps the peak under −1.5 dBFS: no clipping). */
  function gainSample(MB, s, g) {
    const n = s.numberOfChannels, f = s.numberOfFrames;
    const data = new Float32Array(n * f);
    for (let c = 0; c < n; c++) s.copyTo(data.subarray(c * f, (c + 1) * f), { planeIndex: c, format: 'f32-planar' });
    for (let i = 0; i < data.length; i++) data[i] *= g;
    s.close(); // copied: free it now (Mediabunny closes it again later; close() is idempotent)
    return new MB.AudioSample({ data, format: 'f32-planar', numberOfChannels: n, sampleRate: s.sampleRate, timestamp: s.timestamp });
  }

  async function render(onProgress, signal) {
    const s = segment();
    if (s.error) throw Object.assign(new Error(s.error), { user: true });
    const o = opts();
    const { w: ow, h: oh } = outSize(o);
    const dur = s.end - s.start;
    const { MB } = await VideoEngine.loadMediabunny();
    const maxBytes = VideoEngine.tuning.maxBytes != null ? VideoEngine.tuning.maxBytes : IS_IOS ? 80e6 : 0;
    const bitrate = Core.bitrateFor(ow, oh, Math.min(60, info.fps), dur, maxBytes);
    const okEnc = async (extra) => { try { return await MB.canEncodeVideo('avc', { width: ow, height: oh, ...extra }); } catch (_) { return false; } };
    if (!(await okEnc({ bitrate })) && !(await okEnc({}))) throw new Error(`Trình duyệt không mã hoá được H.264 ${ow}×${oh}`);

    let gain = 1, note = '';
    if (info.audio && info.audio.canDecode && $('rfLoud').value !== 'off') {
      onProgress(0, 'Đang đo âm lượng…');
      try {
        await ensureAudio();
        gain = await loud.gain(); // its text stays under the 🔊 select
      } catch (e) { console.warn('loudness skipped', e); }
    }
    if (signal.aborted) throw new DOMException('Đã huỷ', 'AbortError');

    const v = { codec: 'avc', bitrate, keyFrameInterval: 2, forceTranscode: true, allowTransformationMetadata: false };
    let frameCanvas = null;
    if (o.frame === 'keep') Object.assign(v, { width: ow, height: oh, fit: 'fill' });
    else if (o.fit === 'crop') {
      const k = Core.reframeCrop(info.sw, info.sh, ow, oh, o.pos);
      Object.assign(v, { crop: { left: k.left, top: k.top, width: k.width, height: k.height }, width: ow, height: oh, fit: 'fill' });
    } else {
      frameCanvas = makeCanvas(ow, oh);
      const c = frameCanvas.getContext('2d', { alpha: false }), cache = {};
      Object.assign(v, {
        processedWidth: ow, processedHeight: oh,
        process: (sample) => {
          paint(c, sample.toCanvasImageSource(), sample.displayWidth, sample.displayHeight, ow, oh, o, ow, oh, cache);
          return new MB.VideoSample(frameCanvas, { timestamp: sample.timestamp, duration: sample.duration });
        },
      });
    }
    const a = !info.audio ? undefined : gain !== 1
      ? { codec: 'aac', bitrate: 192000, numberOfChannels: 2, forceTranscode: true, processedNumberOfChannels: 2, process: (smp) => gainSample(MB, smp, gain) }
      : info.audio.codec === 'aac' ? { codec: 'aac' } // copied bit for bit: a bitrate here forced a re-encode (96 → 181 kbps)
        : { codec: 'aac', bitrate: 192000 }; // other codecs become AAC

    const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
    let lock = null, conv = null, watchdog = 0;
    try {
      conv = await MB.Conversion.init({ input, output, video: v, audio: a, trim: { start: s.start, end: s.end }, tracks: 'primary', showWarnings: false });
      const lost = (type) => conv.discardedTracks.find((d) => d.track.type === type);
      if (lost('video') || !conv.isValid) {
        const d = lost('video');
        throw new Error(d && d.reason === 'no_encodable_target_codec' ? `Trình duyệt không mã hoá được H.264 ${ow}×${oh}` : `Không xử lý được hình của video (${d ? d.reason : 'không hợp lệ'})`);
      }
      if (lost('audio')) note = `⚠️ Video xuất ra không có tiếng: trình duyệt này không đọc được tiếng của video (${info.audio.codec || 'không rõ'}).`;
      const t0 = performance.now();
      let last = { p: 0, at: t0 };
      conv.onProgress = (p) => {
        if (signal.aborted) return; // winding down after "Huỷ": keep the bar hidden
        const el = (performance.now() - t0) / 1000;
        const eta = p > 0.02 ? (el / p) * (1 - p) : 0;
        last = { p, at: performance.now() };
        onProgress(Math.min(0.99, p), `Đang xử lý ${Math.round(p * 100)}%` + (eta ? ` · còn ~${Math.ceil(eta)}s` : ''));
      };
      // a phone that ran out of video decoders can stop without an error: say so instead of a frozen bar
      watchdog = setInterval(() => {
        if (performance.now() - last.at > 20000) onProgress(Math.min(0.99, last.p), `⚠️ Không thấy tiến triển ở ${Math.round(last.p * 100)}% — bấm Huỷ rồi thử lại (đóng bớt app / tab đang phát video)`);
      }, 5000);
      // "Huỷ" returns at once: it never waits for the decoder / encoder to wind down (a busy phone can take a
      // while, and a stuck hardware decoder never does). The conversion is cancelled in the background.
      let stop;
      const aborted = new Promise((_, reject) => {
        stop = () => { conv.cancel().catch(() => {}); reject(new DOMException('Đã huỷ', 'AbortError')); };
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop(); // "Huỷ" tapped while the file was being opened
      });
      aborted.catch(() => {});
      const running = conv.execute();
      running.catch(() => {}); // after a cancel its rejection is expected
      try { lock = await navigator.wakeLock.request('screen'); } catch (_) {}
      try {
        await Promise.race([running, aborted]);
      } catch (e) {
        if (signal.aborted || e instanceof MB.ConversionCanceledError) throw new DOMException('Đã huỷ', 'AbortError');
        throw e;
      } finally {
        signal.removeEventListener('abort', stop);
      }
      onProgress(1, 'Xong!');
      return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }), note, size: `${ow}×${oh}` };
    } finally {
      clearInterval(watchdog);
      if (lock) lock.release().catch(() => {});
      if (frameCanvas) frameCanvas.width = frameCanvas.height = 0;
      input.dispose();
    }
  }

  let ctrl = null;
  const btn = $('rfRender'), label = btn.textContent;
  btn.onclick = async () => {
    if (ctrl) { ctrl.abort(); return; }
    if (!info) return toast('Hãy chọn video');
    stopPlay();
    const prog = $('rfProg'), out = $('rfOut');
    ctrl = new AbortController();
    btn.textContent = 'Huỷ';
    clearOut(out); // frees the previous export's memory
    setProgress(prog, 0, 'Đang chuẩn bị…');
    const fileName = name; // the file being exported (another one may be chosen meanwhile)
    try {
      const o = opts();
      const r = await render((f, t) => setProgress(prog, f, t), ctrl.signal);
      const tag = o.frame === 'keep' ? 'doan' : o.frame.replace(':', 'x');
      VideoEngine.showOutput(out, r.blob, `${fileName}-${tag}.mp4`, r.note);
      toast('Đã tạo video!');
    } catch (e) {
      prog.hidden = true;
      if (e.name === 'AbortError') toast('Đã huỷ');
      else if (e.user) toast(e.message);
      else { console.error(e); showError(out, e, () => btn.click()); }
    } finally {
      ctrl = null;
      btn.textContent = label;
    }
  };

  window.addEventListener('tabshown', (e) => { if (e.detail === 'reframe') redraw(); else stopPlay(); });
  syncControls();
  return { paint, get info() { return info; }, get pos() { return pos; } };
})();
