// 파싱 · 병합 로직 (브라우저와 Node 테스트에서 공용)
(function (root) {
  const DAY_START = 2;      // 하루가 바뀌는 시각 (새벽 2시). 화면에는 6시부터 보임
  const SLOTS = [
    { id: 'am',    label: '오전', from: 6,  to: 12 },
    { id: 'pm',    label: '오후', from: 12, to: 18 },
    { id: 'eve',   label: '저녁', from: 18, to: 22 },
    { id: 'night', label: '밤',   from: 22, to: 26 },
  ];

  const DONE = /^(\[[xX✓✔]\]|☑️?|✅|✔️?|✓|●)\s*/u;
  const TODO = /^(\[\s?\]|☐|⬜|□|○|◯)\s*/u;
  const BULLET = /^([-*•·]|\d+[.)])\s+/;

  function currentSlot(date) {
    const h = date.getHours();
    const x = h < DAY_START ? h + 24 : h;
    return (SLOTS.find(s => x >= s.from && x < s.to) || SLOTS[0]).id;     // 새벽 2~6시는 오전으로
  }

  // 비교용 키: 띄어쓰기는 무시 (스크린샷 인식마다 띄어쓰기가 달라질 수 있음)
  function normalize(s) {
    return s.replace(/\s+/g, '').toLowerCase();
  }

  // 붙여넣은 텍스트 → [{title, cat, done, key}]  (done: true/false/null=표시 없음)
  function parse(text) {
    const items = [];
    let cat = '';
    for (const raw of String(text || '').split(/\r?\n/)) {
      let line = raw.trim();
      if (!line) continue;
      if (/^#+\s*/.test(line) || (/[:：]$/.test(line) && line.length <= 30)) {
        cat = line.replace(/^#+\s*/, '').replace(/[:：]$/, '').trim();
        continue;
      }
      line = line.replace(BULLET, '');
      let done = null;
      if (DONE.test(line)) { done = true; line = line.replace(DONE, ''); }
      else if (TODO.test(line)) { done = false; line = line.replace(TODO, ''); }
      line = line.replace(BULLET, '').trim();
      if (line) items.push({ title: line, cat, done });
    }
    return withKeys(items);
  }

  // 같은 제목이 여러 번 나오면 순서로 구분
  function withKeys(items) {
    const seen = {};
    return items.map(it => {
      const base = normalize(it.title);
      seen[base] = (seen[base] || 0) + 1;
      return { ...it, key: seen[base] > 1 ? base + '#' + seen[base] : base };
    });
  }

  let counter = 0;
  function uid() { return Date.now().toString(36) + (counter++).toString(36); }

  // 두 제목이 얼마나 비슷한지 (0~1). 공백 무시, 편집 거리 기준.
  function similarity(a, b) {
    a = a.replace(/#\d+$/, '').replace(/\s/g, '');
    b = b.replace(/#\d+$/, '').replace(/\s/g, '');
    if (!a || !b) return 0;
    if (a === b) return 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return 1 - prev[b.length] / Math.max(a.length, b.length);
  }

  // 정확히 같은 키가 없을 때, 글자 몇 개만 다른 항목(스크린샷 인식 오차 등)을 같은 할 일로 짝지음
  function fuzzyPairs(tasks, incoming) {
    const left = tasks.filter(t => !t.manual && !incoming.has(t.key));
    const right = [...incoming.values()].filter(p => !tasks.some(t => t.key === p.key));
    const cands = [];
    for (const t of left) for (const p of right) {
      const s = similarity(t.key, p.key);
      if (s >= 0.7) cands.push([s, t, p]);
    }
    cands.sort((x, y) => y[0] - x[0]);
    const pairs = new Map();
    const used = new Set();
    for (const [, t, p] of cands) {
      if (pairs.has(t.id) || used.has(p.key)) continue;
      pairs.set(t.id, p);
      used.add(p.key);
    }
    return pairs;
  }

  // 기존 계획에 새 목록을 반영. 슬롯 배정은 유지하고 변경 내역을 돌려줌.
  function merge(tasks, parsed) {
    const incoming = new Map(parsed.map(p => [p.key, p]));
    const fuzzy = fuzzyPairs(tasks, incoming);
    const result = { tasks: [], added: 0, removed: 0, completed: 0 };

    for (const t of tasks) {
      if (t.manual) { result.tasks.push(t); continue; }     // 직접 추가한 항목은 그대로 둠
      const p = incoming.get(t.key) || fuzzy.get(t.id);
      if (!p) {
        if (!t.gone) result.removed++;
        result.tasks.push({ ...t, gone: true, fresh: false });
        continue;
      }
      incoming.delete(p.key);
      const done = p.done === null ? t.done : p.done;
      if (done && !t.done) result.completed++;
      if (t.gone) result.added++;
      result.tasks.push({ ...t, key: p.key, title: p.title, cat: p.cat || t.cat, done, gone: false, fresh: t.gone || t.fresh });
    }
    for (const p of incoming.values()) {
      result.added++;
      result.tasks.push({ id: uid(), key: p.key, title: p.title, cat: p.cat, done: !!p.done, slot: null, gone: false, fresh: true });
    }
    return result;
  }

  // 서비스에서 직접 추가한 할 일. 투두메이트 항목과 키가 겹치지 않게 별도 키를 씀.
  const MAX_TITLE = 100;
  function addManual(tasks, title) {
    const text = String(title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    if (!text) return null;
    const id = uid();
    const task = { id, key: 'manual:' + id, title: text, cat: '', done: false, slot: null, gone: false, fresh: false, manual: true };
    return { tasks: [...tasks, task], task };
  }

  // 여러 줄을 한꺼번에 직접 추가 (메모·카톡에서 복사한 목록). ☑ 로 시작하는 줄은 완료로 넣음.
  const MAX_PASTE = 100;
  function addManualMany(tasks, text) {
    let cur = tasks;
    const added = [];
    for (const it of parse(text).slice(0, MAX_PASTE)) {
      const r = addManual(cur, it.title);
      if (!r) continue;
      r.task.done = it.done === true;
      cur = r.tasks.map(t => (t.id === r.task.id ? r.task : t));
      added.push(r.task);
    }
    return added.length ? { tasks: cur, added } : null;
  }

  // 전날 못 끝낸 할 일을 오늘로 가져옴: 지워지지 않았고 완료하지 않았고, 오늘 목록에 같은 제목이 없는 것만.
  function carryOver(prevTasks, curTasks) {
    const have = new Set(curTasks.filter(t => !t.gone).map(t => normalize(t.title)));
    const out = [];
    for (const t of prevTasks || []) {
      if (t.gone || t.done) continue;
      const n = normalize(t.title);
      if (!n || have.has(n)) continue;
      have.add(n);
      const id = uid();
      out.push({ id, key: 'manual:' + id, title: t.title, cat: t.cat || '', done: false, slot: null, gone: false, fresh: false, manual: true });
    }
    return out;
  }

  function hasChanges(r) { return r.added + r.removed + r.completed > 0; }

  // 하루는 새벽 2시에 바뀜 (그 전은 전날의 밤)
  function dayOf(date) {
    const d = new Date(date);
    if (d.getHours() < DAY_START) d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---- 날짜(YYYY-MM-DD) 계산: 주·달 달력용 (일요일 시작) ----
  const pad2 = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

  function addDays(key, n) {
    const d = parseKey(key);
    d.setDate(d.getDate() + n);
    return keyOf(d);
  }

  // 같은 날짜로 n달 이동 (없는 날이면 그 달의 마지막 날)
  function addMonths(key, n) {
    const d = parseKey(key);
    const want = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(want, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return keyOf(d);
  }

  // key가 속한 주의 7일 (일~토)
  function weekOf(key) {
    const start = addDays(key, -parseKey(key).getDay());
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }

  // key가 속한 달을 채우는 주들 (앞뒤로 이웃 달 날짜 포함)
  function monthWeeks(key) {
    const d = parseKey(key);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const weeks = [];
    let start = weekOf(keyOf(new Date(d.getFullYear(), d.getMonth(), 1)))[0];
    while (parseKey(start) <= last) {
      weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
      start = addDays(start, 7);
    }
    return weeks;
  }

  // 확장이 보낸 [{title, done}] → parse()와 같은 형태
  // 주소창(#items=…)으로도 들어올 수 있어서 개수와 길이를 제한함
  const MAX_ITEMS = 300;
  function fromItems(items) {
    return withKeys((Array.isArray(items) ? items : [])
      .filter(it => it && typeof it.title === 'string' && it.title.trim())
      .slice(0, MAX_ITEMS)
      .map(it => ({
        title: it.title.trim().slice(0, 200),
        cat: typeof it.cat === 'string' ? it.cat.trim().slice(0, 50) : '',
        done: typeof it.done === 'boolean' ? it.done : null,
      })));
  }

  // 아이폰 단축어가 보낸 캘린더 일정 텍스트 → [{from, to, title}] (분 단위, 하루 0시 기준)
  //   한 줄에 하나: "09:00-10:30 팀 미팅". 시작과 끝이 같으면(종일) 제외.
  const MAX_EVENTS = 100;
  function parseCal(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const m = line.trim().match(/^(\d{1,2}):(\d{2})\s*[-–~]\s*(\d{1,2}):(\d{2})\s+(.+)$/);
      if (!m) continue;
      const [h1, m1, h2, m2] = m.slice(1, 5).map(Number);
      if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59) continue;
      const from = h1 * 60 + m1;
      let to = h2 * 60 + m2;
      if (to === from) continue;                // 종일 일정
      if (to < from) to += 1440;                // 자정을 넘김
      out.push({ from, to, title: m[5].trim().slice(0, 100) });
      if (out.length >= MAX_EVENTS) break;
    }
    return out;
  }

  // Gist에서 받은 원격 상태를 로컬에 반영.
  //  plan: 다른 기기가 저장한 계획 { date, tasks, todoAt, updatedAt }
  //  todo: 확장이 읽은 투두메이트 { date, items, updatedAt, checkedAt }
  // 반환: { state, result(병합 결과 | null), push(원격에 계획을 올려야 하는지) }
  function reconcile(state, remote, day, now) {
    let s = state;
    let result = null;
    let push = false;
    const { plan, todo } = remote || {};

    if (plan && plan.date === day && Array.isArray(plan.tasks) && (plan.updatedAt || 0) > (s.updatedAt || 0)) {
      s = { ...s, tasks: plan.tasks, grid: plan.grid || s.grid || {}, todoAt: plan.todoAt || 0, updatedAt: plan.updatedAt };
    }
    if (todo && todo.date === day) {
      if (todo.checkedAt) s = { ...s, checkedAt: Math.max(s.checkedAt || 0, todo.checkedAt) };
      if ((todo.updatedAt || 0) > (s.todoAt || 0)) {
        result = merge(s.tasks, fromItems(todo.items));
        s = { ...s, tasks: result.tasks, todoAt: todo.updatedAt, syncedAt: todo.updatedAt, updatedAt: now };
        push = true;
      }
    }
    return { state: s, result, push };
  }

  const api = { addManualMany, carryOver, addDays, addMonths, weekOf, monthWeeks, addManual, parseCal, DAY_START, SLOTS, currentSlot, parse, merge, hasChanges, normalize, dayOf, fromItems, reconcile, similarity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Planner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
