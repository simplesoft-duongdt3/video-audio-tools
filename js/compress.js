/* Image compression: lossless (PNG re-pack, JPEG metadata strip), lossy quality, WebP */
(() => {
  let queue = [];
  let outputs = [];

  // Safari can't encode WebP from a canvas: don't offer an option that would silently produce JPG.
  if (!SUPPORTED_OUT.includes('image/webp')) $('cmpMode').querySelector('option[value=webp]').remove();

  const updateMode = () => { $('cmpQWrap').style.display = $('cmpMode').value === 'lossless' ? 'none' : ''; };
  $('cmpMode').onchange = updateMode;
  updateMode();

  onFiles('cmpFiles', (files) => {
    queue.push(...files);
    toast(`Đã thêm ${files.length} ảnh (tổng ${queue.length}). Bấm "Nén".`);
  });
  $('cmpClear').onclick = () => {
    queue = []; outputs = [];
    clearResults($('cmpResults'));
    $('cmpZip').disabled = $('cmpShare').disabled = true;
  };
  $('cmpZip').onclick = () => zipAndDownload(outputs, 'compressed-images.zip');
  $('cmpShare').hidden = !canShareFiles;
  $('cmpShare').onclick = () => shareAll(outputs);

  function hasAlpha(data) {
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    return false;
  }

  function typeOf(f) {
    if (f.type) return f.type === 'image/jpg' ? 'image/jpeg' : f.type;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif' }[ext] || '';
  }

  /* ---------- lossless JPEG: drop metadata segments, never touch the compressed image data ---------- */
  async function stripJpeg(file) {
    const { parts, removed } = Core.stripJpegBytes(new Uint8Array(await file.arrayBuffer()));
    return { blob: new Blob(parts, { type: 'image/jpeg' }), removed };
  }

  /* ---------- main ---------- */
  async function compressOne(f, mode, q, maxSide) {
    const srcType = typeOf(f);
    const isJpeg = srcType === 'image/jpeg';
    const isGif = srcType === 'image/gif';
    const lossySrc = /jpeg|webp|hei[cf]|avif/.test(srcType) || isHeic(f);

    if (mode === 'lossless' && isGif) {
      return { blob: f, name: f.name, info: 'GIF giữ nguyên (tránh mất ảnh động)' };
    }
    // Lossless JPEG without resizing: byte-level metadata strip, image data untouched.
    if (mode === 'lossless' && isJpeg && !maxSide) {
      const { blob, removed } = await stripJpeg(f);
      if (blob.size >= f.size) return { blob: f, name: f.name, info: 'Không có metadata để bỏ — giữ file gốc' };
      return { blob, name: f.name, info: `Lossless: đã bỏ ${removed.join(', ') || 'metadata'}` };
    }

    const { img, w: iw, h: ih, url } = await readImage(f);
    let w = iw, h = ih;
    if (maxSide > 0 && Math.max(w, h) > maxSide) {
      const s = maxSide / Math.max(w, h);
      w = Math.round(w * s); h = Math.round(h * s);
    }
    const sc = safeScale(w, h);
    w = Math.round(w * sc); h = Math.round(h * sc);
    const resized = w !== iw || h !== ih;

    if (mode === 'lossless' && lossySrc && !resized) {
      URL.revokeObjectURL(url);
      if (isJpeg) return compressOne(f, mode, q, 0); // nothing to resize → metadata strip
      return { blob: f, name: f.name, info: 'Giữ nguyên — WebP/HEIC không nén lossless thêm được, hãy dùng chế độ Lossy', w, h };
    }

    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Ảnh quá lớn cho thiết bị này');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);

    let blob, ext, info;
    try {
      if (mode === 'lossless' && lossySrc) {
        // Resizing a JPG/WebP/HEIC means re-encoding anyway: keep its format at high quality, not a huge PNG.
        const type = srcType === 'image/webp' && SUPPORTED_OUT.includes('image/webp') ? 'image/webp' : 'image/jpeg';
        if (type === 'image/jpeg') { ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
        blob = await canvasToBlob(c, type, 0.92);
        ext = FORMAT_INFO[type].ext;
        info = `Đổi kích thước nên phải mã hoá lại ${FORMAT_INFO[type].label} 92%`;
      } else if (mode === 'lossless') {
        // PNG / BMP: re-pack losslessly (8-bit sRGB). Try UPNG and the browser encoder, keep the smaller.
        blob = await canvasToBlob(c, 'image/png');
        if (w * h <= 12e6) { // UPNG is synchronous: skip on huge images to avoid freezing the page
          const data = ctx.getImageData(0, 0, w, h).data;
          const png = new Blob([UPNG.encode([data.buffer], w, h, 0)], { type: 'image/png' });
          if (png.size < blob.size) blob = png;
        }
        ext = 'png';
        info = 'PNG lossless';
      } else if (mode === 'webp') {
        blob = await canvasToBlob(c, 'image/webp', q);
        ext = 'webp'; info = `WebP ${Math.round(q * 100)}%`;
      } else if (/png|gif|bmp/.test(srcType)) {
        // Lossy PNG: palette quantisation (like TinyPNG), keeps transparency.
        const data = ctx.getImageData(0, 0, w, h).data;
        const colors = Math.max(16, Math.min(256, Math.round(256 * q)));
        blob = new Blob([UPNG.encode([data.buffer], w, h, colors)], { type: 'image/png' });
        ext = 'png'; info = `PNG ${colors} màu`;
        if (isGif) info += ' (chỉ khung đầu của GIF)';
        if (!hasAlpha(data)) {
          const jpg = await canvasToBlob(c, 'image/jpeg', q);
          if (jpg.size < blob.size * 0.6) info += ' — gợi ý: ảnh không trong suốt, chuyển JPG sẽ nhỏ hơn';
        }
      } else {
        const type = SUPPORTED_OUT.includes(srcType) ? srcType : 'image/jpeg';
        if (type === 'image/jpeg') { ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
        blob = await canvasToBlob(c, type, q);
        ext = FORMAT_INFO[type].ext; info = `${FORMAT_INFO[type].label} ${Math.round(q * 100)}%`;
      }
    } finally {
      c.width = c.height = 0; // free canvas memory immediately (iOS has a low total cap)
    }
    if (sc < 1) info += ` · thu nhỏ do giới hạn thiết bị`;

    // Never hand back something bigger than the original unless the user asked for a new size.
    if (blob.size >= f.size && !resized) {
      return { blob: f, name: f.name, info: `Kết quả (${formatBytes(blob.size)}) không nhỏ hơn — giữ file gốc`, w, h };
    }
    return { blob, name: baseName(f.name) + '.' + ext, info, w, h };
  }

  $('cmpRun').onclick = async () => {
    if (!queue.length) return toast('Chưa chọn ảnh nào');
    const mode = $('cmpMode').value;
    const q = $('cmpQ').value / 100;
    const maxSide = +$('cmpMax').value || 0;
    const btn = $('cmpRun');
    btn.disabled = true;
    const files = queue; queue = [];
    for (let i = 0; i < files.length; i++) {
      btn.textContent = `Đang nén ${i + 1}/${files.length}…`;
      await nextFrame();
      const f = files[i];
      try {
        const r = await compressOne(f, mode, q, maxSide);
        outputs.push({ blob: r.blob, name: r.name });
        resultCard($('cmpResults'), { blob: r.blob, name: r.name, origSize: f.size, info: (r.w ? `${r.w}×${r.h} · ` : '') + r.info });
      } catch (e) {
        errorCard($('cmpResults'), f.name, e);
      }
    }
    btn.disabled = false;
    btn.textContent = 'Nén';
    $('cmpZip').disabled = $('cmpShare').disabled = !outputs.length;
  };
})();
