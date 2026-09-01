#!/usr/bin/env node
/**
 * gen-cli-doc.ts — CLI 命令参考文档生成器（go/cli 注册表 → docs/cli-commands.md）。
 *
 * 设计意图：CLI 命令曾长期「命令已注册但文档停在 18 个」（AGENTS.md 章节漂移）。
 * 本脚本把 `go/cli/` 的 `RegisterCommandC` 注册表 + `print*Usage` 子命令文本设为
 * 唯一事实来源，静态提取顶层命令/分类/子命令/选项，生成 docs/cli-commands.md 的
 * GEN 区——新增命令只改源码注册，文档自动跟上，消灭手动同步。
 * 解析逻辑收拢在 scripts/_lib/cli-registry.ts 共享层（与 gen-cli-completion 同源，防双轨）。
 *
 * 依赖：零依赖（node:fs / node:path + scripts/_lib/scan-files.ts + cli-registry.ts 共享层）。
 *
 * 用法：
 *   node scripts/gen-cli-doc.ts            # 写入 docs/cli-commands.md
 *   node scripts/gen-cli-doc.ts --check    # 只对比不写盘（doctor/pre-push 守护）
 *   node scripts/gen-cli-doc.ts --json     # JSON 摘要（命令清单，子代理消费）
 *
 * 退出码：--check 过期 → 1；否则 0（WARN 不阻断）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readText, writeText } from './_lib/scan-files.ts';
import { parseCliCommands, CAT_NAMES, CAT_ORDER, type CliCommand } from './_lib/cli-registry.ts';

const OUT = path.join(ROOT, 'docs', 'cli-commands.md');

const CHECK = process.argv.includes('--check');
const JSON_OUT = process.argv.includes('--json');

/* ---------------- 渲染 ---------------- */

function flagTypeLabel(type: string) {
  return ({ string: 'string', bool: 'bool', int: 'int', float64: 'float' } as Record<string, string>)[type] || type;
}

function renderFlags(flags: Array<{ flag: string; type: string; help: string; def?: string }>) {
  if (flags.length === 0) return '';
  const rows = flags
    .map((fl) => {
      const def = fl.def ? `（默认: ${fl.def}）` : '';
      const help = fl.help ? ` ${def}— ${fl.help}` : def;
      return `| \`--${fl.flag}\` | ${flagTypeLabel(fl.type)}${help || ''} |`;
    })
    .join('\n');
  return `\n| 选项 | 类型 | 说明 |\n|------|------|------|\n${rows}\n`;
}

function renderSubcommands(cmdName: string, subs: Array<{ name: string; desc: string }>) {
  if (subs.length === 0) return '';
  const rows = subs
    .map((s) => `| \`${s.name}\` | ${s.desc || '—'} |`)
    .join('\n');
  return `\n**子命令**（用法：\`app --cli --files-root <路径> ${cmdName} <子命令> [选项...]\`）：\n\n| 子命令 | 说明 |\n|--------|------|\n${rows}\n`;
}

function renderCommands(commands: CliCommand[]) {
  const byCat: Record<string, any[]> = {};
  for (const c of commands) (byCat[c.category] ||= []).push(c);

  const parts: string[] = [];
  for (const cat of CAT_ORDER) {
    const list = byCat[cat];
    if (!list || list.length === 0) continue;
    parts.push(`## ${(CAT_NAMES as Record<string, string>)[cat] || cat}\n`);
    for (const c of list) {
      parts.push(`### \`${c.name}\``);
      parts.push(c.description);
      parts.push('');
      const usage = `app --cli --files-root <路径> ${c.name} [选项...]`;
      parts.push(`\`\`\`bash\n${usage}\n\`\`\``);
      parts.push(renderSubcommands(c.name, c.subcommands));
      parts.push(renderFlags(c.flags));
      parts.push('');
    }
  }
  return parts.join('\n');
}

/* ---------------- 主流程 ---------------- */

const commands = parseCliCommands();
const body = renderCommands(commands);

const md = `# CLI 命令参考

> **自动生成**：由 \`node scripts/gen-cli-doc.ts\` 从 \`go/cli/\` 命令注册表（\`RegisterCommandC\` + \`print*Usage\`）
> 静态提取生成，**单一事实来源 = 源码注册**。新增命令/子命令/选项只改 \`go/cli/\` 源码，
> 重跑本脚本即同步；\`--check\` 已接入 \`doctor.ts\` 防漂移。
>
> 顶层命令共 **${commands.length}** 个。入口姿势与常用场景见根 \`AGENTS.md\`「CLI 模式使用说明」。

<!-- GEN: cli-commands -->
${body}
<!-- /GEN: cli-commands -->
`;

let rc = 0;
if (CHECK) {
  const onDisk = fs.existsSync(OUT) ? readText(OUT) : '';
  if (onDisk !== md) {
    rc = 1;
    if (!JSON_OUT) console.error(`[gen-cli-doc] docs/cli-commands.md 过期，运行 \`node scripts/gen-cli-doc.ts\` 刷新。`);
  } else if (!JSON_OUT) {
    console.log('[gen-cli-doc] docs/cli-commands.md 最新。');
  }
} else {
  writeText(OUT, md);
  if (!JSON_OUT) console.log(`[gen-cli-doc] 已写入 ${path.relative(ROOT, OUT)}（${commands.length} 个顶层命令）`);
}

if (JSON_OUT) {
  console.log(
    JSON.stringify({
      ok: rc === 0,
      check: CHECK,
      generated: !CHECK,
      count: commands.length,
      commands: commands.map((c) => ({
        name: c.name,
        category: (CAT_NAMES as Record<string, string>)[c.category] || c.category,
        description: c.description,
        subcommands: c.subcommands.map((s) => s.name),
        flags: c.flags.map((f) => f.flag),
      })),
    }),
  );
}

process.exitCode = rc;