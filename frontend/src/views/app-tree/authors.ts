// ===== 作者标签模块 =====

import { logWarn } from "@/utils/base/primitives/log.ts";
import { withCached } from "@/utils/cache/with-cached.ts";
import { backendGetApp } from "@/views/backend-deps.ts";

/** 作者统计（Go ListModelAuthors 返回） */
export interface AuthorInfo {
  Name: string;
  Count: number;
}

// 与 community-data.ts 共享同 key + 同 TTL：重复加载不重走全库枚举
// （ScanEntriesLite 无 Go 侧缓存，scanner.go 注释：调用方自行决定复用策略）
const AUTHORS_CACHE_KEY = "ListModelAuthors";
const AUTHORS_CACHE_TTL_MS = 30 * 1000; // 30 秒

/**
 * 从 Go 端加载作者列表
 */
export async function loadAuthors(): Promise<AuthorInfo[]> {
  try {
    const { ListModelAuthors } = await backendGetApp();
    return (
      (await withCached(AUTHORS_CACHE_KEY, AUTHORS_CACHE_TTL_MS, () => ListModelAuthors())) || []
    );
  } catch (e) {
    // 与 app-tree._load 同款失败留痕：作者列表加载失败静默降级为空数组，
    // 但须留痕便于排查（原 catch {} 双重静默，开发者无从感知作者标签为何空白）
    logWarn("app-tree", "作者列表加载失败:", e);
    return [];
  }
}
