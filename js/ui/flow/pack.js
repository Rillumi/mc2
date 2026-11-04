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
    st.progress = '正在核对间接前置…';
    touch();
    try {
      const start = MC.plan.refresh(st).rootFingerprint;
      if (format !== 'manifest') await MC.dependencies.checkState(st);
      if (format !== 'manifest') {
        st.progress='正在核对原包在线依赖…';
        await MC.platformDeps.checkState(st);
      }
      const plan = MC.plan.refresh(st);
      if(plan.rootFingerprint!==start)throw new Error('依赖检查期间方案已改变，请重新生成');
      if(format!=='manifest'&&plan.errors.length)throw new Error(plan.errors.slice(0,3).join('；'));
      const picked = plan.rows;
      // 拖入的文件直接读；整合包扫出来的条目按包内路径回读
      const readData = async e => {
        if (e.file) return new Uint8Array(await e.file.arrayBuffer());
        if (e.packName && e.packPath && MC.flowScan.readPackedBytes) {
          return await MC.flowScan.readPackedBytes(e.packName, e.packPath);
        }
        return null;
      };
      const localJars = [];
      const skippedFiles = [];
      for (const row of picked) {
        const data = await readData(row.entry);
        if (!data) {
          skippedFiles.push((row.entry && row.entry.fileName) || '(未知文件)');
          continue;
        }
        localJars.push({ name: row.entry.fileName, sha1: row.entry.sha1 || '', data });
      }
      const deps = plan.online;

      const localHashes = new Set(localJars.map(j => j.sha1).filter(Boolean));
      const onlineFiles = [];
      const seenOnline = new Map();
      for (const src of (st.packSources || [])) {
        for (const f of (src.onlineList || [])) {
          if (f.hashes && localHashes.has(f.hashes.sha1)) continue;
          const key = f.path || (f.projectID + ':' + f.fileID);
          const old = seenOnline.get(key);
          if (old) {
            if (JSON.stringify(old.hashes) !== JSON.stringify(f.hashes)) throw new Error('原包在线文件冲突：' + key);
            continue;
          }
          seenOnline.set(key, f);
          onlineFiles.push(f);
        }
      }
      if (format !== 'manifest') {
        const unconvertible = onlineFiles.some(f => format === 'curse' ? !f.projectID || !f.fileID : !f.path);
        if (unconvertible) throw new Error('原包在线清单不能直接转换为此格式，请选择原包格式或导出下载清单');
      }

      // 能对上源的 sha1：包内文件要逐个核对，防止写错字节
      const knownHashes = localJars.map(j => j.sha1).filter(Boolean);
      deps.forEach(d => {
        const f = d.version && d.version.files && d.version.files[0];
        if (f && f.hashes && f.hashes.sha1) knownHashes.push(f.hashes.sha1);
      });
      onlineFiles.forEach(f => { if (f.hashes && f.hashes.sha1) knownHashes.push(f.hashes.sha1); });
      const depFailed = [];

      const extras = [];
      if (st.includePacks) {
        for (const o of (st.analysis.others || [])) {
          if (o.kind !== 'resourcepack' && o.kind !== 'shader') continue;
          const data = await readData(o);
          if (!data) {
            skippedFiles.push('资源包/光影 ' + (o.fileName || '?'));
            continue;
          }
          extras.push({ kind: o.kind, name: o.fileName, data });
        }
      }

      // 原整合包里的 config / defaultconfigs / kubejs / resourcepacks 等一并带走
      const overrides = [];
      let overrideFailed = 0;
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
            else overrideFailed++;
          }
        }
      }

      if (skippedFiles.length || overrideFailed) {
        throw new Error('有 ' + (skippedFiles.length + overrideFailed) + ' 个源文件读不到，已停止导出，请重新导入后重试');
      }
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
      const source = (st.packSources || [])[0];
      const packTitle = (source && source.name.replace(/\.(mrpack|zip)$/i, '')) ||
        ('ModPilot ' + st.env.loader + ' ' + st.env.mc);

      const results = [];
      if (format === 'manifest') {
        // 下载清单：每次都出，跟有没有 key 无关
        const local = localList();
        const online = [];
        // 需要在线下载的：补的前置 / 换过的版本，都带直链，清单里单列一张表
        deps.forEach(d => {
          const f = d.version && d.version.files && d.version.files[0];
          if (!f || !f.url) return;
          online.push({
            path: 'mods/' + (f.filename || ((d.project.slug || 'mod') + '.jar')),
            url: f.url
          });
        });
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
          onlineFiles.forEach(o => {
            if (!o.projectID || !o.fileID || matchedIds[o.fileID]) return;
            const k = o.projectID + ':' + o.fileID;
            if (seenFile[k]) return;
            seenFile[k] = 1;
            files.push({ projectID: o.projectID, fileID: o.fileID });
          });

          // Modrinth 前置直接下好放进 overrides/mods，CF 清单里没有它们的位置
          const jars = localJars.slice();
          for (const dep of deps) {
            const f = dep.version && dep.version.files && dep.version.files[0];
            if (!f) throw new Error('前置缺少下载文件：' + dep.project.title);
            st.progress = '正在下载 ' + (dep.project.title || dep.project.slug) + '…';
            touch();
            try {
              const bytes = await MC.api.modrinth.download(f.url);
              jars.push({ name: f.filename || ((dep.project.slug || 'mod') + '.jar'), data: bytes });
            } catch (err) {
              throw new Error('前置下载失败：' + (dep.project.title || dep.project.slug));
            }
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
        results.push(await MC.pack.buildMrpack({ env: st.env, localJars, deps, extras, overrides, onlineFiles }));
      } else {
        st.progress = '正在打包离线 zip…';
        touch();
        results.push(await MC.pack.buildPlainZip({
          env: st.env, localJars, deps, extras, overrides, onlineFiles,
          onProgress: text => { st.progress = text; touch(); }
        }));
      }
      // 生成后回读：清单结构、条目数、包内 jar 的 sha1 都对一遍
      if (MC.pack.verify) {
        for (const r of results) {
          const meta = Object.assign({}, r.meta || {}, { hashes: knownHashes });
          r.verify = await MC.pack.verify(r.blob, meta, (i, n, name) => {
            st.progress = '正在校验包内文件 ' + i + '/' + n + '：' + name;
            touch();
          });
        }
      }

      const failedChecks = results.flatMap(r => (r.verify && r.verify.problems) || []);
      if (failedChecks.length) throw new Error('回读校验未通过，已停止导出：' + failedChecks.slice(0, 3).join('；'));
      if (MC.plan.refresh(st).fingerprint !== plan.fingerprint) throw new Error('打包期间选择或目标环境已改变，请重新生成');
      results.forEach(r => saveBlob(r.blob, r.filename));

      const names = results.map(r => r.filename).join(' 和 ');
      const v = results[0] && results[0].verify;
      let line = '已生成 ' + names;
      if (plan.summary.pending) line += ' · 有 '+plan.summary.pending+' 项待确认';
      if (plan.warnings.length) line += ' · 有 '+plan.warnings.length+' 项警告';
      if (v && v.ok) {
        line += v.total
          ? ' · 文件与清单校验通过（' + v.checked + '/' + v.total + ' 个 jar）'
          : ' · 文件与清单校验通过（清单结构完整）';
      }
      const notes = [];
      if (skippedFiles.length) {
        notes.push('跳过 ' + skippedFiles.length + ' 个读不到的文件：' +
          skippedFiles.slice(0, 3).join('、') + (skippedFiles.length > 3 ? ' 等' : ''));
      }
      if (overrideFailed) notes.push('原包内容有 ' + overrideFailed + ' 个没复制进来');
      if (depFailed.length) {
        notes.push('前置下载失败 ' + depFailed.length + ' 个：' +
          depFailed.slice(0, 3).join('、') + (depFailed.length > 3 ? ' 等' : ''));
      }
      const problems = results.reduce((a, r) => a.concat((r.verify && r.verify.problems) || []), []);
      if (problems.length) notes.push('校验发现 ' + problems.length + ' 个问题');
      if (notes.length) line += '；' + notes.join('；');
      st.lastPack = {
        at: Date.now(),
        files: results.map(r => ({
          name: r.filename,
          ok: !!(r.verify && r.verify.ok),
          checked: (r.verify && r.verify.checked) || 0,
          total: (r.verify && r.verify.total) || 0
        })),
        skipped: skippedFiles.slice(0, 20).join('、'),
        overrideFailed: overrideFailed,
        depFailed: depFailed.slice(0, 10).join('、'),
        problems: problems,
        uncertain: plan.uncertain,
        warnings: plan.warnings,
        findings: plan.findings,
        coverage: plan.coverage,
        summary: plan.summary
      };
      toast(line);

    } catch (err) {
      console.error(err);
      st.lastPack = { at: Date.now(), files: [], problems: [err && err.message ? err.message : String(err)] };
      toast('打包失败：' + (err && err.message ? err.message : err));
    } finally {
      st.busy = false;
      st.progress = '';
      touch();
    }
  }

  MC.flowPack = { buildPack };
})(globalThis);
