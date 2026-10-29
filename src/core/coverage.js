// Kiểm tra độ đầy đủ theo ngày: ngày thiếu báo cáo và ngày có nhiều báo cáo (nguy cơ cộng đôi).
const iso = (d) => d.toISOString().slice(0, 10);
const parse = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const monthEnd = (month) => { const [y, m] = month.split('-').map(Number); return iso(new Date(Date.UTC(y, m, 0))); };

const sig = (rep) => JSON.stringify(rep.rows.map((r) => [r.itemId, r.occ, r.proc]).sort());

export function coverage(reports, month, { today, skipWeekends = false } = {}) {
  const inMonth = reports.filter((r) => r.month === month);
  const dates = [...new Set(inMonth.map((r) => r.date))].sort();
  if (!dates.length) return { dates, missing: [], duplicates: [] };
  const first = dates[0], lastReported = dates.at(-1);
  const yesterday = today ? addDays(today, -1) : lastReported;
  const end = [lastReported, [monthEnd(month), yesterday].sort()[0]].sort().at(-1); // tháng đã qua: đến cuối tháng; tháng hiện tại: đến hôm qua
  const have = new Set(dates), missing = [];
  for (let d = first; d <= end; d = addDays(d, 1)) {
    const wd = parse(d).getUTCDay();
    if (skipWeekends && (wd === 0 || wd === 6)) continue;
    if (!have.has(d)) missing.push(d);
  }
  const duplicates = dates.map((d) => ({ date: d, reps: inMonth.filter((r) => r.date === d) })).filter((g) => g.reps.length > 1)
    .map((g) => ({ date: g.date, count: g.reps.length, ids: g.reps.map((r) => r.id), names: g.reps.map((r) => r.name), identical: new Set(g.reps.map(sig)).size < g.reps.length }));
  return { dates, missing, duplicates };
}

// Các báo cáo đã có ở cùng ngày (để cảnh báo ngay lúc duyệt ảnh mới, trước khi bị cộng đôi).
export function sameDateReports(reports, date, excludeId) {
  return reports.filter((r) => r.date === date && r.id !== excludeId).map((r) => ({ id: r.id, name: r.name, occ: r.rows.reduce((t, x) => t + x.occ, 0), proc: r.rows.reduce((t, x) => t + x.proc, 0) }));
}
