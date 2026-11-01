const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/core/identity.js');
require('../js/core/version.js');
require('../js/core/updates.js');

const U = globalThis.MC.updates;

/* 只提供 check/findProject 需要的几个接口 */
function stub(api) { globalThis.MC.api = { modrinth: api }; }

const RES = { id: 'res-id', slug: 'carryon', title: 'Carry On', project_type: 'resourcepack' };
const MOD = { id: 'mod-id', slug: 'carry-on', title: 'Carry On', project_type: 'mod' };
const FILE = 'carryon-forge-1.20.1-1.0.21.jar';

test('modId 撞上同名资源包时，不会把资源包当成这个模组', async () => {
  stub({
    versionFiles: async () => ({}),
    project: async id => (id === 'carryon' ? RES : id === 'carry-on' || id === 'mod-id' ? MOD : null),
    search: async () => [],
    get: async () => [{ files: [{ filename: FILE }], version_number: '1.0.21' }],
    versions: async () => []
  });
  const entry = { id: 'carryon', name: 'Carry On', fileName: FILE, version: '1.0.21', sha1: '' };
  const p = await U.findProject(entry);
  assert.equal(p, null);
  const res = await U.check(entry, { loader: 'forge', mc: '1.20.1' });
  assert.equal(res.status, 'notfound');
  assert.equal(res.url, undefined);
});

test('文件名对得上时，按名字搜到的 mod 会给出正确项目页', async () => {
  stub({
    versionFiles: async () => ({}),
    project: async id => (id === 'carryon' ? RES : id === 'mod-id' ? MOD : null),
    search: async () => [{ project_id: 'mod-id', slug: 'carry-on', title: 'Carry On', project_type: 'mod' }],
    get: async () => [{ files: [{ filename: FILE }], version_number: '1.0.21' }],
    versions: async () => [{ version_number: '1.0.22' }],
    pickVersion: list => (list && list[0]) || null
  });
  const entry = { id: 'carryon', name: 'Carry On', fileName: FILE, version: '1.0.21', sha1: '' };
  const res = await U.check(entry, { loader: 'forge', mc: '1.20.1' });
  assert.equal(res.status, 'newer');
  assert.equal(res.latest, '1.0.22');
  assert.equal(res.url, 'https://modrinth.com/mod/carry-on');
});

test('项目页链接按项目类型拼，资源包不会被写成 /mod', () => {
  assert.equal(U.projectUrl(RES), 'https://modrinth.com/resourcepack/carryon');
  assert.equal(U.projectUrl(MOD), 'https://modrinth.com/mod/carry-on');
});
