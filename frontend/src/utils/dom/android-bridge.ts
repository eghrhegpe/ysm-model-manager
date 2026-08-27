// ===== Android Java 桥访问（ADR-046 P2）=====
// 桥探测原语（getAndroidBridge/WailsAndroidBridge）已下沉到 backend/platform.ts
// （ADR-123 P3：叶子模块持有 Tier 2 原语，判定链单向化 android-bridge → platform-web
// → platform）；本文件保持 re-export，既有消费方（loader/directory-picker 等）导入路径不变。
export { getAndroidBridge, type WailsAndroidBridge } from "../../backend/platform.ts";
import { isViewerPlatform } from "../../backend/platform-web.ts";

/**
 * 查看器模式判定（ADR-049 Phase 3 能力门控统一入口）：
 * Android（双端桥存在）或网页版（browser adapter）——均无本地文件系统写能力、
 * 无桌面专属 UI（系统对话框/自更新/资源管理器/整合包概念）。
 * 各按钮/功能守卫统一用本函数，禁止各自拼 getAndroidBridge()/resolveWebMode()。
 * P3 后委托 platform-web.isViewerPlatform()——信号拼装不再在此重复，
 * 与 resolveWebMode()/resolvePlatformMode() 的等价关系由 platform-parity.test.ts 锁死。
 */
export function isViewerMode(): boolean {
  return isViewerPlatform();
}

/**
 * 安卓系统返回键处理器注册表（ADR-057 §2.5，对齐 MikuMikuAR handleAndroidBack）。
 * 栈顶优先：android-events.ts 收到 MainActivity 的 android:back 事件后调用
 * emitAndroidBack()，从栈顶向下询问已注册处理器；返回 true 表示已消费
 * （如 3D overlay 打开时关层），否则透传上层。
 */
type AndroidBackHandler = () => boolean | void;
const _androidBackHandlers: AndroidBackHandler[] = [];

/** 注册安卓返回键处理器，返回取消函数（供调用方在自身销毁/关闭时注销）。 */
export function registerAndroidBackHandler(fn: AndroidBackHandler): () => void {
  _androidBackHandlers.push(fn);
  return (): void => {
    const i = _androidBackHandlers.indexOf(fn);
    if (i > -1) _androidBackHandlers.splice(i, 1);
  };
}

/**
 * 系统返回键的前端触发入口：依次从栈顶触发已注册处理器。
 * 当前由 android-events.ts 在收到 MainActivity 的 android:back 事件时调用；
 * 返回 true 表示已被消费（阻止原生默认返回/退出）。
 */
export function emitAndroidBack(): boolean {
  for (let i = _androidBackHandlers.length - 1; i >= 0; i--) {
    if (_androidBackHandlers[i]() === true) return true;
  }
  return false;
}
