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

      let result;
      if (format === 'mrpack') {
        st.progress = '正在生成 .mrpack…';
        touch();
        result = await MC.pack.buildMrpack({ env: st.env, localJars, deps, extras });
      } else {
        result = await MC.pack.buildPlainZip({
          env: st.env, localJars, deps, extras,
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
