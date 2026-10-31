/* ===== 流程：日志扫描、资源包顺序 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const S = () => MC.store.state;
  const touch = () => MC.store.touch();
  const { toast, saveBlob } = MC.uiBase;

  /* ---------- 工具：日志粗筛 ---------- */
  async function importLogs(files) {
    const st = S();
    const list = Array.from(files || []);
    if (!list.length) return;
    const names = [];
    let findings = [];
    let lines = 0;
    let errors = 0;
    for (const f of list) {
      let text = '';
      try { text = await f.text(); } catch (err) { toast('读不了 ' + f.name); continue; }
      const r = MC.logscan.scan(text, f.name);
      names.push(f.name);
      lines += r.lines;
      errors += r.errors;
      findings = findings.concat(r.findings);
      st.progress = '正在扫 ' + names.length + '/' + list.length;
      touch();
    }
    st.progress = '';
    findings.sort((a, b) => {
      const sev = { bad: 0, warn: 1 };
      return (sev[a.sev] === undefined ? 2 : sev[a.sev]) - (sev[b.sev] === undefined ? 2 : sev[b.sev]) || b.count - a.count;
    });
    st.logs = { name: names.join('、'), findings, lines, errors };
    touch();
    toast('日志扫完：' + (findings.length ? findings.length + ' 类问题' : '没匹配到已知问题'));
  }

  /* ---------- 工具：资源包顺序 ---------- */
  function movePack(uid, dir) {
    const st = S();
    const packs = MC.render.orderedPacks(st);
    const idx = packs.findIndex(p => p.uid === uid);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= packs.length) return;
    const arr = packs.map(p => p.uid);
    const tmp = arr[idx];
    arr[idx] = arr[to];
    arr[to] = tmp;
    st.rpOrder = arr;
    touch();
  }

  function exportPackOrder() {
    const st = S();
    const packs = MC.render.orderedPacks(st);
    if (!packs.length) return toast('这个包里没有资源包');
    const lines = ['# 资源包优先级（越靠上，游戏里优先级越高）', ''];
    packs.forEach((p, i) => lines.push((i + 1) + '. ' + p.fileName));
    lines.push('', '共 ' + packs.length + ' 个。把文件放进 .minecraft/resourcepacks/，再在游戏里按这个顺序调。');
    saveBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), '资源包顺序.txt');
    toast('已导出 资源包顺序.txt');
  }

  function exportPackOptions() {
    const st = S();
    const packs = MC.render.orderedPacks(st);
    if (!packs.length) return toast('这个包里没有资源包');
    const list = ['vanilla'].concat(packs.map(p => 'file/' + p.fileName));
    const line = 'resourcePacks:["' + list.join('","') + '"]';
    saveBlob(new Blob([line + '\n'], { type: 'text/plain;charset=utf-8' }), 'resourcepacks-options.txt');
    toast('已导出 options.txt 片段，贴到 .minecraft/options.txt 里');
  }

  /* ---------- 工具：自动读取 .minecraft 最新日志 ---------- */
  async function autoLog() {
    const st = S();
    if (st.logBusy) return;
    st.logBusy = true;
    touch();
    try {
      const res = await fetch('/api/logs?kind=latest');
      const d = await res.json();
      if (!d.ok) { toast(d.reason || '没读到日志'); return; }
      const r = MC.logscan.scan(String(d.text || ''), d.name);
      st.logs = { name: d.name, path: d.path, at: d.at, findings: r.findings, lines: r.lines, errors: r.errors };
      touch();
      toast('已读取 ' + d.name + '：' + (r.findings.length ? r.findings.length + ' 类问题' : '没匹配到已知问题'));
    } catch (err) {
      toast('读不到日志：' + (err.message || '本地服务没开？'));
    } finally {
      st.logBusy = false;
      touch();
    }
  }

  MC.flowTools = { importLogs, autoLog, movePack, exportPackOrder, exportPackOptions };
})(globalThis);
