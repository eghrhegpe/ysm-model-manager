#!/usr/bin/env node
/**
 * gen-cli-completion.ts — CLI shell 补全脚本生成器（bash / pwsh / zsh）。
 *
 * 设计意图：CLI 的可发现性短板是「命令/子命令/选项靠记忆 + 看文档」。本脚本从
 * scripts/_lib/cli-registry.ts（与 gen-cli-doc 同源的注册表解析）生成三个目录
 * 补全脚本（completions/ysm.bash / _ysm.ps1 / _ysm），用户 source 后即可 Tab 补全
 * 顶层命令、子命令与常见选项——清单全部来自源码注册，新增命令自动跟上。
 *
 * 依赖：零依赖（node:fs / node:path + scripts/_lib/scan-files.ts + cli-registry.ts 共享层）。
 *
 * 用法：
 *   node scripts/gen-cli-completion.ts            # 写入 completions/ 三个脚本
 *   node scripts/gen-cli-completion.ts --check    # 只对比不写盘（doctor/pre-push 守护）
 *   node scripts/gen-cli-completion.ts --json     # JSON 摘要（候选清单，测试/子代理消费）
 *
 * 退出码：--check 过期 → 1；否则 0。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, writeText } from './_lib/scan-files.ts';
import { parseCliCommands } from './_lib/cli-registry.ts';

const OUT_DIR = path.join(ROOT, 'completions');
const CHECK = process.argv.includes('--check');
const JSON_OUT = process.argv.includes('--json');

/* ---------------- 候选数据 ---------------- */

function buildCandidates(commands) {
  // 顶层命令名（按字母序，脚本内确定性稳定）
  const topNames = commands.map((c) => c.name);
  // 父命令 → 子命令列表（有子命令的命令）
  const parentSubs: Record<string, string[]> = {};
  for (const c of commands) {
    if (c.subcommands.length > 0) parentSubs[c.name] = c.subcommands.map((s) => s.name);
  }
  // 命令 → 选项列表（含 --help 兜底）
  const cmdFlags: Record<string, string[]> = {};
  for (const c of commands) {
    cmdFlags[c.name] = ['--help', ...c.flags.map((f) => `--${f.flag}`)];
  }
  return { topNames, parentSubs, cmdFlags, count: commands.length };
}

/* ---------------- 渲染：bash ---------------- */

function renderBash({ topNames, parentSubs, cmdFlags, count }: {
  topNames: string[];
  parentSubs: Record<string, string[]>;
  cmdFlags: Record<string, string[]>;
  count: number;
}) {
  const caseBranch = (cmd, subs) =>
    `    ${cmd}) COMPREPLY=( $(compgen -W "${subs.join(' ')}" -- "$cur") ); return ;;`;

  const subCases = Object.entries(parentSubs)
    .map(([cmd, subs]) => caseBranch(cmd, subs))
    .join('\n');

  // 选项候选：无子命令的命令直接按命令名取 flags；有子命令的仅第一参数补全子命令
  const flagCases = Object.entries(cmdFlags)
    .map(
      ([cmd, flags]) =>
        `    ${cmd}) COMPREPLY=( $(compgen -W "${flags.join(' ')}" -- "$cur") ); return ;;`,
    )
    .join('\n');

  return `# ysm CLI — bash 补全（自动生成，勿手改；来源：go/cli 注册表）
# 生成：node scripts/gen-cli-completion.ts（顶层命令 ${count} 个）
# 启用：echo "source $(pwd)/completions/ysm.bash" >> ~/.bashrc
_ysm_complete() {
  local cur prev words cword
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  words="\${COMP_WORDS[@]}"

  # 第一参数：顶层命令
  if [ "\$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( \$(compgen -W "${topNames.join(' ')}" -- "\$cur") )
    return
  fi

  cmd="\${COMP_WORDS[1]}"
  # 父命令第二参数：子命令
  case "\$cmd" in
${subCases}
  esac

  # 选项补全：--xxx 或首字符为 -
  case "\$cur" in
    -*)
      case "\$cmd" in
${flagCases}
      esac
      ;;
    *)
      # 常见取值提示
      case "\$prev" in
        --format) COMPREPLY=( \$(compgen -W "table json text" -- "\$cur") ); return ;;
        --mode)   COMPREPLY=( \$(compgen -W "symlink hardlink copy" -- "\$cur") ); return ;;
        --link-mode) COMPREPLY=( \$(compgen -W "symlink hardlink copy" -- "\$cur") ); return ;;
      esac
      COMPREPLY=( \$(compgen -f -- "\$cur") )
      ;;
  esac
}
complete -F _ysm_complete ysm app ysm-cli
`;
}

/* ---------------- 渲染：pwsh ---------------- */

