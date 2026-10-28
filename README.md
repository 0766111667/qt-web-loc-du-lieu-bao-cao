# Tổng hợp sự cố QT

Web app đọc **ảnh bảng thống kê sự cố QT** (ảnh chụp bảng Excel), kiểm tra khớp, rồi **cộng dồn theo tháng**.
Danh mục hạng mục là **động**: thêm, đổi tên, đổi thứ tự, gộp, ẩn, xóa ngay trong Cài đặt, không cần sửa code.

Ảnh và dữ liệu nằm **trong trình duyệt của bạn** (IndexedDB). Chỉ khi bật AI dự phòng, những dải ảnh nhỏ của các dòng không chắc mới được gửi lên máy chủ của bạn trên Vercel.

---

## 1. Chạy thử trên máy (5 phút)

1. Cài **Node.js 20 trở lên** (bản LTS) tại https://nodejs.org
2. Giải nén thư mục này, mở Terminal (Windows: PowerShell) tại thư mục đó.
3. Chạy:

```bash
npm install
npm run dev
```

4. Mở địa chỉ hiện ra (thường là http://localhost:5173), kéo thả vài ảnh vào mục **Nhập ảnh**.

Kiểm tra mã nguồn: `npm test` (17 bài kiểm thử, chạy trên 2 ảnh mẫu trong `test/fixtures`).

## 2. Đưa lên mạng bằng Vercel (miễn phí)

**Cách A, qua GitHub (khuyên dùng)**
1. Tạo kho GitHub mới, đẩy toàn bộ thư mục này lên (thay nội dung kho cũ nếu muốn).
2. Vào https://vercel.com, đăng nhập bằng GitHub, chọn **Add New → Project**, chọn kho vừa tạo.
3. Vercel tự nhận Vite. Giữ nguyên: Build Command `npm run build`, Output Directory `dist`. Bấm **Deploy**.

**Cách B, qua dòng lệnh**
```bash
npm install -g vercel
vercel          # lần đầu: trả lời các câu hỏi, chọn mặc định
vercel --prod   # đưa bản chính thức lên
```

## 3. Bật AI dự phòng (tùy chọn)

Chỉ cần khi muốn AI đọc lại các dòng app không chắc. Không bật thì app vẫn chạy đủ chức năng, các dòng không chắc sẽ vào mục **Cần xem lại** để bạn sửa tay.

1. Tạo khóa API tại https://console.anthropic.com (mục API Keys).
2. Trong Vercel: **Project → Settings → Environment Variables**, thêm:

| Tên | Giá trị |
|---|---|
| `ANTHROPIC_API_KEY` | khóa vừa tạo (bắt buộc) |
| `APP_ACCESS_KEY` | một chuỗi bí mật dài tự đặt, ví dụ 24 ký tự ngẫu nhiên (bắt buộc) |
| `ANTHROPIC_MODEL` | tùy chọn, mặc định `claude-haiku-5-5`. **Hãy kiểm tra tên mô hình này có trong tài khoản của bạn**; nếu không, đặt tên mô hình khác. |

3. **Redeploy** (Deployments → ⋯ → Redeploy) để biến môi trường có hiệu lực.
4. Trong app: **Cài đặt → Đọc ảnh và AI** → bật “Nhờ AI đọc lại…”, địa chỉ để `/api/vision`, dán `APP_ACCESS_KEY` vào ô mã truy cập.

Ghi chú: `npm run dev` không chạy thư mục `api/`. Muốn thử AI trên máy, dùng `vercel dev` thay cho `npm run dev`.

## 4. Cách dùng hằng ngày

1. **Nhập ảnh**: chọn ngày báo cáo của lô, rồi kéo thả (hoặc Ctrl+V dán) nhiều ảnh. Có thanh tiến độ, tạm dừng/tiếp tục; đóng tab giữa chừng thì lần mở sau tự đọc tiếp.
2. Ảnh **khớp kiểm tra** (tổng các dòng = dòng tổng trên ảnh, đã xử lý ≤ phát sinh, mọi hạng mục đã biết) được **tự duyệt**.
3. Ảnh còn lại nằm ở **Cần xem lại**: ảnh gốc ở bên trái (phóng được, rê chuột vào dòng sẽ tô sáng dòng đó trên ảnh), bảng số ở bên phải. Sửa số hoặc chọn hạng mục, rồi bấm **Duyệt**.
4. Gặp **hạng mục mới**: chọn “＋ Hạng mục mới…”, đặt tên một lần. Các ảnh sau tự nhận ra.
5. **Tổng hợp tháng**: cộng dồn mọi báo cáo trong tháng. Bấm một dòng để xem các báo cáo đã góp vào. Tải CSV (mở bằng Excel) hoặc ảnh PNG.
6. **Lịch sử**: mở lại báo cáo để sửa, hoặc xóa (có hoàn tác).
7. **Cài đặt → Dữ liệu**: sao lưu/khôi phục bằng tệp JSON. Nên sao lưu định kỳ vì dữ liệu nằm trong trình duyệt.

Mỗi ảnh được hiểu là số **phát sinh riêng của lần đó**, tổng tháng là **cộng dồn các ảnh**.

## 5. Cách app đọc ảnh

- **Dò bảng**: tìm hàng tiêu đề xanh, đường kẻ hàng/cột, tự co giãn theo kích thước ảnh. Không dùng tọa độ cố định.
- **Đọc số**: tách từng chữ số rồi so khớp với mẫu (không dùng OCR cho số vì thử nghiệm cho thấy OCR đọc rất kém trên các ô số nhỏ). Mẫu khởi đầu nằm trong `src/core/seeds.json` và `src/core/calibration.json`, và **app học thêm từ mỗi báo cáo đã duyệt**.
- **Đọc tên hạng mục**: nhận bằng “chữ ký” hình dạng của ô tên (không cần OCR). Tên lạ mới dùng OCR chữ Hán (tải khoảng 20 MB lần đầu, có thể tắt trong Cài đặt), rồi hỏi bạn một lần.
- **Không đoán**: ô nào không chắc thì ảnh vào **Cần xem lại**; ô trống không bao giờ bị coi là 0.

## 6. Cấu trúc thư mục

```
src/core/     logic thuần: dò bảng, đọc số, danh mục, kiểm tra khớp, tổng hợp (có test)
src/ocr/      pipeline đọc ảnh, hàng đợi, cầu nối trình duyệt, OCR chữ Hán, client AI
src/app/      kho dữ liệu IndexedDB, trạng thái và hành động, bảng thuật ngữ tiếng Việt
src/ui/       giao diện Preact (4 tab + Cài đặt)
api/vision.js hàm Vercel gọi AI (khóa API chỉ nằm ở server)
test/         kiểm thử + 2 ảnh mẫu kèm đáp án (test/fixtures/expected.json)
scripts/      tạo lại mẫu khởi đầu và dữ liệu hiệu chuẩn
```

Thêm ảnh mẫu mới để app đọc tốt hơn: chép ảnh vào `test/fixtures/`, điền đáp án vào `expected.json`, rồi chạy `npm run calibrate`.

## 7. Giới hạn đã biết

- Mẫu chữ số khởi đầu có sẵn các số **0, 1, 3, 4, 5, 6, 9** từ ảnh thật. Các số **2, 7, 8** mới chỉ có mẫu từ font nên độ chắc thấp hơn; ảnh có các số này nếu đọc sai sẽ vào “Cần xem lại”, và app học dần sau khi bạn duyệt.
- Đã kiểm thử với bảng đúng mẫu (tiêu đề xanh, cột tên, hai cột số, dòng tổng). Bảng khác hẳn bố cục có thể phải chỉnh `src/core/grid.js`.
- Ảnh chụp bằng điện thoại (nghiêng, lóa) chưa được hỗ trợ; ảnh chụp màn hình thì tốt.
- OCR chữ Hán cần mạng ở lần đầu (tải dữ liệu ngôn ngữ). Không có mạng thì tên lạ sẽ để bạn tự chọn.
- Chưa có đồng bộ giữa nhiều máy/người. Mỗi trình duyệt có dữ liệu riêng; dùng sao lưu/khôi phục để chuyển.

## 8. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Ảnh báo “Ảnh trùng” | Ảnh giống hệt đã nhập. Bấm “Vẫn nhập” nếu thật sự muốn nhập lại. |
| Nhiều ảnh vào “Cần xem lại” | Duyệt vài ảnh đầu, app sẽ học và các ảnh sau thường tự khớp. |
| Đọc sai số liên tục | Cài đặt → Dữ liệu → “Xóa mẫu đã học”. |
| Mất dữ liệu sau khi xóa lịch sử duyệt web | Khôi phục từ tệp sao lưu JSON. |
| Nút AI báo lỗi 401 | Mã truy cập trong Cài đặt khác `APP_ACCESS_KEY` trên Vercel. |
| Nút AI báo lỗi 500 | Chưa đặt `ANTHROPIC_API_KEY`/`APP_ACCESS_KEY` hoặc chưa Redeploy. |
