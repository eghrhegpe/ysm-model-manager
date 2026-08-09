// ===== Android 系统事件消费（ADR-046 P2，参照 MikuMikuAR ADR-017 A3-04）=====
// 官方模板 Java 层（MainActivity）已通过 emitSystemEvent 发 android:* 事件：
//   android:back           双击返回退出（首次按下提示，2s 内再按真正退出）
//   android:ScreenLocked   屏幕锁定（预留扩展点）
//   android:NetworkChanged 网络状态变化（下载/工坊依赖网络，断连提示）
// 桌面端无 Java 层，这些事件永不触发，注册无害。
// 生命周期：由 registerGlobalHandlers 聚合，unsubs 随 app-content 卸载清理（非顶层豁免）。
import { Events } from "@wailsio/runtime";
import { bus } from "../../bus.ts";
import { closeActiveDialog } from "../../utils/dom/dialogs/modal.ts";

/** 注册 Android 系统事件消费，push 取消订阅函数到 unsubs */
export function registerAndroidEvents(unsubs: Array<() => void>): void {
  // 返回键：先关活动弹窗（触屏无 Esc，ADR-047 桥接），无弹窗时提示"再按一次退出"
  unsubs.push(
    Events.On("android:back", () => {
      if (closeActiveDialog()) return; // 已关闭弹窗，本次返回被消费，不触发退出提示
      bus.emit("toast:show", {
        msg: "再按一次返回退出应用",
        duration: 2000,
        type: "info",
      });
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
          bus.emit("toast:show", {
            msg: "⚠️ 网络已断开",
            duration: 3000,
            type: "warn",
          });
        }
      } catch {
        // 非 JSON payload 忽略
      }
    }),
  );

  // 屏幕锁定：预留扩展点（后续可做自动保存/刷盘）
  unsubs.push(
    Events.On("android:ScreenLocked", () => {
      // 预留：当前无场景状态需要持久化，暂无动作
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

  // 电池/主题：预留扩展点（与 MikuMikuAR A3-04 对齐，注册即未来可消费）
  unsubs.push(Events.On("android:BatteryChanged", () => {}));
  unsubs.push(Events.On("android:ThemeChanged", () => {}));
}
