// Vercel Serverless Function: đọc lại các hàng bảng không chắc bằng Claude vision.
// Biến môi trường (đặt trong Vercel > Settings > Environment Variables):
//   ANTHROPIC_API_KEY  (bắt buộc)  khóa API, chỉ nằm ở server
//   APP_ACCESS_KEY     (bắt buộc)  mã truy cập chung của nhóm; trình duyệt gửi trong header x-access-key
//   ANTHROPIC_MODEL    (tùy chọn)  mặc định claude-haiku-5-5 — hãy kiểm tra tên mô hình đang khả dụng trong tài khoản của bạn
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const MAX_ROWS = 20;
const MAX_IMAGE_CHARS = 700_000; // ~500 KB ảnh nhị phân sau base64
const hits = new Map(); // giới hạn tần suất đơn giản theo IP (best effort, mỗi instance)

const SYSTEM = `Bạn đọc ảnh chụp các hàng của bảng thống kê sự cố (chữ Hán giản thể + số). Mỗi ảnh là MỘT hàng với các cột: số thứ tự, tên loại sự cố, số "phát sinh" (发生次数), số "đã xử lý" (已处理).
Chỉ trả về JSON thuần, không giải thích, đúng dạng: {"rows":[{"id":"<id>","name":"<tên loại sự cố>","occ":<số nguyên hoặc null>,"processed":<số nguyên hoặc null>}]}.
Nếu không chắc một giá trị thì dùng null. Tuyệt đối không đoán.`;

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 30;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ANTHROPIC_API_KEY || !process.env.APP_ACCESS_KEY) return res.status(500).json({ error: 'Máy chủ chưa cấu hình' });
  if (req.headers['x-access-key'] !== process.env.APP_ACCESS_KEY) return res.status(401).json({ error: 'Sai mã truy cập' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Quá nhiều yêu cầu, thử lại sau' });

  const rows = req.body?.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
  const content = [];
  for (const r of rows) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(r?.image || ''));
    if (!m || m[1].length > MAX_IMAGE_CHARS || !/^[0-9]{1,3}$/.test(String(r.id))) return res.status(400).json({ error: 'Ảnh hoặc id không hợp lệ' });
    content.push({ type: 'text', text: `id=${r.id}` }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: m[1] } });
  }
  content.push({ type: 'text', text: 'Trả về JSON như yêu cầu.' });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 40_000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: SYSTEM, messages: [{ role: 'user', content }] }),
    });
    if (!r.ok) return res.status(502).json({ error: `Dịch vụ AI lỗi (${r.status})` });
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    const clean = (Array.isArray(json.rows) ? json.rows : []).map((x) => ({
      id: String(x.id ?? ''), name: typeof x.name === 'string' ? x.name.slice(0, 80) : '',
      occ: Number.isInteger(x.occ) && x.occ >= 0 ? x.occ : null,
      processed: Number.isInteger(x.processed) && x.processed >= 0 ? x.processed : null,
    }));
    return res.status(200).json({ rows: clean });
  } catch (e) {
    return res.status(502).json({ error: e.name === 'AbortError' ? 'AI phản hồi quá lâu' : 'Không đọc được phản hồi AI' });
  } finally { clearTimeout(timer); }
}
