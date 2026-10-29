// Danh mục hạng mục sự cố ĐỘNG. Hạng mục nhận diện theo tên/chữ ký, không theo số thứ tự trong ảnh.
// Mọi hàm trả về danh mục mới (không sửa tại chỗ) để dễ lưu và hoàn tác.
import { normName, similarity } from './normalize.js';
import { sigDistance } from './cells.js';

export const DEFAULT_ITEMS = [
  '节点超时/线路异常', '注册来源为空', '证书问题', '讯息发送/接受异常', '网域被墙/拦截', '下载链接/浏览器异常',
  '场地IP被拉黑', '无法注册', '安装问题', '网页版问题', '密保问题', '设备限制', '三方线路异常', '无法登录',
  '登录验证问题', 'QT功能问题',
];

const NAME_SIG_THRESHOLD = 0.3;    // 1 - tương quan tối đa để coi là cùng tên
const SIG_MARGIN = 0.06;           // chênh lệch tối thiểu so với hạng mục gần thứ hai
const FUZZY_THRESHOLD = 0.74;       // độ giống tối thiểu khi OCR chữ Hán có sai nhẹ
const MAX_SIGS = 8;

let counter = 0;
export const newId = () => `c${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function createCatalog(calibration = null) {
  const items = DEFAULT_ITEMS.map((name, i) => ({
    id: `d${i + 1}`, name, label: name, aliases: [normName(name)], sigs: [], hidden: false,
  }));
  if (calibration) for (const n of calibration.names) if (items[n.i]) items[n.i].sigs.push(n.sig);
  return { version: 1, items, totalSigs: calibration ? [...calibration.totals] : [], totalAliases: ['总计', '合计', '总数', '总和', 'total'] };
}

export const orderedItems = (cat, includeHidden = false) => cat.items.filter((x) => includeHidden || !x.hidden);
export const itemById = (cat, id) => cat.items.find((x) => x.id === id) || null;
const update = (cat, fn) => ({ ...cat, items: fn(cat.items.map((x) => ({ ...x }))) });

export function matchBySignature(cat, sig, thr = NAME_SIG_THRESHOLD) {
  if (!sig) return null;
  const per = [];
  for (const it of cat.items) {
    let d = Infinity;
    for (const s of it.sigs) d = Math.min(d, sigDistance(sig, s));
    if (d < Infinity) per.push({ id: it.id, dist: d });
  }
  per.sort((p, q) => p.dist - q.dist);
  const best = per[0];
  if (!best || best.dist > thr) return null;
  const margin = (per[1]?.dist ?? 1) - best.dist;
  return margin >= SIG_MARGIN ? { ...best, margin } : null; // quá sát hạng mục khác => để OCR/người quyết định
}

export function matchByName(cat, text) {
  const n = normName(text);
  if (!n) return null;
  const per = cat.items.map((it) => ({ id: it.id, score: Math.max(...it.aliases.map((a) => similarity(n, a)), 0) })).sort((p, q) => q.score - p.score);
  const best = per[0];
  if (!best || best.score < FUZZY_THRESHOLD) return null;
  if (best.score === 1) return { ...best, how: 'exact' };
  return best.score - (per[1]?.score ?? 0) >= 0.12 ? { ...best, how: 'fuzzy' } : null;
}

export function isTotalText(cat, text) {
  const n = normName(text);
  return !!n && cat.totalAliases.some((a) => n.includes(normName(a)));
}

export function addItem(cat, { name, label }) {
  const id = newId();
  const item = { id, name, label: label || name, aliases: [normName(name)].filter(Boolean), sigs: [], hidden: false };
  return { catalog: { ...cat, items: [...cat.items, item] }, id };
}

export const addAlias = (cat, id, text) => update(cat, (items) => {
  const it = items.find((x) => x.id === id), n = normName(text);
  if (it && n && !it.aliases.includes(n)) it.aliases.push(n);
  return items;
});

export const addSignature = (cat, id, sig) => update(cat, (items) => {
  const it = items.find((x) => x.id === id);
  if (!it || !sig) return items;
  if (it.sigs.some((s) => sigDistance(s, sig) < 0.04)) return items; // đã có chữ ký gần như y hệt
  it.sigs = [...it.sigs, sig].slice(-MAX_SIGS);
  return items;
});

export const addTotalSignature = (cat, sig) => (!sig || cat.totalSigs.some((s) => sigDistance(s, sig) < 0.04) ? cat : { ...cat, totalSigs: [...cat.totalSigs, sig].slice(-MAX_SIGS) });
export const matchTotalSignature = (cat, sig) => !!sig && cat.totalSigs.some((s) => sigDistance(s, sig) <= NAME_SIG_THRESHOLD);

export const setLabel = (cat, id, label) => update(cat, (items) => { const it = items.find((x) => x.id === id); if (it) it.label = label.trim() || it.name; return items; });
export const renameSource = (cat, id, name) => update(cat, (items) => { const it = items.find((x) => x.id === id); if (it) { it.name = name.trim() || it.name; const n = normName(it.name); if (!it.aliases.includes(n)) it.aliases.push(n); } return items; });
export const setHidden = (cat, id, hidden) => update(cat, (items) => { const it = items.find((x) => x.id === id); if (it) it.hidden = hidden; return items; });
export const removeItem = (cat, id) => ({ ...cat, items: cat.items.filter((x) => x.id !== id) });

export const moveItem = (cat, id, dir) => update(cat, (items) => {
  const i = items.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return items;
  [items[i], items[j]] = [items[j], items[i]];
  return items;
});

// Gộp hạng mục `fromId` vào `toId`: chuyển tên gọi/chữ ký sang mục đích; trả kèm bản đồ id để cập nhật lịch sử.
export function mergeItems(cat, fromId, toId) {
  if (fromId === toId) return { catalog: cat, map: {} };
  const from = itemById(cat, fromId);
  if (!from) return { catalog: cat, map: {} };
  const items = cat.items.filter((x) => x.id !== fromId).map((x) => x.id === toId
    ? { ...x, aliases: [...new Set([...x.aliases, ...from.aliases])], sigs: [...x.sigs, ...from.sigs].slice(-MAX_SIGS) }
    : { ...x });
  return { catalog: { ...cat, items }, map: { [fromId]: toId } };
}

// Gộp hai danh mục khi hai người cùng sửa (không có bản gốc để so 3 chiều): hạng mục dùng chung giữ tên/nhãn/ẩn của BẢN LOCAL
// (thao tác vừa làm), còn tên gọi và chữ ký là hợp của hai bên; hạng mục chỉ có ở bên kia được thêm vào cuối.
export function mergeCatalogs(local, remote) {
  const dedupe = (list, cap) => { const out = []; for (const s of list) if (!out.some((o) => sigDistance(o, s) < 0.04)) out.push(s); return out.slice(-cap); };
  const rItems = new Map((remote.items || []).map((i) => [i.id, i]));
  const items = local.items.map((li) => {
    const ri = rItems.get(li.id);
    return ri ? { ...li, aliases: [...new Set([...li.aliases, ...ri.aliases])], sigs: dedupe([...li.sigs, ...ri.sigs], MAX_SIGS) } : { ...li };
  });
  for (const ri of remote.items || []) if (!local.items.some((x) => x.id === ri.id)) items.push({ ...ri });
  return {
    ...local, items,
    totalSigs: dedupe([...(local.totalSigs || []), ...(remote.totalSigs || [])], MAX_SIGS),
    totalAliases: [...new Set([...(local.totalAliases || []), ...(remote.totalAliases || [])])],
  };
}
