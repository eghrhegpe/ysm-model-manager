/** 控件通用选项：支持 bind 自动更新或 onUpdate 手动更新 */
export interface ControlOptions<T = number | boolean | string> {
  /** 声明取值方式，updateControls() 时自动拉取最新值并更新显示 */
  bind?: () => T;
  /** 自定义更新逻辑，优先级高于 bind */
  onUpdate?: (el: HTMLElement) => void;
  /**
   * 状态路径提示，用于精确增量刷新。
   * 提供后，仅当该 key 在本帧发生过 set 变更时才触发 update。
   * 不提供则保持旧行为（每次 updateControls 都更新）。
   */
  pathHint?: string;
}
