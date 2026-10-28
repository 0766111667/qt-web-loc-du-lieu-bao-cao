import { useEffect, useState } from 'preact/hooks';
import * as db from './db.js';
import { T, errorText } from './text.js';
import seeds from '../core/seeds.json';
import calibration from '../core/calibration.json';
import { createCatalog, addItem, addAlias, addSignature, addTotalSignature, matchBySignature, setLabel, renameSource, setHidden, removeItem, moveItem, mergeItems, itemById } from '../core/catalog.js';
import { learnDigits, mergeTemplates } from '../core/learn.js';
import { aggregate, localDate, monthOf } from '../core/aggregate.js';
import { analyzeImage, revalidate } from '../ocr/pipeline.js';
import { createQueue, createLimiter } from '../ocr/queue.js';
import { decodeFile, makeThumb, sha256 } from '../ocr/canvas.js';
import { ocrName } from '../ocr/tess.js';
import { refineWithVision } from '../ocr/vision.js';

export const DEFAULTS = {
  autoApprove: true, requireProcessedLE: true, minConfidence: 0.45, concurrency: 2,
  ocrChinese: true, aiEnabled: false, aiEndpoint: '/api/vision', aiKey: '',
};

export const state = {
  ready: false, persistent: true, tab: 'import', month: monthOf(localDate()), batchDate: localDate(),
  catalog: null, learned: [], settings: { ...DEFAULTS }, jobs: [], reports: [],
  paused: false, batch: { total: 0, finished: 0 }, selectedJob: null, toast: null, settingsOpen: false,
};

// ---------- phát sự kiện cập nhật giao diện (gộp theo khung hình để 100 ảnh không làm giật) ----------
const listeners = new Set();
let frame = 0;
export function notify() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; listeners.forEach((l) => l()); });
}
export function useStore() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => listeners.delete(l); }, []);
  return state;
}

