#!/usr/bin/env node
/**
 * check-boolean-naming.ts — 布尔变量命名规范检查器。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 扫描 frontend/src/ 下所有 .js（排除 css/ 子目录），检查三类布尔声明：
 *   1. 字面量初始化  const/let/var x = true|false
 *   2. 类型注解      x: boolean
 *   3. 函数返回类型  function f(): boolean
 *
 * 规范：布尔变量名首词必须是语义动词/状态词（is/has/can/should/enable/
 * visible/selected/loading/checked/active/ready/open 等）。违规 → WARN
 * （默认）或 ERROR（--strict）。
 *
 * 排除：全大写常量、_ 私有变量、导入绑定、DOM 事件参数（event/ev）。
 *
 * 用法：
 *   node scripts/check-boolean-naming.ts            # WARN 级
 *   node scripts/check-boolean-naming.ts --strict   # ERROR 级
 *   node scripts/check-boolean-naming.ts --json     # JSON（CI 用）
 *
 * 退出码：ERROR 数 > 0 → 1；否则 0。
 * 设计意图：Boolean 字段命名规范检查（env-state-schema.ts）
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { relPosix, SRC_DIR, walk } from "./_lib/scan-files.ts";

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has("--json");
const STRICT = ARGS.has("--strict");

// 供契约测试 import（tests/test_check_boolean_smart.ts 断言状态词在名单内，单一事实源）
export const VALID_PREFIXES = new Set([
  "is",
  "has",
  "can",
  "should",
  "will",
  "may",
  "must",
  "allow",
  "enable",
  "enabled",
  "disable",
  "disabled",
  "visible",
  "selected",
  "loading",
  "checked",
  "active",
  "ready",
  "open",
  "muted",
  "paused",
  "playing",
  "dirty",
  "valid",
  "required",
  "success",
  "failed",
  "pending",
  "show",
  "hide",
  "expanded",
  "collapsed",
  "focused",
  "hovered",
  "dragging",
  "running",
  "stopped",
  "done",
  "empty",
  "error",
  "editable",
  "clickable",
  "draggable",
  "resizable",
  // 补充状态词（与头注释「语义动词/状态词」规范对齐，防合规命名误报，code_review P2-5）
  "available",
  "locked",
  "cancelled",
  "ok",
  "hidden",
  "complete",
  "connected",
  "installed",
  "expired",
  // 2026-09-08 门禁鸡肋审查补全：真实扫描发现的合法布尔状态语义词。
  // 都是 :boolean 注解或初始化的真实布尔变量（抽查实证：busy=锁忙/disposed=析构/changed=变更检测/
  // orbit=camera 模式/castShadow:boolean/useSSR:boolean/depthTest:boolean 等），首词非缩写、语义单一。
  // 分类 A — 动态状态/生命周期/查询判定：busy(锁忙) disposed(析构) changed(变更) found(查到)
  //   exists(存在) settled(稳定) prev(上一态) early(早退) skip(跳过) timed(超时) banned(封禁)
  //   sub(子路径/子项判定) applied(已应用) released/achieved/applied/patched/closed(完成态过去分词)
  "busy",
  "disposed",
  "changed",
  "found",
  "exists",
  "settled",
  "prev",
  "early",
  "skip",
  "sub",
  "timed",
  "banned",
  "closed",
  "applied",
  "patched",
  "released",
  "achieved",
  // 分类 B — 属性/渲染模式布尔（three.js 契约字段，Semantic 名/属性名，非缩写）
  "orbit",
  "cast",
  "depth",
  "wireframe",
  "transparent",
  "environment",
  "reflector",
  "glow",
  "float",
  "premultiply",
  "pivot",
  "mirror",
  // 分类 C — 通用判定动词（usable 前缀 + 保留字语义）
  "use",
  "same",
  "multi",
  "load",
  "default",
  "matches",
  "needs",
]);

const findings: any[] = [];
let scannedCount = 0; // 实际读取成功的文件数（scanFile 静默跳过不可读文件，不能拿 walk 总数虚报，code_review P3）

function checkName(name: string, loc: string) {
  if (name.startsWith("_")) return; // 私有变量豁免（闭包状态命名自由）
  if (/^[a-zA-Z]$/.test(name)) return; // 单字母惯用短名
  if (/^[A-Z0-9_]+$/.test(name)) return; // 全大写常量
  if (["event", "ev", "e", "err", "error"].includes(name)) return; // 惯用短名
  const firstWord = (name.match(/^[a-z]+/) || [""])[0]; // 区分大小写，只取首个小写词
  if (!VALID_PREFIXES.has(firstWord)) {
    findings.push({ name, firstWord, loc });
  }
}

function scanFile(file: string) {
  let text: string | undefined; // 显式类型（biome noImplicitAnyLet：`let text;` 隐式 any 是 error 级）
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    return; // 文件级不可读（权限/竞态）跳过，不让单文件崩溃整脚本（code_review P3-3）
  }
  scannedCount++; // 计入实际读取的文件
  const lines = text.split(/\r?\n/);
  const rel = relPosix(file);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const loc = `${rel}:${i + 1}`;

    // 1. 字面量初始化（排除 import 与解构行）
    if (!/^\s*(import|export\s+default)/.test(line)) {
      for (const m of line.matchAll(
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:true|false)\b/g,
      )) {
        checkName(m[1]!, loc);
      }
      // 2. 类型注解 x: boolean
      for (const m of line.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*boolean\b/g)) {
        checkName(m[1]!, loc);
      }
    }
    // 3. 函数返回类型 function f(): boolean
    for (const m of line.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*:\s*boolean\b/g)) {
      checkName(m[1]!, loc);
    }
  }
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    // 错误路径也输出合法 JSON（含 _summary），满足 --json 契约（test_scripts_json 校验，code_review P3-4）
    console.log(
      JSON_OUT
        ? JSON.stringify({
            _summary: { scanned: 0, findings: 0 },
            findings: [],
            error: "frontend/src 不存在",
          })
        : "frontend/src 目录不存在",
    );
    process.exit(1);
  }
  const files = walk(SRC_DIR, { skipTest: true }); // 跳过测试文件：测试中的布尔命名不属生产规范（code_review P4-1）
  for (const f of files) scanFile(f as string);

  const uniq = new Map<string, any>(); // 去重（同名同文件多行可能重复）
  for (const f of findings) uniq.set(`${f.name}@${f.loc}`, f);
  const results = [...uniq.values()];

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          _summary: { scanned: scannedCount, findings: results.length },
          findings: results,
          scanned: scannedCount,
          strict: STRICT,
        },
        null,
        2,
      ),
    );
    process.exit(STRICT && results.length ? 1 : 0);
    return;
  }

  console.log("══════════════════════════════════════");
  console.log(" 布尔命名检查 (check-boolean-naming)");
  console.log("══════════════════════════════════════");
  console.log(`扫描文件 : ${scannedCount}`);
  console.log(`违规     : ${results.length}（${STRICT ? "ERROR 级" : "WARN 级"}）`);
  console.log("──────────────────────────────────────");

  for (const r of results) {
    console.log(
      `  ${STRICT ? "❌" : "⚠"} ${r.loc}  「${r.name}」首词「${r.firstWord}」非布尔语义词（建议 is/has/can/should/visible/... 前缀）`,
    );
  }

  if (STRICT && results.length) {
    console.log("\n退出码 1（--strict 模式阻断）。");
    console.log("→ 修复: 重命名非布尔前缀的变量（建议 is/has/can/should/visible 前缀）");
    process.exit(1);
  }
  console.log(
    results.length ? "\n（WARN 级不阻断，加 --strict 可升级为 ERROR）" : "✅ 布尔命名全部合规。",
  );
}

// ADR-234：main() 加直跑守卫——契约测试 import 本模块
// 取 VALID_PREFIXES 时不得触发全量扫描副作用（顶层 main 会扫全仓 + stdout 污染 +
// frontend/src 缺失时 process.exit(1) 杀死测试进程）；对齐仓内先例
// （check-ctx-menu-i18n / check-layering 的 pathToFileURL 守卫模式）
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
