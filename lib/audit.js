// OpenSEO Lens — on-page audit rules. Produces issues + a 0–100 score.
// severity: 'error' (−10), 'warning' (−4), 'notice' (−1). 'pass' entries are informative.

export function audit(d, net) {
  const out = [];
  const add = (severity, category, title, detail = '') => out.push({ severity, category, title, detail });
  const b = d.basics;

  // --- Indexability ---
  const status = net?.final?.status;
  if (status && status >= 400) add('error', 'Indexability', `Page returns HTTP ${status}`);
  if (net?.chain?.length > 1) add('warning', 'Indexability', `Redirect chain of ${net.chain.length} hops`, 'Point links directly at the final URL.');
  else if (net?.chain?.length === 1) add('notice', 'Indexability', `Page was reached through a ${net.chain[0].status} redirect`);
  const robotsAll = [b.robots, b.googlebot, net?.final?.headers?.['x-robots-tag']].filter(Boolean).join(', ').toLowerCase();
  if (/noindex/.test(robotsAll)) add('error', 'Indexability', 'Page is set to noindex', robotsAll);
  if (/nofollow/.test(robotsAll)) add('warning', 'Indexability', 'Page-level nofollow is set', robotsAll);
  if (!b.canonical) add('warning', 'Indexability', 'No canonical tag');
  else {
    if (b.canonicalCount > 1) add('error', 'Indexability', `${b.canonicalCount} canonical tags found`);
    const norm = (u) => { try { const x = new URL(u); return x.origin + x.pathname.replace(/\/$/, '') + x.search; } catch { return u; } };
    if (norm(b.canonical) !== norm(b.url)) add('notice', 'Indexability', 'Canonical points to a different URL', b.canonical);
  }
  if (!b.url.startsWith('https:')) add('error', 'Security', 'Page is not served over HTTPS');
  if (d.technical.mixedContent.length) add('error', 'Security', `${d.technical.mixedContent.length} mixed-content resources`, d.technical.mixedContent.slice(0, 3).join('\n'));

  // --- Title / description ---
  const tl = (b.title || '').length;
  if (!tl) add('error', 'Meta', 'Missing <title>');
  else if (tl < 30) add('warning', 'Meta', `Title is short (${tl} chars)`, 'Aim for ~30–60 characters.');
  else if (tl > 60) add('warning', 'Meta', `Title may be truncated (${tl} chars)`, 'Google shows ~580px ≈ 60 characters.');
  if (b.titleCount > 1) add('warning', 'Meta', `${b.titleCount} <title> tags`);
  const dl = (b.description || '').length;
  if (!dl) add('error', 'Meta', 'Missing meta description');
  else if (dl < 70) add('warning', 'Meta', `Meta description is short (${dl} chars)`, 'Aim for ~70–160 characters.');
  else if (dl > 160) add('notice', 'Meta', `Meta description may be truncated (${dl} chars)`);
  if (b.descriptionCount > 1) add('warning', 'Meta', `${b.descriptionCount} meta descriptions`);
  if (!b.lang) add('warning', 'Meta', 'Missing <html lang> attribute');
  if (!b.viewport) add('error', 'Mobile', 'Missing viewport meta tag');
  else if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(b.viewport)) add('notice', 'Mobile', 'Viewport blocks zooming', b.viewport);
  if (!b.favicon) add('notice', 'Meta', 'No favicon link tag');
  if (!b.doctype) add('warning', 'Meta', 'Missing <!DOCTYPE html>');

  // --- Headings ---
  const [h1] = d.headings.counts;
  if (h1 === 0) add('error', 'Content', 'No H1 heading');
  else if (h1 > 1) add('warning', 'Content', `${h1} H1 headings`, 'Use one H1 that describes the page.');
  const firstH1 = d.headings.list.find((h) => h.level === 1);
  if (firstH1 && !firstH1.text) add('warning', 'Content', 'H1 is empty');
  if (firstH1 && b.title && firstH1.text.toLowerCase() === b.title.toLowerCase()) add('notice', 'Content', 'H1 is identical to the title');
  if (d.headings.skips.length) add('notice', 'Content', `${d.headings.skips.length} skipped heading levels`, d.headings.skips.slice(0, 3).join('\n'));

  // --- Content ---
  const wc = d.content.mainWordCount;
  if (wc < 300) add('warning', 'Content', `Thin content (${wc} words in main area)`);
  if (d.content.textRatio < 10) add('notice', 'Content', `Low text-to-HTML ratio (${d.content.textRatio}%)`);
  const top = d.content.oneWord[0];
  if (top && top.density > 4) add('warning', 'Content', `Possible keyword stuffing: "${top.term}" at ${top.density}%`);

  // --- Images ---
  const noAlt = d.images.filter((i) => i.alt === null);
  if (noAlt.length) add('warning', 'Images', `${noAlt.length} images missing alt attribute`);
  const noDims = d.images.filter((i) => !i.width || !i.height);
  if (noDims.length) add('notice', 'Images', `${noDims.length} images without width/height (CLS risk)`);
  const big = d.images.filter((i) => i.bytes && i.bytes > 200 * 1024);
  if (big.length) add('warning', 'Images', `${big.length} images over 200 KB`);
  const oversized = d.images.filter((i) => i.renderedW > 0 && i.naturalW > i.renderedW * 2.5 && i.naturalW > 600);
  if (oversized.length) add('notice', 'Images', `${oversized.length} images much larger than displayed size`);
  const legacy = d.images.filter((i) => ['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(i.format));
  if (legacy.length > 3) add('notice', 'Images', `${legacy.length} images could use WebP/AVIF`);

  // --- Links ---
  const ext = d.links.filter((l) => l.type === 'external');
  const int = d.links.filter((l) => l.type === 'internal');
  if (!int.length) add('warning', 'Links', 'No internal links');
  const unsafeBlank = d.links.filter((l) => l.blank && l.type === 'external' && !l.noopener);
  if (unsafeBlank.length) add('notice', 'Links', `${unsafeBlank.length} target=_blank links without rel=noopener`);
  const emptyText = d.links.filter((l) => !l.text && (l.type === 'internal' || l.type === 'external'));
  if (emptyText.length) add('warning', 'Links', `${emptyText.length} links without anchor text`);
  if (d.links.length > 300) add('notice', 'Links', `Large number of links (${d.links.length})`);
  const generic = d.links.filter((l) => /^(click here|here|read more|more|learn more|link)$/i.test(l.text));
  if (generic.length) add('notice', 'Links', `${generic.length} links with generic anchor text`);
  void ext;

  // --- Social / schema ---
  const og = d.social.og;
  if (!og['og:title'] || !og['og:description'] || !og['og:image']) {
    const miss = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].filter((k) => !og[k]);
    add('warning', 'Social', 'Incomplete Open Graph tags', 'Missing: ' + miss.join(', '));
  }
  if (!d.social.twitter['twitter:card']) add('notice', 'Social', 'No twitter:card tag');
  if (!d.schema.jsonld.length && !d.schema.microdata.length) add('notice', 'Schema', 'No structured data found');
  d.schema.jsonld.filter((j) => !j.valid).forEach((j) => add('error', 'Schema', 'Invalid JSON-LD block', j.error));

  // --- Performance ---
  const t = d.technical;
  if (t.renderBlockingScripts > 2) add('warning', 'Performance', `${t.renderBlockingScripts} render-blocking scripts in <head>`);
  if (t.domNodes > 1500) add(t.domNodes > 3000 ? 'warning' : 'notice', 'Performance', `Large DOM (${t.domNodes} nodes)`);
  if (t.totalBytes > 3 * 1024 * 1024) add('warning', 'Performance', `Heavy page (${(t.totalBytes / 1048576).toFixed(1)} MB transferred)`);
  if (t.requests > 120) add('notice', 'Performance', `${t.requests} HTTP requests`);
  const v = d.vitals;
  if (v?.lcp > 4000) add('error', 'Performance', `Poor LCP: ${(v.lcp / 1000).toFixed(2)}s`);
  else if (v?.lcp > 2500) add('warning', 'Performance', `LCP needs improvement: ${(v.lcp / 1000).toFixed(2)}s`);
  if (v?.cls > 0.25) add('error', 'Performance', `Poor CLS: ${v.cls.toFixed(3)}`);
  else if (v?.cls > 0.1) add('warning', 'Performance', `CLS needs improvement: ${v.cls.toFixed(3)}`);
  if (v?.inp > 500) add('error', 'Performance', `Poor INP: ${v.inp}ms`);
  else if (v?.inp > 200) add('warning', 'Performance', `INP needs improvement: ${v.inp}ms`);
  const h = net?.final?.headers || {};
  if (!h['content-encoding'] && !net?.final?.fromCache) add('notice', 'Performance', 'HTML response is not compressed (gzip/br)');
  if (b.url.startsWith('https:') && !h['strict-transport-security']) add('notice', 'Security', 'No HSTS header');
  if (t.duplicateIds.length) add('notice', 'Technical', `${t.duplicateIds.length} duplicate element IDs`, t.duplicateIds.slice(0, 5).join(', '));
  if (t.deprecatedTags) add('notice', 'Technical', `${t.deprecatedTags} deprecated HTML tags`);

  const weights = { error: 10, warning: 4, notice: 1 };
  const penalty = out.reduce((a, i) => a + (weights[i.severity] || 0), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const order = { error: 0, warning: 1, notice: 2 };
  out.sort((a, b2) => order[a.severity] - order[b2.severity]);
  return {
    score,
    issues: out,
    counts: {
      error: out.filter((i) => i.severity === 'error').length,
      warning: out.filter((i) => i.severity === 'warning').length,
      notice: out.filter((i) => i.severity === 'notice').length
    }
  };
}
