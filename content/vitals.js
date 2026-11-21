// OpenSEO Lens — Core Web Vitals collector (runs at document_start in the extension's isolated world).
(() => {
  if (globalThis.__openseoVitals) return;
  const v = (globalThis.__openseoVitals = { lcp: null, lcpEl: null, cls: 0, inp: null, fcp: null, ttfb: null, longTasks: 0, tbt: 0 });

  const observe = (type, cb, extra = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(cb)).observe({ type, buffered: true, ...extra });
    } catch { /* unsupported entry type */ }
  };

  observe('largest-contentful-paint', (e) => {
    v.lcp = Math.round(e.renderTime || e.loadTime || e.startTime);
    const el = e.element;
    v.lcpEl = el ? (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (e.url ? ' ' + e.url : '')).slice(0, 200) : e.url || null;
  });

  // CLS with session windows (max 5s, 1s gap) as defined by web.dev
  let sessionValue = 0, sessionEntries = [];
  observe('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    const first = sessionEntries[0], last = sessionEntries[sessionEntries.length - 1];
    if (sessionValue && e.startTime - last.startTime < 1000 && e.startTime - first.startTime < 5000) {
      sessionValue += e.value; sessionEntries.push(e);
    } else {
      sessionValue = e.value; sessionEntries = [e];
    }
    v.cls = Math.max(v.cls, sessionValue);
  });

  // INP approximation: worst interaction duration (good enough for a toolbar readout)
  const interactions = new Map();
  observe('event', (e) => {
    if (!e.interactionId) return;
    const d = Math.max(interactions.get(e.interactionId) || 0, e.duration);
    interactions.set(e.interactionId, d);
    const all = [...interactions.values()].sort((a, b) => b - a);
    // p98-ish: ignore 1 outlier per 50 interactions
    v.inp = Math.round(all[Math.min(all.length - 1, Math.floor(all.length / 50))]);
  }, { durationThreshold: 16 });

  observe('paint', (e) => { if (e.name === 'first-contentful-paint') v.fcp = Math.round(e.startTime); });

  observe('longtask', (e) => { v.longTasks++; v.tbt += Math.max(0, e.duration - 50); });

  observe('navigation', (e) => { v.ttfb = Math.round(e.responseStart); });
})();
