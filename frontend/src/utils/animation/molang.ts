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

import { logWarn } from "@/utils/base/primitives/log.ts";
import Molang from "./molang-lib/molang.js";

/** Molang 求值函数：入参为当前动画时间（秒，即 query.anim_time） */
export type MolangFn = (animTime: number) => number;

// 单例解析器（cache_enabled 默认 true，跨 clip 复用表达式缓存）
// 类型签名由 molang.d.ts 提供，直接 new Molang()——无 as unknown as 强转。
const parser = new Molang();

/**
 * 获取全局单例 parser（仅供测试 spy parse 方法）。
 * @deprecated 生产代码应使用 createMolangParser() 工厂（ADR-211）。
 */
export const getMolangParser = (): typeof parser => parser;

// 全局单例 parser 已无模块级写回作用域（ADR-211：clip 自带 MolangParser 实例替代全局单例）。
// 所有需 v.* 持久作用域的编译均走 createMolangParser() 工厂实例。

/** 从 key 归一化到 variable.* 形式并查作用域 */
function lookupScope(scope: Record<string, number>, key: string): number {
  const norm = key.startsWith("v.") ? `variable${key.slice(1)}` : key;
  if (norm.startsWith("variable.") && typeof scope[norm] === "number") {
    return scope[norm];
  }
  return 0;
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
 * @param expr Molang 表达式字符串
 * @param scope 可选：每播放器 v.* 变量容器。传入时闭包捕获该作用域，
 *                       多播放器可各持独立作用域互不干扰。
 *                       不传时 v.* 写入不持久化（适用于 bone keyframes 等无 v.* 场景）。
 * @returns 求值函数；表达式非法/为空返回 null（调用方走零占位降级）
 */
export function compileMolang(
  expr: string,
  scope?: Record<string, number> | null,
): MolangFn | null {
  if (typeof expr !== "string" || expr.trim() === "") return null;
  const capturedScope = scope ?? null;
  try {
    // 每次求值前重置可变变量：molangjs 的 temp./variable. 赋值会写进单例 parser 的
    // self.variables，不重置则跨帧/clip/模型泄漏（Bedrock 语义 temp. 每帧重置）
    parser.resetVariables();
    parser.parse(expr, makeVariables(0)); // 试探编译，非法表达式此处抛错
    return (animTime: number): number => {
      try {
        parser.resetVariables();
        const prevHandler = parser.variableHandler;
        if (capturedScope) {
          parser.variableHandler = (key: string): number => lookupScope(capturedScope, key);
        }
        const v = parser.parse(expr, makeVariables(animTime));
        parser.variableHandler = prevHandler;
        // 有捕获作用域时，把本次解析产生的 v.* 写入并入作用域（跨帧可见）
        if (capturedScope) {
          for (const k in parser.variables) {
            if (k.startsWith("variable.")) capturedScope[k] = parser.variables[k];
          }
        }
        // L4：编译成功但运行时产生 Infinity/NaN（如 1e999、除以零）→ 零占位
        // 对齐 P1 Infinity 守卫口径，避免 NaN 穿透到渲染层
        return typeof v === "number" && Number.isFinite(v) ? v : 0;
      } catch (err) {
        logWarn("molang", "运行时求值失败", err);
        return 0;
      }
    };
  } catch (err) {
    logWarn("molang", `表达式编译失败: ${expr}`, err);
    return null;
  }
}

// ===== 工厂模式：独立 Molang 解析器实例（根除多播放器 activeScope 互盖）=====

/** 独立 Molang 解析器实例 API */
export interface MolangParser {
  /** 编译表达式（可传入闭包作用域，亦可不传依赖 setScope 全局设置） */
  compileMolang: typeof compileMolang;
  /** 设置/清除当前实例的持久变量作用域 */
  setScope: (scope: Record<string, number> | null) => void;
}

/**
 * 创建独立的 Molang 解析器实例，彻底隔离多播放器的 v.* 作用域。
 * 每个播放器/控制器调用此函数获取自有实例，不再共享模块级单例。
 * @returns 独立实例，含 compileMolang + setScope
 */
export function createMolangParser(): MolangParser {
  const instanceParser = new Molang();
  let instanceScope: Record<string, number> | null = null;

  function setScope(scope: Record<string, number> | null): void {
    instanceScope = scope;
    // 复用 lookupScope（v.→variable. 归一化单一实现，防三副本漂移）
    instanceParser.variableHandler = scope
      ? (key: string): number => lookupScope(scope, key)
      : () => 0;
  }

  function compile(expr: string, scope?: Record<string, number> | null): MolangFn | null {
    if (typeof expr !== "string" || expr.trim() === "") return null;
    const capturedScope = scope ?? null;
    try {
      instanceParser.resetVariables();
      instanceParser.parse(expr, makeVariables(0));
      return (animTime: number): number => {
        try {
          instanceParser.resetVariables();
          const prevHandler = instanceParser.variableHandler;
          if (capturedScope) {
            instanceParser.variableHandler = (key: string): number =>
              lookupScope(capturedScope, key);
          }
          const v = instanceParser.parse(expr, makeVariables(animTime));
          instanceParser.variableHandler = prevHandler;
          const writeScope = capturedScope ?? instanceScope;
          if (writeScope) {
            for (const k in instanceParser.variables) {
              if (k.startsWith("variable.")) writeScope[k] = instanceParser.variables[k];
            }
          }
          return typeof v === "number" && Number.isFinite(v) ? v : 0;
        } catch (err) {
          logWarn("molang", "运行时求值失败", err);
          return 0;
        }
      };
    } catch (err) {
      logWarn("molang", `表达式编译失败: ${expr}`, err);
      return null;
    }
  }

  return { compileMolang: compile, setScope };
}
