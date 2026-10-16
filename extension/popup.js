const $ = s => document.querySelector(s);
const TODOMATE = /^https:\/\/([^/]+\.)?todomate\.net\//;

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  return `${Math.floor(m / 60)}시간 전`;
}

async function render() {
  const { conn, cfg, sentAt, sentCount, error } = await chrome.storage.local.get(['conn', 'cfg', 'sentAt', 'sentCount', 'error']);
  $('#off').hidden = !!conn;
  $('#on').hidden = !conn;
  if (!conn) return;

  $('#status').textContent = !cfg
    ? '투두메이트 웹 탭에서 "할 일 위치 지정"을 눌러 시작하세요.'
    : sentAt ? `위치 지정됨 · 마지막 전송 ${ago(sentAt)} (${sentCount}개)` : '위치 지정됨';
  showError(error);
}

function showError(msg) {
  $('#error').hidden = !msg;
  $('#error').textContent = msg || '';
}

async function todomateTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && TODOMATE.test(tab.url || '')) return tab;
  showError('투두메이트 웹 탭에서 눌러 주세요.');
  return null;
}

$('#save').onclick = async () => {
  const input = $('#code').value.trim();
  let conn = null;
  try { conn = JSON.parse(atob(input.replace(/^haru1\./, ''))); } catch {}
  if (!input.startsWith('haru1.') || !conn || !conn.g || !conn.t) {
    $('#codeError').hidden = false;
    $('#codeError').textContent = '연결 코드가 올바르지 않아요';
    return;
  }
  await chrome.storage.local.set({ conn });
  const { cfg } = await chrome.storage.local.get('cfg');
  if (cfg) chrome.runtime.sendMessage({ type: 'config', cfg });
  render();
};

$('#disconnect').onclick = async () => {
  await chrome.storage.local.remove(['conn', 'error', 'sentAt']);
  render();
};

$('#pick').onclick = async () => {
  const tab = await todomateTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: 'pick' }).catch(() => {});
  window.close();
};

// 열린 투두메이트 탭이 storage 변경을 보고 바로 읽어 전송
$('#now').onclick = () => chrome.storage.local.set({ scanRequest: Date.now() });

chrome.storage.onChanged.addListener(render);
render();
