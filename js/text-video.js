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

  /* ---- moving-background helpers: every one is a pure function of `time` (preview = export, seekable) ---- */
  let grainTiles = null;
  /** 4 noise tiles made once (seeded), cycled ~12×/s: film grain without per-frame random numbers. */
  function grain(c, W, H, time, alpha) {
    if (!grainTiles) {
      grainTiles = [0, 1, 2, 3].map((k) => {
        const g = makeCanvas(192, 192), x = g.getContext('2d'), d = x.createImageData(192, 192), r = Core.prng(97 + k);
        for (let i = 0; i < d.data.length; i += 4) { const v = r() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
        x.putImageData(d, 0, 0);
        return g;
      });
    }
    c.save();
    c.globalAlpha = alpha;
    c.globalCompositeOperation = 'overlay';
    c.fillStyle = c.createPattern(grainTiles[Math.floor(time * 12) % 4], 'repeat');
    const f = Math.floor(time * 12); // jump the pattern each frame so no two moments share the same grain
    c.translate((f * 71) % 192, (f * 113) % 192);
    c.fillRect(-192, -192, W + 192, H + 192);
    c.restore();
  }
  function vignette(c, W, H, strength) {
    const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  function scanlines(c, W, H, time) {
    const step = Math.max(3, Math.round(H / 480));
    c.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < H; y += step * 2) c.fillRect(0, y, W, step);
    // a soft bright band rolling down, like a tracking error
    const by = ((time * 0.18) % 1.2 - 0.1) * H;
    const g = c.createLinearGradient(0, by - H * 0.05, 0, by + H * 0.05);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, by - H * 0.05, W, H * 0.1);
  }


  const TEMPLATES = [
    {
      id: 'classic', cat: 'Phổ biến', name: 'Cơ bản',
      bg: (c, W, H) => linear(c, W, H, ['#0f0c29', '#302b63', '#24243e']),
      font: 'Be Vietnam Pro', weight: 800, color: '#fff', stroke: { color: '#000', w: 0.14 }, lineHeight: 1.25,
    },
    {
      id: 'caption', cat: 'Phổ biến', name: 'Hộp chữ',
      bg: (c, W, H) => linear(c, W, H, ['#ff9a8b', '#ff6a88', '#ff99ac'], 120),
      font: 'Be Vietnam Pro', weight: 800, color: '#111', box: { fill: '#fff', pad: 0.32, radius: 0.22 }, lineHeight: 1.42,
    },
    {
      id: 'tiktok', cat: 'Phổ biến', name: 'TikTok',
      bg: (c, W, H) => solid(c, W, H, '#010101'),
      font: 'Montserrat', weight: 900, color: '#fff', glitch: true, lineHeight: 1.2, upper: true,
    },
    {
      id: 'neon', cat: 'Nổi bật', name: 'Neon',
      bg: (c, W, H) => {
        solid(c, W, H, '#05040f');
        const g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
        g.addColorStop(0, 'rgba(120,40,200,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      },
      font: 'Montserrat', weight: 900, color: '#fff', shadow: { color: '#0ff', blur: 0.45 }, lineHeight: 1.25,
    },
    {
      id: 'quote', cat: 'Trích dẫn', name: 'Trích dẫn sáng',
      bg: (c, W, H) => solid(c, W, H, '#f4eee4'),
      font: 'Playfair Display', weight: 700, italic: true, color: '#2b2b2b', align: 'left', lineHeight: 1.3, quote: '#c9a27a', handleColor: '#5e5040',
    },
    {
      id: 'bold', cat: 'Nổi bật', name: 'Vàng nổi bật',
      bg: (c, W, H) => solid(c, W, H, '#ffd400'),
      font: 'Montserrat', weight: 900, color: '#111', upper: true, lineHeight: 1.15, handleColor: '#111',
    },
    {
      id: 'sunset', cat: 'Phổ biến', name: 'Hoàng hôn',
      bg: (c, W, H) => linear(c, W, H, ['#b31d0c', '#a85a0a'], 200), // deep enough for white text ≥ 4.5:1 (was 2.1:1 on #f5af19)
      font: 'Be Vietnam Pro', weight: 800, color: '#fff', shadow: { color: 'rgba(0,0,0,0.45)', blur: 0.2, y: 0.06 }, lineHeight: 1.25,
    },
    {
      id: 'ocean', cat: 'Tối giản', name: 'Đại dương',
      bg: (c, W, H) => linear(c, W, H, ['#0f2027', '#203a43', '#2c5364']),
      font: 'Be Vietnam Pro', weight: 700, color: '#fff', box: { fill: 'rgba(0,0,0,0.55)', pad: 0.3, radius: 0.15 }, lineHeight: 1.45,
    },
    {
      id: 'note', cat: 'Bài học', name: 'Ghi chú',
      bg: (c, W, H) => {
        solid(c, W, H, '#fffdf3');
        c.strokeStyle = 'rgba(70,130,200,0.25)'; c.lineWidth = Math.max(1, W / 540);
        for (let y = H * 0.08; y < H; y += H * 0.045) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
        c.strokeStyle = 'rgba(230,60,60,0.55)'; c.beginPath(); c.moveTo(W * 0.1, 0); c.lineTo(W * 0.1, H); c.stroke();
      },
      font: 'Be Vietnam Pro', weight: 600, color: '#1d2433', align: 'left', lineHeight: 1.35, handleColor: '#555',
    },
    {
      id: 'mono', cat: 'Nổi bật', name: 'Hacker',
      bg: (c, W, H) => solid(c, W, H, '#0b1410'),
      font: 'Roboto Mono', weight: 700, color: '#39ff88', align: 'left', shadow: { color: 'rgba(57,255,136,0.6)', blur: 0.25 }, lineHeight: 1.35, cursor: true,
    },
    {
      id: 'news', cat: 'Tin tức', name: 'Tin nóng',
      bg: (c, W, H) => {
        linear(c, W, H, ['#1a0006', '#4a0010'], 90);
        c.fillStyle = '#e11d48'; c.fillRect(0, H * 0.1, W, Math.max(H * 0.055, Math.min(W, H) * 0.08));
        c.fillStyle = '#fff'; c.font = `900 ${Math.round(Math.min(W, H) * 0.05)}px Montserrat, sans-serif`;
        c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText('● TIN NÓNG', W * 0.06, H * 0.1 + Math.max(H * 0.055, Math.min(W, H) * 0.08) / 2);
      },
      font: 'Montserrat', weight: 900, color: '#fff', upper: true, box: { fill: 'rgba(225,29,72,0.92)', pad: 0.28, radius: 0.05 }, lineHeight: 1.4,
    },
    {
      id: 'sale', cat: 'Bán hàng', name: 'Sale sốc',
      bg: (c, W, H) => {
        linear(c, W, H, ['#ff512f', '#dd2476'], 135);
        c.fillStyle = 'rgba(255,255,255,0.08)';
        for (let i = -H; i < W + H; i += W * 0.12) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + W * 0.05, 0); c.lineTo(i + W * 0.05 - H, H); c.lineTo(i - H, H); c.fill(); }
      },
      font: 'Montserrat', weight: 900, color: '#ffe600', stroke: { color: '#3b0016', w: 0.16 }, upper: true, lineHeight: 1.15, handleColor: '#fff',
    },
    {
      id: 'product', cat: 'Bán hàng', name: 'Sản phẩm',
      bg: (c, W, H) => {
        solid(c, W, H, '#f6f1ea');
        c.fillStyle = '#111'; c.fillRect(0, H * 0.86, W, H * 0.14);
        c.strokeStyle = '#111'; c.lineWidth = W * 0.008; c.strokeRect(W * 0.05, H * 0.04, W * 0.9, H * 0.78);
      },
      font: 'Montserrat', weight: 900, color: '#111', lineHeight: 1.2, handleColor: '#fff',
    },
    {
      id: 'lesson', cat: 'Bài học', name: 'Bảng đen',
      bg: (c, W, H) => {
        solid(c, W, H, '#7a4b24');
        const m = W * 0.045;
        const g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
        g.addColorStop(0, '#2f5a43'); g.addColorStop(1, '#1d3a2b');
        c.fillStyle = g; c.fillRect(m, m, W - 2 * m, H - 2 * m);
        c.fillStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i < 40; i++) c.fillRect(m + ((i * 977) % (W - 2 * m)), m + ((i * 613) % (H - 2 * m)), W * 0.08, H * 0.002);
      },
      font: 'Be Vietnam Pro', weight: 700, color: '#f8fafc', lineHeight: 1.35, shadow: { color: 'rgba(255,255,255,0.25)', blur: 0.08 }, handleColor: '#e2e8f0',
    },
    {
      id: 'pastel', cat: 'Tối giản', name: 'Pastel',
      bg: (c, W, H) => linear(c, W, H, ['#fbc2eb', '#a6c1ee'], 160),
      font: 'Be Vietnam Pro', weight: 800, color: '#3b2f4a', lineHeight: 1.3, handleColor: '#3b2f4a',
    },
    {
      id: 'clean', cat: 'Tối giản', name: 'Tối giản sáng',
      bg: (c, W, H) => solid(c, W, H, '#fafafa'),
      font: 'Be Vietnam Pro', weight: 600, color: '#111', align: 'left', lineHeight: 1.35, handleColor: '#666',
    },
    {
      id: 'romance', cat: 'Trích dẫn', name: 'Lãng mạn',
      bg: (c, W, H) => linear(c, W, H, ['#3a1c71', '#9e3a52', '#a4522f'], 200), // was #ffaf7b: white text at 2.0:1
      font: 'Lobster', weight: 400, color: '#fff', shadow: { color: 'rgba(0,0,0,0.35)', blur: 0.18, y: 0.05 }, lineHeight: 1.35,
    },
    {
      id: 'darkquote', cat: 'Trích dẫn', name: 'Trích dẫn tối',
      bg: (c, W, H) => solid(c, W, H, '#121212'),
      font: 'Playfair Display', weight: 700, italic: true, color: '#f5f5f5', align: 'left', lineHeight: 1.3, quote: '#d4af37', handleColor: '#d4af37',
    },
    {
      id: 'aurora', cat: 'Nổi bật', name: 'Aurora',
      bg: (c, W, H) => {
        solid(c, W, H, '#070b1a');
        for (const [x, y, r, col] of [[0.2, 0.25, 0.6, 'rgba(34,211,238,0.45)'], [0.85, 0.45, 0.55, 'rgba(168,85,247,0.45)'], [0.35, 0.85, 0.6, 'rgba(16,185,129,0.4)']]) {
          const g = c.createRadialGradient(W * x, H * y, 0, W * x, H * y, Math.max(W, H) * r);
          g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = g; c.fillRect(0, 0, W, H);
        }
      },
      font: 'Be Vietnam Pro', weight: 800, color: '#fff', shadow: { color: 'rgba(0,0,0,0.5)', blur: 0.15 }, lineHeight: 1.25,
    },
    /* ---------- 2026 additions: word-level motion, retro texture, moving backgrounds, list / chat / quiz formats ---------- */
    {
      id: 'karaoke', cat: 'Phổ biến', name: 'Karaoke', anim: 'karaoke',
      bg: (c, W, H) => linear(c, W, H, ['#0b0b12', '#1a1030'], 170),
      font: 'Montserrat', weight: 900, color: '#fff', stroke: { color: '#000', w: 0.12 }, lineHeight: 1.2, upper: true,
    },
    {
      id: 'wordpop', cat: 'Phổ biến', name: 'Từng từ bật', anim: 'wordpop',
      bg: (c, W, H) => solid(c, W, H, '#111114'),
      font: 'Montserrat', weight: 900, color: '#fff', stroke: { color: '#000', w: 0.16 }, lineHeight: 1.2,
    },
    {
      id: 'meme', cat: 'Phổ biến', name: 'Meme', anim: 'zoom',
      bg: (c, W, H) => solid(c, W, H, '#ffffff'),
      font: 'Montserrat', weight: 900, color: '#000', upper: true, lineHeight: 1.15, handleColor: '#444',
    },
    {
      id: 'flow', cat: 'Chuyển động', name: 'Gradient chảy', moving: true, anim: 'rise',
      bg: (c, W, H, t = 0) => linear(c, W, H, ['#7b1fa2', '#c2185b', '#1565c0'], 120 + t * 24),
      font: 'Be Vietnam Pro', weight: 800, color: '#fff', shadow: { color: 'rgba(0,0,0,0.45)', blur: 0.12 }, lineHeight: 1.25,
    },
    {
      id: 'spotlight', cat: 'Chuyển động', name: 'Đèn sân khấu', moving: true, anim: 'zoom',
      bg: (c, W, H, t = 0) => {
        solid(c, W, H, '#050505');
        const x = W * (0.5 + 0.28 * Math.sin(t * 0.7)), y = H * (0.42 + 0.1 * Math.cos(t * 0.5));
        const g = c.createRadialGradient(x, y, 0, x, y, Math.max(W, H) * 0.45);
        g.addColorStop(0, 'rgba(255,236,190,0.26)'); g.addColorStop(1, 'rgba(255,236,190,0)');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      },
      font: 'Montserrat', weight: 800, color: '#fff', shadow: { color: 'rgba(0,0,0,0.6)', blur: 0.1 }, lineHeight: 1.2,
    },
    {
      id: 'bokeh', cat: 'Chuyển động', name: 'Bokeh', moving: true, anim: 'fade',
      bg: (c, W, H, t = 0) => {
        linear(c, W, H, ['#1b1030', '#2a1240'], 180);
        const r = Core.prng(11);
        for (let i = 0; i < 16; i++) {
          const x0 = r(), y0 = r(), sz = 0.04 + r() * 0.09, sp = 0.01 + r() * 0.02, hue = [330, 280, 40][i % 3];
          const x = W * x0, y = H * ((((y0 - t * sp) % 1) + 1) % 1), R = Math.min(W, H) * sz;
          const g = c.createRadialGradient(x, y, 0, x, y, R);
          g.addColorStop(0, `hsla(${hue},90%,70%,0.28)`); g.addColorStop(1, `hsla(${hue},90%,70%,0)`);
          c.fillStyle = g; c.fillRect(x - R, y - R, R * 2, R * 2);
        }
      },
      font: 'Playfair Display', weight: 700, italic: true, color: '#fff', shadow: { color: 'rgba(0,0,0,0.55)', blur: 0.14 }, lineHeight: 1.3,
    },
    {
      id: 'retro', cat: 'Retro', name: 'Phim cũ', moving: true, anim: 'fade',
      bg: (c, W, H, t = 0) => { solid(c, W, H, '#efe3c8'); grain(c, W, H, t, 0.35); vignette(c, W, H, 0.28); },
      font: 'Lora', weight: 600, italic: true, color: '#3b2a1a', lineHeight: 1.35, handleColor: '#4a3622',
    },
    {
      id: 'vhs', cat: 'Retro', name: 'Băng VHS', moving: true, anim: 'glitch',
      bg: (c, W, H, t = 0) => { linear(c, W, H, ['#14101f', '#1f1432'], 160); scanlines(c, W, H, t); },
      font: 'Roboto Mono', weight: 700, color: '#f5f5f5', glitch: true, upper: true, lineHeight: 1.25,
    },
    {
      id: 'cinema', cat: 'Kể chuyện', name: 'Điện ảnh', moving: true, bars: true, anim: 'fade',
      bg: (c, W, H, t = 0) => { linear(c, W, H, ['#1a1a1a', '#0b0b0b'], 180); grain(c, W, H, t, 0.12); },
      font: 'Lora', weight: 600, italic: true, color: '#f5f0e6', lineHeight: 1.35,
    },
    {
      id: 'handwrite', cat: 'Kể chuyện', name: 'Thư tay', anim: 'type',
      bg: (c, W, H) => {
        solid(c, W, H, '#fbf6ea');
        const step = Math.round(H / 26);
        c.fillStyle = 'rgba(70,110,180,0.18)';
        for (let y = step * 2; y < H; y += step) c.fillRect(0, y, W, Math.max(1, H / 900));
        c.fillStyle = 'rgba(220,80,80,0.3)'; c.fillRect(W * 0.09, 0, Math.max(1, W / 540), H);
      },
      font: 'Dancing Script', weight: 700, color: '#1f2a5a', align: 'left', lineHeight: 1.35, handleColor: '#3a4370',
    },
    {
      id: 'y2k', cat: 'Nổi bật', name: 'Y2K', anim: 'pop',
      bg: (c, W, H) => linear(c, W, H, ['#ffb8e0', '#c7d2fe', '#a7f3d0'], 135),
      font: 'Baloo 2', weight: 800, color: '#3b0764', gradText: ['#4c1d95', '#831843'], lineHeight: 1.2, handleColor: '#3b0764',
    },
    {
      id: 'gradtext', cat: 'Nổi bật', name: 'Chữ gradient', anim: 'rise',
      bg: (c, W, H) => solid(c, W, H, '#0a0a0a'),
      font: 'Montserrat', weight: 900, color: '#22d3ee', gradText: ['#22d3ee', '#a855f7', '#f472b6'], lineHeight: 1.2,
    },
    {
      id: 'glitchy', cat: 'Nổi bật', name: 'Glitch', anim: 'glitch',
      bg: (c, W, H) => solid(c, W, H, '#050510'),
      font: 'Roboto Mono', weight: 700, color: '#e5e7eb', glitch: true, lineHeight: 1.25,
    },
    {
      id: 'chat', cat: 'Tin nhắn', name: 'Tin nhắn', anim: 'rise',
      bg: (c, W, H) => solid(c, W, H, '#f2f2f7'),
      font: 'Be Vietnam Pro', weight: 600, color: '#fff', box: { fill: '#0060df', pad: 0.45, radius: 0.6 }, align: 'left', lineHeight: 1.6, handleColor: '#555',
    },
    {
      id: 'sticky', cat: 'Bài học', name: 'Giấy nhớ', anim: 'pop',
      bg: (c, W, H) => linear(c, W, H, ['#2b2d42', '#1d1e2c'], 160),
      font: 'Baloo 2', weight: 800, color: '#2b2100', note: { fill: '#ffe066', tilt: -2.5 }, lineHeight: 1.25,
    },
    {
      id: 'quiz', cat: 'Câu đố', name: 'Câu đố', anim: 'wordpop',
      bg: (c, W, H) => linear(c, W, H, ['#0891b2', '#1d4ed8'], 150),
      font: 'Baloo 2', weight: 800, color: '#0f172a', box: { fill: '#ffffff', pad: 0.35, radius: 0.3 }, lineHeight: 1.45,
    },
    {
      id: 'toplist', cat: 'Top list', name: 'Top list', anim: 'zoom', bigNum: '#fe2c55',
      bg: (c, W, H) => solid(c, W, H, '#101014'),
      font: 'Montserrat', weight: 900, color: '#fff', stroke: { color: '#000', w: 0.1 }, upper: true, lineHeight: 1.2,
    },
  ];

  let tpl = TEMPLATES[0];
  let audio = null, audioName = '', audioFile = '';
  let taps = [];   // "Theo lúc tôi bấm": slide changes in seconds from the music start
  let tapsFor = 0; // …recorded for this many slides: other counts would shift every slide onto the wrong tap
  let sel = 0;     // slide shown in the preview

  function updateAudioInfo() {
    const box = $('tvAudioInfo');
    box.textContent = '';
    $('tvTapStart').disabled = !audio;
    if (!audio) return;
    const span = document.createElement('span');
    span.textContent = `🎵 ${audioFile} — ${formatTime(audio.duration)} `;
    const x = document.createElement('button');
    x.textContent = 'Bỏ audio';
    x.onclick = () => { finishRec(false); audio = null; audioName = ''; taps = []; updateAudioInfo(); refresh(); if (rw) rw.refresh(); loud.refresh(); };
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
      hook: $('tvHook').value.trim(),
      counter: $('tvCounter').checked,
      hiColor: $('tvHi').value,
    };
  }

  function fontStr(t, o, fs) {
    return `${t.italic ? 'italic ' : ''}${t.weight} ${fs}px "${o.font || t.font}", "Be Vietnam Pro", sans-serif`;
  }

  /**
   * Where the slide text may go. 9:16: between the hook / counter and the handle, always inside 18 %–77 %
   * of the height (TikTok / Reels / Shorts cover the top bar and the bottom quarter).
   */
  /** Size of a pill (dark glass, white text, ≤ 2 lines). */
  function measurePill(ctx, text, fs, maxW) {
    ctx.save();
    ctx.font = `700 ${fs}px "Be Vietnam Pro", sans-serif`;
    const lines = Core.clampLines(ctx, text, maxW, 2);
    const lh = fs * 1.3, padX = fs * 0.6, padY = fs * 0.35;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
    ctx.restore();
    return { lines, fs, lh, padY, w, h: lines.length * lh + padY * 2 };
  }

  /**
   * Hook and counter boxes, measured: the counter sits under the hook's REAL bottom (a 2-line hook used to
   * run into it in 4:5 / 1:1 / 16:9). 9:16 starts at 12 % — below TikTok's top bar (6.8 %).
   */
  function header(ctx, W, H, o, n) {
    const u = Math.min(W, H) / 1080, port = H > W;
    let y = H * (port ? 0.12 : 0.04);
    const out = { bottom: 0 };
    if (o.hook) {
      out.hook = { ...measurePill(ctx, o.hook, Math.round(50 * u), W * (port ? 0.62 : 0.7)), top: y };
      y += out.hook.h + 12 * u;
      out.bottom = out.hook.top + out.hook.h;
    }
    if (o.counter && n > 1) {
      out.counter = { ...measurePill(ctx, `${n}/${n}`, Math.round(34 * u), W * 0.3), top: y };
      out.bottom = y + out.counter.h;
    }
    return out;
  }

  /**
   * Where the slide text may go. 9:16: between the header and the handle, always inside 18 %–77 %
   * of the height (TikTok / Reels / Shorts cover the top bar and the bottom quarter).
   */
  function region(ctx, W, H, o, n) {
    const hb = header(ctx, W, H, o, n).bottom / H;
    const gap = hb ? hb + 0.03 : 0;
    if (H > W) {
      const top = Math.max(0.18, gap), bot = o.handle ? 0.71 : 0.77;
      return { cy: H * (top + bot) / 2, maxH: H * (bot - top) };
    }
    const top = Math.max(W > H ? 0.15 : 0.2, gap), bot = W > H ? 0.85 : 0.8;
    return { cy: H * (top + bot) / 2, maxH: H * (bot - top) };
  }

  function layout(ctx, text, t, o, W, H, n = 1) {
    const R = region(ctx, W, H, o, n);
    const key = [text, W, H, t.id, o.font, o.maxSize, R.cy, R.maxH].join('|');
    if (layoutCache.has(key)) return layoutCache.get(key);
    const hw = Core.highlightWords(text);
    const str = t.upper ? hw.plain.toUpperCase() : hw.plain;
    // upper-case keeps a / b (the starred part) when the length is unchanged — always for Vietnamese
    const words = t.upper ? hw.words.map((w) => { const up = w.w.toUpperCase(); return up.length === w.w.length ? { ...w, w: up } : { w: up, hi: w.hi }; }) : hw.words;
    // 9:16: 14 %–86 % of the width — TikTok's like / comment / share column covers the right 14 %
    const base0 = o.maxSize * Math.min(W, H) / 1080;
    // 9:16: glyphs AND the boxes around them (line box / keyword box) inside 14 %–86 % of the width —
    // TikTok's like / comment / share column covers the right 14 %
    const maxW = H > W ? Math.max(W * 0.4, W * 0.72 - 2 * base0 * (t.box ? t.box.pad : 0.12)) : W * (t.box ? 0.76 : 0.82);
    const maxH = R.maxH;
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
    const L = { lines, fs, lh, asc, desc, maxW, cy: R.cy, runs: Core.lineHighlights(lines, words), widths: lines.map((l) => ctx.measureText(l).width) };
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
  /** `time` (s) drives the moving template backgrounds: a pure function of time, so preview = export. */
  function drawBackground(ctx, W, H, t, o, bg, time = 0) {
    if (o.bgMode === 'color') solid(ctx, W, H, o.bgColor);
    else if (o.bgMode === 'image' && bg) {
      solid(ctx, W, H, '#000');
      drawImageFit(ctx, bg.img, bg.w, bg.h, 0, 0, W, H, 'cover');
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.fillRect(0, 0, W, H);
    } else t.bg(ctx, W, H, time);
  }

  /** Template extras over the background: big slide number (Top list), cinema bars. */
  function drawDecor(ctx, W, H, t, o, k, time) {
    if (t.bigNum) {
      ctx.save();
      const fsN = Math.min(W, H) * 0.62;
      ctx.font = `900 ${fsN}px "Montserrat", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = t.bigNum;
      ctx.fillText(String(k + 1), W / 2, H * 0.47);
      ctx.restore();
    }
    if (t.bars) {
      const b = H * (H > W ? 0.09 : 0.1);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, b);
      ctx.fillRect(0, H - b, W, b);
    }
  }

  const easeOutBack = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);

  /** Pill with white text on dark glass: readable (≥ 4.5:1) on any background. */
  function drawPill(ctx, m, cx, top) {
    ctx.save();
    ctx.font = `700 ${m.fs}px "Be Vietnam Pro", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    roundRect(ctx, cx - m.w / 2, top, m.w, m.h, Math.min(m.h / 2, m.fs * 0.7));
    ctx.fill();
    ctx.fillStyle = '#fff';
    m.lines.forEach((l, i) => ctx.fillText(l, cx, top + m.padY + m.lh * (i + 0.5)));
    ctx.restore();
  }

  /** Hook (fixed opening line) and "2/5" counter, inside the top safe area. */
  function drawHeader(ctx, W, H, o, k, n) {
    const h = header(ctx, W, H, o, n);
    if (h.hook) drawPill(ctx, h.hook, W / 2, h.hook.top);
    if (h.counter) {
      const m = measurePill(ctx, `${k + 1}/${n}`, h.counter.fs, W * 0.3);
      drawPill(ctx, m, W / 2, h.counter.top);
    }
  }

  /** Cut runs [{t,hi}] down to the first `len` characters (the visible part while typing / word by word). */
  function clipRuns(runs, len) {
    const out = [];
    for (const r of runs) {
      if (len <= 0) break;
      out.push(r.t.length <= len ? r : { t: r.t.slice(0, len), hi: r.hi });
      len -= r.t.length;
    }
    return out;
  }

  /** Runs [{t,hi}] restricted to characters [from, to) of the line. */
  function sliceRuns(runs, from, to) {
    const out = [];
    let p = 0;
    for (const r of runs) {
      const a = Math.max(from, p), b = Math.min(to, p + r.t.length);
      if (b > a) out.push({ t: r.t.slice(a - p, b - p), hi: r.hi });
      p += r.t.length;
    }
    return out;
  }

  /**
   * Draw one slide. `a` = animation progress 0..1 (1 = fully shown).
   * `blink` toggles the cursor of the "Hacker" template. `k` / `n` = slide number / count (counter).
   * `t` / `bg` are passed explicitly so a running render is not affected by UI changes.
   */
  function drawSlide(ctx, W, H, text, o, a = 1, blink = true, t = tpl, bg = bgImage, k = 0, n = 1, time = 0) {
    drawBackground(ctx, W, H, t, o, bg, time);
    drawDecor(ctx, W, H, t, o, k, time);
    const col = colorsFor(t, o);
    const L = layout(ctx, text, t, o, W, H, n);
    const { lines, fs, lh } = L;
    const align = o.align || t.align || 'center';
    const blockH = lines.length * lh;
    const y0 = L.cy - blockH / 2 + lh / 2;
    const left = (W - L.maxW) / 2;
    const u = Math.min(W, H) / 1080;
    // Optical centre between the real top of accents and the bottom of descenders.
    const yShift = (L.asc - L.desc) / 2;
    const hiCol = o.hiColor || '#ffd60a';
    const hiInk = Core.contrast(hiCol, '#000000') >= Core.contrast(hiCol, '#ffffff') ? '#000' : '#fff'; // ≥ 4.58:1 always

    // reveal (type / word / karaoke / wordpop), counted in graphemes so emoji & accents never split
    const anim = o.anim;
    const gLines = anim === 'type' ? lines.map(graphemes) : null;
    let charsLeft = gLines ? Math.floor(a * gLines.reduce((s, g) => s + g.length, 0)) : Infinity;
    const byWord = anim === 'word' || anim === 'karaoke' || anim === 'wordpop';
    const WR = byWord ? Core.wordReveal(lines.map((l) => l.split(' ').filter(Boolean).length), a) : null;
    let wordsLeft = WR ? WR.shown : Infinity;
    let wordIdx = 0; // global index of the first word of the current line

    ctx.save();
    const e = Math.min(1, a);
    if (anim === 'pop') {
      const s = 0.6 + 0.4 * easeOutBack(e);
      ctx.globalAlpha = Math.min(1, e * 2);
      ctx.translate(W / 2, L.cy); ctx.scale(s, s); ctx.translate(-W / 2, -L.cy);
    } else if (anim === 'zoom') {
      const s = 1 + 0.35 * (1 - easeOut(e)); // lands from big to its size
      ctx.globalAlpha = easeOut(e);
      ctx.translate(W / 2, L.cy); ctx.scale(s, s); ctx.translate(-W / 2, -L.cy);
    } else if (anim === 'fade') {
      ctx.globalAlpha = easeOut(e);
    } else if (anim === 'slide') {
      ctx.globalAlpha = easeOut(e);
      ctx.translate(0, 120 * u * (1 - easeOut(e)));
    }
    const baseAlpha = ctx.globalAlpha;
    // "Glitch" entrance: RGB split + sideways jitter that settles (deterministic: same a → same frame)
    const glitchAmt = anim === 'glitch' ? 1 - easeOut(e) : 0;

    if (t.note) {
      // sticky note behind the whole block, slightly tilted
      const wMax = Math.max(...L.widths), padN = fs * 0.7;
      const nx = (align === 'left' ? left : W / 2 - wMax / 2) - padN, ny = y0 - lh / 2 - padN * 0.8;
      ctx.save();
      ctx.translate(W / 2, L.cy); ctx.rotate((t.note.tilt * Math.PI) / 180); ctx.translate(-W / 2, -L.cy);
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = fs * 0.4; ctx.shadowOffsetY = fs * 0.12;
      ctx.fillStyle = t.note.fill;
      ctx.fillRect(nx, ny, wMax + padN * 2, blockH + padN * 1.6);
      ctx.restore();
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
    const gradOn = t.gradText && o.bgMode === 'tpl';

    const plainRun = (s, x, y, w) => {
      if (t.glitch || glitchAmt > 0.01) {
        const d = fs * (t.glitch ? 0.05 : 0) + fs * 0.22 * glitchAmt;
        const ga = ctx.globalAlpha;
        if (glitchAmt > 0.01) ctx.globalAlpha = ga * 0.8;
        ctx.fillStyle = TIKTOK_CYAN; ctx.fillText(s, x - d, y - d * 0.5);
        ctx.fillStyle = TIKTOK_RED; ctx.fillText(s, x + d, y + d * 0.5);
        ctx.globalAlpha = ga;
      }
      if (t.shadow) {
        ctx.shadowColor = t.shadow.color;
        ctx.shadowBlur = fs * t.shadow.blur;
        ctx.shadowOffsetY = fs * (t.shadow.y || 0);
      }
      if (col.stroke) {
        ctx.strokeStyle = col.stroke.color;
        ctx.lineWidth = fs * col.stroke.w;
        ctx.strokeText(s, x, y);
      }
      if (gradOn) {
        const g = ctx.createLinearGradient(x, y - fs / 2, x + Math.max(w, fs), y + fs / 2);
        t.gradText.forEach((c, i) => g.addColorStop(i / (t.gradText.length - 1), c));
        ctx.fillStyle = g;
      } else ctx.fillStyle = col.text;
      ctx.fillText(s, x, y);
      if (t.shadow && t.shadow.blur > 0.3) ctx.fillText(s, x, y); // stronger glow
      ctx.shadowColor = 'transparent';
    };
    // keyword: solid box in the highlight colour, dark or white ink by contrast (no stroke / glitch on it)
    const hiRun = (s, x, y, w) => {
      const p = fs * 0.12;
      ctx.fillStyle = o.hiColor || '#ffd60a';
      roundRect(ctx, x - p, y - L.asc - p * 0.8, w + p * 2, L.asc + L.desc + p * 1.6, fs * 0.16);
      ctx.fill();
      ctx.fillStyle = hiInk;
      ctx.fillText(s, x, y);
    };
    const drawRuns = (runs, x, y) => {
      for (const r of runs) {
        const rw = ctx.measureText(r.t).width;
        if (r.hi) hiRun(r.t, x, y, rw); else plainRun(r.t, x, y, rw);
        x += rw;
      }
      return x;
    };

    for (let i = 0; i < lines.length; i++) {
      const full = lines[i];
      const nWords = full.split(' ').filter(Boolean).length;
      let line = full;
      if (gLines) {
        line = gLines[i].slice(0, Math.max(0, charsLeft)).join('');
        charsLeft -= gLines[i].length;
      }
      if (wordsLeft !== Infinity) {
        const ws = full.split(' ').filter(Boolean);
        line = ws.slice(0, Math.max(0, wordsLeft)).join(' ');
        wordsLeft -= ws.length;
      }
      const yMid = y0 + i * lh;
      let y = yMid + yShift;
      const x = align === 'left' ? left : W / 2 - L.widths[i] / 2;
      ctx.save();
      if (anim === 'rise') {
        // lines rise one after another
        const p = easeOut(Core.lineStagger(i, lines.length, a));
        ctx.globalAlpha = baseAlpha * p;
        y += 70 * u * (1 - p);
      }
      if (glitchAmt > 0.01) {
        const r = Core.prng(i * 7919 + Math.round(a * 30))();
        ctx.translate((r - 0.5) * fs * 0.6 * glitchAmt, 0);
      }
      if (anim === 'karaoke' && full && a < 1) {
        // the whole line waits, dimmed; words light up as they are "sung"
        ctx.globalAlpha = baseAlpha * 0.32;
        drawRuns(L.runs[i], x, y);
        ctx.globalAlpha = baseAlpha;
      }
      if (line) {
        const w = ctx.measureText(line).width;
        if (t.box) {
          const boxW = anim === 'karaoke' ? L.widths[i] : w;
          const pad = fs * t.box.pad;
          const top = y - L.asc - pad * 0.5;
          const hgt = L.asc + L.desc + pad;
          ctx.fillStyle = t.box.fill;
          roundRect(ctx, x - pad, top, boxW + pad * 2, hgt, Math.min(hgt / 2, fs * t.box.radius));
          ctx.fill();
        }
        const runs = clipRuns(L.runs[i], line.length);
        const cur = WR ? WR.cur - wordIdx : -1; // index (in this line) of the word appearing now
        if (anim === 'wordpop' && cur >= 0 && cur < nWords && WR.p < 1) {
          // earlier words as they are; the newest word grows in from small (the "word pop" caption look)
          const ws = line.split(' ');
          const from = ws.slice(0, cur).join(' ').length + (cur ? 1 : 0);
          const xw = drawRuns(clipRuns(L.runs[i], from), x, y);
          const wRun = sliceRuns(L.runs[i], from, line.length);
          const ww = ctx.measureText(line.slice(from)).width;
          const sc = 0.35 + 0.65 * easeOutBack(WR.p);
          ctx.save();
          ctx.globalAlpha = ctx.globalAlpha * Math.min(1, WR.p * 2.5);
          ctx.translate(xw + ww / 2, y); ctx.scale(sc, sc); ctx.translate(-(xw + ww / 2), -y);
          drawRuns(wRun, xw, y);
          ctx.restore();
        } else drawRuns(runs, x, y);
        lastX = x + w;
        lastY = y;
      }
      ctx.restore();
      wordIdx += nWords;
    }
    if (t.cursor && blink) {
      ctx.fillStyle = col.text;
      ctx.fillRect(lastX + fs * 0.1, lastY - fs * 0.45, fs * 0.5, fs * 0.9);
    }
    ctx.restore();

    drawHeader(ctx, W, H, o, k, n);
    if (o.handle) {
      ctx.save();
      ctx.font = `600 ${Math.round(38 * u)}px "Be Vietnam Pro", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = col.handle; // full opacity: 0.85 fell under 4.5:1 on the light templates
      // 9:16: just above the bottom quarter that TikTok's caption covers (it used to sit at 91 % — hidden)
      ctx.fillText(o.handle, W / 2, H > W ? H * 0.74 : H - 80 * u);
      ctx.restore();
    }
  }

  /* ---------------- timing ---------------- */
  function slides() {
    return Core.splitSlides($('tvText').value);
  }

  /** Where the music starts (s), never past its end. */
  function musicStart() {
    if (!audio) return 0;
    return Math.min(Math.max(0, +$('tvStart').value || 0), Math.max(0, audio.duration - 1));
  }

  // drum hits of the chosen part of the song: measured once per (song, start), not on every keystroke
  // once per song (not per start: typing "Bắt đầu nhạc từ" re-measured a 5-min song on every key, ~0.6 s each)
  let beatCache = { buf: null, list: [] };
  function onsets() {
    if (!audio) return [];
    if (beatCache.buf !== audio) {
      const ch = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
      beatCache = { buf: audio, list: Core.bassOnsets(ch, audio.sampleRate) };
    }
    const start = musicStart();
    return beatCache.list.filter((o) => o.t >= start).map((o) => ({ ...o, t: o.t - start }));
  }

  /** → { sl, n, starts, duration, snapped, mode } — when each slide starts (seconds from the video start). */
  function timing() {
    const sl = slides();
    const mode = $('tvSync').value;
    const avail = audio ? Math.max(0, audio.duration - musicStart()) : 0;
    const stale = mode === 'tap' && taps.length > 0 && tapsFor !== sl.length;
    const p = Core.slidePlan({
      // "Mỗi slide" has no meaning once the user taps the changes: the whole song plays
      n: sl.length, mode, fixedSeg: mode === 'tap' ? 0 : +$('tvSlideDur').value || 0, audioDur: avail,
      onsets: mode === 'beat' && audio ? onsets() : [], taps: mode === 'tap' && !stale ? taps : [],
    });
    return { sl, n: Math.max(1, sl.length), mode, stale, ...p };
  }

  /** Animation progress of slide k at `local` seconds into it (slide length `seg`). */
  function animAt(o, local, seg) {
    if (o.anim === 'karaoke') return Math.min(1, local / Math.max(0.3, seg * 0.85)); // lights up over the whole slide
    if (o.anim === 'type' || o.anim === 'word' || o.anim === 'wordpop') return Math.min(1, local / Math.max(0.3, seg * 0.6));
    if (o.anim === 'rise') return Math.min(1, local / Math.min(0.9, seg * 0.6));
    if (o.anim !== 'none') return Math.min(1, local / Math.min(0.55, seg / 2));
    return 1;
  }

  /** draw(ctx, time) for a plan; `slideFor(time)` → {k, from, seg}. Fully shown slides are drawn once, then copied. */
  function makeDraw(W, H, o, sl, n, duration, slideFor) {
    const t = tpl, bg = bgImage; // snapshot: UI changes during a render must not leak into it
    const bar = Math.max(6, Math.round(10 * Math.min(W, H) / 1080));
    const moving = !!t.moving && o.bgMode === 'tpl';
    let still = null;
    return (ctx, time) => {
      const { k, from, seg } = slideFor(time);
      const a = animAt(o, time - from, seg);
      const blink = Math.floor(time * 2) % 2 === 0;
      if (moving) drawSlide(ctx, W, H, sl[k] || '', o, a, blink, t, bg, k, n, time); // moving background: every frame
      else if (a >= 1) {
        const key = k + '|' + (t.cursor ? blink : '');
        if (!still || still.key !== key) {
          if (!still) still = { c: makeCanvas(W, H) };
          drawSlide(still.c.getContext('2d'), W, H, sl[k] || '', o, 1, blink, t, bg, k, n);
          still.key = key;
        }
        ctx.drawImage(still.c, 0, 0);
      } else drawSlide(ctx, W, H, sl[k] || '', o, a, blink, t, bg, k, n);
      if (o.progress) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(0, H - bar, W, bar);
        ctx.fillStyle = TIKTOK_RED;
        ctx.fillRect(0, H - bar, W * Math.min(1, time / duration), bar);
      }
    };
  }

  function makeScene() {
    const size = getSize($('tvSizeSel'));
    const o = opts();
    const { sl, n, starts, duration } = timing();
    const W = size.w, H = size.h;
    const slideFor = (time) => {
      const k = Core.slideAt(starts, time);
      return { k, from: starts[k], seg: (k + 1 < starts.length ? Math.min(starts[k + 1], duration) : duration) - starts[k] };
    };
    return { width: W, height: H, fps: +$('tvFps').value, duration, draw: makeDraw(W, H, o, sl, n, duration, slideFor), audio, audioOffset: musicStart() };
  }

  /* ---------------- fonts ---------------- */
  async function ensureFonts() {
    // Load exactly the faces the canvas will ask for (each template × each font choice), plus handle & quote mark.
    const fams = ['', 'Be Vietnam Pro', 'Montserrat', 'Playfair Display', 'Lobster', 'Roboto Mono', 'Lora', 'Baloo 2', 'Dancing Script'];
    const specs = new Set(['600 40px "Be Vietnam Pro"', '700 40px "Playfair Display"']);
    for (const t of TEMPLATES) for (const f of fams) specs.add(fontStr(t, { font: f }, 40));
    const sample = 'AaĂâđêôơưỔẶ' + $('tvText').value.slice(0, 200);
    try {
      await Promise.all([...specs].map((sp) => document.fonts.load(sp, sample)));
    } catch (_) {}
    layoutCache.clear();
  }

  /* ---------------- preview + slide list ---------------- */
  function currentSlide() {
    const sl = slides();
    sel = Math.max(0, Math.min(sl.length - 1, sel));
    return { text: sl[sel] || '', k: sel, n: sl.length };
  }

  function preview() {
    if (player.playing) return;
    const size = getSize($('tvSizeSel'));
    canvas.width = size.w;
    canvas.height = size.h;
    const { text, k, n } = currentSlide();
    drawSlide(canvas.getContext('2d'), size.w, size.h, text, opts(), 1, true, tpl, bgImage, k, n);
  }

  const fmt = (x) => x.toFixed(1).replace('.', ',');
  const clock = (x) => formatTime(Math.round(x * 10) / 10); // 7.99998 s of audio reads 0:08, not 0:07
  /** One row per slide: number, first words, when it shows, and a warning when it is too short to read. */
  function renderSlides() {
    const T = timing();
    sel = Math.max(0, Math.min(T.sl.length - 1, sel)); // before drawing the list: a deleted slide leaves no active row
    const warn = new Map(Core.readWarnings(T.sl, T.starts, T.duration).map((w) => [w.i, w]));
    const list = $('tvSlides');
    list.textContent = '';
    T.sl.forEach((txt, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.k = i;
      b.className = 'slide-item' + (i === sel ? ' active' : '') + (warn.has(i) ? ' warn' : '');
      b.setAttribute('aria-current', i === sel ? 'true' : 'false');
      const num = document.createElement('span'); num.className = 'si-num'; num.textContent = i + 1;
      const tx = document.createElement('span'); tx.className = 'si-text'; tx.textContent = txt.replace(/\*/g, '').replace(/\s+/g, ' ');
      const tm = document.createElement('span'); tm.className = 'si-time';
      const end = Math.min(T.duration, i + 1 < T.starts.length ? T.starts[i + 1] : T.duration);
      const w = warn.get(i);
      tm.textContent = w && w.hidden ? '⚠️ không hiện — video hết trước' :
        `${clock(T.starts[i])}–${clock(end)}` + (w ? ` · ⚠️ cần ~${fmt(w.need)}s để đọc, đang ${fmt(w.have)}s` : '');
      b.append(num, tx, tm);
      li.append(b);
      list.append(li);
    });
    const nw = warn.size;
    $('tvSlidesSum').textContent = `— ${T.sl.length} slide · ${clock(T.duration)}` + (nw ? ` · ⚠️ ${nw} slide quá nhanh` : '');
    // sync mode explanation
    const info = $('tvSyncInfo');
    $('tvTapRow').hidden = T.mode !== 'tap';
    $('tvSlideDur').disabled = T.mode === 'tap';
    const fixed = +$('tvSlideDur').value || 0;
    $('tvDurHint').textContent = T.mode === 'tap' ? 'Không dùng khi tự bấm: video dài hết đoạn nhạc.' :
      fixed && audio ? `Video dài ${fmt(Math.min(fixed * T.n, T.duration))}s (${T.n} × ${fmt(fixed)}s) — nhạc bị cắt bớt nếu dài hơn.` :
        'Để trống = chia đều cả đoạn nhạc.';
    if (rec) {
      info.textContent = 'Đang ghi — chạm "Chuyển slide" mỗi khi muốn sang slide mới; bấm ■ Dừng ghi để kết thúc.';
    } else if (T.mode === 'beat') {
      info.textContent = !audio ? 'Chọn audio để khớp nhịp.' :
        T.tooShort ? 'Slide ngắn hơn 1 giây — không đủ chỗ để dời theo nhịp, đang chia đều.' :
        T.snapped ? `🥁 ${T.snapped}/${Math.max(0, T.n - 1)} lần chuyển slide rơi đúng nhịp trống.` :
          'Không tìm thấy nhịp trống rõ (nhạc nhẹ / giọng nói) — đang chia đều.';
    } else if (T.mode === 'tap') {
      const used = Math.min(taps.length, T.n - 1);
      info.textContent = !audio ? 'Chọn audio, rồi bấm 🎯 và chạm "Chuyển slide" đúng lúc trong nhạc.' :
        T.stale ? `⚠️ Số slide đã đổi (${tapsFor} → ${T.n}) — các lần bấm cũ sẽ lệch slide nên tạm bỏ qua. Bấm 🎯 để ghi lại.` :
        used ? `Đã ghi ${used}/${T.n - 1} lần chuyển. Ghi lại bất cứ lúc nào.` : 'Chưa ghi — bấm 🎯, nghe nhạc và chạm "Chuyển slide" mỗi khi muốn sang slide mới.';
    } else info.textContent = '';
  }

  let rq = 0;
  /** Coalesce bursts of input events into one redraw per frame (typing stays smooth on phones). */
  function refresh() {
    if (rq) return;
    rq = requestAnimationFrame(() => { rq = 0; renderSlides(); preview(); });
  }

  /* ---------------- templates (shared picker: categories, thumbnails, "Mẫu của tôi") ---------------- */
  const TV_CONTROLS = ['tvFont', 'tvSize', 'tvAlign', 'tvAnim', 'tvBgMode', 'tvBgColor', 'tvHandle', 'tvProgress', 'tvHi', 'tvCounter'];
  const optsFrom = (set) => ({
    ...opts(), font: set.tvFont || '', align: set.tvAlign || '', handle: '', hook: '', counter: false, maxSize: 150,
    bgMode: set.tvBgMode && set.tvBgMode !== 'image' ? set.tvBgMode : 'tpl', bgColor: set.tvBgColor || '#000000',
  });
  const baseOf = (t) => TEMPLATES.find((x) => x.id === (t.style && t.style.base)) || TEMPLATES[0];
  let picker = null;
  function renderTemplatePicker() {
    if (picker) return picker.refresh();
    picker = Templates.mount({
      box: $('tvTemplates'),
      key: 'tv',
      // built-ins reset what a saved template may have changed (font, alignment, background)
      builtins: TEMPLATES.map((t) => ({ id: t.id, name: t.name, cat: t.cat, set: { tvFont: '', tvAlign: '', tvBgMode: 'tpl', tvAnim: t.anim || 'pop' }, style: { base: t.id } })),
      thumb: (t, ctx, W, H) => drawSlide(ctx, W, H, 'Xin chào\nTikTok', optsFrom(t.set || {}), 1, true, baseOf(t), null),
      apply: (t) => { tpl = baseOf(t); refresh(); },
      controls: TV_CONTROLS,
      captureStyle: () => ({ base: tpl.id }),
      activeId: tpl.id,
    });
  }

  /* ---------------- events ---------------- */
  ['tvText', 'tvFont', 'tvSize', 'tvAlign', 'tvBgColor', 'tvHandle', 'tvSizeSel', 'tvProgress', 'tvHook', 'tvCounter', 'tvHi', 'tvSlideDur', 'tvSync', 'tvAnim'].forEach((id) =>
    $(id).addEventListener('input', refresh)
  );
  $('tvText').addEventListener('change', () => ensureFonts().then(refresh));
  ['tvSlideDur', 'tvSync', 'tvStart'].forEach((id) => $(id).addEventListener('change', () => { if (rw) rw.refresh(); loud.refresh(); }));
  $('tvStart').addEventListener('input', () => {
    finishRec(false);
    if (taps.length) { taps = []; toast('Đã đổi đoạn nhạc — hãy ghi lại lúc chuyển slide.'); }
    refresh();
  });
  $('tvStart').addEventListener('change', () => {
    // past the end: show the value really used instead of silently making a 1-second video
    if (audio && +$('tvStart').value > musicStart()) {
      $('tvStart').value = Math.floor(musicStart() * 10) / 10;
      toast(`Bài dài ${formatTime(audio.duration)} — nhạc bắt đầu muộn nhất ở giây ${Math.floor(musicStart())}.`);
      refresh();
    }
  });
  $('tvSlides').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    sel = +b.dataset.k;
    // only move the highlight (rebuilding the list dropped keyboard / screen-reader focus to <body>)
    $('tvSlides').querySelectorAll('button[data-k]').forEach((x) => {
      const on = +x.dataset.k === sel;
      x.classList.toggle('active', on);
      x.setAttribute('aria-current', on ? 'true' : 'false');
    });
    preview(); // at once: a tap on the list never waits for a coalesced frame
  });
  $('tvBgMode').onchange = () => {
    $('tvBgImgWrap').hidden = $('tvBgMode').value !== 'image';
    refresh();
  };
  onFiles('tvBgImg', async ([f]) => {
    try { bgImage = await readImage(f); refresh(); } catch (e) { toast(e.message); }
  });
  const loud = Loudness.mount('tvLoud', () => (audio ? { audio, offset: musicStart(), duration: timing().duration } : null));
  onFiles('tvAudio', async ([f]) => {
    $('tvAudioInfo').textContent = 'Đang đọc audio…';
    try {
      finishRec(false);
      audio = await decodeAudioFile(f);
      audioName = baseName(f.name);
      audioFile = f.name;
      taps = [];
      $('tvStart').max = Math.floor((audio.duration - 1) * 10) / 10;
      updateAudioInfo();
      refresh();
      if (rw) rw.refresh();
      loud.refresh();
    } catch (e) {
      audio = null;
      $('tvAudioInfo').textContent = e.message;
    }
  });

  /* ---------------- "Theo lúc tôi bấm": listen and tap where each slide should start ---------------- */
  let rec = null; // { taps, n, now }
  // changing these mid-recording would hide the stop button or move the slides under the user's taps
  const REC_LOCK = ['tvSync', 'tvText', 'tvStart', 'tvSlideDur', 'tvAudio'];
  function tapLabel() {
    if (rec) $('tvTap').textContent = `👆 Chuyển slide → ${Math.min(rec.n, rec.taps.length + 2)}/${rec.n}`;
  }
  /** Stop recording; keep what was tapped unless the song / start changed under it (`keep` = false). */
  function finishRec(keep = true) {
    if (!rec) return;
    const r = rec;
    rec = null;
    clearTimeout(r.timer);
    player.stop();
    if (keep && r.taps.length && r.audio === audio && r.start === musicStart()) { taps = r.taps.slice(); tapsFor = r.n; }
    $('tvTap').hidden = true;
    REC_LOCK.forEach((id) => { $(id).disabled = false; });
    document.body.classList.remove('tv-recording');
    $('tvTapStart').textContent = '🎯 Nghe & bấm để chuyển slide';
    $('tvPlay').textContent = '▶ Xem thử';
    refresh();
    if (rw) rw.refresh();
  }
  /** Seconds into the song the user HEARS now (Bluetooth / AirPods play 150–250 ms after the audio clock). */
  const heardAt = () => { const a = audioCtx(); return a.currentTime - (a.outputLatency || 0) - player.t0; };
  function tap() {
    if (!rec || !player.playing) return;
    // the audio clock, not the last drawn frame: a slow frame on a phone made taps up to 0.5 s late
    const t = heardAt(), last = rec.taps.length ? rec.taps[rec.taps.length - 1] : 0;
    if (t - last < Core.MIN_SLIDE) return; // double tap
    rec.taps.push(t);
    tapLabel();
    if (rec.taps.length >= rec.n - 1 && !rec.timer) { const r = rec; r.timer = setTimeout(() => rec === r && finishRec(), 600); } // show the last change briefly
  }
  $('tvTapStart').onclick = async () => {
    if (rec) return finishRec();
    const sl = slides();
    if (!audio) return toast('Hãy chọn audio trước');
    if (sl.length < 2) return toast('Cần ít nhất 2 slide (cách nhau bởi một dòng trống)');
    audioCtx().resume(); // inside the tap, before any await (iOS)
    const size = getSize($('tvSizeSel')), o = opts(), n = sl.length;
    const duration = Math.max(1, audio.duration - musicStart());
    const r = (rec = { taps: [], n, now: 0, audio, start: musicStart() });
    const slideFor = (time) => {
      const k = Core.slideAt([0, ...r.taps], time);
      return { k, from: k ? r.taps[k - 1] : 0, seg: 3 };
    };
    const gain = await loud.gain();
    if (rec !== r) return; // stopped (▶ / tab change) while the loudness was being measured
    const sc = { width: size.w, height: size.h, fps: 30, duration, audio, audioOffset: musicStart(), gain, draw: makeDraw(size.w, size.h, o, sl, n, duration, slideFor) };
    canvas.width = sc.width; canvas.height = sc.height;
    $('tvTapStart').textContent = '■ Dừng ghi';
    $('tvTap').hidden = false;
    REC_LOCK.forEach((id) => { $(id).disabled = true; });
    document.body.classList.add('tv-recording');
    renderSlides();
    tapLabel();
    $('tvTap').focus();
    player.play(sc, (t) => { if (t < 0) finishRec(); else r.now = t; });
  };
  // pointerdown, not click: the change lands when the finger touches, not 100–300 ms later when it lifts
  $('tvTap').addEventListener('pointerdown', (e) => { e.preventDefault(); tap(); });
  $('tvTap').addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); tap(); } });
  document.addEventListener('keydown', (e) => {
    if (rec && e.key === ' ' && !e.repeat && !e.target.closest('input, textarea, select, button')) { e.preventDefault(); tap(); }
  });

  $('tvPlay').onclick = async () => {
    if (rec) return finishRec();
    if (player.playing) { player.stop(); $('tvPlay').textContent = '▶ Xem thử'; preview(); return; }
    audioCtx().resume(); // inside the tap, before any await (iOS)
    await ensureFonts();
    const sc = { ...makeScene(), gain: await loud.gain() };
    canvas.width = sc.width; canvas.height = sc.height;
    $('tvPlay').textContent = '■ Dừng';
    player.play(sc, (t) => { if (t < 0) { $('tvPlay').textContent = '▶ Xem thử'; preview(); } });
  };

  async function slideBlob(text, k, n) {
    const size = getSize($('tvSizeSel'));
    const c = makeCanvas(size.w, size.h);
    drawSlide(c.getContext('2d'), size.w, size.h, text, opts(), 1, true, tpl, bgImage, k, n);
    return canvasToBlob(c, 'image/png');
  }

  $('tvPng').onclick = async () => {
    await ensureFonts();
    const { text, k, n } = currentSlide();
    const blob = await slideBlob(text, k, n);
    const name = `slide-${k + 1}.png`;
    $('tvOut').innerHTML = '';
    resultCard($('tvOut'), { blob, name });
    download(blob, name);
  };

  $('tvZip').onclick = async () => {
    await ensureFonts();
    const items = [];
    const sl = slides();
    for (let i = 0; i < sl.length; i++) items.push({ blob: await slideBlob(sl[i], i, sl.length), name: `slide-${String(i + 1).padStart(2, '0')}.png` });
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
      finishRec();
      player.stop();
      $('tvPlay').textContent = '▶ Xem thử';
      await ensureFonts();
      return { ...makeScene(), gain: await loud.gain() };
    },
  });

  // read-only hooks for the self-test and e2e tests
  window.TextVideo = Object.freeze({
    timing, scene: makeScene, drawSlide, opts,
    templates: () => TEMPLATES.map((t) => ({ id: t.id, cat: t.cat, color: t.color, box: t.box && t.box.fill, note: t.note && t.note.fill, stroke: !!t.stroke, gradText: t.gradText, moving: !!t.moving, anim: t.anim, handleColor: t.handleColor })),
    drawTemplate: (id, ctx, W, H, text, o, a = 1, time = 0, blink = false) => drawSlide(ctx, W, H, text, o, a, blink, TEMPLATES.find((t) => t.id === id), null, 0, 1, time),
    clock: () => (player.playing ? heardAt() : -1), // seconds into the playing song, as heard
    runs: (text, W = 1080, H = 1920) => layout(makeCanvas(W, H).getContext('2d'), text, tpl, opts(), W, H).runs,
    header: (W, H, o = opts(), n = 5) => header(makeCanvas(W, H).getContext('2d'), W, H, o, n),
  });
  window.addEventListener('tabshown', (e) => { if (e.detail === 'textvideo') refresh(); else finishRec(); });
  renderTemplatePicker();
  updateAudioInfo();
  renderSlides();
  preview();
  ensureFonts().then(() => { renderTemplatePicker(); refresh(); });
})();
