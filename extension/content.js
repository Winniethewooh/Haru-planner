// 투두메이트 탭에서 실행.
//  - 6시간마다 탭을 새로고침해 최신 목록을 읽고 전송 (투두메이트 웹이 폰의 변경을 실시간으로 못 받을 수 있어서)
//  - 팝업의 "지금 보내기"로 수동 전송
//  - 할 일 위치 지정
(function () {
  const X = globalThis.HaruExtractor;
  const EVERY_MS = 6 * 60 * 60 * 1000;

  async function scan() {
    const { cfg } = await chrome.storage.local.get('cfg');
    if (!cfg) return;
    const items = X.extract(cfg);
    await chrome.storage.local.set({ scannedAt: Date.now() });
    if (items.length) chrome.runtime.sendMessage({ type: 'items', items }).catch(() => {});
  }

  // 페이지가 열리면 화면이 그려질 때까지 기다렸다가 한 번 읽음
  setTimeout(scan, 5000);

  // 마지막으로 읽은 지 6시간이 지났으면 새로고침 (보고 있는 중에는 건드리지 않음)
  setInterval(async () => {
    const { cfg, scannedAt } = await chrome.storage.local.get(['cfg', 'scannedAt']);
    if (!cfg || Date.now() - (scannedAt || 0) < EVERY_MS) return;
    if (document.hidden) location.reload();
    else scan();
  }, 60 * 1000);

  chrome.storage.onChanged.addListener(ch => {
    if (ch.scanRequest) scan(); // 팝업의 "지금 보내기"
  });

  // ---------- 할 일 위치 지정 ----------
  function pick(message) {
    return new Promise(resolve => {
      const bar = document.createElement('div');
      bar.textContent = message + '  (Esc: 취소)';
      bar.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
        'background:#111;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:99px;pointer-events:none';
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;outline:2px solid #111;' +
        'outline-offset:2px;border-radius:6px;background:rgba(0,0,0,.04);display:none';
      document.documentElement.append(bar, box);

      const onMove = e => {
        const r = X.findItem(e.target).getBoundingClientRect();
        Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      };
      const block = e => { e.preventDefault(); e.stopPropagation(); };
      const onClick = e => { block(e); done(X.findItem(e.target)); };
      const onKey = e => { if (e.key === 'Escape') { block(e); done(null); } };
      const events = [['mousemove', onMove], ['click', onClick], ['mousedown', block], ['mouseup', block], ['pointerdown', block], ['pointerup', block], ['keydown', onKey]];
      events.forEach(([t, f]) => document.addEventListener(t, f, true));

      function done(el) {
        events.forEach(([t, f]) => document.removeEventListener(t, f, true));
        bar.remove();
        box.remove();
        resolve(el);
      }
    });
  }

  async function setup() {
    const item = await pick('완료하지 않은 할 일 하나를 클릭하세요');
    if (!item) return;
    const cfg = { selector: X.selectorFor(item), url: location.href };
    const done = await pick('이제 같은 카테고리의 완료한 할 일을 클릭하세요 (없으면 Esc)');
    if (done && done !== item) Object.assign(cfg, X.learnDone(done, item));
    await chrome.storage.local.set({ cfg });
    const n = X.extract(cfg).length;
    toast(n ? `할 일 ${n}개를 찾았어요` : '할 일을 찾지 못했어요. 다시 지정해 주세요');
    chrome.runtime.sendMessage({ type: 'config', cfg }).catch(() => {});
    scan();
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
      'background:#111;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:99px';
    document.documentElement.append(t);
    setTimeout(() => t.remove(), 2500);
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'pick') setup();
  });
})();
