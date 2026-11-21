// OpenSEO Lens — background service worker (MV3)
// No accounts, no API keys. Every external source used here is public and keyless.

const SESSION_PREFIX = 'tab:';
const CACHE_PREFIX = 'cache:';
const DAY = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Redirect chain + response headers for each tab's main document      */
/* ------------------------------------------------------------------ */

const live = new Map(); // tabId -> in-progress record (kept in memory while SW is awake)

function headersToObj(list = []) {
  const out = {};
  for (const h of list) {
    const k = h.name.toLowerCase();
    out[k] = out[k] ? out[k] + ', ' + (h.value || '') : (h.value || '');
  }
  return out;
}

chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId < 0) return;
    live.set(d.tabId, { startedAt: d.timeStamp, requestUrl: d.url, chain: [], final: null });
  },
  { urls: ['<all_urls>'], types: ['main_frame'] }
);

chrome.webRequest.onBeforeRedirect.addListener(
  (d) => {
    const rec = live.get(d.tabId);
    if (!rec) return;
    rec.chain.push({
      url: d.url,
      status: d.statusCode,
      location: d.redirectUrl,
      ip: d.ip || null,
      headers: headersToObj(d.responseHeaders)
    });
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['responseHeaders']
);

chrome.webRequest.onCompleted.addListener(
  async (d) => {
    const rec = live.get(d.tabId);
    if (!rec) return;
    rec.final = {
      url: d.url,
      status: d.statusCode,
      statusLine: d.statusLine,
      ip: d.ip || null,
      fromCache: d.fromCache,
      headers: headersToObj(d.responseHeaders),
      ms: Math.round(d.timeStamp - rec.startedAt)
    };
    live.delete(d.tabId);
    await chrome.storage.session.set({ [SESSION_PREFIX + d.tabId]: rec });
    setBadge(d.tabId, d.statusCode, rec.chain.length);
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['responseHeaders']
);

chrome.webRequest.onErrorOccurred.addListener(
  async (d) => {
    const rec = live.get(d.tabId);
    if (!rec) return;
    rec.final = { url: d.url, status: 0, error: d.error, headers: {} };
    live.delete(d.tabId);
    await chrome.storage.session.set({ [SESSION_PREFIX + d.tabId]: rec });
    chrome.action.setBadgeText({ tabId: d.tabId, text: 'ERR' });
    chrome.action.setBadgeBackgroundColor({ tabId: d.tabId, color: '#d93025' });
  },
  { urls: ['<all_urls>'], types: ['main_frame'] }
);

function setBadge(tabId, status, hops) {
  const color = status >= 500 ? '#d93025' : status >= 400 ? '#e8710a' : hops > 0 ? '#f9ab00' : '#188038';
  chrome.action.setBadgeText({ tabId, text: String(status || '') }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

chrome.tabs.onRemoved.addListener((tabId) => {
  live.delete(tabId);
  chrome.storage.session.remove(SESSION_PREFIX + tabId);
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

async function cached(key, ttl, producer) {
  const k = CACHE_PREFIX + key;
  const got = (await chrome.storage.local.get(k))[k];
  if (got && Date.now() - got.at < ttl) return got.value;
  const value = await producer();
  await chrome.storage.local.set({ [k]: { at: Date.now(), value } });
  return value;
}

function registrableDomain(host) {
  // Lightweight eTLD+1 guess (handles common 2-level public suffixes).
  host = host.replace(/^www\./, '').toLowerCase();
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const twoLevel = /^(co|com|net|org|gov|edu|ac|gen|firm|ind|nic|res|ltd|plc|me|sch|nom)$/;
  const sl = parts[parts.length - 2];
  if (twoLevel.test(sl) && parts[parts.length - 1].length === 2) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

/* ------------------------------------------------------------------ */
/* Keyless data sources                                                */
/* ------------------------------------------------------------------ */

// Tranco top-sites research ranking (https://tranco-list.eu) — free, no key.
let trancoQueue = Promise.resolve();
function trancoRank(domain) {
  domain = registrableDomain(domain);
  return cached('tranco:' + domain, 7 * DAY, () => {
    // serialise calls: the public API asks for ~1 request/second
    const p = trancoQueue.then(async () => {
      try {
        const r = await fetchWithTimeout('https://tranco-list.eu/api/ranks/domain/' + encodeURIComponent(domain), {}, 8000);
        if (!r.ok) return { domain, rank: null, error: 'HTTP ' + r.status };
        const j = await r.json();
        const ranks = (j.ranks || []).sort((a, b) => (a.date < b.date ? 1 : -1));
        return { domain, rank: ranks[0]?.rank ?? null, date: ranks[0]?.date ?? null };
      } catch (e) {
        return { domain, rank: null, error: String(e.message || e) };
      } finally {
        await new Promise((res) => setTimeout(res, 1100));
      }
    });
    trancoQueue = p.catch(() => {});
    return p;
  });
}

// RDAP (successor of WHOIS) via the rdap.org bootstrap redirector — free, no key.
function rdap(domain) {
  domain = registrableDomain(domain);
  return cached('rdap:' + domain, 7 * DAY, async () => {
    try {
      const r = await fetchWithTimeout('https://rdap.org/domain/' + encodeURIComponent(domain), {}, 12000);
      if (!r.ok) return { domain, error: 'HTTP ' + r.status };
      const j = await r.json();
      const ev = {};
      for (const e of j.events || []) ev[e.eventAction] = e.eventDate;
      let registrar = null;
      for (const ent of j.entities || []) {
        if ((ent.roles || []).includes('registrar')) {
          const fn = (ent.vcardArray?.[1] || []).find((x) => x[0] === 'fn');
          registrar = fn ? fn[3] : ent.handle || null;
        }
      }
      return {
        domain,
        registered: ev.registration || null,
        expires: ev.expiration || null,
        updated: ev['last changed'] || null,
        registrar,
        status: j.status || [],
        nameservers: (j.nameservers || []).map((n) => (n.ldhName || '').toLowerCase())
      };
    } catch (e) {
      return { domain, error: String(e.message || e) };
    }
  });
}

// Internet Archive Wayback Machine — free, no key.
function wayback(url) {
  return cached('wb:' + url, DAY, async () => {
    const out = { url };
    try {
      const host = new URL(url).hostname;
      const [first, last] = await Promise.all([
        fetchWithTimeout(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(host)}&output=json&limit=1&fl=timestamp`, {}, 15000)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
        fetchWithTimeout(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, {}, 15000)
          .then((r) => (r.ok ? r.json() : {}))
          .catch(() => ({}))
      ]);
      out.firstSeen = first?.[1]?.[0] || null; // row 0 is the header
      const snap = last?.archived_snapshots?.closest;
      out.latest = snap ? { url: snap.url, timestamp: snap.timestamp, status: snap.status } : null;
    } catch (e) {
      out.error = String(e.message || e);
    }
    return out;
  });
}

// DNS over HTTPS (Cloudflare public resolver) — free, no key.
async function dns(host) {
  const types = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'CAA'];
  const res = {};
  await Promise.all(
    types.map(async (t) => {
      try {
        const r = await fetchWithTimeout(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${t}`,
          { headers: { accept: 'application/dns-json' } },
          8000
        );
        const j = await r.json();
        res[t] = (j.Answer || []).map((a) => a.data);
      } catch {
        res[t] = [];
      }
    })
  );
  return res;
}

// Google PageSpeed Insights API. Without a key every caller worldwide shares one daily quota,
// which can run out; an optional personal key (Settings) gets its own free quota.
// Successful results are cached for 12h so repeat views don't spend quota.
async function pageSpeed(url, strategy = 'mobile', fresh = false) {
  const { psiKey } = await chrome.storage.local.get('psiKey');
  const key = (psiKey || '').trim();
  const cacheKey = CACHE_PREFIX + `psi:${strategy}:${url}`;
  if (!fresh) {
    const hit = (await chrome.storage.local.get(cacheKey))[cacheKey];
    if (hit && Date.now() - hit.at < 12 * 60 * 60 * 1000) return { ...hit.value, cachedAt: new Date(hit.at).toISOString() };
  }
  const api =
    'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=' +
    encodeURIComponent(url) +
    '&strategy=' + strategy +
    '&category=performance&category=accessibility&category=best-practices&category=seo' +
    (key ? '&key=' + encodeURIComponent(key) : '');
  let r, j;
  try {
    r = await fetchWithTimeout(api, {}, 90000);
    j = await r.json();
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'The test took longer than 90 seconds. Try again or use the web version.' : 'Could not reach PageSpeed: ' + (e.message || e), kind: 'network', usedKey: !!key };
  }
  if (j.error) {
    const msg = j.error.message || 'PageSpeed error';
    const reasons = (j.error.errors || []).map((x) => x.reason).join(' ') + ' ' + (j.error.status || '');
    let kind = 'other';
    if (r.status === 429 || /quota|rateLimit|RESOURCE_EXHAUSTED/i.test(msg + reasons)) kind = 'quota';
    else if (/API key|keyInvalid|API_KEY_INVALID|PERMISSION_DENIED|SERVICE_DISABLED|has not been used/i.test(msg + reasons)) kind = 'key';
    else if (/FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|NO_FCP|unable to fetch|Lighthouse returned error/i.test(msg)) kind = 'page';
    return { error: msg, kind, usedKey: !!key };
  }
  const cats = j.lighthouseResult?.categories || {};
  const audits = j.lighthouseResult?.audits || {};
  const pick = (id) => audits[id] ? { title: audits[id].title, value: audits[id].displayValue, score: audits[id].score } : null;
  const field = j.loadingExperience?.metrics || {};
  const result = {
    strategy,
    scores: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, Math.round((v.score || 0) * 100)])),
    lab: {
      fcp: pick('first-contentful-paint'),
      lcp: pick('largest-contentful-paint'),
      tbt: pick('total-blocking-time'),
      cls: pick('cumulative-layout-shift'),
      si: pick('speed-index'),
      tti: pick('interactive')
    },
    field: Object.fromEntries(
      Object.entries(field).map(([k, v]) => [k, { p75: v.percentile, category: v.category }])
    ),
    opportunities: Object.values(audits)
      .filter((a) => a.details?.type === 'opportunity' && a.score !== null && a.score < 0.9)
      .map((a) => ({ title: a.title, value: a.displayValue || '' }))
      .slice(0, 10)
  };
  await chrome.storage.local.set({ [cacheKey]: { at: Date.now(), value: result } });
  return result;
}

// Link status checker: HEAD first, fall back to GET for servers that reject HEAD.
async function checkLinks(urls) {
  const unique = [...new Set(urls)].slice(0, 500);
  const results = {};
  let i = 0;
  async function worker() {
    while (i < unique.length) {
      const u = unique[i++];
      try {
        let r = await fetchWithTimeout(u, { method: 'HEAD', redirect: 'follow' }, 10000);
        if (r.status === 405 || r.status === 403 || r.status === 501) {
          r = await fetchWithTimeout(u, { method: 'GET', redirect: 'follow' }, 12000);
        }
        results[u] = { status: r.status, redirected: r.redirected, finalUrl: r.url };
      } catch (e) {
        results[u] = { status: 0, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return results;
}

async function fetchText(url, maxBytes = 2_000_000) {
  try {
    const r = await fetchWithTimeout(url, { redirect: 'follow' }, 12000);
    const text = (await r.text()).slice(0, maxBytes);
    return { ok: r.ok, status: r.status, url: r.url, text, contentType: r.headers.get('content-type') };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e) };
  }
}

/* ------------------------------------------------------------------ */
/* Backlinks — public, keyless link sources                            */
/* ------------------------------------------------------------------ */

const WIKI_LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'zh', 'hi'];
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const onDomain = (u, domain) => { const h = hostOf(u); return h === domain || h.endsWith('.' + domain); };
const getJSON = async (url, headers = {}) => {
  const r = await fetchWithTimeout(url, { headers }, 20000);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
};

async function blWikipedia(domain) {
  const out = [];
  await Promise.all(WIKI_LANGS.map(async (lang) => {
    for (const pattern of [domain, '*.' + domain]) {
      for (const proto of ['https']) {
        let cont = null, pages = 0;
        do {
          const api = `https://${lang}.wikipedia.org/w/api.php?action=query&list=exturlusage&format=json&eunamespace=0&eulimit=500`
            + `&euprotocol=${proto}&euquery=${encodeURIComponent(pattern)}` + (cont ? `&eucontinue=${encodeURIComponent(cont)}` : '');
          let j;
          try { j = await getJSON(api, { 'Api-User-Agent': 'OpenSEO-Lens/1.0 (open-source browser extension)' }); } catch { break; }
          for (const e of j.query?.exturlusage || []) {
            out.push({
              source: 'Wikipedia', refUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(e.title.replace(/ /g, '_'))}`,
              refTitle: `${e.title} (${lang})`, target: e.url, rel: 'nofollow', note: 'Wikipedia adds nofollow to external links'
            });
          }
          cont = j.continue?.eucontinue || null;
        } while (cont && ++pages < 3);
      }
    }
  }));
  return out;
}

async function blHackerNews(domain) {
  const out = [];
  const stories = await getJSON(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(domain)}&restrictSearchableAttributes=url&tags=story&hitsPerPage=200`).catch(() => ({ hits: [] }));
  for (const h of stories.hits || []) {
    if (!h.url || !onDomain(h.url, domain)) continue;
    out.push({ source: 'Hacker News', refUrl: `https://news.ycombinator.com/item?id=${h.objectID}`, refTitle: h.title, target: h.url, date: h.created_at, score: h.points, anchor: h.title });
  }
  const comments = await getJSON(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent('"' + domain + '"')}&tags=comment&hitsPerPage=100`).catch(() => ({ hits: [] }));
  for (const c of comments.hits || []) {
    const hrefs = [...(c.comment_text || '').matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&#x2F;/g, '/').replace(/&amp;/g, '&'));
    const hit = hrefs.find((u) => onDomain(u, domain));
    if (!hit) continue;
    out.push({ source: 'Hacker News', refUrl: `https://news.ycombinator.com/item?id=${c.objectID}`, refTitle: 'Comment on: ' + (c.story_title || 'HN thread'), target: hit, date: c.created_at, rel: 'nofollow' });
  }
  return out;
}

async function blLobsters(domain) {
  const j = await getJSON(`https://lobste.rs/domains/${encodeURIComponent(domain)}.json`).catch(() => []);
  return (Array.isArray(j) ? j : []).filter((s) => s.url && onDomain(s.url, domain)).map((s) => ({
    source: 'Lobsters', refUrl: s.short_id_url || s.comments_url, refTitle: s.title, target: s.url, date: s.created_at, score: s.score, anchor: s.title
  }));
}

async function blStackExchange(domain) {
  const j = await getJSON(`https://api.stackexchange.com/2.3/search/excerpts?order=desc&sort=votes&site=stackoverflow&pagesize=100&q=${encodeURIComponent('"' + domain + '"')}`).catch(() => ({ items: [] }));
  return (j.items || []).map((i) => ({
    source: 'Stack Overflow',
    refUrl: i.item_type === 'answer' ? `https://stackoverflow.com/a/${i.answer_id}` : `https://stackoverflow.com/q/${i.question_id}`,
    refTitle: (i.title || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    target: domain, date: i.creation_date ? new Date(i.creation_date * 1000).toISOString() : null, score: i.score,
    note: 'mentions the domain — verify to confirm a link'
  }));
}

async function blLocal(domain) {
  const k = 'lg:' + registrableDomain(domain);
  const store = (await chrome.storage.local.get(k))[k] || {};
  return Object.entries(store).filter(([, v]) => onDomain(v.target, domain)).map(([refUrl, v]) => ({
    source: 'Your browsing', refUrl, refTitle: v.title, target: v.target, anchor: v.anchor, rel: v.rel || 'follow', date: v.seen ? new Date(v.seen).toISOString() : null, verified: 'live'
  }));
}

async function backlinks(domain, fresh = false) {
  domain = domain.replace(/^www\./, '').toLowerCase();
  const key = 'bl:' + domain;
  if (fresh) await chrome.storage.local.remove(CACHE_PREFIX + key);
  const remote = await cached(key, DAY, async () => {
    const sources = { Wikipedia: blWikipedia, 'Hacker News': blHackerNews, Lobsters: blLobsters, 'Stack Overflow': blStackExchange };
    const status = {};
    const lists = await Promise.all(Object.entries(sources).map(async ([name, fn]) => {
      try { const l = await fn(domain); status[name] = { ok: true, count: l.length }; return l; }
      catch (e) { status[name] = { ok: false, error: String(e.message || e) }; return []; }
    }));
    return { fetchedAt: new Date().toISOString(), status, items: lists.flat() };
  });
  const local = await blLocal(domain);
  // de-duplicate by referring URL + target
  const seen = new Set();
  const items = [...local, ...remote.items].filter((i) => {
    const k = i.refUrl + '|' + i.target;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).filter((i) => !onDomain(i.refUrl, domain));
  return { domain, fetchedAt: remote.fetchedAt, status: { ...remote.status, 'Your browsing': { ok: true, count: local.length } }, items };
}

// Local link graph: content/linkgraph.js reports external links on pages you visit.
let lgWrite = Promise.resolve();
function recordLinks({ page, title, links }) {
  lgWrite = lgWrite.then(async () => {
    const byTarget = {};
    for (const l of links.slice(0, 400)) {
      const d = registrableDomain(hostOf(l.href));
      if (!d) continue;
      (byTarget[d] ||= []).push(l);
    }
    const keys = Object.keys(byTarget).map((d) => 'lg:' + d);
    if (!keys.length) return;
    const cur = await chrome.storage.local.get(keys);
    const upd = {};
    for (const [d, ls] of Object.entries(byTarget)) {
      const store = cur['lg:' + d] || {};
      const l = ls[0];
      store[page] = { title: (title || '').slice(0, 200), target: l.href.slice(0, 500), anchor: (l.text || '').slice(0, 150), rel: l.rel || 'follow', seen: Date.now() };
      const entries = Object.entries(store);
      if (entries.length > 2000) entries.sort((a, b) => b[1].seen - a[1].seen).length = 2000;
      upd['lg:' + d] = Object.fromEntries(entries);
    }
    await chrome.storage.local.set(upd);
  }).catch(() => {});
  return lgWrite.then(() => true);
}

async function linkGraphStats() {
  const all = await chrome.storage.local.get(null);
  const lg = Object.entries(all).filter(([k]) => k.startsWith('lg:'));
  return { domains: lg.length, links: lg.reduce((a, [, v]) => a + Object.keys(v).length, 0) };
}

async function clearLinkGraph() {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('lg:')));
  return true;
}

/* ------------------------------------------------------------------ */
/* Keyword demand (search-volume proxy) — keyless signals              */
/* ------------------------------------------------------------------ */

const sugMem = new Map();
async function suggest(q, gl = 'us', hl = 'en', ds = '') {
  const k = [q, gl, hl, ds].join('|');
  if (sugMem.has(k)) return sugMem.get(k);
  const p = (async () => {
    try {
      const r = await fetchWithTimeout(`https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&gl=${gl}${ds ? '&ds=' + ds : ''}&q=${encodeURIComponent(q)}`, {}, 8000);
      const j = JSON.parse(await r.text());
      return (j[1] || []).map((s) => String(s).toLowerCase().trim());
    } catch { return null; }
  })();
  sugMem.set(k, p);
  if (sugMem.size > 3000) sugMem.delete(sugMem.keys().next().value);
  return p;
}
const normKw = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// How early does Google autocomplete offer the keyword? Earlier = more searched.
async function autocompleteDepth(kw, gl, hl) {
  const L = kw.length;
  const steps = [...new Set([1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 22, 27, 33, 40, 50, 60, 80].filter((n) => n < L).concat(L))];
  for (const n of steps) {
    const list = await suggest(kw.slice(0, n), gl, hl);
    if (!list) return { error: 'autocomplete unavailable' };
    const pos = list.indexOf(kw);
    if (pos >= 0) return { prefix: n, position: pos, length: L };
  }
  return { prefix: null, length: L };
}

async function wikiDemand(kw, hl) {
  const lang = /^[a-z]{2}$/.test(hl) ? hl : 'en';
  try {
    const s = await (await fetchWithTimeout(`https://${lang}.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&search=${encodeURIComponent(kw)}`, { headers: { 'Api-User-Agent': 'OpenSEO-Lens/1.1' } }, 8000)).json();
    const title = s?.[1]?.[0];
    if (!title) return null;
    const end = new Date(); end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() - 1);
    const start = new Date(end); start.setUTCMonth(start.getUTCMonth() - 11);
    const ym = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}01`;
    const v = await (await fetchWithTimeout(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/${ym(start)}/${ym(end)}`, { headers: { 'Api-User-Agent': 'OpenSEO-Lens/1.1' } }, 10000)).json();
    const series = (v.items || []).map((i) => ({ month: i.timestamp.slice(0, 6), views: i.views }));
    const last3 = series.slice(-3);
    const avg = last3.length ? Math.round(last3.reduce((a, b) => a + b.views, 0) / last3.length) : 0;
    const tWords = normKw(title).split(' '), kWords = kw.split(' ');
    const match = normKw(title) === kw ? 'exact' : tWords.every((w) => kWords.includes(w)) || kWords.every((w) => tWords.includes(w)) ? 'close' : 'loose';
    return { title, lang, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, avgMonthlyViews: avg, series, match };
  } catch { return null; }
}

async function crossPlatform(kw, gl, hl) {
  const has = (list) => !!list && list.some((s) => s === kw || s.startsWith(kw + ' '));
  const [yt, ddg, amz] = await Promise.all([
    suggest(kw, gl, hl, 'yt'),
    fetchWithTimeout(`https://duckduckgo.com/ac/?type=list&q=${encodeURIComponent(kw)}`, {}, 8000).then((r) => r.json()).then((j) => (j[1] || []).map(normKw)).catch(() => null),
    fetchWithTimeout(`https://completion.amazon.com/api/2017/suggestions?mid=ATVPDKIKX0DER&alias=aps&prefix=${encodeURIComponent(kw)}`, {}, 8000).then((r) => r.json()).then((j) => (j.suggestions || []).map((s) => normKw(s.value))).catch(() => null)
  ]);
  return { youtube: has(yt), duckduckgo: has(ddg), amazon: has(amz) };
}

function intentOf(kw) {
  if (/\b(buy|price|prices|cost|cheap|deal|deals|discount|coupon|order|shop|sale|for sale|hire|booking|book)\b/.test(kw)) return 'transactional';
  if (/\b(best|top|review|reviews|vs|versus|compare|comparison|alternative|alternatives)\b/.test(kw)) return 'commercial';
  if (/\bnear me\b|\bin [a-z]+$/.test(kw)) return 'local';
  if (/^(how|what|why|when|where|who|which|can|does|is|are|do|should)\b|\b(guide|tutorial|meaning|definition|ideas|examples|tips)\b/.test(kw)) return 'informational';
  if (/\.(com|org|net|io|in)\b|\b(login|sign in|app|official|website)\b/.test(kw)) return 'navigational';
  return 'informational';
}

const DEMAND_TIERS = [
  { min: 80, label: 'Very high', range: '100K+' },
  { min: 60, label: 'High', range: '10K–100K' },
  { min: 40, label: 'Medium', range: '1K–10K' },
  { min: 20, label: 'Low', range: '100–1K' },
  { min: 0, label: 'Very low', range: '<100' }
];

async function keywordMetrics({ keyword, gl = 'us', hl = 'en', light = false }) {
  const kw = normKw(keyword);
  if (!kw) return { error: 'empty keyword' };
  const kdKey = CACHE_PREFIX + `kd:${gl}:${kw}`;
  const bundle = await cached(`kw:${light ? 'l' : 'f'}:${gl}:${hl}:${kw}`, DAY, async () => {
    const [depth, wiki, cross] = await Promise.all([
      autocompleteDepth(kw, gl, hl),
      light ? null : wikiDemand(kw, hl),
      light ? null : crossPlatform(kw, gl, hl)
    ]);
    if (depth.error) return { keyword: kw, error: depth.error };
    let depthScore;
    if (depth.prefix == null) depthScore = 3;
    else if (depth.prefix >= depth.length) depthScore = 10;
    else depthScore = 100 * Math.pow(1 - (depth.prefix - 1) / depth.length, 0.7) * (1 - depth.position * 0.03);
    // shorter head terms that complete within 1–3 characters are genuinely huge
    if (depth.prefix && depth.prefix <= 2 && depth.position <= 2) depthScore = Math.max(depthScore, 95);
    let score = depthScore;
    const parts = { autocomplete: Math.round(depthScore) };
    if (!light) {
      const breadth = ((cross.youtube ? 1 : 0) + (cross.duckduckgo ? 1 : 0) + (cross.amazon ? 1 : 0)) / 3 * 100;
      parts.crossPlatform = Math.round(breadth);
      if (wiki && wiki.match !== 'loose' && wiki.avgMonthlyViews > 0) {
        const ws = Math.max(0, Math.min(100, (Math.log10(wiki.avgMonthlyViews) - 1) * 20));
        parts.wikipedia = Math.round(ws);
        score = 0.55 * depthScore + 0.25 * ws + 0.2 * breadth;
      } else {
        score = 0.75 * depthScore + 0.25 * breadth;
      }
    }
    score = Math.round(Math.max(0, Math.min(100, score)));
    const tier = DEMAND_TIERS.find((t) => score >= t.min);
    const words = kw.split(' ').length;
    return {
      keyword: kw, gl, hl, light, demand: score, tier: tier.label, range: tier.range, parts,
      depth, wiki, cross, intent: intentOf(kw), words, type: words <= 2 ? 'head' : words <= 4 ? 'body' : 'long-tail'
    };
  });
  const kd = (await chrome.storage.local.get(kdKey))[kdKey];
  return { ...bundle, difficulty: kd && Date.now() - kd.at < 7 * DAY ? kd.value : null };
}

async function keywordIdeas({ seed, gl = 'us', hl = 'en' }) {
  const kw = normKw(seed);
  const mods = ['', ...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''), 'how', 'what', 'why', 'best', 'vs', 'near me', 'for', 'without', 'with', 'is', 'can'];
  const set = new Map();
  await Promise.all(mods.map(async (m) => {
    const qs = m ? [`${kw} ${m}`, ...(m.length > 2 ? [`${m} ${kw}`] : [])] : [kw];
    for (const q of qs) {
      const list = (await suggest(q, gl, hl)) || [];
      list.forEach((s, i) => { if (s !== kw && !set.has(s)) set.set(s, { keyword: s, from: q, position: i }); });
    }
  }));
  const qs = [...set.values()].filter((i) => /^(how|what|why|when|where|who|which|can|does|is|are|do|should)\b/.test(i.keyword));
  return { seed: kw, ideas: [...set.values()].sort((a, b) => a.keyword.localeCompare(b.keyword)), questions: qs.map((q) => q.keyword) };
}

/* ------------------------------------------------------------------ */
/* Keyword difficulty — computed from the live Google top 10           */
/* ------------------------------------------------------------------ */

const WEAK_DOMAINS = /(^|\.)(reddit\.com|quora\.com|medium\.com|pinterest\.[a-z.]+|stackexchange\.com|tumblr\.com|blogspot\.com|wordpress\.com|linkedin\.com|facebook\.com|x\.com|twitter\.com|tiktok\.com)$/;

async function serpDifficulty({ query, gl, results, features }) {
  const kw = normKw(query);
  const top = results.slice(0, 10);
  if (top.length < 3) return { error: 'not enough organic results on the page' };
  const domains = [...new Set(top.map((r) => registrableDomain(hostOf(r.url))))];
  const ranks = {};
  for (const d of domains) ranks[d] = await trancoRank(d);
  const kwWords = kw.split(' ').filter((w) => w.length > 2);
  const rows = top.map((r, i) => {
    const d = registrableDomain(hostOf(r.url));
    const rank = ranks[d]?.rank;
    let authority = rank == null ? 20 : rank <= 1000 ? 100 : rank <= 10000 ? 85 : rank <= 100000 ? 65 : rank <= 1000000 ? 45 : 20;
    const weak = WEAK_DOMAINS.test(d);
    if (weak) authority = Math.min(authority, 40); // forums / UGC ranking = a content gap you can win
    const t = (r.title || '').toLowerCase();
    const exact = t.includes(kw);
    const covered = kwWords.length ? kwWords.filter((w) => t.includes(w)).length / kwWords.length : 1;
    const relevance = exact ? 1 : covered;
    let path = 0; try { path = new URL(r.url).pathname.split('/').filter(Boolean).length; } catch {}
    const homepage = path === 0;
    const strength = Math.min(100, authority * (0.6 + 0.4 * relevance) * (homepage ? 1.1 : 1));
    return { position: i + 1, url: r.url, title: r.title, domain: d, tranco: rank ?? null, authority, relevance: Math.round(relevance * 100), weak, homepage, strength: Math.round(strength) };
  });
  const w = rows.map((r) => (r.position <= 3 ? 1.5 : 1));
  let kd = rows.reduce((a, r, i) => a + r.strength * w[i], 0) / w.reduce((a, b) => a + b, 0);
  if (features?.ads >= 3) kd += 3;
  kd = Math.round(Math.max(0, Math.min(100, kd)));
  const label = kd >= 85 ? 'Super hard' : kd >= 70 ? 'Very hard' : kd >= 50 ? 'Hard' : kd >= 30 ? 'Medium' : kd >= 15 ? 'Easy' : 'Very easy';
  const result = {
    keyword: kw, gl, kd, label, at: new Date().toISOString(), rows, features,
    weakSpots: rows.filter((r) => r.weak || r.relevance < 50).map((r) => r.position),
    commercial: (features?.ads || 0) > 0 || !!features?.shopping
  };
  await chrome.storage.local.set({ [CACHE_PREFIX + `kd:${gl}:${kw}`]: { at: Date.now(), value: result } });
  return result;
}

// Popup-triggered check: open the user's own Google search in a background tab, read it, close it.
const probes = new Map(); // tabId -> resolve
async function checkDifficulty({ keyword, gl = 'us', hl = 'en' }) {
  const kw = normKw(keyword);
  const tab = await chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(kw)}&gl=${gl}&hl=${hl}&pws=0`, active: false });
  const result = await new Promise((resolve) => {
    probes.set(tab.id, resolve);
    setTimeout(() => resolve(null), 45000);
  });
  probes.delete(tab.id);
  if (result) { chrome.tabs.remove(tab.id).catch(() => {}); return result; }
  const t = await chrome.tabs.get(tab.id).catch(() => null);
  if (t?.url?.includes('/sorry/')) {
    chrome.tabs.update(tab.id, { active: true });
    return { error: 'captcha', message: 'Google asked to confirm you are human. Solve it in the opened tab yourself, then try again.' };
  }
  chrome.tabs.remove(tab.id).catch(() => {});
  return { error: 'timeout', message: 'Could not read the Google results page.' };
}

/* ------------------------------------------------------------------ */
/* Message router                                                      */
/* ------------------------------------------------------------------ */

const handlers = {
  async getTabNet({ tabId }) {
    const k = SESSION_PREFIX + tabId;
    return (await chrome.storage.session.get(k))[k] || null;
  },
  fetchText: ({ url }) => fetchText(url),
  checkLinks: ({ urls }) => checkLinks(urls),
  trancoRank: ({ domain }) => trancoRank(domain),
  async trancoMany({ domains }) {
    const out = {};
    for (const d of domains.slice(0, 15)) out[d] = await trancoRank(d);
    return out;
  },
  rdap: ({ domain }) => rdap(domain),
  wayback: ({ url }) => wayback(url),
  dns: ({ host }) => dns(host),
  pageSpeed: ({ url, strategy, fresh }) => pageSpeed(url, strategy, fresh),
  backlinks: ({ domain, fresh }) => backlinks(domain, fresh),
  keywordMetrics: (m) => keywordMetrics(m),
  async keywordMetricsMany({ keywords, gl, hl }) {
    const out = {};
    let i = 0;
    const list = keywords.slice(0, 80);
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < list.length) { const k = list[i++]; out[k] = await keywordMetrics({ keyword: k, gl, hl, light: true }); }
    }));
    return out;
  },
  keywordIdeas: (m) => keywordIdeas(m),
  checkDifficulty: (m) => checkDifficulty(m),
  isProbe: (_m, sender) => probes.has(sender?.tab?.id),
  async serpDifficulty(m, sender) {
    const r = await serpDifficulty(m);
    const done = probes.get(sender?.tab?.id);
    if (done) done(r);
    return r;
  },
  recordLinks: (m) => recordLinks(m),
  linkGraphStats: () => linkGraphStats(),
  clearLinkGraph: () => clearLinkGraph(),
  async clearCache() {
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX)));
    return true;
  }
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const fn = handlers[msg?.type];
  if (!fn) return false;
  Promise.resolve(fn(msg, _sender))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // async response
});

/* ------------------------------------------------------------------ */
/* Keyboard command: highlight links                                   */
/* ------------------------------------------------------------------ */

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-highlight' || !tab?.id) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/highlight.js'] });
});

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.sync.get(['serpOverlay', 'serpRank', 'linkGraph']);
  await chrome.storage.sync.set({
    serpOverlay: cur.serpOverlay ?? true,
    serpRank: cur.serpRank ?? true,
    linkGraph: cur.linkGraph ?? true
  });
});
