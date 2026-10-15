// ===== 页脚进度槽 — 长批量操作的「看得见」单点出口 =====
//
// 立因（2026-10-15 P1-C）：文件夹批量启禁是持锁的串行 IPC 长操作（数百项可达数十秒），
// 原实现全程零反馈——点下去 UI 毫无变化，期间任何单文件开关只会撞上「请稍候」。
//
// 为什么放页脚而不复用既有通道：
//   · toast 会刷屏且遮挡树（每批一次 vs 一次一条，语义不同）；
//   · #ftr-stat 被 updateStat / updateSelectCount 高频改写（每次重渲都动），进度写进去
//     会被下一次渲染静默冲掉——这是「写进别人的槽」而非「共享一个槽」；
//   · 故独立一个默认 hidden 的槽，谁跑长批量谁占用，结束即清，与 stat/选择计数互不干扰。
//
// 元素由 tpl.ts|footerHTML 产出（id=ftr-progress，与 VIEW_TESTIDS 声明同处）；
// 本模块只做显隐与文本，缺元素时静默 no-op（布局未就绪/测试夹具未铺该槽都不该抛）。

/**
 * 设置页脚进度文案；传 null 清除并隐藏。
 * @param root 组件 shadow root（可空——未挂载时静默跳过）
 * @param text 已本地化的进度文案（如「⏳ 启用中 8/50」）
 */
export function setFooterProgress(root: ShadowRoot | null | undefined, text: string | null): void {
  const el = root?.getElementById("ftr-progress");
  if (!el) return;
  if (text === null) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.textContent = text;
  el.hidden = false;
}
