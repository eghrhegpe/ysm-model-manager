// ===== 日记落盘适配器（ADR-189 D1）：DiarySink → backend AddOpLog =====
// core/error-diary 经此注入落盘能力，依赖方向保持 backend → core 单向；
// 净化/去重/截断策略归 core，本文件只负责 Wails 调用与失败截断。

import type { DiarySink } from "../core/error-diary.ts";
import { getApp } from "./app.ts";

/** 构造日记落盘 sink：entry 转发至 AddOpLog（op="ui"，sourcePath/targetDir/fileSize 空位） */
export function makeDiarySink(): DiarySink {
  return (entry) => {
    void (async () => {
      const { AddOpLog } = await getApp();
      await AddOpLog("ui", entry.title, "", "", 0, entry.status, entry.detail);
    })().catch((e) => {
      // 拒绝必须就地截断：逸出会触发 error-diary 的 unhandledrejection 监听
      // → logUiMsg → 再落盘 → 拒绝 → 死循环（原 P2 修复语义，随 D1 迁入适配层）
      console.warn("[diary-sink] AddOpLog 失败:", e);
    });
  };
}
