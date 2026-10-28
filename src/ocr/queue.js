// Hàng đợi xử lý nhiều ảnh: giới hạn song song, tạm dừng/tiếp tục, lỗi của một ảnh không làm hỏng cả lô.
export function createQueue({ run, concurrency: initial = 2, onEvent = () => {} }) {
  let concurrency = initial;
  const pending = [];
  const active = new Set();
  let paused = false;
  let idleWaiters = [];

  const settleIdle = () => { if (!pending.length && !active.size) { idleWaiters.forEach((f) => f()); idleWaiters = []; } };

  function pump() {
    while (!paused && active.size < concurrency && pending.length) {
      const id = pending.shift();
      active.add(id);
      onEvent({ type: 'start', id });
      Promise.resolve()
        .then(() => run(id))
        .then(() => onEvent({ type: 'done', id }), (error) => onEvent({ type: 'error', id, error }))
        .finally(() => { active.delete(id); pump(); settleIdle(); });
    }
  }

  return {
    add(ids) { for (const id of ids) if (!pending.includes(id) && !active.has(id)) pending.push(id); pump(); },
    remove(id) { const i = pending.indexOf(id); if (i >= 0) pending.splice(i, 1); },
    setConcurrency(n) { concurrency = Math.max(1, n | 0); pump(); },
    pause() { paused = true; },
    resume() { paused = false; pump(); },
    clearPending() { pending.length = 0; settleIdle(); },
    get paused() { return paused; },
    stats: () => ({ pending: pending.length, active: active.size }),
    whenIdle: () => (!pending.length && !active.size ? Promise.resolve() : new Promise((r) => idleWaiters.push(r))),
  };
}

// Giới hạn số lời gọi đồng thời (ví dụ gọi AI vision) để không bị khóa/tốn phí đột biến.
export function createLimiter(max) {
  let running = 0;
  const waiting = [];
  const next = () => { if (running < max && waiting.length) { running++; waiting.shift()(); } };
  return async function limit(fn) {
    await new Promise((res) => { waiting.push(res); next(); });
    try { return await fn(); } finally { running--; next(); }
  };
}
