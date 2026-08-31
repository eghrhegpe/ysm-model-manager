// ===== 纹理序口径（2026-08-10 统一）=====
// 与 Go 端 internal/app/texture_order.go 对称（改口径务必同步两侧）：
// 有 ysm.json 声明序 → 声明序 + default_texture 置首（只保留声明中的纹理）；
// 无声明序（加密模型等 ysm.json 不可解）→ 按纹理尺寸降序（主纹理通常最大）。
// 三处消费方：wasm.ts orderedTexKeys（本文件）、AnalyzeBedrockModel、decodeYSMViaNodeJS。

export interface OrderedTexInput {
  /** 全部纹理名（收集序，含未声明/头像等） */
  texKeys: string[];
  /** 各纹理像素面积（无法解析为 0） */
  areaOf: (key: string) => number;
  /** ysm.json files.player.texture 声明序（可为 null/undefined = 无声明） */
  ysmTexOrder?: unknown[] | null;
  /** ysm.json properties.default_texture 文件名（可为 null/undefined） */
  ysmDefaultTex?: string | null;
  /** 纹理名 → 实际 key 的匹配器（大小写/路径规整） */
  matchTexKey: (tn: string) => string | null;
}

/** 计算 3D 渲染/纹理选择器用的有序纹理名列表 */
export function buildOrderedTexKeys(input: OrderedTexInput): string[] {
  const { texKeys, areaOf, ysmTexOrder, ysmDefaultTex, matchTexKey } = input;
  if (ysmTexOrder && ysmTexOrder.length) {
    let ordered: string[] = [];
    for (const t of ysmTexOrder) {
      const path =
        typeof t === "string"
          ? t
          : (t as { uv?: string; path?: string })?.uv || (t as { path?: string })?.path || "";
      const tn = path.split("/").pop()?.replace(/\.\w+$/, "") || "";
      const matched = matchTexKey(tn);
      if (matched) ordered.push(matched);
    }
    // default_texture 置首（与 Go 端 orderTexByYSM 一致）
    if (ysmDefaultTex) {
      const defKey = matchTexKey(ysmDefaultTex.split("/").pop()?.replace(/\.\w+$/, "") || "");
      if (defKey && ordered.includes(defKey) && ordered[0] !== defKey) {
        ordered = [defKey, ...ordered.filter((k) => k !== defKey)];
      }
    }
    return ordered;
  }
  // 无声明序（加密模型等）：尺寸降序，主纹理（最大）置首
  return [...texKeys].sort((a, b) => (areaOf(b) ?? 0) - (areaOf(a) ?? 0));
}
