// ===== 纹理序口径（2026-08-10 统一；2026-10-10 语义对齐收口）=====
// 与 Go 端 internal/app/texture_order.go|orderTexItems **逐分支对称**（口径由跨语言
// 契约 tests/test_texture_order_parity.ts 锁死，改一侧忘另一侧即红——此前只靠本注释）：
// 有 ysm.json 声明序 → 声明序 + default_texture 置首（只保留声明中的纹理）；
// 声明序**全部匹配不上**（加密包/声明名与提取名对不上）→ 与空声明同样回退尺寸降序
// （Go 侧该行为另有 panic 防护动因；旧 TS 返回 [] 会让 WASM 主路径退化成灰模、
// 而 Go 兜底/搜索缩略走尺寸序有纹理——两条解码路径相反结果即双源病的现形）；
// 无声明序 → 按纹理尺寸降序（主纹理通常最大）。
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

/** 计算 3D 渲染/纹理选择器用的有序纹理名列表
 *  与 Go orderTexByYSM 逐语义对称（跨语言对账锁 tests/fixtures/parity/texture-order.golden.json）：
 *  声明序去重、后声明位胜出（Go rank map 后写覆盖 + SliceStable）、只保留命中纹理、
 *  default_texture 置首；命中集为空与无声明同样回退尺寸降序。 */
export function buildOrderedTexKeys(input: OrderedTexInput): string[] {
  const { texKeys, areaOf, ysmTexOrder, ysmDefaultTex, matchTexKey } = input;
  if (ysmTexOrder?.length) {
    // rank[matched] = 声明中的**最后**位置（后声明覆盖，对齐 Go rank map 后写 + 天然去重）。
    // 旧实现按声明序 push 不去重 → 重复声明产出重复项、且前位胜出，与 Go 分叉。
    const rank = new Map<string, number>();
    ysmTexOrder.forEach((t, i) => {
      const path =
        typeof t === "string"
          ? t
          : (t as { uv?: string; path?: string })?.uv || (t as { path?: string })?.path || "";
      const tn =
        path
          .split("/")
          .pop()
          ?.replace(/\.\w+$/, "") || "";
      const matched = matchTexKey(tn);
      if (matched) rank.set(matched, i);
    });
    // 命中纹理按 rank（最后声明位）升序，对齐 Go「按收集序过滤命中 → SliceStable by rank」。
    let ordered = [...rank.keys()].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    // default_texture 置首（仅当命中集含它）
    if (ysmDefaultTex) {
      const defKey = matchTexKey(
        ysmDefaultTex
          .split("/")
          .pop()
          ?.replace(/\.\w+$/, "") || "",
      );
      if (defKey && ordered.includes(defKey) && ordered[0] !== defKey) {
        ordered = [defKey, ...ordered.filter((k) => k !== defKey)];
      }
    }
    // 命中集非空才用声明序；全不命中与「无声明序」同走尺寸降序——逐分支对齐 Go
    // orderTexItems（`if len(on) > 0 { return on }` 后落 orderTexBySize）。旧实现此处
    // 直接 return ordered（可能为 []），使 WASM 主路径退化成灰模、Go 兜底却走尺寸序
    // 有纹理——两条解码路径相反结果，正是跨语言手抄双源的静默分叉（锐评 2026-10-10）。
    if (ordered.length > 0) return ordered;
  }
  // 无声明序 / 声明序全不命中（加密模型、声明名与提取名对不上）：尺寸降序，主纹理（最大）置首
  return [...texKeys].sort((a, b) => (areaOf(b) ?? 0) - (areaOf(a) ?? 0));
}
