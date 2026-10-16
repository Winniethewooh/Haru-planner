const test = require('node:test');
const assert = require('node:assert');
const P = require('../planner.js');

test('parse: 불릿, 체크 표시, 카테고리', () => {
  const r = P.parse('공부:\n- ☑ 영어 단어\n☐ 수학 문제\n\n# 운동\n• 러닝 5km\n1. 스트레칭\n[x] 폼롤러');
  assert.deepStrictEqual(r.map(x => [x.title, x.cat, x.done]), [
    ['영어 단어', '공부', true],
    ['수학 문제', '공부', false],
    ['러닝 5km', '운동', null],
    ['스트레칭', '운동', null],
    ['폼롤러', '운동', true],
  ]);
});

test('parse: 중복 제목은 키로 구분', () => {
  const r = P.parse('물 마시기\n물 마시기');
  assert.notStrictEqual(r[0].key, r[1].key);
});

test('merge: 슬롯 유지, 추가/삭제/완료 감지', () => {
  let m = P.merge([], P.parse('A\nB\nC'));
  assert.strictEqual(m.added, 3);
  const tasks = m.tasks.map((t, i) => ({ ...t, slot: ['am', 'pm', null][i], fresh: false }));
  m = P.merge(tasks, P.parse('☑ A\nC\nD'));
  assert.deepStrictEqual([m.added, m.removed, m.completed], [1, 1, 1]);
  const byTitle = Object.fromEntries(m.tasks.map(t => [t.title, t]));
  assert.strictEqual(byTitle.A.slot, 'am');
  assert.strictEqual(byTitle.A.done, true);
  assert.strictEqual(byTitle.B.gone, true);
  assert.strictEqual(byTitle.B.slot, 'pm');
  assert.strictEqual(byTitle.D.slot, null);
  assert.strictEqual(byTitle.D.fresh, true);
});

test('merge: 삭제됐던 항목이 돌아오면 슬롯 그대로 복구', () => {
  let tasks = P.merge([], P.parse('A')).tasks.map(t => ({ ...t, slot: 'eve', fresh: false }));
  tasks = P.merge(tasks, P.parse('')).tasks;
  const m = P.merge(tasks, P.parse('A'));
  assert.strictEqual(m.tasks[0].gone, false);
  assert.strictEqual(m.tasks[0].slot, 'eve');
  assert.strictEqual(m.added, 1);
});

test('merge: 표시 없는 줄은 로컬 완료 상태 유지', () => {
  const tasks = P.merge([], P.parse('A')).tasks.map(t => ({ ...t, done: true, fresh: false }));
  const m = P.merge(tasks, P.parse('A'));
  assert.strictEqual(m.tasks[0].done, true);
  assert.ok(!P.hasChanges(m));
});

test('merge: 인식 오차로 글자가 조금 달라도 같은 할 일로 보고 슬롯 유지', () => {
  const tasks = P.merge([], P.parse('영어 단어 30개 외우기\n장보기')).tasks.map(t => ({ ...t, slot: 'am', fresh: false }));
  const m = P.merge(tasks, P.parse('영어 단이 30개 외우기\n장보기\n운동'));
  assert.deepStrictEqual([m.added, m.removed], [1, 0]);
  const eng = m.tasks.find(t => t.title.startsWith('영어'));
  assert.strictEqual(eng.slot, 'am');
  assert.strictEqual(eng.title, '영어 단이 30개 외우기');
});

test('merge: 완전히 다른 짧은 제목은 짝짓지 않음', () => {
  const tasks = P.merge([], P.parse('운동')).tasks.map(t => ({ ...t, fresh: false }));
  const m = P.merge(tasks, P.parse('독서'));
  assert.deepStrictEqual([m.added, m.removed], [1, 1]);
});

test('merge: 띄어쓰기만 다르면 같은 할 일', () => {
  const tasks = P.merge([], P.parse('친구에게 연락하기')).tasks.map(t => ({ ...t, slot: 'eve', fresh: false }));
  const m = P.merge(tasks, P.parse('친 구에게 연락하기'));
  assert.ok(!P.hasChanges(m));
  assert.strictEqual(m.tasks[0].slot, 'eve');
});

test('similarity', () => {
  assert.strictEqual(P.similarity('a b', 'ab'), 1);
  assert.ok(P.similarity('영어 단어', '영어 단이') >= 0.7);
  assert.ok(P.similarity('운동', '독서') < 0.7);
});

test('fromItems: 확장 데이터 변환', () => {
  const r = P.fromItems([{ title: ' A ', done: true }, { title: '' }, { title: 'B', done: null }, { title: 'A' }]);
  assert.deepStrictEqual(r.map(x => [x.title, x.done, x.key]), [['A', true, 'a'], ['B', null, 'b'], ['A', null, 'a#2']]);
});

