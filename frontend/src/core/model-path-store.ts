// ===== 最近选中模型路径（跨视图共享态 — ADR-221）=====
// 归属修正：原寄居于 views/app-content/init-pages.ts，导致 app-tree / app-nav /
// app-preview 三个视图域越权伸手（并构成 app-content ↔ app-preview 视图环）。
// 本模块引擎无关、零 Wails、零 DOM 依赖 → 按 ADR-189 D4 归入 core。
//
// 角色定位：core 的「跨视图状态快照」子范式（区别于 page-store 的纯函数子范式）——
// 就地持有模块级状态，不校验业务语义（路径合法性由 Go 侧扫描保证，前端只透传）。
// 与 page-store 的守卫型设计（isValidPage 入口拦截）分工不同：本模块是传声筒，
// 只防御「契约级非法值」（空串），业务级校验归 Go。
// 写入方：app-tree 选中/取消选中模型；读取方：app-nav 左下角 3D 一键跳转。

let _lastModelPath: string | null = null;

/** 记住最后选中的模型路径（null = 清空；空串视为契约级非法值拒绝写入） */
export function rememberModelPath(path: string | null): void {
  if (path === "") {
    console.warn("[model-path-store] 拒绝空路径写入：清空请传 null，空串不是合法模型路径");
    return;
  }
  _lastModelPath = path;
}

/** 读取最后选中的模型路径（无选中 → null） */
export function getLastModelPath(): string | null {
  return _lastModelPath;
}

/** 测试钩子：重置 _lastModelPath（isolate:false 共享模块图下，兄弟用例残留会泄漏到
 *  后续用例的 getLastModelPath 断言；modal-core.__resetModalStateForTest 同款范式） */
export function __resetLastModelPathForTest(): void {
  _lastModelPath = null;
}
