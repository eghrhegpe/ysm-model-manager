// ===== localStorage 安全读写（ADR-044 策略 A：基础设施工具函数收敛）=====
// 隐私模式 / 存储禁用下 localStorage 读写会抛错——裸调会中断启动链（initTheme/applyUIPrefs）、
// 初始化（settings.initSettings）或事件回调。全项目统一经本模块读写，禁止裸调 localStorage。
// 收敛自：app-modules.ts 的模块级 safeGet/safeSet、settings/init.ts 的 themeGet/themeSet。
import { logWarn } from "@/utils/base/log.ts";

/** 安全读：存储不可用时返回 null（调用方走默认值回退） */
export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    logWarn("storage", `safeGet(${key}) 失败`, err);
    return null;
  }
}

/** 安全写：存储不可用时静默忽略持久化（不中断调用方） */
export function safeSet(key: string, val: string): void {
  try {
    localStorage.setItem(key, val);
  } catch (err) {
    logWarn("storage", `safeSet(${key}) 失败`, err);
  }
}

/** 安全删：存储不可用时静默忽略（不中断调用方） */
export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    logWarn("storage", `safeRemove(${key}) 失败`, err);
  }
}

/** 安全读 JSON：解析失败（损坏/非法）时返回 fallback，不抛错中断启动链 */
export function safeGetJSON<T>(key: string, fallback: T): T {
  const raw = safeGet(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    logWarn("storage", `safeGetJSON(${key}) 解析失败`, err);
    return fallback;
  }
}
