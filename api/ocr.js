export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image, apiKey } = req.body;
  if (!image || !apiKey) {
    return res.status(400).json({ error: 'Missing image or API key' });
  }

  // Danh sách các model dự phòng theo thứ tự ưu tiên mới nhất
  const models = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  let lastError = null;

  const prompt = `You are a professional data extractor. Analyze this exact QT software issue statistics report image ("QT软件使用问题统计"). 
  Extract the exact numbers for all 16 rows corresponding to these exact problem types:
  1. 节点超时/线路异常
  2. 注册来源为空
  3. 证书问题
  4. 讯息发送/接受异常
  5. 网域被墙/拦截
  6. 下载链接/浏览器异常
  7. 场地IP被拉黑
  8. 无法注册
  9. 安装问题
  10. 网页版问题
  11. 密保问题
  12. 设备限制
  13. 三方线路异常
  14. 无法登录
  15. 登录验证问题
  16. QT功能问题

  Return ONLY valid JSON format like this, strictly verify occurrences and processed numbers from the table:
  {
    "items": [
      { "id": 1, "name": "节点超时/线路异常", "occurrences": 2, "processed": 2 }
    ],
    "totalOccurrences": 12,
    "totalProcessed": 12
  }`;

  for (const modelName of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    // Thử retry tối đa 3 lần cho mỗi model nếu gặp quá tải (503 / High demand)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inline_data: { mime_type: "image/jpeg", data: image } }
              ]
            }]
          })
        });

        const result = await response.json();
        if (result.error) {
          throw new Error(`[Model ${modelName}] ${result.error.message}`);
        }
        if (!result.candidates || !result.candidates[0]) {
          throw new Error(`[Model ${modelName}] No candidates returned.`);
        }

        const textResponse = result.candidates[0].content.parts[0].text;
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error(`[Model ${modelName}] Invalid JSON from AI.`);

        const parsedData = JSON.parse(jsonMatch[0]);
        return res.status(200).json({ success: true, data: parsedData, modelUsed: modelName });
      } catch (err) {
        lastError = err;
        console.warn(`Attempt ${attempt} with ${modelName} failed:`, err.message);
        const errMsg = err.message.toLowerCase();
        if (errMsg.includes('503') || errMsg.includes('overloaded') || errMsg.includes('high demand') || errMsg.includes('resource_exhausted')) {
          await new Promise(r => setTimeout(r, 2000 * attempt)); // Chờ tăng dần rồi thử lại
          continue;
        } else {
          break; // Lỗi khác (như sai key) thì chuyển sang model tiếp theo ngay
        }
      }
    }
  }

  return res.status(500).json({ error: lastError ? lastError.message : 'All models failed due to high demand.' });
}
