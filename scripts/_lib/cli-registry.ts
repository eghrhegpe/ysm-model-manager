#!/usr/bin/env node
/**
 * cli-registry.ts — CLI 命令注册表解析共享层（scripts/_lib）。
 *
 * 设计意图：CLI 命令的「单一事实来源」是 `go/cli/` 源码注册（RegisterCommandC +
 * print*Usage）。gen-cli-doc（文档）与 gen-cli-completion（shell 补全）都需要同一份
 * 命令/子命令/选项元数据——把解析逻辑收拢到此共享层，两个生成器只消费数据，
 * 杜绝「文档一套、补全一套」的手写双轨漂移。
 *
 * 依赖：零依赖（node:fs / node:path + scan-files.readText）。
 *
 * 用法：
 *   import { parseCliCommands, CAT_NAMES, CAT_ORDER } from './_lib/cli-registry.ts';
 *
 * 返回的 commands 结构：
 *   { name, category, description, subcommands: [{name, desc}], flags: [{flag, type, help, def}] }
 * 退出码：无（纯数据层，不写盘不 exit）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readText } from './scan-files.ts';

const CLI_DIR = path.join(ROOT, 'go', 'cli');

/** 顶层命令注册：RegisterCommandC("name", CatX, "desc", runFn)。支持跨行。 */
const CMD_RE = /RegisterCommandC\(\s*"([a-z0-9-]+)"\s*,\s*(\w+)\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\w+)\s*\)/g;

/** 分类名常量（与 go/cli/registry.go 一致）。 */
export const CAT_NAMES = {
  CatModel: '模型管理',
  CatPerf: '性能诊断',
  CatCache: '缓存管理',
  CatResource: '资源仓库',
  CatConfig: '配置',
  CatOther: '其他',
};
/** 分类展示顺序（与 go/cli/cli.go printCLIHelp 一致）。 */
export const CAT_ORDER = ['CatModel', 'CatPerf', 'CatCache', 'CatResource', 'CatConfig', 'CatOther'];

/** Go 顶层函数块。 */
interface FuncBlock {
  name: string;
  body: string;
}

