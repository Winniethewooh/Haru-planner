// haru.user.js 생성: extension/extractor.js + grab.js 를 유저스크립트 하나로 합침
//   node scripts/build-userscript.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function build() {
  const version = JSON.parse(read('package.json')).version || '0.0.0';
  return [
    '// ==UserScript==',
    '// @name         하루로 보내기',
    '// @description  투두메이트 웹의 오늘 할 일을 하루 플래너로 보냅니다.',
    `// @version      ${version}`,
    '// @match        https://www.todomate.net/*',
    '// @match        https://todomate.net/*',
    '// @run-at       document-start',
    '// @inject-into  content',
    '// @noframes',
    '// ==/UserScript==',
    '// 이 파일은 scripts/build-userscript.js 로 만들어집니다. 직접 고치지 마세요.',
    '',
    "globalThis.__HARU_MODE = 'userscript';",
    read('extension/extractor.js'),
    read('grab.js'),
  ].join('\n');
}

if (require.main === module) {
  fs.writeFileSync(path.join(root, 'haru.user.js'), build());
  console.log('haru.user.js 생성');
}
module.exports = { build };
