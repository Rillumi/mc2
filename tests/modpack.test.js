const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/core/modpack.js');
const MP = globalThis.MC.modpack;

const map = names => new Map(names.map(n => [n, {}]));

test('从中央目录认出整合包类型', () => {
  assert.equal(MP.detect(map(['modrinth.index.json', 'mods/a.jar'])), 'mrpack');
  assert.equal(MP.detect(map(['manifest.json', 'modlist.html', 'overrides/config/a.toml'])), 'curseforge');
  assert.equal(MP.detect(map(['manifest.json', 'overrides/config/a.toml'])), 'curseforge');
  assert.equal(MP.detect(map(['mods/a.jar', 'config/a.toml'])), 'zip');
  assert.equal(MP.detect(map(['overrides/mods/b.jar'])), 'zip');
  assert.equal(MP.detect(map(['pack.mcmeta', 'assets/a.png'])), '');
});

test('只列出 mods/ 与 overrides/mods/ 下的 jar', () => {
  const paths = MP.jarPaths(map([
    'mods/a.jar', 'mods/b.JAR', 'mods/sub/c.jar',
    'overrides/mods/d.jar', 'config/e.jar', 'resourcepacks/x.zip'
  ]));
  assert.deepEqual(paths.sort(), ['mods/a.jar', 'mods/b.JAR', 'overrides/mods/d.jar']);
});

test('mrpack 清单里的环境', () => {
  assert.deepEqual(
    MP.envFromMrpack({ dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.15.11' } }),
    { mc: '1.20.1', loader: 'Fabric', loaderVersion: '0.15.11' }
  );
  assert.deepEqual(
    MP.envFromMrpack({ dependencies: { minecraft: '1.19.2', forge: '43.2.0' } }),
    { mc: '1.19.2', loader: 'Forge', loaderVersion: '43.2.0' }
  );
  assert.deepEqual(MP.envFromMrpack({}), {});
});

test('CurseForge 清单里的环境', () => {
  assert.deepEqual(
    MP.envFromCurse({
      minecraft: { version: '1.18.2' },
      modLoaders: [{ id: 'forge-40.1.0', primary: true }, { id: 'fabric-0.14.0' }]
    }),
    { mc: '1.18.2', loader: 'Forge', loaderVersion: '40.1.0' }
  );
  assert.deepEqual(
    MP.envFromCurse({ minecraft: { version: '1.20.1' }, modLoaders: [{ id: 'neoforge-47.1.0' }] }),
    { mc: '1.20.1', loader: 'NeoForge', loaderVersion: '47.1.0' }
  );
  // Quilt 不是本工具支持的加载器，只取 MC 版本
  assert.deepEqual(
    MP.envFromCurse({ minecraft: { version: '1.20.1' }, modLoaders: [{ id: 'quilt-0.20.1' }] }),
    { mc: '1.20.1' }
  );
  assert.deepEqual(MP.envFromCurse({}), {});
});
