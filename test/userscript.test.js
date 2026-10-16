const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { build } = require('../scripts/build-userscript.js');

test('haru.user.js 가 최신 (npm run build)', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'haru.user.js'), 'utf8');
  assert.strictEqual(file, build());
});
