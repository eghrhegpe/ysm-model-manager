/**
 * gate-config-go.ts — Go 域静态工具清单（plan.go 时的 push 补挂）+ scripts 域 typecheck。
 *
 * 从 gate-config.ts 沿域缝拆出（ADR-234 D3 `_lib` 400 行硬红线，2026-10-25）。
 * SCRIPTS_TYPECHECK 与 GO_STATIC_TOOLS 同属「非前端、非文档的构建期工具」一簇，
 * 一并迁入以保持 gate-config 主文件只留 ALL 表与展平序。
 *
 * 依赖：./gate-tool-types.ts（GateTool / debt）
 */
import { debt, type GateTool } from "./gate-tool-types.ts";

/**
 * Go 域 push 模式补挂静态工具（plan.go=true 时追加）。
 */
export const GO_STATIC_TOOLS: GateTool[] = [
  {
    tool: "jscpd-go.ts",
    blockPolicy: "debt",
    debt: debt("Go 侧克隆基线；含有意保留的兼容入口，需逐对判断"),
  },
  { tool: "check-go-diff-coverage.ts", blockPolicy: "hard" },
  // check-go-coverage-threshold：包级最低函数覆盖率（语句加权，2026-09 口径修正后）。
  // 只读不写：本门禁不自动生成 .coverage/go-cover.out（pre-push 薄壳 / gate-blocks / CI 非门禁步
  // 均不写此文件），需人工或 CI 先 `go test -coverprofile` 喂料；产物缺失/陈旧时脚本已优雅
  // 降级（缺产物 WARN+exit1，陈旧产物打印醒目警告，见 P1-a 根治）。debt 接入 → 不阻断推送。
  {
    tool: "check-go-coverage-threshold.ts",
    blockPolicy: "debt",
    debt: debt("只读不写：产物需人工/CI 喂料，自动生成未接（降级路径已优雅）"),
  },
];

/**
 * scripts/ TS 类型检查（--all 模式；.ts 文件随 _lib/ 迁移逐步出现，零 .ts 时 tsc
 * 返回 TS18003 退出码 2——此处容忍 rc=2 为"无输入"，避免早期误阻断）。
 */
export const SCRIPTS_TYPECHECK: GateTool = {
  tool: "tsc",
  args: ["--noEmit", "-p", "scripts/tsconfig.json"],
  allowRc2: true, // TS18003 无输入 = 尚未有 .ts，非错误
  blockPolicy: "hard",
};
