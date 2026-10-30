import { useEffect, useState } from 'preact/hooks';
import * as db from './db.js';
import { T, errorText } from './text.js';
import seeds from '../core/seeds.json';
import calibration from '../core/calibration.json';
import { orderedItems, createCatalog, addItem, addAlias, addSignature, addTotalSignature, matchBySignature, setLabel, renameSource, setHidden, removeItem, moveItem, mergeItems, itemById } from '../core/catalog.js';
import { learnDigits, mergeTemplates } from '../core/learn.js';
import { aggregate, localDate, monthOf } from '../core/aggregate.js';
import { analyzeImage, revalidate } from '../ocr/pipeline.js';
import { createQueue } from '../ocr/queue.js';
import { decodeFile, makeThumb, sha256 } from '../ocr/canvas.js';
import { ocrName } from '../ocr/tess.js';
import { buildItems } from '../ocr/vision.js';
import { planAi, applyAiItems } from '../core/aiPlan.js';
import { callVision, checkAi, GATE_CODES } from '../ocr/aiClient.js';
import { revertSuggestions } from '../core/suggest.js';
import { autoFix } from '../core/solver.js';
import { validate } from '../core/validate.js';
import { cloud } from '../cloud/supabase.js';
import { createSync, createRemote } from '../cloud/sync.js';
import { prevMonthOf, compareMonths } from '../core/aggregate.js';
import { findAnomalies, describeAnomaly } from '../core/anomaly.js';
import { coverage, sameDateReports } from '../core/coverage.js';
import { cleanReport } from '../core/sanitize.js';

export const DEFAULTS = {
  autoApprove: true, requireProcessedLE: true, minConfidence: 0.45, concurrency: 2,
  ocrChinese: true, aiEnabled: true, aiEndpoint: '/api/vision', skipWeekends: false,
};

export const state = {
  ready: false, initError: null, persistent: true, tab: 'import', month: monthOf(localDate()), batchDate: localDate(),
  catalog: null, learned: [], settings: { ...DEFAULTS }, jobs: [], reports: [],
  paused: false, batch: { total: 0, finished: 0 }, selectedJob: null, toast: null, settingsOpen: false,
  // Trạng thái AI toàn cục: status = idle | ok | error; blocking = lỗi cần người dùng/cấu hình sửa (không gọi lại vô ích); busy = id các ảnh đang được AI đọc.
  ai: { status: 'idle', code: null, message: '', missing: [], blocking: false, gateUntil: 0, fails: 0, checking: false, busy: [], model: '', usage: null, detail: '', log: [], probe: null, stats: { asked: 0, fixed: 0, solved: 0, unchanged: 0, calls: 0 } },
  // Đăng nhập & đồng bộ đám mây (Supabase). off = chưa cấu hình → ứng dụng chỉ lưu trên máy như trước.
  auth: { status: cloud.configured ? 'loading' : 'off', email: null, error: null },
  sync: { status: 'off', pending: 0, lastAt: 0, error: null },
};

// ---------- phát sự kiện cập nhật giao diện (gộp theo khung hình để 100 ảnh không làm giật) ----------
const listeners = new Set();
let pending = false;
export function notify() {
  if (pending) return;
  pending = true;
  const run = () => { if (!pending) return; pending = false; listeners.forEach((l) => l()); };
  requestAnimationFrame(run);
  setTimeout(run, 120); // tab chạy nền bị tạm dừng requestAnimationFrame: vẫn cập nhật bằng bộ đếm giờ
}
export function useStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    // Component đăng ký SAU khi init() có thể đã xong (Preact chạy effect sau khi vẽ): vẽ lại một lần để bắt kịp,
    // nếu không giao diện sẽ kẹt mãi ở màn hình "正在打开数据…".
    l();
    return () => listeners.delete(l);
  }, []);
  return state;
}

