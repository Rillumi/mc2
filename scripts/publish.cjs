// 发布当前工作到 main；两个远端分别推送，失败后可直接重试。
'use strict';
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const root = path.resolve(__dirname, '..');
process.chdir(root);

function run(command, args, {capture=false, allowFailure=false}={}) {
  const result = spawnSync(command,args,{cwd:root,encoding:'utf8',stdio:capture?'pipe':'inherit',windowsHide:true,timeout:command==='git'?60000:undefined});
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(command + ' ' + args[0] + ' 失败（退出码 ' + result.status + '）');
  return capture ? {status:result.status,text:(result.stdout||'').trim()} : result.status;
}
const git = (args,opts) => run('git',args,opts);
const readGit = args => git(args,{capture:true}).text;

async function main() {
  let message = '', remotes = ['origin','github'], interactive = false;
  const args = process.argv.slice(2);
  for (let i=0;i<args.length;i++) {
    if (args[i]==='--message') message=args[++i] || '';
    else if (args[i]==='--remotes') remotes=(args[++i]||'').split(',');
    else if (args[i]==='--interactive') interactive=true;
    else throw new Error('未知参数：'+args[i]);
  }
  remotes=[...new Set(remotes)];
  if (!remotes.length || remotes.some(r=>!['origin','github'].includes(r))) throw new Error('远端只能是 origin、github');
  const branch=readGit(['branch','--show-current']);
  if (!branch) throw new Error('当前不在分支上，请先切换到工作分支。');
  if (git(['merge-base','--is-ancestor','main','HEAD'],{allowFailure:true})!==0) {
    throw new Error('当前分支无法快进合入 main，请先处理分支差异。');
  }
  // 先确认远端没有当前工作遗漏的提交；绝不覆盖远端历史。
  const eligible=[], failed=[];
  for (const remote of remotes) {
    readGit(['remote','get-url',remote]);
    let fetched;
    try {fetched=git(['fetch','--no-tags',remote,'main'],{allowFailure:true});}
    catch (e) {console.error(remote+' 连接失败：'+e.message);fetched=1;}
    if (fetched!==0) {failed.push(remote);continue;}
    const remoteHead=readGit(['rev-parse','FETCH_HEAD']);
    if (git(['merge-base','--is-ancestor',remoteHead,'HEAD'],{allowFailure:true})!==0) {
      console.error(remote+'/main 含有当前分支没有的提交，跳过该远端，请先同步后再发布。');
      failed.push(remote);continue;
    }
    eligible.push(remote);
  }

  const tests=fs.readdirSync(path.join(root,'tests')).filter(n=>n.endsWith('.test.js')).map(n=>'tests/'+n);
  console.log('运行 '+tests.length+' 个测试文件…');
  run(process.execPath,['--test',...tests]);
  git(['diff','--check']);
  git(['add','--all']);
  git(['diff','--cached','--check']);
  const staged=git(['diff','--cached','--quiet'],{allowFailure:true});
  if (staged!==0 && staged!==1) throw new Error('检查暂存区失败。');
  if (staged===1) {
    if (!message && interactive && process.stdin.isTTY) {
      const rl=readline.createInterface({input:process.stdin,output:process.stdout});
      try {message=(await rl.question('这次改了什么（回车使用日期）：')).trim();} finally {rl.close();}
    }
    if (!message) message='更新 ModPilot '+new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
    git(['commit','-m',message]);
  } else console.log('没有新的文件改动，继续同步已有提交。');

  if (branch!=='main') {
    git(['switch','main']);
    git(['merge','--ff-only',branch]);
  }
  const head=readGit(['rev-parse','HEAD']);
  for (const remote of eligible) {
    console.log('正在推送 '+remote+'/main…');
    try {
      const code=git(['push',remote,'HEAD:refs/heads/main'],{allowFailure:true});
      if (code!==0) {failed.push(remote);continue;}
      const actual=git(['ls-remote','--exit-code','--heads',remote,'refs/heads/main'],{capture:true,allowFailure:true});
      if (actual.status!==0 || actual.text.split(/\s+/)[0]!==head) {failed.push(remote);continue;}
      console.log(remote+'/main 已核对：'+head);
    } catch (e) {failed.push(remote);console.error(e.message);}
  }
  if (failed.length) throw new Error('以下远端未同步成功：'+failed.join('、')+'。修复连接后重新运行即可，无需制造新改动。');
  console.log('发布完成：'+head);
}
main().catch(e=>{console.error('\n发布未完成：'+e.message);process.exitCode=1;});
