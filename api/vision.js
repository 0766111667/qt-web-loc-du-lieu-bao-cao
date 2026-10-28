// Vercel Serverless Function：用 Google Gemini 重新识别表格中不确定的行。
// 环境变量（Vercel > Settings > Environment Variables）：
//   GEMINI_API_KEY   （必填）在 https://aistudio.google.com/apikey 创建；只保存在服务端
//   APP_ACCESS_KEY   （必填）团队共用的访问密码；浏览器通过请求头 x-access-key 发送
//   GEMINI_MODEL     （可选）默认 gemini-4-argon（目前最新的稳定版）；想更省钱可改成 gemini-3.8-flash
//   GEMINI_THINKING_LEVEL （可选）low | medium | high，默认 low；设为 none 则不发送该参数
const MODEL = process.env.GEMINI_MODEL || 'gemini-4-argon';
const THINKING = process.env.GEMINI_THINKING_LEVEL || 'low';
const MAX_ROWS = 20;
const MAX_IMAGE_CHARS = 700_000; // base64 后约 500 KB
const hits = new Map();          // 简单的按 IP 限速（尽力而为，每个实例独立）

const SYSTEM = `You read cropped rows of a Chinese issue-statistics table (Simplified Chinese text plus numbers).
Each image is ONE table row with columns: serial number, issue type name, occurrence count (发生次数), processed count (已处理).
Return only JSON. For every image return its id, the issue type name exactly as printed, and the two counts as integers.
If you are not sure about a value use null. Never guess.`;

const SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          occ: { type: ['integer', 'null'] },
          processed: { type: ['integer', 'null'] },
        },
        required: ['id', 'name', 'occ', 'processed'],
      },
    },
  },
  required: ['rows'],
};

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 30;
}

function buildBody(parts, { schema, thinking }) {
  const generationConfig = { responseMimeType: 'application/json', maxOutputTokens: 4096 };
  if (schema) generationConfig.responseJsonSchema = SCHEMA;
  if (thinking && thinking !== 'none') generationConfig.thinkingConfig = { thinkingLevel: thinking };
  return {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts }],
    generationConfig,
  };
}

// 先用完整参数；若返回 400（例如所选模型不支持某个参数），依次去掉 JSON Schema、再去掉 thinkingConfig 重试。
async function callGemini(parts, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const variants = [{ schema: true, thinking: THINKING }, { schema: false, thinking: THINKING }, { schema: false, thinking: 'none' }];
  let last;
  for (const v of variants) {
    last = await fetch(url, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(buildBody(parts, v)),
    });
    if (last.status !== 400) return last;
  }
  return last;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '不支持的请求方法' });
  if (!process.env.GEMINI_API_KEY || !process.env.APP_ACCESS_KEY) return res.status(500).json({ error: '服务器尚未配置' });
  if (!/^[a-z0-9.\-]+$/i.test(MODEL)) return res.status(500).json({ error: '模型名称无效' });
  if (req.headers['x-access-key'] !== process.env.APP_ACCESS_KEY) return res.status(401).json({ error: '访问密码错误' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: '请求过于频繁，请稍后再试' });

  const rows = req.body?.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) return res.status(400).json({ error: '数据无效' });
  const parts = [];
  for (const r of rows) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(r?.image || ''));
    if (!m || m[1].length > MAX_IMAGE_CHARS || !/^[0-9]{1,3}$/.test(String(r.id))) return res.status(400).json({ error: '图片或编号无效' });
    parts.push({ text: `id=${r.id}` }, { inlineData: { mimeType: 'image/png', data: m[1] } });
  }
  parts.push({ text: 'Return the JSON now.' });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 40_000);
  try {
    const r = await callGemini(parts, ctl.signal);
    if (!r.ok) return res.status(502).json({ error: `AI 服务出错（${r.status}）` });
    const data = await r.json();
    if (data.promptFeedback?.blockReason) return res.status(502).json({ error: 'AI 拒绝处理该内容' });
    const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    const clean = (Array.isArray(json.rows) ? json.rows : []).map((x) => ({
      id: String(x.id ?? ''), name: typeof x.name === 'string' ? x.name.slice(0, 80) : '',
      occ: Number.isInteger(x.occ) && x.occ >= 0 ? x.occ : null,
      processed: Number.isInteger(x.processed) && x.processed >= 0 ? x.processed : null,
    }));
    return res.status(200).json({ rows: clean });
  } catch (e) {
    return res.status(502).json({ error: e.name === 'AbortError' ? 'AI 响应超时' : '无法解析 AI 的回复' });
  } finally { clearTimeout(timer); }
}
