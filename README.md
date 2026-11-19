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
| 🎧 Audio → Video | 1 file audio (mp3, m4a, wav, aac, flac, ogg, ghi âm, hoặc video có tiếng) → MP4 có sóng nhạc chuyển động (cột phổ, đối xứng, waveform, vòng tròn, dạng sóng cả bài), tên bài, dòng phụ, ảnh bìa + nền mờ, thanh thời gian. Cắt đoạn bằng "bắt đầu từ" + thời lượng |
| 🩺 Tự kiểm tra | `index.html#selftest` (link ở chân trang): chạy thử thật trên thiết bị đang dùng — giải mã m4a/mp3, nén ảnh, xuất video 1 giây… để biết máy đó dùng được gì |

### iPhone: chọn file audio

iOS hay làm mờ (không cho chọn) file m4a/mp3 trong app **Tệp** khi ô chọn file có `accept="audio/*"`. Trên iPhone/iPad trang bỏ bộ lọc này và kiểm tra bằng cách giải mã file. File ghi âm trong **Ghi âm (Voice Memos)**: bấm ••• → *Lưu vào Tệp* rồi chọn từ Tệp. Nhạc Apple Music có DRM nên không đọc được.

## Cách xuất video

- **WebCodecs + [Mediabunny](https://mediabunny.dev)**: mã hoá H.264 nhanh hơn thời gian thực → `.mp4`.
- **Âm thanh luôn là AAC**: dùng bộ mã hoá AAC của trình duyệt nếu có; nếu không (Chrome/Firefox trên Linux, một số Safari) thì tự tải bộ mã hoá AAC WASM ([@mediabunny/aac-encoder](https://www.npmjs.com/package/@mediabunny/aac-encoder)). Không dùng Opus vì Opus trong MP4 bị **mất tiếng** trên Ảnh của iPhone, QuickTime, Windows Films & TV và một số trình upload.
- **Dự phòng** (chỉ khi trình duyệt không có H.264): `canvas.captureStream` + `MediaRecorder` ghi theo thời gian thực. Cần giữ màn hình mở trong khi ghi.

Trên điện thoại, nút **Chia sẻ / Lưu vào Ảnh** mở share sheet để lưu video vào thư viện hoặc gửi thẳng sang TikTok.

## Chạy local

```bash
python3 -m http.server 8765
```

Mở http://localhost:8765

## Kiểm thử

```bash
npm install                 # chỉ cài công cụ test (Playwright); site không có bước build
npm run test:unit           # unit test logic thuần (js/core.js) + kiểm tra liên kết index.html ↔ js
npm run test:e2e            # e2e: chạy server tĩnh local, điều khiển Chrome desktop, Android (Pixel 7) và iPhone (WebKit)
npm test                    # cả hai
```

- Unit test (`tests/unit/`): node:test, không cần trình duyệt. Có kiểm tra giải mã pixel bằng ffmpeg nếu máy có ffmpeg.
- E2E (`tests/e2e/`): tải file mẫu thật (`tests/fixtures/`: m4a, mp3, wav, flac, ogg, mp4, ảnh có EXIF), xuất ảnh/video rồi kiểm tra file tải về bằng `ffprobe` (codec H.264 + AAC, kích thước, thời lượng, và **độ lớn tiếng** bằng `volumedetect` để bắt lỗi video câm). Cần Google Chrome và ffprobe.
- WebKit trên Linux không cần sudo: `tests/setup-webkit-linux.sh`. Bản WebKit này của Playwright **không có AAC/H.264**, nên các test m4a/xuất video tự bỏ qua trên project iPhone (có ghi lý do) — iPhone thật thì có. Để chắc chắn trên máy thật, mở `#selftest` trên iPhone/Android.
- Tạo lại file mẫu: `npm run fixtures` (cần ffmpeg).

## Deploy GitHub Pages

Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`. File `.nojekyll` đã có sẵn.

## Thư viện (CDN)

Cropper.js, JSZip, UPNG.js + pako, Mediabunny + @mediabunny/aac-encoder, heic2any, Google Fonts (Be Vietnam Pro, Montserrat, Playfair Display, Lobster, Roboto Mono — đều hỗ trợ tiếng Việt).
