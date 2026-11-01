/* ===== 流程：打包整合包 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const S = () => MC.store.state;
  const touch = () => MC.store.touch();
  const { toast, saveBlob } = MC.uiBase;

  async function buildPack(format) {
    const st = S();
    if (st.busy) return;
    if (!st.analysis) return toast('先拖入模组文件夹');
    st.busy = true;
    st.progress = '正在读取本地 jar…';
    touch();
    try {
      const picked = MC.selector.selectedRows(st, st.analysis);
      // 拖入的文件直接读；整合包扫出来的条目按包内路径回读
      const readData = async e => {
        if (e.file) return new Uint8Array(await e.file.arrayBuffer());
        if (e.packName && e.packPath && MC.flowScan.readPackedBytes) {
          return await MC.flowScan.readPackedBytes(e.packName, e.packPath);
        }
        return null;
      };
      const localJars = [];
      for (const row of picked) {
        const data = await readData(row.entry);
        if (!data) continue;
        localJars.push({ name: row.entry.fileName, data });
      }
      const adapted = Object.keys(st.adapt || {}).map(k => st.adapt[k])
        .filter(x => x.added && x.status === 'ok' && x.version && x.project);
      const deps = st.deps.filter(d => d.added && d.status === 'ok' && d.version && d.project).concat(adapted);

      const extras = [];
      if (st.includePacks) {
        for (const o of (st.analysis.others || [])) {
          if (o.kind !== 'resourcepack' && o.kind !== 'shader') continue;
          const data = await readData(o);
          if (!data) continue;
          extras.push({ kind: o.kind, name: o.fileName, data });
        }
      }

      // 原整合包里的 config / defaultconfigs / kubejs / resourcepacks 等一并带走
      const overrides = [];
      if (format !== 'list') {
        for (const src of (st.packSources || [])) {
          if (!MC.flowScan.listPacked || !MC.overrides) continue;
          const plan = MC.overrides.plan(await MC.flowScan.listPacked(src.name));
          for (let i = 0; i < plan.length; i++) {
            if (i % 20 === 0) {
              st.progress = '正在复制原包内容 ' + (i + 1) + '/' + plan.length + '：' + plan[i].path;
              touch();
            }
            const data = await MC.flowScan.readPackedBytes(src.name, plan[i].src);
            if (data) overrides.push({ path: plan[i].path, data });
          }
        }
      }

      let result;
      if (format === 'list') {
        const local = picked.map(row => {
          const e = row.entry || {};
          const p = MC.flowCommon.projectForEntry(st, e, row.group);
          return {
            name: e.nameZh || e.name || e.fileName || '?',
            version: e.version || '',
            source: p ? 'Modrinth' : '本地 jar',
            url: p ? 'https://modrinth.com/mod/' + (p.slug || p.id) : ''
          };
        });
        deps.forEach(d => local.push({
          name: d.project.title || d.modId,
          version: (d.version && d.version.version_number) || '',
          source: 'Modrinth',
          url: 'https://modrinth.com/mod/' + (d.project.slug || d.project.id)
        }));
        const online = [];
        let original = '';
        (st.packSources || []).forEach(src => {
          (src.onlineList || []).forEach(o => online.push(o));
          if (!original && src.modlistHtml) original = src.modlistHtml;
        });
        st.progress = '正在生成下载清单…';
        touch();
        result = await MC.pack.buildListZip({
          title: (st.packSources[0] && st.packSources[0].name.replace(/\.[^.]+$/, '')) || 'ModPilot 下载清单',
          env: st.env, local, online, original
        });
      } else if (format === 'mrpack') {
        st.progress = '正在生成 .mrpack…';
        touch();
        result = await MC.pack.buildMrpack({ env: st.env, localJars, deps, extras, overrides });
      } else {
        result = await MC.pack.buildPlainZip({
          env: st.env, localJars, deps, extras, overrides,
          onProgress: text => { st.progress = text; touch(); }
        });
      }
      saveBlob(result.blob, result.filename);
      toast('已生成 ' + result.filename);
    } catch (err) {
      console.error(err);
      toast('打包失败：' + (err && err.message ? err.message : err));
    } finally {
      st.busy = false;
      st.progress = '';
      touch();
    }
  }

  MC.flowPack = { buildPack };
})(globalThis);
