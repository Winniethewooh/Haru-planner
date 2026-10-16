const test = require('node:test');
const assert = require('node:assert');
const T = require('../timeline.js');
const P = require('../planner.js');

test('cellOf: 오전 6시가 첫 칸, 10분 단위', () => {
  assert.strictEqual(T.cellOf(new Date(2026, 9, 15, 6, 0)), 0);
  assert.strictEqual(T.cellOf(new Date(2026, 9, 15, 6, 59)), 5);
  assert.strictEqual(T.cellOf(new Date(2026, 9, 15, 7, 10)), 7);
  assert.strictEqual(T.cellOf(new Date(2026, 9, 16, 1, 59)), 119);
  assert.strictEqual(T.cellOf(new Date(2026, 9, 15, 0, 0)), 108);
  assert.ok(T.cellOf(new Date(2026, 9, 16, 3, 0)) >= T.CELLS);   // 새벽 2~6시는 표 밖
});

test('시간표는 6시에 시작해서 하루가 바뀌는 새벽 2시에 끝난다', () => {
  assert.strictEqual(T.START_HOUR, 6);
  assert.strictEqual((T.START_HOUR + T.ROWS) % 24, P.DAY_START);
});

test('hourOfRow: 6시부터 다음 날 1시까지', () => {
  assert.strictEqual(T.hourOfRow(0), 6);
  assert.strictEqual(T.hourOfRow(18), 0);
  assert.strictEqual(T.hourOfRow(19), 1);
});

test('paint / totals / prune', () => {
  let g = {};
  g = T.paint(g, 0, 'a');
  g = T.paint(g, 1, 'a');
  g = T.paint(g, 2, 'b');
  assert.deepStrictEqual(T.totals(g), { a: 20, b: 10 });
  assert.deepStrictEqual(T.paint(g, 1, null), { 0: 'a', 2: 'b' });
  assert.strictEqual(T.paint(g, 999, 'a'), g);
  assert.deepStrictEqual(T.prune(g, ['b']), { 2: 'b' });
  assert.deepStrictEqual(g, { 0: 'a', 1: 'a', 2: 'b' });
});

test('fmt', () => {
  assert.strictEqual(T.fmt(10), '10분');
  assert.strictEqual(T.fmt(60), '1시간');
  assert.strictEqual(T.fmt(80), '1시간 20분');
});

test('pickColor: 안 쓴 색부터', () => {
  assert.strictEqual(T.pickColor([]), 0);
  assert.strictEqual(T.pickColor([0, 1]), 2);
  assert.strictEqual(T.pickColor([0, 1, 2, 3, 4, 5, 6, 7, 0]), 1);
});

test('reconcile: 다른 기기의 시간표도 가져옴', () => {
  const local = { tasks: [], grid: {}, updatedAt: 1, todoAt: 0 };
  const plan = { date: '2026-10-15', tasks: [], grid: { 3: 'x' }, updatedAt: 5, todoAt: 0 };
  const r = P.reconcile(local, { plan }, '2026-10-15', 10);
  assert.deepStrictEqual(r.state.grid, { 3: 'x' });
  const old = P.reconcile({ ...local, updatedAt: 9, grid: { 1: 'y' } }, { plan }, '2026-10-15', 10);
  assert.deepStrictEqual(old.state.grid, { 1: 'y' });
});

test('runs: 이어 칠한 칸은 한 덩어리, 줄이 바뀌면 시작선 없음', () => {
  const g = { 2: 'a', 3: 'a', 5: 'a', 6: 'a', 7: 'b' };
  assert.deepStrictEqual(T.runs(g, 0), [
    { id: 'a', from: 2, to: 4, start: true },
    { id: 'a', from: 5, to: 6, start: true },
  ]);
  assert.deepStrictEqual(T.runs(g, 1), [
    { id: 'a', from: 0, to: 1, start: false },
    { id: 'b', from: 1, to: 2, start: true },
  ]);
});

test('hourLabel', () => {
  assert.deepStrictEqual(T.hourLabel(0), { n: 12, ap: 'AM' });
  assert.deepStrictEqual(T.hourLabel(12), { n: 12, ap: 'PM' });
  assert.deepStrictEqual(T.hourLabel(15), { n: 3, ap: 'PM' });
});

