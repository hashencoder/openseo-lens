// OpenSEO Lens — popup controller
import { audit } from '../lib/audit.js';
import { parseRobots, isAllowed } from '../lib/robots.js';

const state = { tab: null, data: null, net: null, report: null, rendered: {}, linkStatus: {} };

/* ---------------- utilities ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = (n) => (n == null ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB');
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString());
const panel = (name) => $(`.panel[data-panel="${name}"]`);
const send = (type, payload = {}) =>
  new Promise((res) => chrome.runtime.sendMessage({ type, ...payload }, (r) => res(r?.ok ? r.data : { error: r?.error || chrome.runtime.lastError?.message })));
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}
function lenPill(len, min, max) {
  const cls = !len ? 'bad' : len < min || len > max ? 'warn' : 'good';
  return `<span class="pill ${cls} len">${len} chars</span>`;
}
function download(name, text, mime = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function toCSV(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.map(q).join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\r\n');
}
const slug = () => { try { return new URL(state.data.basics.url).hostname.replace(/\W+/g, '_'); } catch { return 'page'; } };
const linkTo = (u, label) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(label ?? u)}</a>`;

// Approximate Google SERP title truncation (~580px at 20px Arial).
function pixelTrim(text, maxPx, font) {
  const c = pixelTrim.c || (pixelTrim.c = document.createElement('canvas').getContext('2d'));
  c.font = font;
  if (c.measureText(text).width <= maxPx) return { text, cut: false, px: Math.round(c.measureText(text).width) };
  let s = text;
  while (s.length && c.measureText(s + ' …').width > maxPx) s = s.slice(0, -1);
  return { text: s.trimEnd() + ' …', cut: true, px: Math.round(c.measureText(text).width) };
}

/* ---------------- tabs ---------------- */
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $('#sectionTitle').textContent = b.textContent.trim();
  $('#main').scrollTop = 0;
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === b.dataset.tab));
  render(b.dataset.tab);
});
$('#btnRefresh').onclick = () => run(true);
$('#btnOptions').onclick = () => chrome.runtime.openOptionsPage();

/* ---------------- main ---------------- */
async function run(force) {
  $('#loading').classList.remove('hidden');
  state.rendered = {};
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  $('#pageUrl').textContent = tab?.url || '';
  $('#pageUrl').title = tab?.url || '';
  if (!tab?.url || !/^https?:/i.test(tab.url) || /^https:\/\/chrome\.google\.com\/webstore|^https:\/\/chromewebstore\.google\.com/.test(tab.url)) {
    $('#loading').classList.add('hidden');
    panel('overview').innerHTML = `<div class="empty"><h3>Nothing to analyze here</h3><p>OpenSEO Lens works on regular http/https pages.<br>Browser pages and the Web Store can’t be read by extensions.</p></div>`;
    return;
  }
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/analyzer.js'] });
    state.data = res.result;
  } catch (e) {
    $('#loading').classList.add('hidden');
    panel('overview').innerHTML = `<div class="empty"><h3>Could not read this page</h3><p class="mono">${esc(e.message)}</p></div>`;
    return;
  }
  state.net = await send('getTabNet', { tabId: tab.id });
  if (state.net?.error) state.net = null;
  // net data belongs to a different URL (e.g. SPA navigation or reloaded before SW woke)
  if (state.net && state.net.final?.url && state.net.final.url.split('#')[0] !== state.data.basics.url.split('#')[0]) state.net = { ...state.net, stale: true };
  state.report = audit(state.data, state.net?.stale ? null : state.net);
  $('#loading').classList.add('hidden');
  const active = $('#tabs button.active').dataset.tab;
  render(active, force);
}

function render(name) {
  if (!state.data || state.rendered[name]) return;
  state.rendered[name] = true;
  const fn = renderers[name];
  if (fn) fn(panel(name));
}

