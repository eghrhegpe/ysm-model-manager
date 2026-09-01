#!/usr/bin/env node
/**
 * codemod.ts — AST 感知的代码批量重构工具（基于 ts-morph）。
 *
 * 移植自 MikuMikuAR 联邦 scripts/codemod.ts（源码目录 frontend/src → frontend/src）
 * 设计意图：基于 ts-morph 的批量源码重构（rename / move / add-param），自动更新引用与 import。
 *
 * 用法:
 *   node scripts/codemod.ts <命令> [参数...]
 *
 * 命令:
 *   rename-function <旧名> <新名>
 *      重命名导出的函数/类/常量，自动更新所有引用
 *      完成后自动 grep 旧名，标记可能遗漏的字符串引用
 *
 *   move-function <函数名> <目标文件>
 *      将导出的函数定义移动到另一个文件，自动清理原 export 并追加。
 *      自动迁移函数体内引用的 import 到目标文件；自动清理源文件孤立 import。
 *
 *   add-param <函数名> <参数签名> [默认值]
 *      为函数定义添加参数，并为所有无默认值的调用方补 undefined。
 *      完成后显示受影响的调用方数量。
 *
 *   help
 *      显示此帮助
 *
 * 示例:
 *   node scripts/codemod.ts rename-function oldFoo newFoo
 *   node scripts/codemod.ts move-function parseName src/core/utils.ts
 *   node scripts/codemod.ts add-param buildTree 'opts: Options' '{}'
 *
 * 安全须知:
 *   - 所有改动都是 in-place 的，运行前确保工作区已 `git commit`
 *   - 改完后必须跑 `npm run check && npm run test` 验证
 *   - 对结果有疑虑时，用 `git diff` 逐块审查
 * 设计意图：代码重构工具（批量修改源码）
 * 依赖：node:module / node:url / node:fs / node:path / 本地模块
 * 退出码：0（成功）/ 1（失败）。
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './_lib/to-posix.ts';
import { ROOT } from './_lib/scan-files.ts';

const FRONTEND = path.join(ROOT, 'frontend');
const require_ = createRequire(path.join(FRONTEND, 'package.json'));
const TS_CONFIG = path.join(FRONTEND, 'tsconfig.json');
const FILESELF = fileURLToPath(import.meta.url);

// ts-morph 惰性加载：只有 rename/move/add-param 执行路径才 require。
// --help / -h / 未知 flag 拦截是纯 CLI 行为，不应依赖 frontend/node_modules
// （契约测试在无依赖环境跑，顶层 require 会让 help 也崩，见陷阱 #12）
let project: any = null;
let SyntaxKind: any = null;
let Project: any = null;
function ensureTsMorph() {
  if (project) return;
  if (!fs.existsSync(TS_CONFIG)) {
    console.error(`❌ 未找到 tsconfig: ${TS_CONFIG}`);
    console.error('请在项目根目录运行此脚本');
    process.exit(1);
  }
  try {
    ({ Project, SyntaxKind } = require_('ts-morph'));
    project = new Project({
      tsConfigFilePath: TS_CONFIG,
      skipAddingFilesFromTsConfig: false,
    });
  } catch (e: any) {
    if (e?.code === 'MODULE_NOT_FOUND') {
      console.error('❌ 未找到 ts-morph 依赖（frontend/node_modules 缺失）。');
      console.error('   请先在 frontend/ 下执行 npm install 后再运行重命名/移动/加参命令；');
      console.error('   help 与旗标守卫无需该依赖。');
    } else {
      console.error('❌ 初始化 ts-morph 失败:', e?.message ?? e);
    }
    process.exit(1);
  }
}

// ── helpers ────────────────────────────────────────────────────────────

/** 查找导出的函数/类/变量声明 */
function findExportDecl(name: string) {
  for (const sf of project.getSourceFiles()) {
    // 函数声明
    for (const fn of sf.getFunctions()) {
      if (fn.isExported() && fn.getName() === name) {
        return { sourceFile: sf, node: fn, kind: 'function' };
      }
    }
    // 类
    const cls = sf.getClass(name);
    if (cls && cls.isExported()) {
      return { sourceFile: sf, node: cls, kind: 'class' };
    }
    // 变量声明（const/let）
    for (const vd of sf.getVariableDeclarations()) {
      if (vd.getName() === name) {
        const parent = vd.getParent();
        if (parent && parent.getKind() === SyntaxKind.VariableDeclarationList) {
          const vStmt = parent.getParent();
          if (vStmt && vStmt.getKind() === SyntaxKind.VariableStatement) {
            if (vStmt.isExported()) {
              return { sourceFile: sf, node: vd, kind: 'variable' };
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * saveSync 原子写/回滚（批次4 P2）：写盘前备份全部将被覆盖的文件，保存抛错时
 * 自动还原——重构工具绝不留下「部分文件已改、部分没改」的半截状态。
 * 逻辑改错仍需靠 git diff 审查（提示用户先 commit），本守卫只防写盘中断/异常。
 */
function saveWithRollback() {
  const backups = new Map();
  for (const sf of project.getSourceFiles()) {
    const p = sf.getFilePath();
    if (!p || !fs.existsSync(p)) continue;
    const onDisk = fs.readFileSync(p, "utf8");
    if (sf.getText() !== onDisk) backups.set(p, onDisk);
  }
  try {
    project.saveSync();
  } catch (e) {
    for (const [p, content] of backups) {
      try { fs.writeFileSync(p, content); } catch { /* 回滚失败仅留日志位，不吞原始错误 */ }
    }
    throw e;
  }
}

/**
 * 判断 ref（函数名 Identifier）是否构成一次对该函数的真实调用，并返回调用表达式节点。
 * 直调 `foo()`：parent 即 CallExpression；方法调用 `obj.foo()` / `this.foo()`：
 * parent 是 PropertyAccessExpression（属性名 = 函数名），再上一层才是 CallExpression。
 * 仅凭「parent 是 CallExpression」会把 obj.foo() 调用方漏掉（漏补 undefined → 编译错，批次4 P2）。
 */
function callExprOf(ref: any, funcName: string) {
  const parent = ref?.getParent();
  if (!parent) return null;
  if (parent.getKind() === SyntaxKind.CallExpression) return parent;
  if (parent.getKind() === SyntaxKind.PropertyAccessExpression && parent.getName() === funcName) {
    const grand = parent.getParent();
    return grand && grand.getKind() === SyntaxKind.CallExpression ? grand : null;
  }
  return null;
}

/** 在 frontend/src 下 grep 字符串匹配（纯 Node.js，跨平台） */
function grepString(pattern: string) {
  // ysm 源码目录为 frontend/src（联邦为 frontend/src）
  const srcDir = path.join(FRONTEND, 'src');
  const results: string[] = [];
  const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  walkAndGrep(srcDir, results, re);
  return results;
}

function walkAndGrep(dir: string, results: string[], regex: RegExp) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'wailsjs' && !e.name.startsWith('__')) {
        walkAndGrep(full, results, regex);
      }
    } else if (e.isFile() && /\.(ts|js)$/.test(e.name)) {
      try {
        const content = fs.readFileSync(full, 'utf8');
        // 全局正则跨文件共享：test() 成功后 lastIndex 推进，不清零会让下一个
        // 文件/行从错误起点搜索而漏检（假安全信号）。每次 test 前显式重置。
        regex.lastIndex = 0;
        if (regex.test(content)) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            regex.lastIndex = 0;
            if (regex.test(lines[i]!)) {
              const rel = toPosix(path.relative(FRONTEND, full));
              results.push(`${rel}:${i + 1}: ${lines[i]!.trim().slice(0, 120)}`);
            }
          }
        }
      } catch { /* skip */ }
    }
  }
}

/** 收集 AST 节点下所有 Identifier 名称 */
function collectIdentifiers(node: any, out: Set<string>) {
  if (!node) return;
  if (node.getKind && node.getKind() === SyntaxKind.Identifier) {
    out.add(node.getText());
  }
  if (node.forEachChild) {
    node.forEachChild((c: any) => collectIdentifiers(c, out));
  }
}

/** 从源文件 import 声明中筛选出函数体内用到的那些 */
function resolveFunctionImports(funcNode: any, srcSf: any) {
  const used = new Set<string>();
  collectIdentifiers(funcNode, used);

  const result: any[] = []; // { declaration, default, named[], namespace }
  for (const imp of srcSf.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    const defaultName = imp.getDefaultImport()?.getText();
    const namedBindings = imp.getNamedImports();
    const namespaceName = imp.getNamespaceImport()?.getText();

    const matchedNamed = namedBindings.filter((ni: any) => used.has(ni.getName()));
    const matchedDefault = defaultName && used.has(defaultName);
    const matchedNamespace = namespaceName && used.has(namespaceName);

    if (!matchedDefault && matchedNamed.length === 0 && !matchedNamespace) continue;

    result.push({
      declaration: imp,
      moduleSpecifier: mod,
      default: matchedDefault ? defaultName : null,
      named: matchedNamed.map((ni: any) => ({ node: ni, name: ni.getName() })),
      namespace: matchedNamespace ? namespaceName : null,
    });
  }
  return result;
}

/** 向目标文件添加 import（自动去重） */
function ensureImport(destSf: any, moduleSpecifier: string, defaultName: string | null | undefined, namedNames: string[]) {
  const existing = destSf.getImportDeclarations().filter(
    (imp: any) => imp.getModuleSpecifierValue() === moduleSpecifier
  );

  if (existing.length === 0) {
    // 全新添加
    destSf.addImportDeclaration({
      moduleSpecifier,
      ...(defaultName ? { defaultImport: defaultName } : {}),
      ...(namedNames.length > 0 ? { namedImports: namedNames } : {}),
    });
    return;
  }

  // 合并到已有 import
  for (const ex of existing) {
    if (defaultName && !ex.getDefaultImport()) {
      ex.setDefaultImport(defaultName);
    }
    const existingNamed = new Set(ex.getNamedImports().map((n: any) => n.getName()));
    for (const n of namedNames) {
      if (!existingNamed.has(n)) {
        ex.addNamedImport(n);
      }
    }
  }
}

// ── rename-function ────────────────────────────────────────────────────

function cmdRenameFunction(oldName: string, newName: string) {
  const target = findExportDecl(oldName);
  if (!target) {
    console.error(`❌ 未找到导出符号 "${oldName}"`);
    process.exit(1);
  }

  console.log(`📍 定义位置: ${target.sourceFile.getFilePath()} （${target.kind}）`);
  target.node.rename(newName);
  saveWithRollback();

  console.log(`✅ 重命名完成: "${oldName}" → "${newName}"`);
  console.log('   ts-morph 已自动更新所有引用');

  // 搜索可能遗漏的字符串引用
  const hits = grepString(oldName);
  if (hits.length > 0) {
    // 过滤掉已经是新名的匹配
    const realHits = hits.filter(
      (h) => h.includes(oldName) && !h.includes(newName)
    );
    if (realHits.length > 0) {
      console.log(`⚠️  以下 ${realHits.length} 处可能包含未更新的字符串引用：`);
      for (const h of realHits.slice(0, 20)) {
        console.log(`   ${h}`);
      }
      if (realHits.length > 20) {
        console.log(`   ...（还有 ${realHits.length - 20} 处，完整搜索: grep -rn "${oldName}" frontend/src/）`);
      }
    } else {
      console.log('   grep 未检出旧名残留');
    }
  } else {
    console.log('   grep 未检出旧名残留');
  }
}

// ── move-function ──────────────────────────────────────────────────────

function cmdMoveFunction(funcName: string, destRelPath: string) {
  const target = findExportDecl(funcName);
  if (!target) {
    console.error(`❌ 未找到导出符号 "${funcName}"`);
    process.exit(1);
  }

  const absDest = path.resolve(FRONTEND, destRelPath);
  const destSf = project.getSourceFile(absDest);
  if (!destSf) {
    console.error(`❌ 目标文件不存在: ${absDest}`);
    process.exit(1);
  }

  const srcSf = target.sourceFile;
  const stmt = target.node;
  // P1-2：kind='variable'（const 箭头函数/常量）时 stmt 是 VariableDeclaration，
  // 只含 `name = () => {}` 无 const/export，直接搬会写出裸赋值（ESM ReferenceError）。
  // 取整条 VariableStatement（含 export const）并校验多声明符（a, b 同语句无法安全拆分）。
  let moveText;
  if (target.kind === 'variable') {
    const vStmt = stmt.getParent().getParent();
    if (vStmt.getDeclarations().length > 1) {
      console.error(`❌ "${funcName}" 与其它声明共用一条 export const（a, b 同语句），无法安全移动，请先拆分`);
      process.exit(1);
    }
    moveText = vStmt.getFullText();
  } else {
    moveText = stmt.getFullText();
  }
  const text = moveText;
  const srcPath = srcSf.getFilePath();

  // 1. 解析函数体用到的 import
  const usedImports = resolveFunctionImports(stmt, srcSf);
  console.log(`📦 检测到 ${usedImports.length} 组 import 被函数引用`);

  // 2. 从源文件移除函数
  const parentToRemove =
    target.kind === 'variable' ? stmt.getParent().getParent() : stmt;
  parentToRemove.remove();

  // 3. 清理源文件的孤立 import
  //    收集源文件剩余语句中仍用的标识符
  //    （ts-morph v28：getStatements() 已排除被移除节点，无需 wasRemoved 判断）
  const remainingNames = new Set<string>();
  for (const topStmt of srcSf.getStatements()) {
    collectIdentifiers(topStmt, remainingNames);
  }

  let removedCount = 0;
  for (const ui of usedImports) {
    const imp = ui.declaration;
    const defaultName = imp.getDefaultImport()?.getText();
    const namedBindings = imp.getNamedImports();

    // 检查是否有 default import 仍被使用
    const defaultStillUsed = defaultName && remainingNames.has(defaultName);
    // 检查 named imports 哪些仍被使用
    const stillUsedNamed = namedBindings.filter((ni: any) =>
      remainingNames.has(ni.getName())
    );

    if (namedBindings.length === 0 && !defaultStillUsed) {
      // namespace import 或裸 import：仅当命名空间名不再被源文件其余代码使用才移除
      // （P1-3：此前无条件删除 `import * as d3`，若剩余代码仍用 d3.select 会被静默删掉）
      const nsName = imp.getNamespaceImport()?.getText();
      const nsStillUsed = nsName != null && remainingNames.has(nsName);
      if (!nsStillUsed) {
        imp.remove();
        removedCount++;
      }
    } else if (stillUsedNamed.length === namedBindings.length && (defaultStillUsed || !defaultName)) {
      // 仍然全部在用，不动
    } else if (stillUsedNamed.length > 0 || defaultStillUsed) {
      // 部分仍用：移除不再用的 named
      for (const ni of namedBindings) {
        if (!remainingNames.has(ni.getName())) {
          ni.remove();
        }
      }
      // 如果 default 不再用但还存在：移除 default
      if (defaultName && !defaultStillUsed) {
        imp.setDefaultImport(undefined);
      }
    } else {
      // 全都不再使用
      imp.remove();
      removedCount++;
    }
  }

  if (removedCount > 0) {
    console.log(`   🧹 自动清理 ${removedCount} 组孤立 import`);
  }

  // 4. 向目标文件添加必要 import（去重）
  let addedCount = 0;
  for (const ui of usedImports) {
    // 跳过 namespace import（在目标文件中可能上下文不同）
    if (ui.namespace) {
      console.log(`   ⚠️  命名空间 import "${ui.moduleSpecifier}" 需手动迁移`);
      continue;
    }
    ensureImport(
      destSf,
      ui.moduleSpecifier,
      ui.default,
      ui.named.map((n: any) => n.name)
    );
    addedCount++;
  }

  // 5. 追加函数体到目标文件末尾
  destSf.addStatements(text.trim());
  if (!text.endsWith('\n')) destSf.addStatements('\n');

  saveWithRollback();

  console.log(`✅ "${funcName}" 已移至 ${absDest}`);
  console.log(`   源文件 ${srcPath}`);
  console.log(`   自动迁移 ${addedCount} 组 import 到目标文件`);
  console.log('⚠️  建议运行 npm run check 验证类型无误');
}

// ── add-param ──────────────────────────────────────────────────────────

function cmdAddParam(funcName: string, paramSignature: string, defaultValue: string | undefined) {
  const target = findExportDecl(funcName);
  if (!target) {
    console.error(`❌ 未找到导出符号 "${funcName}"`);
    process.exit(1);
  }
  if (target.kind !== 'function') {
    console.error(`❌ "${funcName}" 不是函数（是 ${target.kind}）`);
    process.exit(1);
  }

  const fn = target.node;
  const sf = target.sourceFile;

  // 解析参数名和类型
  const [paramName, ...typeParts] = paramSignature.split(':').map((s) => s.trim());
  const paramType = typeParts.join(':').trim() || undefined;

  // P2-4 幂等守卫：add-param 非幂等（重复运行会给定义叠加同名参数、给调用方叠 undefined），
  // 参数已存在时直接拒绝，避免二次破坏
  if (fn.getParameters().some((p: any) => p.getName() === paramName)) {
    console.error(`❌ "${funcName}" 已存在参数 "${paramName}"；add-param 非幂等，重复运行会叠加，请先 git checkout 还原再执行`);
    process.exit(1);
  }

  // 统计原始调用方
  let callerCount = 0;
  const callerFiles = new Set<string>();
  if (!defaultValue) {
    for (const ref of fn.findReferencesAsNodes()) {
      if (callExprOf(ref, funcName)) {
        callerCount++;
        callerFiles.add(ref.getSourceFile().getFilePath());
      }
    }
  }

  // 给定义加参数
  const params = fn.getParameters();
  fn.insertParameter(params.length, {
    name: paramName,
    type: paramType,
    initializer: defaultValue,
  });

  // 给调用方加参数（仅当无默认值时）
  if (!defaultValue) {
    for (const ref of fn.findReferencesAsNodes()) {
      const callExpr = callExprOf(ref, funcName);
      if (callExpr) {
        callExpr.addArgument('undefined');
      }
    }
  }

  saveWithRollback();

  console.log(`✅ 参数已添加: "${funcName}" 现在接受 "${paramSignature}"`);
  if (defaultValue) {
    console.log(`   有默认值 ${defaultValue}，调用方未修改`);
    console.log(`   📍 定义位置: ${sf.getFilePath()}`);
  } else {
    console.log(`   无默认值，已更新 ${callerCount} 个调用方（${callerFiles.size} 个文件）`);
    console.log(`   📍 定义位置: ${sf.getFilePath()}`);
    if (callerFiles.size > 0) {
      console.log('   涉事文件:');
      for (const f of callerFiles) {
        console.log(`     ${f.replace(FRONTEND + '/', '')}`);
      }
    }
  }
}

// ── main ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const cmd = args[0];

function printHelp() {
  const content = fs.readFileSync(FILESELF, 'utf-8');
  const start = content.indexOf('/**');
  const end = content.indexOf('*/');
  console.log(content.slice(start, end + 2).replace(/^ \* ?/gm, '').trim());
}

// 未知 flag 白名单拦截（致命陷阱 #12）：只拦截 `--` 开头的明确旗标（如 `--dry-run`），
// 绝不让其落入位置参数位被静默吞掉或当参数值（P1-1）；单横杠 token 可能是合法位置
// 参数值（如 add-param 默认值 `-1`），不得误判为 flag（code_review P3）
const UNKNOWN_FLAG = args.find((a) => a.startsWith('--') && a !== '--help');
if (UNKNOWN_FLAG) {
  console.error(`❌ 未知 flag: ${UNKNOWN_FLAG}（本工具不支持任何旗标，见 help）`);
  printHelp();
  process.exit(1);
}

// --help / -h 退 0（陷阱 #12 要求）；裸 help 同语义（任意位置出现均触发）
if (!cmd || cmd === 'help' || args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

switch (cmd) {
  case 'rename-function': {
    ensureTsMorph();
    const [, oldName, newName] = args;
    if (!oldName || !newName) {
      console.error('用法: node scripts/codemod.ts rename-function <旧名> <新名>');
      process.exit(1);
    }
    cmdRenameFunction(oldName, newName);
    break;
  }
  case 'move-function': {
    ensureTsMorph();
    const [, funcName, destPath] = args;
    if (!funcName || !destPath) {
      console.error('用法: node scripts/codemod.ts move-function <函数名> <目标文件>');
      process.exit(1);
    }
    cmdMoveFunction(funcName, destPath);
    break;
  }
  case 'add-param': {
    ensureTsMorph();
    const [, funcName, paramSignature, defaultValue] = args;
    if (!funcName || !paramSignature) {
      console.error('用法: node scripts/codemod.ts add-param <函数名> <参数签名> [默认值]');
      process.exit(1);
    }
    cmdAddParam(funcName, paramSignature, defaultValue);
    break;
  }
  default:
    console.error(`未知命令: ${cmd}`);
    console.error('可用命令: rename-function, move-function, add-param, help');
    printHelp();
    process.exit(1);
}
