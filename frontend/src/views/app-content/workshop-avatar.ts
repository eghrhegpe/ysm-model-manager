// ===== 创作者头像管理 =====

import { dbg } from "@/utils/debug/debug.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import type { AppContentHost } from "./host.ts";

/**
 * 提取创作者头像（后台批量）
 *
 * 无参全量：BatchExtractCreatorAvatars() 扫全部模型一次性灌满 host.state.avatarCache；
 * 先前按「当前站点/作者限定 + 编辑态门控」的窄范围参数因实现走全局捷径而沦为死参数，
 * 已随 2026-08-18 瘦身删除（全量幂等增量更优，局部反而增加切换往返）。
 */
export async function extractAvatars(host: AppContentHost): Promise<void> {
  try {
    const { BatchExtractCreatorAvatars } = await backendGetApp();
    const result = await BatchExtractCreatorAvatars();
    const avatars = (result || {}) as Record<string, string>;
    const keys = Object.keys(avatars);
    if (keys.length > 0) {
      dbg("avatar", `提取了 ${keys.length} 个头像: ${keys.join(", ")}`);
      host.state.setAvatarCache(avatars);
      // 头像更新后触发站点视图刷新（由调用方处理）
    } else {
      dbg("avatar", "无头像可提取（无 .ysm 文件或无 avatar/ 目录）");
    }
  } catch (e) {
    dbg("avatar", "提取失败:", (e as Error)?.message);
  }
}
