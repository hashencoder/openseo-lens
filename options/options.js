const keys = ['serpOverlay', 'serpKd', 'serpRank', 'linkGraph'];
const psiInput = document.getElementById('psiKey');
const psiState = document.getElementById('psiState');

const showPsiState = (key) => {
  psiState.textContent = key
    ? 'Using your own key, with a private daily quota.'
    : 'No key: using the shared free quota.';
};

chrome.storage.sync.get(keys).then((cfg) => {
  keys.forEach((k) => { document.getElementById(k).checked = cfg[k] !== false; });
});
// The API key lives in local storage only: it is not synced to other devices.
chrome.storage.local.get('psiKey').then(({ psiKey }) => {
  psiInput.value = psiKey || '';
  showPsiState(psiKey);
});

document.getElementById('psiShow').onclick = (e) => {
  const hidden = psiInput.type === 'password';
  psiInput.type = hidden ? 'text' : 'password';
  e.target.textContent = hidden ? 'Hide' : 'Show';
};

document.getElementById('save').onclick = async () => {
  const out = {};
  keys.forEach((k) => { out[k] = document.getElementById(k).checked; });
  await chrome.storage.sync.set(out);
  const key = psiInput.value.trim();
  if (key) await chrome.storage.local.set({ psiKey: key });
  else await chrome.storage.local.remove('psiKey');
  showPsiState(key);
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