function renderPwsh({ topNames, parentSubs, cmdFlags, count }: {
  topNames: string[];
  parentSubs: Record<string, string[]>;
  cmdFlags: Record<string, string[]>;
  count: number;
}) {
  // hashtable 逐行生成（避免嵌套引号拼接出错），如：  'avatar' = @('batch', 'cached', 'cache')
  const subsLines = Object.entries(parentSubs)
    .map(([k, v]) => `  '${k}' = @(${v.map((s) => `'${s}'`).join(', ')})`)
    .join('\n');
  const flagsLines = Object.entries(cmdFlags)
    .map(([k, v]) => `  '${k}' = @(${v.map((s) => `'${s}'`).join(', ')})`)
    .join('\n');
  return `# ysm CLI — PowerShell 补全（自动生成，勿手改；来源：go/cli 注册表）
# 生成：node scripts/gen-cli-completion.ts（顶层命令 ${count} 个）
# 启用：Add-Content $PROFILE ". $(Resolve-Path ./completions/_ysm.ps1)"
$ysmTopCommands = @(${topNames.map((n) => `'${n}'`).join(', ')})
$ysmSubs = @{
${subsLines}
}
$ysmFlags = @{
${flagsLines}
}
Register-ArgumentCompleter -Native -CommandName ysm,app,ysm-cli -ScriptBlock {
  param(\$wordToComplete, \$commandAst, \$cursorPosition)
  \$els = \$commandAst.CommandElements | ForEach-Object { \$_.ToString() } | Select-Object -Skip 1
  \$n = \$els.Count
  if (\$n -le 1) { return \$ysmTopCommands | Where-Object { \$_ -like "\$wordToComplete*" } }
  \$cmd = \$els[0]
  if (\$n -eq 2 -and \$ysmSubs.ContainsKey(\$cmd)) { return \$ysmSubs[\$cmd] | Where-Object { \$_ -like "\$wordToComplete*" } }
  if (\$ysmFlags.ContainsKey(\$cmd)) { return \$ysmFlags[\$cmd] | Where-Object { \$_ -like "\$wordToComplete*" } }
  return @()
}
`;
}

/* ---------------- 渲染：zsh ---------------- */

function renderZsh({ topNames, parentSubs, cmdFlags, count }: {
  topNames: string[];
  parentSubs: Record<string, string[]>;
  cmdFlags: Record<string, string[]>;
  count: number;
}) {
  const subCases = Object.entries(parentSubs)
    .map(([cmd, subs]) => `    ${cmd}) _values '${cmd} 子命令' ${subs.map((s) => s).join(' ')} ;;`)
    .join('\n');
  return `#compdef ysm app ysm-cli
# ysm CLI — zsh 补全（自动生成，勿手改；来源：go/cli 注册表）
# 生成：node scripts/gen-cli-completion.ts（顶层命令 ${count} 个）
# 启用：在 fpath 中包含本文件（如 cp completions/_ysm ~/.zfunc/ && echo 'fpath=(~/.zfunc \$fpath)' >> ~/.zshrc）
_ysm() {
  local -a commands
  commands=(${topNames.map((n) => `'${n}'`).join(' ')})
  if (( CURRENT == 2 )); then
    _describe 'ysm 命令' commands
    return
  fi
  local cmd=\${words[2]}
  case \$cmd in
${subCases}
  esac
  _files
}
_ysm "\$@"
`;
}

/* ---------------- 主流程 ---------------- */

const commands = parseCliCommands();
const cand = buildCandidates(commands);

const outputs = {
  'ysm.bash': renderBash(cand),
  '_ysm.ps1': renderPwsh(cand),
  '_ysm': renderZsh(cand),
};

let rc = 0;
if (CHECK) {
  for (const [file, content] of Object.entries(outputs)) {
    const p = path.join(OUT_DIR, file);
    const onDisk = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '';
    if (onDisk !== content) {
      rc = 1;
      if (!JSON_OUT) console.error(`[gen-cli-completion] completions/${file} 过期，运行 \`node scripts/gen-cli-completion.ts\` 刷新。`);
    }
  }
  if (rc === 0 && !JSON_OUT) console.log('[gen-cli-completion] completions/ 三脚本最新。');
} else {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, content] of Object.entries(outputs)) {
    writeText(path.join(OUT_DIR, file), content);
  }
  if (!JSON_OUT) console.log(`[gen-cli-completion] 已写入 completions/（bash+pwsh+zsh，${cand.count} 个顶层命令）`);
}

if (JSON_OUT) {
  console.log(
    JSON.stringify({
      ok: rc === 0,
      check: CHECK,
      generated: !CHECK,
      count: cand.count,
      topCommands: cand.topNames,
      subcommands: cand.parentSubs,
      files: Object.keys(outputs),
    }),
  );
}

process.exitCode = rc;