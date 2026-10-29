// Cảnh báo bất thường dựa trên các báo cáo đã xác nhận. Quy tắc đơn giản, giải thích được (không "hộp đen"):
//  - spike    : ngày báo cáo mới nhất của tháng có số phát sinh vượt trung bình ~14 ngày trước đó + max(2σ, 2) và ≥ 3.
//  - month_up : trung bình mỗi ngày báo cáo của tháng này ≥ 1,5 lần tháng trước (cần ≥ 3 ngày mỗi tháng, và tổng tháng ≥ 5).
//  - backlog  : tồn đọng (phát sinh − đã xử lý) của tháng ≥ 3 và ≥ 30% phát sinh.
import { orderedItems } from './catalog.js';
import { prevMonthOf } from './aggregate.js';

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const r1 = (x) => Math.round(x * 10) / 10;

function perDate(reports) {
  const m = new Map();
  for (const rep of reports) {
    const d = m.get(rep.date) || new Map();
    for (const row of rep.rows) { const a = d.get(row.itemId) || { occ: 0, proc: 0 }; a.occ += row.occ; a.proc += row.proc; d.set(row.itemId, a); }
    m.set(rep.date, d);
  }
  return m;
}

export function findAnomalies(reports, catalog, month) {
  const days = perDate(reports);
  const all = [...days.keys()].sort();
  const monthDates = all.filter((d) => d.startsWith(month));
  if (!monthDates.length) return [];
  const prevM = prevMonthOf(month);
  const prevDates = all.filter((d) => d.startsWith(prevM));
  const last = monthDates.at(-1);
  const prior = all.filter((d) => d < last).slice(-14);
  const out = [];
  for (const it of orderedItems(catalog)) {
    const occOn = (d) => days.get(d)?.get(it.id)?.occ ?? 0;
    const cur = occOn(last);
    if (prior.length >= 3) {
      const vals = prior.map(occOn), m = mean(vals), s = sd(vals);
      if (cur >= 3 && cur > m + Math.max(2 * s, 2)) out.push({ type: 'spike', severity: 3, itemId: it.id, label: it.label, date: last, value: cur, baseline: r1(m) });
    }
    const monthOcc = monthDates.reduce((t, d) => t + occOn(d), 0);
    const monthProc = monthDates.reduce((t, d) => t + (days.get(d)?.get(it.id)?.proc ?? 0), 0);
    if (monthDates.length >= 3 && prevDates.length >= 3 && monthOcc >= 5) {
      const curAvg = monthOcc / monthDates.length, prevAvg = prevDates.reduce((t, d) => t + occOn(d), 0) / prevDates.length;
      if (prevAvg === 0 || curAvg >= prevAvg * 1.5) out.push({ type: 'month_up', severity: 2, itemId: it.id, label: it.label, value: r1(curAvg), baseline: r1(prevAvg), ratio: prevAvg ? r1(curAvg / prevAvg) : null });
    }
    const backlog = monthOcc - monthProc;
    if (backlog >= 3 && monthOcc && backlog / monthOcc >= 0.3) out.push({ type: 'backlog', severity: 1, itemId: it.id, label: it.label, value: backlog, share: Math.round((backlog / monthOcc) * 100) });
  }
  return out.sort((a, b) => b.severity - a.severity || b.value - a.value);
}

export const describeAnomaly = (a) => ({
  spike: `${a.date.slice(5)} 发生 ${a.value} 次，明显高于近期日均 ${a.baseline}`,
  month_up: a.ratio ? `本月日均 ${a.value} 次，是上月日均 ${a.baseline} 的 ${a.ratio} 倍` : `本月日均 ${a.value} 次，上月几乎没有`,
  backlog: `本月未处理 ${a.value} 次（占发生次数的 ${a.share}%）`,
}[a.type]);
