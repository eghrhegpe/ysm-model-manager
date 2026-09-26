// ===== 设置页共享状态（ADR-040：init.ts 巨型闭包变量显式化提升为模块级）=====
// initSettings 是设置页唯一入口（init-pages.ts 懒加载调用），语言热切换（ADR-045）后
// app-content 会重渲染设置页并再次执行 initSettings——因此所有共享状态必须经
// resetSettingsStore 重置，避免上次残留（旧 DOM 的刷新闭包/卡死的 busy 标志）污染本次。
import type { AppBindings } from "@/backend/app.ts";

// toastError 已收敛至 utils/dom/toast.ts（ADR-185 下沉，ADR-189 D3 归位）（instance-ops / settings 等多处 catch 共用，
// 2026-09 去重专项；本文件原本地实现删除，re-export 保持 settings/ 内部导入路径不变）
export { toastError } from "@/utils/dom/toast.ts";

/** 设置页当前配置类型（LoadAppConfig 返回值，经 Wails $CancellablePromise 解包） */
export type SettingsCfg = Awaited<ReturnType<AppBindings["LoadAppConfig"]>>;

/** 当前配置：initSettings 经 resetSettingsStore 注入；各模块经 getCfg() 就地更新字段
 *  （saveCfg/检测/主题/链接模式）。不导出裸 let——HMR 重载/多实例不再依赖模块绑定的活性 */
let cfg: SettingsCfg | undefined;

/** 当前配置读取器（initSettings 注入前调用会抛错——调用时机错位的显式信号） */
export function getCfg(): SettingsCfg {
  if (!cfg)
    throw new Error("[settings/store] cfg 未初始化：initSettings 未运行或 reset 后被提前读取");
  return cfg;
}

/** 所有路径卡片的刷新函数列表（绑定后收集，重排/重置时统一调用） */
export const cardRefreshers: Array<() => void> = [];

// 异步按钮防连点：目录选择/自动检测/重新链接进行中忽略后续点击。
// 2026-10 锐评收编：三段手写（isBusy 检查 + setBusy(true) + finally 复位）机制化为 withBusy()——
// 「带不带守卫」「锁何时释放」从注释约定变机制保证（原四处调用方各自手写，linkMode 回调
// 持锁后误调带守卫函数会自锁死，此类易错点随 isBusy/setBusy 导出退役而消失）。
let busy = false;

/**
 * 串行化执行：未持锁则置忙运行 task 并在结束后释放（task 抛出也释放，异常向调用方传播），
 * 返回是否获得锁。调用方拿 false 走拒绝分支（如链接模式下拉的当场回退），不再自持锁。
 * task 内部自理 try/catch + 错误 toast——本函数只管锁，不管错误出口。
 */
export async function withBusy(task: () => Promise<void>): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try {
    await task();
    return true;
  } finally {
    busy = false;
  }
}

/** 重置模块级状态（initSettings 开头调用；重复执行时清空上次残留） */
export function resetSettingsStore(next: SettingsCfg): void {
  cfg = next;
  cardRefreshers.length = 0;
  busy = false;
}
