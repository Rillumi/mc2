/* ===== ZIP 写入（打包用，不依赖第三方库） =====
   local header + 中央目录 + EOCD；文件名 UTF-8（flag 0x0800）；
   大于 512 字节的内容尝试 deflate-raw，压不小就存储。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const enc = new TextEncoder();
  let table = null;

  function buildTable() {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  }

  function crc32(u8) {
    if (!table) table = buildTable();
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = table[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  async function deflateRaw(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      return null;
    }
  }

  function dosTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xFFFF, date: date & 0xFFFF };
  }

  /** files: [{path, data:Uint8Array|ArrayBuffer, store?}] → Blob */
  async function build(files) {
    const now = dosTime(new Date());
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      const name = enc.encode(String(f.path).replace(/\\/g, '/'));
      let out = data;
      let method = 0;
      if (!f.store && data.length > 512) {
        const packed = await deflateRaw(data);
        if (packed && packed.length < data.length) { out = packed; method = 8; }
      }
      const crc = crc32(data);

      const lh = new Uint8Array(30 + name.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, method, true);
      lv.setUint16(10, now.time, true);
      lv.setUint16(12, now.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, out.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      lh.set(name, 30);
      chunks.push(lh, out);

      const ch = new Uint8Array(46 + name.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, method, true);
      cv.setUint16(12, now.time, true);
      cv.setUint16(14, now.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, out.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);

      offset += lh.length + out.length;
    }

    const cdStart = offset;
    let cdSize = 0;
    central.forEach(c => { cdSize += c.length; });

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdStart, true);

    return new Blob(chunks.concat(central, [eocd]), { type: 'application/zip' });
  }

  MC.zipWriter = { build, crc32, deflateRaw };
})(globalThis);
