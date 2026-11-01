/* ===== 流程：下载链接库与爱发电名单 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const S = () => MC.store.state;
  const touch = () => MC.store.touch();
  const { toast } = MC.uiBase;
  const FC = MC.flowCommon;

  /* ---------- 爱发电：更新我发电过的作者名单 ---------- */
  async function refreshAfdian() {
    const st = S();
    if (st.afdian && st.afdian.busy) return;
    try {
      await MC.afdian.refresh();
      toast('爱发电名单已更新');
    } catch (err) {
      toast('爱发电更新失败：' + (err.message || err));
    }
    touch();
  }

  /* ---------- 下载页仓库：MySQL / 本地兜底 ---------- */
  function syncDbState() {
    const d = MC.linksdb.state;
    S().db = {
      mode: d.mode, ready: d.ready, error: d.error,
      sites: d.sites || [], counts: d.counts || {}, dbName: d.dbName || 'modpilot'
    };
    touch();
  }

  async function addLink(modId, modName, url, note) {
    try {
      const r = await MC.linksdb.add([{ modId, modName, url, note }]);
      syncDbState();
      toast(r.db ? '已存进 MySQL，换浏览器也还在' : '已存浏览器（数据库没连上）');
    } catch (err) {
      const st = S();
      const id = modId || '未归属';
      st.links[id] = (st.links[id] || []).concat({ url, note, at: Date.now() });
      MC.store.saveLinks();
      touch();
      toast('数据库写入失败，先存浏览器：' + (err.message || ''));
    }
  }

  async function removeLink(item) {
    try {
      await MC.linksdb.remove(item);
      syncDbState();
    } catch (err) {
      toast('删除失败：' + (err.message || ''));
    }
  }

  async function bulkLinks(ta) {
    const st = S();
    const lines = String(ta.value || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (!lines.length) return toast('先把要存的链接贴进来');

    const known = [];
    if (st.analysis) {
      st.analysis.groups.forEach(g => {
        const row = FC.chosenOf(st, g);
        if (!row) return;
        const e = row.entry;
        [e.id, e.name, e.nameZh].forEach(x => {
          if (x) known.push({ key: String(x).toLowerCase(), id: e.id || g.displayId, name: e.nameZh || e.name || '' });
        });
      });
    }

    const items = [];
    let bad = 0;
    lines.forEach(line => {
      const parts = line.split('|').map(x => x.trim());
      let key = '';
      let url = '';
      let note = '';
      if (parts.length >= 3) { key = parts[0]; url = parts[1]; note = parts.slice(2).join(' | '); }
      else if (parts.length === 2) { url = parts[0]; note = parts[1]; }
      else { url = parts[0]; }
      if (!/^https?:\/\//i.test(url)) { bad++; return; }
      let modId = '';
      let modName = '';
      if (key) {
        const hit = known.find(k => k.key === key.toLowerCase());
        if (hit) { modId = hit.id; modName = hit.name; }
      }
      items.push({ modId, modName, url, note });
    });

    if (!items.length) return toast('没有能存的链接（链接格式不对）');
    try {
      const r = await MC.linksdb.add(items);
      syncDbState();
      ta.value = '';
      toast('批量导入：存了 ' + r.saved + ' 条' + (bad ? '，跳过 ' + bad + ' 条（链接格式不对）' : '') +
        (r.db ? '' : '（数据库没连上，先存浏览器）'));
    } catch (err) {
      toast('批量写入失败：' + (err.message || ''));
    }
  }

  /* ---------- 爱发电：把作者主页写进公开映射表（所有人共用） ---------- */
  async function syncAfdianMap() {
    const st = S();
    const creators = (st.afdian && st.afdian.creators) || [];
    const items = [];
    const seen = {};
    let modCount = 0;
    const missed = [];
    const push = it => {
      const k = String(it.key || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
      if (!k || seen[k]) return;
      seen[k] = 1;
      items.push(it);
    };

    creators.forEach(c => {
      if (!c || !c.home || !c.name || !MC.afdianMap.isAfdian(c.home)) return;
      push({ key: c.name, name: c.name, home: c.home, source: 'afdian-creator', kind: 'author' });
    });

    /* 每个模组单独存一条：别人拿到同一个 modId，就算作者名对不上也能反查到主页 */
    (st.analysis ? st.analysis.groups || [] : []).forEach(g => {
      const row = FC.chosenOf(st, g);
      if (!row || !row.entry) return;
      let hit = [];
      try { hit = MC.afdian.find(row.entry, 1); } catch (err) { hit = []; }
      const c = hit[0] && hit[0].creator;
      if (!c || !c.home || !MC.afdianMap.isAfdian(c.home)) {
        if (missed.length < 8) missed.push(row.entry.nameZh || row.entry.name || row.entry.id || '');
        return;
      }
      [[row.entry.id, 'modid'], [row.entry.nameZh, 'zh'], [row.entry.name, 'en']].forEach(([k, kind]) => {
        if (!k) return;
        const before = items.length;
        push({ key: k, name: c.name || k, home: c.home, source: 'afdian-mod', kind });
        if (items.length > before) modCount++;
      });
    });

    if (!items.length) return toast('还没有作者名单，先点「更新爱发电」');
    try {
      const r = await MC.afdianMap.save(items);
      toast(r.saved
        ? '已写进公开映射表 ' + r.saved + ' 条（作者 ' + creators.length + ' 位、模组 ' + modCount + ' 个）'
          + ((r.conflicts || []).length ? '；' + r.conflicts.length + ' 条已有不同主页，没覆盖' : '')
          + (missed.length ? '；没匹配到作者：' + missed.join('、') : '')
        : '没写进去（本地服务或数据库没起来）');
    } catch (err) {
      toast('写入映射表失败：' + (err.message || err));
    }
  }

  MC.flowLinks = { refreshAfdian, syncAfdianMap, syncDbState, addLink, removeLink, bulkLinks };
})(globalThis);
