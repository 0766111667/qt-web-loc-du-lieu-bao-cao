# 汇总 QT 软件问题统计（Tổng hợp sự cố QT）

Web app đọc **ảnh bảng thống kê sự cố QT** (ảnh chụp bảng Excel), kiểm tra khớp, rồi **cộng dồn theo tháng**.
**Giao diện web hiển thị hoàn toàn bằng tiếng Trung giản thể** (thuật ngữ khớp với bảng nguồn: 问题类型, 发生次数, 已处理, 占比例, 总计). Danh mục hạng mục là **động**: thêm, đổi tên, đổi thứ tự, gộp, ẩn, xóa ngay trong Cài đặt, không cần sửa code.

Ảnh gốc nằm **trong trình duyệt của bạn** (IndexedDB) và không bao giờ được tải lên. Số liệu đã xác nhận được đồng bộ qua Supabase của bạn (nếu cấu hình). Khi AI bật, chỉ những dải ảnh nhỏ của các dòng không chắc được gửi qua máy chủ Vercel của bạn tới Gemini.

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

Kiểm tra mã nguồn: `npm test` (18 bài kiểm thử, chạy trên 2 ảnh mẫu trong `test/fixtures`).

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

## 3. Cài đặt Supabase (đăng nhập + đồng bộ) và Gemini (AI) — làm theo thứ tự

Kết quả: **một tài khoản `admin` + mật khẩu bạn tự chọn**, đăng nhập được trên mọi máy (không cần email/mã/liên kết), mỗi thiết bị chỉ đăng nhập một lần. Chỉ **số liệu** (báo cáo đã xác nhận, danh mục, mẫu số đã học) được đồng bộ; **ảnh gốc không bao giờ rời thiết bị**.

### 3.1 Tạo dự án Supabase
1. https://supabase.com → **New project** (gói Free là đủ).
2. **SQL Editor → New query** → dán toàn bộ `supabase/schema.sql` → **Run** (chạy lại nhiều lần vẫn an toàn). Lệnh này tạo bảng, bật bảo mật theo hàng, danh sách thành viên được phép (`admin@qt.app`) và bộ đếm lượt AI mỗi ngày.
3. **Authentication → Providers → Email**: bật Email; **TẮT “Allow new users to sign up”** (bắt buộc — nếu không ai cũng tự tạo tài khoản được); **TẮT “Confirm email”**.
4. **Authentication → Users → Add user → Create new user**: Email = `admin@qt.app`, Password = mật khẩu của bạn (**tối thiểu 12 ký tự, dài và khó đoán**; ví dụ 3–4 từ ghép), tick **Auto Confirm User**. Trong app, bạn chỉ gõ **admin** + mật khẩu đó.
5. (Nên làm) **Authentication → Policies / Attack Protection**: bật bảo vệ chống đoán mật khẩu (rate limit mặc định của Supabase đã giới hạn số lần đăng nhập sai). Nếu muốn thêm người, thêm email của họ vào bảng `allowed_members` (SQL Editor: `insert into allowed_members values ('ten@qt.app');`) và tạo user như bước 4.
6. **Project Settings → API**: lấy **Project URL** và khóa **anon public**. **Tuyệt đối không dùng `service_role`** (build sẽ tự từ chối nếu thấy khóa bí mật trong biến `VITE_…`).

### 3.2 Gemini (gói miễn phí)
Tạo khóa ở https://aistudio.google.com/apikey. Gói miễn phí giới hạn **số lượt/phút** và **số lượt/ngày**; app đã tính sẵn: gom nhiều ô vào một lượt gọi, cách nhau ~6 giây, khi Google báo hết hạn mức thì **tự dừng và chờ đúng thời gian** (không thử lại liên tục). Mục **设置 → 识别与 AI → AI 诊断** hiện trạng thái thật của hạn mức.

### 3.3 Biến môi trường trên Vercel
**Project → Settings → Environment Variables**, mỗi biến tick cả Production/Preview/Development:

| Tên | Giá trị | Bắt buộc |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL (3.1-6) | có |
| `VITE_SUPABASE_ANON_KEY` | khóa anon public | có |
| `GEMINI_API_KEY` | khóa ở 3.2 (chỉ nằm trên máy chủ) | có (nếu dùng AI) |
| `AI_DAILY_LIMIT` | số lượt gọi AI tối đa/ngày cho cả nhóm, mặc định 100 | không |
| `GEMINI_MODEL` | mặc định `auto` (tự chọn model Flash mà tài khoản được dùng). Chỉ đặt cứng nếu cần, ví dụ `gemini-3.8-flash` | không |
| `GEMINI_FALLBACK_MODEL` | mặc định tự chọn; `none` để tắt | không |
| `GEMINI_THINKING_LEVEL` | `low` (mặc định), `medium`, `high`, `none` | không |
| ~~`APP_ACCESS_KEY`~~ | **đã bỏ**, xóa đi | — |

