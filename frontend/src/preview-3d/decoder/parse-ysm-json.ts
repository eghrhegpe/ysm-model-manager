// ===== ysm.json 直接解析（ADR-217 已下沉 parsers/ysm-json.ts）=====
// 本文件为 `parseYsmJsonDirect` 的兼容再导出（避免扰动 decoder 内部与测试现有 import）。
// 作者解析逻辑位于 `parsers/ysm-authors.ts`（`parsers/ysm-json.ts:7` 直引，不经本文件）。
export { parseYsmJsonDirect } from "@/parsers/ysm-json.ts";
