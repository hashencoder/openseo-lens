// OpenSEO Lens — local link graph. Records which external sites this page links to,
// so the Backlinks tab can show links you've personally seen. Stored only in this browser.
(async () => {
  if (window.top !== window) return;
  const { linkGraph } = await chrome.storage.sync.get('linkGraph');
  if (linkGraph === false) return;
  const host = location.hostname.replace(/^www\./, '');
  if (/^(localhost|127\.|10\.|192\.168\.)/.test(host) || /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu)\.[a-z.]+$/.test(host)) return;
  if (document.querySelector('input[type="password"]')) return; // skip login/account pages

  const collect = () => {
    const seen = new Set();
    const links = [];
    for (const a of document.querySelectorAll('a[href^="http"]')) {
      let u;
      try { u = new URL(a.href); } catch { continue; }
      const h = u.hostname.replace(/^www\./, '');
      if (h === host || h.endsWith('.' + host) || host.endsWith('.' + h)) continue;
      u.hash = '';
      const href = u.href;
      if (seen.has(href)) continue;
      seen.add(href);
      const rel = (a.getAttribute('rel') || '').toLowerCase().split(/\s+/).filter((r) => /nofollow|sponsored|ugc/.test(r)).join(' ');
      links.push({ href, text: (a.textContent || a.querySelector('img')?.alt || '').replace(/\s+/g, ' ').trim(), rel: rel || 'follow' });
    }
    if (!links.length) return;
    const page = location.origin + location.pathname + location.search;
    chrome.runtime.sendMessage({ type: 'recordLinks', page, title: document.title, links }).catch(() => {});
  };
  setTimeout(collect, 2500); // after most client-side rendering has settled
})();