const uid = () => `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const getJob = (id) => state.jobs.find((j) => j.id === id);
const valSettings = () => ({ minConfidence: state.settings.minConfidence, requireProcessedLE: state.settings.requireProcessedLE });
let templatesCache = null;
const templates = () => (templatesCache ||= mergeTemplates(seeds, calibration.digits, state.learned));

let metaTimer = 0;
function persistMeta() {
  clearTimeout(metaTimer);
  metaTimer = setTimeout(() => db.put('meta', { key: 'app', catalog: state.catalog, learned: state.learned, settings: state.settings }), 250);
}
const saveJob = (job) => db.put('jobs', job);
const saveJobLater = (() => { const t = new Map(); return (job) => { clearTimeout(t.get(job.id)); t.set(job.id, setTimeout(() => saveJob(job), 300)); }; })();

export function toast(text, action) {
  state.toast = { text, action, id: Math.random() };
  const id = state.toast.id;
  setTimeout(() => { if (state.toast?.id === id) { state.toast = null; notify(); } }, action ? 9000 : 4500);
  notify();
}

// ---------- hàng đợi đọc ảnh ----------
const aiLimit = createLimiter(2);
const queue = createQueue({
  concurrency: DEFAULTS.concurrency,
  run: processJob,
  onEvent: (e) => { if (e.type === 'done' || e.type === 'error') { state.batch.finished = Math.min(state.batch.total, state.batch.finished + 1); notify(); } },
});

async function processJob(id) {
  const job = getJob(id);
  if (!job || job.status !== 'queued') return;
  job.status = 'working'; notify();
  try {
    const rec = await db.get('blobs', id);
    if (!rec?.blob) throw new Error('找不到已保存的图片');
    const img = await decodeFile(rec.blob);
    const ctx = { catalog: state.catalog, templates: templates(), settings: valSettings(), ocrName: state.settings.ocrChinese ? ocrName : undefined };
    let result = await analyzeImage(img, ctx);
    if (result.validation.status !== 'ok' && state.settings.aiEnabled && state.settings.aiEndpoint) {
      try { result = await refineWithVision({ img, result, catalog: state.catalog, settings: state.settings, limit: aiLimit }); }
      catch (e) { result.aiError = String(e.message || e); }
    }
    job.result = result; job.error = null;
    if (result.validation.status === 'ok' && state.settings.autoApprove) await approveJob(id, { auto: true });
    else job.status = 'review';
  } catch (e) {
    job.status = 'error'; job.error = errorText(e);
  }
  await saveJob(job);
  await new Promise((r) => setTimeout(r, 0)); // nhường luồng giao diện giữa các ảnh
  notify();
}

// ---------- khởi tạo ----------
export async function init() {
  state.persistent = await db.init();
  const meta = await db.get('meta', 'app');
  state.catalog = meta?.catalog || createCatalog(calibration);
  // Bản cũ đặt nhãn mặc định bằng tiếng Việt: chuyển về tên gốc (tiếng Trung) để giao diện thống nhất.
  state.catalog = { ...state.catalog, items: state.catalog.items.map((it) => (/^d\d+$/.test(it.id) && /[\u00c0-\u1ef9]/.test(it.label) ? { ...it, label: it.name } : it)) };
  state.learned = meta?.learned || [];
  state.settings = { ...DEFAULTS, ...(meta?.settings || {}) };
  queue.setConcurrency(state.settings.concurrency);
  state.reports = (await db.all('reports')).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  state.jobs = (await db.all('jobs')).sort((a, b) => a.createdAt - b.createdAt);
  const resume = [];
  for (const j of state.jobs) if (j.status === 'working' || j.status === 'queued') { j.status = 'queued'; resume.push(j.id); }
  state.batch = { total: resume.length, finished: 0 };
  state.ready = true; notify();
  queue.add(resume);
}

// ---------- nhập ảnh ----------
export async function addFiles(files, date = state.batchDate) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) { toast('所选内容中没有有效的图片。'); return; }
  const idle = !state.jobs.some((j) => j.status === 'queued' || j.status === 'working');
  if (idle) state.batch = { total: 0, finished: 0 };
  const seen = new Set(state.jobs.map((j) => j.hash).concat(state.reports.map((r) => r.hash)));
  const fresh = [];
  for (const f of list) {
    const hash = await sha256(f);
    const dup = seen.has(hash);
    seen.add(hash);
    const id = uid();
    const thumb = await makeThumb(f).catch(() => null);
    await db.put('blobs', { id, blob: f, thumb });
    const job = { id, name: f.name || 'pasted-image.png', size: f.size, hash, date, status: dup ? 'duplicate' : 'queued', createdAt: Date.now() };
    state.jobs.push(job);
    await saveJob(job);
    if (!dup) { state.batch.total++; fresh.push(id); }
    notify();
  }
  queue.add(fresh);
}

export const setBatchDate = (d) => { state.batchDate = d; notify(); };
export const setMonth = (m) => { state.month = m; notify(); };
export const setTab = (t) => { state.tab = t; notify(); };
export const pauseQueue = () => { queue.pause(); state.paused = true; notify(); };
export const resumeQueue = () => { queue.resume(); state.paused = false; notify(); };

export function forceImport(id) { const j = getJob(id); if (!j) return; j.status = 'queued'; state.batch.total++; saveJob(j); queue.add([id]); notify(); }
export function retryJob(id) { const j = getJob(id); if (!j) return; j.status = 'queued'; j.result = null; j.error = null; state.batch.total++; saveJob(j); queue.add([id]); notify(); }
export async function removeJob(id) {
  queue.remove(id);
  const i = state.jobs.findIndex((j) => j.id === id);
  if (i >= 0) state.jobs.splice(i, 1);
  await db.del('jobs', id); await db.del('blobs', id);
  if (state.selectedJob === id) state.selectedJob = null;
  notify();
}
export function clearFinished() {
  const done = state.jobs.filter((j) => j.status === 'done');
  done.forEach((j) => removeJob(j.id));
}

// ---------- xem lại ----------
export function openJob(id) { state.selectedJob = id; state.tab = 'review'; notify(); }

const liveRows = (job) => job.result.rows.filter((r) => !r.skip);

export function revalidateJob(job) { job.result.validation = revalidate({ ...job.result, rows: liveRows(job) }, valSettings()); }

export function editCell(jobId, rowIx, key, text) {
  const job = getJob(jobId); const row = job?.result.rows.find((r) => r.rowIx === rowIx); if (!row) return;
  const t = String(text).trim();
  const value = t === '' ? null : /^\d{1,6}$/.test(t) ? Number(t) : undefined;
  if (value === undefined) return;
  row[key] = { ...row[key], value, text: t, confidence: value == null ? 0 : 1, edited: true };
  revalidateJob(job); saveJobLater(job); notify();
}

export function editTotal(jobId, key, text) {
  const job = getJob(jobId); if (!job) return;
  const t = String(text).trim();
  const value = t === '' ? null : /^\d{1,6}$/.test(t) ? Number(t) : undefined;
  if (value === undefined) return;
  job.result.total = { rowIx: job.result.total?.rowIx ?? -1, occ: job.result.total?.occ ?? null, proc: job.result.total?.proc ?? null, confidence: 1, manual: true, [key]: value };
  revalidateJob(job); saveJobLater(job); notify();
}

export function setJobDate(jobId, date) { const j = getJob(jobId); if (!j || !date) return; j.date = date; saveJob(j); notify(); }

// Gán hạng mục cho một dòng. "Hỏi một lần rồi nhớ": lưu chữ ký tên ngay để các ảnh còn lại trong lô tự nhận ra.
export function assignItem(jobId, rowIx, itemId) {
  const job = getJob(jobId); const row = job?.result.rows.find((r) => r.rowIx === rowIx); if (!row) return;
  if (itemId === '__skip') { row.skip = true; row.itemId = null; }
  else {
    row.skip = false; row.itemId = itemId; row.nameHow = 'user';
    state.catalog = addSignature(state.catalog, itemId, row.sig);
    if (row.srcName) state.catalog = addAlias(state.catalog, itemId, row.srcName);
    persistMeta();
  }
  revalidateJob(job); saveJobLater(job);
  rematchPending(); notify();
}

export function createItemForRow(jobId, rowIx, { name, label }) {
  const n = name.trim(); if (!n) return;
  const { catalog, id } = addItem(state.catalog, { name: n, label: label?.trim() || n });
  state.catalog = catalog;
  assignItem(jobId, rowIx, id);
  toast(`已添加问题类型“${label?.trim() || n}”，之后的图片会自动识别。`);
}

async function rematchPending() {
  for (const job of state.jobs) {
    if (job.status !== 'review' || !job.result) continue;
    let changed = false;
    for (const r of job.result.rows) if (!r.itemId && !r.skip && r.sig) { const m = matchBySignature(state.catalog, r.sig); if (m) { r.itemId = m.id; r.nameHow = 'signature'; changed = true; } }
    if (!changed) continue;
    revalidateJob(job);
    if (job.result.validation.status === 'ok' && state.settings.autoApprove) await approveJob(job.id, { auto: true });
    else saveJobLater(job);
  }
  notify();
}

export function jobReady(job) {
  const rows = liveRows(job);
  return rows.length > 0 && rows.every((r) => r.itemId && r.occ.value != null && r.proc.value != null);
}

export async function approveJob(id, { auto = false } = {}) {
  const job = getJob(id); if (!job?.result) return false;
  if (!jobReady(job)) { toast('还有行未选择问题类型或缺少数字，请补全后再确认。'); return false; }
  const res = job.result;
  const rows = liveRows(job);
  const rep = {
    id, hash: job.hash, name: job.name, date: job.date, month: monthOf(job.date), createdAt: Date.now(),
    rows: rows.map((r) => ({ itemId: r.itemId, srcName: r.srcName || '', occ: r.occ.value, proc: r.proc.value })),
    printedTotal: res.total && res.total.occ != null ? { occ: res.total.occ, proc: res.total.proc } : null,
    status: auto ? 'auto' : 'manual', note: res.validation.status === 'ok' ? '' : res.validation.issues.map((i) => i.code).join(','),
  };
  state.reports = [rep, ...state.reports.filter((r) => r.id !== id)];
  await db.put('reports', rep);
  // Học từ dữ liệu đã được xác nhận
  let learned = state.learned;
  for (const r of rows) {
    for (const k of ['occ', 'proc']) learned = learnDigits(learned, r[k].glyphs, String(r[k].value));
    state.catalog = addSignature(state.catalog, r.itemId, r.sig);
  }
  if (res.totalSig) state.catalog = addTotalSignature(state.catalog, res.totalSig);
  if (learned !== state.learned) { state.learned = learned; templatesCache = null; }
  persistMeta();
  job.status = 'done'; job.reportId = id; await saveJob(job);
  if (!auto) { const next = state.jobs.find((j) => j.status === 'review'); state.selectedJob = next?.id ?? null; toast('已确认并计入月度汇总。'); }
  notify();
  return true;
}

// ---------- lịch sử ----------
export async function deleteReport(id) {
  const rep = state.reports.find((r) => r.id === id); if (!rep) return;
  state.reports = state.reports.filter((r) => r.id !== id);
  await db.del('reports', id);
  const job = getJob(id); if (job) { job.status = 'removed'; await saveJob(job); }
  toast('已从月度汇总中删除该报告。', { label: '撤销', run: async () => {
    state.reports = [rep, ...state.reports]; await db.put('reports', rep);
    if (job) { job.status = 'done'; await saveJob(job); }
    notify();
  } });
}

export async function reopenReport(id) {
  const job = getJob(id); const rep = state.reports.find((r) => r.id === id);
  if (!job?.result || !rep) { toast('原图数据已不存在，无法重新打开该报告。'); return; }
  state.reports = state.reports.filter((r) => r.id !== id);
  await db.del('reports', id);
  job.status = 'review'; await saveJob(job);
  openJob(id);
}

// ---------- danh mục ----------
const patchCatalog = (c) => { state.catalog = c; persistMeta(); notify(); };
export const catalogOps = {
  setLabel: (id, v) => patchCatalog(setLabel(state.catalog, id, v)),
  renameSource: (id, v) => patchCatalog(renameSource(state.catalog, id, v)),
  hide: (id, h) => patchCatalog(setHidden(state.catalog, id, h)),
  move: (id, d) => patchCatalog(moveItem(state.catalog, id, d)),
  add: (name, label) => patchCatalog(addItem(state.catalog, { name, label }).catalog),
  async merge(fromId, toId) {
    const { catalog, map } = mergeItems(state.catalog, fromId, toId);
    state.catalog = catalog; persistMeta();
    for (const rep of state.reports) {
      if (!rep.rows.some((r) => map[r.itemId])) continue;
      const by = new Map();
      for (const r of rep.rows) { const id = map[r.itemId] || r.itemId; const cur = by.get(id); if (cur) { cur.occ += r.occ; cur.proc += r.proc; } else by.set(id, { ...r, itemId: id }); }
      rep.rows = [...by.values()]; await db.put('reports', rep);
    }
    for (const j of state.jobs) if (j.result) for (const r of j.result.rows) if (map[r.itemId]) r.itemId = map[r.itemId];
    toast('已合并问题类型，历史记录已同步更新。'); notify();
  },
  async remove(id) {
    state.catalog = removeItem(state.catalog, id); persistMeta();
    for (const rep of state.reports) { rep.rows = rep.rows.filter((r) => r.itemId !== id); await db.put('reports', rep); }
    for (const j of state.jobs) if (j.result) for (const r of j.result.rows) if (r.itemId === id) { r.itemId = null; r.nameHow = 'none'; }
    notify();
  },
};

// ---------- cài đặt, sao lưu ----------
export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  if ('concurrency' in patch) queue.setConcurrency(state.settings.concurrency);
  persistMeta(); notify();
}
export const openSettings = (open) => { state.settingsOpen = open; notify(); };

export function buildBackup() {
  const { aiKey, ...settings } = state.settings;
  return JSON.stringify({ app: 'qt-report-aggregator', version: 1, exportedAt: new Date().toISOString(), catalog: state.catalog, learned: state.learned, settings, reports: state.reports });
}

export async function restoreBackup(text) {
  const d = JSON.parse(text);
  if (d.app !== 'qt-report-aggregator' || !Array.isArray(d.reports) || !d.catalog?.items) throw new Error('该文件不是本应用的备份文件。');
  state.catalog = d.catalog; state.learned = d.learned || []; templatesCache = null;
  state.settings = { ...state.settings, ...(d.settings || {}) };
  await db.clear('reports');
  for (const r of d.reports) await db.put('reports', r);
  state.reports = d.reports.sort((a, b) => b.date.localeCompare(a.date));
  persistMeta(); toast(`已恢复 ${d.reports.length} 份报告。`); notify();
}

export async function resetLearning() { state.learned = []; templatesCache = null; state.catalog = { ...state.catalog, items: state.catalog.items.map((i) => ({ ...i, sigs: [] })) }; persistMeta(); toast('已清除学习到的样本（保留内置校准样本）。'); }

export async function wipeAll() {
  for (const s of ['jobs', 'blobs', 'reports', 'meta']) await db.clear(s);
  state.jobs = []; state.reports = []; state.learned = []; templatesCache = null; state.catalog = createCatalog(calibration); state.settings = { ...DEFAULTS };
  state.selectedJob = null; state.batch = { total: 0, finished: 0 }; notify();
}

export const monthAggregate = () => aggregate(state.reports, state.catalog, state.month);
export { itemById, T };
