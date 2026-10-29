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

## 3. Cài đặt Supabase (đăng nhập một lần + đồng bộ) và Gemini (AI) — làm theo thứ tự

Sau khi xong, **không còn mật khẩu nào phải nhập**: mỗi thiết bị đăng nhập bằng email đúng một lần rồi tự giữ phiên nhiều tháng. Chỉ có **số liệu** (báo cáo đã xác nhận, danh mục loại sự cố, mẫu số đã học) được đồng bộ; **ảnh gốc không bao giờ rời thiết bị**.

### 3.1 Tạo dự án Supabase
1. Vào https://supabase.com → **New project** (gói Free là đủ). Chọn vùng gần bạn (ví dụ Singapore). Đặt mật khẩu database tùy ý (không dùng đến trong app).
2. **SQL Editor → New query** → dán toàn bộ nội dung file `supabase/schema.sql` → **Run**. Chạy lại nhiều lần cũng an toàn. Lệnh này tạo bảng, bật bảo mật theo hàng (chỉ người đã đăng nhập mới đọc/ghi được) và hàm đếm lượt AI mỗi ngày.
3. **Authentication → Providers → Email**: bật Email. **Tắt “Allow new users to sign up”** (quan trọng: nếu không, ai biết địa chỉ cũng tự tạo tài khoản được). Có thể tắt “Confirm email” vì ta đăng nhập bằng mã/liên kết.
4. **Authentication → Users → Add user → Send invitation** (hoặc Create new user): nhập email của từng người trong nhóm.
5. **Authentication → URL Configuration**: đặt **Site URL** = địa chỉ app trên Vercel (ví dụ `https://qt-web-loc-du-lieu-bao-cao.vercel.app`) và thêm cùng địa chỉ đó vào **Redirect URLs**.
6. **Authentication → Email Templates → Magic Link**: thêm dòng `Mã đăng nhập: {{ .Token }}` vào nội dung (giữ nguyên liên kết). Nhờ vậy email có **cả liên kết và mã 6 số**. Mã rất hữu ích trên iPhone: khi đã “Thêm vào Màn hình chính”, liên kết trong email mở bằng Safari (phiên riêng), còn mã thì nhập được thẳng vào app.
7. Lấy hai giá trị ở **Project Settings → API**: **Project URL** và khóa **anon public** (khóa anon là công khai theo thiết kế, an toàn nhờ bước 2–3. **Không dùng** khóa `service_role`).
8. (Khuyến nghị) Email mặc định của Supabase bị giới hạn vài email/giờ. Nếu cả nhóm đăng nhập cùng lúc hoặc thấy “发送太频繁”, hãy cấu hình SMTP riêng ở **Project Settings → Authentication → SMTP** (ví dụ Resend, Brevo, Gmail SMTP).

### 3.2 Biến môi trường trên Vercel
**Project → Settings → Environment Variables**, với **mỗi** biến hãy tick cả Production, Preview, Development:

| Tên | Giá trị | Bắt buộc |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL ở bước 3.1-7 | có |
| `VITE_SUPABASE_ANON_KEY` | khóa anon public | có |
| `GEMINI_API_KEY` | khóa tạo tại https://aistudio.google.com/apikey | có (nếu dùng AI) |
| `AI_DAILY_LIMIT` | số lần gọi AI tối đa mỗi ngày cho cả nhóm, mặc định 200 | không |
| `GEMINI_MODEL` | model chính, mặc định `gemini-4-argon` | không |
| `GEMINI_FALLBACK_MODEL` | model dự phòng, mặc định `gemini-3.8-flash`; `none` để tắt | không |
| `GEMINI_THINKING_LEVEL` | `low` (mặc định), `medium`, `high`, `none` | không |
| ~~`APP_ACCESS_KEY`~~ | **không còn cần**. Có thể xóa biến này. | — |

Các biến `VITE_…` được đóng gói vào bản build nên **bắt buộc Redeploy** sau khi thêm/sửa (Deployments → ⋯ → Redeploy).

