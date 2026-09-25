// ===== VMD morph → VRM expression 映射表 v1（ADR-306 §2.1）=====
// 职责单一：把 MMD 的表情 morph 名翻译成 VRM 标准 preset 名。
// 与 vmd-retarget-map.ts 同约定（候选顺序即优先级、精确等同、首个命中胜出），
// 但**独立成文件**——morph 候选空间的变体密度（作者自由命名）与演进节奏
// 和骨骼完全不同，混表会让两个本就庞大的表互相拖累（ADR-306 §2.1）。
//
// 纯数据 + 纯类型：零 DOM / 零 backend / 零 three（ADR-072 工具层纯净；可 node 环境单测）。
//
// MMD 侧显式不映射的名（不进候选，自然落入丢弃通道）：
//   - `真顔`：MMD 作者的「清脸」morph（恢复默认表情），VRM preset 无对应物——早期 v1
//     误映 angry（每次清脸都在生气，比面瘫刺眼），锐评对账（P7）删除。
//   - `ウィンク`/`ウインク`（无左右标注）：MMD 配布里绝大多数是**单眼** wink，映双眼
//     blink 会两只眼一起错闭；单眼 wink 归二期 `blinkLeft`/`blinkRight` 候选（ADR-306 §3.3）。

/** VRM 标准 expression preset 名（VRMExpressionPresetName 的可映射子集） */
export type VrmExpressionPreset =
  | "aa"
  | "ih"
  | "ou"
  | "ee"
  | "oh"
  | "blink"
  | "happy"
  | "angry"
  | "sad"
  | "relaxed"
  | "surprised";

/**
 * 表情映射候选表：VRM preset → MMD morph 候选名（顺序即优先级，首个命中胜出）。
 *
 * 命中条件为**精确等同**（VMD morph 关键帧里的名字 === 候选名），不做模糊/前缀匹配——
 * 作者命名自由度太高，模糊匹配误伤率不可控。
 *
 * v1 不映射的 preset（显式声明，非遗漏）：
 *   - `neutral`：语义是「素颜基准」，驱动它会压掉其他表情（ADR-306 §2.1）
 *   - `blinkLeft`/`blinkRight`：MMD 单眼 wink 帧少见，归已知遗留（ADR-306 §3.3）
 *   - `lookUp`/`lookDown`/`lookLeft`/`lookRight`：视线由注视感知层/相机驱动，不归表情帧
 */
export const VMD_EXPRESSION_CANDIDATES: Readonly<
  Partial<Record<VrmExpressionPreset, readonly string[]>>
> = {
  // 口型（MMD あいうえお → VRM 母音 preset）
  aa: ["あ"],
  ih: ["い"],
  ou: ["う"],
  ee: ["え"],
  oh: ["お"],
  // 眨眼：只映射双眼「まばたき」。MMD 的 wink/ウィンク 绝大多数是单眼，映双眼 blink
  // 会两眼一起错闭；单眼 wink 归二期 blinkLeft/blinkRight（ADR-306 §3.3）
  blink: ["まばたき"],
  // 表情：MMD 常用名 → VRM 情感 preset（「真顔」是清脸 morph、无 VRM 对应，不映射）
  happy: ["笑い", "にこり", "にっこり", "笑顔"],
  angry: ["怒り", "怒り顔"],
  sad: ["悲しい", "困る", "困り顔", "悲しい顔"],
  relaxed: ["なごみ", "雰囲気", "照れ"],
  surprised: ["びっくり", "驚き"],
};

/** v1 显式不映射的 VRM preset + 原因（供诊断/文档直读） */
export const VMD_EXPRESSION_UNMAPPED: Readonly<Partial<Record<string, string>>> = {
  neutral: "素颜基准语义，驱动它会压掉其他表情（ADR-306 §2.1）",
  blinkLeft: "MMD 单眼 wink 帧少见，v1 只映射双眼 blink（ADR-306 §3.3）",
  blinkRight: "MMD 单眼 wink 帧少见，v1 只映射双眼 blink（ADR-306 §3.3）",
  lookUp: "视线由注视感知层/相机驱动，不归表情帧",
  lookDown: "视线由注视感知层/相机驱动，不归表情帧",
  lookLeft: "视线由注视感知层/相机驱动，不归表情帧",
  lookRight: "视线由注视感知层/相机驱动，不归表情帧",
};
