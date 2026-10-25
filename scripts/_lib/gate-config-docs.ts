/**
 * gate-config-docs.ts — 文档域静态工具清单（--docs / --all 的文档子集）。
 *
 * 从 gate-config.ts 沿域缝拆出（ADR-234 D3 `_lib` 400 行硬红线，2026-10-25）。
 * 只搬移不重写：条目内容、顺序、注释与原文件逐字一致。
 *
 * 依赖：./gate-tool-types.ts（GateTool / debt）
 */
import { debt, type GateTool } from "./gate-tool-types.ts";

/**
 * 文档模式静态工具清单（doctor --docs / pre-push-gate --docs）。
 * 仅含 docs/ 域相关项（link-checker / adr-check 由域检查覆盖，不在此处重复）。
 */
export const DOC_STATIC_TOOLS: GateTool[] = [
  { tool: "check-doc-drift.ts", blockPolicy: "hard" },
  { tool: "check-adr-health.ts", blockPolicy: "hard" },
  { tool: "check-resource-manifest.ts", blockPolicy: "hard" },
  { tool: "event-graph.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "build-novel-index.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-routes.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-routes-quick.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-cli-doc.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-cli-completion.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-knowledge-autogen.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "check-script-hygiene.ts", args: ["--strict"], blockPolicy: "hard" },
  {
    tool: "check-proc-adoption.ts",
    blockPolicy: "debt",
    debt: debt("进程调用收口未完成的存量站点"),
  },
  { tool: "check-workflow-refs.ts", blockPolicy: "hard" },
  { tool: "check-readme-index.ts", blockPolicy: "hard" },
  // docs markdown 裸标签：见 ALL_STATIC_TOOLS 同项注释（整站构建断裂前移为提交期判定）
  { tool: "check-doc-markup.ts", blockPolicy: "hard" },
];

/**
 * 文档额外检查（--all / --docs 模式下与 DOC_STATIC_TOOLS 合并执行）。
 * 仅含未被域检查覆盖的 drift 守护项。
 */
export const DOC_EXTRA_SCRIPTS: GateTool[] = [
  { tool: "check-knowledge-drift.ts", blockPolicy: "hard" },
  { tool: "check-adr-drift.ts", blockPolicy: "hard" },
];
