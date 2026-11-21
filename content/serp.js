// OpenSEO Lens — SERP overlay for Google, Bing and DuckDuckGo.
// Adds a compact metrics bar under every organic result. Keyless: uses Tranco rank (cached 7 days).
(async () => {
  const cfg = await chrome.storage.sync.get(['serpOverlay', 'serpRank', 'serpKd']);
  const probe = (await chrome.runtime.sendMessage({ type: 'isProbe' }).catch(() => null))?.data === true;
  if (cfg.serpOverlay === false && !probe) return;
  const showRank = cfg.serpRank !== false && !probe;

  const engine = location.hostname.includes('bing.') ? 'bing' : location.hostname.includes('duckduckgo.') ? 'ddg' : 'google';
  const SELECTORS = {
    google: () => [...document.querySelectorAll('#search a:has(> h3), #rso a:has(> h3)')].filter((a) => !a.closest('[data-openseo]')),
    bing: () => [...document.querySelectorAll('#b_results > li.b_algo h2 a')],
    ddg: () => [...document.querySelectorAll('a[data-testid="result-title-a"]')]
  };
  const seen = new WeakSet();
  let position = 0;
  const rankCache = {};

  const ENGINE_HOST = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com)$/;

  // Display breadcrumb such as "https://www.example.com › blog › post" → URL (truncated parts dropped).
  function citeUrl(box) {
    const text = box?.querySelector('cite')?.textContent?.trim();
    if (!text) return null;
    const [origin, ...segs] = text.split(/\s*›\s*/);
    const path = segs.filter((s) => s && !/(\.\.\.|…)$/.test(s)).map(encodeURIComponent).join('/');
    try { return new URL((/^https?:\/\//.test(origin) ? origin : 'https://' + origin).replace(/\s.*$/, '') + (path ? '/' + path : '')); } catch { return null; }
  }

  // Engines wrap results in tracking/opaque redirect links (Google /goto, /url; Bing /ck/).
  function realUrl(a, box) {
    let u;
    try { u = new URL(a.href); } catch { return citeUrl(box); }
    if (!ENGINE_HOST.test(u.hostname)) return u;
    for (const p of ['url', 'q', 'u']) {
      const v = u.searchParams.get(p);
      if (v && /^https?:\/\//.test(v)) { try { return new URL(v); } catch {} }
    }
    return citeUrl(box);
  }

  function getTitle(a) {
    return (a.querySelector('h3')?.textContent || a.textContent || '').trim();
  }

  function container(a) {
    if (engine === 'google') return a.closest('div.g, div[data-hveid], div.MjjYud') || a.parentElement;
    if (engine === 'bing') return a.closest('li.b_algo');
    return a.closest('article') || a.closest('li') || a.parentElement;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function process() {
    const anchors = SELECTORS[engine]();
    const pending = [];
    for (const a of anchors) {
      if (seen.has(a)) continue;
      const box = container(a);
      if (!box || box.querySelector('.openseo-bar')) { seen.add(a); continue; }
      seen.add(a);
      const u = realUrl(a, box);
      if (!u || ENGINE_HOST.test(u.hostname)) continue;
      position++;
      const title = getTitle(a);
      const host = u.hostname.replace(/^www\./, '');
      const bar = el('div', 'openseo-bar');
      bar.dataset.openseo = '1';
      bar.append(el('span', 'openseo-pos', '#' + position));
      bar.append(el('span', 'openseo-chip', host));
      const tl = el('span', 'openseo-chip' + (title.length > 60 ? ' warn' : ''), `title ${title.length}`);
      tl.title = 'Visible title length in characters';
      bar.append(tl);
      bar.append(el('span', 'openseo-chip', `path ${u.pathname.split('/').filter(Boolean).length}`));
      if (u.protocol !== 'https:') bar.append(el('span', 'openseo-chip bad', 'http'));
      let rankEl = null;
      if (showRank) {
        rankEl = el('span', 'openseo-chip rank', 'rank …');
        rankEl.title = 'Tranco top-sites rank (lower = more popular)';
        bar.append(rankEl);
        pending.push({ host, rankEl });
      }
      const analyze = el('a', 'openseo-link', 'Wayback');
      analyze.href = 'https://web.archive.org/web/*/' + host;
      analyze.target = '_blank'; analyze.rel = 'noopener';
      bar.append(analyze);
      box.appendChild(bar);
    }
    fillRanks(pending);
  }

  async function fillRanks(items) {
    const want = [...new Set(items.map((i) => i.host))].filter((h) => !(h in rankCache));
    if (want.length) {
      const res = await chrome.runtime.sendMessage({ type: 'trancoMany', domains: want }).catch(() => null);
      if (res?.ok) Object.entries(res.data).forEach(([h, r]) => { rankCache[h] = r; });
    }
    for (const { host, rankEl } of items) {
      const r = rankCache[host];
      if (!r) { rankEl.textContent = 'rank n/a'; continue; }
      rankEl.textContent = r.rank ? 'rank #' + r.rank.toLocaleString() : r.error ? 'rank n/a' : 'unranked';
      rankEl.classList.add(r.rank && r.rank <= 10000 ? 'good' : r.rank && r.rank <= 100000 ? 'mid' : 'low');
    }
  }

  /* ---------------- Keyword difficulty panel (Google only) ---------------- */
  async function keywordPanel() {
    if (engine !== 'google') return;
    const params = new URLSearchParams(location.search);
    const query = params.get('q');
    if (!query || +(params.get('start') || 0) > 0 || params.get('tbm') || params.get('udm')) return;
    const gl = (params.get('gl') || document.documentElement.lang?.split('-')[1] || 'us').toLowerCase();
    const hl = (params.get('hl') || document.documentElement.lang?.split('-')[0] || 'en').toLowerCase();
    const results = [];
    const seenUrl = new Set();
    for (const a of SELECTORS.google()) {
      if (a.closest('#tads, #tadsb, [data-text-ad]')) continue;
      const u = realUrl(a, container(a));
      if (!u || ENGINE_HOST.test(u.hostname) || seenUrl.has(u.href)) continue;
      seenUrl.add(u.href);
      results.push({ url: u.href, title: (a.querySelector('h3')?.textContent || '').trim() });
      if (results.length >= 10) break;
    }
    const headingText = [...document.querySelectorAll('h1, h2, h3, [role="heading"]')].map((h) => h.textContent.trim().toLowerCase());
    const hasHeading = (re) => headingText.some((x) => re.test(x));
    const sponsored = [...document.querySelectorAll('span, div')].filter((e) => e.childElementCount === 0 && /^(sponsored|ad)$/i.test(e.textContent.trim())).length;
    const features = {
      ads: sponsored,
      aiOverview: hasHeading(/^ai overview/),
      peopleAlsoAsk: hasHeading(/^people also ask/),
      topStories: hasHeading(/^top stories|^news/),
      videos: hasHeading(/^videos?$|^short videos/),
      images: hasHeading(/^images/),
      localPack: hasHeading(/^places|^businesses|^map results/),
      shopping: hasHeading(/^popular products|^products|^shop /),
      discussions: hasHeading(/^discussions and forums/)
    };
    if (cfg.serpKd === false && !probe) return;

    const host = document.querySelector('#rcnt') || document.querySelector('#center_col')?.parentElement;
    const panel = document.createElement('div');
    panel.className = 'openseo-kd';
    panel.dataset.openseo = '1';
    panel.innerHTML = '<div class="openseo-kd-head"><b>OpenSEO Lens</b> · reading the top 10…</div>';
    if (!probe && host) host.prepend(panel);

    const [kdRes, demRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'serpDifficulty', query, gl, results, features }).catch(() => null),
      probe ? null : chrome.runtime.sendMessage({ type: 'keywordMetrics', keyword: query, gl, hl }).catch(() => null)
    ]);
    if (probe) return;
    const kd = kdRes?.data, dm = demRes?.data;
    const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    if (!kd || kd.error) { panel.innerHTML = `<div class="openseo-kd-head"><b>OpenSEO Lens</b> · ${esc(kd?.error || 'could not compute difficulty')}</div>`; return; }
    const kdColor = kd.kd >= 70 ? '#e5383b' : kd.kd >= 50 ? '#ff6a13' : kd.kd >= 30 ? '#e8a100' : '#12a150';
    const featureList = Object.entries(kd.features || {}).filter(([k, v]) => k !== 'ads' && v).map(([k]) => k.replace(/([A-Z])/g, ' $1').toLowerCase());
    if (kd.features?.ads) featureList.unshift(kd.features.ads + ' ads');
    panel.innerHTML = `
      <div class="openseo-kd-row">
        <div class="openseo-kd-score" style="border-color:${kdColor}"><span>${kd.kd}</span><small>KD</small></div>
        <div class="openseo-kd-main">
          <div><b style="color:${kdColor}">${esc(kd.label)}</b> keyword difficulty · <span class="openseo-muted">from the authority and relevance of the top ${kd.rows.length}</span></div>
          ${dm && !dm.error ? `<div>Demand <b>${esc(dm.tier)}</b> (${dm.demand}/100, ≈${esc(dm.range)} searches/mo, rough estimate) · intent <b>${esc(dm.intent)}</b>${dm.wiki && dm.wiki.match !== 'loose' ? ` · Wikipedia “${esc(dm.wiki.title)}” ${dm.wiki.avgMonthlyViews.toLocaleString()} views/mo` : ''}</div>` : ''}
          ${featureList.length ? `<div class="openseo-muted">SERP features: ${featureList.map(esc).join(' · ')}</div>` : ''}
          ${kd.weakSpots.length ? `<div class="openseo-good">Weak spots at position ${kd.weakSpots.join(', ')} (forums/UGC or off-topic titles): room to outrank</div>` : ''}
        </div>
        <button class="openseo-kd-toggle" type="button">Top 10 ▾</button>
      </div>
      <table class="openseo-kd-table" hidden><thead><tr><th>#</th><th>Domain</th><th>Tranco</th><th>Title match</th><th>Strength</th></tr></thead><tbody>
      ${kd.rows.map((r) => `<tr><td>${r.position}</td><td>${esc(r.domain)}${r.weak ? ' <em>UGC</em>' : ''}${r.homepage ? ' <em>home</em>' : ''}</td><td>${r.tranco ? '#' + r.tranco.toLocaleString() : 'unranked'}</td><td>${r.relevance}%</td><td><i style="width:${r.strength}%"></i>${r.strength}</td></tr>`).join('')}
      </tbody></table>`;
    panel.querySelector('.openseo-kd-toggle').onclick = () => { const tb = panel.querySelector('table'); tb.hidden = !tb.hidden; };
  }

  process();
  keywordPanel();
  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(process, 400); })
    .observe(document.body, { childList: true, subtree: true });
})();
