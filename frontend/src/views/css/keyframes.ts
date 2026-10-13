// ===== Shadow DOM 本地化 keyframes 单一事实源 =====
// 背景（评审 2026-08-24 第 1 条 + 2026-09 锐评 P0）：@keyframes 不穿透 Shadow DOM 边界，
// document 层 components.css 的定义对 shadow 内元素无效——各 shadow 须本地重定义，
// 重复本身是必要的；但「与全局副本/彼此逐字节一致」此前靠注释人肉保证，必崩。
// 本文件把跨 shadow 共享的 keyframe 声明收敛为 TS 常量（模板注入各 shadow CSS 串）。
// ⚠️ 与 frontend/css/components.css 全局副本的一致性仍需人工核对（纯 CSS 文件无法引 TS 常量），
//    改动本常量时必须同步 components.css（translateX(-8px) 契约见 components.css:6）。

/** 左滑淡入（app-content 内容区 / app-sidebar 实例卡共用） */
export const FADE_SLIDE_LEFT =
  "@keyframes fadeSlideLeft { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }";

/**
 * 拖拽悬停呼吸脉冲（app-tree 拖拽导入提示条 .tree-drop-hint .dot 消费）。
 * 纯 opacity 脉冲（不触发布局/transform，合成器友好）；低值 .4 与 dot 基础态
 * 同值（app-tree-styles.ts）——动画关闭时降级为静态 .4 圆点，语义不损失。
 * no-animations 兼容：app-tree shadow 已 adopt noAnimationsCSS 通配桥，零额外接线。
 */
export const PULSE_DOT = "@keyframes pulseDot { 0%, 100% { opacity:.4; } 50% { opacity:1; } }";
