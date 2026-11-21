// OpenSEO Lens — robots.txt parser + matcher following RFC 9309 (longest match wins, Allow wins ties).

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let cur = null;
  let lastWasAgent = false;
  for (let raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [], crawlDelay: null }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') { sitemaps.push(val); continue; }
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') cur.rules.push({ allow: key === 'allow', path: val });
    else if (key === 'crawl-delay') cur.crawlDelay = val;
  }
  return { groups, sitemaps };
}

function toRegex(path) {
  let anchored = false;
  if (path.endsWith('$')) { anchored = true; path = path.slice(0, -1); }
  const re = path.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + re + (anchored ? '$' : ''));
}

export function isAllowed(parsed, agent, pathWithQuery) {
  agent = agent.toLowerCase();
  let groups = parsed.groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  if (!groups.length) groups = parsed.groups.filter((g) => g.agents.includes('*'));
  const rules = groups.flatMap((g) => g.rules).filter((r) => r.path !== '' || !r.allow);
  let best = null;
  for (const r of rules) {
    if (r.path === '') continue; // empty Disallow = allow everything
    if (!toRegex(r.path).test(pathWithQuery)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return { allowed: !best || best.allow, rule: best ? `${best.allow ? 'Allow' : 'Disallow'}: ${best.path}` : null, matchedGroup: groups[0]?.agents.join(', ') || null };
}
