/* ===== 打包回读校验：生成后重新解一遍，确认清单和包内文件都对得上 =====
   只读不写：不修改产物，只返回问题列表，让用户知道这份包能不能直接发给别人。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  const JAR_RE = /^(?:overrides\/)?mods\/[^/]+\.jar$/i;

  function hex(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
    return s;
  }

  async function sha1Of(bytes) {
    if (!globalThis.crypto || !globalThis.crypto.subtle) return '';
    try {
      return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', bytes)));
    } catch (err) {
      return '';
    }
  }

  async function readJson(zip, path, problems) {
    const text = await MC.zip.readEntry(zip, path);
    if (text == null) {
      problems.push('缺少 ' + path);
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      problems.push(path + ' 不是合法 JSON');
      return null;
    }
  }

  function checkManifestBase(mf, problems) {
    if (mf.manifestType !== 'minecraftModpack') problems.push('manifest.json 的 manifestType 不对');
    if (mf.manifestVersion !== 1) problems.push('manifest.json 的 manifestVersion 不是 1');
    if (mf.overrides !== 'overrides') problems.push('manifest.json 的 overrides 字段不是 overrides');
    if (!mf.minecraft || !mf.minecraft.version) problems.push('manifest.json 缺少 minecraft.version');
    if (!mf.minecraft || !Array.isArray(mf.minecraft.modLoaders) || !mf.minecraft.modLoaders.length) {
      problems.push('manifest.json 缺少 modLoaders');
    }
  }

  /**
   * @param blob   生成出来的文件
   * @param meta   { format, jars, online, hashes:[sha1] }
   * @param onProgress (i, total, path) => void
   */
  async function verify(blob, meta, onProgress) {
    meta = meta || {};
    const problems = [];
    if (!blob) return { ok: false, problems: ['没有生成文件'], checked: 0, total: 0 };

    let zip;
    try {
      zip = MC.zip.parseCentral(await blob.arrayBuffer());
    } catch (err) {
      return {
        ok: false,
        problems: ['压缩包读不出来：' + (err && err.message ? err.message : err)],
        checked: 0,
        total: 0
      };
    }

    const paths = Array.from(zip.map.keys());
    const jars = paths.filter(p => JAR_RE.test(p));
    const format = meta.format || 'zip';

    if (format === 'mrpack') {
      const idx = await readJson(zip, 'modrinth.index.json', problems);
      if (idx) {
        if (idx.formatVersion !== 1) problems.push('modrinth.index.json 的 formatVersion 不是 1');
        if (idx.game !== 'minecraft') problems.push('modrinth.index.json 的 game 字段不是 minecraft');
        if (!idx.dependencies || !idx.dependencies.minecraft) {
          problems.push('modrinth.index.json 缺少 dependencies.minecraft');
        }
        const files = idx.files;
        if (!Array.isArray(files)) {
          problems.push('modrinth.index.json 的 files 不是数组');
        } else {
          if (meta.online && files.length !== meta.online) {
            problems.push('在线项数量不对：清单 ' + files.length + ' 条，预期 ' + meta.online + ' 条');
          }
          files.forEach((f, i) => {
            const name = (f && f.path) || ('第 ' + (i + 1) + ' 条');
            if (!f || !f.path) problems.push(name + ' 缺少 path');
            if (!f || !Array.isArray(f.downloads) || !f.downloads[0]) problems.push(name + ' 没有下载地址');
            if (!f || !f.hashes || !f.hashes.sha1 || !f.hashes.sha512) problems.push(name + ' 缺少 sha1/sha512');
          });
        }
      }
      if (!paths.includes('overrides/ModPilot-说明.txt')) problems.push('缺少 overrides/ModPilot-说明.txt');
    } else if (format === 'curseforge' || format === 'list') {
      const mf = await readJson(zip, 'manifest.json', problems);
      if (mf) {
        checkManifestBase(mf, problems);
        if (!Array.isArray(mf.files)) {
          problems.push('manifest.json 的 files 不是数组');
        } else {
          if (meta.online && mf.files.length !== meta.online) {
            problems.push('在线项数量不对：manifest ' + mf.files.length + ' 条，预期 ' + meta.online + ' 条');
          }
          mf.files.forEach((f, i) => {
            if (!f || !Number(f.projectID) || !Number(f.fileID)) {
              problems.push('第 ' + (i + 1) + ' 个在线项缺少 projectID/fileID');
            }
          });
        }
      }
      if (!paths.includes('modlist.html')) problems.push('缺少 modlist.html');
      if (format === 'list' && jars.length) {
        problems.push('下载清单里不应该有 jar，但发现了 ' + jars.length + ' 个');
      }
      if (format === 'curseforge' && !paths.includes('ModPilot-说明.txt')) problems.push('缺少 ModPilot-说明.txt');
    } else {
      if (!paths.includes('安装说明.txt')) problems.push('缺少 安装说明.txt');
    }

    if (format !== 'list' && meta.jars != null && jars.length !== meta.jars) {
      problems.push('包内 jar 数量不对：实际 ' + jars.length + ' 个，预期 ' + meta.jars + ' 个');
    }

    const known = new Set((meta.hashes || []).map(h => String(h || '').toLowerCase()).filter(Boolean));
    let checked = 0;
    for (let i = 0; i < jars.length; i++) {
      const path = jars[i];
      if (onProgress) onProgress(i + 1, jars.length, path.split('/').pop());
      if (i % 4 === 0) await new Promise(r => setTimeout(r, 0));
      let bytes;
      try {
        bytes = await MC.zip.readEntryBytes(zip, path);
      } catch (err) {
        problems.push(path + ' 解压失败');
        continue;
      }
      if (!bytes) {
        problems.push(path + ' 读不出来');
        continue;
      }
      checked++;
      const ent = zip.map.get(path);
      if (ent && ent.size != null && bytes.length !== ent.size) {
        problems.push(path + ' 解压后大小和目录记录不一致');
      }
      if (known.size) {
        const h = await sha1Of(bytes);
        if (h && !known.has(h)) problems.push(path + ' 的 sha1 和源文件对不上');
      }
    }

    return { ok: problems.length === 0, problems, checked, total: jars.length };
  }

  MC.pack = MC.pack || {};
  MC.pack.verify = verify;
})(globalThis);
