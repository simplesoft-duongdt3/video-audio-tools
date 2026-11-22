# Media Toolbox (video-audio-tools)

Bộ công cụ xử lý ảnh / audio / video **chạy 100% trên trình duyệt** — không backend, không upload, không lưu trữ. Host tĩnh trên GitHub Pages. Dùng được trên desktop, iPhone và Android.

## Tính năng

| Tab | Chức năng |
|---|---|
| 🔁 Chuyển định dạng | HEIC/HEIF, JPG, PNG, WebP, GIF, BMP, AVIF, SVG → JPG / PNG / WebP (AVIF nếu trình duyệt hỗ trợ). Xử lý hàng loạt, tải .zip |
| 🗜️ Nén ảnh | **Lossless**: tối ưu lại PNG (giữ nguyên pixel, bỏ metadata). **Lossy**: giảm chất lượng JPG/WebP, giảm bảng màu PNG. Chuyển sang WebP. Giới hạn cạnh dài |
| ✂️ Cắt & Resize | Cắt tự do hoặc theo tỉ lệ (9:16 TikTok, 1:1, 4:5, 16:9, 4:3…), xoay, lật, resize theo px, preset 1080×1920… |
| 🖼️ Ảnh + Audio → Video | 1 ảnh hoặc slideshow nhiều ảnh + nhạc → MP4. **9 mẫu** (Kỷ niệm, Du lịch, Polaroid, Điện ảnh, Đen trắng, Cổ điển, Sản phẩm, Năng động…). Nền mờ / phủ kín / Polaroid, zoom vào–ra, chuyển cảnh mờ – trượt – phóng to, màu ảnh (ấm, lạnh, đen trắng, cổ điển), tiêu đề trên video, khung điện ảnh, cắt đoạn audio |
| 🔤 Text + Audio → Video | **19 mẫu** chia nhóm (Phổ biến, Nổi bật, Trích dẫn, Bài học, Tin tức, Bán hàng, Tối giản), mỗi đoạn văn = 1 slide, hiệu ứng chữ (bật lên, gõ chữ, từng từ…), nền ảnh/màu, handle @tên. Xuất video MP4 hoặc ảnh PNG từng slide |
| 🎧 Audio → Video | 1 file audio (mp3, m4a, wav, aac, flac, ogg, ghi âm, hoặc video có tiếng) → MP4 theo **9 mẫu** (TikTok Neon, Lo-fi, Podcast, Đĩa than, Biển xanh, Hoàng hôn, Karaoke, Tối giản sáng, Hacker — 3 bố cục, nền sáng/tối, font riêng), sóng nhạc chuyển động (cột phổ, đối xứng, waveform, vòng tròn, dạng sóng cả bài), tên bài, dòng phụ, ảnh bìa + nền mờ, thanh thời gian. Cắt đoạn bằng "bắt đầu từ" + thời lượng |
| ✂️ Chọn đoạn nhạc | Ở tab Ảnh + Audio và Audio → Video: kéo 2 tay cầm trên **sóng nhạc** (hoặc chạm để dời đoạn), nghe thử đoạn đã chọn. Ô số giây chính xác nằm trong "Nâng cao". **✂️ Tìm đoạn im lặng thừa**: tìm im lặng ở đầu / cuối bài và khoảng lặng dài (3 mức độ nhạy, ngưỡng tự thích ứng theo độ to của bản ghi), tô đỏ trên sóng nhạc, người dùng chọn đoạn nào bỏ — giữ 0,15 s quanh lời nói, fade 8 ms ở chỗ nối, có Hoàn tác |
| 📖 Hướng dẫn iPhone | `Help/huong-dan-iphone.html` (link ở chân trang): hướng dẫn tiếng Việt từng bước, 1 file HTML có ảnh chụp màn hình nhúng sẵn. Tạo lại sau khi đổi giao diện: `npm run help` |
| 🔒 Quyền riêng tư | `index.html#about`: file không rời khỏi máy, trình duyệt chỉ nhớ "mẫu của tôi" + tốc độ xuất; link góp ý GitHub |
| ⭐ Mẫu của tôi | Ở cả 3 tab video: bấm **＋ Lưu cài đặt hiện tại thành mẫu** để dùng lại (lưu trên trình duyệt đó, xoá bằng ×). Ảnh mẫu được dùng để xem trước khi chưa chọn ảnh |
| 🩺 Tự kiểm tra | `index.html#selftest` (link ở chân trang): chạy thử thật trên thiết bị đang dùng — giải mã m4a/mp3, nén ảnh, xuất video 1 giây… để biết máy đó dùng được gì |

