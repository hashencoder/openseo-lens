const keys = ['serpOverlay', 'serpKd', 'serpRank', 'linkGraph'];

chrome.storage.sync.get(keys).then((cfg) => {
  keys.forEach((k) => { document.getElementById(k).checked = cfg[k] !== false; });
});

document.getElementById('save').onclick = async () => {
  const out = {};
  keys.forEach((k) => { out[k] = document.getElementById(k).checked; });
  await chrome.storage.sync.set(out);
  const s = document.getElementById('saved');
  s.style.opacity = 1;
  setTimeout(() => (s.style.opacity = 0), 1500);
};

document.getElementById('clear').onclick = () =>
  chrome.runtime.sendMessage({ type: 'clearCache' }, () => alert('Cached domain data cleared.'));

const showStats = () => chrome.runtime.sendMessage({ type: 'linkGraphStats' }, (r) => {
  const s = r?.data;
  document.getElementById('lgStats').textContent = s ? `${s.links.toLocaleString()} links to ${s.domains.toLocaleString()} domains stored.` : '';
});
showStats();
document.getElementById('clearLg').onclick = () => {
  if (!confirm('Delete every link recorded from your browsing? This cannot be undone.')) return;
  chrome.runtime.sendMessage({ type: 'clearLinkGraph' }, showStats);
};
