// ===== 语义 Morph 层（SemanticMorphLayer）=====
// 跨格式「语义 morph」统一抽象：与语义骨骼层对称设计。
// 消费方（blink/lipSync/表情预设）只认语义 morph id，不认格式。
//
// 接入范围：
//   - MMD：pmx.morphs 候选名匹配（同语义骨骼层候选表策略）
//   - VRM：expressionManager 标准表达名（blink/lookLeft/lookRight...）
//   - YSM：暂不接入（YSM 无标准 morph 系统）
//
// 宽容缺省：匹配不到的语义 morph 不进 map，消费方 getSemanticMorph 返回 null。
// 纯逻辑零 DOM、零 backend（ADR-072 工具层纯净）。

/** 语义 morph id（对齐 MMD 标准表情 + VRM 标准 expression） */
export type SemanticMorphId =
  | "blink"       // 眨眼：まばたき / blink
  | "blinkLeft"   // 左眨：wink / blinkLeft
  | "blinkRight"  // 右眨：winkRight / blinkRight
  | "lipOpen"     // 张嘴：あ / A / mouth / open
  | "lipClose"    // 闭嘴：い / I / close
  | "lipPucker"   // 嘟嘴：う / U / pucker
  | "lipSmile";   // 微笑：え / E / smile

/** 全部语义 morph id（稳定顺序） */
export const SEMANTIC_MORPH_IDS: readonly SemanticMorphId[] = [
  "blink", "blinkLeft", "blinkRight",
  "lipOpen", "lipClose", "lipPucker", "lipSmile",
];

/** 语义 morph 解析结果 */
export interface SemanticMorphEntry {
  /** 格式内 morph 名（MMD: pmx morph name；VRM: expression name） */
  name: string;
}

/** 语义 morph 映射表（Partial：匹配不到的语义缺省） */
export type SemanticMorphMap = Partial<Record<SemanticMorphId, SemanticMorphEntry>>;

// ---------------------------------------------------------------------------
// MMD 候选名表（自 MikuMikuAR motion-algos 移植 + VRM 语义名扩展）
// ---------------------------------------------------------------------------

/** MMD 语义 morph 候选名表 */
export const MMD_SEMANTIC_MORPH_CANDIDATES: Record<SemanticMorphId, readonly string[]> = {
  blink: ["まばたき", "blink", "Blink", "眨眼", "wink", "EyeClose", "眼", "目", "閉眼"],
  blinkLeft: ["ウィンク", "wink", "Wink", "blinkLeft", "BlinkLeft", "左目閉じ"],
  blinkRight: ["ウィンク右", "winkRight", "WinkRight", "blinkRight", "BlinkRight", "右目閉じ"],
  lipOpen: ["あ", "ア", "A", "a", "口", "mouth", "open", "MouthOpen"],
  lipClose: ["い", "イ", "I", "i", "close", "Close", "口閉じ"],
  lipPucker: ["う", "ウ", "U", "u", "pucker", "Pucker", "くちゅ"],
  lipSmile: ["え", "エ", "E", "e", "smile", "Smile", "にこり", "笑い"],
};

// ---------------------------------------------------------------------------
// 解析器
// ---------------------------------------------------------------------------

/**
 * 在 morph 名列表中按候选名匹配首个语义 morph（候选顺序 = 优先级）。
 */
export function matchSemanticMorph(morphNames: readonly string[], candidates: readonly string[]): string | null {
  for (const c of candidates) {
    if (morphNames.includes(c)) return c;
  }
  return null;
}

/**
 * 从 morph 名列表 + 候选表解析语义 morph 映射（MMD 等无标准语义的格式走此路）。
 */
export function resolveSemanticMorphs(
  morphNames: readonly string[],
  candidates: Record<SemanticMorphId, readonly string[]>,
): SemanticMorphMap {
  const map: SemanticMorphMap = {};
  for (const id of SEMANTIC_MORPH_IDS) {
    const cands = candidates[id];
    if (!cands) continue; // 自定义/子集候选表缺键 = 该语义无候选，宽容跳过
    const name = matchSemanticMorph(morphNames, cands);
    if (name) map[id] = { name };
  }
  return map;
}

/**
 * MMD 特化：pmx.morphs[].name 列表 → 语义 morph 映射。
 */
export function mmdSemanticMorphMap(morphs: readonly { name: string }[]): SemanticMorphMap {
  const names = morphs.map((m) => m.name);
  return resolveSemanticMorphs(names, MMD_SEMANTIC_MORPH_CANDIDATES);
}

/**
 * 取语义 morph 条目（消费方唯一入口；缺失返回 null）。
 */
export function getSemanticMorph(map: SemanticMorphMap, id: SemanticMorphId): SemanticMorphEntry | null {
  return map[id] ?? null;
}
