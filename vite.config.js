import { defineConfig, loadEnv } from 'vite';
import preact from '@preact/preset-vite';

// An toàn: tất cả biến VITE_* đều bị NHÚNG vào mã tải về trình duyệt. Chặn build nếu lỡ đặt khóa bí mật vào đó.
function guardSecrets(mode) {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  for (const [k, v] of Object.entries(env)) {
    let bad = /SERVICE_?ROLE|SECRET|GEMINI|PRIVATE/i.test(k);
    try { const p = JSON.parse(Buffer.from(String(v).split('.')[1] || '', 'base64url').toString()); if (p?.role === 'service_role') bad = true; } catch { /* không phải JWT */ }
    if (/^sb_secret_|^AIza/.test(String(v))) bad = true;
    if (bad) throw new Error(`Biến ${k} có vẻ là KHÓA BÍ MẬT — không được đặt tên bắt đầu bằng VITE_ (sẽ lộ ra trình duyệt). Chỉ dùng anon/publishable key cho VITE_SUPABASE_ANON_KEY.`);
  }
}

// base './' để chạy được cả khi đặt dưới thư mục con
export default defineConfig(({ mode }) => {
  guardSecrets(mode);
  return { plugins: [preact()], base: './', build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 900 } };
});