Các biến `VITE_…` được đóng gói vào bản build nên **phải Redeploy** sau khi thêm/sửa (Deployments → ⋯ → Redeploy).

### 3.4 Kiểm tra
1. Mở `https://<tên-miền>/api/vision`: khi chưa đăng nhập chỉ thấy `{"ok":true,"missing":[],"authorized":false}` (cố ý không lộ thêm gì). Nếu `missing` không rỗng, còn thiếu biến.
2. Mở app → **账号 `admin`** + mật khẩu → **登录**. Góc trên có nhãn **☁ 已同步**.
3. **设置 → 识别与 AI → 检查 AI 连接**: báo “✓ 正常” hoặc nói thẳng lý do (hết hạn mức phút/ngày, khóa sai…).
4. Máy thứ hai: đăng nhập cùng `admin` + mật khẩu → báo cáo hiện ra.

### 3.5 Cài lên màn hình điện thoại (PWA)
- iPhone: Safari → Chia sẻ → **Thêm vào Màn hình chính** (iOS chưa hỗ trợ “chia sẻ ảnh thẳng vào app”; bấm “选择图片”).
- Android: Chrome → ⋮ → **Cài đặt ứng dụng**; từ Thư viện ảnh bấm **Chia sẻ → QT汇总**.

### 3.6 Bảo mật — những lớp đã có và việc bạn cần làm
- **Bạn cần làm**: tắt đăng ký công khai (3.1-3), mật khẩu admin ≥ 12 ký tự và không dùng ở nơi khác, không đưa `service_role`/khóa Gemini vào biến `VITE_…`, đừng chia sẻ mật khẩu qua kênh công khai.
- **Cơ sở dữ liệu**: RLS bật mọi bảng; chỉ email trong `allowed_members` mới đọc/ghi được; không ai có quyền xóa cứng (chỉ xóa mềm); ràng buộc kích thước/định dạng; lượt AI đếm nguyên tử trong DB.
- **API AI** (`/api/vision`): bắt buộc token đăng nhập hợp lệ + là thành viên; không có token thì không lộ cấu hình; kiểm tra Origin; giới hạn tốc độ theo IP và theo tài khoản; giới hạn kích thước và định dạng ảnh (chỉ PNG nhỏ), tối đa 40 ô/lượt; đếm lượt trong DB **trước** khi gọi Google và **từ chối nếu không đếm được** (không để chi phí mất kiểm soát); khóa Gemini chỉ ở máy chủ, gửi bằng header; lỗi trả về không lộ khóa.
- **Trình duyệt**: Content-Security-Policy chặt (chỉ cho phép chính trang, Supabase và CDN của Tesseract), HSTS, chống nhúng khung (clickjacking), nosniff, Permissions-Policy; dữ liệu đồng bộ/khôi phục được kiểm tra hình dạng và giới hạn trước khi lưu; xuất CSV chống “công thức độc” (`=`, `+`, `-`, `@`); thông báo đăng nhập sai luôn chung chung.
- **Chưa kiểm tra được trong phiên làm việc này**: `npm audit` (mạng bị chặn) — hãy chạy `npm audit` trên máy bạn trước khi triển khai. Nếu OCR chữ Hán không tải được sau khi triển khai, kiểm tra mục Console xem CSP có chặn tên miền nào của Tesseract không rồi bổ sung vào `vercel.json`.

Ghi chú:
- `npm run dev` không chạy `api/`; muốn thử AI trên máy dùng `vercel dev`.
- Gói miễn phí của Gemini: Google có thể dùng dữ liệu gửi lên để cải thiện sản phẩm. App chỉ gửi những ô số rất nhỏ; nếu dữ liệu nhạy cảm hãy dùng dự án có bật thanh toán.

## 4. Cách dùng hằng ngày

