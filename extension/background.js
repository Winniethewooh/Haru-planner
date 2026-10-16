// 팝업·투두메이트 탭의 요청을 받아 Gist에 기록
//  config.json   — 할 일 위치(선택자)·완료 표시. 서버(GitHub Actions)가 같은 방식으로 읽는 데 사용
//  todomate.json — "지금 보내기"로 보낸 할 일
let queue = Promise.resolve();

// 투두메이트 화면의 날짜 = 달력 날짜 (플래너의 새벽 2시 기준과 다름, 플래너가 알아서 맞춤)
function calendarDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'items') queue = queue.then(() => sendItems(msg.items)).catch(() => {});
  if (msg.type === 'config') queue = queue.then(() => sendConfig(msg.cfg)).catch(() => {});
});

async function gist(conn, method, files) {
  const res = await fetch('https://api.github.com/gists/' + conn.g, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + conn.t,
      ...(files ? { 'Content-Type': 'application/json' } : {}),
    },
    body: files ? JSON.stringify({ files }) : undefined,
  });
  if (!res.ok) throw new Error('GitHub 오류 ' + res.status);
  return res.json();
}

async function withConn(fn) {
  const { conn } = await chrome.storage.local.get('conn');
  if (!conn) return status('연결 코드를 입력하세요');
  try {
    await fn(conn);
    await status('');
  } catch (e) {
    await status(e.message);
  }
}

function sendConfig(cfg) {
  return withConn(conn => gist(conn, 'PATCH', { 'config.json': { content: JSON.stringify(cfg) } }));
}

function sendItems(items) {
  return withConn(async conn => {
    const g = await gist(conn, 'GET');
    let prev = null;
    try { prev = JSON.parse(g.files['todomate.json'].content); } catch {}
    const now = Date.now();
    const date = calendarDate();
    const same = prev && prev.date === date && JSON.stringify(prev.items) === JSON.stringify(items);
    const body = { date, items, updatedAt: same ? prev.updatedAt : now, checkedAt: now, via: 'extension' };
    await gist(conn, 'PATCH', { 'todomate.json': { content: JSON.stringify(body) } });
    await chrome.storage.local.set({ sentAt: now, sentCount: items.length });
  });
}

function status(error) {
  return chrome.storage.local.set({ error });
}
