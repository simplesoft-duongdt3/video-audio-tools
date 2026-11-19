/* Audio file → MP4 with animated visualizer, title, cover art and time bar */
(() => {
  let audio = null, audioFile = '';
  let channels = null; // cached Float32Array per channel of `audio`
  let art = null; // {img, w, h, url}
  let blurCache = null;
  const canvas = $('avCanvas');
  const player = new VideoEngine.Player(canvas);
  const FFT = 2048;

  function opts() {
    const size = getSize($('avSize'));
    const audioDur = audio ? audio.duration : 0;
    const start = Math.max(0, +$('avStart').value || 0);
    return {
      W: size.w, H: size.h,
      fps: +$('avFps').value,
      start,
      duration: Core.clipDuration({ start, dur: $('avDur').value, audioDur, fallback: 10 }),
      title: $('avTitle').value.trim() || (audioFile ? baseName(audioFile) : 'Tên bài hát'),
      sub: $('avSub').value.trim(),
      style: $('avStyle').value,
      c1: $('avColor1').value, c2: $('avColor2').value,
      bgMode: $('avBgMode').value, bgColor: $('avBgColor').value,
      progress: $('avProgress').checked,
    };
  }

  /* ---------------- geometry ---------------- */
  function geometry(W, H) {
    const u = Math.min(W, H) / 1080;
    if (W > H) {
      // landscape: cover art on the left, everything else in a right-hand column
      const A = Math.round(H * 0.6);
      const ax = Math.round(W * 0.07), ay = Math.round((H - A) / 2);
      const cx = ax + A + Math.round(90 * u), cw = W - cx - Math.round(W * 0.07);
      return { u, A, ax, ay, tx: cx, tw: cw, align: 'left', titleY: H * 0.22, vx: cx, vw: cw, vy: H * 0.46, vh: H * 0.22, py: H * 0.8 };
    }
    const A = Math.round(Math.min(W * 0.64, H * 0.33));
    const ax = Math.round((W - A) / 2), ay = Math.round(H * 0.12);
    const titleY = ay + A + H * 0.06;
    const vx = Math.round(W * 0.08), vw = W - 2 * vx;
    const vy = titleY + H * 0.1;
    const vh = H * 0.12;
    return { u, A, ax, ay, tx: W * 0.08, tw: W * 0.84, align: 'center', titleY, vx, vw, vy, vh, py: vy + vh + H * 0.06 };
  }

  /* ---------------- analysis ---------------- */
  function makeAnalyzer(o) {
    const sr = audio ? audio.sampleRate : 48000;
    const win = new Float32Array(FFT);
    let prev = null, lastT = -1;
    let overview = null;
    return {
      /** {bands, wave, level} for clip time t (seconds from the clip start). */
      at(t, nBands) {
        if (!channels) {
          // no audio yet: a static demo pattern so the layout can be previewed
          const bands = Float32Array.from({ length: nBands }, (_, i) => 0.25 + 0.6 * Math.abs(Math.sin(i * 0.37 + 1)) * (1 - i / nBands / 1.5));
          const wave = Float32Array.from({ length: 256 }, (_, i) => 0.5 * Math.sin(i / 9) * Math.sin(i / 40));
          return { bands, wave, level: 0.4 };
        }
        const center = (o.start + t) * sr;
        Core.monoWindow(channels, center, FFT, win);
        const raw = Core.spectrumBands(win, sr, nBands);
        const bands = Core.smoothBars(prev, raw, t - lastT);
        prev = bands; lastT = t;
        return { bands, wave: win, level: Math.min(1, Core.rms(win) * 3) };
      },
      overview(n) {
        if (!overview || overview.length !== n) {
          overview = channels
            ? Core.peaks(channels, n, Math.floor(o.start * sr), Math.min(channels[0].length, Math.ceil((o.start + o.duration) * sr)))
            : Float32Array.from({ length: n }, (_, i) => 0.2 + 0.7 * Math.abs(Math.sin(i * 0.5) * Math.cos(i * 0.13)));
        }
        return overview;
      },
    };
  }

  /* ---------------- drawing ---------------- */
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBackground(ctx, o, g, im) {
    const { W, H } = o;
    if (o.bgMode === 'image' && im) {
      const key = `${W}x${H}|${im.url}`;
      if (!blurCache || blurCache.key !== key) blurCache = { key, c: makeBlur(im.img, im.w, im.h, W, H, 0.5) };
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingQuality = 'high';
      drawImageFit(ctx, blurCache.c, blurCache.c.width, blurCache.c.height, 0, 0, W, H, 'cover', 1.05);
      return;
    }
    if (o.bgMode === 'color') {
      ctx.fillStyle = o.bgColor;
      ctx.fillRect(0, 0, W, H);
    } else {
      const lg = ctx.createLinearGradient(0, 0, W * 0.3, H);
      lg.addColorStop(0, '#1b1036');
      lg.addColorStop(1, '#07070c');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, W, H);
    }
    // soft glow behind the art
    const cx = g.ax + g.A / 2, cy = g.ay + g.A / 2;
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, g.A * 1.1);
    rg.addColorStop(0, hexA(o.c1, 0.22));
    rg.addColorStop(1, hexA(o.c1, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function grad(ctx, o, x0, x1) {
    const lg = ctx.createLinearGradient(x0, 0, x1, 0);
    lg.addColorStop(0, o.c1);
    lg.addColorStop(1, o.c2);
    return lg;
  }

  function drawArt(ctx, o, g, im, level, round) {
    const { ax, ay, A, u } = g;
    const cx = ax + A / 2, cy = ay + A / 2;
    ctx.save();
    if (im) {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 40 * u;
      ctx.shadowOffsetY = 14 * u;
      if (round) { ctx.beginPath(); ctx.arc(cx, cy, A / 2, 0, Math.PI * 2); } else roundRect(ctx, ax, ay, A, A, A * 0.06);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();
      drawImageFit(ctx, im.img, im.w, im.h, ax, ay, A, A, 'cover');
    } else {
      // no cover: a pulsing disc with a note
      const s = 1 + 0.06 * level;
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      const rg = ctx.createLinearGradient(-A / 2, -A / 2, A / 2, A / 2);
      rg.addColorStop(0, o.c2);
      rg.addColorStop(1, o.c1);
      ctx.beginPath();
      ctx.arc(0, 0, A / 2, 0, Math.PI * 2);
      ctx.fillStyle = rg;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(0, 0, A * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.round(A * 0.34)}px "Be Vietnam Pro", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♪', 0, -A * 0.02);
    }
    ctx.restore();
  }

  function drawText(ctx, o, g) {
    const { u, tx, tw, align } = g;
    const x = align === 'center' ? tx + tw / 2 : tx;
    ctx.save();
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    const fs = Math.round(64 * u);
    ctx.font = `800 ${fs}px "Be Vietnam Pro", sans-serif`;
    const lines = Core.clampLines(ctx, o.title.normalize('NFC'), tw, 2);
    let y = g.titleY;
    for (const l of lines) { ctx.fillText(l, x, y); y += fs * 1.22; }
    if (o.sub) {
      ctx.globalAlpha = 0.72;
      ctx.font = `600 ${Math.round(38 * u)}px "Be Vietnam Pro", sans-serif`;
      ctx.fillText(Core.clampLines(ctx, o.sub.normalize('NFC'), tw, 1)[0] || '', x, y - fs * 0.2 + 38 * u);
    }
    ctx.restore();
  }

  function drawBars(ctx, o, g, bands, mirror) {
    const n = bands.length;
    const step = g.vw / n, bw = step * 0.62;
    ctx.fillStyle = grad(ctx, o, g.vx, g.vx + g.vw);
    const minH = 6 * g.u;
    for (let i = 0; i < n; i++) {
      const h = Math.max(minH, bands[i] * g.vh);
      const x = g.vx + i * step + (step - bw) / 2;
      const y = mirror ? g.vy + (g.vh - h) / 2 : g.vy + g.vh - h;
      roundRect(ctx, x, y, bw, h, bw / 2);
      ctx.fill();
    }
  }

  function drawWave(ctx, o, g, wave) {
    const n = 256;
    const step = Math.max(1, Math.floor(wave.length / n));
    const mid = g.vy + g.vh / 2;
    ctx.save();
    ctx.lineWidth = Math.max(3, 7 * g.u);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = grad(ctx, o, g.vx, g.vx + g.vw);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const v = Math.max(-1, Math.min(1, wave[i * step] * 1.8));
      const x = g.vx + (i / (n - 1)) * g.vw;
      const y = mid - v * (g.vh / 2);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawCircle(ctx, o, g, bands) {
    const cx = g.ax + g.A / 2, cy = g.ay + g.A / 2;
    const r0 = g.A / 2 + 16 * g.u;
    const n = bands.length;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, ((2 * Math.PI * r0) / (n * 2)) * 0.9);
    for (let i = 0; i < n * 2; i++) {
      // mirror the spectrum so low frequencies meet at the top and bottom
      const k = i < n ? i : 2 * n - 1 - i;
      const len = 6 * g.u + bands[k] * g.A * 0.22;
      const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
      ctx.strokeStyle = i % 2 ? o.c1 : o.c2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawOverview(ctx, o, g, pk, frac) {
    const n = pk.length;
    const step = g.vw / n, bw = step * 0.55;
    const played = frac * n;
    for (let i = 0; i < n; i++) {
      const h = Math.max(6 * g.u, pk[i] * g.vh);
      ctx.fillStyle = i < played ? o.c1 : 'rgba(255,255,255,0.28)';
      roundRect(ctx, g.vx + i * step + (step - bw) / 2, g.vy + (g.vh - h) / 2, bw, h, bw / 2);
      ctx.fill();
    }
  }

  function drawProgress(ctx, o, g, t) {
    const { u, vx, vw } = g;
    const y = g.py, h = Math.max(4, 8 * u);
    const frac = endFrac(o, t);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    roundRect(ctx, vx, y, vw, h, h / 2); ctx.fill();
    ctx.fillStyle = '#fff';
    roundRect(ctx, vx, y, Math.max(h, vw * frac), h, h / 2); ctx.fill();
    ctx.beginPath();
    ctx.arc(vx + vw * frac, y + h / 2, h * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 ${Math.round(30 * u)}px "Be Vietnam Pro", sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(formatTime(t), vx, y + h + 16 * u);
    ctx.textAlign = 'right';
    ctx.fillText(formatTime(o.duration), vx + vw, y + h + 16 * u);
    ctx.restore();
  }

  /** 0..1 position in the clip; the last frame (drawn at duration − 1/fps) counts as the end. */
  const endFrac = (o, t) => Math.min(1, t / Math.max(1e-3, o.duration - 1 / o.fps));

  function makeDraw(o, im) {
    const g = geometry(o.W, o.H);
    const an = makeAnalyzer(o);
    const nBands = o.W > o.H ? 56 : 40;
    return (ctx, t) => {
      const { bands, wave, level } = an.at(t, o.style === 'circle' ? 48 : nBands);
      drawBackground(ctx, o, g, im);
      drawArt(ctx, o, g, im, level, o.style === 'circle');
      if (o.style === 'circle') drawCircle(ctx, o, g, bands);
      drawText(ctx, o, g);
      if (o.style === 'bars') drawBars(ctx, o, g, bands, false);
      else if (o.style === 'mirror') drawBars(ctx, o, g, bands, true);
      else if (o.style === 'wave') drawWave(ctx, o, g, wave);
      else if (o.style === 'overview') drawOverview(ctx, o, g, an.overview(o.W > o.H ? 80 : 60), endFrac(o, t));
      if (o.progress) drawProgress(ctx, o, g, t);
    };
  }

  function scene() {
    const o = opts();
    return { width: o.W, height: o.H, fps: o.fps, duration: o.duration, draw: makeDraw(o, art), audio, audioOffset: o.start };
  }

  async function ensureFonts() {
    try {
      await Promise.all(['800 40px "Be Vietnam Pro"', '600 40px "Be Vietnam Pro"'].map((f) => document.fonts.load(f, 'AaĂâđỔẶ♪' + opts().title)));
    } catch (_) {}
  }

  function preview() {
    if (player.playing) return;
    const sc = scene();
    canvas.width = sc.width;
    canvas.height = sc.height;
    // show a moment with sound rather than the silent first frame
    const t = audio ? Math.min(sc.duration * 0.3, 20) : 0;
    sc.draw(canvas.getContext('2d'), t);
  }

  /* ---------------- events ---------------- */
  onFiles('avAudio', async ([f]) => {
    $('avAudioInfo').textContent = 'Đang đọc audio…';
    try {
      const buf = await decodeAudioFile(f);
      audio = buf;
      channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      audioFile = f.name;
      $('avAudioInfo').textContent = `🎵 ${f.name} — ${formatTime(buf.duration)} · ${buf.sampleRate} Hz · ${buf.numberOfChannels} kênh`;
      // A whole long track can need ~1 GB of RAM to export; phones (iOS especially) reload the tab instead.
      if (IS_MOBILE && buf.duration > 300) {
        $('avAudioInfo').textContent += ' · ⚠️ Bài dài trên điện thoại có thể bị thiếu bộ nhớ khi xuất — nên đặt "Thời lượng" ≤ 180s hoặc xuất trên máy tính.';
      }
      await ensureFonts();
      preview();
    } catch (e) {
      audio = null; channels = null; audioFile = '';
      $('avAudioInfo').textContent = e.message;
    }
  });

  onFiles('avImg', async ([f]) => {
    try {
      if (art) URL.revokeObjectURL(art.url);
      art = await readImage(f);
      blurCache = null;
      $('avImgInfo').textContent = `🖼️ ${f.name}`;
      if ($('avBgMode').value === 'gradient') $('avBgMode').value = 'image';
      preview();
    } catch (e) { toast(e.message); }
  });

  ['avTitle', 'avSub', 'avStyle', 'avColor1', 'avColor2', 'avBgMode', 'avBgColor', 'avSize', 'avFps', 'avStart', 'avDur', 'avProgress'].forEach((id) =>
    $(id).addEventListener('input', preview)
  );

  $('avPlay').onclick = async () => {
    if (player.playing) { player.stop(); $('avPlay').textContent = '▶ Xem thử'; preview(); return; }
    if (!audio) return toast('Hãy chọn file audio');
    const bad = Core.checkStart($('avStart').value, audio.duration);
    if (bad) return toast(bad);
    audioCtx().resume(); // inside the tap, before any await (iOS)
    await ensureFonts();
    const sc = scene();
    canvas.width = sc.width; canvas.height = sc.height;
    $('avPlay').textContent = '■ Dừng';
    player.play(sc, (t) => { if (t < 0) { $('avPlay').textContent = '▶ Xem thử'; preview(); } });
  };

  wireRender({
    btn: $('avRender'),
    prog: $('avProg'),
    out: $('avOut'),
    fileName: () => (audioFile ? baseName(audioFile) : 'audio') + '-video',
    buildScene: async () => {
      if (!audio) throw new Error('Hãy chọn file audio');
      const bad = Core.checkStart($('avStart').value, audio.duration);
      if (bad) throw new Error(bad);
      player.stop();
      $('avPlay').textContent = '▶ Xem thử';
      await ensureFonts();
      return scene();
    },
  });

  window.addEventListener('tabshown', (e) => e.detail === 'audiovideo' && preview());
  preview();
  ensureFonts().then(preview);
})();
