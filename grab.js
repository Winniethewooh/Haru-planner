// todomate.net 페이지 안에서 실행되는 "하루로 보내기".
// extension/extractor.js 뒤에 이어 붙여서 두 가지로 쓴다.
//  - 북마크릿: 누르면 바로 읽어서 하루로 보냄 (앱 설정 › 북마크 버튼 코드 복사)
//  - 유저스크립트(haru.user.js, 아이폰 Userscripts 앱): 하루의 "가져오기"로 열렸으면
//    자동으로 읽고 하루로 돌아감. 직접 열었을 땐 오른쪽 아래 작은 "하루로" 버튼만 보임.
(function () {
  const X = globalThis.HaruExtractor;
  const MODE = globalThis.__HARU_MODE || 'bookmarklet';
  const BAKED = '__HARU_URL__'; // 북마크릿으로 복사할 때 하루 주소로 바뀜
  const CFG = 'haru:cfg';
  const PLANNER = 'haru:planner';
  const RETURN = 'haru:return';
  const ALLOWED = 'haru:allowed';

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // 할 일 제목을 보낼 수 있는 곳은 사용자가 허용한 하루 주소(origin)뿐.
  // todomate.net/#haru=<주소> 링크는 누구나 만들 수 있어서, 처음 보는 주소는 반드시 물어봄.
  const originOf = u => {
    try {
      const x = new URL(u);
      const local = x.hostname === 'localhost' || x.hostname === '127.0.0.1';
      if (x.protocol !== 'https:' && !(x.protocol === 'http:' && local)) return null;
      return x.username || x.password ? null : x.origin;
    } catch { return null; }
  };
  const bakedOrigin = BAKED.startsWith('http') ? originOf(BAKED) : null;
  const allowedList = () => { const l = store.get(ALLOWED); return Array.isArray(l) ? l : []; };
  const isAllowed = url => {
    const o = originOf(url || '');
    return !!o && (bakedOrigin ? o === bakedOrigin : allowedList().includes(o));
  };
  function accept(url) {
    store.set(PLANNER, url);
    try { sessionStorage.setItem(RETURN, url); } catch {}
  }

  // 하루가 todomate.net/#haru=<하루 주소> 로 열었는지. 투두메이트 화면이 뜨기 전에 주소를 원래대로 돌려놓음.
  let pending = null;   // 아직 허용하지 않은 주소
  const m = location.hash.match(/^#haru=(.+)$/);
  if (m) {
    let back = '';
    try { back = decodeURIComponent(m[1]); } catch {}
    if (isAllowed(back)) accept(back);
    else if (!bakedOrigin && originOf(back)) pending = back;
    history.replaceState(history.state, '', location.pathname + location.search);
  }
  let returnTo = null;
  try { returnTo = sessionStorage.getItem(RETURN); } catch {}
  if (returnTo && !isAllowed(returnTo)) returnTo = null;
  const planner = () => {
    const url = returnTo || (bakedOrigin ? BAKED : store.get(PLANNER));
    return isAllowed(url) ? url : null;
  };

  let cfg = store.get(CFG);
  let card = null;

  // ---------- 하단 카드 ----------
  function show(message, buttons) {
    if (!card) {
      card = document.createElement('div');
      card.id = 'haru-card';
      card.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:2147483647;' +
        'background:#111;color:#fff;border-radius:16px;padding:16px 18px;font:15px/1.45 -apple-system,system-ui,sans-serif;' +
        'box-shadow:0 8px 30px rgba(0,0,0,.25);-webkit-user-select:none;user-select:none';
      document.documentElement.appendChild(card);
    }
    card.innerHTML = '';
    const p = document.createElement('div');
    p.textContent = message;
    p.style.whiteSpace = 'pre-line';
    p.style.overflowWrap = 'anywhere';
    card.appendChild(p);
    if (buttons && buttons.length) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:18px;justify-content:flex-end;margin-top:12px';
      for (const b of buttons) {
        const el = document.createElement('button');
        el.textContent = b.label;
        el.style.cssText = 'font:inherit;border:0;cursor:pointer;border-radius:99px;' +
          (b.primary ? 'background:#fff;color:#111;padding:6px 16px' : 'background:none;color:#aaa;padding:6px 0');
        el.onclick = e => { e.preventDefault(); e.stopPropagation(); b.run(); };
        row.appendChild(el);
      }
      card.appendChild(row);
    }
  }

  function close() {
    if (card) card.remove();
    card = null;
  }

  function goBack(hash) {
    try { sessionStorage.removeItem(RETURN); } catch {}
    const url = planner();
    if (url) location.replace(url + (hash || ''));
    else close();
  }

  // ---------- 할 일 탭해서 지정 ----------
  function tapPick(message, extraButtons) {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;outline:3px solid #111;outline-offset:2px;border-radius:8px;display:none';
      document.documentElement.appendChild(box);
      let start = null;

      const inCard = e => card && card.contains(e.target);
      const down = e => { if (!inCard(e)) start = [e.clientX, e.clientY]; };
      const up = e => {
        if (inCard(e) || !start) return;
        const moved = Math.abs(e.clientX - start[0]) + Math.abs(e.clientY - start[1]);
        start = null;
        if (moved > 12) return; // 스크롤은 무시
        e.preventDefault();
        e.stopPropagation();
        card.style.display = 'none';
        const target = document.elementFromPoint(e.clientX, e.clientY);
        card.style.display = '';
        if (!target) return;
        const item = X.findItem(target);
        const r = item.getBoundingClientRect();
        Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        setTimeout(() => finish(item), 250);
      };
      const block = e => { if (!inCard(e)) { e.preventDefault(); e.stopPropagation(); } };
      const events = [['pointerdown', down], ['pointerup', up], ['click', block], ['touchend', block]];
      events.forEach(([t, f]) => document.addEventListener(t, f, { capture: true, passive: false }));

      function finish(value) {
        events.forEach(([t, f]) => document.removeEventListener(t, f, { capture: true }));
        box.remove();
        resolve(value);
      }
      show(message, [...(extraButtons || []).map(b => ({ label: b.label, run: () => finish(b.value) })), { label: '취소', run: () => finish(undefined) }]);
    });
  }

  async function setup() {
    const item = await tapPick('완료하지 않은 할 일 하나를 탭하세요');
    if (!item) return close();
    const next = { selector: X.selectorFor(item) };
    const done = await tapPick('이번엔 완료한 할 일 하나를 탭하세요', [{ label: '완료한 게 없어요', value: null }]);
    if (done === undefined) return close();
    if (done && done !== item) Object.assign(next, X.learnDone(done, item));
    cfg = next;
    store.set(CFG, cfg);
    send(X.extract(cfg));
  }

  // ---------- 보내기 ----------
  function notFound() {
    const buttons = [{ label: '다시 지정', run: setup }];
    if (planner()) buttons.push({ label: '하루로 돌아가기', primary: true, run: () => goBack() });
    else buttons.unshift({ label: '닫기', run: close });
    show('할 일을 찾지 못했어요. 로그인했는지, 오늘 화면인지 확인하고 위치를 다시 지정해 주세요.', buttons);
  }

  function send(items) {
    if (!items.length) return notFound();
    if (!planner()) return show('하루 주소를 몰라요. 하루 앱에서 "가져오기"를 눌러 주세요.', [{ label: '닫기', run: close }]);
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hash = '#items=' + encodeURIComponent(JSON.stringify({ date, items, via: MODE }));
    // 잘못 지정됐을 때 고칠 수 있도록 잠깐 보여준 뒤 이동
    let cancelled = false;
    show(`할 일 ${items.length}개를 하루로 보내는 중…`, [{ label: '다시 지정', run: () => { cancelled = true; setup(); } }]);
    setTimeout(() => { if (!cancelled) goBack(hash); }, MODE === 'userscript' ? 700 : 1200);
  }

  // 화면이 다 그려질 때까지 기다림: 같은 목록이 두 번 연속 보이면 완료 (최대 15초)
  function waitForItems() {
    return new Promise(resolve => {
      let last = null;
      const t0 = Date.now();
      (function poll() {
        const items = X.extract(cfg);
        const key = JSON.stringify(items);
        if (items.length && key === last) return resolve(items);
        last = key;
        if (Date.now() - t0 > 15000) return resolve(items);
        setTimeout(poll, 400);
      })();
    });
  }

  function firstRun() {
    show('처음 한 번만, 할 일이 어디 있는지 알려주세요.', [
      { label: '취소', run: close },
      { label: '시작', primary: true, run: setup },
    ]);
  }

  async function run() {
    if (!cfg || !cfg.selector) return firstRun();
    show('투두메이트에서 할 일을 읽는 중…');
    send(await waitForItems());
  }

  // 투두메이트를 직접 열었을 때 보이는 작은 버튼
  function pill() {
    if (!planner() || document.getElementById('haru-pill')) return;
    const b = document.createElement('button');
    b.id = 'haru-pill';
    b.textContent = '하루로';
    b.style.cssText = 'position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:2147483645;' +
      'font:600 13px/1 -apple-system,system-ui,sans-serif;background:#111;color:#fff;border:0;border-radius:99px;padding:10px 14px;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.2);opacity:.85';
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); returnTo = planner(); run(); };
    document.documentElement.appendChild(b);
  }

  // 처음 보는 하루 주소: 허용하기 전에는 아무것도 읽거나 보내지 않음
  function askAllow() {
    const o = originOf(pending);
    show(`이 주소로 투두메이트 할 일을 보낼까요?\n${o}\n내가 연 하루 주소가 맞을 때만 허용하세요.`, [
      { label: '취소', run: () => { pending = null; close(); } },
      { label: '허용하고 보내기', primary: true, run: () => {
        store.set(ALLOWED, [...new Set([...allowedList(), o])]);
        accept(pending);
        returnTo = pending;
        pending = null;
        run();
      } },
    ]);
  }

  function start() {
    if (document.getElementById('haru-card')) return;
    if (pending) return askAllow();
    if (MODE === 'bookmarklet' || returnTo) run();
    else pill();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
void 0;
