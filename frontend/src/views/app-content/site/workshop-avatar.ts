// ===== 创作者头像管理 =====
//
// 提取结果写入 community 层头像 store（ADR-264）——不再经 `host.state.avatarCache`：
// 该缓存的生命周期由写入方（模块级下载队列）决定，比任何页面都长。
import { clearAvatars, setAvatars } from "@/features/community/creator-avatar-store.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";

/**
 * 提取创作者头像（后台批量）
 *
 * 无参全量：`BatchExtractCreatorAvatars()` 扫全部模型一次性灌满头像 store；
 * 先前按「当前站点/作者限定 + 编辑态门控」的窄范围参数因实现走全局捷径而沦为死参数，
 * 已随 2026-08-18 瘦身删除（全量幂等增量更优，局部反而增加切换往返）。
 *
 * ⚠️ **空表必须区分两种语义**（锐评修复，2026-10-14）——这是本函数与 store 空表守卫的接合点：
 * Go 侧 `internal/app/app_avatar.go|BatchExtractCreatorAvatars` 在这两种情况下**都返回空表**：
 *   ① `ysmRoot() == ""`（仓库根**尚未配置**）→ 属「还不能提取」，此时清空会把下载期间经
 *      `avatar:refresh` 累积的增量抹掉——这正是 `creator-avatar-store.ts|setAvatars`
 *      空表守卫存在的理由，也正因如此本模块**曾**在调用侧也拦一道 `keys.length > 0`。
 *   ② 仓库根**已配置**但确实没有可提取的头像（无 `[作者]` 前缀的 ysm 模型 / 无 avatar 目录）
 *      → 属「确实没有」，**必须如实清空**。旧实现在此处与 ① 同判据直接跳过，于是用户把某
 *      创作者的全部模型删掉后，其陈旧头像在本应用会话内**永不自愈**（store 是模块级内存态、
 *      重启才清；修复前 `clearAvatars` 也**零生产调用点**——只有测试在用，"删除全部模型"
 *      因此没有任何别的失效链。修复后本文件是全仓唯一的 `clearAvatars` 生产调用点）。
 *
 * 修法：只在「仓库根已配置」这一条件下才认定空表具权威性（判据 = `GetRepoRoot("ysm")`，
 * 与 Go 侧 `ysmRoot()` 同一个 `GetRepoRoot("ysm")` 调用），此时调 `clearAvatars()` 显式清；
 * 仓库根为空则保留缓存。**不放松 `setAvatars` 的守卫**——它仍是「调用方无从判断时不得抹掉」
 * 的兜底安全网，判断权留在有信息的本函数。
 *
 * 背景（为何此前只有 CLI 能清）：`PurgeCreatorAvatarCache`（清**磁盘**头像缓存）早已存在并
 * 被 CLI `avatar purge` 使用（`go/cli/avatar.go|runAvatarPurge` 注释自陈「P1-2：缓存无失效
 * 机制，作者换头像后旧图残留，手动 purge 重建」——同一类问题上一轮审计已识别，但只落在 CLI），
 * 前端虽已生成该绑定却**零生产调用**，GUI 用户没有入口。本修复走的是「补上内存态的自愈判据」，
 * 与磁盘缓存的 purge 正交、可并存。
 */
export async function extractAvatars(): Promise<void> {
  try {
    const { BatchExtractCreatorAvatars, GetRepoRoot } = await backendGetApp();
    const result = await BatchExtractCreatorAvatars();
    const avatars = (result || {}) as Record<string, string>;
    const keys = Object.keys(avatars);
    if (keys.length > 0) {
      dbg("avatar", `提取了 ${keys.length} 个头像: ${keys.join(", ")}`);
      setAvatars(avatars);
      // 头像更新后触发站点视图刷新（由调用方处理）
      return;
    }
    // 空表 → 问仓库根是否已配置，据此区分「还不能提取」与「确实没有」
    const root = await GetRepoRoot(RESOURCE_TYPES.YSM).catch(() => "");
    if (!root) {
      dbg("avatar", "无头像可提取（仓库根未配置，保留既有缓存）");
      return;
    }
    dbg("avatar", "无头像可提取（仓库根已配置 → 如实清空，防陈旧头像不自愈）");
    clearAvatars();
  } catch (e) {
    dbg("avatar", "提取失败:", (e as Error)?.message);
  }
}
