// OpenSEO Lens — toggle link highlighting on the page (nofollow / sponsored / ugc / external / internal).
(() => {
  const ID = '__openseo_highlight_style';
  const existing = document.getElementById(ID);
  if (existing) {
    existing.remove();
    document.querySelectorAll('[data-openseo-link]').forEach((a) => a.removeAttribute('data-openseo-link'));
    document.getElementById('__openseo_legend')?.remove();
    return 'off';
  }
  const host = location.hostname.replace(/^www\./, '');
  document.querySelectorAll('a[href]').forEach((a) => {
    const rel = (a.getAttribute('rel') || '').toLowerCase();
    let kind = 'internal';
    try {
      const h = new URL(a.href).hostname.replace(/^www\./, '');
      if (h && h !== host && !h.endsWith('.' + host)) kind = 'external';
    } catch {}
    if (/\bnofollow\b/.test(rel)) kind = 'nofollow';
    if (/\bsponsored\b/.test(rel)) kind = 'sponsored';
    if (/\bugc\b/.test(rel)) kind = 'ugc';
    a.setAttribute('data-openseo-link', kind);
  });
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = `
    [data-openseo-link]{outline-offset:1px!important}
    [data-openseo-link="internal"]{outline:2px solid #1a73e8!important;background:rgba(26,115,232,.08)!important}
    [data-openseo-link="external"]{outline:2px solid #188038!important;background:rgba(24,128,56,.08)!important}
    [data-openseo-link="nofollow"]{outline:2px dashed #d93025!important;background:rgba(217,48,37,.12)!important}
    [data-openseo-link="sponsored"]{outline:2px dashed #e37400!important;background:rgba(227,116,0,.12)!important}
    [data-openseo-link="ugc"]{outline:2px dashed #9334e6!important;background:rgba(147,52,230,.12)!important}
    #__openseo_legend{position:fixed;z-index:2147483647;bottom:12px;right:12px;background:#111;color:#fff;font:12px/1.6 system-ui,sans-serif;padding:8px 12px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer}
    #__openseo_legend i{display:inline-block;width:10px;height:10px;margin:0 4px 0 10px;border-radius:2px;vertical-align:-1px}`;
  document.documentElement.appendChild(style);
  const legend = document.createElement('div');
  legend.id = '__openseo_legend';
  legend.title = 'Click to turn off';
  legend.innerHTML = '<b>OpenSEO Lens</b><i style="background:#1a73e8"></i>internal<i style="background:#188038"></i>external<i style="background:#d93025"></i>nofollow<i style="background:#e37400"></i>sponsored<i style="background:#9334e6"></i>ugc';
  legend.onclick = () => {
    style.remove(); legend.remove();
    document.querySelectorAll('[data-openseo-link]').forEach((a) => a.removeAttribute('data-openseo-link'));
  };
  document.documentElement.appendChild(legend);
  return 'on';
})();
