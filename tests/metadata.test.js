const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/core/zip-reader.js');
require('../js/core/metadata.js');

/* 最小 ZIP（仅 store 存储），够 zip-reader 读中央目录即可 */
function makeZip(files) {
  const parts = [];
  const centrals = [];
  let off = 0;
  for (const f of files) {
    const data = Buffer.from(f.data);
    const name = Buffer.from(f.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);              // method = store
    local.writeUInt32LE(data.length, 18);   // comp size
    local.writeUInt32LE(data.length, 22);   // uncomp size
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);           // method = store
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(off, 42);

    parts.push(local, name, data);
    centrals.push(central, name);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(off, 16);
  const all = Buffer.concat(parts.concat([cd, eocd]));
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

test('fabric.mod.json 字符串里有裸换行也能识别成模组', async () => {
  // 真实例子：EuphoriaPatcher 的 description 里有未转义的换行，JSON.parse 会直接报错
  const broken = '{\n' +
    '  "schemaVersion": 1,\n' +
    '  "id": "euphoria_patcher",\n' +
    '  "version": "1.8.1-r5.7.1-fabric",\n' +
    '  "name": "Euphoria Patcher",\n' +
    '  "description": "A mod that applies the Euphoria Patches add-on.\nEnable it in the shader settings.",\n' +
    '  "depends": { "fabricloader": ">=0.10.7", "minecraft": ">=1.14.0" }\n' +
    '}';
  assert.throws(() => JSON.parse(broken), /control character/i);

  const jar = makeZip([{ name: 'fabric.mod.json', data: broken }]);
  const res = await MC.metadata.inspect(jar);
  assert.equal(res.kind, 'mod');
  assert.equal(res.info.id, 'euphoria_patcher');
  assert.equal(res.info.name, 'Euphoria Patcher');
  assert.match(res.info.description, /Enable it in the shader settings/);
});

test('正常的 fabric.mod.json 行为不变', async () => {
  const jar = makeZip([{
    name: 'fabric.mod.json',
    data: JSON.stringify({ schemaVersion: 1, id: 'demo_mod', version: '1.0.0', name: 'Demo Mod' })
  }]);
  const res = await MC.metadata.inspect(jar);
  assert.equal(res.kind, 'mod');
  assert.equal(res.info.id, 'demo_mod');
});
