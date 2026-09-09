// ===== ysm.json 直接解析（ADR-217 已下沉 parsers/ysm-json.ts）=====
// 此处保留再导出，避免扰动 decoder 内部与测试现有 import。
// 作者解析逻辑现位于 parsers/ysm-json.ts，仍共用 preview-3d/decoder/ysm-authors.ts（单一来源，防双写分叉）。
export { parseYsmJsonDirect } from "@/parsers/ysm-json.ts";
