const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/core/search.js');
const S = globalThis.MC.search;

test('查询拆词与大小写', () => {
  assert.deepEqual(S.tokens('  Create   Addon '), ['create', 'addon']);
  assert.equal(S.normalizeQuery('A  B'), 'a b');
});

test('多个词可以分散在不同字段', () => {
  assert.ok(S.matches(['Create: Steam', 'addon pack'], 'create addon'));
  assert.ok(S.matches(['Create'], 'CREATE'));
  assert.ok(!S.matches(['Create'], 'addon'));
  assert.ok(S.matches(['水野工艺'], '水野'));
});

test('空查询匹配全部', () => {
  assert.ok(S.matches(['x'], ''));
  assert.ok(S.matches(['x'], '   '));
});

test('高亮会转义 HTML 并标出所有词', () => {
  const out = S.highlight('Create: Steam & <Rails>', 'create rails');
  assert.equal(out, '<mark>Create</mark>: Steam &amp; &lt;<mark>Rails</mark>&gt;');
  assert.ok(!out.includes('<Rails>'));
});

test('高亮不会重复标记重叠片段', () => {
  const out = S.highlight('create', 'create cre');
  assert.equal(out, '<mark>create</mark>');
});

test('特殊字符查询不会破坏 HTML', () => {
  const out = S.highlight('a < b', '<');
  assert.equal(out, 'a <mark>&lt;</mark> b');
});
