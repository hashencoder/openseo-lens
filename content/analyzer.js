// OpenSEO Lens — on-page analyzer. Injected on demand by the popup; the value of the
// final expression is returned to chrome.scripting.executeScript.
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const meta = (name) => $(`meta[name="${name}" i]`)?.getAttribute('content')?.trim() ?? null;
  const prop = (p) => $(`meta[property="${p}" i]`)?.getAttribute('content')?.trim() ?? null;
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const host = location.hostname.replace(/^www\./, '');

  /* ---------------- Basics ---------------- */
  const basics = {
    url: location.href,
    title: document.title || null,
    titleCount: $$('head title').length,
    description: meta('description'),
    descriptionCount: $$('meta[name="description" i]').length,
    keywords: meta('keywords'),
    robots: meta('robots'),
    googlebot: meta('googlebot'),
    canonical: $('link[rel="canonical"]')?.href || null,
    canonicalCount: $$('link[rel="canonical"]').length,
    lang: document.documentElement.getAttribute('lang'),
    charset: document.characterSet,
    viewport: meta('viewport'),
    generator: meta('generator'),
    author: meta('author'),
    themeColor: meta('theme-color'),
    favicon: $('link[rel~="icon"]')?.href || null,
    appleTouchIcon: $('link[rel="apple-touch-icon"]')?.href || null,
    manifest: $('link[rel="manifest"]')?.href || null,
    amp: $('link[rel="amphtml"]')?.href || null,
    prev: $('link[rel="prev"]')?.href || null,
    next: $('link[rel="next"]')?.href || null,
    feeds: $$('link[type="application/rss+xml"], link[type="application/atom+xml"]').map((l) => ({ title: l.title, href: l.href })),
    hreflang: $$('link[rel="alternate"][hreflang]').map((l) => ({ lang: l.getAttribute('hreflang'), href: l.href })),
    doctype: document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : null,
    verification: ['google-site-verification', 'msvalidate.01', 'yandex-verification', 'p:domain_verify', 'facebook-domain-verification']
      .filter((n) => meta(n))
  };

  /* ---------------- Headings ---------------- */
  const headings = $$('h1,h2,h3,h4,h5,h6').map((h) => ({
    level: +h.tagName[1],
    text: clean(h.textContent).slice(0, 300),
    hidden: !h.getClientRects().length
  }));
  const headingCounts = [1, 2, 3, 4, 5, 6].map((l) => headings.filter((h) => h.level === l).length);
  // detect skipped levels (e.g. h2 -> h4)
  const skips = [];
  headings.reduce((prev, h) => { if (prev && h.level > prev + 1) skips.push(`H${prev} → H${h.level}: "${h.text.slice(0, 60)}"`); return h.level; }, 0);

  /* ---------------- Content / keywords ---------------- */
  const STOP = new Set(('a,about,above,after,again,against,all,am,an,and,any,are,as,at,be,because,been,before,being,below,between,both,but,by,can,could,did,do,does,doing,down,during,each,few,for,from,further,had,has,have,having,he,her,here,hers,herself,him,himself,his,how,i,if,in,into,is,it,its,itself,just,me,more,most,my,myself,no,nor,not,now,of,off,on,once,only,or,other,our,ours,ourselves,out,over,own,same,she,should,so,some,such,than,that,the,their,theirs,them,themselves,then,there,these,they,this,those,through,to,too,under,until,up,very,was,we,were,what,when,where,which,while,who,whom,why,will,with,would,you,your,yours,yourself,yourselves,also,get,got,one,two,may,new,use,used,using,like,well,way,us,its,it\'s,don\'t,can\'t,i\'m,you\'re,we\'re,s,t,re,ve,ll,d,m').split(','));
  const mainEl = $('main') || $('article') || $('[role="main"]') || document.body;
  const bodyText = clean(document.body?.innerText || '');
  const mainText = clean(mainEl?.innerText || '');
  const words = (mainText.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).map((w) => w.replace(/[’']/g, "'"));
  const ngrams = (n) => {
    const m = new Map();
    for (let i = 0; i + n <= words.length; i++) {
      const g = words.slice(i, i + n);
      if (STOP.has(g[0]) || STOP.has(g[n - 1]) || g.some((w) => w.length < 2 || /^\d+$/.test(w))) continue;
      const k = g.join(' ');
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].filter(([, c]) => c > 1 || n === 1).sort((a, b) => b[1] - a[1]).slice(0, 25)
      .map(([k, c]) => ({ term: k, count: c, density: words.length ? +((c * n * 100) / words.length).toFixed(2) : 0 }));
  };
  const sentences = mainText.split(/[.!?]+\s/).filter((s) => s.split(' ').length > 2);
  const syllables = (w) => (w.toLowerCase().replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g) || []).length || 1;
  const sylTotal = words.slice(0, 5000).reduce((a, w) => a + syllables(w), 0);
  const wSample = Math.min(words.length, 5000);
  const flesch = sentences.length && wSample
    ? Math.round(206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (sylTotal / wSample))
    : null;
  const html = document.documentElement.outerHTML;
  const content = {
    wordCount: bodyText ? bodyText.split(/\s+/).length : 0,
    mainWordCount: words.length,
    readingTimeMin: Math.max(1, Math.round(words.length / 230)),
    paragraphs: $$('p').filter((p) => clean(p.textContent).length > 30).length,
    htmlBytes: html.length,
    textRatio: html.length ? +((bodyText.length / html.length) * 100).toFixed(1) : 0,
    flesch: flesch === null ? null : Math.max(0, Math.min(100, flesch)),
    oneWord: ngrams(1),
    twoWord: ngrams(2),
    threeWord: ngrams(3)
  };

  /* ---------------- Links ---------------- */
  const links = $$('a[href]').map((a) => {
    const href = a.getAttribute('href') || '';
    const url = abs(href);
    const rel = (a.getAttribute('rel') || '').toLowerCase().split(/\s+/).filter(Boolean);
    let type = 'other';
    let lhost = null;
    if (url && /^https?:/i.test(url)) {
      lhost = new URL(url).hostname.replace(/^www\./, '');
      type = lhost === host || lhost.endsWith('.' + host) ? 'internal' : 'external';
    } else if (/^mailto:/i.test(href)) type = 'mailto';
    else if (/^tel:/i.test(href)) type = 'tel';
    else if (/^(javascript:|#)/i.test(href) || href === '') type = 'anchor';
    const img = a.querySelector('img');
    return {
      url: url || href,
      text: clean(a.textContent).slice(0, 150) || (img ? `[img] ${img.alt || ''}`.trim() : ''),
      rel,
      nofollow: rel.includes('nofollow'),
      sponsored: rel.includes('sponsored'),
      ugc: rel.includes('ugc'),
      blank: a.target === '_blank',
      noopener: rel.includes('noopener') || rel.includes('noreferrer'),
      type,
      host: lhost,
      visible: !!a.getClientRects().length
    };
  });

  /* ---------------- Images ---------------- */
  const images = $$('img').map((img) => ({
    src: img.currentSrc || img.src || img.getAttribute('data-src') || '',
    alt: img.hasAttribute('alt') ? img.getAttribute('alt') : null,
    title: img.getAttribute('title'),
    width: img.getAttribute('width'),
    height: img.getAttribute('height'),
    naturalW: img.naturalWidth,
    naturalH: img.naturalHeight,
    renderedW: Math.round(img.getBoundingClientRect().width),
    renderedH: Math.round(img.getBoundingClientRect().height),
    loading: img.getAttribute('loading'),
    srcset: !!img.getAttribute('srcset'),
    format: ((img.currentSrc || img.src || '').split('?')[0].match(/\.(\w{3,4})$/) || [])[1]?.toLowerCase() || null
  }));
  // map transfer sizes from resource timing where available
  const resources = performance.getEntriesByType('resource');
  const sizeByUrl = new Map(resources.map((r) => [r.name, r.transferSize || r.encodedBodySize || 0]));
  images.forEach((i) => { i.bytes = sizeByUrl.get(i.src) || null; });

  /* ---------------- Structured data ---------------- */
  const jsonld = $$('script[type="application/ld+json"]').map((s) => {
    try {
      const data = JSON.parse(s.textContent);
      const types = [];
      const walk = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (n['@type']) types.push(...[].concat(n['@type']));
        if (n['@graph']) walk(n['@graph']);
        Object.values(n).forEach((v) => typeof v === 'object' && walk(v));
      };
      walk(data);
      return { valid: true, types: [...new Set(types)], data };
    } catch (e) {
      return { valid: false, error: e.message, raw: s.textContent.slice(0, 500) };
    }
  });
  const microdata = [...new Set($$('[itemscope][itemtype]').map((e) => e.getAttribute('itemtype')))];
  const rdfa = [...new Set($$('[typeof]').map((e) => e.getAttribute('typeof')))];

  /* ---------------- Social ---------------- */
  const og = {};
  $$('meta[property^="og:"], meta[property^="article:"], meta[property^="fb:"]').forEach((m) => { og[m.getAttribute('property')] = m.content; });
  const twitter = {};
  $$('meta[name^="twitter:"], meta[property^="twitter:"]').forEach((m) => { twitter[m.getAttribute('name') || m.getAttribute('property')] = m.content; });

  /* ---------------- Technical / tech stack ---------------- */
  const scripts = $$('script[src]').map((s) => s.src);
  const allScriptText = $$('script:not([src])').map((s) => s.textContent).join('\n').slice(0, 500000);
  const has = (re) => re.test(html);
  const tech = [];
  const detect = (name, cond) => cond && tech.push(name);
  detect('Google Analytics 4', /gtag\/js\?id=G-|['"]G-[A-Z0-9]{6,}['"]/.test(html));
  detect('Google Tag Manager', /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/.test(html));
  detect('Universal Analytics', /google-analytics\.com\/analytics\.js|UA-\d{4,}-\d+/.test(html));
  detect('Meta Pixel', /connect\.facebook\.net\/.*fbevents\.js|fbq\(/.test(html));
  detect('Microsoft Clarity', /clarity\.ms/.test(html));
  detect('Hotjar', /static\.hotjar\.com/.test(html));
  detect('LinkedIn Insight', /snap\.licdn\.com/.test(html));
  detect('Google Ads', /googleadservices\.com|AW-\d{6,}/.test(html));
  detect('AdSense', /pagead2\.googlesyndication\.com/.test(html));
  detect('WordPress', /wp-content\/|wp-includes\//.test(html) || /wordpress/i.test(basics.generator || ''));
  detect('Shopify', /cdn\.shopify\.com|Shopify\.theme/.test(html));
  detect('Wix', /static\.wixstatic\.com|wix\.com/.test(html) && /wix/i.test(html.slice(0, 50000)));
  detect('Squarespace', /static1\.squarespace\.com/.test(html));
  detect('Webflow', /webflow\.(js|com)/.test(html) || !!$('html[data-wf-site]'));
  detect('Drupal', /drupal/i.test(basics.generator || '') || /\/sites\/default\/files\//.test(html));
  detect('Joomla', /joomla/i.test(basics.generator || ''));
  detect('Ghost', /ghost/i.test(basics.generator || ''));
  detect('Next.js', !!$('#__next') || /\/_next\/static\//.test(html));
  detect('Nuxt', !!$('#__nuxt') || /\/_nuxt\//.test(html));
  detect('Gatsby', !!$('#___gatsby'));
  detect('React', !!$('[data-reactroot]') || /react(-dom)?(\.production)?(\.min)?\.js/.test(scripts.join(' ')) || !!$('#__next'));
  detect('Vue', !!$('[data-v-app]') || /vue(\.runtime)?(\.global)?(\.prod)?(\.min)?\.js/.test(scripts.join(' ')));
  detect('Angular', !!$('[ng-version]'));
  detect('Svelte', /svelte-[a-z0-9]{5,}/.test(html));
  detect('jQuery', scripts.some((s) => /jquery/i.test(s)) || /jQuery/.test(allScriptText.slice(0, 20000)));
  detect('Bootstrap', /bootstrap(\.min)?\.(css|js)/.test(html));
  detect('Tailwind CSS', /\b(tw-|tailwind)/.test(html.slice(0, 200000)) || /class="[^"]*\b(flex|grid) [^"]*\b(px|py|mx|my)-\d/.test(html.slice(0, 200000)));
  detect('Cloudflare (scripts)', /cdnjs\.cloudflare\.com|challenges\.cloudflare\.com|cdn-cgi\//.test(html));
  detect('Yoast SEO', /yoast/i.test(html.slice(0, 300000)));
  detect('Rank Math', /rank-math|rankmath/i.test(html.slice(0, 300000)));
  detect('Intercom', /widget\.intercom\.io/.test(html));
  detect('HubSpot', /js\.hs-scripts\.com|hs-analytics/.test(html));
  detect('Stripe', /js\.stripe\.com/.test(html));
  detect('Razorpay', /checkout\.razorpay\.com/.test(html));

  const nav = performance.getEntriesByType('navigation')[0];
  const totalBytes = resources.reduce((a, r) => a + (r.transferSize || 0), 0) + (nav?.transferSize || 0);
  const byType = {};
  resources.forEach((r) => {
    const t = r.initiatorType || 'other';
    byType[t] = byType[t] || { count: 0, bytes: 0 };
    byType[t].count++; byType[t].bytes += r.transferSize || 0;
  });
  const technical = {
    domNodes: document.getElementsByTagName('*').length,
    scripts: $$('script').length,
    externalScripts: scripts.length,
    renderBlockingScripts: $$('head script[src]:not([async]):not([defer]):not([type="module"])').length,
    stylesheets: $$('link[rel="stylesheet"]').length,
    inlineStyleBytes: $$('style').reduce((a, s) => a + s.textContent.length, 0),
    inlineScriptBytes: allScriptText.length,
    iframes: $$('iframe').map((f) => f.src).filter(Boolean).slice(0, 30),
    preloads: $$('link[rel="preload"]').length,
    preconnects: $$('link[rel="preconnect"], link[rel="dns-prefetch"]').map((l) => l.href),
    requests: resources.length + 1,
    totalBytes,
    byType,
    httpProtocol: nav?.nextHopProtocol || null,
    loadMs: nav ? Math.round(nav.loadEventEnd || nav.domComplete) : null,
    domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    mixedContent: location.protocol === 'https:'
      ? [...new Set([...$$('img[src^="http:"], script[src^="http:"], link[href^="http:"][rel="stylesheet"], iframe[src^="http:"]')].map((e) => e.src || e.href))].slice(0, 30)
      : [],
    tech,
    forms: $$('form').length,
    hasNoscript: !!$('noscript'),
    deprecatedTags: $$('font, center, marquee, blink, frame, frameset').length,
    duplicateIds: (() => {
      const seen = new Map();
      $$('[id]').forEach((e) => seen.set(e.id, (seen.get(e.id) || 0) + 1));
      return [...seen.entries()].filter(([, c]) => c > 1).map(([id]) => id).slice(0, 20);
    })()
  };

  return {
    analyzedAt: new Date().toISOString(),
    basics,
    headings: { list: headings, counts: headingCounts, skips },
    content,
    links,
    images,
    schema: { jsonld, microdata, rdfa },
    social: { og, twitter },
    technical,
    vitals: globalThis.__openseoVitals ? { ...globalThis.__openseoVitals } : null
  };
})();
