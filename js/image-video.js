/* Image(s) + audio → video (slideshow, Ken Burns, blurred background) */
(() => {
  const images = []; // {img, w, h, url, blur}
  let audio = null, audioName = '';
  const canvas = $('ivCanvas');
  const player = new VideoEngine.Player(canvas);

  function settings() {
    const size = getSize($('ivSize'));
    const start = Math.max(0, +$('ivStart').value || 0);
    const duration = Core.clipDuration({ start, dur: $('ivDur').value, audioDur: audio ? audio.duration : 0, fallback: Math.max(1, images.length) * 4 });
    return {
      W: size.w, H: size.h, start, duration,
      fps: +$('ivFps').value,
      fit: $('ivFit').value, bg: $('ivBg').value,
      fx: $('ivFx').value, trans: $('ivTrans').value,
      progress: $('ivProgress').checked,
    };
  }

  /*
   * Per-image work done ONCE instead of every frame (big photos are 12 MP: scaling them 30×/s made export slow):
   *  - bg:   the blurred / coloured background already at W×H (per-frame cost = one 1:1 copy)
   *  - main: the photo pre-scaled to its on-screen size × 1.1 (room for the Ken Burns zoom)
   * Only the slides currently visible are kept (a 1080×1920 canvas is ~8 MB; phones have little memory).
   */
  const prepCache = new Map();
  function prepared(im, k, s) {
    const key = [k, s.W, s.H, s.fit, s.bg, im.url].join('|');
    let e = prepCache.get(k);
    if (e && e.key === key) return e;
    if (e) { e.bg.width = e.bg.height = 0; if (e.main !== im.img) e.main.width = e.main.height = 0; }
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
    }
    const fitScale = (s.fit === 'cover' ? Math.max(W / im.w, H / im.h) : Math.min(W / im.w, H / im.h)) * 1.1;
    let main = im.img;
    if (fitScale < 0.9) {
      main = makeCanvas(im.w * fitScale, im.h * fitScale);
      const m = main.getContext('2d');
      m.imageSmoothingQuality = 'high';
      m.drawImage(im.img, 0, 0, main.width, main.height);
    }
    e = { key, bg, main, mw: main.width || im.w, mh: main.height || im.h };
    prepCache.set(k, e);
    // keep only this slide and its neighbours
    for (const [kk, v] of prepCache) {
      if (Math.abs(kk - k) > 1) { v.bg.width = v.bg.height = 0; if (v.main !== images[kk]?.img && v.main.width) v.main.width = v.main.height = 0; prepCache.delete(kk); }
    }
    return e;
  }

  function drawSlide(ctx, im, k, p, s) {
    const { W, H } = s;
    if (!im) { ctx.fillStyle = s.bg; ctx.fillRect(0, 0, W, H); return; }
    const e = prepared(im, k, s);
    ctx.drawImage(e.bg, 0, 0);
    const zoom = s.fx === 'kenburns' ? 1 + 0.1 * p : 1;
    // alternate pan direction per slide
    const ox = s.fx === 'kenburns' ? (k % 2 ? 0.5 - 0.15 * p : 0.5 + 0.15 * p) : 0.5;
    if (s.fit === 'cover') drawImageFit(ctx, e.main, e.mw, e.mh, 0, 0, W, H, 'cover', zoom, Math.min(1, Math.max(0, ox)), 0.5);
    else drawImageFit(ctx, e.main, e.mw, e.mh, 0, 0, W, H, 'contain', zoom);
  }

  function makeDraw(s) {
    const n = Math.max(1, images.length);
    const seg = s.duration / n;
    const fadeT = s.trans === 'fade' ? Math.min(0.7, seg / 3) : 0;
    return (ctx, t) => {
      const k = Math.min(n - 1, Math.floor(t / seg));
      const p = (t - k * seg) / seg;
      drawSlide(ctx, images[k], k, p, s);
      if (fadeT && k > 0 && t - k * seg < fadeT) {
        // fade the new slide in over the previous one
        const a = (t - k * seg) / fadeT;
        ctx.save();
        ctx.globalAlpha = 1 - a;
        drawSlide(ctx, images[k - 1], k - 1, 1 + (t - k * seg) / seg, s);
        ctx.restore();
      }
      if (s.progress) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(0, s.H - 10, s.W, 10);
        ctx.fillStyle = '#fe2c55';
        ctx.fillRect(0, s.H - 10, s.W * (t / s.duration), 10);
      }
    };
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
    sc.draw(canvas.getContext('2d'), Math.min(0.01, sc.duration));
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
      x.onclick = () => { images.splice(i, 1); prepCache.clear(); renderThumbs(); preview(); };
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
  });

  onFiles('ivAudio', async ([f]) => {
    $('ivAudioInfo').textContent = 'Đang đọc audio…';
    try {
      audio = await decodeAudioFile(f);
      audioName = baseName(f.name);
      $('ivAudioInfo').textContent = `🎵 ${f.name} — ${formatTime(audio.duration)}`;
      preview();
    } catch (e) {
      audio = null;
      $('ivAudioInfo').textContent = e.message;
    }
  });

  ['ivSize', 'ivFit', 'ivBg', 'ivFx', 'ivTrans', 'ivProgress', 'ivStart', 'ivDur', 'ivFps'].forEach((id) =>
    $(id).addEventListener('input', preview)
  );

  $('ivPlay').onclick = () => {
    if (player.playing) { player.stop(); $('ivPlay').textContent = '▶ Xem thử'; preview(); return; }
    if (!images.length) return toast('Hãy chọn ít nhất 1 ảnh');
    const sc = scene();
    canvas.width = sc.width; canvas.height = sc.height;
    $('ivPlay').textContent = '■ Dừng';
    player.play(sc, (t) => { if (t < 0) $('ivPlay').textContent = '▶ Xem thử'; });
  };

  wireRender({
    btn: $('ivRender'),
    prog: $('ivProg'),
    out: $('ivOut'),
    fileName: () => (audioName || 'slideshow') + '-video',
    buildScene: () => {
      if (!images.length) throw new Error('Hãy chọn ít nhất 1 ảnh');
      const bad = audio && Core.checkStart($('ivStart').value, audio.duration);
      if (bad) throw new Error(bad);
      player.stop();
      $('ivPlay').textContent = '▶ Xem thử';
      return scene();
    },
  });

  window.addEventListener('tabshown', (e) => e.detail === 'imgvideo' && preview());
  preview();
})();
