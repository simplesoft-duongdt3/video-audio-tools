/* Audio file → MP4 with animated visualizer, title, cover art and time bar */
(() => {
  let audio = null, audioFile = '';
  let channels = null; // cached Float32Array per channel of `audio`
  let art = null; // {img, w, h, url}
  let blurCache = null;
  const canvas = $('avCanvas');
  const player = new VideoEngine.Player(canvas);
  let rw = null; // export button (estimate line)
  const trim = AudioTrim.mount({
    box: $('avTrim'), startId: 'avStart', durId: 'avDur',
    onAudio: (b) => {
      audio = b;
      channels = Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));
      $('avAudioInfo').textContent = `🎵 ${audioFile} — ${formatTime(b.duration)} · ${b.sampleRate} Hz · ${b.numberOfChannels} kênh`;
      preview();
    },
  });
  const FFT = 2048;

  /*
   * Envelope + beats of the chosen clip, computed ONCE per (song, start, length) — not on every keystroke
   * (QC: 113–296 ms lag per key on a 3-min song). The envelope starts 3.2 s early so "Tin nhắn thoại"
   * has a history from the first frame.
   */
  const HISTORY = 3.2;
  let beatCache = { key: null };
  function beatAnalysis(o) {
    const sr = audio.sampleRate, key = [audio.length, sr, o.start, o.duration].join('|');
    if (beatCache.key === key && beatCache.buf === audio) return beatCache;
    const a = Math.floor(o.start * sr), len = Math.max(1, Math.min(channels[0].length - a, Math.ceil(o.duration * sr)));
    const h0 = Math.max(0, a - Math.round(HISTORY * sr));
    beatCache = {
      key, buf: audio,
      env: Core.envelope(channels, sr, h0, a - h0 + len, 50), envOffset: (a - h0) / sr,
      onsets: Core.bassOnsets(channels, sr, a, len),
    };
    return beatCache;
  }

  /* ---------------- templates ---------------- */
  /** Look = what a template sets that has no control: fonts, text colour, background gradient, layout. */
  const DEFAULT_LOOK = { font: 'Be Vietnam Pro', weight: 800, italic: false, ink: '#ffffff', dim: 'rgba(255,255,255,0.28)', stops: ['#1b1036', '#07070c'], angle: 72, layout: 'cover', glow: true };
  // set: control values (the user can still change them) · look: what has no control.
  // Genre templates follow the research in the commit message (palettes / fonts / motion per genre, VN market).
  // every template sets every effect (off unless the template wants it), so switching templates is predictable
  const FX_OFF = { avDust: false, avDustShape: 'dot', avDustAmount: '90', avDustDir: 'drift', avDustReact: '0.6', avDustColor: 'ink', avPunch: false, avPunchAmt: '0.035', avPunchTarget: 'art', avPunchLen: 'auto', avRipple: false, avSway: false, avSwayAmt: '3', avBgMove: false, avColorFlow: false };
  const T = (id, name, cat, set, look) => ({ id, name, cat, set: { avBadge: '', ...FX_OFF, ...set }, style: look });
  const MUSIC = 'Âm nhạc', BOOK = 'Sách & Thơ', TALK = 'Podcast & Radio', CALM = 'Chữa lành & Thư giãn', LEARN = 'Học tập', STORY = 'Kể chuyện', FAITH = 'Tâm linh';
  const G = (avStyle, avColor1, avColor2, bg) => ({ avStyle, avColor1, avColor2, ...(bg.startsWith('#') ? { avBgMode: 'color', avBgColor: bg } : { avBgMode: 'gradient' }) });
  const AV_TEMPLATES = [
    // music
    T('neon', 'Neon', MUSIC, { ...G('bars', '#25f4ee', '#fe2c55', 'g'), avPunch: true }, {}),
    T('duongneon', 'Đường neon', MUSIC, { ...G('line', '#a3e635', '#22d3ee', 'g'), avPunch: true, avColorFlow: true }, { font: 'Montserrat', weight: 900, stops: ['#0a0f1f', '#020409'], angle: 180, layout: 'minimal' }),
    T('sannhay', 'Sàn nhảy', MUSIC, { ...G('led', '#22d3ee', '#e879f9', 'g'), avPunch: true, avPunchAmt: '0.06', avRipple: true, avDust: true, avDustShape: 'star', avDustDir: 'burst', avDustColor: 'mix', avDustReact: '1.4' }, { font: 'Montserrat', weight: 900, stops: ['#140b2e', '#000000'], angle: 180, layout: 'minimal' }),
    T('lofi', 'Lo-fi', MUSIC, { ...G('mirror', '#c084fc', '#f9a8d4', 'g'), avDust: true, avBgMove: true }, { stops: ['#2e1065', '#831843'], angle: 120 }),
    T('vinyl', 'Đĩa than', MUSIC, { ...G('vinyl', '#fde68a', '#f59e0b', 'g'), avDust: true, avDustShape: 'note', avDustDir: 'up', avDustAmount: '40', avDustColor: 'c1' }, { font: 'Playfair Display', weight: 700, italic: true, stops: ['#292524', '#0c0a09'] }),
    T('ocean', 'Biển xanh', MUSIC, G('wave', '#67e8f9', '#3b82f6', 'g'), { stops: ['#0c4a6e', '#082f49'], angle: 100, layout: 'minimal' }),
    T('sunset', 'Hoàng hôn', MUSIC, G('bars', '#fde047', '#fb7185', 'g'), { font: 'Playfair Display', weight: 700, italic: true, stops: ['#9a3412', '#4c0519'], angle: 90 }),
    T('karaoke', 'Karaoke', MUSIC, { ...G('overview', '#fe2c55', '#25f4ee', 'g'), avRipple: true, avPunch: true, avPunchTarget: 'text' }, { font: 'Montserrat', weight: 900, stops: ['#18181b', '#000000'], layout: 'minimal' }),
    T('hacker', 'Hacker', MUSIC, G('bars', '#39ff88', '#16a34a', '#0b1410'), { font: 'Roboto Mono', weight: 700, ink: '#39ff88', dim: 'rgba(57,255,136,0.22)', layout: 'top' }),
    // books & poetry
    T('sachnoi', 'Sách nói', BOOK, { ...G('overview', '#e9c46a', '#b08d57', 'g'), avBadge: 'Sách nói' }, { font: 'Lora', weight: 600, ink: '#f5ecd7', dim: 'rgba(245,236,215,0.22)', stops: ['#3b2a1e', '#1c140e'], angle: 160, glow: false, artShape: 'book', motion: 'calm', subHint: 'Chương 1 · Tên tác giả' }),
    T('tuduy', 'Bài học từ sách', BOOK, { ...G('overview', '#facc15', '#a3a3a3', '#111111'), avBadge: 'Bài học từ sách' }, { font: 'Montserrat', weight: 900, ink: '#ffffff', dim: 'rgba(255,255,255,0.2)', layout: 'minimal', glow: false, subHint: 'Bài học từ “Tên sách” · @kenh' }),
    T('doctho', 'Đọc thơ', BOOK, { ...G('wave', '#8b6b4a', '#b08d57', '#f3ead8'), avDust: true, avDustShape: 'petal', avDustDir: 'down', avDustAmount: '40', avDustReact: '0', avDustColor: 'c2' }, { font: 'Dancing Script', weight: 700, titleScale: 1.3, ink: '#3b2f2f', dim: 'rgba(59,47,47,0.18)', layout: 'minimal', glow: false, texture: 'paper', motion: 'calm', subHint: 'Thơ · Tên tác giả' }),
    // podcast & radio
    T('podcast', 'Podcast', TALK, G('capsules', '#fbbf24', '#f97316', 'g'), { font: 'Montserrat', weight: 900, stops: ['#111827', '#030712'], layout: 'top', subHint: 'Tập 1 · @kenh', glyph: '🎙' }),
    T('podsang', 'Podcast sáng', TALK, { ...G('capsules', '#dc2626', '#d97706', '#fff4e0'), avBadge: 'Podcast · Tập 12' }, { font: 'Montserrat', weight: 900, ink: '#1f1a17', dim: 'rgba(31,26,23,0.16)', layout: 'top', glow: false, artShape: 'rounded', subHint: 'Tập 12 · Khách mời: Tên', glyph: '🎙' }),
    T('radiodem', 'Radio đêm', TALK, { ...G('mirror', '#fcd34d', '#f59e0b', 'g'), avBadge: 'On air', avDust: true, avDustAmount: '40', avDustReact: '0' }, { font: 'Playfair Display', weight: 700, italic: true, ink: '#fdf6e3', dim: 'rgba(253,246,227,0.2)', stops: ['#14213d', '#05070f'], angle: 180, layout: 'top', badgeDot: true, motion: 'calm', subHint: 'Radio tâm sự · Đêm thứ 12', glyph: '📻' }),
    T('bantin', 'Bản tin', TALK, { ...G('bars', '#ef4444', '#ffffff', 'g'), avBadge: 'Bản tin' }, { font: 'Be Vietnam Pro', weight: 800, ink: '#ffffff', stops: ['#0b2a5b', '#061430'], angle: 180, layout: 'top', glow: false, badgeDot: true, subHint: 'Bản tin sáng · @kenh', glyph: '📰' }),
    T('quacau', 'Quả cầu', TALK, G('orb', '#60a5fa', '#c084fc', 'g'), { font: 'Montserrat', weight: 800, stops: ['#0f172a', '#020617'], angle: 180, subHint: 'Trò chuyện cùng @kenh', glyph: '🎙' }),
    T('paper', 'Tối giản sáng', TALK, G('overview', '#111111', '#555555', '#f4f1ea'), { ink: '#111111', dim: 'rgba(0,0,0,0.16)', glow: false, layout: 'minimal' }),
    // calm
    T('chualanh', 'Chữa lành', CALM, { ...G('layers', '#9d5c7a', '#6d5fa8', 'g'), avDust: true, avDustShape: 'petal', avDustDir: 'down', avDustAmount: '40', avDustReact: '0', avDustColor: 'c1', avColorFlow: true }, { font: 'Be Vietnam Pro', weight: 600, ink: '#3b3355', dim: 'rgba(59,51,85,0.18)', stops: ['#f8e1e7', '#e7e3f4'], angle: 160, layout: 'minimal', glow: false, texture: 'grain', motion: 'calm', subHint: 'Gửi bạn, người đang mệt · @kenh' }),
    T('ngungon', 'Ngủ ngon', CALM, { ...G('layers', '#a5b4fc', '#818cf8', 'g'), avDust: true, avDustShape: 'snow', avDustDir: 'down', avDustReact: '0', avBgMove: true }, { font: 'Be Vietnam Pro', weight: 600, ink: '#cbd5e1', dim: 'rgba(203,213,225,0.15)', stops: ['#1b2838', '#0a1220'], angle: 180, layout: 'minimal', motion: 'calm', subHint: 'Tiếng mưa · 60 phút' }),
    T('asmr', 'ASMR', CALM, { ...G('orb', '#f9a8d4', '#c4b5fd', 'g'), avDust: true, avDustShape: 'bubble', avDustDir: 'up', avDustAmount: '40', avDustReact: '0', avDustColor: 'c2' }, { font: 'Montserrat', weight: 700, ink: '#fff1f2', dim: 'rgba(255,241,242,0.2)', stops: ['#3a2233', '#140b12'], angle: 160, layout: 'minimal', motion: 'calm', subHint: 'Thì thầm · Tiếng gõ nhẹ' }),
    // learning
    T('lofihoc', 'Lofi học bài', LEARN, { ...G('mirror', '#fcd9b8', '#c9a7eb', 'g'), avDust: true, avBgMove: true }, { font: 'Roboto Mono', weight: 700, ink: '#fff4e6', dim: 'rgba(255,244,230,0.22)', stops: ['#3d2c4f', '#1f2a44'], angle: 150, artShape: 'rounded', texture: 'grain', motion: 'calm', subHint: 'Học cùng mình · 25 phút', glyph: '📚' }),
    T('tienganh', 'Học tiếng Anh', LEARN, { ...G('overview', '#facc15', '#38bdf8', '#0f172a'), avBadge: 'Bài 3' }, { font: 'Montserrat', weight: 900, ink: '#f8fafc', dim: 'rgba(248,250,252,0.18)', layout: 'top', glow: false, artShape: 'rounded', subHint: 'Bài 3 · Giao tiếp hằng ngày', glyph: '🔤' }),
    // stories
    T('truyenma', 'Truyện ma', STORY, { ...G('wave', '#dc2626', '#7f1d1d', 'g'), avBadge: 'Truyện ma' }, { font: 'Noto Serif', weight: 800, ink: '#e7e5e4', dim: 'rgba(220,38,38,0.2)', stops: ['#1c0606', '#000000'], angle: 180, layout: 'minimal', badgeColor: '#f87171', texture: 'grain+vignette', motion: 'calm', noPunch: true, subHint: 'Phần 1 · Kể bởi @kenh' }),
    T('bekechuyen', 'Bé nghe truyện', STORY, { ...G('led', '#ea580c', '#db2777', 'g'), avBadge: 'Bé nghe truyện', avDust: true, avDustShape: 'star', avDustDir: 'up', avDustAmount: '40', avDustColor: 'mix', avSway: true }, { font: 'Baloo 2', weight: 800, ink: '#3b2a7a', dim: 'rgba(59,42,122,0.18)', stops: ['#fff7d6', '#ffe1c7'], angle: 135, glow: false, artShape: 'rounded', subHint: 'Truyện cổ tích · Sọ Dừa', glyph: '🧸' }),
    // faith
    T('phatphap', 'Pháp thoại', FAITH, { ...G('overview', '#f5c26b', '#b45309', 'g'), avBadge: 'Pháp thoại', avDust: true, avDustShape: 'dot', avDustDir: 'up', avDustAmount: '40', avDustReact: '0', avDustColor: 'c1' }, { font: 'Noto Serif', weight: 600, ink: '#fbe9c6', dim: 'rgba(251,233,198,0.2)', stops: ['#4a2c12', '#1f1206'], angle: 180, artShape: 'circle', motion: 'calm', subHint: 'Pháp thoại · Tên giảng sư', glyph: '🪷' }),
  ];
  let look = { ...DEFAULT_LOOK };
  const fontOf = (L, px) => `${L.italic ? 'italic ' : ''}${L.weight} ${px}px "${L.font}", "Be Vietnam Pro", sans-serif`;

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
      sub: $('avSub').value.trim(), // the genre's suggestion is only a placeholder: never burned into the video
      badge: $('avBadge').value.trim(),
      fx: {
        dust: $('avDust').checked, shape: $('avDustShape').value, amount: +$('avDustAmount').value, dir: $('avDustDir').value,
        react: +$('avDustReact').value, color: $('avDustColor').value,
        punch: $('avPunch').checked, punchAmt: +$('avPunchAmt').value, punchTarget: $('avPunchTarget').value, punchLen: $('avPunchLen').value,
        ripple: $('avRipple').checked, sway: $('avSway').checked, swayAmt: +$('avSwayAmt').value,
        bgMove: $('avBgMove').checked, colorFlow: $('avColorFlow').checked,
      },
      style: $('avStyle').value,
      c1: $('avColor1').value, c2: $('avColor2').value,
      bgMode: $('avBgMode').value, bgColor: $('avBgColor').value,
      progress: $('avProgress').checked,
      look: readableLook(look, $('avBgMode').value),
    };
  }

  /**
   * A cover photo background is drawn blurred and darkened: dark-text templates (light pastel / paper ones)
   * would be unreadable on it, so text switches to the default light ink there.
   */
  function readableLook(L, bgMode) {
    if (bgMode !== 'image' || !art || Core.luminance(L.ink) > 0.4) return L;
    return { ...L, ink: DEFAULT_LOOK.ink, dim: DEFAULT_LOOK.dim, badgeColor: undefined };
  }

  /* ---------------- geometry ---------------- */
  const geometry = Core.avGeometry; // pure + unit-tested: zones never overlap at any frame size


  /* ---------------- analysis ---------------- */
  function makeAnalyzer(o) {
    const sr = audio ? audio.sampleRate : 48000;
    const win = new Float32Array(FFT);
    let prev = null, lastT = -1, prevWave = null, lastWaveT = -1;
    let overview = null;
    let B = null;
    const demoOnsets = Array.from({ length: 1200 }, (_, k) => ({ t: k * 0.5, s: 0.8 })); // preview without a song
    const ensure = () => { if (!B && channels) B = beatAnalysis(o); };
    const tau = (o.look || DEFAULT_LOOK).motion === 'calm' ? 0.35 : 0.15;
    return {
      /** loudness 0..1 at clip time t (whole-clip envelope: works for any t, e.g. a rolling history) */
      env(t) { if (!channels) return 0.45 + 0.35 * Math.sin(t * 2.3) * Math.sin(t * 0.7 + 1); ensure(); const x = t + B.envOffset; return x < 0 ? 0 : Core.envAt(B.env, x); },
      /** beat "punch" 0..1 and cumulative bass push — pure functions of t (preview = export, seekable) */
      punch(t, tt = tau) { if (!channels) return Core.punchAt(demoOnsets, t, tt); ensure(); return Core.punchAt(B.onsets, t, tt); },
      ripples(t) { if (!channels) return Core.ripples(demoOnsets, t); ensure(); return Core.ripples(B.onsets, t); },
      push(t) { if (!channels) return Core.bassPush(demoOnsets, t); ensure(); return Core.bassPush(B.onsets, t); },
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
        const calm = (o.look || DEFAULT_LOOK).motion === 'calm';
        let bands;
        if (calm) {
          // calm genres: bars glide both up AND down (EMA), never jump
          bands = new Float32Array(raw.length);
          for (let i = 0; i < raw.length; i++) bands[i] = prev && prev.length === raw.length && t - lastT < 0.25 ? prev[i] + 0.1 * (raw[i] * 0.75 - prev[i]) : raw[i] * 0.75; // ~0.3 s to settle
        } else bands = Core.smoothBars(prev, raw, t - lastT);
        prev = bands; lastT = t;
        let wave = win;
        if (calm) {
          // a stable line: start at a rising zero crossing (no sideways jitter) and blend with the last frame
          let z = 0;
          for (let i = 1; i < win.length / 2; i++) if (win[i - 1] < 0 && win[i] >= 0) { z = i; break; }
          const n = 256, step = Math.floor((win.length - z) / n), cur = new Float32Array(n);
          for (let i = 0; i < n; i++) cur[i] = win[z + i * step];
          if (prevWave && t - lastWaveT < 0.25) for (let i = 0; i < n; i++) cur[i] = prevWave[i] * 0.8 + cur[i] * 0.2;
          prevWave = cur; lastWaveT = t;
          wave = cur;
        }
        return { bands, wave, level: Math.min(1, Core.rms(win) * 3) };
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
      // a few sizes are kept (thumbnails + preview + export) so they don't keep evicting each other
      let bc = blurCache && blurCache.get(key);
      if (!bc) {
        if (!blurCache) blurCache = new Map();
        if (blurCache.size >= 3) blurCache.delete(blurCache.keys().next().value);
        bc = makeBlur(im.img, im.w, im.h, W, H, 0.5);
        blurCache.set(key, bc);
      }
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingQuality = 'high';
      drawImageFit(ctx, bc, bc.width, bc.height, 0, 0, W, H, 'cover', 1.05);
      return;
    }
    if (o.bgMode === 'color') {
      ctx.fillStyle = o.bgColor;
      ctx.fillRect(0, 0, W, H);
    } else {
      const L = o.look || DEFAULT_LOOK;
      const r = (L.angle * Math.PI) / 180, dx = Math.cos(r) * W / 2, dy = Math.sin(r) * H / 2;
      const lg = ctx.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
      L.stops.forEach((c, i) => lg.addColorStop(i / (L.stops.length - 1), c));
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, W, H);
    }
    if ((o.look || DEFAULT_LOOK).glow === false) return;
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

  /** Book cover box (2:3) centred in the art square. */
  const bookBox = (g) => ({ x: g.ax + g.A * 0.17, y: g.ay, w: g.A * 0.66, h: g.A });

  /** Spine shading on the left edge of a book cover. */
  function spine(ctx, b) {
    const sg = ctx.createLinearGradient(b.x, 0, b.x + b.w * 0.07, 0);
    sg.addColorStop(0, 'rgba(0,0,0,0.38)');
    sg.addColorStop(0.6, 'rgba(255,255,255,0.08)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(b.x, b.y, b.w * 0.07, b.h);
  }

  function drawArt(ctx, o, g, im, level, round) {
    const { ax, ay, A, u } = g;
    const cx = ax + A / 2, cy = ay + A / 2;
    const shape = round ? 'circle' : (o.look || DEFAULT_LOOK).artShape || 'square';
    ctx.save();
    if (im) {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 40 * u;
      ctx.shadowOffsetY = 14 * u;
      const b = shape === 'book' ? bookBox(g) : { x: ax, y: ay, w: A, h: A };
      if (shape === 'circle') { ctx.beginPath(); ctx.arc(cx, cy, A / 2, 0, Math.PI * 2); } else roundRect(ctx, b.x, b.y, b.w, b.h, shape === 'book' ? A * 0.012 : shape === 'rounded' ? A * 0.1 : A * 0.06);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();
      drawImageFit(ctx, im.img, im.w, im.h, b.x, b.y, b.w, b.h, 'cover');
      if (shape === 'book') spine(ctx, b);
    } else if (shape === 'book') {
      // no cover photo: a plain book with the two template colours
      const b = bookBox(g);
      const s = 1 + 0.015 * level;
      ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 30 * u;
      ctx.shadowOffsetY = 12 * u;
      const bg = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
      bg.addColorStop(0, o.c1);
      bg.addColorStop(1, o.c2);
      ctx.fillStyle = bg;
      roundRect(ctx, b.x, b.y, b.w, b.h, A * 0.012);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      spine(ctx, b);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(1, 2 * u);
      ctx.strokeRect(b.x + b.w * 0.14, b.y + b.h * 0.1, b.w * 0.74, b.h * 0.8);
      ctx.font = `${Math.round(A * 0.2)}px "Be Vietnam Pro", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('📖', b.x + b.w * 0.53, b.y + b.h * 0.5);
    } else {
      // no cover: a pulsing disc with a note (calm genres barely pulse)
      const s = 1 + ((o.look || DEFAULT_LOOK).motion === 'calm' ? 0.02 : 0.06) * level;
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
      ctx.fillText((o.look || DEFAULT_LOOK).glyph || '♪', 0, -A * 0.02); // spoken genres get their own symbol
    }
    ctx.restore();
  }

  function drawText(ctx, o, g) {
    const { u, tx, tw, align } = g;
    const x = align === 'center' ? tx + tw / 2 : tx;
    ctx.save();
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    const L = o.look || DEFAULT_LOOK;
    ctx.fillStyle = L.ink;
    const fs0 = Math.round(64 * u * (L.titleScale || 1)); // script fonts look small at the same size
    const title = o.title.normalize('NFC');
    // long titles (audiobook chapters) shrink first (down to 80 %), "…" only if they still don't fit in 2 lines
    let fs = fs0, lines;
    for (;;) {
      ctx.font = fontOf(L, fs);
      lines = Core.clampLines(ctx, title, tw, 2);
      if (!/…$/.test(lines[lines.length - 1] || '') || title.endsWith('…') || fs <= fs0 * 0.8) break;
      fs = Math.round(fs * 0.92);
    }
    let y = g.titleY;
    for (const l of lines) { ctx.fillText(l, x, y); y += fs * 1.22; }
    if (o.sub) {
      ctx.globalAlpha = 0.85; // ≥ 4.5:1 on mid-tone backgrounds too (QC measured 3.4 at 0.72)
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
    const calm = (o.look || DEFAULT_LOOK).motion === 'calm';
    const at = (i) => wave[Math.min(wave.length - 1, Math.max(0, i * step))];
    for (let i = 0; i < n; i++) {
      // calm: a gentler line (3-point average, lower amplitude)
      const raw = calm ? (at(i - 1) + at(i) + at(i + 1)) / 3 * 1.1 : at(i) * 1.8;
      const v = Math.max(-1, Math.min(1, raw));
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
      ctx.fillStyle = i < played ? o.c1 : (o.look || DEFAULT_LOOK).dim;
      roundRect(ctx, g.vx + i * step + (step - bw) / 2, g.vy + (g.vh - h) / 2, bw, h, bw / 2);
      ctx.fill();
    }
  }

  function drawProgress(ctx, o, g, t) {
    const { u, vx, vw } = g;
    const y = g.py, h = Math.max(4, 8 * u);
    const frac = endFrac(o, t);
    const ink = (o.look || DEFAULT_LOOK).ink;
    ctx.save();
    ctx.fillStyle = hexA(ink, 0.25);
    roundRect(ctx, vx, y, vw, h, h / 2); ctx.fill();
    ctx.fillStyle = ink;
    roundRect(ctx, vx, y, Math.max(h, vw * frac), h, h / 2); ctx.fill();
    ctx.beginPath();
    ctx.arc(vx + vw * frac, y + h / 2, h * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 ${Math.round(34 * u)}px "Be Vietnam Pro", sans-serif`;
    ctx.fillStyle = hexA(ink, 0.8);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(formatTime(t), vx, y + h + 16 * u);
    ctx.textAlign = 'right';
    ctx.fillText(formatTime(o.duration), vx + vw, y + h + 16 * u);
    ctx.restore();
  }

  /** 0..1 position in the clip; the last frame (drawn at duration − 1/fps) counts as the end. */
  const endFrac = (o, t) => Math.min(1, t / Math.max(1e-3, o.duration - 1 / o.fps));

  /* ---------------- texture (drawn once into the still layer) ---------------- */
  let noiseTile = null;
  function noise() {
    if (noiseTile) return noiseTile;
    noiseTile = makeCanvas(256, 256);
    const x = noiseTile.getContext('2d'), d = x.createImageData(256, 256);
    let seed = 7;
    for (let i = 0; i < d.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647; // deterministic: the same grain on every export
      const v = seed % 256;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    x.putImageData(d, 0, 0);
    return noiseTile;
  }
  function drawTexture(ctx, o) {
    const tex = (o.look || DEFAULT_LOOK).texture || '';
    const { W, H } = o;
    if (tex.includes('grain') || tex.includes('paper')) {
      ctx.save();
      ctx.globalAlpha = tex.includes('paper') ? 0.05 : 0.07;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = ctx.createPattern(noise(), 'repeat');
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (tex.includes('vignette')) {
      const r = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.6);
      r.addColorStop(0, 'rgba(0,0,0,0)');
      r.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /** Small label at the top ("SÁCH NÓI", "● ON AIR"). The red dot of ON AIR pulses. */
  function drawBadge(ctx, o, g, t) {
    if (!o.badge || g.badgeY == null) return;
    const L = o.look || DEFAULT_LOOK, u = g.u;
    const text = o.badge.toUpperCase().normalize('NFC');
    ctx.save();
    ctx.font = `700 ${Math.round(36 * u)}px "Be Vietnam Pro", sans-serif`;
    ctx.textBaseline = 'middle';
    const dot = L.badgeDot ? 22 * u : 0;
    const tw = Math.min(ctx.measureText(text).width, o.W * 0.7);
    const w = tw + dot + 44 * u, h = 66 * u;
    const x = g.align === 'left' ? g.badgeX : g.badgeX - w / 2, y = g.badgeY - h / 2;
    ctx.fillStyle = hexA(L.badgeColor || L.ink, 0.15);
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = hexA(L.badgeColor || L.ink, 0.45);
    ctx.lineWidth = Math.max(1, 1.5 * u);
    ctx.stroke();
    if (dot) {
      const a = 0.55 + 0.45 * Math.cos((t * 2 * Math.PI) / 0.8);
      ctx.fillStyle = `rgba(239,68,68,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x + 18 * u + 7 * u, g.badgeY, 7 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = L.badgeColor || L.ink;
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 18 * u + dot, g.badgeY + 1 * u, tw);
    ctx.restore();
  }

  /* ---------------- trending styles (research: Kapwing / VEED / Videobolt / Renderforest catalogues) ---------------- */
  const mix = (a, b, f) => {
    const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    const ch = (s) => Math.round(((x >> s) & 255) * (1 - f) + ((y >> s) & 255) * f);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  };
  const isLight = (o) => Core.luminance((o.look || DEFAULT_LOOK).ink) < 0.3; // dark text ⇒ light background
  /** Smooth open path through points (quadratic curves via midpoints). */
  function smoothPath(ctx, pts, close) {
    ctx.beginPath();
    const n = pts.length;
    if (close) {
      const m0 = [(pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2];
      ctx.moveTo(m0[0], m0[1]);
      for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
      ctx.closePath();
      return;
    }
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
  }

  /** "Đường neon": glowing curve through the band tops, soft fill under it. Glow = a wide faint stroke (no blur). */
  function drawLine(ctx, o, g, bands) {
    const n = bands.length, u = g.u;
    const pts = [];
    const ins = 15 * u, x0 = g.vx + ins, w = g.vw - 2 * ins; // the 30u glow stays inside the safe width
    for (let i = 0; i < n; i++) {
      const v = (bands[Math.max(0, i - 1)] + 2 * bands[i] + bands[Math.min(n - 1, i + 1)]) / 4;
      pts.push([x0 + (i / (n - 1)) * w, g.vy + g.vh - v * g.vh * 0.9]);
    }
    ctx.save();
    smoothPath(ctx, pts);
    ctx.lineTo(x0 + w, g.vy + g.vh);
    ctx.lineTo(x0, g.vy + g.vh);
    ctx.closePath();
    const fg = ctx.createLinearGradient(0, g.vy, 0, g.vy + g.vh);
    fg.addColorStop(0, hexA(o.c1, 0.35)); fg.addColorStop(1, hexA(o.c1, 0));
    ctx.fillStyle = fg;
    ctx.fill();
    smoothPath(ctx, pts);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = hexA(o.c1, 0.18);
    ctx.lineWidth = 30 * u;
    ctx.stroke();
    ctx.strokeStyle = grad(ctx, o, g.vx, g.vx + g.vw);
    ctx.lineWidth = Math.max(2, 5 * u);
    ctx.stroke();
    ctx.restore();
  }

  /** "Tin nhắn thoại": a rolling loudness history in rounded capsules (newest on the right), like a voice note. */
  function drawCapsules(ctx, o, g, an, t) {
    const N = o.W > o.H ? 44 : 32, step = g.vw / N, w = step * 0.55, mid = g.vy + g.vh / 2, minH = 8 * g.u;
    const L = o.look || DEFAULT_LOOK;
    ctx.save();
    for (let k = 0; k < N; k++) {
      const h = Math.max(minH, an.env(t - (N - 1 - k) * 0.1) * g.vh);
      ctx.fillStyle = k < N * 0.25 ? L.dim : mix(o.c1, o.c2, k / (N - 1));
      roundRect(ctx, g.vx + k * step + (step - w) / 2, mid - h / 2, w, h, w / 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** "Sóng mềm": 4 soft sine lines, each driven by a frequency group, tapered at the ends. */
  function drawLayers(ctx, o, g, bands, t, st) {
    const gr = Core.bandGroups(bands, 4), alpha = (o.look || DEFAULT_LOOK).motion === 'calm' ? 0.08 : 0.15;
    st.amp = st.amp && t - st.t < 0.25 ? st.amp.map((a, j) => a + alpha * (gr[j] - a)) : Array.from(gr);
    st.t = t;
    const K = [1.2, 1.7, 2.1, 2.6], W_ = [0.8, 1.3, 1.7, 2.0], PH = [0, 1.3, 2.6, 3.9];
    const mid = g.vy + g.vh / 2, light = isLight(o);
    ctx.save();
    ctx.lineWidth = Math.max(2, 4 * g.u);
    ctx.lineCap = 'round';
    if (light) ctx.globalAlpha = 0.75; else ctx.globalCompositeOperation = 'lighter';
    for (let j = 3; j >= 0; j--) {
      const a = (0.15 + st.amp[j]) * (g.vh / 2) * 0.85;
      ctx.strokeStyle = mix(o.c1, o.c2, j / 3);
      ctx.beginPath();
      for (let i = 0; i <= 128; i++) {
        const xn = i / 128, xh = xn * 2 - 1, att = (1 - xh * xh) ** 2;
        const y = mid + a * att * Math.sin(K[j] * xn * 2 * Math.PI + PH[j] + W_[j] * t);
        const x = g.vx + xn * g.vw;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** "Quả cầu": a liquid blob morphing with 6 frequency groups (mirrored → symmetric), soft glow sprite. */
  function drawOrb(ctx, o, g, bands, level, t, st, im) {
    const gr = Core.bandGroups(bands, 6);
    st.orb = st.orb && t - st.ot < 0.25 ? st.orb.map((a, j) => a + 0.12 * (gr[j] - a)) : Array.from(gr);
    st.ot = t;
    const cx = g.ax + g.A / 2, cy = g.ay + g.A / 2, R = g.A * 0.34;
    if (!st.glow || st.glowR !== R) {
      const s = Math.ceil(R * 3);
      st.glow = makeCanvas(s, s); st.glowR = R;
      const x = st.glow.getContext('2d'), rg = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      rg.addColorStop(0, hexA(o.c2, 0.35)); rg.addColorStop(1, hexA(o.c2, 0));
      x.fillStyle = rg; x.fillRect(0, 0, s, s);
    }
    const gs = st.glow.width * (1 + 0.08 * level);
    ctx.drawImage(st.glow, cx - gs / 2, cy - gs / 2, gs, gs);
    const pts = [];
    for (let k = 0; k < 12; k++) {
      const gk = st.orb[k < 6 ? k : 11 - k];
      const r = R * (1 + 0.18 * gk + 0.04 * Math.sin(t * 0.7 + k * 1.9));
      const a = (k / 12) * Math.PI * 2 - Math.PI / 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    const fill = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R * 1.25);
    fill.addColorStop(0, o.c2); fill.addColorStop(1, o.c1);
    ctx.save();
    smoothPath(ctx, pts, true);
    if (im) {
      // a chosen cover lives INSIDE the orb (it used to be hidden), tinted by the template colours
      ctx.clip();
      drawImageFit(ctx, im.img, im.w, im.h, cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6, 'cover');
      ctx.globalAlpha = 0.35;
    }
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }

  /** "Đèn LED": 16 × 12 dot-matrix equalizer with falling peak dots. One path per row (fast). */
  function drawLED(ctx, o, g, bands, t, st) {
    const C = 16, R = 12, gr = Core.bandGroups(bands, C), L = o.look || DEFAULT_LOOK;
    const cw = g.vw / C, ch = g.vh / R, pw = cw * 0.78, ph = ch * 0.72, r = Math.min(pw, ph) * 0.3;
    if (!st.peak || t < st.lt || t - st.lt > 0.25) { st.peak = new Array(C).fill(0); st.pt = new Array(C).fill(t); st.lt = t; }
    const dt = t - st.lt; st.lt = t;
    const lit = gr.map((v) => Math.round(Math.min(1, v) * R));
    for (let c = 0; c < C; c++) {
      if (lit[c] >= st.peak[c]) { st.peak[c] = lit[c]; st.pt[c] = t; } else if (t - st.pt[c] > 0.4) st.peak[c] = Math.max(lit[c], st.peak[c] - 1.2 * dt * R / 4);
    }
    const cell = (c, row) => roundRect(ctx, g.vx + c * cw + (cw - pw) / 2, g.vy + g.vh - (row + 1) * ch + (ch - ph) / 2, pw, ph, r);
    ctx.save();
    ctx.fillStyle = L.dim;
    ctx.beginPath();
    for (let row = 0; row < R; row++) for (let c = 0; c < C; c++) if (row >= lit[c]) { cell(c, row); ctx.fill(); }
    for (let row = 0; row < R; row++) {
      ctx.fillStyle = mix(o.c1, o.c2, row / (R - 1));
      for (let c = 0; c < C; c++) if (row < lit[c]) { cell(c, row); ctx.fill(); }
    }
    ctx.fillStyle = L.ink;
    for (let c = 0; c < C; c++) { const pk = Math.round(st.peak[c]); if (pk > lit[c] && pk > 0) { cell(c, pk - 1); ctx.fill(); } }
    ctx.restore();
  }

  /** "Đĩa quay": a spinning record (33⅓ rpm) with the cover as its label, a still sheen and a tonearm. */
  function drawVinyl(ctx, o, g, im, t, st, punch) {
    const A = g.A, cx = g.ax + A / 2, cy = g.ay + A / 2, S = Math.round(A * 1.08), u = g.u;
    if (!st.disc) {
      st.disc = makeCanvas(S, S);
      const x = st.disc.getContext('2d'), c = S / 2;
      x.fillStyle = '#111';
      x.beginPath(); x.arc(c, c, c, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.06)';
      x.lineWidth = Math.max(1, 1.5 * u);
      for (let i = 0; i < 20; i++) { x.beginPath(); x.arc(c, c, c * (0.42 + i * 0.027), 0, Math.PI * 2); x.stroke(); }
      const lr = A * 0.19;
      x.save();
      x.beginPath(); x.arc(c, c, lr, 0, Math.PI * 2); x.clip();
      if (im) drawImageFit(x, im.img, im.w, im.h, c - lr, c - lr, lr * 2, lr * 2, 'cover');
      else { const lg = x.createLinearGradient(c - lr, c - lr, c + lr, c + lr); lg.addColorStop(0, o.c1); lg.addColorStop(1, o.c2); x.fillStyle = lg; x.fillRect(c - lr, c - lr, lr * 2, lr * 2); }
      x.restore();
      x.fillStyle = '#000';
      x.beginPath(); x.arc(c, c, A * 0.014, 0, Math.PI * 2); x.fill();
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(punch, punch);
    ctx.save();
    ctx.rotate(3.49 * t); // 33⅓ rpm
    ctx.drawImage(st.disc, -S / 2, -S / 2);
    ctx.restore();
    // sheen stays still while the record turns (looks like a real reflection)
    const sh = ctx.createLinearGradient(-S / 2, -S / 2, S / 2, S / 2);
    sh.addColorStop(0.3, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.07)'); sh.addColorStop(0.7, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh;
    ctx.beginPath(); ctx.arc(0, 0, S / 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // tonearm (wobbles a hair on beats)
    const px = cx + A * 0.52, py = cy - A * 0.5, ang = ((0.6 * (punch - 1)) / 0.035) * (Math.PI / 180);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.strokeStyle = hexA((o.look || DEFAULT_LOOK).ink, 0.85);
    ctx.lineWidth = Math.max(3, 9 * u);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-A * 0.05, A * 0.42); ctx.lineTo(-A * 0.2, A * 0.55); ctx.stroke();
    ctx.fillStyle = hexA((o.look || DEFAULT_LOOK).ink, 0.85);
    ctx.beginPath(); ctx.arc(0, 0, 18 * u, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* ---------------- beat effects: particles, ripples (geometry / motion only — never a brightness flash) ---------------- */
  /** One particle sprite per (shape, colour): drawn once, then only copied (cheap on phones). */
  function particleSprite(shape, col, u) {
    const d = Math.ceil(24 * u), c = makeCanvas(d * 2, d * 2), x = c.getContext('2d');
    x.translate(d, d);
    x.fillStyle = col; x.strokeStyle = col;
    if (shape === 'dot' || shape === 'snow') {
      const rg = x.createRadialGradient(0, 0, 0, 0, 0, d);
      rg.addColorStop(0, hexA(col, 0.95)); rg.addColorStop(shape === 'snow' ? 0.35 : 0.2, hexA(col, 0.6)); rg.addColorStop(1, hexA(col, 0));
      x.fillStyle = rg; x.fillRect(-d, -d, d * 2, d * 2);
      if (shape === 'snow') {
        x.lineWidth = Math.max(1, d * 0.08); x.lineCap = 'round';
        for (let i = 0; i < 6; i++) { x.rotate(Math.PI / 3); x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -d * 0.75); x.stroke(); }
      }
    } else if (shape === 'petal') {
      const lg = x.createLinearGradient(0, -d, 0, d);
      lg.addColorStop(0, hexA(col, 0.95)); lg.addColorStop(1, hexA(col, 0.55));
      x.fillStyle = lg;
      x.beginPath(); x.ellipse(0, 0, d * 0.42, d * 0.85, 0, 0, Math.PI * 2); x.fill();
    } else if (shape === 'heart') {
      const s = d * 0.85;
      x.beginPath();
      x.moveTo(0, s * 0.85);
      x.bezierCurveTo(-s * 1.2, s * 0.05, -s * 0.75, -s * 0.95, 0, -s * 0.35);
      x.bezierCurveTo(s * 0.75, -s * 0.95, s * 1.2, s * 0.05, 0, s * 0.85);
      x.fill();
    } else if (shape === 'star') {
      x.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? d * 0.4 : d * 0.9, a = (i / 10) * Math.PI * 2 - Math.PI / 2; i ? x.lineTo(Math.cos(a) * r, Math.sin(a) * r) : x.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      x.closePath(); x.fill();
    } else if (shape === 'note') {
      x.font = `800 ${Math.round(d * 1.7)}px "Be Vietnam Pro", sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineWidth = Math.max(1, d * 0.12); x.lineJoin = 'round';
      x.strokeText('♪', 0, 0); // a thicker note: the thin glyph was almost invisible (QC)
      x.fillText('♪', 0, 0);
    } else if (shape === 'bubble') {
      x.lineWidth = Math.max(1, d * 0.09);
      x.beginPath(); x.arc(0, 0, d * 0.8, 0, Math.PI * 2); x.stroke();
      x.fillStyle = hexA(col, 0.12); x.fill();
      x.fillStyle = hexA('#ffffff', 0.7); x.beginPath(); x.arc(-d * 0.3, -d * 0.3, d * 0.14, 0, Math.PI * 2); x.fill();
    }
    return c;
  }

  const SPIN = { petal: 1, star: 0.8, note: 0.4, heart: 0.3 };

  /** "Hạt bay": seeded particles; their clock runs faster after bass hits (react). Pure in t. */
  function drawParticles(ctx, o, g, an, t, st) {
    const f = o.fx, u = g.u, tall = o.H > o.W * 1.6, L = o.look || DEFAULT_LOOK;
    if (!st.parts || st.partsN !== f.amount) {
      const rnd = Core.prng(20261123);
      st.parts = Array.from({ length: f.amount }, (_, i) => ({ x: rnd(), y: rnd(), a: rnd() * Math.PI * 2, v: 0.01 + rnd() * 0.03, s: 0.6 + rnd() * 0.8, spin: (rnd() - 0.5) * 2, k: i % 3 }));
      st.partsN = f.amount;
    }
    const palette = { ink: [L.ink], c1: [o.c1], c2: [o.c2], mix: [o.c1, o.c2, L.ink] }[f.color] || [L.ink];
    st.sprites = st.sprites || {};
    const spr = palette.map((col) => st.sprites[f.shape + col] || (st.sprites[f.shape + col] = particleSprite(f.shape, col, u)));
    const y0 = tall ? 0.06 : 0, y1 = tall ? 0.78 : 1; // keep the TikTok safe zone clear
    // bass hits speed the drift up a little (≤ ~3× real time even at 4 kicks/s, QC measured 8× before)
    const T = t + 0.35 * f.react * an.push(t);
    const cx = g.ax + g.A / 2, cy = g.ay + g.A / 2, spin = SPIN[f.shape] || 0;
    const base = 0.55;
    ctx.save();
    for (const p of st.parts) {
      const q = Core.particleAt(p, T, f.dir);
      const rot = p.a + p.spin * spin * t; // spin at its own pace, not sped up by the beat (QC: 410°/s)
      let x, y, a;
      if (f.dir === 'burst') {
        x = cx + (q.x - 0.5) * o.W; y = cy + (q.y - 0.5) * o.H * 0.8;
        const fy = (y / o.H - y0) / (y1 - y0); // fade out before leaving the safe band
        a = Core.lifeAlpha(q.life) * Math.max(0, Math.min(1, fy / 0.08, (1 - fy) / 0.08));
      } else {
        x = q.x * o.W; y = (y0 + q.y * (y1 - y0)) * o.H;
        // fade near every edge: wrapping around never pops a particle in or out (QC: x had no fade)
        a = Math.min(1, q.y / 0.08, (1 - q.y) / 0.08, q.x / 0.06, (1 - q.x) / 0.06);
      }
      if (a <= 0) continue;
      ctx.globalAlpha = base * a;
      const r = p.s * 14 * u * (f.shape === 'dot' ? 1.2 : f.shape === 'note' ? 1.5 : 1), sp = spr[p.k % spr.length];
      if (spin) { ctx.setTransform(Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), x, y); ctx.drawImage(sp, -r, -r, r * 2, r * 2); ctx.setTransform(1, 0, 0, 1, 0, 0); }
      else ctx.drawImage(sp, x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  /** "Vòng sóng lan": thin faint rings growing out of the cover on each bass hit (fade out, never flash). */
  function drawRipples(ctx, o, g, an, t) {
    const rs = an.ripples(t);
    if (!rs.length) return;
    const cx = g.ax + g.A / 2, cy = g.ay + g.A / 2, r0 = g.A * 0.5, r1 = Math.min(o.W, o.H) * 0.48;
    ctx.save();
    ctx.lineWidth = Math.max(2, 4 * g.u);
    ctx.strokeStyle = o.c1;
    for (const r of rs) {
      ctx.globalAlpha = r.a;
      ctx.beginPath(); ctx.arc(cx, cy, r0 + r.r * (r1 - r0), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function makeDraw(o, im) {
    const g = geometry(o.W, o.H, (o.look || DEFAULT_LOOK).layout, o.style, { badge: !!o.badge, titleScale: (o.look || DEFAULT_LOOK).titleScale || 1 });
    const own = o.style === 'vinyl' || o.style === 'orb'; // these draw their own centre piece instead of the cover
    const showArt = (!g.noArt || o.style === 'circle') && !own;
    const L = o.look || DEFAULT_LOOK;
    const f = o.fx || {};
    // beat effects: geometry only (no brightness change, no shake); a red horror look never "punches"
    const punchOn = !!f.punch && !L.noPunch;
    const punchAmt = (f.punchAmt || 0.035) * (L.motion === 'calm' ? 0.5 : 1);
    const punchArt = punchOn && f.punchTarget !== 'text', punchText = punchOn && f.punchTarget !== 'art';
    const tau = f.punchLen === 'long' ? 0.35 : f.punchLen === 'short' ? 0.15 : L.motion === 'calm' ? 0.35 : 0.15;
    const swayOn = !!f.sway;
    const moveArt = punchArt || swayOn; // the cover moves: drawn per frame from a sprite
    const st = {}; // per-scene state of the smoothed styles (frames are drawn in order)
    let artSprite = null;
    const an = makeAnalyzer(o);
    const nBands = o.W > o.H ? 56 : 40;
    // Everything that never moves is drawn ONCE: the background layer (moves only with "Nền chuyển động")
    // and the front layer (cover + title, unless they bounce / sway). Each frame copies them.
    let bgLayer = null, front = null;
    const backLayer = () => {
      if (bgLayer) return bgLayer;
      bgLayer = makeCanvas(o.W, o.H);
      const c = bgLayer.getContext('2d', { alpha: false });
      drawBackground(c, o, g, im);
      drawTexture(c, o);
      return bgLayer;
    };
    const frontLayer = () => {
      if (front) return front;
      front = makeCanvas(o.W, o.H);
      const c = front.getContext('2d');
      if (o.bgMode === 'image' && im) {
        // a soft dark band under the title so it stays readable on any photo
        const z = g.zones.text, pad = 24 * g.u;
        const sg = c.createLinearGradient(0, z[0] - pad * 2, 0, z[1] + pad * 2);
        sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(0.25, 'rgba(0,0,0,0.38)'); sg.addColorStop(0.75, 'rgba(0,0,0,0.38)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = sg;
        c.fillRect(g.align === 'left' ? g.tx - pad : 0, z[0] - pad * 2, g.align === 'left' ? g.tw + pad * 2 : o.W, z[1] - z[0] + pad * 4);
      }
      if (im && showArt && !moveArt) drawArt(c, o, g, im, 0, o.style === 'circle' || !!g.noArt);
      if (!punchText) drawText(c, o, g);
      return front;
    };
    return (ctx, t) => {
      // colour flow: the two visualizer colours drift into each other over ~10 s (slow, never a flash)
      // ≤ 30 % of the way: at 50 % both colours met in the middle and complementary pairs turned grey (QC)
      const fo = f.colorFlow ? { ...o, c1: Core.mixHex(o.c1, o.c2, 0.3 * Core.slowWave(t, 10)), c2: Core.mixHex(o.c2, o.c1, 0.3 * Core.slowWave(t, 10)) } : o;
      const { bands, wave, level } = an.at(t, o.style === 'circle' ? 48 : o.style === 'line' ? 32 : nBands);
      if (f.bgMove) {
        // slow zoom + drift of the background (period 14 s / 23 s) — the front layer stays still
        const s = 1.03 + 0.05 * Core.slowWave(t, 14), dx = (Core.slowWave(t, 23) - 0.5) * o.W * 0.03;
        ctx.save();
        ctx.translate(o.W / 2 + dx, o.H / 2); ctx.scale(s, s); ctx.translate(-o.W / 2, -o.H / 2);
        ctx.drawImage(backLayer(), 0, 0);
        ctx.restore();
      } else ctx.drawImage(backLayer(), 0, 0);
      if (f.dust) drawParticles(ctx, o, g, an, t, st); // base colours: flowing ones made a new sprite every frame
      if (f.ripple) drawRipples(ctx, fo, g, an, t);
      ctx.drawImage(frontLayer(), 0, 0);
      const pk = punchOn ? an.punch(t, tau) : 0;
      const k = punchArt ? 1 + punchAmt * pk : 1;
      const rot = swayOn ? ((f.swayAmt || 2) * Math.PI / 180) * Math.sin(t * 1.1) * (0.4 + 0.6 * an.env(t)) : 0;
      const cx = g.ax + g.A / 2, cy = g.ay + g.A / 2;
      const moved = (fn) => { if (k === 1 && !rot) return fn(); ctx.save(); ctx.translate(cx, cy); if (rot) ctx.rotate(rot); ctx.scale(k, k); ctx.translate(-cx, -cy); fn(); ctx.restore(); };
      if (im && showArt && moveArt) {
        if (!artSprite) {
          const pad = 80 * g.u;
          artSprite = makeCanvas(g.A + pad * 2, g.A + pad * 2);
          drawArt(artSprite.getContext('2d'), o, { ...g, ax: pad, ay: pad }, im, 0, o.style === 'circle' || !!g.noArt);
          artSprite.pad = pad;
        }
        moved(() => ctx.drawImage(artSprite, g.ax - artSprite.pad, g.ay - artSprite.pad));
      }
      if (!im && showArt) moved(() => drawArt(ctx, fo, g, null, level, o.style === 'circle')); // the pulsing disc moves with the music
      if (o.style === 'circle') moved(() => drawCircle(ctx, fo, g, bands));
      // "Ảnh & sóng": the visualizer bounces too, around its own centre (QC: punch did nothing without a cover)
      const vk = punchArt ? 1 + punchAmt * 0.7 * pk : 1, vcx = g.vx + g.vw / 2, vcy = g.vy + g.vh / 2;
      const vis = (fn) => { if (vk === 1) return fn(); ctx.save(); ctx.translate(vcx, vcy); ctx.scale(vk, vk); ctx.translate(-vcx, -vcy); fn(); ctx.restore(); };
      if (o.style === 'vinyl') { if (rot) moved(() => drawVinyl(ctx, fo, g, im, t, st, k)); else drawVinyl(ctx, fo, g, im, t, st, k); }
      else if (o.style === 'orb') moved(() => drawOrb(ctx, fo, g, bands, level, t, st, im));
      else if (o.style === 'line') vis(() => drawLine(ctx, fo, g, bands));
      else if (o.style === 'capsules') vis(() => drawCapsules(ctx, fo, g, an, t));
      else if (o.style === 'layers') vis(() => drawLayers(ctx, fo, g, bands, t, st));
      else if (o.style === 'led') vis(() => drawLED(ctx, fo, g, bands, t, st));
      if (o.style === 'bars') vis(() => drawBars(ctx, fo, g, bands, false));
      else if (o.style === 'mirror') vis(() => drawBars(ctx, fo, g, bands, true));
      else if (o.style === 'wave') vis(() => drawWave(ctx, fo, g, wave));
      else if (o.style === 'overview') vis(() => drawOverview(ctx, fo, g, an.overview(o.W > o.H ? 80 : 60), endFrac(o, t)));
      if (punchText) {
        // the title bounces (around its own centre)
        const z = g.zones.text, tcx = g.align === 'left' ? g.tx : o.W / 2, tcy = (z[0] + z[1]) / 2, kt = 1 + punchAmt * 0.6 * pk;
        ctx.save(); ctx.translate(tcx, tcy); ctx.scale(kt, kt); ctx.translate(-tcx, -tcy); drawText(ctx, o, g); ctx.restore();
      }
      if (o.progress) drawProgress(ctx, o, g, t);
      drawBadge(ctx, o, g, t);
    };
  }

  function scene() {
    const o = opts();
    return { width: o.W, height: o.H, fps: o.fps, duration: o.duration, draw: makeDraw(o, art), audio, audioOffset: o.start };
  }

  /**
   * For the on-device self-test and e2e tests: draw one frame of a visualizer style with a synthetic
   * "music" signal (no user file needed). → { canvas, ms } (ms = draw time of that frame).
   */
  window.AVTest = {
    styles: () => [...$('avStyle').options].map((x) => x.value),
    frame(style, { W = 360, H = 640, t = 0.5, layout = 'cover', fx = {} } = {}) {
      const o = { ...opts(), W, H, fps: 30, style, duration: 4, start: 0, look: { ...DEFAULT_LOOK, layout }, bgMode: 'gradient', progress: true, badge: '', fx: { ...opts().fx, dust: false, punch: false, ripple: false, sway: false, bgMove: false, colorFlow: false, ...fx } };
      const draw = makeDraw(o, null);
      const c = makeCanvas(W, H), x = c.getContext('2d');
      draw(x, Math.max(0, t - 1 / 30)); // a previous frame for styles that smooth over time
      const t0 = performance.now();
      draw(x, t);
      return { canvas: c, ms: performance.now() - t0 };
    },
  };

  async function ensureFonts() {
    try {
      const specs = new Set(['800 40px "Be Vietnam Pro"', '600 40px "Be Vietnam Pro"', ...AV_TEMPLATES.map((t) => fontOf({ ...DEFAULT_LOOK, ...t.style }, 40)), fontOf(look, 40)]);
      await Promise.all([...specs].map((f) => document.fonts.load(f, 'AaĂâđỔẶ♪' + opts().title)));
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
    if (rw) rw.refresh();
  }

  /* ---------------- events ---------------- */
  onFiles('avAudio', async ([f]) => {
    $('avAudioInfo').textContent = 'Đang đọc audio…';
    try {
      const buf = await decodeAudioFile(f);
      audio = buf;
      trim.setAudio(buf);
      channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      audioFile = f.name;
      $('avAudioInfo').textContent = `🎵 ${f.name} — ${formatTime(buf.duration)} · ${buf.sampleRate} Hz · ${buf.numberOfChannels} kênh`;
      // A whole long track can need ~1 GB of RAM to export; phones (iOS especially) reload the tab instead.
      if (IS_MOBILE && buf.duration > 300) {
        $('avAudioInfo').textContent += ' · ⚠️ Bài dài trên điện thoại có thể làm trang bị tải lại vì thiếu bộ nhớ — nếu gặp, hãy cắt bài ngắn hơn hoặc xuất trên máy tính.';
      }
      await ensureFonts();
      preview();
    } catch (e) {
      audio = null; channels = null; audioFile = '';
      trim.setAudio(null);
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
      picker.refresh(); // thumbnails now show the cover
    } catch (e) { toast(e.message); }
  });

  // a change while "Xem thử" plays used to do nothing until Stop: stop the preview and show the change
  const previewSoon = oncePerFrame(() => {
    if (player.playing) { player.stop(); $('avPlay').textContent = '▶ Xem thử'; toast('Đã dừng xem thử để áp dụng thay đổi — bấm Xem thử để nghe lại'); }
    preview();
  });
  ['avDust', 'avDustShape', 'avDustAmount', 'avDustDir', 'avDustReact', 'avDustColor', 'avPunch', 'avPunchAmt', 'avPunchTarget', 'avPunchLen', 'avRipple', 'avSway', 'avSwayAmt', 'avBgMove', 'avColorFlow', 'avBadge', 'avTitle', 'avSub', 'avStyle', 'avColor1', 'avColor2', 'avBgMode', 'avBgColor', 'avSize', 'avFps', 'avStart', 'avDur', 'avProgress'].forEach((id) =>
    $(id).addEventListener('input', previewSoon)
  );

  $('avPlay').onclick = async () => {
    if (player.playing) { player.stop(); $('avPlay').textContent = '▶ Xem thử'; preview(); return; }
    if (!audio) return toast('Hãy chọn file audio');
    const bad = Core.checkStart($('avStart').value, audio.duration);
    if (bad) return toast(bad);
    audioCtx().resume(); // inside the tap, before any await (iOS)
    trim.stop();
    await ensureFonts();
    const sc = scene();
    canvas.width = sc.width; canvas.height = sc.height;
    $('avPlay').textContent = '■ Dừng';
    player.play(sc, (t) => { if (t < 0) { $('avPlay').textContent = '▶ Xem thử'; preview(); } });
  };

  rw = wireRender({
    btn: $('avRender'),
    peek: () => {
      if (!audio) return null;
      const o = opts();
      return { width: o.W, height: o.H, fps: o.fps, duration: o.duration, audio: true };
    },
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

  // did the user type the label themselves? (templates fill it with synthetic events)
  let badgeTyped = false;
  $('avBadge').addEventListener('input', (e) => { if (e.isTrusted) badgeTyped = $('avBadge').value.trim() !== ''; });

  /* colour sets: change ONLY the colours (the template's layout, fonts, label stay) */
  let palPicker = null;
  palPicker = Palettes.mount({
    box: $('avPalettes'),
    onPick: (p) => {
      const onImage = $('avBgMode').value === 'image'; // a blurred photo stays dark: keep light text there
      const texture = p.light ? (look.texture || '').replace('vignette', '') : look.texture; // a vignette greys out light sets
      look = { ...look, stops: p.bg, angle: 160, glow: !p.light, badgeColor: undefined, texture, ...(onImage ? {} : { ink: p.ink, dim: hexA(p.ink, 0.2) }) };
      Templates.setControl('avColor1', p.c1);
      Templates.setControl('avColor2', p.c2);
      Templates.setControl('avBgColor', p.bg[0]);
      preview();
    },
  });

  /* template picker */
  const AV_CONTROLS = ['avStyle', 'avColor1', 'avColor2', 'avBgMode', 'avBgColor', 'avProgress', 'avSize', 'avFps', 'avSub', 'avBadge', 'avDust', 'avDustShape', 'avDustAmount', 'avDustDir', 'avDustReact', 'avDustColor', 'avPunch', 'avPunchAmt', 'avPunchTarget', 'avPunchLen', 'avRipple', 'avSway', 'avSwayAmt', 'avBgMove', 'avColorFlow'];
  const picker = Templates.mount({
    box: $('avTemplates'),
    key: 'av',
    builtins: AV_TEMPLATES,
    thumb: (t, ctx, W, H) => {
      const cur = opts(), set = t.set || {};
      const keepImage = art && cur.bgMode === 'image';
      const o = {
        ...cur, W, H, fps: 30, style: set.avStyle || cur.style, c1: set.avColor1 || cur.c1, c2: set.avColor2 || cur.c2,
        bgMode: keepImage ? 'image' : set.avBgMode === 'image' && !art ? 'gradient' : set.avBgMode || cur.bgMode,
        bgColor: set.avBgColor || cur.bgColor, progress: set.avProgress !== undefined ? !!set.avProgress : cur.progress,
        look: readableLook({ ...DEFAULT_LOOK, ...t.style }, keepImage ? 'image' : 'gradient'),
        badge: set.avBadge !== undefined ? set.avBadge : '',
        fx: { ...cur.fx, dust: !!set.avDust, shape: set.avDustShape || cur.fx.shape, dir: set.avDustDir || cur.fx.dir, color: set.avDustColor || cur.fx.color, ripple: !!set.avRipple, punch: false, sway: false, bgMove: false, colorFlow: false },
        sub: cur.sub, // like the video: the genre hint is only a placeholder
      };
      makeDraw(o, art)(ctx, audio ? Math.min(o.duration * 0.3, 20) : 0.5);
    },
    apply: (t) => {
      look = { ...DEFAULT_LOOK, ...t.style };
      if (palPicker) palPicker.clear(); // the template brings its own colours
      // templates saved before the label existed have no avBadge: don't leave the previous template's label
      if ((!t.set || !('avBadge' in t.set)) && !badgeTyped) Templates.setControl('avBadge', '');
      for (const k of ['avDust', 'avPunch', 'avRipple', 'avSway', 'avBgMove', 'avColorFlow']) if (!t.set || !(k in t.set)) Templates.setControl(k, false); // saved before these effects existed
      // the genre's suggested subtitle is a hint (placeholder, drawn faintly) — it never overwrites what the user typed
      $('avSub').placeholder = look.subHint ? 'VD: ' + look.subHint : '@yourname';
      ensureFonts().then(preview);
      preview();
    },
    controls: AV_CONTROLS,
    captureStyle: () => ({ ...look }),
    // a chosen cover keeps its "image" background; a label the user typed is kept too
    skipControl: (id) => (id === 'avBgMode' && art && $('avBgMode').value === 'image') || (id === 'avBadge' && badgeTyped && $('avBadge').value.trim() !== ''),
  });

  window.addEventListener('tabshown', (e) => e.detail === 'audiovideo' && preview());
  preview();
  ensureFonts().then(() => { preview(); picker.refresh(); });
})();