test('eventSpan / spanRows: 일정을 칸으로', () => {
  assert.deepStrictEqual(T.eventSpan({ from: 6 * 60, to: 7 * 60 }), [0, 6]);
  assert.deepStrictEqual(T.eventSpan({ from: 9 * 60 + 5, to: 10 * 60 + 25 }), [18, 27]);   // 9:05~10:25 → 9:00~10:30 칸 (걸치는 칸 포함)
  assert.deepStrictEqual(T.eventSpan({ from: 23 * 60, to: 25 * 60 }), [102, 114]);       // 23시~다음 날 1시
  assert.strictEqual(T.eventSpan({ from: 3 * 60, to: 4 * 60 }), null);                  // 새벽 3~4시는 표 밖
  assert.deepStrictEqual(T.spanRows(4, 8), [
    { row: 0, from: 4, to: 6, start: true },
    { row: 1, from: 0, to: 2, start: false },
  ]);
});

test('blockAt: 줄이 바뀌어도 이어진 덩어리', () => {
  const g = { 4: 'a', 5: 'a', 6: 'a', 7: 'a', 9: 'a', 8: 'b' };
  assert.deepStrictEqual(T.blockAt(g, 5), [4, 7]);
  assert.deepStrictEqual(T.blockAt(g, 9), [9, 9]);
  assert.strictEqual(T.blockAt(g, 20), null);
});

test('moveBlock: 덩어리만 옮김, 표 밖은 막고, 도착 자리는 덮어씀', () => {
  const g = { 4: 'a', 5: 'a', 6: 'b', 7: 'b' };
  assert.deepStrictEqual(T.moveBlock(g, 4, 5, 2), { 6: 'a', 7: 'a' });          // b를 덮어씀
  assert.deepStrictEqual(T.moveBlock(g, 6, 7, -3), { 3: 'b', 4: 'b', 5: 'a' });          // 앞으로 옮기며 a의 한 칸을 덮어씀
  assert.deepStrictEqual(T.moveBlock(g, 4, 5, -10), { 0: 'a', 1: 'a', 6: 'b', 7: 'b' });   // 맨 앞에서 멈춤
  assert.deepStrictEqual(T.moveBlock(g, 6, 7, 500), { 4: 'a', 5: 'a', [T.CELLS - 2]: 'b', [T.CELLS - 1]: 'b' });
  assert.strictEqual(T.moveBlock(g, 4, 5, 0), g);
  assert.deepStrictEqual(g, { 4: 'a', 5: 'a', 6: 'b', 7: 'b' });                   // 원본 그대로
});

test('resizeBlock: 앞이나 뒤를 늘이고 줄임', () => {
  const g = { 4: 'a', 5: 'a', 6: 'a', 8: 'b' };
  assert.deepStrictEqual(T.resizeBlock(g, 4, 6, 4, 8), { 4: 'a', 5: 'a', 6: 'a', 7: 'a', 8: 'a' });   // 뒤로 늘림(b를 덮어씀)
  assert.deepStrictEqual(T.resizeBlock(g, 4, 6, 2, 6), { 2: 'a', 3: 'a', 4: 'a', 5: 'a', 6: 'a', 8: 'b' });   // 앞으로 늘림
  assert.deepStrictEqual(T.resizeBlock(g, 4, 6, 5, 6), { 5: 'a', 6: 'a', 8: 'b' });                        // 앞을 줄임
  assert.deepStrictEqual(T.resizeBlock(g, 4, 6, 4, 4), { 4: 'a', 8: 'b' });                               // 뒤를 줄임
  assert.deepStrictEqual(T.resizeBlock(g, 4, 6, 9, 9), { 8: 'b', 9: 'a' });                               // 시작을 끝 너머로 끌면 한 칸으로
  assert.deepStrictEqual(T.resizeBlock(g, 4, 6, -5, 6), { 0: 'a', 1: 'a', 2: 'a', 3: 'a', 4: 'a', 5: 'a', 6: 'a', 8: 'b' });   // 맨 앞에서 멈춤
  assert.strictEqual(T.resizeBlock(g, 4, 6, 4, 6), g);
  assert.deepStrictEqual(g, { 4: 'a', 5: 'a', 6: 'a', 8: 'b' });
});
