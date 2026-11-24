/*
 * Creator tools:
 *  - "Ảnh bìa & caption": YouTube 16:9 thumbnail / TikTok-Shorts-Reels 9:16 cover with big outlined text,
 *    *highlighted* keywords, a corner label, a background photo or a frame picked from a video; JPG kept under a
 *    size limit by searching the quality. Plus a title / caption / hashtag checker.
 *  - "Tách âm thanh": sound of a video (or part of a song) → M4A (AAC) or WAV, loudness-normalised.
 * Everything stays on the device (canvas, WebAudio, WebCodecs).
 */

/* ======================= Thumbnail ======================= */
const Thumb = (() => {
  const canvas = $('thCanvas');
  let bg = null; // { img, w, h, url?, video? }
  let style = 'bold';

  /** Per style: fonts + colours. `hi` words use the accent colour (or a red box for "news"). */
  const STYLES = {
    bold: { font: (s) => `900 ${s}px Montserrat, "Be Vietnam Pro", sans-serif`, ink: '#ffffff', stroke: '#000000', strokeW: 0.16, align: 'center' },
    news: { font: (s) => `800 ${s}px "Be Vietnam Pro", sans-serif`, ink: '#ffffff', stroke: null, box: '#e11d2e', align: 'left', bar: '#e11d2e' },
    clean: { font: (s) => `800 ${s}px "Be Vietnam Pro", sans-serif`, ink: '#ffffff', stroke: null, shadow: true, align: 'center' },
    luxe: { font: (s) => `700 ${s}px "Playfair Display", serif`, ink: '#f7ead0', stroke: null, shadow: true, align: 'center', frame: true },
    cute: { font: (s) => `800 ${s}px "Baloo 2", "Be Vietnam Pro", sans-serif`, ink: '#ffffff', stroke: '#ff4f9a', strokeW: 0.14, align: 'center' },
  };

  const size = () => { const [w, h] = $('thSize').value.split('x').map(Number); return { W: w, H: h }; };

  /** Title → words with their highlight flag; "\n" forces a new line. */
  function tokens(text) {
    const out = [];
    for (const seg of Core.parseHighlight(text)) {
      seg.t.split(/(\n)/).forEach((part) => {
        if (part === '\n') out.push({ br: true });
        else part.split(/\s+/).filter(Boolean).forEach((w) => out.push({ w, hi: seg.hi }));
      });
    }
    return out;
  }

  /** Greedy line layout at a font size → lines: [[{w, hi, width}]], widths. */
  function layout(ctx, toks, st, px, maxW) {
    ctx.font = st.font(px);
    const space = ctx.measureText(' ').width;
    const lines = [[]];
    let lw = 0, widest = 0;
    for (const t of toks) {
      if (t.br) { if (lines[lines.length - 1].length) lines.push([]); lw = 0; continue; }
      const width = ctx.measureText(t.w).width;
      widest = Math.max(widest, width);
      const cur = lines[lines.length - 1];
      if (cur.length && lw + space + width > maxW) { lines.push([{ ...t, width }]); lw = width; }
      else { cur.push({ ...t, width }); lw += (cur.length > 1 ? space : 0) + width; }
    }
    return { lines: lines.filter((l) => l.length), space, widest };
  }

  /** Largest font size whose layout fits maxW × maxH in ≤ 4 lines. */
  function fit(ctx, toks, st, maxW, maxH, startPx, minPx) {
    let px = startPx, L;
    for (; px > minPx; px *= 0.93) {
      L = layout(ctx, toks, st, px, maxW);
      if (L.lines.length <= 4 && L.lines.length * px * 1.1 <= maxH && L.widest <= maxW) return { px, ...L };
    }
    return { px: minPx, ...layout(ctx, toks, st, minPx, maxW) };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Readable text colour on a background colour (WCAG contrast). */
  const inkOn = (hex) => (Core.contrast(hex, '#000000') >= Core.contrast(hex, '#ffffff') ? '#000000' : '#ffffff');

  function draw(ctx, W, H) {
    const st = STYLES[style];
    const accent = $('thAccent').value;
    const dim = +$('thDim').value / 100;
    const pos = $('thPos').value;
    // background
    if (bg) drawImageFit(ctx, bg.img, bg.w, bg.h, 0, 0, W, H, 'cover');
    else {
      const base = $('thBg').value;
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, base); g.addColorStop(1, Core.mixHex(base, '#000000', 0.55));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = `rgba(0,0,0,${dim})`;
    ctx.fillRect(0, 0, W, H);
    // text area: vertical covers keep clear of the TikTok / Reels / Shorts buttons (strictest of the three)
    const vertical = W / H < 0.8;
    let area = { x: W * 0.06, y: H * 0.08, w: W * 0.88, h: H * 0.84 };
    if (vertical) {
      const r = ['tiktok', 'reels', 'shorts'].map((p) => Core.safeRect(p, W, H));
      const x = Math.max(...r.map((a) => a.x)), y = Math.max(...r.map((a) => a.y));
      area = { x, y, w: Math.min(...r.map((a) => a.x + a.w)) - x, h: Math.min(...r.map((a) => a.y + a.h)) - y };
    }
    // readability gradient behind the text
    const g2 = pos === 'top' ? ctx.createLinearGradient(0, 0, 0, H * 0.6) : pos === 'bottom' ? ctx.createLinearGradient(0, H, 0, H * 0.4) : null;
    if (g2) { g2.addColorStop(0, 'rgba(0,0,0,0.55)'); g2.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H); }

    const toks = tokens($('thTitle').value.trim());
    const sub = $('thSub').value.trim();
    const minDim = Math.min(W, H);
    const titleBudget = area.h * (vertical ? 0.5 : sub ? 0.62 : 0.75);
    const F = fit(ctx, toks, st, area.w, titleBudget, minDim * (vertical ? 0.13 : 0.2), minDim * 0.035);
    const lh = F.px * 1.1;
    const subPx = Math.max(minDim * 0.03, F.px * 0.4);
    const blockH = F.lines.length * lh + (sub ? subPx * 1.6 : 0);
    let y0 = pos === 'top' ? area.y : pos === 'middle' ? area.y + (area.h - blockH) / 2 : area.y + area.h - blockH;
    const badgeTxt = $('thBadge').value.trim();
    const badgeH = minDim * 0.075;
    if (pos === 'top' && badgeTxt) y0 += badgeH * 1.35; // keep clear of the corner label

    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    F.lines.forEach((line, i) => {
      const lineW = line.reduce((a, t) => a + t.width, 0) + F.space * (line.length - 1);
      let x = st.align === 'left' ? area.x : area.x + (area.w - lineW) / 2;
      const base = y0 + i * lh + F.px * 0.92;
      ctx.font = st.font(F.px);
      for (const t of line) {
        if (st.box && t.hi) {
          ctx.fillStyle = st.box;
          roundRect(ctx, x - F.px * 0.12, base - F.px * 0.88, t.width + F.px * 0.24, F.px * 1.06, F.px * 0.12);
          ctx.fill();
        }
        if (st.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = F.px * 0.18; ctx.shadowOffsetY = F.px * 0.05; }
        if (st.stroke) { ctx.strokeStyle = st.stroke; ctx.lineWidth = F.px * st.strokeW; ctx.strokeText(t.w, x, base); }
        ctx.fillStyle = t.hi && !st.box ? accent : st.ink;
        ctx.fillText(t.w, x, base);
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        x += t.width + F.space;
      }
    });
    if (sub) {
      ctx.font = `600 ${subPx}px "Be Vietnam Pro", sans-serif`;
      const lines = Core.clampLines(ctx, sub, area.w, 1);
      const sy = y0 + F.lines.length * lh + subPx * 1.25;
      ctx.textAlign = st.align === 'left' ? 'left' : 'center';
      const sx = st.align === 'left' ? area.x : area.x + area.w / 2;
      if (st.stroke) { ctx.strokeStyle = '#000'; ctx.lineWidth = subPx * 0.18; ctx.strokeText(lines[0], sx, sy); }
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = subPx * 0.3;
      ctx.fillText(lines[0], sx, sy);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
    }
    if (st.bar) { ctx.fillStyle = st.bar; ctx.fillRect(0, H - minDim * 0.02, W, minDim * 0.02); }
    if (st.frame) { ctx.strokeStyle = accent; ctx.lineWidth = minDim * 0.008; ctx.strokeRect(minDim * 0.03, minDim * 0.03, W - minDim * 0.06, H - minDim * 0.06); }
    if (badgeTxt) {
      ctx.font = `800 ${badgeH * 0.55}px "Be Vietnam Pro", sans-serif`;
      const bw = ctx.measureText(badgeTxt).width + badgeH * 0.8;
      const bx = area.x, by = vertical ? area.y : H * 0.06;
      ctx.fillStyle = st.box || accent;
      roundRect(ctx, bx, by, bw, badgeH, badgeH * 0.25);
      ctx.fill();
      ctx.fillStyle = inkOn(st.box || accent);
      ctx.fillText(badgeTxt, bx + badgeH * 0.4, by + badgeH * 0.7);
    }
  }

  async function ensureFonts() {
    try {
      await Promise.all(Object.values(STYLES).map((s) => document.fonts.load(s.font(40), 'AaĐđỔẶ' + $('thTitle').value)));
    } catch (_) {}
  }

  /** The preview is drawn at ≤ 1920 px wide (a 4K redraw on every keystroke would lag on phones); export is full size. */
  const render = oncePerFrame(() => {
    const { W, H } = size();
    const k = Math.min(1, 1920 / W), pw = Math.round(W * k), ph = Math.round(H * k);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    draw(ctx, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  });

  /* ---- background: a photo, or a frame of a video ---- */
  const isVideo = (f) => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name);
  function dropBg() {
    if (bg && bg.url) URL.revokeObjectURL(bg.url);
    if (bg && bg.video) { bg.video.removeAttribute('src'); bg.video.load(); }
    bg = null;
  }
  async function loadVideo(f) {
    const url = URL.createObjectURL(f);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('Không đọc được video này — thử chọn ảnh chụp màn hình thay thế')); });
    return { img: v, w: v.videoWidth, h: v.videoHeight, url, video: v };
  }
  function seekFrame() {
    if (!bg || !bg.video) return;
    const v = bg.video;
    // WebM from screen recorders often reports duration = Infinity: fall back to the first seconds
    const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 10;
    v.currentTime = Math.max(0, Math.min(d - 0.05, (+$('thFrame').value / 1000) * d)) || 0;
  }
  onFiles('thImg', async ([f]) => {
    try {
      dropBg();
      $('thImgInfo').textContent = 'Đang đọc…';
      if (isVideo(f)) {
        bg = await loadVideo(f);
        bg.video.addEventListener('seeked', render);
        $('thFrameWrap').hidden = false;
        seekFrame();
        $('thImgInfo').textContent = `🎬 ${f.name} — kéo thanh "Khung hình" để chọn khoảnh khắc đẹp nhất`;
      } else {
        bg = await readImage(f);
        $('thFrameWrap').hidden = true;
        $('thImgInfo').textContent = `🖼️ ${f.name}`;
      }
      render();
    } catch (e) {
      dropBg();
      $('thFrameWrap').hidden = true;
      $('thImgInfo').textContent = e.message;
    }
  });
  $('thFrame').addEventListener('input', seekFrame);

  /* ---- style chips ---- */
  $('thStyles').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-style]');
    if (!b) return;
    style = b.dataset.style;
    $('thStyles').querySelectorAll('button').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on); });
    render();
  });
  ['thSize', 'thDim', 'thTitle', 'thSub', 'thBadge', 'thPos', 'thAccent', 'thBg'].forEach((id) => $(id).addEventListener('input', render));
  $('thDim').addEventListener('input', () => ($('thDimOut').textContent = $('thDim').value));

  /* ---- export ---- */
  async function exportBlob() {
    const { W, H } = size();
    const c = makeCanvas(W, H);
    draw(c.getContext('2d'), W, H);
    const type = $('thFormat').value, max = +$('thMax').value;
    try {
      if (type === 'image/png') {
        const blob = await canvasToBlob(c, 'image/png');
        return { blob, q: 1, fits: blob.size <= max, W, H, type };
      }
      // JPG: highest quality that stays under the limit
      const r = await Core.fitQuality((q) => canvasToBlob(c, 'image/jpeg', q), max, 0.4, 0.95);
      return { ...r, W, H, type };
    } finally { c.width = c.height = 0; }
  }
  $('thExport').onclick = async () => {
    const btn = $('thExport');
    btn.disabled = true;
    try {
      await ensureFonts();
      const r = await exportBlob();
      const ext = r.type === 'image/png' ? 'png' : 'jpg';
      const slug = Core.baseName($('thTitle').value.replace(/\*/g, '').trim().slice(0, 40) || 'anh-bia').replace(/[\\/:*?"<>|\n]+/g, ' ').trim() || 'anh-bia';
      clearResults($('thOut'));
      const info = `${r.W}×${r.H}${ext === 'jpg' ? ` · chất lượng ${Math.round(r.q * 100)}%` : ''}` +
        (r.fits ? ' · ✅ vừa giới hạn' : ' · ⚠️ vượt giới hạn dung lượng — chọn JPG hoặc khung nhỏ hơn');
      resultCard($('thOut'), { blob: r.blob, name: `${slug} ${r.W}x${r.H}.${ext}`, info });
      toast('Đã tạo ảnh bìa!');
    } catch (e) {
      console.error(e);
      toast(e.message || 'Không tạo được ảnh bìa');
    } finally { btn.disabled = false; }
  };

  /* ---- title / caption checker ---- */
  function counts() {
    const s = Core.captionStats($('thCaption').value);
    const ul = $('thCounts');
    ul.innerHTML = '';
    const li = (text, cls) => { const e = document.createElement('li'); e.textContent = text; if (cls) e.className = cls; ul.appendChild(e); };
    for (const [k, l] of Object.entries(Core.TEXT_LIMITS)) {
      const over = s.over[k];
      li(`${over ? '⚠️' : '✅'} ${l.label}: ${s.chars}/${l.max}${over ? ` — dài quá ${over} ký tự` : ''}`, over ? 'bad' : 'good');
    }
    li(`# Hashtag: ${s.hashtags.length}${s.hashtags.length ? ' — ' + s.hashtags.slice(0, 12).join(' ') + (s.hashtags.length > 12 ? ' …' : '') : ''}`);
    s.warnings.forEach((w) => li('⚠️ ' + w, 'bad'));
  }
  $('thCaption').addEventListener('input', counts);
  counts();

  window.addEventListener('tabshown', (e) => e.detail === 'thumb' && render());
  ensureFonts().then(render);
  render();
  return { draw, exportBlob, size, get style() { return style; } };
})();

