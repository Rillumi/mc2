const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/core/identity.js');
const I = globalThis.MC.identity;

test('modId 规范化后相等', () => {
  assert.equal(I.normalizeId('mizuno_ky'), I.normalizeId('mizuno-ky'));
  assert.ok(I.same({ id: 'mizuno_ky' }, { id: 'mizuno-ky' }, I.LEVELS.MOD));
});

test('SHA1 与项目 ID 是更高优先级', () => {
  assert.ok(I.same({ sha1: 'ABC' }, { sha1: 'abc' }, I.LEVELS.FILE));
  assert.equal(I.score({ sha1: 'abc', id: 'a' }, { sha1: 'abc', id: 'b' }), 100);
  assert.equal(I.score({ projectId: 'p1', id: 'a' }, { projectId: 'p1', id: 'b' }), 90);
});

test('同名但不同模组不匹配', () => {
  assert.ok(!I.same({ name: 'Create' }, { name: "Create: Steam 'n' Rails" }, I.LEVELS.NAME));
  assert.ok(!I.same({ name: 'Sodium' }, { name: 'Sodium Extra' }, I.LEVELS.NAME));
  assert.equal(I.score({ name: 'Create' }, { name: "Create: Steam 'n' Rails" }), 0);
});

test('文件名去掉加载器、MC、版本与标签', () => {
  assert.equal(I.fileBase('carryon-fabric-1.20.1-2.1.2.7.jar'), 'carryon');
  assert.equal(I.fileBase('XeKr\'s Decoration-1.20.1-Fabric-0.8.4.jar'), 'xekrsdecoration');
  assert.equal(I.fileBase('【微缩世界：重生】Reminia-1.0.0-1.20.1-forge.47.jar'), 'reminia');
  assert.equal(I.fileBase('PON-DLC V3.2.7.jar'), 'pondlc');
  assert.equal(I.fileBase('1.20.1Cocricot.zip'), 'cocricot');
});

test('同项目不同加载器可模糊匹配', () => {
  const a = { fileName: 'carryon-fabric-1.20.1-2.1.2.7.jar' };
  const b = { fileName: 'carryon-forge-1.20.1-2.1.2.7.jar' };
  assert.equal(I.score(a, b), 40);
  assert.ok(I.same(a, b, I.LEVELS.FUZZY));
});

test('空对象不会误匹配', () => {
  assert.equal(I.score({}, {}), 0);
  assert.ok(!I.same({}, {}, I.LEVELS.MOD));
});
