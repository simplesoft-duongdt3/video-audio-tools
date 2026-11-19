# Media Toolbox (video-audio-tools)

Bộ công cụ xử lý ảnh / audio / video **chạy 100% trên trình duyệt** — không backend, không upload, không lưu trữ. Host tĩnh trên GitHub Pages. Dùng được trên desktop, iPhone và Android.

## Tính năng

| Tab | Chức năng |
|---|---|
| 🔁 Chuyển định dạng | HEIC/HEIF, JPG, PNG, WebP, GIF, BMP, AVIF, SVG → JPG / PNG / WebP (AVIF nếu trình duyệt hỗ trợ). Xử lý hàng loạt, tải .zip |
| 🗜️ Nén ảnh | **Lossless**: tối ưu lại PNG (giữ nguyên pixel, bỏ metadata). **Lossy**: giảm chất lượng JPG/WebP, giảm bảng màu PNG. Chuyển sang WebP. Giới hạn cạnh dài |
| ✂️ Cắt & Resize | Cắt tự do hoặc theo tỉ lệ (9:16 TikTok, 1:1, 4:5, 16:9, 4:3…), xoay, lật, resize theo px, preset 1080×1920… |
| 🖼️ Ảnh + Audio → Video | 1 ảnh hoặc slideshow nhiều ảnh + nhạc → MP4. Mặc định 9:16 1080×1920. Nền mờ / phủ kín, zoom Ken Burns, chuyển cảnh mờ dần, cắt đoạn audio |
| 🔤 Text + Audio → Video | 10 template kiểu TikTok, mỗi đoạn văn = 1 slide, hiệu ứng chữ (bật lên, gõ chữ, từng từ…), nền ảnh/màu, handle @tên. Xuất video MP4 hoặc ảnh PNG từng slide |

## Cách xuất video

- **WebCodecs + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer)**: mã hoá H.264 nhanh hơn thời gian thực → `.mp4`. Âm thanh AAC khi trình duyệt có bộ mã hoá AAC (Chrome/Edge trên Windows/macOS/Android, Safari); Chrome trên Linux chỉ có Opus.
- **Dự phòng**: `canvas.captureStream` + `MediaRecorder` ghi theo thời gian thực (Safari → MP4, Firefox → WebM). Cần giữ màn hình mở trong khi ghi.

Trên điện thoại, nút **Chia sẻ / Lưu vào Ảnh** mở share sheet để lưu video vào thư viện hoặc gửi thẳng sang TikTok.

## Chạy local

```bash
python3 -m http.server 8765
```

Mở http://localhost:8765

## Deploy GitHub Pages

Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`. File `.nojekyll` đã có sẵn.

## Thư viện (CDN)

Cropper.js, JSZip, UPNG.js + pako, mp4-muxer, heic2any, Google Fonts (Be Vietnam Pro, Montserrat, Playfair Display, Lobster, Roboto Mono — đều hỗ trợ tiếng Việt).
