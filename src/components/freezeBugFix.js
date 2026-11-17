(() => {
  if (window.__rafYieldInstalled) return;
  window.__rafYieldInstalled = true;

  const _raf = window.requestAnimationFrame.bind(window);
  const _caf = window.cancelAnimationFrame.bind(window);
  const HOP_INTERVAL_MS = 8;
  let lastHop = 0;
  let held = false;

  const opts = { capture: true, passive: true };
  window.addEventListener('mousedown', e => { if ((e.buttons & 1) !== 0) held = true; }, opts);
  window.addEventListener('mouseup', e => { if ((e.buttons & 1) === 0) held = false; }, opts);
  window.addEventListener('blur', () => { held = false; });

  const { port1, port2 } = new MessageChannel();
  const jobs = [];
  port1.onmessage = () => { const job = jobs.shift(); if (job) job(); };
  const hop = fn => { jobs.push(fn); port2.postMessage(0); };

  let seq = 0;
  const pending = new Map();

  window.requestAnimationFrame = cb => {
    if (!held) return _raf(cb);
    const now = performance.now();
    if (now - lastHop < HOP_INTERVAL_MS) return _raf(cb);
    lastHop = now;

    const id = -++seq;
    const entry = { raf: 0 };
    pending.set(id, entry);

    hop(() => {
      if (!pending.has(id)) return;
      entry.raf = _raf(timestamp => {
        pending.delete(id);
        cb(timestamp);
      });
    });

    return id;
  };

  window.cancelAnimationFrame = id => {
    if (id >= 0) return _caf(id);
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (entry.raf) _caf(entry.raf);
  };
})();