test('reconcile: 투두메이트 변경은 병합하고 올려야 함', () => {
  const state = { tasks: P.merge([], P.parse('A\nB')).tasks.map(t => ({ ...t, slot: 'am' })), todoAt: 1, updatedAt: 5 };
  const todo = { date: 'D', items: [{ title: 'A', done: true }, { title: 'C' }], updatedAt: 10, checkedAt: 12 };
  const r = P.reconcile(state, { todo }, 'D', 99);
  assert.ok(r.push);
  assert.deepStrictEqual([r.result.added, r.result.removed, r.result.completed], [1, 1, 1]);
  assert.strictEqual(r.state.todoAt, 10);
  assert.strictEqual(r.state.checkedAt, 12);
  assert.strictEqual(r.state.updatedAt, 99);
  assert.strictEqual(r.state.tasks.find(t => t.title === 'A').slot, 'am');
  // 같은 데이터를 다시 받으면 아무 일 없음
  const again = P.reconcile(r.state, { todo }, 'D', 100);
  assert.ok(!again.push && !again.result);
});

test('reconcile: 다른 기기의 더 새 계획을 받고, 이미 반영된 투두는 다시 병합하지 않음', () => {
  const local = { tasks: [], todoAt: 0, updatedAt: 5 };
  const plan = { date: 'D', tasks: [{ id: 'x', key: 'a', title: 'A', slot: 'pm' }], todoAt: 10, updatedAt: 20 };
  const todo = { date: 'D', items: [{ title: 'A' }], updatedAt: 10 };
  const r = P.reconcile(local, { plan, todo }, 'D', 30);
  assert.ok(!r.push);
  assert.strictEqual(r.state.tasks[0].slot, 'pm');
});

test('reconcile: 다른 날짜 데이터와 오래된 계획은 무시', () => {
  const local = { tasks: [{ id: 'y', key: 'b', title: 'B' }], updatedAt: 50 };
  const r = P.reconcile(local, {
    plan: { date: 'D', tasks: [], updatedAt: 40 },
    todo: { date: 'E', items: [{ title: 'Z' }], updatedAt: 60 },
  }, 'D', 70);
  assert.strictEqual(r.state, local);
});

test('dayOf: 새벽 2시 전은 전날', () => {
  assert.strictEqual(P.dayOf(new Date(2026, 8, 30, 1)), '2026-09-29');
  assert.strictEqual(P.dayOf(new Date(2026, 8, 30, 3)), '2026-09-30');
});

test('currentSlot', () => {
  const at = h => P.currentSlot(new Date(2026, 0, 1, h));
  assert.deepStrictEqual([at(1), at(3), at(8), at(13), at(19), at(23)], ['night', 'am', 'am', 'pm', 'eve', 'night']);
});

test('fromItems: 개수와 길이를 제한', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ title: '할 일 ' + i }));
  assert.strictEqual(P.fromItems(many).length, 300);
  const [it] = P.fromItems([{ title: 'a'.repeat(1000), cat: 'c'.repeat(1000) }]);
  assert.strictEqual(it.title.length, 200);
  assert.strictEqual(it.cat.length, 50);
  assert.deepStrictEqual(P.fromItems('악성'), []);
});

test('parseCal: 단축어 일정 텍스트', () => {
  const r = P.parseCal('09:00-10:30 팀 미팅\n23:00-01:00 야간 작업\n00:00-00:00 종일 행사\n잘못된 줄\n25:00-26:00 이상한 시간\n9:05 ~ 9:35  점심 약속');
  assert.deepStrictEqual(r, [
    { from: 540, to: 630, title: '팀 미팅' },
    { from: 1380, to: 1500, title: '야간 작업' },
    { from: 545, to: 575, title: '점심 약속' },
  ]);
});

test('addManual: 직접 추가한 할 일', () => {
  assert.strictEqual(P.addManual([], '   '), null);
  const r = P.addManual([{ id: 'x' }], '  영어   단어  ');
  assert.strictEqual(r.task.title, '영어 단어');
  assert.strictEqual(r.task.manual, true);
  assert.strictEqual(r.tasks.length, 2);
  assert.strictEqual(P.addManual([], 'a'.repeat(500)).task.title.length, 100);
  const a = P.addManual([], '같은 제목').task, b = P.addManual([], '같은 제목').task;
  assert.notStrictEqual(a.key, b.key);
});

