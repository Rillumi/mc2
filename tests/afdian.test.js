const assert = require('node:assert/strict');
const test = require('node:test');

globalThis.MC = { store: { state: { afdian: { creators: [] } } } };
require('../js/api/afdian.js');

const find = globalThis.MC.afdian.find;

function withCreators(list) {
  globalThis.MC.store.state.afdian.creators = list;
}

test('作者名包含在模组名里也能匹配（天鹅小镇系列）', () => {
  withCreators([{ name: '天鹅小镇', home: 'https://afdian.com/a/swan', posts: [] }]);
  const hits = find({ name: '天鹅小镇系列-家具', id: 'swan_furniture' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].creator.name, '天鹅小镇');
});

test('两个字的中文作者名（灵耶）也能匹配', () => {
  withCreators([{ name: '灵耶', home: 'https://afdian.com/a/lingye', posts: [] }]);
  const hits = find({ name: '灵耶的装饰', authors: ['灵耶'] });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].creator.name, '灵耶');
  // 完全不相关的模组不该被硬配
  assert.equal(find({ name: '机械动力' }).length, 0);
});

test('英文作者名太短（xk）不乱配', () => {
  withCreators([{ name: 'xk', home: 'https://afdian.com/a/xk', posts: [] }]);
  assert.equal(find({ name: 'xk装饰', id: 'xk_deco' }).length, 0);
});