### iPhone: chọn file audio

iOS hay làm mờ (không cho chọn) file m4a/mp3 trong app **Tệp** khi ô chọn file có `accept="audio/*"`. Trên iPhone/iPad trang bỏ bộ lọc này và kiểm tra bằng cách giải mã file. File ghi âm trong **Ghi âm (Voice Memos)**: bấm ••• → *Lưu vào Tệp* rồi chọn từ Tệp. Nhạc Apple Music có DRM nên không đọc được.

## Cách xuất video

- **WebCodecs + [Mediabunny](https://mediabunny.dev)**: mã hoá H.264 nhanh hơn thời gian thực → `.mp4`.
- **Âm thanh luôn là AAC**: dùng bộ mã hoá AAC của trình duyệt nếu có; nếu không (Chrome/Firefox trên Linux, một số Safari) thì tự tải bộ mã hoá AAC WASM ([@mediabunny/aac-encoder](https://www.npmjs.com/package/@mediabunny/aac-encoder)). Không dùng Opus vì Opus trong MP4 bị **mất tiếng** trên Ảnh của iPhone, QuickTime, Windows Films & TV và một số trình upload.
- **Dự phòng** (chỉ khi trình duyệt không có H.264): `canvas.captureStream` + `MediaRecorder` ghi theo thời gian thực. Cần giữ màn hình mở trong khi ghi.

- **Âm thanh được đưa vào từng giây một** (không tạo bản sao cả bài trong bộ nhớ) và **fade-out 0,4 s như nhau** ở cả xuất nhanh lẫn ghi thời gian thực.
- Dưới nút xuất có **ước tính dung lượng + thời gian** (thời gian đo từ lần xuất trước trên chính máy đó, lưu trong `localStorage`).
- Khi lỗi: hộp thông báo dễ hiểu + **Thử lại** + **📋 Sao chép thông tin lỗi** (thiết bị, khả năng mã hoá, 20 lỗi gần nhất của trang). Thông tin chỉ được sao chép, không gửi đi đâu. Trang `#selftest` có nút **Sao chép kết quả**.

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
- **Sau khi sửa `js/` hoặc `assets/`: chạy `npm run stamp`** — thêm `?v=<hash nội dung>` vào `index.html` để người dùng cũ không chạy JS cũ (cache). Unit test sẽ báo lỗi nếu quên.
- **CI** (`.github/workflows/ci.yml`): mỗi lần push / pull request chạy unit + e2e trên 3 trình duyệt, kèm báo cáo Playwright.

## Deploy GitHub Pages

Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`. File `.nojekyll` đã có sẵn.

**Chỉ deploy khi test xanh (khuyến nghị):** Settings → Pages → Source: *GitHub Actions*, rồi Settings → Secrets and variables → Actions → Variables → thêm `PAGES_VIA_ACTIONS` = `true`. Từ đó `main` chỉ được đưa lên Pages khi CI pass.

## Thư viện (CDN)

Cropper.js, JSZip, UPNG.js + pako, Mediabunny + @mediabunny/aac-encoder, heic2any, Google Fonts (Be Vietnam Pro, Montserrat, Playfair Display, Lobster, Roboto Mono — đều hỗ trợ tiếng Việt).
