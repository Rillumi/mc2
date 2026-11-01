/* ===== Murmur2（32 位）：CurseForge 指纹用 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  /* 标准 MurmurHash2，seed 必须传无符号整数 */
  function hash(bytes, seed) {
    const m = 0x5bd1e995;
    const r = 24;
    const n = bytes.length;
    let h = ((seed >>> 0) ^ n) >>> 0;
    const n4 = n & ~3;
    for (let i = 0; i < n4; i += 4) {
      let k = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
      k = Math.imul(k, m) >>> 0;
      k ^= k >>> r;
      k = Math.imul(k, m) >>> 0;
      h = Math.imul(h, m) >>> 0;
      h ^= k;
    }
    const rest = n & 3;
    if (rest === 3) h ^= bytes[n4 + 2] << 16;
    if (rest >= 2) h ^= bytes[n4 + 1] << 8;
    if (rest >= 1) {
      h ^= bytes[n4];
      h = Math.imul(h, m) >>> 0;
    }
    h ^= h >>> 13;
    h = Math.imul(h, m) >>> 0;
    h ^= h >>> 15;
    return h >>> 0;
  }

  /* CurseForge 认的指纹：整个文件算 Murmur2，种子 1 */
  function fingerprint(bytes) {
    return hash(bytes, 1);
  }

  MC.murmur2 = { hash, fingerprint };
})(globalThis);
