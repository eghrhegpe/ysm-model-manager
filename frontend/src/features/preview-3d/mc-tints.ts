// mc-tints.ts — MC biome 染色查表（ADR-080 §5.4，L4 默认 plains 实现）
//
// 数据来源（两层）：
//  1. 运行时 vendored：frontend/public/mc-tints/<version>.json
//     —— 来自 minecraft-data 的 tints 表。注意：该表仅含「例外 biome」固定色与 water 固定色；
//        默认 biome 的 grass/foliage 在表中 color=0（哨兵：需走 colormap 采样），故默认 biome 不直接取此值。
//  2. DEFAULT_TINTS：默认 biome(plains) 的草/叶/水权威色，取自 MC Wiki biome 颜色表
//     （Plains: temperature 0.8, downfall 0.4 → grass #91BD59, foliage #77AB2F, water #3F76E4）。
//     该值等价于对 grass.png / foliage.png colormap 在 plains 坐标采样的结果（colormap 采样为 L5 全 biome 路径）。
//
// 解码口径：minecraft-data 打包色 = 0xRRGGBB（与 prismarine-viewer tintToGl 一致：
//   r=(c>>16)&0xff, g=(c>>8)&0xff, b=c&0xff）。

type TintEntry = { keys: string[]; color: number };
type TintsFile = Record<string, { data: TintEntry[] }>;

/** 默认 biome(plains) 权威色（MC Wiki biome 颜色表；≈ colormap 采样结果）。 */
const DEFAULT_TINTS: Record<string, number> = {
  grass: 0x91bd59, // #91BD59 — MC Wiki Plains 草地
  foliage: 0x77ab2f, // #77AB2F — MC Wiki Plains 树叶
  water: 0x3f76e4, // #3F76E4 — MC Wiki Plains 水（≈ tints.water[plains]）
  dead_bush: 0x7c4e08, // 固定枯枝色（MC 无 biome tint，沿用原兜底）
};

let cache: TintsFile | null = null;
let inflight: Promise<TintsFile> | null = null;

/** 预载 vendored tints 表（幂等；失败抛错由调用方降级兜底）。 */
export function loadMcTints(version = "1.21.4"): Promise<TintsFile> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  const base = import.meta.env.BASE_URL ?? "/";
  inflight = fetch(`${base}mc-tints/${version}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<TintsFile>;
    })
    .then((d) => {
      cache = d;
      return d;
    })
    .catch((e: unknown) => {
      // 失败后清空 inflight：一次网络瞬断不应让本页面生命周期内永久锁死加载
      inflight = null;
      throw e;
    });
  return inflight;
}

/**
 * 取某染色类别在某 biome 下的颜色（默认 plains）。
 * - dead_bush：固定色（无 biome tint）。
 * - water / 例外 biome：tints 表非零即真实固定色，优先采用（data-driven）。
 * - 默认 biome 的 grass/foliage：tints 表中为 0（需 colormap 采样）→ 降级为 DEFAULT_TINTS（plains 采样常量）。
 */
export function getTintColorSync(category: string, biome = "plains"): number {
  if (category === "dead_bush") return DEFAULT_TINTS.dead_bush;
  if (cache && cache[category]) {
    const e = cache[category].data.find((x) => x.keys.includes(biome));
    if (e && e.color !== 0) return e.color; // 非零 = 真实固定色（water / 例外 biome）
  }
  return DEFAULT_TINTS[category] ?? DEFAULT_TINTS.grass;
}
