const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/core/version');
require('../js/api/modrinth');
require('../js/core/resolver');
const MC = globalThis.MC;
const env = { loader: 'Fabric', mc: '1.20.1' };
const project = { id: 'example', slug: 'example', title: 'Example' };
const versions = ['1.0.0', '2.0.0', '3.0.0'].map(version_number => ({
  version_number, version_type: 'release', date_published: version_number
}));

test('没有满足前置区间的候选时返回 null', () => {
  assert.equal(MC.api.modrinth.pickVersion(versions, '>=4.0.0'), null);
  assert.equal(MC.api.modrinth.pickVersion(versions, '>=2.0.0 <3.0.0').version_number, '2.0.0');
});

test('自动与手动匹配都拒绝不满足要求的前置，下拉框只含兼容候选', async () => {
  MC.api.modrinth.project = async () => project;
  MC.api.modrinth.versions = async () => versions;
  const no = await MC.resolver.resolve({ id: 'example', range: '>=4.0.0' }, { env });
  assert.equal(no.ok, false);
  assert.equal(no.version, null);
  assert.match(no.reason, /没有满足版本要求/);
  const manual = await MC.resolver.resolveSlug('example', env, '>=4.0.0');
  assert.equal(manual.ok, false);
  const yes = await MC.resolver.resolveSlug('example', env, '>=2.0.0 <3.0.0');
  assert.equal(yes.ok, true);
  assert.deepEqual(yes.versions.map(v => v.version_number), ['2.0.0']);
});
