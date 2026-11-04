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

test('同一 modId 的新哈希不会复用旧项目缓存', async()=>{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 globalThis.fetch=async()=>({ok:false});
 stub({versionFiles:async hashes=>({[hashes[0]]:{project_id:hashes[0]}}),project:async id=>({...MOD,id})});
 const a={id:'same',sha1:'old-hash'},b={id:'same',sha1:'new-hash'};
 assert.equal((await U.findProject(a)).id,'old-hash');
 assert.equal((await U.findProject(b)).id,'new-hash');
 assert.equal(U.cachedProject(a).id,'old-hash');
 assert.equal(U.cachedProject(b).id,'new-hash');
 delete globalThis.localStorage;
});
test('常见版本号相等不能作为项目身份依据',async()=>{
 stub({versionFiles:async()=>({}),project:async()=>MOD,get:async()=>[{version_number:'1.0.0',files:[{filename:'other.jar'}]}],search:async()=>[]});
 assert.equal(await U.findProject({id:'example',name:'Example',fileName:'example.jar',version:'1.0.0'}),null);
});
test('本地没有版本号时更新状态为无法比较',async()=>{
 stub({versions:async()=>[{version_number:'2'}],pickVersion:list=>list[0]});
 assert.equal((await U.check({id:'example'}, {}, MOD)).status,'ambiguous');
});
