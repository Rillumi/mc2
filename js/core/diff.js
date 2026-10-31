/* ===== 对比两个整合包：按 modId 求 共有 / 只在当前 / 只在另一个 =====
   只看 jar 里写出来的主 modId；同一份文件不同版本算“共有但版本不同”。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  function keyOf(e) {
    const id = MC.identity.normalizeId(e && e.id);
    return id || MC.identity.fileBase(e && e.fileName);
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

    /* 整合包清单（CurseForge）常常只有名字，没有 modId：
       用 identity 的规范化名字 / 文件名兜底配对，避免同一个模组被误判成两份 */
    const restB = [];
    B.forEach((b, k) => {
      if (!usedB.has(k)) restB.push({ k, b });
    });
    const fallback = [MC.identity.LEVELS.NAME, MC.identity.LEVELS.FUZZY];
    A.forEach((a, k) => {
      if (matchedA.has(k)) return;
      const hit = restB.find(x => !usedB.has(x.k) && MC.identity.same(a, x.b, fallback));
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
