// 시간표: 하루를 10분 칸 144개(6칸 × 24줄)로 나눠 할 일별로 칠함.
// grid 는 { [칸 번호]: 할 일 id }. 칸 0 = 하루의 시작(오전 6시).
(function (root) {
  const START_HOUR = 6;     // 하루 시작 (화면 맨 위 줄). 맨 아래 줄은 새벽 1시대, 2시에 하루가 끝남
  const PER_ROW = 6;
  const ROWS = 20;
  const CELLS = PER_ROW * ROWS;
  const CELL_MIN = 10;
  const COLORS = 8;

  const hourOfRow = row => (START_HOUR + row) % 24;

  // 시각 → 칸 번호 (새벽 2~6시처럼 표 밖이면 CELLS 이상의 값)
  function cellOf(date) {
    const mins = ((date.getHours() - START_HOUR + 24) % 24) * 60 + date.getMinutes();
    return Math.floor(mins / CELL_MIN);
  }

  // 칠하기 / 지우기. 원본은 건드리지 않음.
  function paint(grid, idx, id) {
    if (!(idx >= 0 && idx < CELLS)) return grid;
    const next = { ...grid };
    if (id) next[idx] = id; else delete next[idx];
    return next;
  }

  // 할 일별 칠한 분
  function totals(grid) {
    const out = {};
    for (const id of Object.values(grid || {})) out[id] = (out[id] || 0) + CELL_MIN;
    return out;
  }

  // 지워진 할 일의 칸 정리
  function prune(grid, ids) {
    const keep = new Set(ids);
    const next = {};
    for (const [i, id] of Object.entries(grid || {})) if (keep.has(id)) next[i] = id;
    return next;
  }

  function fmt(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return h && m ? `${h}시간 ${m}분` : h ? `${h}시간` : `${m}분`;
  }

  // 아직 쓰이지 않는 색 번호 (다 쓰였으면 가장 적게 쓰인 색)
  function pickColor(used) {
    const count = Array(COLORS).fill(0);
    for (const c of used) if (c >= 0 && c < COLORS) count[c]++;
    return count.indexOf(Math.min(...count));
  }

  // 한 줄 안에서 이어 칠한 칸을 덩어리로 묶음. start: 이 덩어리가 여기서 시작하는지(앞 칸이 다른 색/빈칸)
  function runs(grid, row) {
    const out = [];
    for (let c = 0; c < PER_ROW; c++) {
      const idx = row * PER_ROW + c;
      const id = grid[idx];
      if (!id) continue;
      const last = out[out.length - 1];
      if (last && last.id === id && last.to === c) { last.to = c + 1; continue; }
      out.push({ id, from: c, to: c + 1, start: grid[idx - 1] !== id });
    }
    return out;
  }

  // 9 AM / 12 PM / 12 AM
  function hourLabel(h) {
    return { n: h % 12 || 12, ap: h < 12 ? 'AM' : 'PM' };
  }

  // 일정(분 단위 from~to) → 시간표 칸 범위 [a, b). 표 밖이면 null.
  function eventSpan(ev) {
    const rel = ((ev.from - START_HOUR * 60) % 1440 + 1440) % 1440;
    const a = Math.floor(rel / CELL_MIN);
    const b = Math.min(CELLS, Math.ceil((rel + (ev.to - ev.from)) / CELL_MIN));
    return a >= CELLS || b <= a ? null : [a, b];
  }

  // 칸 범위를 줄 단위로 쪼갬. start: 이 조각이 일정의 시작인지
  function spanRows(a, b) {
    const out = [];
    for (let i = a; i < b;) {
      const row = Math.floor(i / PER_ROW);
      const end = Math.min(b, (row + 1) * PER_ROW);
      out.push({ row, from: i - row * PER_ROW, to: end - row * PER_ROW, start: i === a });
      i = end;
    }
    return out;
  }

  // idx 칸을 포함해 같은 할 일로 이어 칠한 덩어리의 [시작, 끝] (줄이 바뀌어도 이어짐)
  function blockAt(grid, idx) {
    const id = grid[idx];
    if (!id) return null;
    let a = idx, b = idx;
    while (grid[a - 1] === id) a--;
    while (grid[b + 1] === id) b++;
    return [a, b];
  }

  // [a, b] 덩어리를 off칸 옮김. 표 밖으로는 못 나가고, 도착한 자리의 다른 할 일은 덮어씀.
  function moveBlock(grid, a, b, off) {
    off = Math.max(-a, Math.min(CELLS - 1 - b, off));
    if (!off) return grid;
    const id = grid[a];
    const next = { ...grid };
    for (let i = a; i <= b; i++) delete next[i];
    for (let i = a; i <= b; i++) next[i + off] = id;
    return next;
  }

  // [a, b] 덩어리의 시간을 [na, nb]로 늘이거나 줄임. 표 밖은 자르고, 늘어난 자리의 다른 할 일은 덮어씀.
  function resizeBlock(grid, a, b, na, nb) {
    na = Math.max(0, Math.min(na, nb));
    nb = Math.min(CELLS - 1, Math.max(na, nb));
    if (na === a && nb === b) return grid;
    const id = grid[a];
    const next = { ...grid };
    for (let i = a; i <= b; i++) delete next[i];
    for (let i = na; i <= nb; i++) next[i] = id;
    return next;
  }

  const api = { resizeBlock, blockAt, moveBlock, eventSpan, spanRows, runs, hourLabel, START_HOUR, PER_ROW, ROWS, CELLS, CELL_MIN, COLORS, hourOfRow, cellOf, paint, totals, prune, fmt, pickColor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Timeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
