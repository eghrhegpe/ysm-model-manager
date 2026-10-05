// ===== 日记落盘适配器（ADR-189 D1）：DiarySink → backend AddOpLog =====
// core/error-diary 经此注入落盘能力，依赖方向保持 backend → core 单向；
// 净化/去重/截断策略归 core，本文件只负责 Wails 调用与失败截断。

import type { DiarySink } from "@/core/error-diary.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { getApp } from "./app.ts";
import { drainDiaryOutbox, enqueueDiaryOutbox } from "./diary-outbox.ts";

/** 构造日记落盘 sink：entry 转发至 AddOpLog（op="ui"，sourcePath/targetDir/fileSize 空位） */
export function makeDiarySink(): DiarySink {
  return (entry) => {
    void (async () => {
      const { AddOpLog } = await getApp();
      await AddOpLog("ui", entry.title, "", "", 0, entry.status, entry.detail);
    })().catch((e) => {
      // 拒绝必须就地截断：逸出会触发 error-diary 的 unhandledrejection 监听
      // → logUiMsg → 再落盘 → 拒绝 → 死循环（原 P2 修复语义，随 D1 迁入适配层）
      // P1-6 修复：用 dbg 环形缓冲替代 console.warn——防 log.ts 透写 console.warn
      // 时形成 warn → logUiMsg → AddOpLog 失败 → warn 死循环
      dbg("diary-sink", "AddOpLog 失败", { error: String(e) });
      // ADR-322 D2：dbg 受调试门控（关掉调试后证据随之消失），且 GUI 生产无
      // DevTools → 补投 localStorage 第二通道。enqueue 内部裸 try/catch 静默，
      // 不会把失败弹回本链，故此处是安全终点而非新的环。
      enqueueDiaryOutbox(entry);
    });
  };
}

/**
 * 启动期 drain 接线：把 outbox 积压经主通道重投（ADR-322 D2）。
 * 供 app-modules 的启动步骤调用；**不得** await 到阻塞启动的关键路径上——
 * 主通道不通时每次 emit 都要等一轮桥往返，积压越多启动越慢，故由装配层
 * fire-and-forget，失败反馈在诊断页常驻条（GetLogChannelHealth）。
 * @returns 成功重投条数，供装配层留痕
 */
export async function drainDiaryOutboxToMainChannel(): Promise<number> {
  const { AddOpLog } = await getApp();
  return drainDiaryOutbox(async (entry) => {
    await AddOpLog("ui", entry.title, "", "", 0, entry.status, entry.detail);
  });
}
