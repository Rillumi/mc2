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

  function compare(current, other) {
    const A = index(current);
    const B = index(other);
    const common = [];
    const onlyA = [];
    const onlyB = [];

    A.forEach((a, k) => {
      const b = B.get(k);
      if (b) {
        const va = String(a.version || '');
        const vb = String(b.version || '');
        const same = !va || !vb ? va === vb : (MC.version.cmp(va, vb) === 0 && va === vb);
        common.push({ id: k, name: pickName(a), a, b, same, va, vb });
      } else {
        onlyA.push({ id: k, name: pickName(a), entry: a });
      }
    });
    B.forEach((b, k) => {
      if (!A.has(k)) onlyB.push({ id: k, name: pickName(b), entry: b });
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

  MC.diff = { compare };
})(globalThis);
