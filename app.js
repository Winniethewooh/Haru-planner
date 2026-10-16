(function () {
  const { SLOTS, currentSlot, addDays, addMonths, weekOf, monthWeeks, addManual, parse, parseCal, merge, hasChanges, dayOf, reconcile, fromItems } = window.Planner;
  const Cloud = window.Cloud;
  const TL = window.Timeline;
  const $ = s => document.querySelector(s);
  const STALE_MS = 6 * 60 * 60 * 1000;
  const AUTO_MS = 15 * 60 * 1000;     // 하루를 열 때 이보다 오래됐으면 자동으로 가져옴
  const TODOMATE = 'https://www.todomate.net/';
  const SYNC_GAP_MS = 60 * 1000;

  // ---------- 저장 ----------
  const today = () => dayOf(new Date());
  const read = (k, fallback) => {
    try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch { return fallback; }
  };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  let day = today();          // 지금 보고 있는 날 (기본은 오늘)
  let todayKey = day;         // 실제 오늘
  let state = load(day);
  let openId = null;
  let noticeTimer = null;
  const settings = read('dayplan:settings', {});
  if (settings.autoImport === undefined) settings.autoImport = true;

  function load(d) { return read('dayplan:' + d, { tasks: [], grid: {}, source: '', syncedAt: 0, todoAt: 0, updatedAt: 0, checkedAt: 0 }); }
  function save() { write('dayplan:' + day, state); }

  // 사용자가 계획을 바꿈 → 저장하고 (연결돼 있으면) 다른 기기에도 전송
  function touch() {
    state.updatedAt = Date.now();
    save();
    schedulePush();
  }

  // ---------- 가져오기 ----------
  function applyParsed(parsed, source) {
    const result = merge(state.tasks, parsed);
    state.tasks = result.tasks;
    state.source = source || '';
    state.syncedAt = Date.now();
    touch();
    notify(summary(result) || '변경 없음');
    render();
  }

  function summary(r) {
    return [
      r.added && `새 항목 ${r.added}`,
      r.removed && `삭제 ${r.removed}`,
      r.completed && `완료 ${r.completed}`,
    ].filter(Boolean).join(' · ');
  }

  // 투두메이트 페이지(유저스크립트·북마크릿)가 #items=… 로 넘겨준 목록
  // #sync 는 단축어 등에서 "지금 가져오기"를 요청할 때
  function takeHash() {
    if (location.hash === '#sync') {
      history.replaceState(null, '', location.pathname + location.search);
      // 투두메이트를 여러 번 연달아 닫아도 1분 안에는 한 번만 다녀옴
      const last = Math.max(state.syncedAt || 0, read('dayplan:importAt', 0));
      if (Date.now() - last > SYNC_GAP_MS) startImport();
      return true;
    }
    const c = location.hash.match(/^#cal=(.*)$/);
    if (c) {
      history.replaceState(null, '', location.pathname + location.search);
      try {
        const events = parseCal(decodeURIComponent(c[1]));
        state.cal = { at: Date.now(), events };     // 기기 안에만 저장하고 동기화하지 않음
        save();
        notify(events.length ? `캘린더 일정 ${events.length}개` : '가져올 일정이 없어요');
        render();
      } catch {
        notify('받은 내용을 읽지 못했어요');
      }
      return true;
    }
    const m = location.hash.match(/^#items=(.*)$/);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const { items, via } = JSON.parse(decodeURIComponent(m[1]));
      write('dayplan:grabReady', true);
      if (via === 'userscript') write('dayplan:userscript', true);
      const parsed = fromItems(items);
      state.lastImport = { at: Date.now(), via: via === 'userscript' ? 'userscript' : 'bookmarklet', items: parsed.map(p => ({ title: p.title, done: p.done })) };
      applyParsed(parsed, '');
    } catch {
      notify('받은 내용을 읽지 못했어요');
    }
    return true;
  }

  // 투두메이트 웹으로 갔다가 (유저스크립트가 읽고) 자동으로 돌아옴
  function startImport() {
    write('dayplan:importAt', Date.now());
    location.replace(TODOMATE + '#haru=' + encodeURIComponent(location.origin + location.pathname));
  }

  // 하루를 열 때 마지막으로 가져온 지 오래됐으면 자동으로 다녀옴 (실패해도 15분 안엔 다시 안 함)
  function autoImport() {
    if (!settings.autoImport || !read('dayplan:userscript', false)) return;
    if (document.visibilityState !== 'visible' || sheet.open || day !== today()) return;
    const last = Math.max(state.syncedAt || 0, read('dayplan:importAt', 0));
    if (Date.now() - last > AUTO_MS) startImport();
  }

  // 버튼(북마크릿) 코드: 추출기 + grab.js 를 하나의 javascript: 주소로
  async function bookmarkletCode() {
    const [extractor, grab] = await Promise.all(
      ['extension/extractor.js', 'grab.js'].map(f => fetch(f, { cache: 'no-store' }).then(r => r.text())));
    const planner = location.origin + location.pathname;
    const src = (extractor + '\n' + grab.replace("'__HARU_URL__'", JSON.stringify(planner)))
      .split('\n')
      .filter(l => !/^\s*\/\//.test(l))      // 주석 줄 제거 (주소를 짧게)
      .map(l => l.replace(/\s+\/\/ .*$/, ''))
      .join('\n');
    return 'javascript:' + encodeURIComponent(src);
  }

  // ---------- 기기 간 동기화 (선택, Gist) ----------
  let pushTimer = null;
  let pulling = false;

  function schedulePush() {
    if (!Cloud.connected() || day !== today()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 1500);
  }

  async function push() {
    if (day !== today()) return;
    try {
      await Cloud.push({ date: day, tasks: state.tasks, grid: state.grid || {}, todoAt: state.todoAt || 0, updatedAt: state.updatedAt || 0 });
    } catch (e) {
      notify('동기화 실패 · ' + e.message);
    }
  }

  // 앱을 열 때만 확인
  async function pull() {
    if (!Cloud.connected() || pulling) return;
    pulling = true;
    try {
      const pulledFor = day;
      const remote = await Cloud.pull();
      if (pulledFor !== day) return;
      const r = reconcile(state, remote, day, Date.now());
      if (r.state !== state) {
        state = r.state;
        save();
        render();
      }
      if (r.result && hasChanges(r.result)) notify('투두메이트 · ' + summary(r.result));
      if (r.push) push();
    } catch (e) {
      console.warn('pull failed', e);
    } finally {
      pulling = false;
    }
  }

  // ---------- 알림 줄 ----------
  function notify(text) {
    clearTimeout(noticeTimer);
    $('#noticeText').textContent = text;
    $('#notice').hidden = false;
    noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 4000);
  }

  // ---------- 렌더 ----------
  function ago(ms) {
    const m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return '방금';
    if (m < 60) return `${m}분 전`;
    return `${Math.floor(m / 60)}시간 전`;
  }

  function render() {
    const [y, mo, d] = day.split('-').map(Number);
    const date = new Date(y, mo - 1, d);
    $('#date').textContent = `${mo}월 ${d}일 ${'일월화수목금토'[date.getDay()]}요일`;

    const at = Math.max(state.syncedAt || 0, state.checkedAt || 0);
    $('#syncInfo').textContent = at ? ago(at) : '';
    const isToday = day === today();
    $('#importBtn').classList.toggle('stale', isToday && (!at || Date.now() - at > STALE_MS));
    renderCal();

    const now = isToday ? currentSlot(new Date()) : null;      // 지난·다음 날에는 '지금' 표시 없음
    const nowIdx = SLOTS.findIndex(s => s.id === now);
    const container = $('#slots');
    container.innerHTML = '';

    const inbox = $('#inbox');
    const unassigned = state.tasks.filter(t => !t.slot);
    fill(inbox, unassigned);
    inbox.classList.toggle('has', unassigned.length > 0);

    SLOTS.forEach((s, i) => {
      const sec = document.createElement('section');
      sec.className = 'slot' + (s.id === now ? ' now' : '') + (i < nowIdx ? ' past' : '');
      sec.dataset.slot = s.id;
      const to = s.to % 24;
      sec.innerHTML = `<h2>${s.label}<span class="range">${s.from}–${to}시</span><span class="count"></span></h2><ul></ul>`;
      fill(sec, state.tasks.filter(t => t.slot === s.id));
      container.appendChild(sec);
    });

    const empty = state.tasks.length === 0;
    $('#empty').hidden = !empty;
    $('#emptyToday').hidden = !isToday;
    $('#emptyOther').hidden = isToday;
    container.hidden = empty;
    renderTime();
  }

  // ---------- 날짜 보기: 주 / 월 ----------
  let calMode = read('dayplan:calMode', 'week');
  const WEEKDAYS = '일월화수목금토';
  const keyParts = k => k.split('-').map(Number);

  // 그날 기록 요약 (점 표시용): 할 일이 있는지, 모두 끝냈는지
  function peek(key) {
    const s = key === day ? state : read('dayplan:' + key, null);
    const live = s && Array.isArray(s.tasks) ? s.tasks.filter(t => !t.gone) : [];
    const has = live.length > 0 || (s && s.grid && Object.keys(s.grid).length > 0);
    return { has, allDone: live.length > 0 && live.every(t => t.done) };
  }

  function setDay(key) {
    if (key === day) return;
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; push(); }   // 보던 날이 오늘이면 마지막 수정은 먼저 보냄
    closePick();
    closeEdit();
    openId = null;
    day = key;
    state = load(day);
    render();
  }

  function renderCal() {
    const [y, m] = keyParts(day);
    const thisYear = keyParts(todayKey)[0];
    $('#calTitle').firstChild.textContent = (y === thisYear ? '' : y + '년 ') + m + '월 ';
    $('#calTitle').classList.toggle('open', calMode === 'month');
    $('#calToday').hidden = day === todayKey;

    const grid = $('#calGrid');
    grid.innerHTML = '';
    for (const w of WEEKDAYS) {
      const h = document.createElement('span');
      h.className = 'wd';
      h.textContent = w;
      grid.appendChild(h);
    }
    const weeks = calMode === 'month' ? monthWeeks(day) : [weekOf(day)];
    for (const week of weeks) {
      for (const key of week) {
        const [, km, kd] = keyParts(key);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cd' + (key === day ? ' sel' : '') + (key === todayKey ? ' today' : '') + (calMode === 'month' && km !== m ? ' out' : '');
        const info = peek(key);
        b.innerHTML = '<span></span><i></i>';
        b.firstChild.textContent = kd;
        if (info.has) b.classList.add(info.allDone ? 'full' : 'has');
        b.setAttribute('aria-label', `${km}월 ${kd}일`);
        b.setAttribute('aria-pressed', key === day ? 'true' : 'false');
        b.onclick = () => setDay(key);
        grid.appendChild(b);
      }
    }
  }
  $('#calTitle').onclick = () => {
    calMode = calMode === 'week' ? 'month' : 'week';
    write('dayplan:calMode', calMode);
    renderCal();
  };
  $('#calPrev').onclick = () => setDay(calMode === 'month' ? addMonths(day, -1) : addDays(day, -7));
  $('#calNext').onclick = () => setDay(calMode === 'month' ? addMonths(day, 1) : addDays(day, 7));
  $('#calToday').onclick = () => setDay(todayKey);

  // ---------- 시간표 ----------
  let tab = read('dayplan:tab', 'plan');
  let sel = null;        // 고른 시간 범위 { a, b } (칸 번호)
  let calRows = {};      // 줄별 캘린더 일정 조각

  const ROW_HEIGHTS = [24, 32, 44, 60];      // 좁게 · 보통 · 넓게 · 아주 넓게
  const colorOf = t => (typeof t.color === 'number' ? t.color : 0);
  const selRange = () => (sel ? [Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)] : null);

  function drawSel() {
    const r = selRange();
    document.querySelectorAll('#grid .cell').forEach(c => {
      const i = +c.dataset.i;
      c.classList.toggle('sel', !!r && i >= r[0] && i <= r[1]);
    });
  }

  function renderTime() {
    $('#planView').hidden = tab !== 'plan';
    $('#timeView').hidden = tab !== 'time';
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab !== 'time') return;

    const live = state.tasks.filter(t => !t.gone);
    // 색은 처음 보일 때 한 번 정해 두고 계속 씀
    let assigned = false;
    for (const t of live) {
      if (typeof t.color === 'number') continue;
      t.color = TL.pickColor(live.map(x => x.color).filter(c => typeof c === 'number'));
      assigned = true;
    }
    if (assigned) save();

    $('#gridHint').textContent = live.length ? '시간을 눌러 고르거나 끌어서 범위를 정한 뒤, 할 일을 선택해요.' : '계획 탭에 할 일이 생기면 여기서 시간을 정할 수 있어요.';

    calRows = {};
    for (const ev of (state.cal && state.cal.events) || []) {
      const span = TL.eventSpan(ev);
      if (!span) continue;
      for (const sp of TL.spanRows(span[0], span[1])) (calRows[sp.row] = calRows[sp.row] || []).push({ ...sp, title: ev.title });
    }
    $('#gridHint').textContent += calRows && Object.keys(calRows).length ? ' 회색 블록은 아이폰 캘린더 일정이에요.' : '';

    const rowH = settings.rowH || 32;
    const grid = $('#grid');
    grid.style.setProperty('--rowh', rowH + 'px');
    grid.innerHTML = '';
    for (let r = 0; r < TL.ROWS; r++) {
      const row = document.createElement('div');
      row.className = 'grow';
      const { n, ap } = TL.hourLabel(TL.hourOfRow(r));
      const lab = document.createElement('span');
      lab.className = 'hour';
      lab.innerHTML = '<b></b><small></small>';
      lab.children[0].textContent = n;
      lab.children[1].textContent = ap;
      const cells = document.createElement('div');
      cells.className = 'cells';
      for (let c = 0; c < TL.PER_ROW; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.i = r * TL.PER_ROW + c;
        cell.style.gridArea = `1 / ${c + 1}`;     // 블록이 겹쳐도 칸 위치는 그대로
        cells.appendChild(cell);
      }
      row.append(lab, cells);
      grid.appendChild(row);
      drawRow(r);
    }
    drawNow();
    drawSel();
  }

  // 한 줄의 덩어리(파스텔 블록 + 이름)를 다시 그림
  function drawRow(r) {
    const cells = $('#grid').children[r] && $('#grid').children[r].querySelector('.cells');
    if (!cells) return;
    cells.querySelectorAll('.seg, .ev').forEach(s => s.remove());
    for (const sp of calRows[r] || []) {
      const ev = document.createElement('div');
      ev.className = 'ev' + (sp.start ? ' start' : '') + (sp.to === TL.PER_ROW ? ' last' : '');
      ev.style.gridColumn = `${sp.from + 1} / ${sp.to + 1}`;
      ev.textContent = sp.title;
      cells.appendChild(ev);
    }
    const byId = new Map(state.tasks.map(t => [t.id, t]));
    const g = viewGrid || state.grid || {};
    for (const run of TL.runs(g, r)) {
      const t = byId.get(run.id);
      if (!t) continue;
      const seg = document.createElement('div');
      seg.className = 'seg' + (run.start ? ' start' : '') + (run.to === TL.PER_ROW ? ' last' : '');
      seg.style.gridColumn = `${run.from + 1} / ${run.to + 1}`;
      seg.style.setProperty('--c', `var(--c${colorOf(t)})`);
      seg.textContent = t.title;
      if (t.done) seg.classList.add('done');
      if (edit && run.id === edit.id) {       // 편집 중인 덩어리는 테두리로 띄움
        if (r * TL.PER_ROW + run.from <= edit.hi && r * TL.PER_ROW + run.to - 1 >= edit.lo) seg.classList.add('lift');
      }
      cells.appendChild(seg);
    }
  }

  // 현재 시각: 왼쪽에 빨간 알약
  function drawNow() {
    const grid = $('#grid');
    grid.querySelectorAll('.nowpill').forEach(n => n.remove());
    grid.querySelectorAll('.cell.nowcell').forEach(c => c.classList.remove('nowcell'));
    const d = new Date();
    if (today() !== day) return;
    const idx = TL.cellOf(d);
    const row = grid.children[Math.floor(idx / TL.PER_ROW)];
    if (!row) return;
    const pill = document.createElement('span');
    pill.className = 'nowpill';
    pill.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    pill.style.top = (d.getMinutes() % 60) / 60 * 100 + '%';
    row.appendChild(pill);
    row.querySelector(`.cell[data-i="${idx}"]`).classList.add('nowcell');   // 지금 10분 칸에 빗금
  }

  // ---------- 시간 범위 고르기 → 할 일 선택 ----------
  const timeText = i => {
    const m = TL.START_HOUR * 60 + i * TL.CELL_MIN;
    return `${Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, '0')}`;
  };

  // 하루 시간대(오전·오후·저녁·밤) 알아내기: 칸 번호 → 시각
  const slotAt = i => currentSlot(new Date(2000, 0, 1, Math.floor((TL.START_HOUR * 60 + i * TL.CELL_MIN) / 60) % 24));

  function optButton(t, sums) {
    const o = document.createElement('button');
    o.className = 'opt';
    o.style.setProperty('--c', `var(--c${colorOf(t)})`);
    o.innerHTML = '<i></i><span></span><em></em>';
    o.children[1].textContent = t.title;
    o.children[2].textContent = sums[t.id] ? TL.fmt(sums[t.id]) : '';
    o.onclick = () => assignRange(t.id);
    return o;
  }

  // 고른 시간에 넣을 할 일 목록: 아직 시간표에 없는 투두메이트 항목을 먼저 보여줌
  function openPick() {
    const [a, b] = selRange();
    const live = state.tasks.filter(t => !t.gone);
    const placed = new Set(Object.values(state.grid || {}));
    const byDone = (x, y) => (x.done ? 1 : 0) - (y.done ? 1 : 0);
    const todo = live.filter(t => !placed.has(t.id)).sort(byDone);
    const other = live.filter(t => placed.has(t.id));
    const sums = TL.totals(state.grid);
    const box = $('#pickList');
    box.innerHTML = '';
    clearAdd('#pickAdd', '#pickAddInput');
    $('#pickTitle').textContent = `${timeText(a)} – ${timeText(b + 1)}`;
    $('#pickSub').textContent = TL.fmt((b - a + 1) * TL.CELL_MIN);

    const label = text => {
      const p = document.createElement('p');
      p.className = 'pick-label';
      p.textContent = text;
      return p;
    };
    if (todo.length) {
      box.appendChild(label(`아직 시간표에 없는 할 일 ${todo.length}개`));
      todo.forEach(t => box.appendChild(optButton(t, sums)));
    } else {
      const p = document.createElement('p');
      p.className = 'muted small pick-empty';
      p.textContent = live.length ? '모든 할 일이 시간표에 들어 있어요.' : '선택할 할 일이 없어요.';
      box.appendChild(p);
    }
    if (other.length) {
      const wrap = document.createElement('div');
      wrap.hidden = todo.length > 0;
      wrap.appendChild(label('이미 시간표에 있는 할 일'));
      other.forEach(t => wrap.appendChild(optButton(t, sums)));
      if (todo.length) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'link muted small pick-more';
        more.textContent = '이미 넣은 할 일에도 시간 더하기';
        more.onclick = () => { wrap.hidden = false; more.remove(); };
        box.appendChild(more);
      }
      box.appendChild(wrap);
    }
    let painted = false;
    for (let i = a; i <= b; i++) if (state.grid[i]) painted = true;
    $('#pickClear').hidden = !painted;
    $('#pick').hidden = false;
  }

  // 직접 추가: 이름을 입력하면 새 할 일을 만들고 고른 시간에 바로 넣음
  $('#pickAdd').addEventListener('submit', e => {
    e.preventDefault();
    const r = addManual(state.tasks, $('#pickAddInput').value);
    clearAdd('#pickAdd', '#pickAddInput');
    if (!r || !sel) return;
    state.tasks = r.tasks;
    assignRange(r.task.id);
  });

  function closePick() {
    $('#pick').hidden = true;
    sel = null;
    drawSel();
  }

  // 고른 시간에 할 일을 넣음. 시간대가 비어 있던 할 일은 그 시각의 시간대로 배정됨.
  function assignRange(id) {
    const [a, b] = selRange();
    for (let i = a; i <= b; i++) state.grid = TL.paint(state.grid, i, id);
    if (id) {
      state.tasks = state.tasks.map(t => (t.id === id ? { ...t, slot: t.slot || slotAt(a), fresh: false } : t));
    }
    sel = null;
    $('#pick').hidden = true;
    touch();
    render();
  }

  // ---------- 넣어 둔 일정 눌러서 편집 ----------
  let editIdx = null;    // 누른 칸 번호

  function openEdit(idx) {
    const t = state.tasks.find(x => x.id === state.grid[idx]);
    if (!t) return;
    editIdx = idx;
    sel = null;              // 누른 칸의 선택 표시는 지움
    drawSel();
    const [a, b] = TL.blockAt(state.grid, idx);
    $('#editTitle').textContent = t.title;
    $('#editSub').textContent = `${timeText(a)} – ${timeText(b + 1)} · ${TL.fmt((b - a + 1) * TL.CELL_MIN)}`;
    $('#editDone').classList.toggle('done', !!t.done);
    $('#editDone').setAttribute('aria-pressed', t.done ? 'true' : 'false');
    const box = $('#editColors');
    box.innerHTML = '';
    for (let c = 0; c < TL.COLORS; c++) {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'dot' + (colorOf(t) === c ? ' on' : '');
      d.style.setProperty('--c', `var(--c${c})`);
      d.setAttribute('aria-label', `색 ${c + 1}`);
      d.onclick = () => { patchTask(t.id, { color: c }); openEdit(idx); };
      box.appendChild(d);
    }
    $('#edit').hidden = false;
  }

  function patchTask(id, patch) {
    state.tasks = state.tasks.map(x => (x.id === id ? { ...x, ...patch } : x));
    touch();
    renderTime();
    if (tab === 'plan') render();
  }

  function closeEdit() {
    $('#edit').hidden = true;
    editIdx = null;
    sel = null;
    drawSel();
  }

  $('#editDone').onclick = () => {
    const t = state.tasks.find(x => x.id === state.grid[editIdx]);
    if (!t) return;
    patchTask(t.id, { done: !t.done });
    render();
    openEdit(editIdx);
  };
  $('#editClear').onclick = () => {
    const blk = TL.blockAt(state.grid, editIdx);
    if (blk) for (let i = blk[0]; i <= blk[1]; i++) state.grid = TL.paint(state.grid, i, null);
    closeEdit();
    touch();
    renderTime();
  };
  $('#editClose').onclick = closeEdit;
  document.querySelector('#edit .pick-backdrop').onclick = closeEdit;

  // ---------- 칸 누르기·끌기 / 길게 눌러 옮기기·늘이기 ----------
  //  - 칸을 누르거나 끌면 시간 범위를 고름 → 할 일 목록
  //  - 넣어 둔 블록을 길게(0.45초) 누른 채 끌면 블록이 통째로 따라와서 놓은 시간으로 옮겨짐
  //  - 블록의 앞·뒤 가장자리를 길게 누른 채 끌면 그쪽 시간이 늘어나거나 줄어듦
  const LONG_MS = 450;
  const EDGE = 0.35;     // 칸 너비 중 바깥쪽 35%가 가장자리
  let down = null;       // 누르고 있는 중
  let edit = null;       // 옮기거나 늘이는 중 { kind: 'move'|'start'|'end', id, a, b, idx, off, lo, hi }
  let viewGrid = null;   // 편집하는 동안 보여줄 미리보기
  let last = { x: 0, y: 0 };
  let scrollTimer = null;

  function cellAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.classList && el.classList.contains('cell') ? el : null;
  }
  const redrawAll = () => { for (let r = 0; r < TL.ROWS; r++) drawRow(r); };

  // 누른 자리가 블록의 앞/뒤 가장자리인지 (아니면 통째로 옮기기)
  function kindAt(blk, idx, x, rect) {
    const rel = (x - rect.left) / rect.width;
    if (idx === blk[0] && rel < EDGE) return 'start';
    if (idx === blk[1] && rel > 1 - EDGE) return 'end';
    return 'move';
  }

  function startEdit() {
    if (!down) return;
    const blk = TL.blockAt(state.grid, down.idx);
    if (!blk) return;
    edit = { kind: down.kind, id: state.grid[down.idx], a: blk[0], b: blk[1], idx: down.idx, off: 0, lo: blk[0], hi: blk[1] };
    sel = null;
    drawSel();
    viewGrid = state.grid;
    $('#grid').classList.add('moving');
    $('#gridHint').textContent = edit.kind === 'move' ? '옮길 시간으로 끌어서 놓으세요.' : '늘리거나 줄일 시간까지 끌어서 놓으세요.';
    if (navigator.vibrate) navigator.vibrate(12);
    redrawAll();
    // 화면 위·아래 끝으로 끌면 스크롤
    scrollTimer = setInterval(() => {
      const edge = 70;
      const dy = last.y < edge ? -14 : last.y > window.innerHeight - edge ? 14 : 0;
      if (dy) { window.scrollBy(0, dy); updateEdit(last.x, last.y); }
    }, 16);
  }

  function updateEdit(x, y) {
    const el = cellAt(x, y);
    if (!el || !edit) return;
    const i = +el.dataset.i;
    let lo, hi, next;
    if (edit.kind === 'move') {
      const off = Math.max(-edit.a, Math.min(TL.CELLS - 1 - edit.b, i - edit.idx));
      lo = edit.a + off;
      hi = edit.b + off;
      next = () => TL.moveBlock(state.grid, edit.a, edit.b, off);
    } else if (edit.kind === 'start') {
      lo = Math.min(i, edit.b);
      hi = edit.b;
      next = () => TL.resizeBlock(state.grid, edit.a, edit.b, lo, hi);
    } else {
      lo = edit.a;
      hi = Math.max(i, edit.a);
      next = () => TL.resizeBlock(state.grid, edit.a, edit.b, lo, hi);
    }
    if (lo === edit.lo && hi === edit.hi) return;
    edit.lo = lo;
    edit.hi = hi;
    viewGrid = next();
    redrawAll();
  }

  function finishEdit(commit) {
    clearInterval(scrollTimer);
    const done = edit;
    const result = viewGrid;
    edit = null;
    viewGrid = null;
    $('#grid').classList.remove('moving');
    if (commit && done && result && (done.lo !== done.a || done.hi !== done.b)) {
      state.grid = result;
      touch();
    }
    renderTime();
  }

  $('#grid').addEventListener('pointerdown', e => {
    const el = e.target.closest('.cell');
    if (!el) return;
    e.preventDefault();
    if (!state.grid) state.grid = {};
    const idx = +el.dataset.i;
    $('#pick').hidden = true;
    $('#edit').hidden = true;
    last = { x: e.clientX, y: e.clientY };
    down = { x: e.clientX, y: e.clientY, idx, kind: null, timer: null };
    const blk = TL.blockAt(state.grid, idx);
    if (blk) {
      down.kind = kindAt(blk, idx, e.clientX, el.getBoundingClientRect());
      down.timer = setTimeout(startEdit, LONG_MS);
    }
    sel = { a: idx, b: idx };
    drawSel();
  });
  $('#grid').addEventListener('pointermove', e => {
    if (!down) return;
    last = { x: e.clientX, y: e.clientY };
    if (edit) return updateEdit(e.clientX, e.clientY);
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) clearTimeout(down.timer);
    const el = cellAt(e.clientX, e.clientY);
    if (el && sel && +el.dataset.i !== sel.b) { sel.b = +el.dataset.i; drawSel(); }
  });
  const endDrag = cancel => {
    if (!down) return;
    clearTimeout(down.timer);
    down = null;
    if (edit) return finishEdit(!cancel);
    if (cancel) return closePick();
    if (!sel) return;
    if (sel.a === sel.b && state.grid[sel.a]) openEdit(sel.a);   // 넣어 둔 일정을 한 번 누름 → 편집
    else openPick();
  };
  window.addEventListener('pointerup', () => endDrag(false));
  window.addEventListener('pointercancel', () => endDrag(true));
  $('#pickClear').onclick = () => assignRange(null);
  $('#pickCancel').onclick = closePick;
  document.querySelector('.pick-backdrop').onclick = closePick;

  document.querySelectorAll('.tabs button').forEach(b => {
    b.onclick = () => { tab = b.dataset.tab; write('dayplan:tab', tab); closePick(); closeEdit(); renderTime(); };
  });
  window.addEventListener('resize', () => { if (tab === 'time' && !down && !sel) renderTime(); });

  function fill(section, tasks) {
    const ul = section.querySelector('ul');
    ul.innerHTML = '';
    const live = tasks.filter(t => !t.gone);
    section.querySelector('.count').textContent = live.length ? `${live.filter(t => t.done).length}/${live.length}` : '';
    for (const t of tasks) ul.appendChild(row(t));
  }

  function row(t) {
    const li = document.createElement('li');
    li.className = [t.done && 'done', t.fresh && 'fresh', t.gone && 'gone'].filter(Boolean).join(' ');

    const div = document.createElement('div');
    div.className = 'task';
    div.draggable = true;
    div.dataset.id = t.id;

    const check = document.createElement('button');
    check.className = 'check';
    check.setAttribute('aria-label', t.done ? '완료 취소' : '완료');
    check.onclick = e => { e.stopPropagation(); update(t.id, { done: !t.done }); };

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = t.title;
    if (t.cat) {
      const cat = document.createElement('span');
      cat.className = 'cat';
      cat.textContent = t.cat;
      title.appendChild(cat);
    }

    div.append(check, title);

    if (t.gone) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '삭제됨';
      const x = document.createElement('button');
      x.className = 'x';
      x.textContent = '×';
      x.setAttribute('aria-label', '목록에서 지우기');
      x.onclick = e => { e.stopPropagation(); remove(t.id); };
      div.append(tag, x);
    }

    div.onclick = () => { openId = openId === t.id ? null : t.id; render(); };
    div.ondragstart = e => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; };
    li.appendChild(div);

    if (openId === t.id) li.appendChild(picker(t));
    return li;
  }

  function picker(t) {
    const wrap = document.createElement('div');
    wrap.className = 'picker';
    for (const s of [...SLOTS, { id: null, label: '미배정' }]) {
      const b = document.createElement('button');
      b.textContent = s.label;
      if ((t.slot || null) === s.id) b.className = 'on';
      b.onclick = () => { openId = null; update(t.id, { slot: s.id, fresh: false }); };
      wrap.appendChild(b);
    }
    if (t.manual) {       // 직접 추가한 항목만 지울 수 있음 (투두메이트 항목은 투두메이트에서 지움)
      const del = document.createElement('button');
      del.textContent = '삭제';
      del.className = 'del';
      del.onclick = () => { openId = null; remove(t.id); };
      wrap.appendChild(del);
    }
    return wrap;
  }

  // 입력 중일 때만 '추가' 글자를 보여줌
  for (const [form, input] of [['#addForm', '#addInput'], ['#pickAdd', '#pickAddInput']]) {
    $(input).addEventListener('input', () => $(form).classList.toggle('has', !!$(input).value.trim()));
  }
  const clearAdd = (form, input) => { $(input).value = ''; $(form).classList.remove('has'); };

  // 계획 탭에서 직접 추가: 미배정에 들어감
  $('#addForm').addEventListener('submit', e => {
    e.preventDefault();
    const r = addManual(state.tasks, $('#addInput').value);
    clearAdd('#addForm', '#addInput');
    if (!r) return;
    state.tasks = r.tasks;
    touch();
    render();
  });

  function update(id, patch) {
    state.tasks = state.tasks.map(t => (t.id === id ? { ...t, ...patch } : t));
    touch();
    render();
  }

  function remove(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    state.grid = TL.prune(state.grid, state.tasks.map(t => t.id));
    touch();
    render();
  }

  // ---------- 드래그 (데스크톱) ----------
  document.addEventListener('dragover', e => {
    const sec = e.target.closest('.slot');
    document.querySelectorAll('.slot.drop').forEach(s => s !== sec && s.classList.remove('drop'));
    if (!sec) return;
    e.preventDefault();
    sec.classList.add('drop');
  });
  document.addEventListener('drop', e => {
    const sec = e.target.closest('.slot');
    document.querySelectorAll('.slot.drop').forEach(s => s.classList.remove('drop'));
    if (!sec) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    update(id, { slot: sec.dataset.slot || null, fresh: false });
  });

  // ---------- 시트 ----------
  const sheet = $('#sheet');
  function openSheet() {
    $('#autoImport').checked = settings.autoImport;
    showRowH();
    showStatus();
    $('#userscriptOk').hidden = !read('dayplan:userscript', false);
    $('#source').value = state.source;
    renderCloud();
    if (!sheet.open) sheet.showModal();
  }
  function closeSheet() {
    if (sheet.open) sheet.close();
  }

  $('#importBtn').onclick = () => {
    if (read('dayplan:grabReady', false)) startImport();
    else openSheet();
  };
  $('#importNow').onclick = startImport;
  $('#copySyncUrl').onclick = async () => {
    const url = location.origin + location.pathname + '#sync';
    try {
      await navigator.clipboard.writeText(url);
      $('#copySyncUrl').textContent = '복사됨';
      setTimeout(() => { $('#copySyncUrl').textContent = '주소 복사'; }, 2000);
    } catch {
      prompt('단축어에 넣을 주소', url);
    }
  };
  $('#copyCalUrl').onclick = async () => {
    const url = location.origin + location.pathname + '#cal=';
    try {
      await navigator.clipboard.writeText(url);
      $('#copyCalUrl').textContent = '복사됨';
      setTimeout(() => { $('#copyCalUrl').textContent = '주소 복사'; }, 2000);
    } catch {
      prompt('단축어 URL 앞부분', url);
    }
  };
  $('#sheet form').addEventListener('submit', e => e.preventDefault());
  $('#autoImport').onchange = e => {
    settings.autoImport = e.target.checked;
    write('dayplan:settings', settings);
  };
  // 연동 점검: 가져오기가 실제로 됐는지 눈으로 확인
  function showStatus() {
    const li = state.lastImport;
    $('#stUser').textContent = read('dayplan:userscript', false) ? '연결됨 ✓' : '아직 확인 안 됨';
    $('#stLast').textContent = li ? `${ago(li.at)} · ${li.via === 'userscript' ? 'Userscripts' : '북마크 버튼'}` : '아직 없음';
    $('#stCount').textContent = li ? `할 일 ${li.items.length}개 · 완료 ${li.items.filter(x => x.done).length}개` : '-';
    const list = $('#stList');
    list.innerHTML = '';
    for (const it of (li && li.items) || []) {
      const row = document.createElement('li');
      row.textContent = (it.done ? '✓ ' : it.done === false ? '○ ' : '· ') + it.title;
      list.appendChild(row);
    }
    $('#stListWrap').hidden = !(li && li.items.length);
    const cal = state.cal;
    $('#stCal').textContent = cal ? `일정 ${cal.events.length}개 · ${ago(cal.at)}` : '연결 안 됨';
    $('#stCloud').textContent = Cloud.connected() ? '연결됨' : '꺼짐';
  }

  function showRowH() {
    const cur = settings.rowH || 32;
    const near = ROW_HEIGHTS.reduce((p, x) => (Math.abs(x - cur) < Math.abs(p - cur) ? x : p));
    document.querySelectorAll('#rowChoice button').forEach(b => b.classList.toggle('on', +b.dataset.h === near));
  }
  document.querySelectorAll('#rowChoice button').forEach(b => {
    b.onclick = () => {
      settings.rowH = +b.dataset.h;
      write('dayplan:settings', settings);
      showRowH();
      if (!down && !sel) renderTime();
    };
  });
  $('#emptyImport').onclick = openSheet;
  $('#syncInfo').onclick = openSheet;
  $('#settingsBtn').onclick = openSheet;
  $('#copyButton').onclick = async () => {
    const btn = $('#copyButton');
    try {
      const code = await bookmarkletCode();
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        $('#codeBox').hidden = false;
        $('#codeBox').value = code;
        $('#codeBox').select();
        return;
      }
      btn.textContent = '복사됨';
      setTimeout(() => { btn.textContent = '버튼 코드 복사'; }, 2000);
    } catch {
      notify('코드를 만들지 못했어요');
    }
  };
  $('#pasteApply').onclick = () => {
    applyParsed(parse($('#source').value), $('#source').value);
    closeSheet();
  };
  $('#sheetClose').onclick = closeSheet;

  function renderCloud(error) {
    const on = Cloud.connected();
    $('#cloudOff').hidden = on;
    $('#cloudOn').hidden = !on;
    $('#cloudError').hidden = !error;
    $('#cloudError').textContent = error || '';
  }

  $('#cloudConnect').onclick = async () => {
    const input = $('#cloudInput').value;
    if (!input.trim()) return;
    $('#cloudConnect').disabled = true;
    try {
      await Cloud.connect(input);
      $('#cloudInput').value = '';
      renderCloud();
      await pull();
      if (state.tasks.length) push();
      render();
    } catch (e) {
      renderCloud(e.message);
    } finally {
      $('#cloudConnect').disabled = false;
    }
  };
  $('#cloudCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(Cloud.code());
      $('#cloudCopy').textContent = '복사됨';
      setTimeout(() => { $('#cloudCopy').textContent = '연결 코드 복사'; }, 1500);
    } catch {
      prompt('연결 코드', Cloud.code());
    }
  };
  $('#cloudDisconnect').onclick = () => { Cloud.disconnect(); renderCloud(); render(); };

  $('#noticeClose').onclick = () => { $('#notice').hidden = true; };

  // ---------- 날짜 넘어감 · 앱 복귀 ----------
  function tick() {
    const d = today();
    if (d !== todayKey) {
      if (day === todayKey) { day = d; state = load(day); openId = null; }   // 오늘을 보고 있었다면 새 오늘로
      todayKey = d;
    }
    render();
  }
  setInterval(tick, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { tick(); pull(); autoImport(); }
  });

  window.addEventListener('hashchange', takeHash);
  render();
  if (!takeHash()) autoImport();
  pull();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