test('merge: 직접 추가한 할 일은 가져오기에서 지워지거나 바뀌지 않음', () => {
  const m = P.addManual([], '병원 예약').task;
  m.slot = 'pm';
  const t0 = P.merge([m], P.parse('영어 단어'));
  assert.strictEqual(t0.removed, 0);
  assert.deepStrictEqual(t0.tasks.find(t => t.manual), m);
  assert.strictEqual(t0.tasks.length, 2);
  // 투두메이트에 같은 제목이 들어와도 직접 추가한 것과 합쳐지지 않음
  const t1 = P.merge(t0.tasks, P.parse('영어 단어\n병원 예약'));
  assert.strictEqual(t1.tasks.filter(t => t.title === '병원 예약').length, 2);
  assert.strictEqual(t1.tasks.find(t => t.manual).slot, 'pm');
  // 비슷한 글자의 투두메이트 항목과 짝지어지지 않음
  const t2 = P.merge([m], P.parse('병원 예약!'));
  assert.strictEqual(t2.tasks.find(t => t.manual).title, '병원 예약');
});

test('날짜 계산: addDays / addMonths', () => {
  assert.strictEqual(P.addDays('2026-10-31', 1), '2026-11-01');
  assert.strictEqual(P.addDays('2026-01-01', -1), '2025-12-31');
  assert.strictEqual(P.addDays('2028-02-28', 1), '2028-02-29');
  assert.strictEqual(P.addMonths('2026-01-31', 1), '2026-02-28');   // 없는 날은 말일로
  assert.strictEqual(P.addMonths('2026-03-15', -3), '2025-12-15');
  assert.strictEqual(P.addMonths('2026-12-10', 1), '2027-01-10');
});

test('날짜 계산: weekOf / monthWeeks (일요일 시작)', () => {
  // 2026-10-15 는 목요일
  assert.deepStrictEqual(P.weekOf('2026-10-15'), ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
  assert.deepStrictEqual(P.weekOf('2026-10-11')[0], '2026-10-11');           // 일요일은 그 주의 첫날
  const w = P.monthWeeks('2026-10-15');
  assert.strictEqual(w.length, 5);                                           // 9/27 ~ 10/31
  assert.strictEqual(w[0][0], '2026-09-27');
  assert.strictEqual(w[4][6], '2026-10-31');
  assert.ok(w.every(r => r.length === 7));
  assert.strictEqual(P.monthWeeks('2026-02-10').length, 4);                  // 2/1(일) ~ 2/28(토): 딱 4주
  assert.strictEqual(P.monthWeeks('2026-08-10').length, 6);                  // 7/26 ~ 9/5
});

test('addManualMany: 여러 줄을 한꺼번에 추가', () => {
  const r = P.addManualMany([], '영어 단어\n- 운동\n☑ 독서\n\n  \n1. 장보기');
  assert.deepStrictEqual(r.added.map(t => [t.title, t.done, t.manual]), [
    ['영어 단어', false, true], ['운동', false, true], ['독서', true, true], ['장보기', false, true],
  ]);
  assert.strictEqual(r.tasks.length, 4);
  assert.strictEqual(new Set(r.tasks.map(t => t.key)).size, 4);          // 키가 겹치지 않음
  assert.strictEqual(P.addManualMany([], '   \n\n'), null);
  const many = Array.from({ length: 300 }, (_, i) => '할 일 ' + i).join('\n');
  assert.strictEqual(P.addManualMany([], many).added.length, 100);
});

test('carryOver: 전날 못 끝낸 할 일만 새 항목으로', () => {
  const prev = [
    { id: 'a', title: '영어 단어', done: false, gone: false, cat: '공부' },
    { id: 'b', title: '운동', done: true, gone: false },
    { id: 'c', title: '독서', done: false, gone: true },
    { id: 'd', title: '장보기', done: false, gone: false },
    { id: 'e', title: '장 보기', done: false, gone: false },         // 띄어쓰기만 다른 중복
  ];
  const cur = [{ id: 'x', title: '독서', done: false, gone: false }];
  const r = P.carryOver(prev, cur);
  assert.deepStrictEqual(r.map(t => [t.title, t.cat, t.done, t.slot, t.manual]), [
    ['영어 단어', '공부', false, null, true],
    ['장보기', '', false, null, true],
  ]);
  assert.ok(r.every(t => t.id !== 'a' && t.key.startsWith('manual:')));
  assert.deepStrictEqual(P.carryOver(prev, [{ title: '영어 단어' }, { title: '장보기' }]), []);   // 이미 있으면 가져오지 않음
  assert.deepStrictEqual(P.carryOver(null, cur), []);
});

test('fromItems: 화면의 CSS 코드가 잘못 읽힌 항목은 거름', () => {
  const css = 'flutter-view flt-scene-host { font: normal normal 14px sans-serif;}flutter-view flt-semantics input[type=range] { appearance: none; -webkit-appearance: none; width: 100%; position: absolute; bor';
  const r = P.fromItems([{ title: css }, { title: 'position: absolute; top: 0;' }, { title: '영어 단어' }, { title: '회의: 오후 3시' }, { title: '{ }' }]);
  assert.deepStrictEqual(r.map(i => i.title), ['영어 단어', '회의: 오후 3시']);
});
