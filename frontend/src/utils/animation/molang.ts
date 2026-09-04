// ===== Molang 表达式编译器（ADR-100 L4：内嵌 molangjs）=====
// 封装 molangjs（MIT，Blockbench 官方依赖 ^1.7.0）：把 .animation.json 里的
// Molang 字符串编译为 (animTime) => number 求值闭包。
//
// 安全口径：molangjs 是真正的 DSL 解析器（词法/语法/AST），不是 eval——
// 延续本项目「Molang 不解释执行任意 JS 表达式」的安全底线。
// 性能口径：molangjs cache_enabled 默认开启（400 条 LRU），表达式只解析一次，
// 运行期纯求值——对齐 ModernYSM「加载期编译 AST / 运行期只 eval」的原则。
// 语义口径：use_radians=false（默认）= Bedrock 三角函数角度制约定。
//
// 嵌入策略：molangjs npm 包因 "type":"module" + CJS dist 混用，在 Node 测试环境
// 无法直接静态 import；本项目采用**源码内嵌**策略，将 molangjs/src 与 syntax 目录
// 按 MIT 许可保留原始版权头，本地路径 import，彻底避开 ESM/CJS 混用坑。

import Molang from "./molang-lib/molang.js";

/** Molang 求值函数：入参为当前动画时间（秒，即 query.anim_time） */
export type MolangFn = (animTime: number) => number;

// 单例解析器（cache_enabled 默认 true，跨 clip 复用表达式缓存）
// molangjs src/molang.js 是 IIFE 自执行模块，TypeScript 类型定义不完整（无 new 签名），
// 用 as unknown as 绕过——运行时确认可正常 new 实例化。
const parser = new (
  Molang as unknown as new () => {
    parse(expr: string, variables: Record<string, number>): number;
    resetVariables(): void;
    variables: Record<string, number>;
    variableHandler: ((key: string, variables: object) => number) | null;
  }
)();

// 每播放器持久变量作用域（控制器 v.* 跨帧持久化，ADR-100 L4 语义：v. 每实体持久、
// temp. 每帧重置）。默认 null = 无作用域，行为与原先一致（每次求值 reset、v.* 不持久）。
// 启用方式：播放器在 timeline + 控制器求值段 setMolangScope(scope)，结束后 setMolangScope(null)。
let activeScope: Record<string, number> | null = null;

/**
 * 设置/清除当前持久变量作用域。
 * @param scope 每播放器 v.* 变量容器；传 null 恢复默认（v.* 不跨帧持久）
 */
export function setMolangScope(scope: Record<string, number> | null): void {
  activeScope = scope;
  // 未知 query/variable → 0：mod 扩展的游戏态查询（ysm.*/按键/药效等）在预览器
  // 无宿主语境，优雅降级而非抛错（对齐 YSMViewer Molang 求值失败回退口径）。
  // 有作用域时 v.* 读从作用域取（控制器条件读 timeline 写入的变量）。
  parser.variableHandler = scope
    ? (key: string): number => {
        const norm = key.startsWith("v.") ? "variable" + key.slice(1) : key;
        if (norm.startsWith("variable.") && typeof scope[norm] === "number") {
          return scope[norm];
        }
        return 0;
      }
    : () => 0;
}

/** 构建 anim_time 上下文（molangjs 精确键匹配，q./query. 双写） */
function makeVariables(animTime: number): Record<string, number> {
  return {
    "query.anim_time": animTime,
    "q.anim_time": animTime,
    "query.life_time": animTime,
    "q.life_time": animTime,
    "query.delta_time": 0,
    "q.delta_time": 0,
  };
}

/**
 * 编译 Molang 表达式为求值闭包。
 * @returns 求值函数；表达式非法/为空返回 null（调用方走零占位降级）
 */
export function compileMolang(expr: string): MolangFn | null {
  if (typeof expr !== "string" || expr.trim() === "") return null;
  try {
    // 每次求值前重置可变变量：molangjs 的 temp./variable. 赋值会写进单例 parser 的
    // self.variables，不重置则跨帧/clip/模型泄漏（Bedrock 语义 temp. 每帧重置，审核 P3）
    parser.resetVariables();
    parser.parse(expr, makeVariables(0)); // 试探编译，非法表达式此处抛错
    return (animTime: number): number => {
      try {
        parser.resetVariables();
        const v = parser.parse(expr, makeVariables(animTime));
        // 持久作用域启用时，把本次解析产生的 v.* 写入并入作用域（跨帧可见）。
        // 无作用域时跳过——保持原先「每次求值 reset、v.* 不持久」语义不变。
        if (activeScope) {
          for (const k in parser.variables) {
            if (k.startsWith("variable.")) activeScope[k] = parser.variables[k];
          }
        }
        // L4：编译成功但运行时产生 Infinity/NaN（如 1e999、除以零）→ 零占位
        // 对齐 P1 Infinity 守卫口径，避免 NaN 穿透到渲染层
        return typeof v === "number" && Number.isFinite(v) ? v : 0;
      } catch {
        return 0;
      }
    };
  } catch {
    return null;
  }
}
