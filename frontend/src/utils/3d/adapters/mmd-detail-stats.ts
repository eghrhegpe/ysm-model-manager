// ===== MMD 详情卡统计（ADR-131 P2）=====
// 详情卡（showMmdPreview）为显示 PMX 统计走一次 Worker 解析取 counts，
// 模块级缓存防重复解析（同 path 只解析一次）。
//
// 口径说明（审核建议 ② 落地）：PMX 头部**没有** counts（_ParseHeader 只读版本/索引
// 宽度/模型名，计数在各 section 开头），拿全必须完整解析——详情卡标注「文件统计」
// （PMX 解析口径），与 3D 菜单「渲染实测」（traverse 口径）、YSM 模型面板
// （Go AnalyzeBedrockModel 口径）三方区分，避免同屏数字口径困惑。
//
// Worker 不可用（vitest node）→ 解析失败 → null → 详情卡不渲染统计行（优雅降级）。

import { b64ToBytes } from "../base64.ts";
import { createPmxParser } from "./mmd-pmx-parser.ts";

/** PMX 文件级统计（详情卡展示；独立于 SceneStats 的 traverse 口径） */
export interface PmxFileStats {
  vertices: number;
  faces: number;
  bones: number;
  materials: number;
  morphs: number;
}

/** 模块级缓存：同 path 只 Worker 解析一次（防详情卡重复打开重复解析大文件） */
const pmxStatsCache = new Map<string, PmxFileStats>();

/** 清除缓存（测试钩子；生产由模块级生命周期自然存活） */
export function _clearPmxStatsCache(): void {
  pmxStatsCache.clear();
}

/**
 * 读 PMX 文件级统计：Worker 完整解析 → 取 counts → 缓存。
 * 失败 / Worker 不可用 / 无数据 → null（详情卡降级不渲染统计行）。
 */
export async function readPmxStats(
  path: string,
  readFn: (p: string) => Promise<string | null>,
): Promise<PmxFileStats | null> {
  const cached = pmxStatsCache.get(path);
  if (cached) return cached;
  try {
    const b64 = await readFn(path);
    if (!b64) return null;
    const bytes = b64ToBytes(b64);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const parser = createPmxParser();
    try {
      const resp = await parser.parse(buffer);
      if (!resp.ok || !resp.vertices) return null;
      const stats: PmxFileStats = {
        vertices: resp.vertices.count,
        faces: resp.faces?.count ?? 0,
        bones: resp.bones?.length ?? 0,
        materials: resp.materials?.length ?? 0,
        morphs: resp.morphs?.length ?? 0,
      };
      pmxStatsCache.set(path, stats);
      return stats;
    } finally {
      parser.dispose();
    }
  } catch {
    return null;
  }
}