// ===== 最近选中模型路径（跨视图共享态 — ADR-221）=====
// 归属修正：原寄居于 views/app-content/init-pages.ts，导致 app-tree / app-nav /
// app-preview 三个视图域越权伸手（并构成 app-content ↔ app-preview 视图环）。
// 本模块引擎无关、零 Wails、零 DOM 依赖 → 按 ADR-189 D4 归入 core。
// 写入方：app-tree 选中/取消选中模型；读取方：app-nav 左下角 3D 一键跳转。

let _lastModelPath: string | null = null;

/** 记住最后选中的模型路径（null = 清空） */
export function rememberModelPath(path: string | null): void {
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
