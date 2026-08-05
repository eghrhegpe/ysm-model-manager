#!/usr/bin/env node
/**
 * @file AST 感知的代码批量重构工具（基于 ts-morph）
 * 移植自 MikuMikuAR 联邦 scripts/codemod.mjs（源码目录 frontend/src → frontend/src）
 *
 * 用法:
 *   node scripts/codemod.mjs <命令> [参数...]
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
 *   node scripts/codemod.mjs rename-function oldFoo newFoo
 *   node scripts/codemod.mjs move-function parseName src/core/utils.ts
 *   node scripts/codemod.mjs add-param buildTree 'opts: Options' '{}'
 *
 * 安全须知:
 *   - 所有改动都是 in-place 的，运行前确保工作区已 `git commit`
 *   - 改完后必须跑 `npm run check && npm run test` 验证
 *   - 对结果有疑虑时，用 `git diff` 逐块审查
 * 设计意图：代码重构工具（批量修改源码）
 * 依赖：node:module / node:url / node:fs / node:path / 本地模块
 * 退出码：1 / 0（含失败码）
 * codemod.mjs — 代码重构工具（批量修改源码）
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './_lib/to-posix.mjs';
import { ROOT } from './_lib/scan-files.mjs';

const FRONTEND = path.join(ROOT, 'frontend');
const require_ = createRequire(path.join(FRONTEND, 'package.json'));
const { Project, SyntaxKind } = require_('ts-morph');
const TS_CONFIG = path.join(FRONTEND, 'tsconfig.json');
const FILESELF = fileURLToPath(import.meta.url);

if (!fs.existsSync(TS_CONFIG)) {
  console.error(`❌ 未找到 tsconfig: ${TS_CONFIG}`);
  console.error('请在项目根目录运行此脚本');
  process.exit(1);
}

const project = new Project({
  tsConfigFilePath: TS_CONFIG,
  skipAddingFilesFromTsConfig: false,
});

// ── helpers ────────────────────────────────────────────────────────────

/** 查找导出的函数/类/变量声明 */
function findExportDecl(name) {
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

/** 在 frontend/src 下 grep 字符串匹配（纯 Node.js，跨平台） */
function grepString(pattern) {
  // ysm 源码目录为 frontend/src（联邦为 frontend/src）
  const srcDir = path.join(FRONTEND, 'js');
  const results = [];
  const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  walkAndGrep(srcDir, results, re);
  return results;
}

function walkAndGrep(dir, results, regex) {
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
        if (regex.test(content)) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const rel = toPosix(path.relative(FRONTEND, full));
              results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
            }
          }
        }
      } catch { /* skip */ }
    }
  }
}

/** 收集 AST 节点下所有 Identifier 名称 */
function collectIdentifiers(node, out) {
  if (!node) return;
  if (node.getKind && node.getKind() === SyntaxKind.Identifier) {
    out.add(node.getText());
  }
  if (node.forEachChild) {
    node.forEachChild((c) => collectIdentifiers(c, out));
  }
}

/** 从源文件 import 声明中筛选出函数体内用到的那些 */
function resolveFunctionImports(funcNode, srcSf) {
  const used = new Set();
  collectIdentifiers(funcNode, used);

  const result = []; // { declaration, default, named[], namespace }
  for (const imp of srcSf.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    const defaultName = imp.getDefaultImport()?.getText();
    const namedBindings = imp.getNamedImports();
    const namespaceName = imp.getNamespaceImport()?.getText();

    const matchedNamed = namedBindings.filter((ni) => used.has(ni.getName()));
    const matchedDefault = defaultName && used.has(defaultName);
    const matchedNamespace = namespaceName && used.has(namespaceName);

    if (!matchedDefault && matchedNamed.length === 0 && !matchedNamespace) continue;

    result.push({
      declaration: imp,
      moduleSpecifier: mod,
      default: matchedDefault ? defaultName : null,
      named: matchedNamed.map((ni) => ({ node: ni, name: ni.getName() })),
      namespace: matchedNamespace ? namespaceName : null,
    });
  }
  return result;
}

/** 向目标文件添加 import（自动去重） */
function ensureImport(destSf, moduleSpecifier, defaultName, namedNames) {
  const existing = destSf.getImportDeclarations().filter(
    (imp) => imp.getModuleSpecifierValue() === moduleSpecifier
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
    const existingNamed = new Set(ex.getNamedImports().map((n) => n.getName()));
    for (const n of namedNames) {
      if (!existingNamed.has(n)) {
        ex.addNamedImport(n);
      }
    }
  }
}

// ── rename-function ────────────────────────────────────────────────────

function cmdRenameFunction(oldName, newName) {
  const target = findExportDecl(oldName);
  if (!target) {
    console.error(`❌ 未找到导出符号 "${oldName}"`);
    process.exit(1);
  }

  console.log(`📍 定义位置: ${target.sourceFile.getFilePath()} （${target.kind}）`);
  target.node.rename(newName);
  project.saveSync();

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

function cmdMoveFunction(funcName, destRelPath) {
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
  const text = stmt.getFullText();
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
  const remainingNames = new Set();
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
    const stillUsedNamed = namedBindings.filter((ni) =>
      remainingNames.has(ni.getName())
    );

    if (namedBindings.length === 0 && !defaultStillUsed) {
      // namespace import 或裸 import：全部移除
      imp.remove();
      removedCount++;
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
      ui.named.map((n) => n.name)
    );
    addedCount++;
  }

  // 5. 追加函数体到目标文件末尾
  destSf.addStatements(text.trim());
  if (!text.endsWith('\n')) destSf.addStatements('\n');

  project.saveSync();

  console.log(`✅ "${funcName}" 已移至 ${absDest}`);
  console.log(`   源文件 ${srcPath}`);
  console.log(`   自动迁移 ${addedCount} 组 import 到目标文件`);
  console.log('⚠️  建议运行 npm run check 验证类型无误');
}

// ── add-param ──────────────────────────────────────────────────────────

function cmdAddParam(funcName, paramSignature, defaultValue) {
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

  // 统计原始调用方
  let callerCount = 0;
  const callerFiles = new Set();
  if (!defaultValue) {
    for (const ref of fn.findReferencesAsNodes()) {
      const callExpr = ref.getParent();
      if (callExpr && callExpr.getKind() === SyntaxKind.CallExpression) {
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
      const callExpr = ref.getParent();
      if (callExpr && callExpr.getKind() === SyntaxKind.CallExpression) {
        callExpr.addArgument('undefined');
      }
    }
  }

  project.saveSync();

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

if (!cmd || cmd === 'help') {
  printHelp();
  process.exit(0);
}

switch (cmd) {
  case 'rename-function': {
    const [, oldName, newName] = args;
    if (!oldName || !newName) {
      console.error('用法: node scripts/codemod.mjs rename-function <旧名> <新名>');
      process.exit(1);
    }
    cmdRenameFunction(oldName, newName);
    break;
  }
  case 'move-function': {
    const [, funcName, destPath] = args;
    if (!funcName || !destPath) {
      console.error('用法: node scripts/codemod.mjs move-function <函数名> <目标文件>');
      process.exit(1);
    }
    cmdMoveFunction(funcName, destPath);
    break;
  }
  case 'add-param': {
    const [, funcName, paramSignature, defaultValue] = args;
    if (!funcName || !paramSignature) {
      console.error('用法: node scripts/codemod.mjs add-param <函数名> <参数签名> [默认值]');
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
