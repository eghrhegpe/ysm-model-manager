#!/usr/bin/env node
/**
 * bindings-sync-hint.ts — Wails bindings 同步提醒 · prepare-commit-msg 辅助脚本（非阻断）。
 *
 * 设计意图：CI 有「绑定保鲜」契约测试（test.yml 跑 generate:bindings + git diff --exit-code），
 * 但本地提交时零提示——Go 侧改了 `internal/app` 的绑定面（签名 / JSDoc 注释）而 bindings
 * 生成物未随 commit 同步，两次复发（a43533009 / a97f32c9d）都是等 CI 红了才补提交。
 * 本脚本在每次 commit 时做轻量启发式判定：本次 staged 含绑定面源文件（internal/app/
 * 非测试 .go）但不含 frontend/bindings/ 生成物 → 终端提醒「可能需要 regenerate」。
 *
 * 口径与边界（为什么这是启发式而非精确对账）：
 *   - 精确对账（签名/注释逐位比对）成本 = 跑一次 `wails3 generate bindings`（实测 ~80s+
 *     且依赖 registry），远超 prepare-commit-msg 秒级承诺——只做「改了绑定面却没带生成物」
 *     的形态提醒，把「该想想是否 regenerate」这个决定交回给提交者（AI/人）。
 *   - 判定域 = internal/app 下非测试 .go（binding-check.ts 同款扫描面，Wails 绑定入口）。
 *     不含 go/（CLI 命令实现，非 Wails 绑定面）——避免无关 CLI 改动天天误报。
 *   - 生成物域 = frontend/bindings/ 下全部产物（wails3 -ts 产物，git 入库）。
 *   - 误报可接受且被设计成低噪：改 internal/app 纯内部逻辑（不碰导出签名）也会提示，
 *     但提示文案明确「若未改导出签名/注释可忽略」；改 go/ 与 docs 不触发。
 *   - 永远 exit 0，绝不阻断提交；任何异常静默跳过。
 *   - 只终端(stderr)输出，不写 commit body（与其余 hint 同口径）。
 *   - 逃生阀：YSM_SKIP_BINDINGS_HINT=1 git commit
 *
 * 依赖：node:path / 本地模块 getRoot / _lib/proc.ts
 */

import { pathToFileURL } from "node:url";
import { run } from "../_lib/proc.ts";
import { getRoot } from "../_lib/scan-files.ts";

/** 绑定面源文件前缀（Wails 绑定入口；与 binding-check.ts 扫描面一致）。 */
export const BINDING_SOURCE_PREFIX = "internal/app/";

/** bindings 生成物目录前缀（wails3 -ts 产物）。 */
export const BINDINGS_ARTIFACT_PREFIX = "frontend/bindings/";

/**
 * 纯函数判定：本次 staged 文件集是否需要 bindings 同步提醒。
 * @param {string[]} stagedFiles repo-root 相对路径列表
 * @returns {boolean} 绑定面源改动且无生成物同步 → true
 */
export function needsBindingsHint(stagedFiles) {
  if (!Array.isArray(stagedFiles) || stagedFiles.length === 0) return false;
  let touchedBindingSource = false;
  let touchedBindingsArtifact = false;
  for (const f of stagedFiles) {
    const posix = f.replace(/\\/g, "/");
    if (posix.startsWith(BINDING_SOURCE_PREFIX) && posix.endsWith(".go")) {
      if (posix.endsWith("_test.go")) continue; // 测试不算绑定面改动
      touchedBindingSource = true;
    }
    if (posix.startsWith(BINDINGS_ARTIFACT_PREFIX)) touchedBindingsArtifact = true;
  }
  return touchedBindingSource && !touchedBindingsArtifact;
}

/** 取本次暂存区改动文件（repo-root 相对路径；git 失败返回 []）。 */
export function getStagedFiles(root) {
  const r = run("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    cwd: root,
  });
  if (!r.ok) return [];
  const out = r.out.trim();
  return out ? out.split("\n") : [];
}

/** 主流程（import.meta 守卫：仅作为脚本执行时运行，被测试 import 时不跑）。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const skip = process.env.YSM_SKIP_BINDINGS_HINT === "1";
  if (skip) process.exit(0);
  try {
    const root = getRoot();
    const staged = getStagedFiles(root);
    if (needsBindingsHint(staged)) {
      console.error(
        "🔧 bindings 同步提醒：本次提交改了绑定面源文件（internal/app/*.go）但未带 frontend/bindings/ 生成物。",
      );
      console.error(
        "   若改动了导出签名或 JSDoc 注释，请先 `cd frontend && npm run generate:bindings`（-ts 契约）并提交生成物，否则 CI 绑定保鲜测试会红。",
      );
      console.error("   未改动导出面可忽略本提示；逃生阀 YSM_SKIP_BINDINGS_HINT=1。");
    }
  } catch {
    // 非阻断：任何异常静默跳过
  }
  process.exit(0);
}
