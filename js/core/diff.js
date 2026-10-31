/* ===== 对比两个整合包：按 modId 求 共有 / 只在当前 / 只在另一个 =====
   只看 jar 里写出来的主 modId；同一份文件不同版本算“共有但版本不同”。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  function keyOf(e) {
    return String((e && (e.id || e.fileName)) || '').toLowerCase();
  }

  function index(mods) {
    const map = new Map();
    (mods || []).forEach(e => {
      if ((e.kind || 'mod') !== 'mod') return;
      const k = keyOf(e);
      if (!k) return;
      if (!map.has(k)) map.set(k, e);
    });
    return map;
  }

  function pickName(e) {
    return e.name || e.id || e.fileName;
  }

  /** 整合包清单（CurseForge）只有名字，没有 modId，用规范化名字兜底配对 */
  function nameKey(e) {
    return String((e && (e.name || e.fileName)) || '')
      .toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
  }

  function compare(current, other) {
    const A = index(current);
    const B = index(other);
    const common = [];
    const onlyA = [];
    const onlyB = [];
    const matchedA = new Set();
    const usedB = new Set();

    const record = (id, a, b) => {
      const va = String(a.version || '');
      const vb = String(b.version || '');
      const same = !va || !vb ? true : MC.version.equals(va, vb);
      common.push({ id, name: pickName(a), a, b, same, va, vb });
    };

    A.forEach((a, k) => {
      const b = B.get(k);
      if (!b) return;
      matchedA.add(k);
      usedB.add(k);
      record(k, a, b);
    });

    const B2 = new Map();
    B.forEach((b, k) => {
      if (usedB.has(k)) return;
      const nk = nameKey(b);
      if (nk && nk.length >= 4 && !B2.has(nk)) B2.set(nk, { k, b });
    });
    A.forEach((a, k) => {
      if (matchedA.has(k)) return;
      const nk = nameKey(a);
      const hit = nk && B2.get(nk);
      if (!hit) return;
      matchedA.add(k);
      usedB.add(hit.k);
      record(k, a, hit.b);
    });

    A.forEach((a, k) => {
      if (!matchedA.has(k)) onlyA.push({ id: k, name: pickName(a), entry: a });
    });
    B.forEach((b, k) => {
      if (!usedB.has(k)) onlyB.push({ id: k, name: pickName(b), entry: b });
    });

    const byName = (x, y) => String(x.name).localeCompare(String(y.name), 'zh');
    common.sort(byName);
    onlyA.sort(byName);
    onlyB.sort(byName);

    return {
      common,
      onlyA,
      onlyB,
      versionDiff: common.filter(x => !x.same),
      counts: {
        same: common.length - common.filter(x => !x.same).length,
        common: common.length,
        onlyA: onlyA.length,
        onlyB: onlyB.length,
        versionDiff: common.filter(x => !x.same).length
      }
    };
  }

  /* 资源包 / 光影：按文件名配对，同名就并排比覆盖的文件数 */
  function packIndex(list) {
    const map = new Map();
    (list || []).forEach(e => {
      if (e.kind !== 'resourcepack' && e.kind !== 'shader') return;
      const k = String(e.fileName || '').toLowerCase();
      if (k && !map.has(k)) map.set(k, e);
    });
    return map;
  }

  function comparePacks(current, other) {
    const A = packIndex(current);
    const B = packIndex(other);
    const common = [];
    const onlyA = [];
    const onlyB = [];
    A.forEach((a, k) => {
      const b = B.get(k);
      if (b) {
        const na = (a.assets && a.assets.length) || 0;
        const nb = (b.assets && b.assets.length) || 0;
        common.push({ id: k, name: a.fileName, a, b, same: na === nb && a.size === b.size, na, nb });
      } else onlyA.push({ id: k, name: a.fileName, entry: a });
    });
    B.forEach((b, k) => {
      if (!A.has(k)) onlyB.push({ id: k, name: b.fileName, entry: b });
    });
    const byName = (x, y) => String(x.name).localeCompare(String(y.name), 'zh');
    common.sort(byName);
    onlyA.sort(byName);
    onlyB.sort(byName);
    const count = common.length + onlyA.length + onlyB.length;
    return { common, onlyA, onlyB, count };
  }

  MC.diff = { compare, comparePacks };
})(globalThis);