const uid = () => `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const getJob = (id) => state.jobs.find((j) => j.id === id);
const valSettings = () => ({ minConfidence: state.settings.minConfidence, requireProcessedLE: state.settings.requireProcessedLE });
let templatesCache = null;
const templates = () => (templatesCache ||= mergeTemplates(seeds, calibration.digits, state.learned));

let metaTimer = 0;
function persistMeta(fromSync = false) {
  clearTimeout(metaTimer);
  metaTimer = setTimeout(async () => { await db.put('meta', { key: 'app', catalog: state.catalog, learned: state.learned, settings: state.settings }); if (!fromSync) touchSync(); }, 250);
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
    if (result.validation.status !== 'ok') result = suggestPass(result);   // bộ giải cục bộ, tức thời
    job.aiPending = aiOn() && needsAi(result);                              // AI chạy nền sau, KHÔNG chặn các ảnh tiếp theo
    job.result = result; job.error = null;
    if (result.validation.status === 'ok' && state.settings.autoApprove) await approveJob(id, { auto: true });
    else { job.status = 'review'; if (job.aiPending) scheduleSweep(); }
  } catch (e) {
    job.status = 'error'; job.error = errorText(e);
  }
  await saveJob(job);
  await new Promise((r) => setTimeout(r, 0)); // nhường luồng giao diện giữa các ảnh
  notify();
}

// ---------- AI dự phòng: bộ điều phối nền, TÁCH RỜI khỏi hàng đợi đọc ảnh ----------
// Nguyên tắc: (1) đọc ảnh cục bộ không bao giờ chờ AI; (2) mỗi lượt gọi gom nhiều ô của nhiều ảnh; (3) có "cổng": khi Google báo hết hạn mức
// thì NGỪNG gọi cho đến đúng lúc được phép (không thử lại vô ích); (4) cách nhau ~6 giây cho gói miễn phí; (5) kết quả luôn được kiểm tra lại bằng tổng.
export async function aiHeaders(force = false) {
  if (cloud.configured) { const t = await cloud.getToken({ force }); return t ? { authorization: `Bearer ${t}` } : null; }
  return null;
}
const setUsage = (u) => { if (u) state.ai = { ...state.ai, usage: u }; };
const aiOn = () => !!(state.settings.aiEnabled && state.settings.aiEndpoint);
const PACE_MS = 6500, MAX_BATCH_ITEMS = 24, MAX_BATCH_JOBS = 4, GIVE_UP_AFTER = 3, DAY_PROBE_MS = 30 * 60_000;
const BACKOFF = [8, 20, 45, 90]; // giây, cho lỗi tạm thời của máy chủ/mạng
const revalidateResult = (res) => validate(res.rows.filter((r) => !r.skip), res.total, valSettings());

// Sửa bằng bộ giải cục bộ (tổng + chữ số thay thế gần nhất). Kết quả luôn được đánh dấu và KHÔNG tự duyệt.
function suggestPass(result) {
  const { result: r, applied } = autoFix(result, { minConfidence: 0.75 });
  return applied ? { ...r, validation: revalidateResult(r) } : r;
}
// Còn cần hỏi AI không? Không hỏi khi bộ giải cục bộ đã làm tổng khớp (chỉ còn cảnh báo "suggested"): tiết kiệm hạn mức.
const needsAi = (res) => res.validation.status !== 'ok' && res.validation.issues.some((i) => i.code !== 'suggested');

const markBusy = (ids, on) => { const set = new Set(state.ai.busy); for (const id of [].concat(ids)) on ? set.add(id) : set.delete(id); state.ai = { ...state.ai, busy: [...set] }; notify(); };
const pendingAiJobs = () => state.jobs.filter((j) => j.aiPending && j.status === 'review' && j.result && !(j.aiSkipUntil > Date.now()));
const gateActive = () => (state.ai.gateUntil || 0) > Date.now();

// Đặt "cổng" theo mã lỗi: lỗi hạn mức → chờ đúng thời gian; lỗi cấu hình/đăng nhập → chặn đến khi người dùng sửa; lỗi tạm thời → lùi dần.
function applyGate(e) {
  const code = e.code || 'upstream';
  if (e.usage) setUsage(e.usage);
  let gateUntil = 0, blocking = false;
  const fails = state.ai.fails + 1;
  if (code === 'quota_minute' || code === 'rate_limited') gateUntil = Date.now() + Math.max(8, Math.min(120, e.retryAfter || 45)) * 1000;
  else if (code === 'quota_day' || code === 'daily_limit') gateUntil = Date.now() + DAY_PROBE_MS;
  else if (['not_configured', 'unauthorized', 'forbidden', 'gemini_key', 'bad_model', 'no_key', 'unreachable'].includes(code)) blocking = true;
  else gateUntil = Date.now() + BACKOFF[Math.min(fails - 1, BACKOFF.length - 1)] * 1000;
  state.ai = { ...state.ai, status: 'error', code, message: e.message || String(e), missing: e.missing || [], blocking, gateUntil, fails, detail: e.detail || '' };
  state.ai.log = [{ at: Date.now(), code, message: state.ai.message }, ...(state.ai.log || [])].slice(0, 8);
}
const aiOk = () => { state.ai = { ...state.ai, status: 'ok', code: null, message: '', missing: [], blocking: false, gateUntil: 0, fails: 0, detail: '' }; };
const bumpStats = (d) => { const s = state.ai.stats; state.ai = { ...state.ai, stats: { asked: s.asked + (d.asked || 0), fixed: s.fixed + (d.fixed || 0), solved: s.solved + (d.solved || 0), unchanged: s.unchanged + (d.unchanged || 0), calls: s.calls + (d.calls || 0) } }; };

let sweepTimer = 0, sweeping = false;
export function scheduleSweep(delayMs = 2500) {
  clearTimeout(sweepTimer);
  if (!aiOn() || state.ai.blocking || !pendingAiJobs().length) return;
  const wait = Math.max(delayMs, state.ai.gateUntil ? state.ai.gateUntil - Date.now() + 500 : 0);
  sweepTimer = setTimeout(() => sweepAi(), wait);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function sweepAi({ ids, manual = false } = {}) {
  if (!aiOn() || sweeping) return;
  sweeping = true; state.ai = { ...state.ai, checking: true }; notify();
  let fixedTotal = 0, rounds = 0;
  try {
    for (;;) {
      if (!aiOn() || state.ai.blocking || gateActive()) break;
      const todo = pendingAiJobs().filter((j) => !ids || ids.includes(j.id));
      if (!todo.length) break;
      // Kiểm tra sẵn sàng (GET rẻ: xác thực, cấu hình, số lần dùng hôm nay). Sau khi hết hạn mức ngày, thử "probe" nhỏ trước khi chạy lại.
      const h = await checkAi({ endpoint: state.settings.aiEndpoint, getHeaders: aiHeaders, probe: ['quota_day', 'daily_limit'].includes(state.ai.code) });
      if (!h.ready) { applyGate(h); if (manual) toast(`AI 暂时无法使用：${h.message}`); break; }
      state.ai = { ...state.ai, model: h.model || state.ai.model, usage: h.usage || state.ai.usage };
      aiOk();
      // Gom ô không chắc của nhiều ảnh vào một lượt gọi.
      const entries = []; let count = 0;
      for (const job of todo) {
        if (entries.length >= MAX_BATCH_JOBS || count >= MAX_BATCH_ITEMS) break;
        try {
          const rec = await db.get('blobs', job.id);
          if (!rec?.blob) throw new Error('missing');
          const img = await decodeFile(rec.blob);
          const base = revertSuggestions(job.result);
          const valid = { ...base, validation: revalidateResult(base) };
          let plan = planAi(valid);
          if (count + plan.length > MAX_BATCH_ITEMS && entries.length) break;
          const items = buildItems(img, valid, plan);
          plan = plan.filter((_, i) => items[i]);
          const real = items.filter(Boolean);
          if (!plan.length) { finishJob(job, suggestPass(valid.validation.status === 'ok' ? valid : { ...valid, aiUsed: true, aiError: null }), { asked: 0 }); continue; }
          entries.push({ job, plan, items: real, offset: count }); count += plan.length;
        } catch { job.aiPending = false; job.result = { ...job.result, aiError: '找不到已保存的图片' }; saveJobLater(job); }
      }
      if (!entries.length) { notify(); continue; }
      const jobIds = entries.map((e) => e.job.id);
      markBusy(jobIds, true);
      let data;
      try {
        const body = { items: entries.flatMap((e) => e.items.map((it, k) => ({ id: String(e.offset + k), kind: it.kind, image: it.image, candidates: it.candidates }))) };
        data = await callVision({ endpoint: state.settings.aiEndpoint, getHeaders: aiHeaders, body });
        if (data.usage) setUsage(data.usage);
        if (data.model) state.ai = { ...state.ai, model: data.model };
        aiOk(); bumpStats({ calls: 1, asked: body.items.length });
      } catch (e) {
        applyGate(e);
        for (const en of entries) { en.job.aiTries = (en.job.aiTries || 0) + 1; if (en.job.aiTries >= GIVE_UP_AFTER && !GATE_CODES.has(e.code)) { en.job.aiSkipUntil = Date.now() + 10 * 60_000; en.job.aiTries = 0; en.job.result = { ...en.job.result, aiError: e.message || String(e) }; saveJobLater(en.job); } }
        if (manual) toast(`AI 识别失败：${e.message || e}`);
        break;
      } finally { markBusy(jobIds, false); }
      for (const en of entries) {
        const cur = getJob(en.job.id);
        if (!cur || cur.status !== 'review' || !cur.result) continue;
        const answers = data.items.filter((a) => Number(a.id) >= en.offset && Number(a.id) < en.offset + en.plan.length).map((a) => ({ ...a, id: String(Number(a.id) - en.offset) }));
        let res = revertSuggestions(cur.result);
        res = { ...res, validation: revalidateResult(res) };
        const out = applyAiItems(res, en.plan, answers, { catalog: state.catalog, settings: valSettings() });
        const solved = out.result.validation.status === 'ok';
        fixedTotal += out.changed;
        bumpStats({ fixed: out.changed, solved: solved ? 1 : 0, unchanged: out.changed ? 0 : 1 });
        await finishJob(cur, solved ? out.result : suggestPass(out.result), { changed: out.changed });
      }
      rounds++;
      if (pendingAiJobs().some((j) => !ids || ids.includes(j.id))) await sleep(PACE_MS);   // nhịp cho gói miễn phí (~10 lượt/phút)
    }
    if (fixedTotal) toast(`AI 已修正 ${fixedTotal} 处数字（已用蓝色标出，可撤销）。`);
    else if (manual && rounds && !state.ai.busy.length && state.ai.status === 'ok') toast('AI 已重新识别，没有需要修改的数字。');
  } finally {
    sweeping = false; state.ai = { ...state.ai, checking: false }; notify(); scheduleSweep();
  }
}

async function finishJob(job, result, { changed = 0 } = {}) {
  job.result = { ...result, aiUsed: true, aiError: null };
  job.aiPending = false; job.aiTries = 0;
  await saveJob(job);
  if (job.result.validation.status === 'ok' && state.settings.autoApprove) await approveJob(job.id, { auto: true });
  notify();
}

export function runAiNow(id) {
  const j = getJob(id); if (!j) return;
  if (!aiOn()) { toast('请先在 设置 → 识别与 AI 中开启 AI。'); return; }
  j.aiPending = true; j.aiSkipUntil = 0; j.aiTries = 0;
  askNow([id]);
}
export function rescanAll() {
  const jobs = state.jobs.filter((j) => j.status === 'review' && j.result && j.result.validation.status !== 'ok');
  if (!jobs.length) { toast('没有需要 AI 重新识别的图片。'); return; }
  jobs.forEach((j) => { j.aiPending = true; j.aiSkipUntil = 0; j.aiTries = 0; });
  askNow(jobs.map((j) => j.id));
}
// 手动触发：尊重“冷却时间”（Google 要求等待时不强行请求，免得更久被拒），其余情况立即开始。
function askNow(ids) {
  if (state.ai.blocking) state.ai = { ...state.ai, blocking: false };
  if (gateActive()) { toast(`AI 正在冷却，约 ${Math.ceil((state.ai.gateUntil - Date.now()) / 1000)} 秒后自动继续。`); scheduleSweep(0); notify(); return; }
  sweepAi({ ids, manual: true });
}
export function retryAiNow() { state.ai = { ...state.ai, blocking: false, gateUntil: Math.min(state.ai.gateUntil || 0, Date.now() + 1) }; sweepAi({ manual: true }); }

// 诊断：向 Gemini 发一个极小的请求，原样显示额度状态（每分钟/每天、需要等待多久）。
export async function testAi() {
  state.ai = { ...state.ai, checking: true }; notify();
  const h = await checkAi({ endpoint: state.settings.aiEndpoint, getHeaders: aiHeaders, probe: true });
  if (h.ready) { aiOk(); state.ai = { ...state.ai, model: h.model || state.ai.model, usage: h.usage || state.ai.usage }; } else applyGate(h);
  state.ai = { ...state.ai, checking: false, probe: { at: Date.now(), ok: !!h.ready, code: h.code || null, message: h.message || '', model: h.model || '', retryAfter: h.retryAfter || 0, tried: h.probe?.tried || [], primaryFailed: !!h.probe?.primaryFailed } }; notify();
  if (h.ready) scheduleSweep(300);
  return h;
}
function onAiSettingsChanged() {
  state.ai = { ...state.ai, status: 'idle', code: null, message: '', blocking: false, gateUntil: 0, fails: 0 };
  if (aiOn()) markUnaskedForAi();
  scheduleSweep(400);
}
// Ảnh đang chờ xem lại mà AI chưa từng được hỏi (ví dụ trước đây AI đang tắt) cũng được đưa vào hàng đợi.
function markUnaskedForAi() { for (const j of state.jobs) if (j.status === 'review' && j.result && needsAi(j.result) && !j.result.aiUsed) j.aiPending = true; }

export function undoAiCell(jobId, rowIx, key) {
  const job = getJob(jobId); const row = job?.result.rows.find((r) => r.rowIx === rowIx); const c = row?.[key];
  if (!c?.was) return;
  row[key] = { ...c, ...c.was, source: undefined, suggested: undefined, was: undefined, edited: false };
  revalidateJob(job); saveJobLater(job); notify();
}

// ---------- khởi tạo ----------
export async function init() {
  try { await initInner(); }
  catch (e) {
    // Không để người dùng kẹt ở màn hình chờ: dùng dữ liệu mặc định và hiện nút xóa dữ liệu cục bộ.
    console.error('Khởi tạo thất bại:', e);
    state.initError = String(e?.message || e);
    state.catalog ||= createCatalog(calibration);
    state.persistent = false;
    state.ready = true; notify();
  }
}

async function initInner() {
  state.persistent = await db.init();
  const meta = await db.get('meta', 'app');
  state.catalog = meta?.catalog || createCatalog(calibration);
  // Bản cũ đặt nhãn mặc định bằng tiếng Việt: chuyển về tên gốc (tiếng Trung) để giao diện thống nhất.
  state.catalog = { ...state.catalog, items: state.catalog.items.map((it) => (/^d\d+$/.test(it.id) && /[\u00c0-\u1ef9]/.test(it.label) ? { ...it, label: it.name } : it)) };
  state.learned = meta?.learned || [];
  state.settings = { ...DEFAULTS, ...(meta?.settings || {}) };
  if (meta?.settings && meta.settings.aiEnabled === false && !meta.settings.aiKey) state.settings.aiEnabled = true; // AI từng chưa được cấu hình: bật mặc định, hiện lỗi cụ thể nếu thiếu cấu hình
  queue.setConcurrency(state.settings.concurrency);
  state.reports = (await db.all('reports')).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  state.jobs = (await db.all('jobs')).sort((a, b) => a.createdAt - b.createdAt);
  const resume = [];
  for (const j of state.jobs) if (j.status === 'working' || j.status === 'queued') { j.status = 'queued'; resume.push(j.id); }
  state.batch = { total: resume.length, finished: 0 };
  state.ready = true; notify();
  queue.add(resume);
  await initAuth();
  consumeSharedFiles();
  if (aiOn()) { markUnaskedForAi(); scheduleSweep(1500); }
  window.addEventListener('online', () => { scheduleSweep(500); touchSync(500); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { scheduleSweep(500); touchSync(800); } });
  setInterval(() => { if (document.visibilityState === 'visible') touchSync(0); }, 45_000); // lấy thay đổi của đồng đội
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
  row[key] = { ...row[key], value, text: t, confidence: value == null ? 0 : 1, edited: true, source: undefined, suggested: undefined, was: undefined };
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

// 备注标记：校验问题代码 + 校正来源（ai / solver / edited），用于历史页显示“已校正”。
function noteTokens(res) {
  const t = res.validation.status === 'ok' ? [] : res.validation.issues.map((i) => i.code);
  const cells = res.rows.filter((r) => !r.skip).flatMap((r) => [r.occ, r.proc]);
  if (cells.some((c) => c.source === 'ai')) t.push('ai');
  if (cells.some((c) => c.source === 'solver' || c.source === 'total')) t.push('solver');
  if (cells.some((c) => c.edited)) t.push('edited');
  return [...new Set(t)].join(',');
}
// 一键确认：总计已核对一致（或只剩“推算”提示）且每行都已选好问题类型的图片。
export const matchedJobs = () => state.jobs.filter((j) => j.status === 'review' && j.result && jobReady(j) && (j.result.validation.status === 'ok' || j.result.validation.issues.every((i) => i.code === 'suggested')));
export async function approveAllMatched() {
  const list = matchedJobs(); let n = 0;
  for (const j of list) if (await approveJob(j.id, { auto: false })) n++;
  toast(n ? `已确认 ${n} 张总计一致的图片。` : '没有可一键确认的图片。'); notify();
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
    status: auto ? 'auto' : 'manual', note: noteTokens(res),
  };
  state.reports = [rep, ...state.reports.filter((r) => r.id !== id)];
  await db.put('reports', rep);
  qUp(id);
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
  await db.del('reports', id); qDel(id);
  const job = getJob(id); if (job) { job.status = 'removed'; await saveJob(job); }
  toast('已从月度汇总中删除该报告。', { label: '撤销', run: async () => {
    state.reports = [rep, ...state.reports]; await db.put('reports', rep); qUp(id);
    if (job) { job.status = 'done'; await saveJob(job); }
    notify();
  } });
}

export async function reopenReport(id) {
  const job = getJob(id); const rep = state.reports.find((r) => r.id === id);
  if (!job?.result || !rep) { toast('原图数据已不存在，无法重新打开该报告。'); return; }
  state.reports = state.reports.filter((r) => r.id !== id);
  await db.del('reports', id); qDel(id);
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
      rep.rows = [...by.values()]; await db.put('reports', rep); qUp(rep.id);
    }
    for (const j of state.jobs) if (j.result) for (const r of j.result.rows) if (map[r.itemId]) r.itemId = map[r.itemId];
    toast('已合并问题类型，历史记录已同步更新。'); notify();
  },
  async remove(id) {
    state.catalog = removeItem(state.catalog, id); persistMeta();
    for (const rep of state.reports) { if (!rep.rows.some((r) => r.itemId === id)) continue; rep.rows = rep.rows.filter((r) => r.itemId !== id); await db.put('reports', rep); qUp(rep.id); }
    for (const j of state.jobs) if (j.result) for (const r of j.result.rows) if (r.itemId === id) { r.itemId = null; r.nameHow = 'none'; }
    notify();
  },
};

// ---------- cài đặt, sao lưu ----------
export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  if ('concurrency' in patch) queue.setConcurrency(state.settings.concurrency);
  persistMeta(); notify();
  if ('aiKey' in patch || 'aiEndpoint' in patch || 'aiEnabled' in patch) onAiSettingsChanged();
}
export const openSettings = (open) => { state.settingsOpen = open; notify(); };

export function buildBackup() {
  const { aiKey, ...settings } = state.settings;
  return JSON.stringify({ app: 'qt-report-aggregator', version: 1, exportedAt: new Date().toISOString(), catalog: state.catalog, learned: state.learned, settings, reports: state.reports });
}

export async function restoreBackup(text) {
  if (String(text).length > 20_000_000) throw new Error('备份文件过大。');
  const d = JSON.parse(text);
  if (d.app !== 'qt-report-aggregator' || !Array.isArray(d.reports) || !d.catalog?.items) throw new Error('该文件不是本应用的备份文件。');
  const reports = d.reports.map(cleanReport).filter(Boolean);
  if (!reports.length && d.reports.length) throw new Error('备份文件中的报告格式无效。');
  state.catalog = d.catalog; state.learned = Array.isArray(d.learned) ? d.learned : []; templatesCache = null;
  const { aiEndpoint, ...safeSettings } = d.settings || {};   // 备份不得改变 AI 服务地址
  state.settings = { ...state.settings, ...safeSettings };
  await db.clear('reports');
  for (const r of reports) await db.put('reports', r);
  state.reports = reports.sort((a, b) => b.date.localeCompare(a.date));
  for (const r of reports) qUp(r.id);   // khôi phục chỉ thêm/ghi đè lên cloud, không xóa báo cáo của đồng đội
  persistMeta(); toast(`已恢复 ${reports.length} 份报告。`); notify();
}

export async function resetLearning() { state.learned = []; templatesCache = null; state.catalog = { ...state.catalog, items: state.catalog.items.map((i) => ({ ...i, sigs: [] })) }; persistMeta(); toast('已清除学习到的样本（保留内置校准样本）。'); }

export async function wipeAll() {
  for (const s of ['jobs', 'blobs', 'reports', 'meta']) await db.clear(s);
  state.jobs = []; state.reports = []; state.learned = []; templatesCache = null; state.catalog = createCatalog(calibration); state.settings = { ...DEFAULTS };
  state.selectedJob = null; state.batch = { total: 0, finished: 0 };
  resetSync(); notify();
  if (state.auth.status === 'signedin') toast('已清除本机数据。云端数据还在，正在重新同步…');
  touchSync(300);
}

export const monthAggregate = () => aggregate(state.reports, state.catalog, state.month);
export { itemById, T };

// ---------- đăng nhập một lần (Supabase) ----------
function setAuthUser(u) {
  const was = state.auth.status;
  state.auth = u ? { status: 'signedin', email: u.email || state.auth.email, error: null } : { status: cloud.configured ? 'signedout' : 'off', email: null, error: state.auth.error };
  notify();
  if (u && was !== 'signedin') { sync ||= makeSync(); state.sync = { ...state.sync, status: 'idle' }; touchSync(200); scheduleSweep(1000); }
  if (!u) state.sync = { status: 'off', pending: 0, lastAt: 0, error: null };
}

async function initAuth() {
  if (!cloud.configured) return;
  cloud.onChange((u) => setAuthUser(u));
  if (cloud.user()) {
    // làm mới nếu sắp hết hạn; mất mạng/treo mạng thì vẫn giữ phiên để dùng offline (không để màn hình chờ kẹt)
    await Promise.race([cloud.getToken().catch(() => null), new Promise((r) => setTimeout(r, 6000))]);
  }
  setAuthUser(cloud.user());
}

export async function signIn(account, password) { await cloud.signIn(account, password); }
export async function signOutCloud() { await cloud.signOut(); toast('已退出登录。本机数据仍保留。'); }

// ---------- đồng bộ ----------
let sync = null, syncTimer = 0, syncRetry = 0;
let pristineCatalog = null;
const byDateDesc = (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt;
const syncLocal = {
  getReports: () => state.reports,
  upsertReport(rep) { state.reports = [rep, ...state.reports.filter((r) => r.id !== rep.id)].sort(byDateDesc); db.put('reports', rep); },
  removeReport(id) { state.reports = state.reports.filter((r) => r.id !== id); db.del('reports', id); },
  getMeta: (k) => (k === 'catalog' ? state.catalog : state.learned),
  setMeta(k, v) { if (k === 'catalog') state.catalog = v; else { state.learned = v; templatesCache = null; } persistMeta(true); },
  isPristine(k) { pristineCatalog ||= JSON.stringify(createCatalog(calibration)); return k === 'catalog' ? JSON.stringify(state.catalog) === pristineCatalog : !state.learned.length; },
};
function makeSync() {
  return createSync({ remote: createRemote(cloud), local: syncLocal, load: async () => (await db.get('meta', 'sync'))?.state, save: (st) => db.put('meta', { key: 'sync', state: st }) });
}
const getSync = () => (sync ||= makeSync());
const resetSync = () => { sync = null; };
const qUp = (id) => { getSync().enqueueUpsert(id).then(() => touchSync()).catch(() => {}); };
const qDel = (id) => { getSync().enqueueDelete(id).then(() => touchSync()).catch(() => {}); };
const setSync = (patch) => { state.sync = { ...state.sync, ...patch }; notify(); };

export function touchSync(delay = 1500) {
  if (state.auth.status !== 'signedin') return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync(), delay);
}

export async function runSync({ manual = false } = {}) {
  if (state.auth.status !== 'signedin') return;
  const s = getSync();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { setSync({ status: 'offline', pending: await s.pending() }); return; }
  setSync({ status: 'syncing', error: null });
  try {
    const r = await s.run();
    const info = await s.info();
    syncRetry = 0;
    setSync({ status: 'idle', pending: info.pending, lastAt: info.lastAt, error: null });
    if (r.pulled) await rematchPending();
    if (manual) toast(r.pulled ? `已同步，收到 ${r.pulled} 项更新。` : '已是最新。');
    if (info.pending) touchSync(3000);     // 同步期间又有新的修改
  } catch (e) {
    const offline = e.code === 'network' || (typeof navigator !== 'undefined' && navigator.onLine === false);
    setSync({ status: offline ? 'offline' : 'error', error: e.message || String(e), pending: await s.pending().catch(() => 0) });
    if (e.code !== 'unauthorized') { syncRetry = Math.min(syncRetry + 1, 6); touchSync(Math.min(5 * 60_000, 5000 * 2 ** syncRetry)); }
    if (manual) toast(`同步失败：${e.message || e}`);
  }
}

// ---------- phân tích: bất thường, độ đầy đủ, so sánh tháng ----------
export const monthCompare = () => compareMonths(monthAggregate(), aggregate(state.reports, state.catalog, prevMonthOf(state.month)));
export const monthAnomalies = () => findAnomalies(state.reports, state.catalog, state.month).map((a) => ({ ...a, text: describeAnomaly(a) }));
export const monthCoverage = () => coverage(state.reports, state.month, { today: localDate(), skipWeekends: state.settings.skipWeekends });
export const conflictsForJob = (job) => sameDateReports(state.reports, job.date, job.id);
export const dailyTable = (month = state.month) => {
  const items = orderedItems(state.catalog).filter((it) => state.reports.some((r) => r.month === month && r.rows.some((x) => x.itemId === it.id && (x.occ || x.proc))));
  const values = new Map();
  for (const r of state.reports) if (r.month === month) { const m = values.get(r.date) || new Map(); for (const x of r.rows) m.set(x.itemId, (m.get(x.itemId) || 0) + x.occ); values.set(r.date, m); }
  return { dates: [...values.keys()].sort(), items: items.map((i) => ({ id: i.id, label: i.label })), values };
};

// ---------- nhận ảnh chia sẻ từ hệ điều hành (PWA share target, Android) ----------
async function consumeSharedFiles() {
  try {
    if (typeof caches === 'undefined' || !/[?&]shared=/.test(location.search)) return;
    const c = await caches.open('qt-share');
    const files = [];
    for (const req of await c.keys()) { const r = await c.match(req); if (r) files.push(new File([await r.blob()], decodeURIComponent(req.url.split('/').pop() || 'shared.png'), { type: r.headers.get('content-type') || 'image/png' })); await c.delete(req); }
    history.replaceState(null, '', location.pathname);
    if (files.length) { state.tab = 'import'; await addFiles(files); toast(`已收到 ${files.length} 张分享的图片，正在识别。`); }
  } catch (e) { console.warn('接收分享图片失败', e); }
}
