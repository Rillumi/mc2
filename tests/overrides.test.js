const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/core/overrides.js');
const OV = globalThis.MC.overrides;

test('原包的配置、脚本、资源包会带走', () => {
  const paths = [
    'overrides/config/betterfps.toml',
    'overrides/defaultconfigs/ftbchunks/ftbchunks-world.snbt',
    'overrides/kubejs/server_scripts/a.js',
    'overrides/CustomSkinLoader/CustomSkinLoader.json',
    'overrides/emotes/bow1.json',
    'overrides/resourcepacks/汉化资源包.zip',
    'overrides/shaderpacks/光影.zip',
    'overrides/options.txt',
    'overrides/icon.png'
  ];
  const plan = OV.plan(paths);
  assert.equal(plan.length, paths.length);
  plan.forEach(p => assert.equal(p.path.indexOf('overrides/'), -1));
});

test('mods、启动器文件、本地状态不带', () => {
  const drop = [
    'overrides/mods/a.jar',
    'overrides/PCL/Setup.ini',
    'overrides/PCL/Logo.png',
    'overrides/TrashSlotSaveState.json',
    'overrides/ffmpeg.exe',
    'overrides/.addurdisc/pack.mcmeta',
    'overrides/saves/世界/level.dat',
    'overrides/logs/latest.log',
    'overrides/screenshots/a.png'
  ];
  assert.deepEqual(OV.plan(drop), []);
});

test('plan 同时给出原包路径和导出路径', () => {
  assert.deepEqual(OV.plan(['overrides/config/a/b.toml']), [{ src: 'overrides/config/a/b.toml', path: 'config/a/b.toml' }]);
  assert.deepEqual(OV.plan(['config/a.toml']), [{ src: 'config/a.toml', path: 'config/a.toml' }]);
});

test('目录名不区分大小写', () => {
  assert.equal(OV.keepable('overrides/CustomSkinLoader/x.json'), true);
  assert.equal(OV.keepable('overrides/customskinloader/x.json'), true);
  assert.equal(OV.keepable('overrides/mods2/a.jar'), false);
});
