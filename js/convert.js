/* Image format conversion (HEIC/JPG/PNG/WebP/AVIF…) */
(() => {
  let queue = [];
  let outputs = [];
  fillFormatSelect($('convFormat'), 'image/jpeg');

  onFiles('convFiles', (files) => {
    queue.push(...files);
    toast(`Đã thêm ${files.length} ảnh (tổng ${queue.length}). Bấm "Chuyển đổi".`);
  });

  $('convClear').onclick = () => {
    queue = []; outputs = [];
    clearResults($('convResults'));
    $('convZip').disabled = $('convShare').disabled = true;
  };

  $('convRun').onclick = async () => {
    if (!queue.length) return toast('Chưa chọn ảnh nào');
    const type = $('convFormat').value;
    const q = $('convQ').value / 100;
    const bg = $('convBg').value;
    const btn = $('convRun');
    btn.disabled = true;
    const files = queue; queue = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      btn.textContent = `Đang xử lý ${i + 1}/${files.length}…`;
      try {
        const { img, w: iw, h: ih, url } = await readImage(f);
        const sc = safeScale(iw, ih);
        const w = Math.round(iw * sc), h = Math.round(ih * sc);
        const c = makeCanvas(w, h);
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('Ảnh quá lớn cho thiết bị này');
        if (type === 'image/jpeg') { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const blob = await canvasToBlob(c, type, type === 'image/png' ? undefined : q);
        c.width = c.height = 0; // release canvas memory now (matters on iOS)
        const name = baseName(f.name) + '.' + FORMAT_INFO[type].ext;
        outputs.push({ blob, name });
        resultCard($('convResults'), { blob, name, origSize: f.size, info: `${w}×${h}${sc < 1 ? ` (thu nhỏ từ ${iw}×${ih} do giới hạn thiết bị)` : ''}` });
      } catch (e) {
        errorCard($('convResults'), f.name, e);
      }
      await nextFrame();
    }
    btn.disabled = false;
    btn.textContent = 'Chuyển đổi';
    $('convZip').disabled = $('convShare').disabled = !outputs.length;
  };

  $('convZip').onclick = () => zipAndDownload(outputs, 'converted-images.zip');
  $('convShare').hidden = !canShareFiles;
  $('convShare').onclick = () => shareAll(outputs);
})();
