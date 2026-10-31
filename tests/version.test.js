const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/core/version.js');
const V = globalThis.MC.version;

test('旧的数字比较保持不变', () => {
  assert.equal(V.cmp('1.10', '1.9'), 1);
  assert.equal(V.cmp('1.0', '1.0.0'), 0);
  assert.ok(V.mcMatches('[1.20.1,1.21)', '1.20.1'));
  assert.ok(!V.mcMatches('[1.20.1,1.21)', '1.21'));
});

test('尾部 0 与语义相等', () => {
  assert.equal(V.compare('1.0', '1.0.0'), 0);
  assert.ok(V.equals('1.0', '1.0.0'));
  assert.ok(V.equals('1.0.0-slim', '1.0.0'));
  assert.ok(V.equals('1.0.0Re', '1.0.0'));
});

test('预发布低于正式版', () => {
  assert.equal(V.compare('1.0.0-beta.2', '1.0.0'), -1);
  assert.equal(V.compare('1.0.0-pre161', '1.0.0'), -1);
  assert.equal(V.compare('1.1.1beta', '1.1.1'), -1);
  assert.equal(V.compare('1.0.0-alpha.2', '1.0.0-beta.1'), -1);
  assert.equal(V.compare('1.0.0-rc1', '1.0.0'), -1);
});

test('核心更大时预发布也更新', () => {
  assert.equal(V.compare('1.1.1beta', '1.1.0'), 1);
});

test('Patch / hf / build / forge.47 作为修订号', () => {
  assert.equal(V.compare('2.6.5-forge+mc1.20.1-Patch.2', '2.6.5-forge+mc1.20.1'), 1);
  assert.equal(V.compare('1.0.0-Patch.2', '1.0.0-Patch.10'), -1);
  assert.equal(V.compare('1.0.0-1.20.1-forge.47', '1.0.0-1.20.1-forge.46'), 1);
  assert.equal(V.compare('1.0.0-hf3', '1.0.0-hf1'), 1);
});

test('环境信息不参与比较', () => {
  assert.equal(V.compare('0.92.6+1.11.15+1.20.1', '0.92.6+1.20.1'), 0);
  assert.equal(V.compare('1.6.0-forge+mc1.20.1', '1.6.0-fabric+mc1.20.1'), 0);
  assert.deepEqual(V.parse('2.6.5-forge+mc1.20.1-Patch.2').core, [2, 6, 5]);
});

test('变体不参与新旧判断', () => {
  assert.ok(V.equals('1.0.0-slim', '1.0.0-all'));
  assert.ok(V.equals('1.0.0-birthday', '1.0.0'));
});

test('无法识别的版本标记 ambiguous', () => {
  assert.equal(V.parse('').ambiguous, true);
  assert.equal(V.parse('说明文档').ambiguous, true);
  assert.ok(!V.parse('0.7').ambiguous);
  assert.deepEqual(V.parse('0.1.4.a').core, [0, 1, 4]);
  assert.equal(V.parse('0.1.4.a').pre.name, 'a');
});

test('canonical 去掉环境与变体', () => {
  assert.equal(V.canonical('1.6.0-forge+mc1.20.1'), '1.6.0');
  assert.equal(V.canonical('2.6.5-forge+mc1.20.1-Patch.2'), '2.6.5+patch2');
  assert.equal(V.canonical('1.0.0-slim'), '1.0.0');
});