### 3.3 Kiểm tra
1. Mở `https://<tên-miền>/api/vision` trên trình duyệt: phải thấy `"ok":true,"missing":[],"auth":"supabase"`. Nếu `ok:false`, trường `missing` cho biết còn thiếu biến nào.
2. Mở app → nhập email đã mời → bấm liên kết trong email hoặc nhập mã 6 số. Xong! Góc trên có nhãn **☁ 已同步**.
3. Mở app ở thiết bị thứ hai, đăng nhập: báo cáo hiện ra. **设置 → 账号与云** hiện tài khoản, trạng thái đồng bộ và lượng AI đã dùng hôm nay.

### 3.4 Cài lên màn hình điện thoại (PWA)
- iPhone: Safari → Chia sẻ → **Thêm vào Màn hình chính**. (iOS chưa hỗ trợ “chia sẻ ảnh thẳng vào app”; hãy mở app và bấm “选择图片”.)
- Android: Chrome → ⋮ → **Cài đặt ứng dụng**. Sau đó từ Thư viện ảnh có thể bấm **Chia sẻ → QT汇总** để đưa ảnh vào app và nhận diện ngay.
- App mở được cả khi mất mạng; thay đổi được lưu và tự đẩy lên khi có mạng lại.

Ghi chú:
- `npm run dev` không chạy thư mục `api/`. Muốn thử AI trên máy, dùng `vercel dev`.
- Gemini 4 Argon đang có giá giới thiệu 2 USD / 10 USD cho mỗi 1 triệu token (đầu vào / đầu ra) đến hết 30/11/2026, sau đó 4 / 20 USD. App chỉ gửi những dải ảnh rất nhỏ của các dòng không chắc nên chi phí rất thấp. Hãy tự kiểm tra bảng giá hiện hành tại ai.google.dev/gemini-api/docs/pricing.
- Với Gemini API miễn phí, Google có thể dùng dữ liệu gửi lên để cải thiện sản phẩm. Nếu dữ liệu nhạy cảm, hãy dùng dự án đã bật thanh toán và đọc điều khoản dữ liệu của gói bạn dùng.
- Khóa API chỉ nằm ở máy chủ Vercel, và được gửi trong header `x-goog-api-key` (không nằm trong URL).

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
| Thanh AI: “AI 服务端尚未配置” (500) | Thiếu `GEMINI_API_KEY` hoặc `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (thanh liệt kê đúng biến thiếu), hoặc chưa Redeploy. Sửa xong bấm “立即重试” hoặc để app tự phát hiện. |
| “登录已失效，请重新登录” | Phiên đăng nhập hết hạn hẳn (hiếm). Bấm “重新登录” rồi nhập email/mã một lần nữa. |
| “该邮箱没有被邀请” | Email chưa được thêm ở Supabase → Authentication → Users. |
| Không nhận được email / “发送太频繁” | Kiểm tra thư rác; cấu hình SMTP riêng (3.1-8). |
| Vào được app nhưng không đồng bộ, báo lỗi 404/“relation does not exist” | Chưa chạy `supabase/schema.sql`. |
| “今日 AI 次数已用完” | Đạt `AI_DAILY_LIMIT`; tự reset lúc 0 giờ (UTC+7) hoặc tăng giá trị trên Vercel. |
| “Gemini 密钥无效” | `GEMINI_API_KEY` sai/bị thu hồi. |
| “模型不可用” | Tên `GEMINI_MODEL` không có trong tài khoản; đặt `GEMINI_MODEL=gemini-3.8-flash`. |
| “Gemini 额度不足或请求过快” (429) | Hết hạn mức: app tự thử lại sau; cân nhắc bật thanh toán cho dự án Gemini. |
| Số được đánh dấu “总计推算” | Không có AI, app suy ra số từ dòng tổng của ảnh (chỉ khi có đúng một ô nghi ngờ). Luôn cần bạn nhìn ảnh rồi xác nhận. |
