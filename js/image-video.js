/* Image(s) + audio → video (slideshow, Ken Burns, blurred background) */
(() => {
  const images = []; // {img, w, h, url, blur}
  let audio = null, audioName = '';
  const canvas = $('ivCanvas');
  const player = new VideoEngine.Player(canvas);

  /** Cheap, cross-browser blur (Safari has no ctx.filter): downscale then upscale. */
  function makeBlur(im, W, H) {
    const small = makeCanvas(Math.max(8, W / 24), Math.max(8, H / 24));
    const s = small.getContext('2d');
    drawImageFit(s, im.img, im.w, im.h, 0, 0, small.width, small.height, 'cover');
    const mid = makeCanvas(W / 6, H / 6);
    const m = mid.getContext('2d');
    m.imageSmoothingQuality = 'high';
    m.drawImage(small, 0, 0, mid.width, mid.height);
    m.fillStyle = 'rgba(0,0,0,0.35)';
    m.fillRect(0, 0, mid.width, mid.height);
    return mid;
  }

  function settings() {
    const size = getSize($('ivSize'));
    const start = Math.max(0, +$('ivStart').value || 0);
    let duration = Math.max(0, +$('ivDur').value || 0);
    if (!duration) duration = audio ? Math.max(0.5, audio.duration - start) : Math.max(1, images.length) * 4;
    if (audio) duration = Math.min(duration, Math.max(0.5, audio.duration - start));
    return {
      W: size.w, H: size.h, start, duration,
      fps: +$('ivFps').value,
      fit: $('ivFit').value, bg: $('ivBg').value,
      fx: $('ivFx').value, trans: $('ivTrans').value,
      progress: $('ivProgress').checked,
    };
  }

  function drawSlide(ctx, im, k, p, s) {
    const { W, H } = s;
    ctx.fillStyle = s.bg;
    ctx.fillRect(0, 0, W, H);
    if (!im) return;
    const zoom = s.fx === 'kenburns' ? 1 + 0.1 * p : 1;
    // alternate pan direction per slide
    const ox = s.fx === 'kenburns' ? (k % 2 ? 0.5 - 0.15 * p : 0.5 + 0.15 * p) : 0.5;
    if (s.fit === 'cover') {
      drawImageFit(ctx, im.img, im.w, im.h, 0, 0, W, H, 'cover', zoom, Math.min(1, Math.max(0, ox)), 0.5);
    } else {
      if (s.fit === 'blur') {
        if (!im.blur || im.blur._key !== W + 'x' + H) { im.blur = makeBlur(im, W, H); im.blur._key = W + 'x' + H; }
        ctx.imageSmoothingQuality = 'high';
        drawImageFit(ctx, im.blur, im.blur.width, im.blur.height, 0, 0, W, H, 'cover', 1.05);
      }
      drawImageFit(ctx, im.img, im.w, im.h, 0, 0, W, H, 'contain', zoom);
    }
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
      x.onclick = () => { images.splice(i, 1); renderThumbs(); preview(); };
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
      if (audio && (+$('ivStart').value || 0) >= audio.duration - 0.1) {
        throw new Error(`"Bắt đầu audio từ" phải nhỏ hơn độ dài bài (${audio.duration.toFixed(1)}s)`);
      }
      player.stop();
      $('ivPlay').textContent = '▶ Xem thử';
      return scene();
    },
  });

  window.addEventListener('tabshown', (e) => e.detail === 'imgvideo' && preview());
  preview();
})();
