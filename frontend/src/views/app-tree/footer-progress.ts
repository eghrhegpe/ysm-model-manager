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

/**
 * 复位进度槽与活跃批次计数——组件卸载（`disconnectedCallback`）时调用。
 *
 * 这是「批次永不落定（IPC 挂死）→ 计数滞留 → 此后所有批次失去进度」这条已知边界的
 * **唯一自愈出口**：把泄漏范围从「应用会话级」收窄到「单个组件实例生命周期内」。不设
 * 超时 watchdog（见 `activeBatches` 注释）的理由不变；生产只有一个 `<app-tree>` 实例
 * （app-content 复用同一元素），故全局计数在此复位不会踩到并发的另一实例。
 */
export function resetFooterProgress(root?: ShadowRoot | null): void {
  activeBatches = 0;
  setFooterProgress(root ?? null, null);
}

/**
 * 正在跑的长批量数（模块级单例 by-design）。进度槽是**单元素多写者**：`_deleteLock` 与
 * `_toggleLock` 是两把独立锁（删除与启停互不阻塞，ADR-341），故「整库启停」与「批量删除」
 * 可以同时在跑。若先结束的那个直接清槽，仍在跑的那个进度会在半途被抹掉——故清槽只在
 * **最后一个**批次退出时发生。
 *
 * ⚠️ 已知边界（2026-10-15 复核记录，未修）：若某个批次**永不落定**（Wails IPC 挂死这类
 * 框架级异常），计数会滞留 >0，此后**所有**批次的清槽都不再发生——槽上留下僵尸文案，且后续
 * 批次失去进度（不比改动前更差：改动前根本没有进度，但确实是退化到不一致态）。不设 watchdog
 * 的理由：挂死意味着 `_deleteLock`/`_toggleLock` 同样常驻 busy，本功能区已整体不可用，用户
 * 只会重启应用；加超时器反而把「真挂死」伪装成正常。真要修，方向是 `Map<root, count>` +
 * 组件重连时复位（多实例/元素重建场景今日不可达：app-content 复用同一 <app-tree> 元素）。
 * 测试若让批次挂起不 await，同样会滞留计数（那是测试自身缺陷）。
 */
let activeBatches = 0;

/**
 * 跑一段长批量并把进度投影到页脚：进入即显示 `0/N`（`total > 0` 时），每批落定推进，
 * **最后一个批次退出时**清槽（成功／失败／异常／调用方早退都经 `finally`）。
 *
 * 立因：五条长批量链（文件夹启禁／整库启停／整目录入回收站／批量重命名／批量删除）都要
 * 「起始 0/N + 每批推进 + 必清」这三步；各抄一遍就是可漂移的三处样板（漏清槽会留下僵尸
 * 进度、漏起始会让首批落定前无反馈），故收在本模块单点。
 *
 * @param root 组件 shadow root（可空——未挂载/测试夹具无该槽时全程静默 no-op）
 * @param format 文案构造器（i18n 归调用方：本模块不做词条选择）
 * @param total 总数，用于起始帧与 `onProgress` 的 total 透传（0 则不写起始帧）
 * @param run 业务体；把 `onProgress` 直接交给 `batchAllSettled` 第三参即可
 * @returns `run` 的返回值原样透传（不吞不改）
 */
export async function withFooterProgress<T>(
  root: ShadowRoot | null | undefined,
  format: (done: number, total: number) => string,
  total: number,
  run: (onProgress: (done: number, total: number) => void) => Promise<T>,
): Promise<T> {
  activeBatches++;
  try {
    // ⚠️ 起始帧写在 try **之内**：`format` 由调用方提供（i18n 取词 + 插值），它若抛错，
    // 写在 try 之外会让下面 finally 的 `activeBatches--` 整个跳过 → 计数永久泄漏 →
    // 进度槽此后永不清槽（僵尸进度挂着不消失，且后续批次也不再清）。
    if (total > 0) setFooterProgress(root, format(0, total));
    // 空批次的 `onProgress(0, 0)` 不得写槽：并行跑着的另一批次文案会被一个凭空多出的
    // 「0/0」覆盖（生产侧 batchAllSettled 对空列表不回调，故今日不可达——但回调是公开
    // 契约，守卫一处省得将来手写循环时踩）（2026-10-15 复核 P2-2）。
    return await run((done, totalNow) => {
      if (totalNow > 0) setFooterProgress(root, format(done, totalNow));
    });
  } finally {
    activeBatches--;
    if (activeBatches === 0) setFooterProgress(root, null);
  }
}
