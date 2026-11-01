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
        localJars.push({ name: row.entry.fileName, sha1: row.entry.sha1 || '', data });
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
      if (format !== 'manifest') {
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
      const localList = () => picked.map(row => {
        const e = row.entry || {};
        const p = MC.flowCommon.projectForEntry(st, e, row.group);
        return {
          name: e.nameZh || e.name || e.fileName || '?',
          version: e.version || '',
          source: p ? 'Modrinth' : '本地文件',
          url: p ? 'https://modrinth.com/mod/' + (p.slug || p.id) : ''
        };
      });
      const packTitle = (st.packSources[0] && st.packSources[0].name.replace(/\.(mrpack|zip)$/i, '')) ||
        ('ModPilot ' + st.env.loader + ' ' + st.env.mc);

      const results = [];
      if (format === 'manifest') {
        // 下载清单：每次都出，跟有没有 key 无关
        const local = localList();
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
        // 文件名已经打进包里的在线项去掉，免得清单里出现两份
        const usedNames = picked.map(r => (r.entry && r.entry.fileName) || '');
        const onlineClean = MC.pack.dedupe ? MC.pack.dedupe(online, usedNames) : online;
        st.progress = '正在生成下载清单…';
        touch();
        results.push(await MC.pack.buildListZip({
          title: packTitle, env: st.env, local, online: onlineClean, original
        }));
      } else if (format === 'curse') {
        if (!MC.api.curseforge.hasKey()) {
          toast('先在「工具 → 设置」里填 CurseForge 的 API key');
          return;
        }
          st.progress = '正在反查 CurseForge 指纹…';
          touch();
          const items = localJars.map(j => ({
            fp: MC.murmur2.fingerprint(j.data),
            name: j.name, size: j.data.length, sha1: j.sha1
          }));
          const hook = await MC.api.curseforge.lookup(items);
          const matched = hook.matches || {};
          const projIds = [];
          Object.keys(matched).forEach(fp => { if (matched[fp].projectID) projIds.push(matched[fp].projectID); });
          const info = await MC.api.curseforge.modsInfo(projIds);
          const matchedIds = {};
          const blockedNames = [];
          const seenBlocked = {};
          Object.keys(matched).forEach(fp => {
            const m = matched[fp];
            if (!m.fileID) return;
            matchedIds[m.fileID] = 1;
            const mod = info.mods && info.mods[m.projectID];
            if (mod && mod.allowModDistribution === false && !seenBlocked[m.fileID]) {
              seenBlocked[m.fileID] = 1;
              blockedNames.push(m.fileName || String(m.projectID));
            }
          });
          const matchedFps = {};
          Object.keys(matched).forEach(fp => { matchedFps[fp] = 1; });
          const unmatched = items.filter(it => !matchedFps[it.fp]).map(it => it.name);

          // 项目页链接：优先用 API 给的 websiteUrl，没有就用 /projects/<id>
          const urls = {};
          Object.keys(info.mods || {}).forEach(id => {
            const u = info.mods[id] && info.mods[id].links && info.mods[id].links.websiteUrl;
            if (u) urls[id] = u;
          });

          // 清单里只留没打进包的：已经放进 overrides/mods 的不再让启动器下一次
          const files = [];
          const seenFile = {};
          (st.packSources || []).forEach(src => (src.onlineList || []).forEach(o => {
            if (!o.projectID || !o.fileID || matchedIds[o.fileID]) return;
            const k = o.projectID + ':' + o.fileID;
            if (seenFile[k]) return;
            seenFile[k] = 1;
            files.push({ projectID: o.projectID, fileID: o.fileID });
          }));

          // Modrinth 前置直接下好放进 overrides/mods，CF 清单里没有它们的位置
          const jars = localJars.slice();
          for (const dep of deps) {
            const f = dep.version && dep.version.files && dep.version.files[0];
            if (!f) continue;
            st.progress = '正在下载 ' + (dep.project.title || dep.project.slug) + '…';
            touch();
            try {
              const bytes = await MC.api.modrinth.download(f.url);
              jars.push({ name: f.filename || ((dep.project.slug || 'mod') + '.jar'), data: bytes });
            } catch { /* 下不下来就只能靠安装说明里留个记录 */ }
          }
          if (!hook.ok) toast('指纹反查没成功：' + hook.reason + '（清单里可能还留着已打包的模组）');

          st.progress = '正在生成 CurseForge 整合包…';
          touch();
          results.push(await MC.pack.buildCurse({
            title: packTitle, env: st.env, jars, extras, overrides, files, urls,
            local: localList(), online: files, unmatched, blocked: blockedNames,
            matched: Object.keys(matchedIds).length
          }));
      } else if (format === 'mrpack') {
        st.progress = '正在生成 .mrpack…';
        touch();
        results.push(await MC.pack.buildMrpack({ env: st.env, localJars, deps, extras, overrides }));
      } else {
        st.progress = '正在打包离线 zip…';
        touch();
        results.push(await MC.pack.buildPlainZip({
          env: st.env, localJars, deps, extras, overrides,
          onProgress: text => { st.progress = text; touch(); }
        }));
      }
      results.forEach(r => saveBlob(r.blob, r.filename));
      toast('已生成 ' + results.map(r => r.filename).join(' 和 '));

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