/* ================================================================== */
/* Renderers                                                          */
/* ================================================================== */
const renderers = {
  overview(el) {
    const d = state.data, b = d.basics, r = state.report, n = state.net && !state.net.stale ? state.net : null;
    const color = r.score >= 80 ? 'var(--good)' : r.score >= 50 ? 'var(--warn)' : 'var(--bad)';
    const ext = d.links.filter((l) => l.type === 'external').length;
    const int = d.links.filter((l) => l.type === 'internal').length;
    const h1 = d.headings.list.filter((h) => h.level === 1);
    const statusPill = n?.final ? `<span class="pill ${n.final.status >= 400 ? 'bad' : n.chain.length ? 'warn' : 'good'}">${n.final.status}${n.chain.length ? ` · ${n.chain.length} redirect${n.chain.length > 1 ? 's' : ''}` : ''}</span>` : '<span class="pill">reload page for HTTP data</span>';
    const robots = [b.robots, n?.final?.headers?.['x-robots-tag']].filter(Boolean).join(' | ') || 'index, follow (default)';
    el.innerHTML = `
      <div class="card">
        <div class="score-wrap">
          <div class="ring" style="--p:${r.score};--c:${color}"><span>${r.score}</span></div>
          <div style="flex:1">
            <div style="font-size:15px;font-weight:700;margin-bottom:4px">On-page SEO score</div>
            <div class="counts">
              <span class="pill error">${r.counts.error} errors</span>
              <span class="pill warning">${r.counts.warning} warnings</span>
              <span class="pill notice">${r.counts.notice} notices</span>
              ${statusPill}
            </div>
            <div class="muted small" style="margin-top:6px">Computed locally from ${r.issues.length ? r.issues.length + ' checks that flagged' : 'all checks passing'} · no account, no data leaves your browser</div>
          </div>
        </div>
      </div>
      <div class="grid g6" style="margin-bottom:12px">
        <div class="stat"><div class="v">${fmtNum(d.content.mainWordCount)}</div><div class="l">Words</div></div>
        <div class="stat"><div class="v">${d.headings.counts[0]}</div><div class="l">H1</div></div>
        <div class="stat"><div class="v">${int}</div><div class="l">Int. links</div></div>
        <div class="stat"><div class="v">${ext}</div><div class="l">Ext. links</div></div>
        <div class="stat"><div class="v">${d.images.length}</div><div class="l">Images</div></div>
        <div class="stat"><div class="v">${d.schema.jsonld.length + d.schema.microdata.length}</div><div class="l">Schema</div></div>
      </div>
      <div class="card">
        <dl class="kv">
          <dt>Title</dt><dd>${esc(b.title) || '<span class="pill bad">missing</span>'} ${b.title ? lenPill(b.title.length, 30, 60) : ''}</dd>
          <dt>Description</dt><dd>${esc(b.description) || '<span class="pill bad">missing</span>'} ${b.description ? lenPill(b.description.length, 70, 160) : ''}</dd>
          <dt>H1</dt><dd>${h1.length ? h1.map((h) => esc(h.text)).join('<br>') : '<span class="pill bad">missing</span>'}</dd>
          <dt>URL</dt><dd class="mono">${esc(b.url)} <span class="pill len">${b.url.length} chars</span></dd>
          <dt>Canonical</dt><dd class="mono">${b.canonical ? esc(b.canonical) + (b.canonical.split('#')[0] === b.url.split('#')[0] ? ' <span class="pill good">self</span>' : ' <span class="pill warn">other URL</span>') : '<span class="pill warn">missing</span>'}</dd>
          <dt>Robots</dt><dd class="mono">${esc(robots)}</dd>
          <dt>Language</dt><dd>${esc(b.lang) || '—'} ${b.hreflang.length ? `· ${b.hreflang.length} hreflang` : ''}</dd>
          <dt>Keywords meta</dt><dd>${esc(b.keywords) || '<span class="muted">—</span>'}</dd>
        </dl>
      </div>
      <div class="card">
        <h3>Issues <span class="sub">sorted by severity</span></h3>
        ${r.issues.length ? `<ul class="issues">${r.issues.map((i) => `
          <li><span class="dot ${i.severity}"></span><div><div>${esc(i.title)} <span class="cat">· ${esc(i.category)}</span></div>${i.detail ? `<pre>${esc(i.detail)}</pre>` : ''}</div></li>`).join('')}</ul>`
          : '<div class="empty">No issues found 🎉</div>'}
      </div>`;
  },

  content(el) {
    const d = state.data, c = d.content;
    const kwTable = (list, label) => `
      <div class="card"><h3>${label}</h3>
        ${list.length ? `<table><thead><tr><th>Term</th><th class="num">Count</th><th class="num">Density</th><th style="width:70px"></th></tr></thead><tbody>
        ${list.slice(0, 15).map((k) => `<tr><td>${esc(k.term)}</td><td class="num">${k.count}</td><td class="num">${k.density}%</td><td><div class="bar"><i style="width:${Math.min(100, (k.count / list[0].count) * 100)}%"></i></div></td></tr>`).join('')}
        </tbody></table>` : '<div class="muted">Not enough text.</div>'}
      </div>`;
    const flesch = c.flesch;
    const fLabel = flesch == null ? '—' : flesch >= 70 ? 'Easy' : flesch >= 50 ? 'Fairly hard' : flesch >= 30 ? 'Difficult' : 'Very difficult';
    el.innerHTML = `
      <div class="grid g6" style="margin-bottom:12px">
        <div class="stat"><div class="v">${fmtNum(c.mainWordCount)}</div><div class="l">Main words</div></div>
        <div class="stat"><div class="v">${fmtNum(c.wordCount)}</div><div class="l">All words</div></div>
        <div class="stat"><div class="v">${c.readingTimeMin}m</div><div class="l">Read time</div></div>
        <div class="stat"><div class="v">${c.paragraphs}</div><div class="l">Paragraphs</div></div>
        <div class="stat"><div class="v">${c.textRatio}%</div><div class="l">Text/HTML</div></div>
        <div class="stat"><div class="v">${flesch ?? '—'}</div><div class="l">Flesch · ${fLabel}</div></div>
      </div>
      <div class="card">
        <h3>Heading structure <span class="sub">${d.headings.counts.map((n, i) => `H${i + 1}: ${n}`).join(' · ')}</span></h3>
        ${d.headings.skips.length ? `<div class="small" style="margin-bottom:6px"><span class="pill warn">${d.headings.skips.length} skipped levels</span></div>` : ''}
        ${d.headings.list.length ? `<ul class="htree">${d.headings.list.map((h) => `<li style="padding-left:${(h.level - 1) * 16}px"><span class="htag h${h.level}">H${h.level}</span><span>${esc(h.text) || '<i class="muted">(empty)</i>'}${h.hidden ? ' <span class="pill">hidden</span>' : ''}</span></li>`).join('')}</ul>` : '<div class="muted">No headings.</div>'}
        <div class="toolbar" style="margin:10px 0 0"><button class="btn" id="copyHeadings">Copy outline</button></div>
      </div>
      <div class="row">${kwTable(c.oneWord, '1-word')}${kwTable(c.twoWord, '2-word')}</div>
      ${kwTable(c.threeWord, '3-word phrases')}`;
    $('#copyHeadings').onclick = () => {
      navigator.clipboard.writeText(d.headings.list.map((h) => '  '.repeat(h.level - 1) + `H${h.level} ${h.text}`).join('\n'));
      toast('Outline copied');
    };
  },

  keywords(el) {
    const COUNTRIES = { us: 'United States', in: 'India', gb: 'United Kingdom', ca: 'Canada', au: 'Australia', de: 'Germany', fr: 'France', es: 'Spain', it: 'Italy', br: 'Brazil', mx: 'Mexico', nl: 'Netherlands', ae: 'UAE', sg: 'Singapore', za: 'South Africa', jp: 'Japan' };
    const LANGS = { en: 'English', hi: 'Hindi', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ja: 'Japanese', ar: 'Arabic' };
    const seed0 = (state.data.content.twoWord[0] || state.data.content.oneWord[0] || { term: '' }).term;
    const savedGeo = JSON.parse(localStorage.getItem('openseo_geo') || '{}');
    const tierCls = (s) => (s >= 60 ? 'good' : s >= 40 ? 'info' : s >= 20 ? 'warn' : '');
    const kdCls = (k) => (k >= 70 ? 'bad' : k >= 50 ? 'warn' : k >= 30 ? 'info' : 'good');
    el.innerHTML = `
      <div class="toolbar">
        <input type="text" id="kwSeed" value="${esc(seed0)}" placeholder="Enter a keyword" style="flex:1">
        <select id="kwGl" class="btn">${Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}" ${k === (savedGeo.gl || 'us') ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select id="kwHl" class="btn">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === (savedGeo.hl || 'en') ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn primary" id="kwGo">Analyze</button>
      </div>
      <div id="kwMain"><div class="empty">Type a keyword and press <b>Analyze</b> to see estimated demand, difficulty and related ideas.<br><span class="small">The seed is pre-filled with this page’s top phrase.</span></div></div>
      <div id="kwIdeas"></div>`;

    let ideas = [], questions = [], metrics = {}, ideaFilter = 'all', current = null;
    const geo = () => ({ gl: $('#kwGl').value, hl: $('#kwHl').value });

    const spark = (series) => {
      if (!series?.length) return '';
      const max = Math.max(...series.map((p) => p.views)) || 1, w = 220, h = 40;
      const pts = series.map((p, i) => `${(i / Math.max(1, series.length - 1)) * w},${h - (p.views / max) * (h - 4) - 2}`).join(' ');
      return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block"><polyline points="${pts}" fill="none" stroke="var(--brand2)" stroke-width="2"/></svg>
        <div class="small muted" style="display:flex;justify-content:space-between;width:${w}px"><span>${series[0].month.slice(0, 4)}-${series[0].month.slice(4)}</span><span>${series[series.length - 1].month.slice(0, 4)}-${series[series.length - 1].month.slice(4)}</span></div>`;
    };

    const kdBlock = (kd) => kd ? `
        <div class="stat" style="text-align:center"><div class="v"><span class="pill ${kdCls(kd.kd)}" style="font-size:20px;padding:4px 12px">${kd.kd}</span></div><div class="l">Keyword difficulty</div><div class="small"><b>${esc(kd.label)}</b></div>
        <div class="small muted">checked ${esc(kd.at.slice(0, 10))}</div></div>`
      : `<div class="stat" style="text-align:center"><div class="v">—</div><div class="l">Keyword difficulty</div>
        <button class="btn primary" id="kdRun" style="margin-top:6px">Check difficulty</button>
        <div class="small muted" style="margin-top:4px">Opens the Google search in a background tab and reads the top 10</div></div>`;

    const drawMain = () => {
      const m = current;
      if (m.error) { $('#kwMain').innerHTML = `<div class="empty"><span class="pill bad">${esc(m.error)}</span></div>`; return; }
      const kd = m.difficulty;
      const depthTxt = m.depth.prefix == null ? 'Google autocomplete never suggests it'
        : m.depth.prefix >= m.depth.length ? 'Suggested only once fully typed'
        : `Suggested after typing <b>${m.depth.prefix}</b> of ${m.depth.length} characters (position ${m.depth.position + 1})`;
      $('#kwMain').innerHTML = `
        <div class="card">
          <h3><span style="font-size:15px">${esc(m.keyword)}</span><span class="sub">${esc(COUNTRIES[m.gl] || m.gl)} · ${esc(LANGS[m.hl] || m.hl)}</span></h3>
          <div class="grid g3">
            <div class="stat" style="text-align:center"><div class="v"><span class="pill ${tierCls(m.demand)}" style="font-size:20px;padding:4px 12px">${m.demand}</span></div><div class="l">Demand score</div><div class="small"><b>${esc(m.tier)}</b> · ≈${esc(m.range)} / mo</div><div class="small muted">rough estimate, not exact volume</div></div>
            ${kdBlock(kd)}
            <div class="stat"><div class="l">Intent / type</div><div style="margin:4px 0"><span class="pill info">${esc(m.intent)}</span> <span class="pill">${esc(m.type)}</span> <span class="pill">${m.words} words</span></div>
              <div class="l" style="margin-top:6px">Also suggested on</div><div>${['youtube', 'duckduckgo', 'amazon'].map((k) => `<span class="pill ${m.cross?.[k] ? 'good' : ''}">${m.cross?.[k] ? '✓' : '✗'} ${k}</span>`).join(' ')}</div></div>
          </div>
          <div class="row" style="margin-top:10px">
            <div><div class="l muted small">GOOGLE AUTOCOMPLETE</div><div>${depthTxt}</div>
              <div class="small muted" style="margin-top:4px">Signal scores: ${Object.entries(m.parts).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</div></div>
            <div>${m.wiki ? `<div class="l muted small">WIKIPEDIA TOPIC INTEREST · ${linkTo(m.wiki.url, m.wiki.title)} ${m.wiki.match === 'loose' ? '<span class="pill warn">loose match</span>' : ''}</div>
              <div><b>${fmtNum(m.wiki.avgMonthlyViews)}</b> page views / month (real data, last 3 months)</div>${spark(m.wiki.series)}` : '<div class="small muted">No matching Wikipedia topic.</div>'}</div>
          </div>
        </div>
        ${kd ? `<div class="card"><h3>Top 10 on Google <span class="sub">${kd.weakSpots.length ? `<span class="pill good">weak spots: #${kd.weakSpots.join(', #')}</span>` : ''} ${Object.entries(kd.features || {}).filter(([k, v]) => v && k !== 'ads').map(([k]) => `<span class="pill">${esc(k.replace(/([A-Z])/g, ' $1').toLowerCase())}</span>`).join(' ')} ${kd.features?.ads ? `<span class="pill warn">${kd.features.ads} ads</span>` : ''}</span></h3>
          <table><thead><tr><th>#</th><th>Result</th><th>Tranco</th><th class="num">Title match</th><th class="num">Strength</th></tr></thead><tbody>
          ${kd.rows.map((r) => `<tr><td class="num">${r.position}</td><td class="url"><div>${linkTo(r.url, r.title || r.url)}</div><div class="small muted">${esc(r.domain)} ${r.weak ? '<span class="pill good">UGC/forum</span>' : ''} ${r.homepage ? '<span class="pill">homepage</span>' : ''}</div></td>
            <td class="num">${r.tranco ? '#' + fmtNum(r.tranco) : 'unranked'}</td><td class="num">${r.relevance}%</td><td class="num"><div class="bar" style="width:60px;display:inline-block;vertical-align:middle"><i style="width:${r.strength}%"></i></div> ${r.strength}</td></tr>`).join('')}
          </tbody></table>
          <div class="toolbar" style="margin:8px 0 0"><button class="btn" id="kdRun">Re-check difficulty</button></div></div>` : ''}`;
      const btn = $('#kdRun');
      if (btn) btn.onclick = async () => {
        btn.disabled = true; btn.textContent = 'Reading Google…';
        const r = await send('checkDifficulty', { keyword: m.keyword, ...geo() });
        if (r.error) { btn.disabled = false; btn.textContent = 'Check difficulty'; toast(r.message || r.error); if (r.error === 'captcha') btn.insertAdjacentHTML('afterend', `<div class="small" style="color:var(--bad)">${esc(r.message)}</div>`); return; }
        current = { ...current, difficulty: r };
        if (metrics[m.keyword]) metrics[m.keyword].difficulty = r;
        drawMain(); drawIdeas();
      };
    };

    const drawIdeas = () => {
      const box = $('#kwIdeas');
      if (!ideas.length) { box.innerHTML = ''; return; }
      const list = (ideaFilter === 'questions' ? questions : ideas);
      const scored = list.filter((k) => metrics[k] && !metrics[k].error);
      const sorted = [...list].sort((a, b) => (metrics[b]?.demand ?? -1) - (metrics[a]?.demand ?? -1));
      box.innerHTML = `<div class="card"><h3>Keyword ideas <span class="sub">${ideas.length} from Google autocomplete · ${scored.length} scored</span></h3>
        <div class="toolbar">
          <div class="seg" id="ideaSeg"><button data-f="all" class="${ideaFilter === 'all' ? 'on' : ''}">All ${ideas.length}</button><button data-f="questions" class="${ideaFilter === 'questions' ? 'on' : ''}">Questions ${questions.length}</button></div>
          <span class="spacer"></span>
          <button class="btn" id="scoreMore">Score next 40</button>
          <button class="btn" id="ideaCsv">CSV</button>
        </div>
        <div class="tbl-wrap"><table><thead><tr><th>Keyword</th><th class="num">Demand</th><th>Est. volume</th><th class="num">KD</th><th>Intent</th></tr></thead><tbody>
        ${sorted.slice(0, 600).map((k) => { const x = metrics[k]; return `<tr data-k="${esc(k)}" style="cursor:pointer">
          <td>${esc(k)}</td>
          <td class="num">${x && !x.error ? `<div class="bar" style="width:50px;display:inline-block;vertical-align:middle"><i style="width:${x.demand}%"></i></div> ${x.demand}` : '<span class="muted">…</span>'}</td>
          <td>${x && !x.error ? `<span class="pill ${tierCls(x.demand)}">${esc(x.range)}</span>` : ''}</td>
          <td class="num">${x?.difficulty ? `<span class="pill ${kdCls(x.difficulty.kd)}">${x.difficulty.kd}</span>` : '<span class="muted">—</span>'}</td>
          <td class="small">${x ? esc(x.intent) : ''}</td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="small muted" style="margin-top:6px">Click a keyword to analyze it. Idea scores use the autocomplete signal only (fast); “Analyze” adds Wikipedia and cross-platform signals.</div></div>`;
      $('#ideaSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; ideaFilter = b.dataset.f; drawIdeas(); };
      box.querySelector('tbody').onclick = (e) => { const tr = e.target.closest('tr[data-k]'); if (!tr) return; $('#kwSeed').value = tr.dataset.k; analyze(); };
      $('#scoreMore').onclick = () => scoreIdeas();
      $('#ideaCsv').onclick = () => download(`keywords_${current.keyword.replace(/\W+/g, '_')}.csv`, toCSV(ideas.map((k) => ({
        keyword: k, demand_score: metrics[k]?.demand ?? '', est_monthly_range: metrics[k]?.range ?? '', kd: metrics[k]?.difficulty?.kd ?? '', intent: metrics[k]?.intent ?? '', question: questions.includes(k) ? 'yes' : ''
      }))), 'text/csv');
    };

    let scoring = false;
    const scoreIdeas = async () => {
      if (scoring) return;
      const list = (ideaFilter === 'questions' ? questions : ideas).filter((k) => !metrics[k]).slice(0, 40);
      if (!list.length) { toast('All ideas scored'); return; }
      scoring = true;
      const res = await send('keywordMetricsMany', { keywords: list, ...geo() });
      Object.assign(metrics, res);
      scoring = false;
      drawIdeas();
    };

    const analyze = async () => {
      const kw = $('#kwSeed').value.trim();
      if (!kw) return;
      localStorage.setItem('openseo_geo', JSON.stringify(geo()));
      $('#kwMain').innerHTML = '<div class="empty"><div class="spinner" style="margin:0 auto 10px"></div>Measuring demand signals…</div>';
      const [m, idea] = await Promise.all([send('keywordMetrics', { keyword: kw, ...geo() }), send('keywordIdeas', { seed: kw, ...geo() })]);
      current = m;
      ideas = idea.ideas?.map((i) => i.keyword) || [];
      questions = idea.questions || [];
      ideaFilter = 'all';
      drawMain();
      drawIdeas();
      scoreIdeas();
    };
    $('#kwGo').onclick = analyze;
    $('#kwSeed').onkeydown = (e) => { if (e.key === 'Enter') analyze(); };
  },

  links(el) {
    const d = state.data;
    let filter = 'all', q = '';
    const ext = d.links.filter((l) => l.type === 'external');
    const domains = {};
    ext.forEach((l) => { domains[l.host] = (domains[l.host] || 0) + 1; });
    const topDomains = Object.entries(domains).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const count = (f) => d.links.filter(f).length;
    el.innerHTML = `
      <div class="grid g6" style="margin-bottom:12px">
        <div class="stat"><div class="v">${d.links.length}</div><div class="l">Total</div></div>
        <div class="stat"><div class="v">${count((l) => l.type === 'internal')}</div><div class="l">Internal</div></div>
        <div class="stat"><div class="v">${ext.length}</div><div class="l">External</div></div>
        <div class="stat"><div class="v">${count((l) => l.nofollow)}</div><div class="l">Nofollow</div></div>
        <div class="stat"><div class="v">${count((l) => l.sponsored || l.ugc)}</div><div class="l">Sponsored/UGC</div></div>
        <div class="stat"><div class="v">${Object.keys(domains).length}</div><div class="l">Ext. domains</div></div>
      </div>
      <div class="toolbar">
        <div class="seg" id="linkSeg">
          ${['all', 'internal', 'external', 'nofollow', 'dofollow-ext', 'broken'].map((f) => `<button data-f="${f}" class="${f === 'all' ? 'on' : ''}">${f}</button>`).join('')}
        </div>
        <input type="search" id="linkQ" placeholder="Filter URL or anchor…">
        <span class="spacer"></span>
        <button class="btn primary" id="checkLinks">Check status</button>
        <button class="btn" id="hlLinks">Highlight</button>
        <button class="btn" id="csvLinks">CSV</button>
      </div>
      <div class="tbl-wrap"><table><thead><tr><th>#</th><th>Anchor</th><th>URL</th><th>Type</th><th>Rel</th><th>Status</th></tr></thead><tbody id="linkBody"></tbody></table></div>
      ${topDomains.length ? `<div class="card" style="margin-top:12px"><h3>Top linked domains</h3>${topDomains.map(([h, c]) => `<div style="display:flex;gap:8px;align-items:center;margin:3px 0"><span style="width:220px" class="mono">${esc(h)}</span><div class="bar" style="flex:1"><i style="width:${(c / topDomains[0][1]) * 100}%"></i></div><span class="num" style="width:30px">${c}</span></div>`).join('')}</div>` : ''}`;
    const body = $('#linkBody');
    const statusCell = (u) => {
      const s = state.linkStatus[u];
      if (!s) return '<span class="muted">—</span>';
      const cls = s.status === 0 || s.status >= 400 ? 'bad' : s.redirected || (s.status >= 300 && s.status < 400) ? 'warn' : 'good';
      return `<span class="pill ${cls}" title="${esc(s.error || s.finalUrl || '')}">${s.status || s.error || 'err'}${s.redirected ? ' →' : ''}</span>`;
    };
    const draw = () => {
      const list = d.links.filter((l) => {
        if (filter === 'internal' && l.type !== 'internal') return false;
        if (filter === 'external' && l.type !== 'external') return false;
        if (filter === 'nofollow' && !l.nofollow && !l.sponsored && !l.ugc) return false;
        if (filter === 'dofollow-ext' && (l.type !== 'external' || l.nofollow || l.sponsored || l.ugc)) return false;
        if (filter === 'broken') { const s = state.linkStatus[l.url]; if (!s || (s.status > 0 && s.status < 400)) return false; }
        if (q && !(l.url + ' ' + l.text).toLowerCase().includes(q)) return false;
        return true;
      });
      body.innerHTML = list.slice(0, 1000).map((l, i) => `<tr>
        <td class="num muted">${i + 1}</td>
        <td>${esc(l.text) || '<i class="muted">(no text)</i>'}</td>
        <td class="url">${/^https?:/.test(l.url) ? linkTo(l.url) : esc(l.url)}</td>
        <td>${l.type}</td>
        <td>${l.rel.map((r) => `<span class="pill ${/nofollow|sponsored|ugc/.test(r) ? 'bad' : ''}">${esc(r)}</span>`).join(' ') || '<span class="muted">dofollow</span>'}</td>
        <td>${statusCell(l.url)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No links match.</td></tr>';
    };
    draw();
    $('#linkSeg').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      filter = b.dataset.f;
      el.querySelectorAll('#linkSeg button').forEach((x) => x.classList.toggle('on', x === b));
      draw();
    };
    $('#linkQ').oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
    $('#checkLinks').onclick = async (e) => {
      const btn = e.target; btn.disabled = true; btn.textContent = 'Checking…';
      const urls = d.links.filter((l) => /^https?:/.test(l.url)).map((l) => l.url.split('#')[0]);
      const res = await send('checkLinks', { urls });
      // map back including fragments
      d.links.forEach((l) => { const k = l.url.split('#')[0]; if (res[k]) state.linkStatus[l.url] = res[k]; });
      const broken = Object.values(res).filter((s) => !s.status || s.status >= 400).length;
      btn.disabled = false; btn.textContent = 'Check status';
      toast(`${Object.keys(res).length} URLs checked · ${broken} broken`);
      draw();
    };
    $('#hlLinks').onclick = async () => {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: state.tab.id }, files: ['content/highlight.js'] });
      toast(r.result === 'on' ? 'Links highlighted on page' : 'Highlight removed');
    };
    $('#csvLinks').onclick = () => download(`links_${slug()}.csv`, toCSV(d.links.map((l) => ({
      anchor: l.text, url: l.url, type: l.type, rel: l.rel.join(' '), status: state.linkStatus[l.url]?.status ?? ''
    }))), 'text/csv');
  },

  images(el) {
    const d = state.data;
    let filter = 'all';
    const noAlt = d.images.filter((i) => i.alt === null).length;
    const emptyAlt = d.images.filter((i) => i.alt === '').length;
    const total = d.images.reduce((a, i) => a + (i.bytes || 0), 0);
    el.innerHTML = `
      <div class="grid g6" style="margin-bottom:12px">
        <div class="stat"><div class="v">${d.images.length}</div><div class="l">Images</div></div>
        <div class="stat"><div class="v">${noAlt}</div><div class="l">No alt</div></div>
        <div class="stat"><div class="v">${emptyAlt}</div><div class="l">Empty alt</div></div>
        <div class="stat"><div class="v">${d.images.filter((i) => i.loading === 'lazy').length}</div><div class="l">Lazy</div></div>
        <div class="stat"><div class="v">${d.images.filter((i) => !i.width || !i.height).length}</div><div class="l">No dims</div></div>
        <div class="stat"><div class="v">${fmtBytes(total)}</div><div class="l">Weight</div></div>
      </div>
      <div class="toolbar">
        <div class="seg" id="imgSeg">${['all', 'no alt', 'empty alt', 'no dims', 'heavy'].map((f) => `<button data-f="${f}" class="${f === 'all' ? 'on' : ''}">${f}</button>`).join('')}</div>
        <span class="spacer"></span><button class="btn" id="csvImgs">CSV</button>
      </div>
      <div class="tbl-wrap"><table><thead><tr><th></th><th>Alt</th><th>Src</th><th class="num">Natural</th><th class="num">Shown</th><th class="num">Size</th><th>Attrs</th></tr></thead><tbody id="imgBody"></tbody></table></div>`;
    const draw = () => {
      const list = d.images.filter((i) =>
        filter === 'all' ? true : filter === 'no alt' ? i.alt === null : filter === 'empty alt' ? i.alt === '' : filter === 'no dims' ? !i.width || !i.height : (i.bytes || 0) > 150 * 1024);
      $('#imgBody').innerHTML = list.slice(0, 500).map((i) => `<tr>
        <td>${i.src ? `<img class="thumb" src="${esc(i.src)}" loading="lazy" alt="">` : ''}</td>
        <td>${i.alt === null ? '<span class="pill bad">missing</span>' : i.alt === '' ? '<span class="pill warn">empty</span>' : esc(i.alt)}</td>
        <td class="url">${i.src ? linkTo(i.src, i.src.split('/').pop().slice(0, 60) || i.src) : '—'}</td>
        <td class="num">${i.naturalW}×${i.naturalH}</td>
        <td class="num">${i.renderedW}×${i.renderedH}</td>
        <td class="num">${fmtBytes(i.bytes)}</td>
        <td>${[i.format, i.loading, i.srcset ? 'srcset' : '', i.width && i.height ? '' : 'no-dims'].filter(Boolean).map((t) => `<span class="pill">${esc(t)}</span>`).join(' ')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No images match.</td></tr>';
    };
    draw();
    $('#imgSeg').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      filter = b.dataset.f; el.querySelectorAll('#imgSeg button').forEach((x) => x.classList.toggle('on', x === b)); draw();
    };
    $('#csvImgs').onclick = () => download(`images_${slug()}.csv`, toCSV(d.images.map((i) => ({
      src: i.src, alt: i.alt ?? '(missing)', natural: `${i.naturalW}x${i.naturalH}`, rendered: `${i.renderedW}x${i.renderedH}`, bytes: i.bytes ?? '', loading: i.loading ?? ''
    }))), 'text/csv');
  },

  schema(el) {
    const s = state.data.schema;
    const url = state.data.basics.url;
    el.innerHTML = `
      <div class="toolbar">
        <a class="btn" target="_blank" href="https://search.google.com/test/rich-results?url=${encodeURIComponent(url)}">Google Rich Results test ↗</a>
        <a class="btn" target="_blank" href="https://validator.schema.org/#url=${encodeURIComponent(url)}">Schema.org validator ↗</a>
      </div>
      <div class="card"><h3>JSON-LD <span class="sub">${s.jsonld.length} block(s)</span></h3>
        ${s.jsonld.length ? s.jsonld.map((j, i) => `<details ${i === 0 ? 'open' : ''} style="margin-top:6px">
          <summary>${j.valid ? j.types.map((t) => `<span class="pill info">${esc(t)}</span>`).join(' ') || '<span class="pill">untyped</span>' : '<span class="pill bad">Invalid JSON</span>'}</summary>
          <pre class="json">${esc(j.valid ? JSON.stringify(j.data, null, 2) : j.error + '\n\n' + j.raw)}</pre></details>`).join('') : '<div class="muted">No JSON-LD found.</div>'}
      </div>
      <div class="row">
        <div class="card"><h3>Microdata</h3>${s.microdata.length ? s.microdata.map((t) => `<div class="mono">${esc(t)}</div>`).join('') : '<div class="muted">None</div>'}</div>
        <div class="card"><h3>RDFa</h3>${s.rdfa.length ? s.rdfa.map((t) => `<div class="mono">${esc(t)}</div>`).join('') : '<div class="muted">None</div>'}</div>
      </div>`;
  },

  social(el) {
    const { og, twitter } = state.data.social;
    const b = state.data.basics;
    const t = pixelTrim(b.title || '(no title)', 580, '20px Arial');
    const desc = b.description || '(Google will pick a snippet from the page text)';
    const dTrim = desc.length > 158 ? desc.slice(0, 155).trimEnd() + ' …' : desc;
    let crumbs = '';
    try { const u = new URL(b.url); crumbs = u.hostname + (u.pathname !== '/' ? ' › ' + u.pathname.split('/').filter(Boolean).slice(0, 3).join(' › ') : ''); } catch {}
    const img = og['og:image'] || twitter['twitter:image'];
    const tags = { ...og, ...twitter };
    el.innerHTML = `
      <div class="card"><h3>Google result preview <span class="sub">title ≈ ${t.px}px / 580px ${t.cut ? '<span class="pill warn">truncated</span>' : '<span class="pill good">fits</span>'}</span></h3>
        <div class="serp">
          <div class="site">${b.favicon ? `<img src="${esc(b.favicon)}" alt="">` : '<img alt="">'}<div><div>${esc(og['og:site_name'] || new URL(b.url).hostname)}</div><div class="muted small">${esc(crumbs)}</div></div></div>
          <div class="t">${esc(t.text)}</div>
          <div class="d">${esc(dTrim)}</div>
        </div>
      </div>
      <div class="row">
        <div class="card"><h3>Facebook / LinkedIn</h3>
          <div class="og-card"><div class="img" style="background-image:url('${esc(img || '')}')">${img ? '' : '<div class="empty">no og:image</div>'}</div>
          <div class="meta"><div class="muted small">${esc((() => { try { return new URL(og['og:url'] || b.url).hostname.toUpperCase(); } catch { return ''; } })())}</div>
          <div class="h">${esc(og['og:title'] || b.title || '')}</div><div class="muted small">${esc((og['og:description'] || b.description || '').slice(0, 120))}</div></div></div>
        </div>
        <div class="card"><h3>X / Twitter <span class="sub">${esc(twitter['twitter:card'] || 'no card')}</span></h3>
          <div class="og-card"><div class="img" style="background-image:url('${esc(twitter['twitter:image'] || img || '')}')"></div>
          <div class="meta"><div class="h">${esc(twitter['twitter:title'] || og['og:title'] || b.title || '')}</div><div class="muted small">${esc((twitter['twitter:description'] || og['og:description'] || '').slice(0, 120))}</div></div></div>
        </div>
      </div>
      <div class="card"><h3>All social tags <span class="sub">${Object.keys(tags).length}</span></h3>
        ${Object.keys(tags).length ? `<table><tbody>${Object.entries(tags).map(([k, v]) => `<tr><td class="mono" style="width:180px">${esc(k)}</td><td class="url">${/^https?:/.test(v) ? linkTo(v) : esc(v)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">No Open Graph or Twitter tags.</div>'}
      </div>`;
  },

  async technical(el) {
    const d = state.data, b = d.basics, t = d.technical, n = state.net;
    const origin = new URL(b.url).origin;
    const hdrs = n?.final?.headers || {};
    const chain = n ? [...n.chain, n.final ? { url: n.final.url, status: n.final.status } : null].filter(Boolean) : [];
    const secHeaders = ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy'];
    el.innerHTML = `
      <div class="row">
        <div class="card"><h3>HTTP <span class="sub">${n?.stale ? 'data from previous navigation — reload page' : ''}</span></h3>
          ${n?.final ? `<dl class="kv">
            <dt>Status</dt><dd><span class="pill ${n.final.status >= 400 ? 'bad' : 'good'}">${esc(n.final.statusLine || n.final.status)}</span></dd>
            <dt>Server</dt><dd>${esc(hdrs.server || '—')}</dd>
            <dt>IP</dt><dd class="mono">${esc(n.final.ip || '—')}</dd>
            <dt>Protocol</dt><dd>${esc(t.httpProtocol || '—')}</dd>
            <dt>Response time</dt><dd>${n.final.ms != null ? n.final.ms + ' ms' : '—'}${n.final.fromCache ? ' (cache)' : ''}</dd>
            <dt>Compression</dt><dd>${esc(hdrs['content-encoding'] || 'none')}</dd>
            <dt>X-Robots-Tag</dt><dd>${esc(hdrs['x-robots-tag'] || '—')}</dd>
          </dl>` : '<div class="muted">Reload the page with the extension installed to capture HTTP status, headers and redirects.</div>'}
        </div>
        <div class="card"><h3>Redirect chain</h3>
          ${chain.length ? chain.map((c, i) => `<div style="display:flex;gap:8px;margin:4px 0"><span class="pill ${c.status >= 400 ? 'bad' : c.status >= 300 ? 'warn' : 'good'}">${c.status}</span><span class="mono">${esc(c.url)}</span></div>${i < chain.length - 1 ? '<div class="muted" style="padding-left:14px">↓</div>' : ''}`).join('') : '<div class="muted">—</div>'}
        </div>
      </div>
      <div class="row">
        <div class="card"><h3>robots.txt</h3><div id="robotsBox" class="muted">Loading…</div></div>
        <div class="card"><h3>Sitemaps</h3><div id="sitemapBox" class="muted">Loading…</div></div>
      </div>
      <div class="card"><h3>Security headers</h3>
        <div class="counts">${secHeaders.map((h) => `<span class="pill ${hdrs[h] ? 'good' : 'bad'}" title="${esc(hdrs[h] || 'missing')}">${hdrs[h] ? '✓' : '✗'} ${h}</span>`).join('')}</div>
      </div>
      <div class="card"><h3>Page resources <span class="sub">${t.requests} requests · ${fmtBytes(t.totalBytes)} transferred</span></h3>
        <div class="grid">${Object.entries(t.byType).sort((a, b2) => b2[1].bytes - a[1].bytes).map(([k, v]) => `<div class="stat"><div class="v" style="font-size:15px">${fmtBytes(v.bytes)}</div><div class="l">${esc(k)} · ${v.count}</div></div>`).join('')}</div>
        <dl class="kv" style="margin-top:10px">
          <dt>DOM nodes</dt><dd>${fmtNum(t.domNodes)}</dd>
          <dt>Scripts</dt><dd>${t.scripts} (${t.externalScripts} external, ${t.renderBlockingScripts} render-blocking)</dd>
          <dt>Stylesheets</dt><dd>${t.stylesheets} · inline CSS ${fmtBytes(t.inlineStyleBytes)}</dd>
          <dt>DOMContentLoaded</dt><dd>${t.domContentLoadedMs != null ? t.domContentLoadedMs + ' ms' : '—'}</dd>
          <dt>Load</dt><dd>${t.loadMs ? t.loadMs + ' ms' : '—'}</dd>
          <dt>Iframes</dt><dd>${t.iframes.length ? t.iframes.map((s) => `<div class="mono">${esc(s)}</div>`).join('') : '0'}</dd>
          <dt>Mixed content</dt><dd>${t.mixedContent.length ? t.mixedContent.map((s) => `<div class="mono">${esc(s)}</div>`).join('') : '<span class="pill good">none</span>'}</dd>
        </dl>
      </div>
      <div class="card"><h3>Detected technology</h3>${t.tech.length ? `<div class="counts">${t.tech.map((x) => `<span class="pill info">${esc(x)}</span>`).join('')}</div>` : '<div class="muted">Nothing recognised.</div>'}
        ${b.generator ? `<div class="small muted" style="margin-top:6px">generator: ${esc(b.generator)}</div>` : ''}
        ${b.verification.length ? `<div class="small muted">verification tags: ${esc(b.verification.join(', '))}</div>` : ''}
      </div>
      ${b.hreflang.length ? `<div class="card"><h3>hreflang <span class="sub">${b.hreflang.length}</span></h3><table><tbody>${b.hreflang.map((h) => `<tr><td style="width:80px"><span class="pill">${esc(h.lang)}</span></td><td class="url">${linkTo(h.href)}</td></tr>`).join('')}</tbody></table>
        ${b.hreflang.some((h) => h.href.split('#')[0] === b.url.split('#')[0]) ? '' : '<div class="small" style="margin-top:6px"><span class="pill warn">no self-referencing hreflang</span></div>'}</div>` : ''}
      <div class="card"><h3>All response headers</h3>${Object.keys(hdrs).length ? `<table><tbody>${Object.entries(hdrs).map(([k, v]) => `<tr><td class="mono" style="width:200px">${esc(k)}</td><td class="mono">${esc(v)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">—</div>'}</div>`;

    // robots.txt + sitemaps
    const rob = await send('fetchText', { url: origin + '/robots.txt' });
    const box = $('#robotsBox');
    let sitemaps = [];
    if (rob.ok && !/<html/i.test(rob.text.slice(0, 500))) {
      const parsed = parseRobots(rob.text);
      sitemaps = parsed.sitemaps;
      const u = new URL(b.url);
      const path = u.pathname + u.search;
      const bots = ['Googlebot', 'Bingbot', 'GPTBot', 'CCBot', '*'];
      box.classList.remove('muted');
      box.innerHTML = `
        ${bots.map((bot) => { const r = isAllowed(parsed, bot, path); return `<div style="display:flex;justify-content:space-between;gap:8px;margin:3px 0"><span>${bot === '*' ? 'All bots (*)' : bot}</span><span>${r.rule ? `<span class="mono muted small">${esc(r.rule)}</span> ` : ''}<span class="pill ${r.allowed ? 'good' : 'bad'}">${r.allowed ? 'allowed' : 'blocked'}</span></span></div>`; }).join('')}
        <details style="margin-top:6px"><summary class="small">View robots.txt (${fmtBytes(rob.text.length)})</summary><pre class="json">${esc(rob.text.slice(0, 20000))}</pre></details>`;
    } else {
      box.innerHTML = `<span class="pill warn">No robots.txt (${rob.status || rob.error})</span> — everything is crawlable by default.`;
    }
    if (!sitemaps.length) sitemaps = [origin + '/sitemap.xml'];
    const smBox = $('#sitemapBox');
    const rows = [];
    for (const sm of sitemaps.slice(0, 5)) {
      const r = await send('fetchText', { url: sm });
      const isXml = r.ok && /<(urlset|sitemapindex)/i.test(r.text || '');
      const urls = isXml ? (r.text.match(/<loc>/gi) || []).length : 0;
      const kind = isXml ? (/<sitemapindex/i.test(r.text) ? 'index' : 'urlset') : '';
      rows.push(`<div style="margin:4px 0"><span class="pill ${isXml ? 'good' : 'bad'}">${isXml ? `${kind} · ${urls} locs` : r.ok ? 'not a sitemap' : r.status ? 'HTTP ' + r.status : 'error'}</span> ${linkTo(sm)}</div>`);
    }
    smBox.classList.remove('muted');
    smBox.innerHTML = rows.join('');
  },

  speed(el) {
    const v = state.data.vitals || {};
    const rate = (val, good, poor) => (val == null ? '' : val <= good ? 'good' : val <= poor ? 'warn' : 'bad');
    const tile = (label, val, fmt, good, poor, hint) => `<div class="stat vital ${rate(val, good, poor)}"><div class="v">${val == null ? '—' : fmt(val)}</div><div class="l">${label}</div><div class="small muted">${hint}</div></div>`;
    const s = (ms) => (ms / 1000).toFixed(2) + 's';
    el.innerHTML = `
      <div class="card"><h3>Your visit — real measurements <span class="sub">from this tab, measured by your browser</span></h3>
        <div class="grid g3">
          ${tile('LCP', v.lcp, s, 2500, 4000, 'Largest Contentful Paint')}
          ${tile('CLS', v.cls, (x) => x.toFixed(3), 0.1, 0.25, 'Cumulative Layout Shift')}
          ${tile('INP', v.inp, (x) => x + 'ms', 200, 500, v.inp == null ? 'interact with the page first' : 'Interaction to Next Paint')}
          ${tile('FCP', v.fcp, s, 1800, 3000, 'First Contentful Paint')}
          ${tile('TTFB', v.ttfb, (x) => x + 'ms', 800, 1800, 'Time to First Byte')}
          ${tile('TBT*', v.tbt, (x) => Math.round(x) + 'ms', 200, 600, `${v.longTasks || 0} long tasks`)}
        </div>
        ${v.lcpEl ? `<div class="small muted" style="margin-top:8px">LCP element: <span class="mono">${esc(v.lcpEl)}</span></div>` : ''}
      </div>
      <div class="card"><h3>Lighthouse lab test <span class="sub">via Google PageSpeed · ~20–60s</span></h3>
        <div class="toolbar">
          <button class="btn primary" data-s="mobile">Run mobile</button><button class="btn" data-s="desktop">Run desktop</button>
          <span class="spacer"></span>
          <a class="btn" id="psiWeb" target="_blank" rel="noopener">Open on pagespeed.web.dev ↗</a>
        </div>
        <div id="psiOut" class="muted small">Only public URLs can be tested. Results are cached for 12 hours.</div>
      </div>`;
    const psiWeb = (strategy = 'mobile') => `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(state.data.basics.url)}&form_factor=${strategy}`;
    $('#psiWeb').href = psiWeb();
    el.querySelectorAll('[data-s]').forEach((btn) => (btn.onclick = async (ev) => {
      const out = $('#psiOut');
      const strategy = btn.dataset.s;
      $('#psiWeb').href = psiWeb(strategy);
      el.querySelectorAll('[data-s]').forEach((b2) => (b2.disabled = true));
      out.innerHTML = '<div class="spinner" style="margin:10px auto"></div><div style="text-align:center">Running Lighthouse…</div>';
      const r = await send('pageSpeed', { url: state.data.basics.url, strategy, fresh: ev.shiftKey });
      el.querySelectorAll('[data-s]').forEach((b2) => (b2.disabled = false));
      if (r.error) {
        out.classList.remove('muted');
        const web = `<a class="btn primary" href="${esc(psiWeb(strategy))}" target="_blank" rel="noopener">Run it on pagespeed.web.dev ↗</a>`;
        const settings = '<button class="btn" id="psiSettings">Add your own key in Settings</button>';
        const msg = {
          quota: r.usedKey
            ? `<b>Your API key's daily quota is used up.</b> It resets at midnight Pacific time. You can still run the test on Google's website, free and with no sign-in.`
            : `<b>Google's free shared quota is used up for today.</b> Without an API key, everyone calling PageSpeed shares one daily allowance, and it has run out. It resets at midnight Pacific time.<br><br>You can still run the same test on Google's website, free and with no sign-in, or add your own free API key to get a private quota.`,
          key: `<b>Google rejected your PageSpeed API key.</b> Check it in Settings, or that the PageSpeed Insights API is enabled for it. Clear the key to fall back to the shared quota.`,
          page: `<b>Lighthouse couldn't load this page.</b> It only tests public URLs. Pages behind a login, on localhost, or that block Google's servers can't be tested.`,
          network: `<b>${esc(r.error)}</b>`,
          other: `<b>PageSpeed returned an error.</b>`
        }[r.kind || 'other'];
        out.innerHTML = `<div class="small" style="margin-bottom:8px">${msg}</div>
          <div class="toolbar" style="margin:0">${web}${r.kind === 'quota' && !r.usedKey || r.kind === 'key' ? settings : ''}</div>
          <details style="margin-top:6px"><summary class="small muted">Error from Google</summary><pre class="json">${esc(r.error)}</pre></details>`;
        const s = $('#psiSettings'); if (s) s.onclick = () => chrome.runtime.openOptionsPage();
        return;
      }
      const sc = (x) => (x >= 90 ? 'good' : x >= 50 ? 'warn' : 'bad');
      out.classList.remove('muted');
      out.innerHTML = `
        <div class="grid" style="margin-bottom:10px">${Object.entries(r.scores).map(([k, x]) => `<div class="stat vital ${sc(x)}"><div class="v">${x}</div><div class="l">${esc(k)}</div></div>`).join('')}</div>
        <table><tbody>${Object.values(r.lab).filter(Boolean).map((a) => `<tr><td>${esc(a.title)}</td><td class="num"><span class="pill ${sc((a.score || 0) * 100)}">${esc(a.value)}</span></td></tr>`).join('')}</tbody></table>
        ${Object.keys(r.field).length ? `<h4>Field data (Chrome UX Report, p75)</h4><div class="counts">${Object.entries(r.field).map(([k, f]) => `<span class="pill ${f.category === 'FAST' ? 'good' : f.category === 'AVERAGE' ? 'warn' : 'bad'}">${esc(k.replace(/_/g, ' ').toLowerCase())}: ${f.p75}</span>`).join('')}</div>` : '<p class="muted">No real-user field data for this URL.</p>'}
        ${r.opportunities.length ? `<h4>Opportunities</h4><ul>${r.opportunities.map((o) => `<li>${esc(o.title)} <span class="muted">${esc(o.value)}</span></li>`).join('')}</ul>` : ''}
        ${r.cachedAt ? `<div class="small muted">Saved result from ${esc(new Date(r.cachedAt).toLocaleString())}. Shift-click Run to test again.</div>` : ''}`;
    }));
  },

  async backlinks(el) {
    const pageUrl = state.data.basics.url;
    const domain = new URL(pageUrl).hostname.replace(/^www\./, '');
    let scope = 'domain', filter = 'all', q = '', data = null;
    const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    const norm = (u) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') + x.search).toLowerCase(); } catch { return String(u).toLowerCase(); } };
    el.innerHTML = `
      <div class="toolbar">
        <div class="seg" id="blScope"><button data-s="domain" class="on">Whole domain</button><button data-s="url">This URL only</button></div>
        <span class="spacer"></span>
        <button class="btn primary" id="blVerify" disabled>Verify links</button>
        <button class="btn" id="blRefresh">Refresh</button>
        <button class="btn" id="blCsv" disabled>CSV</button>
      </div>
      <div id="blBody"><div class="empty"><div class="spinner" style="margin:0 auto 10px"></div>Searching public link sources for <b>${esc(domain)}</b>…</div></div>`;
    const body = $('#blBody');

    const scoped = () => (data?.items || []).filter((i) => scope === 'domain' || norm(i.target) === norm(pageUrl));
    const draw = () => {
      const items = scoped();
      const refDomains = {};
      items.forEach((i) => { const h = hostOf(i.refUrl); (refDomains[h] ||= []).push(i); });
      const live = items.filter((i) => i.verified === 'live');
      const follow = live.filter((i) => !/nofollow|sponsored|ugc/.test(i.rel || ''));
      const verifiedCount = items.filter((i) => i.verified).length;
      const bySource = {};
      items.forEach((i) => { bySource[i.source] = (bySource[i.source] || 0) + 1; });
      const anchors = {};
      items.forEach((i) => { if (i.anchor) anchors[i.anchor] = (anchors[i.anchor] || 0) + 1; });
      const topAnchors = Object.entries(anchors).sort((a, b) => b[1] - a[1]).slice(0, 15);
      const topRef = Object.entries(refDomains).sort((a, b) => b[1].length - a[1].length).slice(0, 12);
      const dates = items.map((i) => i.date).filter(Boolean).sort();
      const list = items.filter((i) => {
        if (filter === 'live' && i.verified !== 'live') return false;
        if (filter === 'lost' && i.verified !== 'lost') return false;
        if (filter === 'dofollow' && (i.verified !== 'live' || /nofollow|sponsored|ugc/.test(i.rel || ''))) return false;
        if (filter !== 'all' && filter !== 'live' && filter !== 'lost' && filter !== 'dofollow' && i.source !== filter) return false;
        if (q && !(i.refUrl + ' ' + (i.refTitle || '') + ' ' + (i.anchor || '') + ' ' + i.target).toLowerCase().includes(q)) return false;
        return true;
      });
      const vPill = (i) => !i.verified ? '<span class="muted">—</span>'
        : i.verified === 'live' ? '<span class="pill good">live</span>'
        : i.verified === 'lost' ? '<span class="pill bad" title="Page loads but no longer links to you">lost</span>'
        : `<span class="pill warn" title="${esc(i.verifyError || '')}">unreachable</span>`;
      body.innerHTML = `
        <div class="grid g6" style="margin-bottom:12px">
          <div class="stat"><div class="v">${fmtNum(items.length)}</div><div class="l">Backlinks found</div></div>
          <div class="stat"><div class="v">${fmtNum(Object.keys(refDomains).length)}</div><div class="l">Ref. domains</div></div>
          <div class="stat"><div class="v">${verifiedCount ? fmtNum(live.length) : '—'}</div><div class="l">Verified live</div></div>
          <div class="stat"><div class="v">${verifiedCount ? fmtNum(follow.length) : '—'}</div><div class="l">Dofollow</div></div>
          <div class="stat"><div class="v">${dates[0] ? dates[0].slice(0, 4) : '—'}</div><div class="l">Oldest found</div></div>
          <div class="stat"><div class="v">${dates.length ? dates[dates.length - 1].slice(0, 7) : '—'}</div><div class="l">Newest found</div></div>
        </div>
        <div class="card"><h3>Sources <span class="sub">fetched ${esc((data.fetchedAt || '').replace('T', ' ').slice(0, 16))} UTC · cached 24h</span></h3>
          <div class="counts">${Object.entries(data.status).map(([k, s]) => `<span class="pill ${s.ok ? (s.count ? 'good' : '') : 'bad'}" title="${esc(s.error || '')}">${esc(k)}: ${s.ok ? s.count : 'failed'}</span>`).join('')}</div>
        </div>
        <div class="toolbar">
          <div class="seg" id="blSeg">${['all', 'live', 'dofollow', 'lost', ...Object.keys(bySource)].map((f) => `<button data-f="${esc(f)}" class="${f === filter ? 'on' : ''}">${esc(f)}${bySource[f] ? ' ' + bySource[f] : ''}</button>`).join('')}</div>
          <input type="search" id="blQ" placeholder="Filter…" value="${esc(q)}">
        </div>
        <div class="tbl-wrap"><table><thead><tr><th>Referring page</th><th>Anchor / target</th><th>Rel</th><th>Source</th><th>Date</th><th>Status</th></tr></thead><tbody>
        ${list.slice(0, 1500).map((i) => `<tr>
          <td class="url"><div>${linkTo(i.refUrl, i.refTitle || i.refUrl)}</div><div class="muted small">${esc(hostOf(i.refUrl))}${i.score != null ? ` · ${i.score} pts` : ''}</div></td>
          <td class="url"><div>${esc(i.anchor || '')}</div><div class="muted small mono">${esc(i.target)}</div></td>
          <td>${i.rel ? `<span class="pill ${/nofollow|sponsored|ugc/.test(i.rel) ? 'bad' : 'good'}">${esc(i.rel)}</span>` : '<span class="muted">?</span>'}</td>
          <td><span class="pill">${esc(i.source)}</span></td>
          <td class="num">${esc((i.date || '').slice(0, 10))}</td>
          <td>${vPill(i)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${items.length ? 'No backlinks match this filter.' : scope === 'url' ? 'No backlinks found to this exact URL — try “Whole domain”.' : 'No backlinks found in the public sources.'}</td></tr>`}
        </tbody></table></div>
        <div class="row" style="margin-top:12px">
          <div class="card"><h3>Top referring domains</h3>${topRef.length ? topRef.map(([h, l]) => `<div style="display:flex;gap:8px;align-items:center;margin:3px 0"><span style="width:170px" class="mono">${esc(h)}</span><div class="bar" style="flex:1"><i style="width:${(l.length / topRef[0][1].length) * 100}%"></i></div><span class="num" style="width:36px">${l.length}</span></div>`).join('') : '<div class="muted">—</div>'}</div>
          <div class="card"><h3>Anchor texts</h3>${topAnchors.length ? `<div class="counts">${topAnchors.map(([a, c]) => `<span class="pill" title="${c}×">${esc(a.slice(0, 50))} <b>${c}</b></span>`).join('')}</div>` : '<div class="muted">Run “Verify links” to collect anchor text.</div>'}</div>
        </div>
        <div class="card"><h3>Where this data comes from</h3><div class="small muted">
          All sources are public and need no account: Wikipedia’s external-link index (12 languages), Hacker News and Lobsters submissions and comments,
          and Stack Overflow posts that mention the domain. <b>Your browsing</b> holds links OpenSEO Lens saw on pages you visited, stored only in this browser
          (you can turn it off in Settings). <b>Verify links</b> opens each referring page and confirms the link, anchor text and rel attribute.
          This covers well-known public sources, not the whole web. For a complete list for a site you own, use Google Search Console.</div></div>`;
      $('#blSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.f; draw(); };
      $('#blQ').oninput = (e) => { q = e.target.value.toLowerCase(); const pos = e.target.selectionStart; draw(); const n = $('#blQ'); n.focus(); n.setSelectionRange(pos, pos); };
    };

    const load = async (fresh) => {
      body.innerHTML = `<div class="empty"><div class="spinner" style="margin:0 auto 10px"></div>Searching public link sources for <b>${esc(domain)}</b>…</div>`;
      data = await send('backlinks', { domain, fresh });
      if (data.error) { body.innerHTML = `<div class="empty"><span class="pill bad">${esc(data.error)}</span></div>`; return; }
      $('#blVerify').disabled = !data.items.length;
      $('#blCsv').disabled = !data.items.length;
      draw();
    };

    $('#blScope').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      scope = b.dataset.s; el.querySelectorAll('#blScope button').forEach((x) => x.classList.toggle('on', x === b));
      if (data) draw();
    };
    $('#blRefresh').onclick = () => load(true);
    $('#blCsv').onclick = () => download(`backlinks_${domain.replace(/\W+/g, '_')}.csv`, toCSV(scoped().map((i) => ({
      referring_page: i.refUrl, referring_title: i.refTitle || '', referring_domain: hostOf(i.refUrl), anchor: i.anchor || '', target: i.target,
      rel: i.rel || '', source: i.source, date: i.date || '', status: i.verified || ''
    }))), 'text/csv');

    // Verify: fetch each referring page and look for a link pointing at this domain.
    $('#blVerify').onclick = async (e) => {
      const btn = e.target;
      const todo = scoped().filter((i) => !i.verified || i.verified === 'error').slice(0, 150);
      if (!todo.length) { toast('Nothing left to verify'); return; }
      btn.disabled = true;
      let done = 0, idx = 0;
      const worker = async () => {
        while (idx < todo.length) {
          const i = todo[idx++];
          const r = await send('fetchText', { url: i.refUrl });
          if (!r.ok || !r.text) { i.verified = 'error'; i.verifyError = r.error || 'HTTP ' + r.status; }
          else {
            const doc = new DOMParser().parseFromString(r.text, 'text/html');
            const anchors = [...doc.querySelectorAll('a[href]')].filter((a) => {
              try { const h = new URL(a.getAttribute('href'), r.url || i.refUrl).hostname.replace(/^www\./, ''); return h === domain || h.endsWith('.' + domain); } catch { return false; }
            });
            const pick = anchors.find((a) => { try { return norm(new URL(a.getAttribute('href'), i.refUrl).href) === norm(i.target); } catch { return false; } }) || anchors[0];
            if (pick) {
              i.verified = 'live';
              i.anchor = (pick.textContent || pick.querySelector('img')?.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 150) || i.anchor || '[image]';
              const rel = (pick.getAttribute('rel') || '').toLowerCase().split(/\s+/).filter((x) => /nofollow|sponsored|ugc/.test(x)).join(' ');
              i.rel = rel || 'follow';
              try { i.target = new URL(pick.getAttribute('href'), i.refUrl).href; } catch {}
            } else i.verified = 'lost';
          }
          btn.textContent = `Verifying ${++done}/${todo.length}…`;
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      btn.disabled = false; btn.textContent = 'Verify links';
      toast(`${todo.filter((i) => i.verified === 'live').length} live · ${todo.filter((i) => i.verified === 'lost').length} lost`);
      draw();
    };
    load(false);
  },

  async domain(el) {
    const u = new URL(state.data.basics.url);
    const host = u.hostname;
    el.innerHTML = `
      <div class="grid" style="margin-bottom:12px">
        <div class="stat"><div class="v" id="dmRank">…</div><div class="l">Tranco rank</div></div>
        <div class="stat"><div class="v" id="dmAge">…</div><div class="l">Domain age</div></div>
        <div class="stat"><div class="v" id="dmWb">…</div><div class="l">First archived</div></div>
        <div class="stat"><div class="v" id="dmExp">…</div><div class="l">Expires</div></div>
      </div>
      <div class="row">
        <div class="card"><h3>Registration (RDAP)</h3><div id="dmRdap" class="muted">Loading…</div></div>
        <div class="card"><h3>Wayback Machine</h3><div id="dmWayback" class="muted">Loading…</div></div>
      </div>
      <div class="card"><h3>DNS <span class="sub">${esc(host)} via DNS-over-HTTPS</span></h3><div id="dmDns" class="muted">Loading…</div></div>
      <div class="card"><h3>About these numbers</h3><div class="small muted">
        Tranco is an open research ranking of the top ~1M sites (lower = more popular; “unranked” means outside the list).
        Backlink counts and traffic estimates need a web-scale crawler, which no free keyless source provides — use the
        free webmaster consoles in the Tools tab for your own sites.</div></div>`;
    const age = (iso) => {
      if (!iso) return '—';
      const ms = Date.now() - new Date(iso).getTime();
      const y = ms / (365.25 * 86400000);
      return y >= 1 ? y.toFixed(1) + ' yrs' : Math.round(y * 12) + ' mo';
    };
    send('trancoRank', { domain: host }).then((r) => {
      $('#dmRank').textContent = r.rank ? '#' + fmtNum(r.rank) : r.error ? 'n/a' : 'unranked';
      $('#dmRank').title = r.error || (r.date ? 'list date ' + r.date : '');
    });
    send('rdap', { domain: host }).then((r) => {
      $('#dmAge').textContent = age(r.registered);
      $('#dmExp').textContent = r.expires ? r.expires.slice(0, 10) : '—';
      const box = $('#dmRdap'); box.classList.remove('muted');
      box.innerHTML = r.error ? `<span class="pill warn">${esc(r.error)}</span><div class="small muted">Some ccTLDs don’t publish RDAP.</div>` : `<dl class="kv">
        <dt>Domain</dt><dd>${esc(r.domain)}</dd>
        <dt>Registered</dt><dd>${esc(r.registered?.slice(0, 10) || '—')}</dd>
        <dt>Updated</dt><dd>${esc(r.updated?.slice(0, 10) || '—')}</dd>
        <dt>Expires</dt><dd>${esc(r.expires?.slice(0, 10) || '—')}</dd>
        <dt>Registrar</dt><dd>${esc(r.registrar || '—')}</dd>
        <dt>Nameservers</dt><dd class="mono">${r.nameservers.map(esc).join('<br>') || '—'}</dd>
        <dt>Status</dt><dd class="small">${r.status.map(esc).join(', ') || '—'}</dd></dl>`;
    });
    send('wayback', { url: state.data.basics.url }).then((r) => {
      const ts = (t) => (t ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : '—');
      $('#dmWb').textContent = r.firstSeen ? r.firstSeen.slice(0, 4) : '—';
      const box = $('#dmWayback'); box.classList.remove('muted');
      box.innerHTML = `<dl class="kv">
        <dt>Site first seen</dt><dd>${ts(r.firstSeen)}</dd>
        <dt>This URL, latest</dt><dd>${r.latest ? linkTo(r.latest.url, ts(r.latest.timestamp)) : 'not archived'}</dd></dl>
        <div class="toolbar" style="margin-top:8px"><a class="btn" target="_blank" href="https://web.archive.org/web/*/${esc(host)}/*">Browse all captures ↗</a></div>`;
    });
    send('dns', { host }).then((r) => {
      const box = $('#dmDns'); box.classList.remove('muted');
      const rows = Object.entries(r).filter(([, v]) => v.length);
      box.innerHTML = rows.length ? `<table><tbody>${rows.map(([k, v]) => `<tr><td style="width:70px"><span class="pill">${k}</span></td><td class="mono">${v.map(esc).join('<br>')}</td></tr>`).join('')}</tbody></table>` : 'No records returned.';
    });
  },

  tools(el) {
    const b = state.data.basics;
    const u = new URL(b.url);
    const enc = encodeURIComponent(b.url);
    const host = u.hostname;
    const ext = [
      ['Pages indexed (site: search)', `https://www.google.com/search?q=site%3A${encodeURIComponent(host)}`],
      ['Who links here (link-text search)', `https://www.google.com/search?q=%22${encodeURIComponent(host)}%22+-site%3A${encodeURIComponent(host)}`],
      ['Rich Results test', `https://search.google.com/test/rich-results?url=${enc}`],
      ['PageSpeed Insights', `https://pagespeed.web.dev/analysis?url=${enc}`],
      ['W3C HTML validator', `https://validator.w3.org/nu/?doc=${enc}`],
      ['SSL Labs test', `https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(host)}&hideResults=on`],
      ['Security headers', `https://securityheaders.com/?q=${enc}&followRedirects=on`],
      ['Wayback history', `https://web.archive.org/web/*/${host}`],
      ['Google Trends (title)', `https://trends.google.com/trends/explore?q=${encodeURIComponent((state.data.content.twoWord[0] || state.data.content.oneWord[0] || { term: host }).term)}`]
    ];
    el.innerHTML = `
      <div class="row">
        <div class="card"><h3>Export</h3>
          <div class="toolbar">
            <button class="btn primary" id="expJson">Full report (JSON)</button>
            <button class="btn" id="expIssues">Issues (CSV)</button>
            <button class="btn" id="expMd">Summary (Markdown)</button>
            <button class="btn" id="copySummary">Copy summary</button>
          </div>
          <div class="small muted">Everything is generated locally from the page you are viewing.</div>
        </div>
        <div class="card"><h3>On-page tools</h3>
          <div class="toolbar">
            <button class="btn" id="tHl">Highlight links</button>
            <button class="btn" id="tOutline">Outline headings on page</button>
            <button class="btn" id="tNoJs">View source</button>
            <button class="btn" id="tClear">Clear cached domain data</button>
          </div>
        </div>
      </div>
      <div class="card"><h3>Free external checks <span class="sub">open in a new tab, no account needed</span></h3>
        <div class="links-list">${ext.map(([l, h]) => `<a href="${esc(h)}" target="_blank" rel="noopener">${esc(l)} ↗</a>`).join('')}</div>
      </div>
      </div>`;
    const summary = () => {
      const r = state.report, d = state.data;
      return [`# SEO report — ${b.url}`, `Score: ${r.score}/100 (${r.counts.error} errors, ${r.counts.warning} warnings, ${r.counts.notice} notices)`, '',
        `- Title (${(b.title || '').length}): ${b.title || '—'}`, `- Description (${(b.description || '').length}): ${b.description || '—'}`,
        `- H1: ${d.headings.list.filter((h) => h.level === 1).map((h) => h.text).join(' | ') || '—'}`, `- Canonical: ${b.canonical || '—'}`,
        `- Words: ${d.content.mainWordCount} · Links: ${d.links.length} · Images: ${d.images.length}`, '', '## Issues',
        ...r.issues.map((i) => `- [${i.severity}] ${i.category}: ${i.title}${i.detail ? ' — ' + i.detail.replace(/\n/g, '; ') : ''}`)].join('\n');
    };
    $('#expJson').onclick = () => download(`seo_${slug()}.json`, JSON.stringify({ ...state.data, net: state.net, audit: state.report }, null, 2), 'application/json');
    $('#expIssues').onclick = () => download(`issues_${slug()}.csv`, toCSV(state.report.issues), 'text/csv');
    $('#expMd').onclick = () => download(`seo_${slug()}.md`, summary(), 'text/markdown');
    $('#copySummary').onclick = () => { navigator.clipboard.writeText(summary()); toast('Summary copied'); };
    $('#tHl').onclick = async () => { await chrome.scripting.executeScript({ target: { tabId: state.tab.id }, files: ['content/highlight.js'] }); toast('Toggled'); };
    $('#tOutline').onclick = async () => {
      await chrome.scripting.executeScript({ target: { tabId: state.tab.id }, func: () => {
        const id = '__openseo_h_outline';
        const ex = document.getElementById(id); if (ex) { ex.remove(); return; }
        const s = document.createElement('style'); s.id = id;
        s.textContent = [1, 2, 3, 4, 5, 6].map((l) => `h${l}{outline:2px solid hsl(${l * 50},80%,50%)!important;position:relative}h${l}::before{content:"H${l}";position:absolute;left:-2px;top:-14px;font:700 10px monospace;background:hsl(${l * 50},80%,50%);color:#fff;padding:0 3px;z-index:2147483647}`).join('');
        document.documentElement.appendChild(s);
      } });
      toast('Toggled heading outlines');
    };
    $('#tNoJs').onclick = () => chrome.tabs.create({ url: 'view-source:' + b.url });
    $('#tClear').onclick = async () => { await send('clearCache'); toast('Cache cleared'); };
  }
};

run();
