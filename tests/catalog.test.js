const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/core/catalog.js');
const C = globalThis.MC.catalog;

test('Modrinth 多分类：全部保留，主分类按玩法优先', () => {
  const r = C.fromProject({ categories: ['decoration', 'technology', 'utility'] });
  assert.deepEqual(r.cats, ['decoration', 'technology', 'utility']);
  assert.equal(r.primary, 'tech');

  const r2 = C.fromProject({ categories: ['utility'], additional_categories: ['decoration'] });
  assert.equal(r2.primary, 'building');
  assert.deepEqual(r2.cats, ['utility', 'decoration']);
});

test('没有 Modrinth 分类时返回 null', () => {
  assert.equal(C.fromProject(null), null);
  assert.equal(C.fromProject({}), null);
  assert.equal(C.fromProject({ categories: [] }), null);
});

test('tagsOf 使用 Modrinth 元数据并去重', () => {
  const e = { cats: ['technology', 'storage', 'decoration'] };
  assert.deepEqual(C.tagsOf(e), ['tech', 'building']);
  assert.equal(C.sourceOf(e), 'modrinth');

  const unknown = { cats: ['economy'] };
  assert.deepEqual(C.tagsOf(unknown), ['misc']);
});

test('没有元数据时退回关键词，并标记来源', () => {
  const e = { id: 'farmersdelight', name: "Farmer's Delight" };
  assert.deepEqual(C.tagsOf(e), ['farming']);
  assert.equal(C.sourceOf(e), 'keyword');
  assert.equal(C.categoryOf(e), 'farming');
});

test('长词按词首派生命中', () => {
  assert.ok(C.guessAll({ id: 'technology' }).includes('tech'));
  assert.ok(C.guessAll({ id: 'buildinggadgets' }).includes('building'));
  assert.ok(C.guessAll({ id: 'optimization' }).includes('ui'));
});

test('短词必须整词，避免 api/jei/hud 误配', () => {
  assert.ok(!C.guessAll({ id: 'rapid' }).includes('lib'));
  assert.ok(!C.guessAll({ id: 'jeiplus' }).includes('ui'));
  assert.ok(!C.guessAll({ id: 'hudson' }).includes('ui'));
  assert.equal(C.guess({ id: 'hudson' }), 'misc');

  assert.ok(C.guessAll({ id: 'api-library' }).includes('lib'));
  assert.ok(C.guessAll({ id: 'jei' }).includes('ui'));
});

test('guess 取分数最高的一类', () => {
  const e = { id: 'tech', name: 'Tech Machine', description: 'a small decoration' };
  assert.equal(C.guess(e), 'tech');
  assert.deepEqual(C.guessAll(e), ['tech', 'building']);
});

test('有元数据时主分类优先于关键词', () => {
  const e = { cats: ['food'], id: 'create-tech' };
  assert.equal(C.categoryOf(e), 'farming');
});

test('counts 只算主分类，tagCounts 一个模组计入多个', () => {
  const items = [
    { cats: ['decoration', 'technology'] },
    { cats: ['technology'] }
  ];
  assert.deepEqual(C.counts(items), [{ id: 'tech', label: '科技自动化', n: 2 }]);
  assert.deepEqual(C.tagCounts(items), [
    { id: 'building', label: '建筑装饰', n: 1 },
    { id: 'tech', label: '科技自动化', n: 2 }
  ]);
});

test('labelOf 未知分类回落其他', () => {
  assert.equal(C.labelOf('tech'), '科技自动化');
  assert.equal(C.labelOf('nope'), '其他');
});
