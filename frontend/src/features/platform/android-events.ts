// ===== Android 系统事件消费（ADR-046 P2，参照 MikuMikuAR ADR-017 A3-04）=====
// Java 层（MainActivity）经 WailsBridge.emitEvent 发 CustomEvent 到前端：
//   android:back           双击返回退出（首次按下提示，2s 内再按真正退出）
//   android:NetworkChanged 网络状态变化（下载/工坊依赖网络，断连提示）
//   storage:permissionGranted 存储授权后重扫模型库
// 注意：必须走 emitEvent(CustomEvent 通道) 而非 emitSystemEvent(ApplicationEvent 通道)，
//       后者在 wails v3.0.0-alpha2.105 仅达 Go 侧、永不到达 WebView（详见审核报告 P1-1）。
// 桌面端无 Java 层，这些事件永不触发，注册无害。
// 生命周期：由 app-content 编排注册（ADR-185），unsubs 随 app-content 卸载清理（非顶层豁免）。
// （2026-09 锐评整改：删除 ScreenLocked/BatteryChanged/ThemeChanged 三处空回调占位——
//  空监听即死代码，需要时随真实消费逻辑一起注册。）

import { Events } from "../../backend/runtime.ts";
import { bus } from "../../bus.ts";
import { toast } from "../../core/feedback.ts";
import { t } from "../../core/i18n/t.ts";
import { emitAndroidBack } from "../../utils/dom/android-bridge.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { closeActiveDialog } from "../dialogs/modal-core.ts";

/** 注册 Android 系统事件消费，push 取消订阅函数到 unsubs */
export function registerAndroidEvents(unsubs: Array<() => void>): void {
  // 返回键：优先消费已注册的 UI handler（如 3D overlay 关层，ADR-057 §2.5），
  // 未消费时再走弹窗关闭 / "再按一次退出" 旧逻辑，保持双端行为一致。
  unsubs.push(
    Events.On("android:back", () => {
      if (emitAndroidBack()) return; // 3D overlay 等 handler 已消费，不触发后续逻辑
      if (closeActiveDialog()) return; // 触屏无 Esc，关弹窗（ADR-047）
      toast(t("android.backExit"), TOAST_MS.info, "info");
    }),
  );

  // 网络状态变化：断连时提示（社区下载/工坊加载依赖网络）
  // 绑定未声明 android:* 事件 payload（data 为 void），运行时 Java 侧发 JSON 字符串
  unsubs.push(
    Events.On("android:NetworkChanged", (e) => {
      const raw = e.data as unknown;
      if (typeof raw !== "string") return;
      try {
        const info = JSON.parse(raw) as { connected?: boolean; type?: string };
        if (info.connected === false) {
          toast(t("android.networkOffline"), TOAST_MS.normal, "warn");
        }
      } catch {
        // 非 JSON payload 忽略
      }
    }),
  );

  // 存储授权：用户在设置页开启"所有文件访问"后返回，重扫模型库
  // （MainActivity onResume / onActivityResult 检测到新授权时发此事件）
  unsubs.push(
    Events.On("storage:permissionGranted", () => {
      bus.emit("tree:reload");
      bus.emit("stats:refresh");
    }),
  );
}
