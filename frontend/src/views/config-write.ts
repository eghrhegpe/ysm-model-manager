// ===== views 级应用配置写组合根（ADR-313 → 锐评 2026-10-15 P1 ③ 原子化）=====
// 血统：ADR-313 消灭「`SaveAppConfig` 六个同型 string 位置实参手抄」——设置页第八轮
// 把全页收敛到 path-cards.ts|saveCfg 单点，第九轮把实参点上移到本文件。位置错了类型
// 系统看不见，手抄一份就多一份漂移源（历史病灶：`"dark"` 不在 THEME_VALID 内、闭包旧值
// 覆盖 linkMode、themeAuto 漏落盘）。
//
// P1 ③ 收尾（本次）：实参点单点化之后暴露出更深的病——**单点本身是两次 IPC**。
// 旧实现「await LoadAppConfig() 取快照 → JS 侧拼完整六元组 → await SaveAppConfig(...)」，
// 两个 await 之间让出事件循环，期间别的写入口（SaveThresholds / SetDownloadMirror /
// 另一处 writeAppConfig）改的字段不在本次快照里，会被整份回写静默冲掉。改调 Go 侧
// `SaveAppConfigPatch(patch)` 后，整段读-改-写收进 configWriteMu 锁内的一次调用，
// TOCTOU 窗口从「两次 IPC 之间的任意长事件循环」收窄为「不存在」。
//
// 与 path-cards.ts|saveCfg 的关系：本文件是**唯一实参点**，saveCfg 降级为薄包装
// （补 settings 域的模块级 cfg 内存同步）。app-sidebar 两处直接调本模块，不再手抄配方。
//
// 分层：views/config-write.ts → { backend-deps, bus }，均为向下依赖，
// 不再拉起 settings-schema / theme-core（补丁语义下二者都不再需要——
// 值域与缺省都由 Go 侧负责，本文件只透传用户显式传入的字段）。

import { bus } from "@/bus";
// 精确同目录（views/ 根）：写 `./` 而非别名（check-path-hygiene R5）；且 R5 白名单
// 只认 `*-deps.ts`，故本文件不得直连 backend/app.ts，只能经此转发。
import { backendGetApp } from "./backend-deps.ts";

/**
 * 应用配置补丁：只列出希望覆盖的字段，未列字段取**当前落盘值**。
 *
 * 未传字段由 Go 侧 `SaveAppConfigPatch` 在 configWriteMu 锁内重读决定，**不再由前端预读**。
 * 字段值一律 `string | undefined`（非 `null`）：`undefined` = 未传，与 Go 侧 `*string` 的
 * nil 契约一一对应（生成绑定把两者都映射为 nil）；显式传 `""` = 真的写入空串
 * （Go 侧不再经 orDefault 兜底，而是按「用户显式清空」处理——这是 patch 入口与
 * 位置实参入口 `SaveAppConfig` 的**有意语义差异**，见 writeAppConfig 注释）。
 */
export interface AppConfigPatch {
  filesRoot?: string;
  mcRoot?: string;
  linkMode?: string;
  theme?: string;
  themeAuto?: string;
}

/**
 * 写应用配置的**唯一入口**：`SaveAppConfigPatch(patch)`（锐评 2026-10-15 P1 ③）。
 *
 * 语义：未 patch 的字段由 Go 侧在 `configWriteMu` 锁内重读磁盘决定。
 *
 * 为什么不再前端预读（这是本函数相对旧实现的核心变化）：
 * 旧实现是「`await LoadAppConfig()` 取快照 → JS 侧拼出完整六元组 → `await
 * SaveAppConfig(六元组)`」——两次 IPC 之间让出事件循环，期间另一写入口
 * （SaveThresholds / SetDownloadMirror / 另一处 writeAppConfig）改的字段不在本次
 * 快照里，会被这次整份回写静默覆盖（用户改的设置重启后回到旧值，无任何报错）。
 * 现在整段读-改-写在 Go 侧一次调用内完成，TOCTOU 窗口收窄为「不存在」。
 *
 * 其余契约：
 * - mcRoot 非空时 Go 侧仍走 ValidateMinecraftDir，校验失败 reject、不落盘；
 * - linkMode 走 SanitizeLinkMode 软校验（非法值回落旧值，不 reject 整个保存）；
 * - **不**在本函数内更新任何模块级内存快照——内存一致性归调用方（settings 域的
 *   saveCfg 包装负责同步 getCfg()），本模块保持无状态、可供任意 view 复用。
 *
 * @param patch 需要覆盖的字段（其余取锁内重读值）
 * @returns 实际生效的字段值（读回落盘态广播，供调用方同步内存快照）
 */
export async function writeAppConfig(patch: AppConfigPatch): Promise<AppConfigPatch> {
  const { SaveAppConfigPatch } = await backendGetApp();
  await SaveAppConfigPatch(patch);
  // 落盘成功后广播（载荷 = 本次 patch 的生效值）。配置读取方由「每次 reload 重拉
  // LoadAppConfig」改为订阅本事件——省 IPC，且设置页改完即刷新显示，不必等下一次
  // reload。⚠️ 只在成功后发：失败时读取方保持旧值，比广播半份配置诚实。
  // 载荷只带本次 patch 的键：订阅方按「键存在即取该值、键缺失即保持现状」消费，
  // 故无需为广播再读一次磁盘（读一次会把刚写入的值变成又一轮 IO）。
  bus.emit("config:changed", patch);
  return patch;
}
