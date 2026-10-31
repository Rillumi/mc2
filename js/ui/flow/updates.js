/* ===== 流程：检查更新与导出导览 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const S = () => MC.store.state;
  const touch = () => MC.store.touch();
  const { toast, saveBlob } = MC.uiBase;
  const FC = MC.flowCommon;

  async function checkOneUpdate(groupId) {
    const st = S();
    if (!st.analysis) return;
    const g = st.analysis.groups.find(x => x.id === groupId);
    if (!g) return;
    const row = FC.chosenOf(st, g);
    if (!row) return;
    const my = FC.getGen();
    st.updates[groupId] = { status: 'checking' };
    touch();
    let res;
    try {
      res = await MC.updates.check(row.entry, st.env);
    } catch (err) {
      res = { status: 'error', reason: err && err.message ? err.message : String(err) };
    }
    if (my !== FC.getGen()) return;
    st.updates[groupId] = res;
    if (res.status === 'error' && FC.isNetworkError(res.reason)) {
      st.updateError = '连不上 Modrinth，可能是网络或代理问题。';
    }
    touch();
  }

  async function checkAllUpdates() {
    const st = S();
    if (st.updateBusy) return;
    const groups = st.analysis ? st.analysis.groups.slice() : [];
    if (!groups.length) return toast('先把 mods 文件夹拖进来');
    const my = FC.getGen();
    st.updateBusy = true;
    st.updateDone = 0;
    st.updateTotal = groups.length;
    st.updateError = '';
    groups.forEach(g => { st.updates[g.id] = { status: 'checking' }; });
    touch();

    const targets = groups.map(g => ({ g, row: FC.chosenOf(st, g) }));

    /* 一次性把能算哈希的 jar 交给 Modrinth：/version_files/update 一个请求查一堆，
       比逐个按 slug 查快得多；改名过的 jar 哈希不变，也照样能认出来。 */
    const hashed = targets.filter(t => t.row && t.row.entry.sha1);
    const noHash = targets.filter(t => t.row && !t.row.entry.sha1);
    st.updateTotal = hashed.length + noHash.length;
    const latestByHash = new Map();
    let batchError = null;
    const chunkSize = 80;
    try {
      for (let i = 0; i < hashed.length; i += chunkSize) {
        if (my !== FC.getGen()) return;
        const chunk = hashed.slice(i, i + chunkSize);
        const data = await MC.api.modrinth.versionFilesUpdate(
          chunk.map(t => t.row.entry.sha1), st.env
        );
        Object.keys(data || {}).forEach(h => latestByHash.set(h, data[h]));
        st.updateDone = Math.min(i + chunkSize, hashed.length);
        touch();
      }
    } catch (err) {
      batchError = err;
    }
    if (my !== FC.getGen()) return;

    let newer = 0;
    let notFound = 0;
    let skip = 0;
    for (const t of targets) {
      const gid = t.g.id;
      if (!t.row) { st.updates[gid] = { status: 'skip' }; skip++; continue; }
      // 没有哈希的留给下面按名字重查，先别判成“没收录”
      if (!t.row.entry.sha1) continue;
      const v = latestByHash.get(t.row.entry.sha1);
      if (!v) { st.updates[gid] = { status: 'notfound' }; notFound++; continue; }
      const latest = v.version_number || '';
      const cmp = t.row.entry.version ? MC.version.compare(latest, t.row.entry.version) : 1;
      const status = cmp > 0 ? 'newer' : 'current';
      st.updates[gid] = {
        status,
        latest,
        installed: t.row.entry.version || '',
        url: 'https://modrinth.com/mod/' + encodeURIComponent(v.project_id || ''),
        project: v.name || '',
        at: Date.now()
      };
      if (status === 'newer') newer++;
    }

    st.updateDone = hashed.length;

    // 没算成哈希的（非 Modrinth 文件 / 浏览器不支持 SHA-1）：只对这些少量文件按名字查一次
    const retry = noHash;
    if (retry.length) {
      let cursor = 0;
      const worker = async () => {
        while (cursor < retry.length) {
          if (my !== FC.getGen()) return;
          const t = retry[cursor++];
          let res;
          try {
            res = await MC.updates.check(t.row.entry, st.env);
          } catch (err) {
            res = { status: 'error', reason: err && err.message ? err.message : String(err) };
          }
          if (my !== FC.getGen()) return;
          st.updates[t.g.id] = res;
          st.updateDone++;
          touch();
        }
      };
      await Promise.all([worker(), worker()]);
    }

    if (my !== FC.getGen()) return;
    st.updateBusy = false;
    st.updateDone = st.updateTotal;
    if (batchError) {
      st.updateError = FC.isNetworkError(batchError.message)
        ? '连不上 Modrinth，可能是网络或代理问题。'
        : '批量查更新失败：' + (batchError.message || '未知错误');
    }
    touch();
    if (batchError) {
      toast('连不上 Modrinth，检查更新失败；本地整理和打包不受影响。');
      return;
    }
    toast('检查完成：' + newer + ' 个有新版本' +
      (notFound ? '，' + notFound + ' 个 Modrinth 没收录' : '') +
      (skip ? '，' + skip + ' 个没有可用版本' : '') +
      (retry.length ? '，' + retry.length + ' 个按名字查过' : ''));
  }

  function exportGuide() {
    const st = S();
    if (!st.analysis) return toast('先导入 mods 文件夹');
    const items = st.analysis.groups.map(g => {
      const row = FC.chosenOf(st, g);
      return row ? { groupId: g.id, entry: row.entry } : null;
    }).filter(Boolean);
    const md = MC.catalog.markdown(items, { env: st.env, updates: st.updates });
    saveBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), '整合包导览.md');
    toast('已导出 整合包导览.md');
  }

  MC.flowUpdates = { checkOneUpdate, checkAllUpdates, exportGuide };
})(globalThis);
