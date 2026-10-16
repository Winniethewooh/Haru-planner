// 투두메이트 웹 화면에서 할 일을 읽어내는 순수 함수들.
// 투두메이트의 화면 구조는 공개돼 있지 않아서, 사용자가 할 일 하나를 클릭하면
// 반복되는 구조를 찾아 선택자를 만들고, 완료/미완료 예시를 비교해 완료 표시를 학습한다.
(function (root) {
  const DONE_CLASS = /(^|[-_])(done|completed?|checked|finished)($|[-_])/i;

  function sig(el) {
    return el.tagName.toLowerCase() + [...el.classList].sort().map(c => '.' + CSS.escape(c)).join('');
  }

  function text(el) {
    return (el.innerText || el.textContent || '').trim();
  }

  // 클릭한 요소에서 위로 올라가며, 같은 모양의 형제가 2개 이상 있는(=목록의 한 줄) 요소를 찾음
  function findItem(el) {
    for (let a = el; a && a.parentElement && a !== document.body; a = a.parentElement) {
      if (!text(a)) continue;
      const s = sig(a);
      const same = [...a.parentElement.children].filter(c => sig(c) === s && text(c));
      if (same.length >= 2) return a;
    }
    return el;
  }

  // findItem 과 같지만, 반복되는 목록 항목을 못 찾으면 null
  function findItemStrict(el) {
    const a = findItem(el);
    if (!a || !a.parentElement) return null;
    const s = sig(a);
    return [...a.parentElement.children].filter(c => sig(c) === s && text(c)).length >= 2 ? a : null;
  }

  // 항목을 가리키는 선택자: 클래스가 있는 가장 가까운 조상 > … > 항목
  function selectorFor(item) {
    const parts = [sig(item)];
    let a = item.parentElement;
    for (let depth = 0; a && a !== document.body && !a.classList.length && depth < 3; depth++) {
      parts.unshift(a.tagName.toLowerCase());
      a = a.parentElement;
    }
    if (a && a !== document.body && a.classList.length) parts.unshift(sig(a));
    return parts.join(' > ');
  }

  // 항목 안의 모양 특징 (텍스트 제외). 완료 여부 학습에 사용.
  function tokens(el) {
    const set = new Set();
    const nodes = [el, ...el.querySelectorAll('*')].slice(0, 300);
    for (const n of nodes) {
      set.add('<' + n.tagName.toLowerCase());
      n.classList.forEach(c => set.add('.' + c));
      for (const at of n.attributes) {
        const style = at.name === 'style';
        const relevant = style || /^(aria-|data-)/.test(at.name) || ['checked', 'fill', 'stroke', 'd'].includes(at.name);
        // id처럼 항목마다 다른 값은 제외
        if (!relevant || (!style && (/\d{4,}/.test(at.value) || at.value.length > 80))) continue;
        set.add('@' + at.name + '=' + at.value);
      }
      if (n.checked) set.add(':checked');
    }
    return set;
  }

  function learnDone(doneEl, undoneEl) {
    const d = tokens(doneEl);
    const u = tokens(undoneEl);
    return {
      doneTokens: [...d].filter(x => !u.has(x)),
      undoneTokens: [...u].filter(x => !d.has(x)),
    };
  }

  // true/false: 판단함, null: 알 수 없음(플래너가 기존 상태 유지)
  function isDone(item, cfg) {
    if (cfg.doneTokens && cfg.doneTokens.length) {
      const t = tokens(item);
      const d = cfg.doneTokens.filter(x => t.has(x)).length;
      const u = (cfg.undoneTokens || []).filter(x => t.has(x)).length;
      return d > u;
    }
    if (item.matches('[aria-checked="true"]') || item.querySelector('input[type=checkbox]:checked, [aria-checked="true"]')) return true;
    for (const n of [item, ...item.querySelectorAll('*')]) {
      if ([...n.classList].some(c => DONE_CLASS.test(c))) return true;
      if (n.childNodes.length && text(n) && getComputedStyle(n).textDecorationLine.includes('line-through')) return true;
    }
    return null;
  }

  function titleOf(item) {
    const line = text(item).split('\n').map(s => s.trim()).find(Boolean) || '';
    return line.slice(0, 200);
  }

  function extract(cfg) {
    if (!cfg || !cfg.selector) return [];
    let nodes;
    try { nodes = document.querySelectorAll(cfg.selector); } catch { return []; }
    return [...nodes]
      .filter(n => !n.closest('style, script, noscript, template')) // 코드 조각은 할 일이 아님
      .filter(n => n.getClientRects().length) // 아직 그려지지 않은(숨겨진) 항목은 제외
      .map(n => ({ title: titleOf(n), done: isDone(n, cfg) }))
      .filter(it => it.title && !/[{}]/.test(it.title));
  }

  root.HaruExtractor = { findItem, findItemStrict, selectorFor, tokens, learnDone, isDone, titleOf, extract };
})(globalThis);
