// ===== 设置页共享状态（ADR-040：init.ts 巨型闭包变量显式化提升为模块级）=====
// initSettings 是设置页唯一入口（init-pages.ts 懒加载调用），语言热切换（ADR-045）后
// app-content 会重渲染设置页并再次执行 initSettings——因此所有共享状态必须经
// resetSettingsStore 重置，避免上次残留（旧 DOM 的刷新闭包/卡死的 busy 标志）污染本次。
import type { AppBindings } from "../../../backend/app.ts";
// toastError 已收敛至 core/context-menu-shared.ts（instance-ops / settings 等多处 catch 共用，
// 2026-09 去重专项；本文件原本地实现删除，re-export 保持 settings/ 内部导入路径不变）
export { toastError } from "../../../core/context-menu-shared.ts";

/** 设置页当前配置类型（LoadAppConfig 返回值，经 Wails $CancellablePromise 解包） */
export type SettingsCfg = Awaited<ReturnType<AppBindings["LoadAppConfig"]>>;

/** 当前配置：initSettings 加载后注入，各模块就地更新字段（saveCfg/检测/主题/链接模式） */
export let cfg: SettingsCfg;

/** 所有路径卡片的刷新函数列表（绑定后收集，重排/重置时统一调用） */
export const cardRefreshers: Array<() => void> = [];

// 异步按钮防连点：目录选择/自动检测/重新链接进行中忽略后续点击（finally 释放）
let busy = false;
export const isBusy = (): boolean => busy;
export const setBusy = (v: boolean): void => {
  busy = v;
};

/** 重置模块级状态（initSettings 开头调用；重复执行时清空上次残留） */
export function resetSettingsStore(next: SettingsCfg): void {
  cfg = next;
  cardRefreshers.length = 0;
  busy = false;
}