1. **导入图片 (Nhập ảnh)**: chọn ngày báo cáo của lô, rồi kéo thả (hoặc Ctrl+V dán) nhiều ảnh. Có thanh tiến độ, tạm dừng/tiếp tục; đóng tab giữa chừng thì lần mở sau tự đọc tiếp.
2. Ảnh **khớp kiểm tra** (tổng các dòng = dòng tổng trên ảnh, đã xử lý ≤ phát sinh, mọi hạng mục đã biết) được **tự duyệt**.
3. Ảnh còn lại nằm ở **待复核 (Cần xem lại)**: ảnh gốc ở bên trái (phóng được, rê chuột vào dòng sẽ tô sáng dòng đó trên ảnh), bảng số ở bên phải. Sửa số hoặc chọn hạng mục, rồi bấm **Duyệt**.
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
src/app/      kho dữ liệu IndexedDB, trạng thái và hành động, text.js (toàn bộ chữ giao diện tiếng Trung)
src/ui/       giao diện Preact (4 tab + Cài đặt)
api/vision.js hàm Vercel gọi Gemini (khóa API chỉ nằm ở server)
test/         kiểm thử + 2 ảnh mẫu kèm đáp án (test/fixtures/expected.json)
scripts/      tạo lại mẫu khởi đầu và dữ liệu hiệu chuẩn
```

Thêm ảnh mẫu mới để app đọc tốt hơn: chép ảnh vào `test/fixtures/`, điền đáp án vào `expected.json`, rồi chạy `npm run calibrate`.

## 7. Giới hạn đã biết

- Mẫu chữ số khởi đầu có sẵn các số **0, 1, 3, 4, 5, 6, 9** từ ảnh thật. Các số **2, 7, 8** mới chỉ có mẫu từ font nên độ chắc thấp hơn; ảnh có các số này nếu đọc sai sẽ vào “Cần xem lại”, và app học dần sau khi bạn duyệt.
- Đã kiểm thử với bảng đúng mẫu (tiêu đề xanh, cột tên, hai cột số, dòng tổng). Bảng khác hẳn bố cục có thể phải chỉnh `src/core/grid.js`.
- Ảnh chụp bằng điện thoại (nghiêng, lóa) chưa được hỗ trợ; ảnh chụp màn hình thì tốt.
- OCR chữ Hán cần mạng ở lần đầu (tải dữ liệu ngôn ngữ). Không có mạng thì tên lạ sẽ để bạn tự chọn.
- Đồng bộ qua Supabase (xem mục 3): báo cáo đã xác nhận, danh mục và mẫu đã học dùng chung cả nhóm; **ảnh và hàng chờ “待复核” chỉ nằm trên thiết bị đã nhập ảnh**. Hai người sửa cùng một báo cáo cùng lúc: bản lưu sau thắng. Hai người cùng sửa danh mục: được gộp (nhãn của người đồng bộ sau thắng, tên gọi/chữ ký được hợp lại; hạng mục vừa bị xóa ở máy khác có thể xuất hiện lại).

## 8. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Ảnh báo “Ảnh trùng” | Ảnh giống hệt đã nhập. Bấm “Vẫn nhập” nếu thật sự muốn nhập lại. |
| Nhiều ảnh vào “Cần xem lại” | Duyệt vài ảnh đầu, app sẽ học và các ảnh sau thường tự khớp. |
| Đọc sai số liên tục | Cài đặt → Dữ liệu → “Xóa mẫu đã học”. |
| Mất dữ liệu sau khi xóa lịch sử duyệt web | Khôi phục từ tệp sao lưu JSON. |
| Thanh AI: “AI 服务端尚未配置” | Thiếu `GEMINI_API_KEY` hoặc `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (thanh liệt kê đúng biến thiếu), hoặc chưa Redeploy. |
| “登录已失效，请重新登录” | Bấm “重新登录” rồi nhập lại `admin` + mật khẩu một lần. |
| “账号或密码错误” | Kiểm tra user `admin@qt.app` đã tạo ở Supabase (3.1-4) với Auto Confirm; mật khẩu đúng. |
| “此账号没有使用权限” | Email chưa có trong bảng `allowed_members` (chạy lại `schema.sql`). |
| Vào được app nhưng không đồng bộ, báo lỗi 404/“relation does not exist” | Chưa chạy `supabase/schema.sql`. |
| “今日 AI 次数已用完” | Đạt `AI_DAILY_LIMIT`; tự reset 0 giờ (UTC+7) hoặc tăng giá trị trên Vercel. |
| “AI 正在冷却（每分钟请求上限）” | Bình thường với gói miễn phí: app tự đếm ngược rồi chạy tiếp, các ảnh khác không bị chặn. |
| “Gemini 今日额度已用完” | Hạn mức ngày của gói miễn phí hết. App tạm dừng, kiểm tra lại mỗi 30 phút; hoặc bật thanh toán cho dự án Google. |
| “Gemini 密钥无效” | `GEMINI_API_KEY` sai/bị thu hồi. |
| “模型不可用” | Tên `GEMINI_MODEL` không có trong tài khoản; đặt `GEMINI_MODEL=gemini-3.8-flash`. |
| “Gemini 额度不足或请求过快” (429) | Hết hạn mức: app tự thử lại sau; cân nhắc bật thanh toán cho dự án Gemini. |
| Số được đánh dấu “总计推算” | Không có AI, app suy ra số từ dòng tổng của ảnh (chỉ khi có đúng một ô nghi ngờ). Luôn cần bạn nhìn ảnh rồi xác nhận. |