/** 按 `\nfunc ` 切函数块（Go 顶层声明不缩进，函数体内嵌闭包缩进，不会误切）。 */
function funcBlocks(text: string): FuncBlock[] {
  return text
    .split(/\n(?=func )/)
    .map((p) => {
      const m = p.match(/^func (\w+)\(/);
      return m ? { name: m[1], body: p } : null;
    })
    .filter((x): x is FuncBlock => x !== null);
}

/** 取名称精确匹配的函数体（如 runTags）。 */
function findFunc(blocks: FuncBlock[], name: string): FuncBlock | undefined {
  return blocks.find((b) => b.name === name);
}

/** 单个 flag 元数据。 */
interface CliFlag {
  flag: string;
  type: string;
  help: string;
  def: string;
}

/**
 * 提取 flag：fs.String/Bool/Int/Float64/Var 调用 → { flag, type, help, def }。
 * 括号配对截取调用文本，取首字符串为 flag 名、末字符串为 help、
 * 若有三个字符串则中间为字符串字面量默认值。
 */
function extractFlags(body: string): CliFlag[] {
  const flags: CliFlag[] = [];
  const re = /fs\.(String|Bool|Int|Float64|StringVar|BoolVar|IntVar|Float64Var)\(/g;
  let m;
  while ((m = re.exec(body))) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < body.length; i++) {
      if (body[i] === '(') depth++;
      else if (body[i] === ')') {
        if (depth === 0) break;
        depth--;
      }
    }
    const call = body.slice(m.index, i + 1);
    const nameM = call.match(/\(\s*"([^"]+)"/);
    if (!nameM) continue;
    const strs = [...call.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((a) => a[1]);
    const entry = {
      flag: nameM[1]!,
      type: m[1]!.toLowerCase().replace(/var$/, ''),
      help: strs.length >= 2 ? strs[strs.length - 1]! : '',
      def: '',
    };
    // 三字符串形态：name, 默认值, help（默认值为字符串字面量）
    if (strs.length >= 3) entry.def = strs[strs.length - 2]!;
    else if (!entry.help && strs.length >= 2) entry.def = strs[strs.length - 1]!;
    flags.push(entry);
  }
  return flags;
}

/** 提取函数体内子命令（父命令统一 `switch sub {` 分发，case "xxx" 即子命令；排除 *format/ext 等值 switch）。 */
function extractSubcommands(body: string): string[] {
  const out: string[] = [];
  const sw = body.indexOf('switch sub {');
  if (sw < 0) return out;
  const re = /case\s+"([a-z0-9-]+)":/g;
  let m;
  while ((m = re.exec(body.slice(sw)))) out.push(m[1]!);
  return out;
}

/** 收集全部 print*Usage 函数体中的 `  <子命令>  <描述>` 行，按 Usage 函数名归档（Go 源码 fmt.Println 包裹）。 */
function collectSubDescByFunc(): Record<string, Record<string, string>> {
  const byFunc: Record<string, Record<string, string>> = {};
  for (const f of fs.readdirSync(CLI_DIR)) {
    if (!f.endsWith('.go') || f.endsWith('_test.go')) continue;
    const text = readText(path.join(CLI_DIR, f));
    for (const fn of funcBlocks(text)) {
      if (!/^print\w+Usage$/.test(fn.name)) continue;
      const desc: Record<string, string> = {};
      const re = /fmt\.Println\("  ([a-z0-9-]+)\s{2,}([^"]*)"\)/g;
      let m;
      while ((m = re.exec(fn.body))) desc[m[1]!] = m[2]!.trim();
      byFunc[fn.name] = desc;
    }
  }
  return byFunc;
}

/** 从 run 函数体中找它实际调用的 print*Usage 函数名（父命令 → 其专属子命令描述表）。 */
function findUsageFunc(body: string): string | null {
  const m = body.match(/print(\w+)Usage\(\)/);
  return m ? `print${m[1]}Usage` : null;
}

/**
 * 解析 go/cli 注册表 → 顶层命令元数据数组（含子命令/选项），按命令名字母序。
 * 这是 gen-cli-doc / gen-cli-completion 共用的唯一解析入口。
 */
/** 顶层命令注册条目。 */
interface CliReg {
  name: string;
  category: string;
  description: string;
  runFn: string;
  file: string;
}

/** 解析后的命令元数据。 */
export interface CliCommand {
  name: string;
  category: string;
  description: string;
  subcommands: Array<{ name: string; desc: string }>;
  flags: CliFlag[];
}

export function parseCliCommands(): CliCommand[] {
  const regs: CliReg[] = [];
  const blocks: FuncBlock[] = [];
  for (const f of fs.readdirSync(CLI_DIR)) {
    if (!f.endsWith('.go') || f.endsWith('_test.go')) continue;
    const text = readText(path.join(CLI_DIR, f));
    blocks.push(...funcBlocks(text));
    const local = new RegExp(CMD_RE.source, 'g');
    let m;
    while ((m = local.exec(text))) {
      regs.push({ name: m[1]!, category: m[2]!, description: m[3]!, runFn: m[4]!, file: f });
    }
  }

  const subDescByFunc = collectSubDescByFunc();
  const commands = regs.map((r) => {
    const fn = findFunc(blocks, r.runFn);
    const body = fn ? fn.body : '';
    const subs = extractSubcommands(body);
    const usageFn = findUsageFunc(body);
    const subDesc = (usageFn && subDescByFunc[usageFn]) || {};
    return {
      name: r.name,
      category: r.category,
      description: r.description,
      subcommands: subs.map((s) => ({ name: s, desc: subDesc[s] || '' })),
      flags: extractFlags(body),
    };
  });
  commands.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return commands;
}