/* Image(s) + audio → video (slideshow, Ken Burns, blurred background) */
(() => {
  const images = []; // {img, w, h, url, blur}
  let audio = null, audioName = '';
  const canvas = $('ivCanvas');
  const player = new VideoEngine.Player(canvas);
  let rw = null; // export button (estimate line)
  const thumbCache = new Map(); // template thumbnails + empty preview (sample photo)
  const trim = AudioTrim.mount({ box: $('ivTrim'), startId: 'ivStart', durId: 'ivDur' });

  /* ---------------- templates ---------------- */
  /** Look = what a template sets that has no control: title font/colour/position and cinema bars. */
  const DEFAULT_LOOK = { font: 'Be Vietnam Pro', weight: 800, italic: false, upper: false, color: '#ffffff', pos: 'bottom', size: 72, shadow: true, box: null, bars: false };
  const T = (id, name, cat, set, look) => ({ id, name, cat, set, style: look }); // only what the look needs: the user's other choices stay
  const IV_TEMPLATES = [
    T('basic', 'Cơ bản', 'Phổ biến', { ivFit: 'blur', ivFx: 'kenburns', ivTrans: 'fade', ivFilter: 'none' }, {}),
    T('memory', 'Kỷ niệm', 'Gia đình', { ivFit: 'blur', ivFx: 'kenburns', ivTrans: 'fade', ivFilter: 'warm' }, { font: 'Lobster', weight: 400, size: 92 }),
    T('travel', 'Du lịch', 'Du lịch', { ivFit: 'cover', ivFx: 'kenburns', ivTrans: 'slide', ivFilter: 'none' }, { font: 'Montserrat', weight: 900, upper: true, pos: 'top', size: 80 }),
    T('polaroid', 'Polaroid', 'Gia đình', { ivFit: 'polaroid', ivBg: '#efe6d8', ivFx: 'kenburns', ivTrans: 'fade', ivFilter: 'none' }, { font: 'Playfair Display', weight: 700, italic: true, color: '#3b2f2f', size: 70, shadow: false }),
    T('cinema', 'Điện ảnh', 'Du lịch', { ivFit: 'cover', ivFx: 'kenburns', ivTrans: 'fade', ivFilter: 'cool' }, { font: 'Playfair Display', weight: 700, color: '#f5f5f5', size: 54, shadow: false, bars: true }),
    T('bw', 'Đen trắng', 'Nghệ thuật', { ivFit: 'blur', ivFx: 'kenburns', ivTrans: 'fade', ivFilter: 'bw' }, { weight: 600, size: 60 }),
    T('vintage', 'Cổ điển', 'Nghệ thuật', { ivFit: 'blur', ivFx: 'kenburns', ivTrans: 'zoom', ivFilter: 'vintage' }, { font: 'Playfair Display', weight: 700, italic: true, color: '#fff3d6', size: 76 }),
    T('product', 'Sản phẩm', 'Bán hàng', { ivFit: 'contain', ivBg: '#ffffff', ivFx: 'none', ivTrans: 'slide', ivFilter: 'none' }, { font: 'Montserrat', weight: 900, upper: true, pos: 'top', size: 64, shadow: false, box: '#fe2c55' }),
    T('energy', 'Năng động', 'Bán hàng', { ivFit: 'cover', ivFx: 'zoomout', ivTrans: 'none', ivFilter: 'none' }, { font: 'Montserrat', weight: 900, upper: true, pos: 'center', size: 96 }),
  ];
  let look = { ...DEFAULT_LOOK };
  const fontOf = (L, px) => `${L.italic ? 'italic ' : ''}${L.weight} ${px}px "${L.font}", "Be Vietnam Pro", sans-serif`;

  function settings() {
    const size = getSize($('ivSize'));
    const start = Math.max(0, +$('ivStart').value || 0);
    const duration = Core.clipDuration({ start, dur: $('ivDur').value, audioDur: audio ? audio.duration : 0, fallback: Math.max(1, images.length) * 4 });
    return {
      W: size.w, H: size.h, start, duration,
      fps: +$('ivFps').value,
      fit: $('ivFit').value, bg: $('ivBg').value,
      fx: $('ivFx').value, trans: $('ivTrans').value, filter: $('ivFilter').value,
      title: $('ivTitle').value.trim(),
      progress: $('ivProgress').checked,
      look,
    };
  }

  /** Polaroid card around a photo of iw×ih, fitted in the frame. */
  function polaroid(iw, ih, W, H) {
    const maxW = W * 0.8, maxH = H * (W > H ? 0.62 : 0.6); // leaves room for a bottom title in landscape
    const pad0 = Math.min(maxW, maxH) * 0.045;
    const sc = Math.min((maxW - 2 * pad0) / iw, (maxH - pad0 - pad0 * 3.5) / ih);
    const pw = iw * sc, ph = ih * sc;
    return { pw, ph, pad: pad0, cw: pw + 2 * pad0, ch: ph + pad0 * 4.5, scale: sc };
  }

  function filtered(canvas, kind) {
    if (!kind || kind === 'none' || !canvas.width) return;
    const c = canvas.getContext('2d');
    const d = c.getImageData(0, 0, canvas.width, canvas.height);
    Core.applyFilter(d.data, kind);
    c.putImageData(d, 0, 0);
  }

  /*
   * Per-image work done ONCE instead of every frame (big photos are 12 MP: scaling them 30×/s made export slow):
   *  - bg:   the blurred / coloured background already at W×H (per-frame cost = one 1:1 copy)
   *  - main: the photo pre-scaled to its on-screen size × 1.1 (room for the Ken Burns zoom), colour filter applied
   * Only the slides currently visible are kept (a 1080×1920 canvas is ~8 MB; phones have little memory).
   */
  const prepCache = new Map();
  function prepared(im, k, s, cache = prepCache) {
    const key = [k, s.W, s.H, s.fit, s.bg, s.filter, im.url].join('|');
    let e = cache.get(k);
    if (e && e.key === key) return e;
    if (e) { e.bg.width = e.bg.height = 0; if (e.ownMain) e.main.width = e.main.height = 0; } // never wipe a canvas we didn't create (the sample photo)
    const { W, H } = s;
    const bg = makeCanvas(W, H);
    const b = bg.getContext('2d');
    b.fillStyle = s.bg;
    b.fillRect(0, 0, W, H);
    if (s.fit === 'blur') {
      const bl = makeBlur(im.img, im.w, im.h, W, H);
      b.imageSmoothingQuality = 'high';
      drawImageFit(b, bl, bl.width, bl.height, 0, 0, W, H, 'cover', 1.05);
      bl.width = bl.height = 0;
      filtered(bg, s.filter);
    }
    const pol = s.fit === 'polaroid' ? polaroid(im.w, im.h, W, H) : null;
    const fitScale = (pol ? pol.scale : s.fit === 'cover' ? Math.max(W / im.w, H / im.h) : Math.min(W / im.w, H / im.h)) * 1.1;
    let main = im.img;
    const needFilter = s.filter && s.filter !== 'none';
    if (fitScale < 0.9 || needFilter) {
      const f = Math.min(1, fitScale);
      main = makeCanvas(im.w * f, im.h * f);
      const m = main.getContext('2d');
      m.imageSmoothingQuality = 'high';
      m.drawImage(im.img, 0, 0, main.width, main.height);
      filtered(main, s.filter);
    }
    e = { key, bg, main, ownMain: main !== im.img, mw: main.width || im.w, mh: main.height || im.h, pol };
    cache.set(k, e);
    if (cache === prepCache) {
      // keep only this slide and its neighbours
      for (const [kk, v] of cache) {
        if (Math.abs(kk - k) > 1) { v.bg.width = v.bg.height = 0; if (v.ownMain) v.main.width = v.main.height = 0; cache.delete(kk); }
      }
    }
    return e;
  }

  function drawSlide(ctx, im, k, p, s, cache) {
    const { W, H } = s;
    if (!im) { ctx.fillStyle = s.bg; ctx.fillRect(0, 0, W, H); return; }
    const e = prepared(im, k, s, cache);
    ctx.drawImage(e.bg, 0, 0);
    const zoom = s.fx === 'kenburns' ? 1 + 0.1 * p : s.fx === 'zoomout' ? 1.12 - 0.12 * p : 1;
    if (e.pol) {
      const { cw, ch, pw, ph, pad } = e.pol;
      ctx.save();
      ctx.translate(W / 2, H * (W > H ? 0.42 : 0.46));
      ctx.rotate((k % 2 ? -1 : 1) * 0.035);
      const z = 1 + (zoom - 1) * 0.4; // the card itself moves only a little
      ctx.scale(z, z);
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = Math.min(W, H) * 0.04;
      ctx.shadowOffsetY = Math.min(W, H) * 0.012;
      ctx.fillStyle = '#fdfdfb';
      ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
      ctx.shadowColor = 'transparent';
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(e.main, -cw / 2 + pad, -ch / 2 + pad, pw, ph);
      ctx.restore();
      return;
    }
    // alternate pan direction per slide
    const ox = s.fx === 'kenburns' ? (k % 2 ? 0.5 - 0.15 * p : 0.5 + 0.15 * p) : 0.5;
    if (s.fit === 'cover') drawImageFit(ctx, e.main, e.mw, e.mh, 0, 0, W, H, 'cover', zoom, Math.min(1, Math.max(0, ox)), 0.5);
    else drawImageFit(ctx, e.main, e.mw, e.mh, 0, 0, W, H, 'contain', zoom);
  }

  const barH = (s) => Math.round(s.H * (s.W > s.H ? 0.07 : 0.09));

  function drawTitle(ctx, s, alpha) {
    if (!s.title) return;
    const L = s.look || DEFAULT_LOOK;
    const { W, H } = s;
    const u = Math.min(W, H) / 1080;
    const text = (L.upper ? s.title.toUpperCase() : s.title).normalize('NFC');
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // shrink (down to 60%) until the title fits in 2 lines, then cut with "…" only if it still doesn't
    let fs = Math.round(L.size * u), lines;
    for (;;) {
      ctx.font = fontOf(L, fs);
      lines = Core.clampLines(ctx, text, W * 0.84, 2);
      const cut = lines.length && /…$/.test(lines[lines.length - 1]) && !text.endsWith('…');
      if (!cut || fs <= L.size * u * 0.6) break;
      fs = Math.round(fs * 0.92);
    }
    const lh = fs * 1.25;
    let cy = L.pos === 'top' ? H * (L.bars ? 0.17 : 0.12) : L.pos === 'center' ? H * 0.5 : H * 0.84;
    if (L.bars && L.pos === 'bottom') cy = H - barH(s) / 2; // subtitle inside the cinema bar
    let y = cy - ((lines.length - 1) * lh) / 2;
    for (const l of lines) {
      if (L.box) {
        const w = ctx.measureText(l).width, pad = fs * 0.32;
        ctx.fillStyle = L.box;
        ctx.fillRect(W / 2 - w / 2 - pad, y - lh / 2, w + 2 * pad, lh);
      }
      if (L.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = fs * 0.3; ctx.shadowOffsetY = fs * 0.04; }
      ctx.fillStyle = L.color;
      ctx.fillText(l, W / 2, y);
      ctx.shadowColor = 'transparent';
      y += lh;
    }
    ctx.restore();
  }

  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  /** imgs / cache are swapped for template thumbnails (sample photo, own cache). */
  function makeDraw(s, imgs = images, cache = prepCache) {
    const n = Math.max(1, imgs.length);
    const seg = s.duration / n;
    const T = s.trans !== 'none' ? Math.min(0.7, seg / 3) : 0;
    const L = s.look || DEFAULT_LOOK;
    const slide = (ctx, k, p) => drawSlide(ctx, imgs[k], k, p, s, cache);
    return (ctx, t, thumb = false) => {
      const k = Math.min(n - 1, Math.floor(t / seg));
      const local = t - k * seg;
      const p = local / seg;
      if (T && k > 0 && local < T) {
        const a = local / T, e = easeInOut(a);
        const pPrev = 1 + local / seg;
        if (s.trans === 'slide') {
          ctx.save(); ctx.translate(-s.W * e, 0); slide(ctx, k - 1, pPrev); ctx.restore();
          ctx.save(); ctx.translate(s.W * (1 - e), 0); slide(ctx, k, p); ctx.restore();
        } else if (s.trans === 'zoom') {
          slide(ctx, k - 1, pPrev);
          ctx.save();
          ctx.globalAlpha = e;
          const z = 1.15 - 0.15 * e;
          ctx.translate(s.W / 2, s.H / 2); ctx.scale(z, z); ctx.translate(-s.W / 2, -s.H / 2);
          slide(ctx, k, p);
          ctx.restore();
        } else {
          // fade the new slide in over the previous one
          slide(ctx, k, p);
          ctx.save();
          ctx.globalAlpha = 1 - a;
          slide(ctx, k - 1, pPrev);
          ctx.restore();
        }
      } else slide(ctx, k, p);
      if (L.bars) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, s.W, barH(s));
        ctx.fillRect(0, s.H - barH(s), s.W, barH(s));
      }
      drawTitle(ctx, s, thumb ? 1 : Math.min(1, t / 0.6));
      if (s.progress) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(0, s.H - 10, s.W, 10);
        ctx.fillStyle = '#fe2c55';
        ctx.fillRect(0, s.H - 10, s.W * (t / s.duration), 10);
      }
    };
  }

  async function ensureFonts() {
    const specs = new Set([...IV_TEMPLATES.map((t) => fontOf({ ...DEFAULT_LOOK, ...t.style }, 40)), fontOf(look, 40)]);
    try { await Promise.all([...specs].map((f) => document.fonts.load(f, 'AaĂâđỔẶ' + $('ivTitle').value))); } catch (_) {}
  }

  function scene() {
    const s = settings();
    return { width: s.W, height: s.H, fps: s.fps, duration: s.duration, draw: makeDraw(s), audio, audioOffset: s.start };
  }

  function preview() {
    if (player.playing) return;
    const sc = scene();
    canvas.width = sc.width;
    canvas.height = sc.height;
    if (images.length) sc.draw(canvas.getContext('2d'), Math.min(0.01, sc.duration), true); // still frame: title fully visible
    else {
      // no photos yet: show the chosen template on a sample photo
      const s = settings();
      makeDraw({ ...s, duration: 4, title: s.title || 'Tiêu đề của bạn' }, [Templates.samplePhoto()], thumbCache)(canvas.getContext('2d'), 1, true);
    }
    if (rw) rw.refresh();
    if (!audio && images.length) $('ivAudioInfo').textContent = '🔇 Chưa có nhạc — video sẽ không có tiếng.';
    else if (!audio) $('ivAudioInfo').textContent = '';
  }

  function renderThumbs() {
    const box = $('ivThumbs');
    box.innerHTML = '';
    images.forEach((im, i) => {
      const d = document.createElement('div');
      d.className = 't';
      d.style.backgroundImage = `url('${im.url}')`;
      const x = document.createElement('button');
      x.textContent = '×';
      x.title = 'Bỏ ảnh';
      x.onclick = () => { images.splice(i, 1); prepCache.clear(); thumbCache.clear(); renderThumbs(); preview(); picker.refresh(); };
      d.appendChild(x);
      box.appendChild(d);
    });
  }

  onFiles('ivImages', async (files) => {
    for (const f of files) {
      try { images.push(await readImage(f)); } catch (e) { toast(`${f.name}: ${e.message}`); }
    }
    renderThumbs();
    preview();
    picker.refresh(); // thumbnails now show the first photo
  });

  onFiles('ivAudio', async ([f]) => {
    $('ivAudioInfo').textContent = 'Đang đọc audio…';
    try {
      audio = await decodeAudioFile(f);
      audioName = baseName(f.name);
      $('ivAudioInfo').textContent = `🎵 ${f.name} — ${formatTime(audio.duration)}`;
      trim.setAudio(audio);
      preview();
    } catch (e) {
      audio = null;
      trim.setAudio(null);
      $('ivAudioInfo').textContent = e.message;
    }
  });

  const previewSoon = oncePerFrame(preview);
  ['ivSize', 'ivFit', 'ivBg', 'ivFx', 'ivTrans', 'ivFilter', 'ivTitle', 'ivProgress', 'ivStart', 'ivDur', 'ivFps'].forEach((id) =>
    $(id).addEventListener('input', previewSoon)
  );
  $('ivTitle').addEventListener('change', () => ensureFonts().then(preview));

  $('ivPlay').onclick = async () => {
    if (player.playing) { player.stop(); $('ivPlay').textContent = '▶ Xem thử'; preview(); return; }
    if (!images.length) return toast('Hãy chọn ít nhất 1 ảnh');
    trim.stop();
    audioCtx().resume(); // inside the tap, before any await (iOS)
    await ensureFonts();
    const sc = scene();
    canvas.width = sc.width; canvas.height = sc.height;
    $('ivPlay').textContent = '■ Dừng';
    player.play(sc, (t) => { if (t < 0) $('ivPlay').textContent = '▶ Xem thử'; });
  };

  rw = wireRender({
    btn: $('ivRender'),
    peek: () => {
      if (!images.length) return null;
      const s = settings();
      return { width: s.W, height: s.H, fps: s.fps, duration: s.duration, audio: !!audio };
    },
    prog: $('ivProg'),
    out: $('ivOut'),
    fileName: () => (audioName || 'slideshow') + '-video',
    buildScene: async () => {
      if (!images.length) throw new Error('Hãy chọn ít nhất 1 ảnh');
      const bad = audio && Core.checkStart($('ivStart').value, audio.duration);
      if (bad) throw new Error(bad);
      player.stop();
      $('ivPlay').textContent = '▶ Xem thử';
      await ensureFonts();
      return scene();
    },
  });

  /* template picker: thumbnails use the first chosen photo, or a built-in sample photo */
  const picker = Templates.mount({
    box: $('ivTemplates'),
    key: 'iv',
    builtins: IV_TEMPLATES,
    thumb: (t, ctx, W, H) => {
      const cur = settings(), set = t.set || {};
      const s = {
        ...cur, W, H, duration: 4, progress: false,
        fit: set.ivFit || cur.fit, bg: set.ivBg || cur.bg, fx: set.ivFx || cur.fx, trans: set.ivTrans || cur.trans, filter: set.ivFilter || cur.filter,
        title: cur.title || t.name, look: { ...DEFAULT_LOOK, ...t.style },
      };
      s.look.size *= 1.5; // legible at thumbnail size
      makeDraw(s, [images[0] || Templates.samplePhoto()], thumbCache)(ctx, 1, true);
    },
    apply: (t) => { look = { ...DEFAULT_LOOK, ...t.style }; ensureFonts().then(preview); preview(); },
    controls: ['ivFit', 'ivBg', 'ivFx', 'ivTrans', 'ivFilter', 'ivProgress', 'ivSize', 'ivFps'],
    captureStyle: () => ({ ...look }),
  });

  window.addEventListener('tabshown', (e) => e.detail === 'imgvideo' && preview());
  preview();
  ensureFonts().then(() => { preview(); picker.refresh(); });
})();
