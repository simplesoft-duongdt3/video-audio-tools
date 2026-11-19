/* Text (TikTok-style templates) + audio → video / images */
(() => {
  const TIKTOK_RED = '#fe2c55', TIKTOK_CYAN = '#25f4ee';

  const linear = (ctx, W, H, stops, angle = 160) => {
    const r = (angle * Math.PI) / 180;
    const dx = Math.cos(r) * W / 2, dy = Math.sin(r) * H / 2;
    const g = ctx.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  const solid = (ctx, W, H, c) => { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); };

  const TEMPLATES = [
    {
      id: 'classic', name: 'Classic',
      bg: (c, W, H) => linear(c, W, H, ['#0f0c29', '#302b63', '#24243e']),
      font: 'Be Vietnam Pro', weight: 800, color: '#fff', stroke: { color: '#000', w: 0.14 }, lineHeight: 1.25,
    },
    {
      id: 'caption', name: 'Caption box',
      bg: (c, W, H) => linear(c, W, H, ['#ff9a8b', '#ff6a88', '#ff99ac'], 120),
      font: 'Be Vietnam Pro', weight: 800, color: '#111', box: { fill: '#fff', pad: 0.32, radius: 0.22 }, lineHeight: 1.42,
    },
    {
      id: 'tiktok', name: 'TikTok',
      bg: (c, W, H) => solid(c, W, H, '#010101'),
      font: 'Montserrat', weight: 900, color: '#fff', glitch: true, lineHeight: 1.2, upper: true,
    },
    {
      id: 'neon', name: 'Neon',
      bg: (c, W, H) => {
        solid(c, W, H, '#05040f');
        const g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
        g.addColorStop(0, 'rgba(120,40,200,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      },
      font: 'Montserrat', weight: 900, color: '#fff', shadow: { color: '#0ff', blur: 0.45 }, lineHeight: 1.25,
    },
    {
      id: 'quote', name: 'Quote',
      bg: (c, W, H) => solid(c, W, H, '#f4eee4'),
      font: 'Playfair Display', weight: 700, italic: true, color: '#2b2b2b', align: 'left', lineHeight: 1.3, quote: '#c9a27a', handleColor: '#7a6a58',
    },
    {
      id: 'bold', name: 'Bold vàng',
      bg: (c, W, H) => solid(c, W, H, '#ffd400'),
      font: 'Montserrat', weight: 900, color: '#111', upper: true, lineHeight: 1.15, handleColor: '#111',
    },
    {
      id: 'sunset', name: 'Sunset',
      bg: (c, W, H) => linear(c, W, H, ['#f12711', '#f5af19'], 200),
      font: 'Be Vietnam Pro', weight: 800, color: '#fff', shadow: { color: 'rgba(0,0,0,0.45)', blur: 0.2, y: 0.06 }, lineHeight: 1.25,
    },
    {
      id: 'ocean', name: 'Ocean',
      bg: (c, W, H) => linear(c, W, H, ['#0f2027', '#203a43', '#2c5364']),
      font: 'Be Vietnam Pro', weight: 700, color: '#fff', box: { fill: 'rgba(0,0,0,0.55)', pad: 0.3, radius: 0.15 }, lineHeight: 1.45,
    },
    {
      id: 'note', name: 'Ghi chú',
      bg: (c, W, H) => {
        solid(c, W, H, '#fffdf3');
        c.strokeStyle = 'rgba(70,130,200,0.25)'; c.lineWidth = Math.max(1, W / 540);
        for (let y = H * 0.08; y < H; y += H * 0.045) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
        c.strokeStyle = 'rgba(230,60,60,0.55)'; c.beginPath(); c.moveTo(W * 0.1, 0); c.lineTo(W * 0.1, H); c.stroke();
      },
      font: 'Be Vietnam Pro', weight: 600, color: '#1d2433', align: 'left', lineHeight: 1.35, handleColor: '#555',
    },
    {
      id: 'mono', name: 'Hacker',
      bg: (c, W, H) => solid(c, W, H, '#0b1410'),
      font: 'Roboto Mono', weight: 700, color: '#39ff88', align: 'left', shadow: { color: 'rgba(57,255,136,0.6)', blur: 0.25 }, lineHeight: 1.35, cursor: true,
    },
  ];

  let tpl = TEMPLATES[0];
  let audio = null, audioName = '', audioFile = '';

  function updateAudioInfo() {
    const box = $('tvAudioInfo');
    box.textContent = '';
    if (!audio) return;
    const { n, seg, duration } = timing();
    const span = document.createElement('span');
    let txt = `🎵 ${audioFile} — ${formatTime(audio.duration)} · ${n} slide × ${seg.toFixed(1)}s `;
    if (n * seg > audio.duration + 0.05) txt += `(⚠️ audio ngắn hơn, video dừng ở ${formatTime(duration)}) `;
    span.textContent = txt;
    const x = document.createElement('button');
    x.textContent = 'Bỏ audio';
    x.onclick = () => { audio = null; audioName = ''; updateAudioInfo(); };
    box.append(span, x);
  }
  let bgImage = null;
  const canvas = $('tvCanvas');
  const player = new VideoEngine.Player(canvas);
  let rw = null; // export button (estimate line)
  const layoutCache = new Map();

  /* ---------------- layout ---------------- */
  const { graphemes, wrap, colorsFor } = Core;

  function opts() {
    return {
      font: $('tvFont').value,
      maxSize: Math.max(20, +$('tvSize').value || 96),
      align: $('tvAlign').value,
      anim: $('tvAnim').value,
      bgMode: $('tvBgMode').value,
      bgColor: $('tvBgColor').value,
      handle: $('tvHandle').value.trim(),
      progress: $('tvProgress').checked,
    };
  }

  function fontStr(t, o, fs) {
    return `${t.italic ? 'italic ' : ''}${t.weight} ${fs}px "${o.font || t.font}", "Be Vietnam Pro", sans-serif`;
  }

  function layout(ctx, text, t, o, W, H) {
    const key = [text, W, H, t.id, o.font, o.maxSize].join('|');
    if (layoutCache.has(key)) return layoutCache.get(key);
    const str = t.upper ? text.toUpperCase() : text;
    const maxW = W * (t.box ? 0.76 : 0.82);
    const maxH = H * (W > H ? 0.7 : 0.6);
    const base = o.maxSize * Math.min(W, H) / 1080;
    const minFs = Math.max(14, base * 0.45); // below this, break long words instead of shrinking further
    let fs = base;
    let lines, asc, desc, lh;
    ctx.save();
    ctx.textBaseline = 'middle';
    for (;;) {
      ctx.font = fontStr(t, o, fs);
      // Real glyph extents incl. stacked Vietnamese accents (Ổ, Ặ) and descenders.
      const m = ctx.measureText('ỔẶỸÁgjpyạ');
      asc = m.actualBoundingBoxAscent || fs * 0.7;
      desc = m.actualBoundingBoxDescent || fs * 0.4;
      const pad = t.box ? fs * t.box.pad * 0.5 : 0;
      lh = Math.max(fs * t.lineHeight, (asc + desc) * 1.06 + pad * 2);
      const atMin = fs <= minFs;
      lines = wrap(ctx, str, maxW, atMin);
      const fits = lines.length * lh <= maxH && lines.every((l) => ctx.measureText(l).width <= maxW);
      if (fits || atMin) break;
      fs = Math.max(minFs, fs * 0.94);
    }
    const L = { lines, fs, lh, asc, desc, maxW, widths: lines.map((l) => ctx.measureText(l).width) };
    ctx.restore();
    if (layoutCache.size > 300) layoutCache.clear();
    layoutCache.set(key, L);
    return L;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------- drawing ---------------- */
  function drawBackground(ctx, W, H, t, o, bg) {
    if (o.bgMode === 'color') solid(ctx, W, H, o.bgColor);
    else if (o.bgMode === 'image' && bg) {
      solid(ctx, W, H, '#000');
      drawImageFit(ctx, bg.img, bg.w, bg.h, 0, 0, W, H, 'cover');
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.fillRect(0, 0, W, H);
    } else t.bg(ctx, W, H);
  }

  const easeOutBack = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);

  /**
   * Draw one slide. `a` = animation progress 0..1 (1 = fully shown).
   * `blink` toggles the cursor of the "Hacker" template.
   * `t` / `bg` are passed explicitly so a running render is not affected by UI changes.
   */
  function drawSlide(ctx, W, H, text, o, a = 1, blink = true, t = tpl, bg = bgImage) {
    drawBackground(ctx, W, H, t, o, bg);
    const col = colorsFor(t, o);
    const L = layout(ctx, text, t, o, W, H);
    const { lines, fs, lh } = L;
    const align = o.align || t.align || 'center';
    const blockH = lines.length * lh;
    const y0 = H * 0.48 - blockH / 2 + lh / 2;
    const left = (W - L.maxW) / 2;
    const u = Math.min(W, H) / 1080;
    // Optical centre between the real top of accents and the bottom of descenders.
    const yShift = (L.asc - L.desc) / 2;

    // reveal (type / word), counted in graphemes so emoji & accents never split
    const gLines = o.anim === 'type' ? lines.map(graphemes) : null;
    let charsLeft = gLines ? Math.floor(a * gLines.reduce((s, g) => s + g.length, 0)) : Infinity;
    let wordsLeft = o.anim === 'word' ? Math.ceil(a * lines.reduce((s, l) => s + l.split(' ').filter(Boolean).length, 0)) : Infinity;

    ctx.save();
    const e = Math.min(1, a);
    if (o.anim === 'pop') {
      const s = 0.6 + 0.4 * easeOutBack(e);
      ctx.globalAlpha = Math.min(1, e * 2);
      ctx.translate(W / 2, H * 0.48); ctx.scale(s, s); ctx.translate(-W / 2, -H * 0.48);
    } else if (o.anim === 'fade') {
      ctx.globalAlpha = easeOut(e);
    } else if (o.anim === 'slide') {
      ctx.globalAlpha = easeOut(e);
      ctx.translate(0, 120 * u * (1 - easeOut(e)));
    }

    if (t.quote && o.bgMode === 'tpl') {
      ctx.fillStyle = t.quote;
      ctx.font = `700 ${fs * 3}px "Playfair Display", serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const qx = align === 'left' ? left - fs * 0.2 : W / 2 - fs * 0.6;
      ctx.fillText('“', qx, y0 - lh * 0.4);
    }

    ctx.font = fontStr(t, o, fs);
    ctx.textBaseline = 'middle';
    // Always draw left-aligned from the line's FINAL position, so typing never makes centred text jump.
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    let lastX = align === 'left' ? left : W / 2, lastY = y0 + yShift;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (gLines) {
        line = gLines[i].slice(0, Math.max(0, charsLeft)).join('');
        charsLeft -= gLines[i].length;
      }
      if (wordsLeft !== Infinity) {
        const ws = line.split(' ').filter(Boolean);
        line = ws.slice(0, Math.max(0, wordsLeft)).join(' ');
        wordsLeft -= ws.length;
      }
      const yMid = y0 + i * lh;
      const y = yMid + yShift;
      const x = align === 'left' ? left : W / 2 - L.widths[i] / 2;
      if (!line) continue;
      const w = ctx.measureText(line).width;

      if (t.box) {
        const pad = fs * t.box.pad;
        const top = y - L.asc - pad * 0.5;
        const hgt = L.asc + L.desc + pad;
        ctx.fillStyle = t.box.fill;
        roundRect(ctx, x - pad, top, w + pad * 2, hgt, Math.min(hgt / 2, fs * t.box.radius));
        ctx.fill();
      }
      if (t.glitch) {
        const d = fs * 0.05;
        ctx.fillStyle = TIKTOK_CYAN; ctx.fillText(line, x - d, y - d * 0.5);
        ctx.fillStyle = TIKTOK_RED; ctx.fillText(line, x + d, y + d * 0.5);
      }
      if (t.shadow) {
        ctx.shadowColor = t.shadow.color;
        ctx.shadowBlur = fs * t.shadow.blur;
        ctx.shadowOffsetY = fs * (t.shadow.y || 0);
      }
      if (col.stroke) {
        ctx.strokeStyle = col.stroke.color;
        ctx.lineWidth = fs * col.stroke.w;
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = col.text;
      ctx.fillText(line, x, y);
      if (t.shadow && t.shadow.blur > 0.3) ctx.fillText(line, x, y); // stronger glow
      ctx.shadowColor = 'transparent';
      lastX = x + w;
      lastY = y;
    }
    if (t.cursor && blink) {
      ctx.fillStyle = col.text;
      ctx.fillRect(lastX + fs * 0.1, lastY - fs * 0.45, fs * 0.5, fs * 0.9);
    }
    ctx.restore();

    if (o.handle) {
      ctx.save();
      ctx.font = `600 ${Math.round(38 * u)}px "Be Vietnam Pro", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = col.handle;
      ctx.fillText(o.handle, W / 2, H - (W > H ? 80 : 180) * u);
      ctx.restore();
    }
  }

  /* ---------------- timing ---------------- */
  function slides() {
    return Core.splitSlides($('tvText').value);
  }

  function timing() {
    const sl = slides();
    const { n, seg, duration } = Core.slideTiming(sl.length, +$('tvSlideDur').value || 0, audio ? audio.duration : 0);
    return { sl, n, seg, duration };
  }

  function makeScene() {
    const size = getSize($('tvSizeSel'));
    const o = opts();
    const { sl, n, seg, duration } = timing();
    const W = size.w, H = size.h;
    const t = tpl, bg = bgImage; // snapshot: UI changes during a render must not leak into it
    const bar = Math.max(6, Math.round(10 * Math.min(W, H) / 1080));
    let still = null;
    const draw = (ctx, time) => {
      const k = Math.min(n - 1, Math.floor(time / seg));
      const local = time - k * seg;
      let a = 1;
      if (o.anim === 'type' || o.anim === 'word') a = Math.min(1, local / Math.max(0.3, seg * 0.6));
      else if (o.anim !== 'none') a = Math.min(1, local / Math.min(0.55, seg / 2));
      const blink = Math.floor(time * 2) % 2 === 0;
      if (a >= 1) {
        // Slide fully shown: it no longer changes (except the Hacker cursor blink) → draw once, then copy.
        const key = k + '|' + (t.cursor ? blink : '');
        if (!still || still.key !== key) {
          if (!still) still = { c: makeCanvas(W, H) };
          drawSlide(still.c.getContext('2d'), W, H, sl[k] || '', o, 1, blink, t, bg);
          still.key = key;
        }
        ctx.drawImage(still.c, 0, 0);
      } else drawSlide(ctx, W, H, sl[k] || '', o, a, blink, t, bg);
      if (o.progress) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(0, H - bar, W, bar);
        ctx.fillStyle = TIKTOK_RED;
        ctx.fillRect(0, H - bar, W * (time / duration), bar);
      }
    };
    return { width: W, height: H, fps: +$('tvFps').value, duration, draw, audio, audioOffset: 0 };
  }

  /* ---------------- fonts ---------------- */
  async function ensureFonts() {
    // Load exactly the faces the canvas will ask for (each template × each font choice), plus handle & quote mark.
    const fams = ['', 'Be Vietnam Pro', 'Montserrat', 'Playfair Display', 'Lobster', 'Roboto Mono'];
    const specs = new Set(['600 40px "Be Vietnam Pro"', '700 40px "Playfair Display"']);
    for (const t of TEMPLATES) for (const f of fams) specs.add(fontStr(t, { font: f }, 40));
    const sample = 'AaĂâđêôơưỔẶ' + $('tvText').value.slice(0, 200);
    try {
      await Promise.all([...specs].map((sp) => document.fonts.load(sp, sample)));
    } catch (_) {}
    layoutCache.clear();
  }

  /* ---------------- preview ---------------- */
  function currentSlide() {
    const sl = slides();
    $('tvScrub').max = Math.max(0, sl.length - 1);
    const k = Math.min(sl.length - 1, +$('tvScrub').value);
    return { text: sl[Math.max(0, k)] || '', k };
  }

  function preview() {
    if (player.playing) return;
    const size = getSize($('tvSizeSel'));
    canvas.width = size.w;
    canvas.height = size.h;
    drawSlide(canvas.getContext('2d'), size.w, size.h, currentSlide().text, opts(), 1);
  }

  function renderTemplatePicker() {
    const box = $('tvTemplates');
    box.innerHTML = '';
    const o = { ...opts(), font: '', align: '', handle: '', bgMode: 'tpl', maxSize: 150 };
    for (const t of TEMPLATES) {
      const b = document.createElement('button');
      b.className = t === tpl ? 'active' : '';
      b.title = t.name;
      const c = makeCanvas(180, 320);
      const ctx = c.getContext('2d');
      ctx.setTransform(1 / 3, 0, 0, 1 / 3, 0, 0); // draw at 540×960, shown at 180×320
      drawSlide(ctx, 540, 960, 'Xin chào\nTikTok', o, 1, true, t, null);
      b.appendChild(c);
      const s = document.createElement('span');
      s.textContent = t.name;
      b.appendChild(s);
      b.onclick = () => {
        tpl = t;
        box.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        preview();
      };
      box.appendChild(b);
    }
  }

  /* ---------------- events ---------------- */
  ['tvText', 'tvFont', 'tvSize', 'tvAlign', 'tvBgColor', 'tvHandle', 'tvSizeSel', 'tvProgress', 'tvScrub'].forEach((id) =>
    $(id).addEventListener('input', preview)
  );
  $('tvText').addEventListener('change', () => ensureFonts().then(preview));
  ['tvText', 'tvSlideDur'].forEach((id) => $(id).addEventListener('input', updateAudioInfo));
  $('tvBgMode').onchange = () => {
    $('tvBgImgWrap').hidden = $('tvBgMode').value !== 'image';
    preview();
  };
  onFiles('tvBgImg', async ([f]) => {
    try { bgImage = await readImage(f); preview(); } catch (e) { toast(e.message); }
  });
  onFiles('tvAudio', async ([f]) => {
    $('tvAudioInfo').textContent = 'Đang đọc audio…';
    try {
      audio = await decodeAudioFile(f);
      audioName = baseName(f.name);
      audioFile = f.name;
      updateAudioInfo();
      if (rw) rw.refresh();
    } catch (e) {
      audio = null;
      $('tvAudioInfo').textContent = e.message;
    }
  });

  $('tvPlay').onclick = async () => {
    if (player.playing) { player.stop(); $('tvPlay').textContent = '▶ Xem thử'; preview(); return; }
    audioCtx().resume(); // inside the tap, before any await (iOS)
    await ensureFonts();
    const sc = makeScene();
    canvas.width = sc.width; canvas.height = sc.height;
    $('tvPlay').textContent = '■ Dừng';
    player.play(sc, (t) => { if (t < 0) { $('tvPlay').textContent = '▶ Xem thử'; preview(); } });
  };

  async function slideBlob(text) {
    const size = getSize($('tvSizeSel'));
    const c = makeCanvas(size.w, size.h);
    drawSlide(c.getContext('2d'), size.w, size.h, text, opts(), 1);
    return canvasToBlob(c, 'image/png');
  }

  $('tvPng').onclick = async () => {
    await ensureFonts();
    const { text, k } = currentSlide();
    const blob = await slideBlob(text);
    const name = `slide-${k + 1}.png`;
    $('tvOut').innerHTML = '';
    resultCard($('tvOut'), { blob, name });
    download(blob, name);
  };

  $('tvZip').onclick = async () => {
    await ensureFonts();
    const items = [];
    const sl = slides();
    for (let i = 0; i < sl.length; i++) items.push({ blob: await slideBlob(sl[i]), name: `slide-${String(i + 1).padStart(2, '0')}.png` });
    await zipAndDownload(items, 'text-slides.zip');
  };

  rw = wireRender({
    btn: $('tvRender'),
    peek: () => {
      if (!slides().length) return null;
      const size = getSize($('tvSizeSel'));
      return { width: size.w, height: size.h, fps: +$('tvFps').value, duration: timing().duration, audio: !!audio };
    },
    prog: $('tvProg'),
    out: $('tvOut'),
    fileName: () => (audioName || 'text') + '-tiktok',
    buildScene: async () => {
      if (!slides().length) throw new Error('Hãy nhập nội dung');
      player.stop();
      $('tvPlay').textContent = '▶ Xem thử';
      await ensureFonts();
      return makeScene();
    },
  });

  window.addEventListener('tabshown', (e) => e.detail === 'textvideo' && preview());
  renderTemplatePicker();
  preview();
  ensureFonts().then(() => { renderTemplatePicker(); preview(); });
})();
