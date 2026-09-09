// ===== Bedrock geometry 解析函数（ADR-217 已下沉 parsers/bedrock-geometry.ts）=====
// 此处保留再导出，避免扰动 decoder 内部与下游约 30 处消费方（含类型与测试）。
export {
  type BedrockBone,
  type BedrockCube,
  type BedrockGeometry,
  type BedrockSubModel,
  parseBedrockGeometryFromJSON,
} from "@/parsers/bedrock-geometry.ts";
