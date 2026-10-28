// OCR chữ Hán cho TÊN hạng mục mới/lạ (số thì đã đọc bằng so khớp mẫu). Tải Tesseract.js + dữ liệu chi_sim ở lần dùng đầu.
import { grayToCanvas } from './canvas.js';

let workerPromise = null, chain = Promise.resolve(), failed = false;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const w = await createWorker('chi_sim', 1);
      await w.setParameters({ tessedit_pageseg_mode: '7' });
      return w;
    })();
  }
  return workerPromise;
}

export function ocrName(gray) {
  if (failed) return Promise.resolve('');
  const job = async () => {
    try {
      const w = await getWorker();
      const { data } = await w.recognize(grayToCanvas(gray, 3, 12));
      return (data.text || '').trim();
    } catch (e) {
      failed = true; // offline / không tải được dữ liệu: không thử lại liên tục trong phiên này
      console.warn('OCR chữ Hán không khả dụng:', e);
      return '';
    }
  };
  const p = chain.then(job, job); // một worker => xử lý tuần tự, tránh va chạm
  chain = p.then(() => {}, () => {});
  return p;
}
