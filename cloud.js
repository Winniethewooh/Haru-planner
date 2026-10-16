// GitHub 비공개 Gist를 기기 간 공유 저장소로 사용
//  todomate.json — 크롬 확장이 쓰는 투두메이트 목록
//  plan.json     — 플래너(폰·PC)가 쓰는 시간대 배치
(function () {
  const KEY = 'dayplan:cloud';
  const PREFIX = 'haru1.';
  let conn = null;
  try { conn = JSON.parse(localStorage.getItem(KEY)); } catch {}

  async function api(path, opts = {}, c = conn) {
    const res = await fetch('https://api.github.com' + path, {
      ...opts,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + c.t,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!res.ok) throw new Error(res.status === 401 ? '토큰이 올바르지 않아요' : res.status === 404 ? 'Gist를 찾을 수 없어요' : 'GitHub 오류 ' + res.status);
    return res.json();
  }

  function store(c) {
    conn = c;
    try { c ? localStorage.setItem(KEY, JSON.stringify(c)) : localStorage.removeItem(KEY); } catch {}
  }

  const json = s => { try { return JSON.parse(s); } catch { return null; } };

  window.Cloud = {
    connected: () => !!(conn && conn.g && conn.t),

    // 연결 코드(haru1.…) 또는 GitHub 토큰을 받아 연결. 토큰이면 새 Gist를 만든다.
    async connect(input) {
      input = input.trim();
      let c;
      if (input.startsWith(PREFIX)) {
        c = json(atob(input.slice(PREFIX.length)));
        if (!c || !c.g || !c.t) throw new Error('연결 코드가 올바르지 않아요');
        await api('/gists/' + c.g, {}, c);
      } else {
        c = { t: input };
        const empty = JSON.stringify({});
        const g = await api('/gists', {
          method: 'POST',
          body: JSON.stringify({
            description: '하루 플래너 동기화',
            public: false,
            files: { 'plan.json': { content: empty }, 'todomate.json': { content: empty } },
          }),
        }, c);
        c.g = g.id;
      }
      store(c);
    },

    disconnect: () => store(null),

    code: () => PREFIX + btoa(JSON.stringify({ g: conn.g, t: conn.t })),

    async pull() {
      const g = await api('/gists/' + conn.g);
      const f = g.files || {};
      return {
        plan: f['plan.json'] && json(f['plan.json'].content),
        todo: f['todomate.json'] && json(f['todomate.json'].content),
      };
    },

    async push(plan) {
      await api('/gists/' + conn.g, {
        method: 'PATCH',
        body: JSON.stringify({ files: { 'plan.json': { content: JSON.stringify(plan) } } }),
      });
    },
  };
})();
