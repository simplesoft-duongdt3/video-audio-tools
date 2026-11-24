# Media Toolbox (video-audio-tools)

Bộ công cụ xử lý ảnh / audio / video **chạy 100% trên trình duyệt** — không backend, không upload, không lưu trữ. Host tĩnh trên GitHub Pages. Dùng được trên desktop, iPhone và Android.

## Tính năng

| Tab | Chức năng |
|---|---|
| 🔁 Chuyển định dạng | HEIC/HEIF, JPG, PNG, WebP, GIF, BMP, AVIF, SVG → JPG / PNG / WebP (AVIF nếu trình duyệt hỗ trợ). Xử lý hàng loạt, tải .zip |
| 🗜️ Nén ảnh | **Lossless**: tối ưu lại PNG (giữ nguyên pixel, bỏ metadata). **Lossy**: giảm chất lượng JPG/WebP, giảm bảng màu PNG. Chuyển sang WebP. Giới hạn cạnh dài |
| ✂️ Cắt & Resize | Cắt tự do hoặc theo tỉ lệ (9:16 TikTok, 1:1, 4:5, 16:9, 4:3…), xoay, lật, resize theo px, preset 1080×1920… |
| 🖼️ Ảnh + Audio → Video | 1 ảnh hoặc slideshow nhiều ảnh + nhạc → MP4. **9 mẫu** (Kỷ niệm, Du lịch, Polaroid, Điện ảnh, Đen trắng, Cổ điển, Sản phẩm, Năng động…). Nền mờ / phủ kín / Polaroid, zoom vào–ra, chuyển cảnh mờ – trượt – phóng to, màu ảnh (ấm, lạnh, đen trắng, cổ điển), tiêu đề trên video, khung điện ảnh, cắt đoạn audio |
| 🔤 Text + Audio → Video | **36 mẫu** chia nhóm (Phổ biến, Chuyển động, Nổi bật, Retro, Kể chuyện, Trích dẫn, Bài học, Câu đố, Top list, Tin nhắn, Tin tức, Bán hàng, Tối giản) — có **nền chuyển động** (gradient chảy, đèn sân khấu, bokeh, phim cũ có hạt, băng VHS), giấy nhớ, bong bóng tin nhắn, số thứ tự lớn kiểu Top list, chữ gradient; mỗi đoạn văn = 1 slide; **10 hiệu ứng chữ**: bật lên, mờ dần, trượt lên, gõ chữ, từng từ, **từng từ bật to**, **karaoke** (sáng dần từng từ), **thu nhỏ vào**, **từng dòng trồi lên**, **glitch** — chọn mẫu là có sẵn hiệu ứng hợp với mẫu; nền ảnh/màu, handle @tên. **Tô từ khoá** bằng `*dấu sao*` (hộp màu tự chọn), **câu mở đầu cố định (hook)** và **đánh số slide 1/5**. **Chuyển slide**: chia đều, **khớp nhịp trống** tự động, hoặc **nghe nhạc & bấm** đúng lúc muốn chuyển. **Bắt đầu nhạc từ** giây bất kỳ. **Danh sách slide** ghi thời gian từng slide và cảnh báo slide quá nhanh không kịp đọc. Chữ 9:16 luôn tránh cột nút và caption TikTok. Xuất video MP4 hoặc ảnh PNG từng slide |
| 🎧 Audio → Video | 1 file audio (mp3, m4a, wav, aac, flac, ogg, ghi âm, hoặc video có tiếng) → MP4 theo **26 mẫu chia theo thể loại** (Sách & Thơ, Podcast & Radio, Chữa lành & Thư giãn, Học tập, Kể chuyện, Tâm linh, Âm nhạc — nghiên cứu quy ước hình ảnh từng thể loại cho thị trường VN: bìa sách 2:3, nhãn “SÁCH NÓI / ● ON AIR / BẢN TIN”, chuyển động êm cho thể loại thư giãn, nền giấy / grain / vignette, font Lora · Noto Serif · Dancing Script · Baloo 2). **28 bộ màu có tên** (Trà sữa, Bạc hà, Đêm Sài Gòn, Tết…) đã kiểm tra tương phản WCAG; nội dung 9:16 nằm trong vùng an toàn của TikTok (không đặt chữ ở 22 % dưới cùng), sóng nhạc chuyển động — **12 kiểu** gồm các kiểu đang thịnh hành (Đường neon, Đèn LED, Sóng mềm nhiều lớp, Tin nhắn thoại, Quả cầu, Đĩa quay) + cột phổ, đối xứng, waveform, vòng tròn, dạng sóng cả bài; **6 hiệu ứng theo nhạc có tuỳ chỉnh**: ✨ hạt bay (7 kiểu hạt: đốm sáng, tuyết, cánh hoa, tim, sao, nốt nhạc, bong bóng · số lượng · hướng bay · theo nhịp · màu), 💥 nhún theo nhịp trống (mức · phần nhún: ảnh bìa / tên bài · độ dài), 🌊 vòng sóng lan, 🎐 lắc lư, 🎞️ nền chuyển động chậm, 🌈 màu sóng chảy dần — dò nhịp bass offline, chỉ chuyển động; test chống nhấp nháy theo WCAG 2.3.1 (toàn khung và từng vùng 1/16) với mọi hiệu ứng ở mức mạnh nhất, tên bài, dòng phụ, ảnh bìa + nền mờ, thanh thời gian. Cắt đoạn bằng "bắt đầu từ" + thời lượng |
| 📐 Cắt & đổi khung video | Video ngang (mp4, mov) → **dọc 9:16 (1080×1920)** cho TikTok / Reels / Shorts, **1:1**, **4:5** hoặc giữ khung gốc. Chọn đoạn (bắt đầu / kết thúc, hoặc "lấy chỗ đang xem"), rồi **cắt đầy khung** — kéo thanh vị trí hoặc kéo thẳng hình trong khung xem trước để giữ đúng người đang nói — hoặc thu nhỏ trên **nền mờ / nền màu**. Xem thử có tiếng, có vùng bị che. Xuất MP4 H.264 + AAC bằng Conversion API của Mediabunny: đọc file theo từng phần, giải mã – đặt khung – mã hoá từng khung hình (video dài vài phút không nằm cả trong bộ nhớ), có tiến độ + Huỷ. Tiếng AAC được giữ nguyên (copy) hoặc mã hoá lại với mức âm lượng chuẩn, đo trên đúng đoạn đã chọn |
| ✂️ Chọn đoạn nhạc | Ở tab Ảnh + Audio và Audio → Video: kéo 2 tay cầm trên **sóng nhạc** (hoặc chạm để dời đoạn), nghe thử đoạn đã chọn. Ô số giây chính xác nằm trong "Nâng cao". **✂️ Tìm đoạn im lặng thừa**: tìm im lặng ở đầu / cuối bài và khoảng lặng dài (3 mức độ nhạy, ngưỡng tự thích ứng theo độ to của bản ghi), tô đỏ trên sóng nhạc, người dùng chọn đoạn nào bỏ — giữ 0,15 s quanh lời nói, fade 8 ms ở chỗ nối, có Hoàn tác |
| 💬 Phụ đề trên video | Ở tab Audio → Video và Ảnh + Audio: **nhập file .srt / .vtt** (SRT, WebVTT — bỏ thẻ định dạng, khối NOTE/STYLE) hoặc **dán lời, mỗi dòng một câu** rồi **👆 bắt nhịp**: nhạc phát, nhấn giữ nút khi câu đang được nói (hoặc chia đều theo độ dài câu). Chữ trắng viền đen, **tô vàng từng chữ đang nói**, 3 cỡ chữ, nền tối tuỳ chọn, chỉnh lệch giờ; luôn nằm trong **vùng an toàn chung của TikTok, Reels và Shorts** và không đè lên tên bài. Giờ phụ đề gắn với bài gốc: đổi điểm bắt đầu hay bỏ đoạn im lặng thì chữ vẫn theo đúng lời. **Tải file .srt** khớp với video xuất ra (cho YouTube). Không nhận dạng giọng nói — không gửi gì ra ngoài máy |
| 🔊 Âm lượng chuẩn | Ở cả 3 tab làm video, tab Cắt & đổi khung video và tab Tách âm thanh: đo độ to **LUFS theo ITU-R BS.1770 / EBU R128** (K-weighting, gating — khớp `ffmpeg ebur128`) trên đúng đoạn đã chọn, đưa về **−14 LUFS** (TikTok / YouTube / Spotify) hoặc **−16 LUFS** (podcast), không để đỉnh vượt −1,5 dBFS (không rè), tăng tối đa +20 dB. Hiện "−22,8 LUFS → tăng 8,8 dB"; Xem thử phát đúng mức sẽ xuất. Chỉ đo khi xuất / xem thử (không đo lại mỗi khung hình) |
| 📱 Vùng bị che | Dưới mọi khung xem trước: bật **TikTok / Reels / Shorts** để tô đỏ phần bị nút, tên kênh, caption của app che (số đo thận trọng từ các hướng dẫn 2025–26). Lớp HTML trên canvas — không bao giờ có trong video xuất ra. Trên điện thoại các nút nằm ở khoảng trống cạnh khung 9:16, dải xem trước không cao thêm |
| 🪧 Ảnh bìa & caption | Ảnh bìa **YouTube 16:9 (1920×1080, 4K 3840×2160)**, **bìa TikTok / Shorts / Reels 9:16**, 4:5, 1:1. Nền ảnh hoặc **1 khung hình lấy từ video**, 5 kiểu chữ (Nổi bật, Tin nóng, Tối giản, Sang trọng, Dễ thương), từ khoá trong `*dấu sao*` được tô màu, dòng phụ, nhãn góc; chữ tự co cho vừa, bìa 9:16 tự né vùng bị che. JPG tự tìm chất lượng cao nhất mà **≤ 2 MB** (hoặc ≤ 50 MB — giới hạn YouTube), PNG. **Kiểm tra caption**: đếm ký tự như người đọc thấy (emoji = 1) so với tiêu đề YouTube 100 / mô tả 5.000 / TikTok 4.000 / Reels 2.200, đếm hashtag (không trùng), cảnh báo > 60 hashtag (YouTube bỏ qua tất cả) và hashtag spam |
| 🎵 Tách âm thanh | Video (mp4, mov…) hoặc audio → **M4A (AAC 192 kb/s)** hoặc **WAV 16-bit**. Chọn đoạn trên sóng nhạc, tìm đoạn im lặng thừa, chuẩn hoá âm lượng. M4A mã hoá theo từng giây (ít tốn bộ nhớ); trình duyệt không mã hoá được AAC thì tự lưu WAV và báo rõ |
| 🛡️ Bảo mật | **CSP** chỉ cho chạy code từ trang + jsDelivr/cdnjs và **không cho gửi dữ liệu tới máy chủ nào khác** (`connect-src`, `img-src`) — giữ đúng lời hứa "không upload" kể cả khi một thư viện bị chiếm quyền. Mọi file CDN có **SRI** (kể cả module tải động qua `integrity` của import map), `referrer: no-referrer`, từ chối file quá lớn (ảnh > 150 MB, audio/video > 1 GB) trước khi đọc vào bộ nhớ. `'unsafe-eval'` chỉ vì bộ giải mã HEIC (heic2any) cần |
| 🧭 Điều hướng | Công cụ xếp theo nhóm **Làm video · Đăng bài · Ảnh**; máy tính ≥ 1100 px: cột bên trái cố định; điện thoại: thanh vuốt ngang + **nút Xem thử / Xuất luôn nằm ở đáy màn hình**. Mở trang vào thẳng Audio → Video. Có link "Bỏ qua menu" cho bàn phím / trình đọc màn hình |
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