/* ======================= Extract audio ======================= */
const Extract = (() => {
  let audio = null, name = '';
  const trim = AudioTrim.mount({ box: $('exTrim'), startId: 'exStart', durId: 'exDur', onAudio: (b) => { audio = b; loud.refresh(); } });
  const clip = () => {
    if (!audio) return null;
    const start = Math.max(0, +$('exStart').value || 0);
    // a mono WAV stays mono: measure it as one channel (as stereo it would land 3 dB under the target)
    const mono = $('exFormat').value === 'wav' && audio.numberOfChannels === 1;
    return { audio, mono, offset: start, duration: Core.clipDuration({ start, dur: $('exDur').value, audioDur: audio.duration }) };
  };
  const loud = Loudness.mount('exLoud', clip);

  onFiles('exFile', async ([f]) => {
    $('exInfo').textContent = 'Đang đọc âm thanh…';
    $('exRun').disabled = true;
    $('exOut').innerHTML = '';
    try {
      audio = await decodeAudioFile(f);
      name = Core.baseName(f.name);
      $('exInfo').textContent = `🎵 ${f.name} — ${formatTime(audio.duration)} · ${audio.sampleRate} Hz · ${audio.numberOfChannels} kênh`;
      // ~22 MB of decoded sound per minute is already in memory: long files can make a phone tab reload
      if (IS_MOBILE && audio.duration > 1200) $('exInfo').textContent += ' · ⚠️ File dài trên điện thoại có thể làm trang tải lại vì thiếu bộ nhớ — nên chọn đoạn ngắn hoặc làm trên máy tính.';
      $('exStart').value = 0; $('exDur').value = '';
      trim.setAudio(audio);
      $('exRun').disabled = false;
      loud.refresh();
    } catch (e) {
      audio = null;
      trim.setAudio(null);
      $('exInfo').textContent = /không phải|giải mã/i.test(e.message) ? e.message + ' — video này có thể không có tiếng.' : e.message;
    }
  });

  function showOut(blob, file, note) {
    const out = $('exOut');
    const old = out.querySelector('audio');
    if (old) URL.revokeObjectURL(old.src);
    out.innerHTML = '';
    const url = URL.createObjectURL(blob);
    const box = document.createElement('div');
    box.className = 'outbox';
    box.innerHTML = `<div class="out-title">✅ Âm thanh đã sẵn sàng</div>
      <div class="row"><button class="primary" data-a="dl"></button>${canShareFiles ? '<button data-a="share">Chia sẻ / Lưu</button>' : ''}</div>
      <div class="hint" data-a="name"></div><div class="hint" data-a="note"></div><audio controls src="${url}"></audio>`;
    box.querySelector('[data-a=dl]').textContent = `Tải ${file.split('.').pop().toUpperCase()} (${formatBytes(blob.size)})`;
    box.querySelector('[data-a=name]').textContent = file;
    box.querySelector('[data-a=note]').textContent = note || '';
    box.querySelector('[data-a=dl]').onclick = () => download(blob, file);
    const sh = box.querySelector('[data-a=share]');
    if (sh) sh.onclick = () => shareFile(blob, file);
    out.appendChild(box);
  }

  /** M4A (AAC 192 kb/s) through the same streamed 1-second chunks as the video export. */
  async function toM4a(c, gain, onProgress, signal) {
    const { MB } = await VideoEngine.loadMediabunny();
    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
    const src = new MB.AudioBufferSource({ codec: 'aac', bitrate: 192000 });
    output.addAudioTrack(src);
    await output.start();
    let done = 0;
    try {
      for await (const chunk of VideoEngine.audioChunks(c.audio, c.offset, c.duration, gain)) {
        if (signal.aborted) throw new DOMException('Đã huỷ', 'AbortError');
        await src.add(chunk);
        done += chunk.duration;
        onProgress(Math.min(0.99, done / c.duration));
      }
      src.close();
      await output.finalize();
      return new Blob([output.target.buffer], { type: 'audio/mp4' });
    } catch (e) {
      await output.cancel().catch(() => {});
      throw e;
    }
  }

  let ctrl = null;
  $('exRun').onclick = async () => {
    if (ctrl) { ctrl.abort(); return; }
    const c = clip();
    if (!c) return toast('Hãy chọn video hoặc audio');
    const bad = Core.checkStart($('exStart').value, audio.duration);
    if (bad) return toast(bad);
    const btn = $('exRun'), label = btn.textContent, prog = $('exProg');
    ctrl = new AbortController();
    btn.textContent = 'Huỷ';
    try {
      setProgress(prog, 0.05, 'Đang đo âm lượng…');
      const gain = await loud.gain();
      const sr = c.audio.sampleRate;
      let blob, file, note = await loud.text(); // the clip being exported now, not a debounced older one
      /** WAV in ~10 s parts: no single huge copy of a long recording. Stereo = the export down-mix (5.1 keeps the voice). */
      const wav = (mono) => {
        const all = Array.from({ length: c.audio.numberOfChannels }, (_, i) => c.audio.getChannelData(i));
        const chans = mono ? [all[0]] : Core.downmixStereo(all);
        return new Blob(Core.wavParts(chans, sr, c.offset * sr, (c.offset + c.duration) * sr, gain), { type: 'audio/wav' });
      };
      if ($('exFormat').value === 'wav') {
        setProgress(prog, 0.3, 'Đang tạo WAV…');
        await nextFrame();
        blob = wav(c.mono);
        file = `${name || 'am-thanh'}.wav`;
      } else {
        try {
          blob = await toM4a(c, gain, (f) => setProgress(prog, f, `Đang mã hoá AAC ${Math.round(f * 100)}%`), ctrl.signal);
          file = `${name || 'am-thanh'}.m4a`;
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          console.warn('M4A failed, falling back to WAV', e);
          blob = wav(false); // stereo, like the M4A it replaces (the gain was measured for stereo)
          file = `${name || 'am-thanh'}.wav`;
          note = '⚠️ Trình duyệt này không mã hoá được M4A nên đã lưu WAV (file lớn hơn, chất lượng như nhau). ' + note;
        }
      }
      setProgress(prog, 1, 'Xong!');
      showOut(blob, file, note);
      toast('Đã tách âm thanh!');
    } catch (e) {
      prog.hidden = true;
      if (e.name === 'AbortError') toast('Đã huỷ');
      else { console.error(e); toast(e.message || 'Không tách được âm thanh'); }
    } finally {
      ctrl = null;
      btn.textContent = label;
    }
  };
  return { get audio() { return audio; } };
})();
