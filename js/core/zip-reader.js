/* ===== ZIP 读取：中央目录 + ZIP64 + deflate-raw 解压 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  function findEocd(dv, u8) {
    const min = Math.max(0, u8.length - 22 - 65535);
    for (let i = u8.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  function u64(dv, pos) {
    return dv.getUint32(pos, true) + dv.getUint32(pos + 4, true) * 4294967296;
  }

  function parseCentral(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const eocd = findEocd(dv, u8);
    if (eocd < 0) throw new Error('不是有效的 jar/zip 文件');

    let count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);

    // 条目数超过 65535（如 Reminia 的 7 万条目）时走 ZIP64 记录
    if (count === 0xFFFF || off === 0xFFFFFFFF) {
      const loc = eocd - 20;
      if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
        const z64 = u64(dv, loc + 8);
        if (z64 + 56 <= u8.length && dv.getUint32(z64, true) === 0x06064b50) {
          count = u64(dv, z64 + 32);
          off = u64(dv, z64 + 48);
        }
      }
    }

    const map = new Map();
    for (let i = 0; i < count && off + 46 <= u8.length; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      const name = new TextDecoder('utf-8').decode(u8.subarray(off + 46, off + 46 + nameLen));
      if (localOff !== 0xFFFFFFFF) map.set(name, { method, compSize, localOff });
      off += 46 + nameLen + extraLen + commentLen;
    }
    return { map, dv, u8 };
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持解压（请用较新的 Chrome / Edge）');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readEntryBytes(zip, name) {
    const ent = zip.map.get(name);
    if (!ent) return null;
    const { dv, u8 } = zip;
    if (dv.getUint32(ent.localOff, true) !== 0x04034b50) return null;
    const nameLen = dv.getUint16(ent.localOff + 26, true);
    const extraLen = dv.getUint16(ent.localOff + 28, true);
    const start = ent.localOff + 30 + nameLen + extraLen;
    const raw = u8.subarray(start, start + ent.compSize);
    return ent.method === 0 ? raw : await inflateRaw(raw);
  }

  async function readEntry(zip, name) {
    const bytes = await readEntryBytes(zip, name);
    return bytes ? new TextDecoder('utf-8').decode(bytes) : null;
  }

  MC.zip = { parseCentral, readEntry, readEntryBytes, findEocd, inflateRaw };
})(globalThis);