- Unit test (`tests/unit/`): node:test, không cần trình duyệt. Có kiểm tra giải mã pixel bằng ffmpeg nếu máy có ffmpeg. Đo LUFS được so với hệ số chuẩn BS.1770 và `ffmpeg ebur128`; kiểm tra tĩnh về bảo mật (SRI, CSP, hash của import map, không có script / sự kiện inline).
- E2E `tests/e2e/creator.spec.js`: ảnh bìa (kích thước, ≤ 2 MB kể cả ảnh 4K nhiều chi tiết, tô màu từ khoá), kiểm tra caption, tách âm thanh (WAV / M4A, đo lại −14 LUFS bằng ffmpeg), video xuất ra đạt −14 LUFS, vùng bị che, bố cục desktop / điện thoại, không vi phạm CSP và CSP chặn gửi dữ liệu ra ngoài. Các test quan trọng đã được kiểm tra đột biến (cố tình làm hỏng code → test phải đỏ).
- E2E (`tests/e2e/`): tải file mẫu thật (`tests/fixtures/`: m4a, mp3, wav, flac, ogg, mp4, ảnh có EXIF), xuất ảnh/video rồi kiểm tra file tải về bằng `ffprobe` (codec H.264 + AAC, kích thước, thời lượng, và **độ lớn tiếng** bằng `volumedetect` để bắt lỗi video câm). Cần Google Chrome và ffprobe.
- WebKit trên Linux không cần sudo: `tests/setup-webkit-linux.sh`. Bản WebKit này của Playwright **không có AAC/H.264**, nên các test m4a/xuất video tự bỏ qua trên project iPhone (có ghi lý do) — iPhone thật thì có. Để chắc chắn trên máy thật, mở `#selftest` trên iPhone/Android.
- Tạo lại file mẫu: `npm run fixtures` (cần ffmpeg).
- **Sau khi sửa `js/` hoặc `assets/`: chạy `npm run stamp`** — thêm `?v=<hash nội dung>` vào `index.html` để người dùng cũ không chạy JS cũ (cache). Unit test sẽ báo lỗi nếu quên.
- **Quy tắc dự án — tính năng đổi thì phải cập nhật hướng dẫn:** sửa nội dung trong `scripts/make-help.mjs` rồi chạy `npm run help` để tạo lại `Help/huong-dan-iphone.html`. Hướng dẫn lưu "dấu vân tay" của giao diện; unit test (chạy cả trong CI) báo lỗi nếu giao diện đã đổi mà chưa tạo lại hướng dẫn. Các quy tắc khác: xem `CLAUDE.md`.
- **CI** (`.github/workflows/ci.yml`): mỗi lần push / pull request chạy unit + e2e trên 3 trình duyệt, kèm báo cáo Playwright.

## Deploy GitHub Pages

Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`. File `.nojekyll` đã có sẵn.

**Chỉ deploy khi test xanh (khuyến nghị):** Settings → Pages → Source: *GitHub Actions*, rồi Settings → Secrets and variables → Actions → Variables → thêm `PAGES_VIA_ACTIONS` = `true`. Từ đó `main` chỉ được đưa lên Pages khi CI pass.

## Thư viện (CDN)

Cropper.js, JSZip, UPNG.js + pako, Mediabunny + @mediabunny/aac-encoder, heic2any, Google Fonts (Be Vietnam Pro, Montserrat, Playfair Display, Lobster, Roboto Mono — đều hỗ trợ tiếng Việt).
