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

test('解析不出来时返回 ambiguous，不假装相等', () => {
  assert.deepEqual(V.compareInfo('Latest', 'Unknown'), { cmp: 0, ambiguous: true });
  assert.equal(V.compareInfo('Latest', '1.0.0').ambiguous, true);
  assert.equal(V.compareInfo('', '1.0.0').ambiguous, true);
  assert.deepEqual(V.compareInfo('1.0.1', '1.0.0'), { cmp: 1, ambiguous: false });
  assert.deepEqual(V.compareInfo('1.0.0', '1.0.0'), { cmp: 0, ambiguous: false });
});

test('挑候选：正式版优先、版本高的优先、看不懂的排后面', () => {
  assert.deepEqual(
    ['1.0.0-beta.2', '1.0.0', '1.0.1'].sort(V.compareForPick),
    ['1.0.1', '1.0.0', '1.0.0-beta.2']
  );
  assert.deepEqual(
    ['Latest', '1.0.0'].sort(V.compareForPick),
    ['1.0.0', 'Latest']
  );
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

test('模组自身版本恰好与 MC 版本同形时，保留核心与预发布编号', () => {
  assert.deepEqual(V.parse('1.20.1-beta.2').core, [1, 20, 1]);
  assert.equal(V.compare('1.20.1-beta.2', '1.20.1'), -1);
  assert.equal(V.compare('1.21.0-rc.3', '1.21.0'), -1);
  assert.equal(V.compare('1.20.1-Patch.2', '1.20.1-Patch.10'), -1);
  assert.equal(V.compare('mc1.20.1-2.6.5-beta.2', '2.6.5'), -1);
});

test('前置区间支持预发布语义、或条件、空格和 0.x caret 边界', () => {
  assert.equal(V.mcMatches('>=1.0.0', '1.0.0-beta.2'), false);
  assert.equal(V.mcMatches('>= 2.0.0', '1.0.0'), false);
  assert.equal(V.mcMatches('1.19.x || 1.20.x', '1.20.1'), true);
  assert.equal(V.mcMatches('^0.2.1', '0.3.0'), false);
  assert.equal(V.mcMatches('^0.0.1', '0.0.2'), false);
  assert.equal(V.mcMatches('^0.2.1', '0.2.4'), true);
});
