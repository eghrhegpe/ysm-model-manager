#!/usr/bin/env node
/**
 * gate-config.mjs — pre-push-gate 静态工具清单单一配置层。
 *
 * 设计意图：pre-push-gate.mjs 职责是「按域调度检查」，但它长期内联了 4 个工具清单
 * （ALL_STATIC_TOOLS / DOC_STATIC_TOOLS / FRONTEND_STATIC_TOOLS / GO_STATIC_TOOLS，
 * 合计 40+ 项）。新增检查时同时改 gate 和清单的两处描述极易漂移（ADR-088 Take巧 #3 实证）。
 * 本模块把清单数据与 gate 调度逻辑解耦：gate 读配置，清单单一维护点。
 *
 * 结构（每项）：
 *   string  → 简单调用：node scripts/<name>.mjs --json
 *   { tool, args?, autoFix? } → 带参数调用；autoFix=true 时 FAIL 自动跑写盘版刷新后重验
 *
 * 用法：
 *   import { ALL_STATIC_TOOLS, DOC_STATIC_TOOLS, FRONTEND_STATIC_TOOLS, GO_STATIC_TOOLS }
 *     from './_lib/gate-config.mjs';
 *
 * 依赖：零依赖（纯数据结构）
 */

/**
 * 全量模式静态工具清单（doctor --all / pre-push-gate --all）。
 * 覆盖 Go + 前端 + 文档 + 脚本治理全栈；与域检查重叠的项（check-layering / binding-check）已剔除。
 */
export const ALL_STATIC_TOOLS = [
  'check-doc-drift.mjs',
  'check-adr-health.mjs',
  'check-boolean-naming.mjs',
  'check-circular.mjs',
  'check-circular-go.mjs',
  'check-orphan-exports.mjs',
  'check-deadcode-baseline.mjs',
  'jscpd-go.mjs',
  'check-tpl-refs.mjs',
  'check-dynamic-import.mjs',
  { tool: 'auto-import.mjs', args: ['--strict'] },
  { tool: 'gen-project-map.mjs', args: ['--check'] },
  { tool: 'event-graph.mjs', args: ['--check'], autoFix: true },
  { tool: 'build-novel-index.mjs', args: ['--check'] },
  { tool: 'gen-routes.mjs', args: ['--check'] },
  { tool: 'gen-routes-quick.mjs', args: ['--check'] },
  { tool: 'gen-cli-doc.mjs', args: ['--check'] },
  { tool: 'gen-cli-completion.mjs', args: ['--check'] },
  { tool: 'check-script-hygiene.mjs', args: ['--strict'] },
  'check-proc-adoption.mjs',
  'check-lib-adoption.mjs',
  'check-workflow-refs.mjs',
  'check-readme-index.mjs',
  { tool: 'i18n-check.mjs', args: ['--strict'] },
  'i18n-ui-check.mjs',
  { tool: 'css-layer-check.mjs', args: ['--strict'] },
  'check-toast-duration.mjs',
];

/**
 * 文档模式静态工具清单（doctor --docs / pre-push-gate --docs）。
 * 仅含 docs/ 域相关项（link-checker / adr-check 由域检查覆盖，不在此处重复）。
 */
export const DOC_STATIC_TOOLS = [
  'check-doc-drift.mjs',
  'check-adr-health.mjs',
  { tool: 'gen-project-map.mjs', args: ['--check'] },
  { tool: 'event-graph.mjs', args: ['--check'], autoFix: true },
  { tool: 'build-novel-index.mjs', args: ['--check'] },
  { tool: 'gen-routes.mjs', args: ['--check'] },
  { tool: 'gen-routes-quick.mjs', args: ['--check'] },
  { tool: 'gen-cli-doc.mjs', args: ['--check'] },
  { tool: 'gen-cli-completion.mjs', args: ['--check'] },
  { tool: 'check-script-hygiene.mjs', args: ['--strict'] },
  'check-proc-adoption.mjs',
  'check-workflow-refs.mjs',
  'check-readme-index.mjs',
];

/**
 * 文档额外检查（--all / --docs 模式下与 DOC_STATIC_TOOLS 合并执行）。
 * 仅含未被域检查覆盖的 drift 守护项。
 */
export const DOC_EXTRA_SCRIPTS = [
  'check-knowledge-drift.mjs',
  'check-adr-drift.mjs',
];

/**
 * 前端域 push 模式补挂静态工具（plan.frontend=true 时追加）。
 * 与 ALL_STATIC_TOOLS 分工：后者全量扫描，此项增量门禁——只拦本次变更引入的新违规。
 */
export const FRONTEND_STATIC_TOOLS = [
  'check-circular.mjs',
  'check-boolean-naming.mjs',
  'check-orphan-exports.mjs',
  'check-deadcode-baseline.mjs',
  'check-tpl-refs.mjs',
  'check-dynamic-import.mjs',
  { tool: 'auto-import.mjs', args: ['--strict'] },
  { tool: 'i18n-check.mjs', args: ['--strict'] },
  'i18n-ui-check.mjs',
  { tool: 'event-graph.mjs', args: ['--strict'] },
  'check-toast-duration.mjs',
  { tool: 'check-biome.mjs', args: ['--strict'] },
];

/**
 * Go 域 push 模式补挂静态工具（plan.go=true 时追加）。
 */
export const GO_STATIC_TOOLS = [
  'check-circular-go.mjs',
  'jscpd-go.mjs',
  'check-go-diff-coverage.mjs',
];

/**
 * scripts/ TS 类型检查（--all 模式；.ts 文件随 _lib/ 迁移逐步出现，零 .ts 时 tsc
 * 返回 TS18003 退出码 2——此处容忍 rc=2 为"无输入"，避免早期误阻断）。
 */
export const SCRIPTS_TYPECHECK = {
  tool: 'tsc',
  args: ['--noEmit', '-p', 'scripts/tsconfig.json'],
  allowRc2: true, // TS18003 无输入 = 尚未有 .ts，非错误
};
