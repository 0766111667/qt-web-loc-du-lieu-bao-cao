// Chuẩn hóa tên hạng mục để so khớp: bỏ khoảng trắng/dấu câu, thống nhất ký tự toàn/bán góc.
export function normName(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[\s\u3000·•。，,.:：;；、|丨\\_\-—–()（）\[\]【】]+/g, '')
    .toLowerCase();
}

export function similarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
